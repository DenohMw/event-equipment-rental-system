const express = require('express');
const db = require('../config/db');
const { verifyToken, requireRole } = require('../middleware/auth');
const router = express.Router();

// ============================================
// POST /api/reviews — Create a review
// ============================================
router.post('/', verifyToken, requireRole('customer'), async (req, res) => {
    const { booking_id, rating, comment, is_recommended } = req.body;

    if (!booking_id || !rating) {
        return res.status(400).json({
            status: 'error',
            message: 'Required: booking_id, rating'
        });
    }

    const ratingNum = Number(rating);
    if (isNaN(ratingNum) || ratingNum < 1 || ratingNum > 5) {
        return res.status(400).json({
            status: 'error',
            message: 'Rating must be between 1 and 5'
        });
    }

    try {
        // 1. Verify booking belongs to this customer and is in a reviewable state
        const [bookings] = await db.query(
            'SELECT booking_id, customer_id, equipment_id, owner_id, status FROM Booking WHERE booking_id = ? AND customer_id = ?',
            [booking_id, req.user.user_id]
        );

        if (bookings.length === 0) {
            return res.status(404).json({ status: 'error', message: 'Booking not found' });
        }

        const booking = bookings[0];

        if (booking.status !== 'completed' && booking.status !== 'returned') {
            return res.status(400).json({
                status: 'error',
                message: 'You can only review completed or returned bookings. This booking is "' + booking.status + '".'
            });
        }

        // 2. Check for existing review
        const [existing] = await db.query(
            'SELECT review_id FROM Review WHERE booking_id = ?',
            [booking_id]
        );

        if (existing.length > 0) {
            return res.status(409).json({
                status: 'error',
                message: 'You have already reviewed this booking'
            });
        }

        // 3. Insert the review
        const [result] = await db.query(`
            INSERT INTO Review (booking_id, customer_id, equipment_id, owner_id, rating, comment, is_recommended, is_verified)
            VALUES (?, ?, ?, ?, ?, ?, ?, TRUE)
        `, [
            booking_id,
            req.user.user_id,
            booking.equipment_id,
            booking.owner_id,
            ratingNum,
            comment ? String(comment).trim() : null,
            is_recommended !== false ? 1 : 0
        ]);

        // 4. Recalculate equipment rating
        await db.query(`
            UPDATE Equipment e
            SET 
                avg_rating = COALESCE((SELECT ROUND(AVG(rating), 2) FROM Review WHERE equipment_id = e.equipment_id), 0),
                total_reviews = (SELECT COUNT(*) FROM Review WHERE equipment_id = e.equipment_id)
            WHERE e.equipment_id = ?
        `, [booking.equipment_id]);

        // 5. Notify the owner
        try {
            await db.query(`
                INSERT INTO Notification (user_id, title, message, type, reference_id)
                VALUES (?, 'New Review Received', ?, 'review', ?)
            `, [
                booking.owner_id,
                `A customer left a ${ratingNum}-star review for booking ${booking_id}`,
                result.insertId
            ]);
        } catch (notifErr) {
            console.error('Review notification failed (non-fatal):', notifErr);
        }

        res.status(201).json({
            status: 'success',
            message: 'Review submitted successfully',
            review_id: result.insertId
        });

    } catch (err) {
        console.error('Review submission error:', err);
        res.status(500).json({ status: 'error', message: 'Failed to submit review' });
    }
});

// ============================================
// GET /api/reviews/my — Customer's own reviews
// ============================================
router.get('/my', verifyToken, requireRole('customer'), async (req, res) => {
    try {
        const [rows] = await db.query(`
            SELECT 
                r.*,
                e.name AS equipment_name,
                o.business_name,
                u.full_name AS owner_full_name
            FROM Review r
            JOIN Equipment e ON r.equipment_id = e.equipment_id
            JOIN Owner o ON r.owner_id = o.owner_id
            JOIN User u ON o.owner_id = u.user_id
            WHERE r.customer_id = ?
            ORDER BY r.created_at DESC
        `, [req.user.user_id]);

        res.json({ status: 'success', reviews: rows });
    } catch (err) {
        console.error(err);
        res.status(500).json({ status: 'error', message: 'Failed to fetch reviews' });
    }
});

// ============================================
// GET /api/reviews/booking/:bookingId
// Check whether a booking has already been reviewed
// ============================================
router.get('/booking/:bookingId', verifyToken, async (req, res) => {
    try {
        const [rows] = await db.query(
            'SELECT * FROM Review WHERE booking_id = ? AND customer_id = ?',
            [req.params.bookingId, req.user.user_id]
        );

        if (rows.length === 0) {
            return res.json({ status: 'success', review: null });
        }

        res.json({ status: 'success', review: rows[0] });
    } catch (err) {
        console.error(err);
        res.status(500).json({ status: 'error', message: 'Failed to fetch review' });
    }
});

// ============================================
// GET /api/reviews/equipment/:equipmentId
// List reviews for an equipment (public)
// ============================================
router.get('/equipment/:equipmentId', async (req, res) => {
    try {
        const [rows] = await db.query(`
            SELECT 
                r.review_id,
                r.rating,
                r.comment,
                r.is_recommended,
                r.created_at,
                u.full_name AS customer_name
            FROM Review r
            JOIN Customer c ON r.customer_id = c.customer_id
            JOIN User u ON c.customer_id = u.user_id
            WHERE r.equipment_id = ?
            ORDER BY r.created_at DESC
        `, [req.params.equipmentId]);

        res.json({ status: 'success', reviews: rows });
    } catch (err) {
        console.error(err);
        res.status(500).json({ status: 'error', message: 'Failed to fetch reviews' });
    }
});

module.exports = router;
