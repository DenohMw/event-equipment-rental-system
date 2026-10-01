const express = require('express');
const db = require('../config/db');
const { verifyToken, requireRole } = require('../middleware/auth');
const router = express.Router();

// ============================================
// HELPER: Generate unique booking reference
// ============================================
function generateBookingRef() {
    const date = new Date();
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    const random = Math.floor(Math.random() * 9000) + 1000;
    return `BK${yyyy}${mm}${dd}${random}`;
}

// ============================================
// GET /api/bookings/check-availability
// Check if equipment is available for given dates
// ============================================
router.get('/check-availability', async (req, res) => {
    const { equipment_id, quantity, start_date, end_date } = req.query;

    if (!equipment_id || !quantity || !start_date || !end_date) {
        return res.status(400).json({
            status: 'error',
            message: 'Required: equipment_id, quantity, start_date, end_date'
        });
    }

    try {
        const [rows] = await db.query(`
            SELECT 
                e.quantity_total,
                COALESCE(SUM(b.quantity), 0) AS booked_quantity,
                (e.quantity_total - COALESCE(SUM(b.quantity), 0)) AS available_quantity,
                e.price_per_day
            FROM Equipment e
            LEFT JOIN Booking b ON e.equipment_id = b.equipment_id
                AND b.status IN ('confirmed', 'paid', 'delivered', 'rented')
                AND b.start_date <= ?
                AND b.end_date >= ?
            WHERE e.equipment_id = ?
            GROUP BY e.equipment_id, e.quantity_total, e.price_per_day
        `, [end_date, start_date, equipment_id]);

        if (rows.length === 0) {
            return res.status(404).json({ status: 'error', message: 'Equipment not found' });
        }

        const info = rows[0];
        const requested = Number(quantity);
        const available = Number(info.available_quantity);
        const canBook = available >= requested;

        // Calculate cost
        const days = Math.ceil((new Date(end_date) - new Date(start_date)) / (1000 * 60 * 60 * 24)) + 1;
        const subtotal = Number(info.price_per_day) * requested * days;
        const service_fee = subtotal * 0.10;
        const total = subtotal + service_fee;

        res.json({
            status: 'success',
            canBook,
            available,
            requested,
            days,
            price_per_day: info.price_per_day,
            subtotal: subtotal.toFixed(2),
            service_fee: service_fee.toFixed(2),
            total_amount: total.toFixed(2),
            message: canBook 
                ? 'Equipment is available for these dates' 
                : `Only ${available} available. You requested ${requested}.`
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ status: 'error', message: 'Availability check failed' });
    }
});

