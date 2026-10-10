const express = require('express');
const db = require('../config/db');
const { verifyToken, requireRole } = require('../middleware/auth');
const router = express.Router();

// All admin routes require the admin role
router.use(verifyToken, requireRole('admin'));

// ============================================
// GET /api/admin/stats — Dashboard overview metrics
// ============================================
router.get('/stats', async (req, res) => {
    try {
        const [[users]] = await db.query('SELECT COUNT(*) AS total FROM User WHERE role = "customer"');
        const [[owners]] = await db.query('SELECT COUNT(*) AS total FROM User WHERE role = "owner"');
        const [[pendingOwners]] = await db.query('SELECT COUNT(*) AS total FROM Owner WHERE is_verified = FALSE');
        const [[equipment]] = await db.query('SELECT COUNT(*) AS total FROM Equipment WHERE is_approved = TRUE');
        const [[pendingEquipment]] = await db.query('SELECT COUNT(*) AS total FROM Equipment WHERE is_approved = FALSE');
        const [[bookings]] = await db.query('SELECT COUNT(*) AS total FROM Booking');
        const [[activeBookings]] = await db.query(
            'SELECT COUNT(*) AS total FROM Booking WHERE status IN ("confirmed","paid","delivered","rented")'
        );
        const [[completedBookings]] = await db.query(
            'SELECT COUNT(*) AS total FROM Booking WHERE status IN ("completed","returned")'
        );

        const [[revenue]] = await db.query(`
            SELECT COALESCE(SUM(amount), 0) AS total
            FROM Payment
            WHERE status = 'completed'
        `);

        const [[commission]] = await db.query(`
            SELECT COALESCE(SUM(amount), 0) AS total
            FROM Payment
            WHERE status = 'completed'
        `);

        const [[pendingWithdrawals]] = await db.query(
            'SELECT COUNT(*) AS total FROM Withdrawal WHERE status = "pending"'
        );

        res.json({
            status: 'success',
            stats: {
                totalCustomers: users.total,
                totalOwners: owners.total,
                pendingOwnerVerifications: pendingOwners.total,
                totalEquipment: equipment.total,
                pendingEquipmentApprovals: pendingEquipment.total,
                totalBookings: bookings.total,
                activeBookings: activeBookings.total,
                completedBookings: completedBookings.total,
                totalRevenue: Number(revenue.total),
                platformCommission: Number(commission.total) * 0.10,
                pendingWithdrawals: pendingWithdrawals.total
            }
        });
    } catch (err) {
        console.error('Admin stats error:', err);
        res.status(500).json({ status: 'error', message: 'Failed to load stats' });
    }
});

// ============================================
// GET /api/admin/activity — Recent activity feed
// ============================================
router.get('/activity', async (req, res) => {
    try {
        const [rows] = await db.query(`
            SELECT 
                n.notification_id AS id,
                n.title,
                n.message,
                n.type,
                n.created_at,
                u.full_name AS user_name,
                u.role AS user_role
            FROM Notification n
            JOIN User u ON n.user_id = u.user_id
            ORDER BY n.created_at DESC
            LIMIT 10
        `);

        res.json({ status: 'success', activity: rows });
    } catch (err) {
        console.error('Admin activity error:', err);
        res.status(500).json({ status: 'error', message: 'Failed to load activity' });
    }
});

// ============================================
// GET /api/admin/users — List all users
// ============================================
router.get('/users', async (req, res) => {
    const { role } = req.query;

    try {
        let sql = `
            SELECT 
                u.user_id,
                u.full_name,
                u.email,
                u.phone,
                u.role,
                u.is_active,
                u.is_verified,
                u.created_at,
                o.business_name,
                o.is_verified AS owner_verified
            FROM User u
            LEFT JOIN Owner o ON u.user_id = o.owner_id
            WHERE 1 = 1
        `;
        const params = [];

        if (role) {
            sql += ' AND u.role = ?';
            params.push(role);
        }

        sql += ' ORDER BY u.created_at DESC';

        const [rows] = await db.query(sql, params);
        res.json({ status: 'success', users: rows });
    } catch (err) {
        console.error('Admin users error:', err);
        res.status(500).json({ status: 'error', message: 'Failed to load users' });
    }
});

// ============================================
// GET /api/admin/owners/pending — Owners awaiting verification
// ============================================
router.get('/owners/pending', async (req, res) => {
    try {
        const [rows] = await db.query(`
            SELECT 
                o.owner_id,
                o.business_name,
                o.id_number,
                o.mpesa_number,
                o.is_verified,
                u.created_at,
                u.full_name,
                u.email,
                u.phone
            FROM Owner o
            JOIN User u ON o.owner_id = u.user_id
            WHERE o.is_verified = FALSE
            ORDER BY u.created_at DESC
        `);

        res.json({ status: 'success', owners: rows });
    } catch (err) {
        console.error('Admin pending owners error:', err);
        res.status(500).json({ status: 'error', message: 'Failed to load pending owners' });
    }
});