// ============================================
// POST /api/bookings — Create new booking
// ============================================
router.post('/', verifyToken, requireRole('customer'), async (req, res) => {
    const { equipment_id, quantity, start_date, end_date, delivery_address } = req.body;

    if (!equipment_id || !quantity || !start_date || !end_date) {
        return res.status(400).json({
            status: 'error',
            message: 'Required: equipment_id, quantity, start_date, end_date'
        });
    }

    const conn = await db.getConnection();

    try {
        await conn.beginTransaction();

        // 1. Lock equipment row
        const [equip] = await conn.query(
            'SELECT owner_id, price_per_day, quantity_total FROM Equipment WHERE equipment_id = ? AND is_available = TRUE AND is_approved = TRUE FOR UPDATE',
            [equipment_id]
        );

        if (equip.length === 0) {
            await conn.rollback();
            return res.status(404).json({ status: 'error', message: 'Equipment not found or unavailable' });
        }

        const { owner_id, price_per_day, quantity_total } = equip[0];

        // 2. Check availability within transaction
        const [booked] = await conn.query(`
            SELECT COALESCE(SUM(quantity), 0) AS booked
            FROM Booking
            WHERE equipment_id = ?
              AND status IN ('confirmed','paid','delivered','rented')
              AND start_date <= ? AND end_date >= ?
        `, [equipment_id, end_date, start_date]);

        const available = quantity_total - Number(booked[0].booked);

        if (available < quantity) {
            await conn.rollback();
            return res.status(400).json({
                status: 'error',
                message: `Only ${available} available for these dates. You requested ${quantity}.`
            });
        }

        // 3. Calculate costs
        const days = Math.ceil((new Date(end_date) - new Date(start_date)) / (1000 * 60 * 60 * 24)) + 1;
        const subtotal = Number(price_per_day) * quantity * days;
        const service_fee = subtotal * 0.10;
        const total_amount = subtotal + service_fee;
        const booking_ref = generateBookingRef();

        // 4. Insert booking
        const [result] = await conn.query(`
            INSERT INTO Booking
            (booking_ref, customer_id, equipment_id, owner_id, quantity, start_date, end_date,
             duration_days, unit_price, subtotal, service_fee, total_amount, delivery_address, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'requested')
        `, [
            booking_ref, req.user.user_id, equipment_id, owner_id, quantity,
            start_date, end_date, days, price_per_day, subtotal, service_fee,
            total_amount, delivery_address || null
        ]);

        const bookingId = result.insertId;

        // 5. Notify owner
        await conn.query(`
            INSERT INTO Notification (user_id, title, message, type, reference_id)
            VALUES (?, 'New Booking Request', ?, 'booking', ?)
        `, [owner_id, `New booking ${booking_ref} for quantity ${quantity}`, bookingId]);

        await conn.commit();

        res.status(201).json({
            status: 'success',
            message: 'Booking created successfully. Awaiting owner confirmation.',
            booking: {
                booking_id: bookingId,
                booking_ref,
                equipment_id,
                quantity,
                start_date,
                end_date,
                days,
                subtotal: subtotal.toFixed(2),
                service_fee: service_fee.toFixed(2),
                total_amount: total_amount.toFixed(2),
                status: 'requested'
            }
        });

    } catch (err) {
        await conn.rollback();
        console.error(err);
        res.status(500).json({ status: 'error', message: 'Booking failed: ' + err.message });
    } finally {
        conn.release();
    }
});

// ============================================
// GET /api/bookings/my — Customer's bookings
// ============================================
router.get('/my', verifyToken, requireRole('customer'), async (req, res) => {
    try {
        const [rows] = await db.query(`
            SELECT 
                b.*,
                e.name AS equipment_name,
                e.location,
                (SELECT image_url FROM EquipmentImage WHERE equipment_id = e.equipment_id AND is_primary = TRUE LIMIT 1) AS equipment_image,
                o.business_name AS owner_name,
                u.full_name AS owner_full_name,
                p.status AS payment_status,
                p.mpesa_receipt
            FROM Booking b
            JOIN Equipment e ON b.equipment_id = e.equipment_id
            JOIN Owner o ON b.owner_id = o.owner_id
            JOIN User u ON o.owner_id = u.user_id
            LEFT JOIN Payment p ON b.booking_id = p.booking_id
            WHERE b.customer_id = ?
            ORDER BY b.created_at DESC
        `, [req.user.user_id]);

        res.json({ status: 'success', bookings: rows });
    } catch (err) {
        console.error(err);
        res.status(500).json({ status: 'error', message: 'Failed to fetch bookings' });
    }
});

// ============================================
// GET /api/bookings/owner — Bookings for owner's equipment
// ============================================
router.get('/owner', verifyToken, requireRole('owner'), async (req, res) => {
    try {
        const [rows] = await db.query(`
            SELECT 
                b.*,
                e.name AS equipment_name,
                u.full_name AS customer_name,
                u.email AS customer_email,
                u.phone AS customer_phone,
                p.status AS payment_status,
                p.mpesa_receipt
            FROM Booking b
            JOIN Equipment e ON b.equipment_id = e.equipment_id
            JOIN Customer c ON b.customer_id = c.customer_id
            JOIN User u ON c.customer_id = u.user_id
            LEFT JOIN Payment p ON b.booking_id = p.booking_id
            WHERE b.owner_id = ?
            ORDER BY b.created_at DESC
        `, [req.user.user_id]);

        res.json({ status: 'success', bookings: rows });
    } catch (err) {
        console.error(err);
        res.status(500).json({ status: 'error', message: 'Failed to fetch bookings' });
    }
});

// ============================================
// GET /api/bookings/:id — Single booking
// ============================================
router.get('/:id', verifyToken, async (req, res) => {
    try {
        const [rows] = await db.query(`
            SELECT 
                b.*,
                e.name AS equipment_name,
                e.location,
                (SELECT image_url FROM EquipmentImage WHERE equipment_id = e.equipment_id AND is_primary = TRUE LIMIT 1) AS equipment_image,
                c_user.full_name AS customer_name,
                c_user.email AS customer_email,
                c_user.phone AS customer_phone,
                o.business_name AS owner_name,
                o_user.full_name AS owner_full_name,
                o_user.phone AS owner_phone,
                p.status AS payment_status,
                p.mpesa_receipt
            FROM Booking b
            JOIN Equipment e ON b.equipment_id = e.equipment_id
            JOIN Customer c ON b.customer_id = c.customer_id
            JOIN User c_user ON c.customer_id = c_user.user_id
            JOIN Owner o ON b.owner_id = o.owner_id
            JOIN User o_user ON o.owner_id = o_user.user_id
            LEFT JOIN Payment p ON b.booking_id = p.booking_id
            WHERE b.booking_id = ?
        `, [req.params.id]);

        if (rows.length === 0) {
            return res.status(404).json({ status: 'error', message: 'Booking not found' });
        }

        const booking = rows[0];

        // Access: customer who made it, owner of the equipment, or admin
        const isCustomer = booking.customer_id === req.user.user_id;
        const isOwner = booking.owner_id === req.user.user_id;
        const isAdmin = req.user.role === 'admin';

        if (!isCustomer && !isOwner && !isAdmin) {
            return res.status(403).json({ status: 'error', message: 'Access denied' });
        }

        res.json({ status: 'success', booking });
    } catch (err) {
        console.error(err);
        res.status(500).json({ status: 'error', message: 'Failed to fetch booking' });
    }
});

// ============================================
// PUT /api/bookings/:id/status — Update booking status
// ============================================
router.put('/:id/status', verifyToken, async (req, res) => {
    const { status, return_condition, damage_charges, late_fee, notes } = req.body;

    const validStatuses = ['confirmed', 'delivered', 'rented', 'returned', 'completed', 'cancelled'];
    if (!status || !validStatuses.includes(status)) {
        return res.status(400).json({
            status: 'error',
            message: `Invalid status. Allowed: ${validStatuses.join(', ')}`
        });
    }

    try {
        // Get current booking
        const [bookings] = await db.query(
            'SELECT owner_id, customer_id, status AS current_status FROM Booking WHERE booking_id = ?',
            [req.params.id]
        );

        if (bookings.length === 0) {
            return res.status(404).json({ status: 'error', message: 'Booking not found' });
        }

        const booking = bookings[0];
        const isOwner = booking.owner_id === req.user.user_id;
        const isCustomer = booking.customer_id === req.user.user_id;
        const isAdmin = req.user.role === 'admin';

        // Ownership rules per transition
        if (!isAdmin && !isOwner && !isCustomer) {
            return res.status(403).json({ status: 'error', message: 'Access denied' });
        }

        // Only owner/admin can confirm, deliver, mark rented/returned/completed
        // Customer can only cancel (and only if requested)
        if (status === 'cancelled' && isCustomer && !isOwner && !isAdmin) {
            if (booking.current_status !== 'requested') {
                return res.status(400).json({
                    status: 'error',
                    message: 'Can only cancel bookings in "requested" state'
                });
            }
        } else if (!isOwner && !isAdmin) {
            return res.status(403).json({ status: 'error', message: 'Only owner or admin can perform this action' });
        }

        // Build update
        let sql = 'UPDATE Booking SET status = ?';
        const params = [status];

        if (return_condition) { sql += ', return_condition = ?'; params.push(return_condition); }
        if (damage_charges !== undefined) { sql += ', damage_charges = ?'; params.push(damage_charges); }
        if (late_fee !== undefined) { sql += ', late_fee = ?'; params.push(late_fee); }
        if (notes) { sql += ', notes = ?'; params.push(notes); }
        if (status === 'returned') { sql += ', return_date = NOW()'; }

        sql += ' WHERE booking_id = ?';
        params.push(req.params.id);

        await db.query(sql, params);

        res.json({ status: 'success', message: `Booking status updated to ${status}` });
    } catch (err) {
        console.error(err);
        res.status(500).json({ status: 'error', message: 'Failed to update booking' });
    }
});

module.exports = router;