// ============================================
// PUT /api/admin/owners/:id/verify — Approve or reject owner
// ============================================
router.put('/owners/:id/verify', async (req, res) => {
    const { approve } = req.body;

    if (approve === undefined) {
        return res.status(400).json({ status: 'error', message: 'Required: approve (true/false)' });
    }

    try {
        if (approve) {
            await db.query(
                'UPDATE Owner SET is_verified = TRUE, verified_at = NOW(), verified_by = ? WHERE owner_id = ?',
                [req.user.user_id, req.params.id]
            );
        } else {
            await db.query(
                'UPDATE Owner SET is_verified = FALSE WHERE owner_id = ?',
                [req.params.id]
            );
        }

        // Notify the owner
        try {
            await db.query(`
                INSERT INTO Notification (user_id, title, message, type)
                VALUES (?, ?, ?, 'system')
            `, [
                req.params.id,
                approve ? 'Account Verified' : 'Verification Rejected',
                approve
                    ? 'Your owner account has been verified. You can now list equipment.'
                    : 'Your verification was rejected. Please contact support.'
            ]);
        } catch (notifErr) {
            console.error('Owner notify failed (non-fatal):', notifErr);
        }

        res.json({
            status: 'success',
            message: approve ? 'Owner verified' : 'Owner rejected'
        });
    } catch (err) {
        console.error('Admin verify owner error:', err);
        res.status(500).json({ status: 'error', message: 'Failed to update owner' });
    }
});

// ============================================
// GET /api/admin/equipment/pending — Equipment awaiting approval
// ============================================
router.get('/equipment/pending', async (req, res) => {
    try {
        const [rows] = await db.query(`
            SELECT 
                e.equipment_id,
                e.name,
                e.description,
                e.price_per_day,
                e.quantity_total,
                e.location,
                e.is_approved,
                e.created_at,
                c.name AS category_name,
                u.full_name AS owner_name,
                o.business_name,
                (SELECT image_url FROM EquipmentImage 
                 WHERE equipment_id = e.equipment_id AND is_primary = TRUE 
                 LIMIT 1) AS primary_image
            FROM Equipment e
            JOIN Category c ON e.category_id = c.category_id
            JOIN Owner o ON e.owner_id = o.owner_id
            JOIN User u ON o.owner_id = u.user_id
            WHERE e.is_approved = FALSE
            ORDER BY e.equipment_id DESC
        `);

        res.json({ status: 'success', equipment: rows });
    } catch (err) {
        console.error('Admin pending equipment error:', err);
        res.status(500).json({ status: 'error', message: 'Failed to load pending equipment' });
    }
});

// ============================================
// PUT /api/admin/equipment/:id/approve — Approve or reject equipment
// ============================================
router.put('/equipment/:id/approve', async (req, res) => {
    const { approve } = req.body;

    if (approve === undefined) {
        return res.status(400).json({ status: 'error', message: 'Required: approve (true/false)' });
    }

    try {
        if (approve) {
            await db.query(
                'UPDATE Equipment SET is_approved = TRUE, is_available = TRUE WHERE equipment_id = ?',
                [req.params.id]
            );
        } else {
            await db.query(
                'DELETE FROM Equipment WHERE equipment_id = ?',
                [req.params.id]
            );
        }

        res.json({
            status: 'success',
            message: approve ? 'Equipment approved' : 'Equipment rejected and removed'
        });
    } catch (err) {
        console.error('Admin approve equipment error:', err);
        res.status(500).json({ status: 'error', message: 'Failed to update equipment' });
    }
});

// ============================================
// GET /api/admin/bookings — List all bookings
// ============================================
router.get('/bookings', async (req, res) => {
    try {
        const [rows] = await db.query(`
            SELECT 
                b.booking_id,
                b.booking_ref,
                b.status,
                b.total_amount,
                b.start_date,
                b.end_date,
                b.created_at,
                e.name AS equipment_name,
                cu.full_name AS customer_name,
                ou.full_name AS owner_name
            FROM Booking b
            JOIN Equipment e ON b.equipment_id = e.equipment_id
            JOIN Customer c ON b.customer_id = c.customer_id
            JOIN User cu ON c.customer_id = cu.user_id
            JOIN Owner o ON b.owner_id = o.owner_id
            JOIN User ou ON o.owner_id = ou.user_id
            ORDER BY b.created_at DESC
            LIMIT 100
        `);

        res.json({ status: 'success', bookings: rows });
    } catch (err) {
        console.error('Admin bookings error:', err);
        res.status(500).json({ status: 'error', message: 'Failed to load bookings' });
    }
});

// ============================================
// PUT /api/admin/users/:id/toggle-active
// ============================================
router.put('/users/:id/toggle-active', async (req, res) => {
    const { is_active } = req.body;

    if (is_active === undefined) {
        return res.status(400).json({ status: 'error', message: 'Required: is_active (true/false)' });
    }

    try {
        // Prevent deactivating yourself
        if (Number(req.params.id) === req.user.user_id) {
            return res.status(400).json({ status: 'error', message: 'You cannot deactivate your own account' });
        }

        const [existing] = await db.query('SELECT user_id, role FROM User WHERE user_id = ?', [req.params.id]);
        if (existing.length === 0) {
            return res.status(404).json({ status: 'error', message: 'User not found' });
        }

        await db.query(
            'UPDATE User SET is_active = ? WHERE user_id = ?',
            [is_active ? 1 : 0, req.params.id]
        );

        res.json({
            status: 'success',
            message: is_active ? 'User activated' : 'User deactivated'
        });
    } catch (err) {
        console.error('Admin toggle user error:', err);
        res.status(500).json({ status: 'error', message: 'Failed to update user' });
    }
});

module.exports = router;
