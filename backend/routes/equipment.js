const express = require('express');
const db = require('../config/db');
const { verifyToken, requireRole } = require('../middleware/auth');
const router = express.Router();

// ============================================
// GET /api/equipment/categories — List all categories
// (MUST come before /:id to avoid conflict)
// ============================================
router.get('/categories', async (req, res) => {
    try {
        const [rows] = await db.query(
            'SELECT category_id, name, description, icon FROM Category WHERE is_active = TRUE ORDER BY name'
        );
        res.json({ status: 'success', categories: rows });
    } catch (err) {
        console.error(err);
        res.status(500).json({ status: 'error', message: 'Failed to fetch categories' });
    }
});

// ============================================
// GET /api/equipment — List equipment with filters
// ============================================
router.get('/', async (req, res) => {
    const { 
        category, location, min_price, max_price, search, 
        sort = 'newest', page = 1, limit = 12 
    } = req.query;

    let sql = `
        SELECT 
            e.equipment_id,
            e.name,
            e.description,
            e.price_per_day,
            e.quantity_available,
            e.location,
            e.avg_rating,
            e.total_reviews,
            e.total_bookings,
            e.created_at,
            c.category_id,
            c.name AS category_name,
            o.business_name AS owner_name,
            o.is_verified AS owner_verified,
            (SELECT image_url FROM EquipmentImage 
             WHERE equipment_id = e.equipment_id AND is_primary = TRUE 
             LIMIT 1) AS primary_image
        FROM Equipment e
        JOIN Category c ON e.category_id = c.category_id
        JOIN Owner o ON e.owner_id = o.owner_id
        WHERE e.is_available = TRUE AND e.is_approved = TRUE
    `;

    const params = [];

    if (category) { sql += ' AND c.name = ?'; params.push(category); }
    if (location) { sql += ' AND e.location = ?'; params.push(location); }
    if (min_price) { sql += ' AND e.price_per_day >= ?'; params.push(Number(min_price)); }
    if (max_price) { sql += ' AND e.price_per_day <= ?'; params.push(Number(max_price)); }
    if (search) { sql += ' AND (e.name LIKE ? OR e.description LIKE ?)'; params.push(`%${search}%`, `%${search}%`); }

    // Sorting
    const sortOptions = {
        'newest': 'e.created_at DESC',
        'price_low': 'e.price_per_day ASC',
        'price_high': 'e.price_per_day DESC',
        'rating': 'e.avg_rating DESC',
        'popular': 'e.total_bookings DESC'
    };
    sql += ` ORDER BY ${sortOptions[sort] || sortOptions.newest}`;

    // Pagination
    const offset = (Number(page) - 1) * Number(limit);
    sql += ' LIMIT ? OFFSET ?';
    params.push(Number(limit), offset);

    try {
        const [rows] = await db.query(sql, params);

        // Get total count for pagination
        let countSql = `
            SELECT COUNT(*) AS total
            FROM Equipment e
            JOIN Category c ON e.category_id = c.category_id
            WHERE e.is_available = TRUE AND e.is_approved = TRUE
        `;
        const countParams = [];
        if (category) { countSql += ' AND c.name = ?'; countParams.push(category); }
        if (location) { countSql += ' AND e.location = ?'; countParams.push(location); }
        if (min_price) { countSql += ' AND e.price_per_day >= ?'; countParams.push(Number(min_price)); }
        if (max_price) { countSql += ' AND e.price_per_day <= ?'; countParams.push(Number(max_price)); }
        if (search) { countSql += ' AND (e.name LIKE ? OR e.description LIKE ?)'; countParams.push(`%${search}%`, `%${search}%`); }

        const [countResult] = await db.query(countSql, countParams);
        const total = countResult[0].total;

        res.json({
            status: 'success',
            total,
            page: Number(page),
            pages: Math.ceil(total / Number(limit)),
            equipment: rows
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ status: 'error', message: 'Failed to fetch equipment' });
    }
});

// ============================================
// GET /api/equipment/my — Get owner's own equipment
// ============================================
router.get('/my', verifyToken, requireRole('owner'), async (req, res) => {
    try {
        const [rows] = await db.query(`
            SELECT 
                e.*,
                c.name AS category_name,
                (SELECT image_url FROM EquipmentImage 
                 WHERE equipment_id = e.equipment_id AND is_primary = TRUE 
                 LIMIT 1) AS primary_image
            FROM Equipment e
            JOIN Category c ON e.category_id = c.category_id
            WHERE e.owner_id = ?
            ORDER BY e.created_at DESC
        `, [req.user.user_id]);

        res.json({ status: 'success', equipment: rows });
    } catch (err) {
        console.error(err);
        res.status(500).json({ status: 'error', message: 'Failed to fetch your equipment' });
    }
});

// ============================================
// GET /api/equipment/:id — Single equipment with images
// ============================================
router.get('/:id', async (req, res) => {
    try {
        const [rows] = await db.query(`
            SELECT 
                e.*,
                c.name AS category_name,
                u.full_name AS owner_full_name,
                u.email AS owner_email,
                u.phone AS owner_phone,
                o.business_name,
                o.is_verified AS owner_verified,
                o.response_rate,
                o.avg_response_time
            FROM Equipment e
            JOIN Category c ON e.category_id = c.category_id
            JOIN Owner o ON e.owner_id = o.owner_id
            JOIN User u ON o.owner_id = u.user_id
            WHERE e.equipment_id = ?
        `, [req.params.id]);

        if (rows.length === 0) {
            return res.status(404).json({ status: 'error', message: 'Equipment not found' });
        }

        // Get all images
        const [images] = await db.query(
            'SELECT image_id, image_url, is_primary, display_order FROM EquipmentImage WHERE equipment_id = ? ORDER BY display_order',
            [req.params.id]
        );

        // Get recent reviews
        const [reviews] = await db.query(`
            SELECT r.review_id, r.rating, r.comment, r.is_recommended, r.created_at,
                   u.full_name AS customer_name
            FROM Review r
            JOIN Customer c ON r.customer_id = c.customer_id
            JOIN User u ON c.customer_id = u.user_id
            WHERE r.equipment_id = ?
            ORDER BY r.created_at DESC
            LIMIT 5
        `, [req.params.id]);

        res.json({
            status: 'success',
            equipment: { ...rows[0], images, recent_reviews: reviews }
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ status: 'error', message: 'Failed to fetch equipment' });
    }
});

// ============================================
// POST /api/equipment — Add new equipment (owner only)
// ============================================
router.post('/', verifyToken, requireRole('owner'), async (req, res) => {
    const {
        category_id, name, description, price_per_day,
        quantity_total, location, rental_conditions
    } = req.body;

    if (!category_id || !name || !price_per_day || !quantity_total || !location) {
        return res.status(400).json({
            status: 'error',
            message: 'Missing required fields: category_id, name, price_per_day, quantity_total, location'
        });
    }

    try {
        const [result] = await db.query(`
            INSERT INTO Equipment 
            (owner_id, category_id, name, description, price_per_day, quantity_total, quantity_available, location, rental_conditions, is_available, is_approved)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, TRUE, FALSE)
        `, [
            req.user.user_id, category_id, name, description || null,
            price_per_day, quantity_total, quantity_total, location,
            rental_conditions || null
        ]);

        res.status(201).json({
            status: 'success',
            message: 'Equipment added successfully. Pending admin approval.',
            equipment_id: result.insertId
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ status: 'error', message: 'Failed to add equipment' });
    }
});

// ============================================
// PUT /api/equipment/:id — Update (owner of that equipment only)
// ============================================
router.put('/:id', verifyToken, requireRole('owner'), async (req, res) => {
    const {
        name, description, price_per_day, quantity_total,
        location, rental_conditions, is_available
    } = req.body;

    try {
        // Verify ownership
        const [existing] = await db.query(
            'SELECT owner_id FROM Equipment WHERE equipment_id = ?',
            [req.params.id]
        );

        if (existing.length === 0) {
            return res.status(404).json({ status: 'error', message: 'Equipment not found' });
        }

        if (existing[0].owner_id !== req.user.user_id) {
            return res.status(403).json({ status: 'error', message: 'Not your equipment' });
        }

        await db.query(`
            UPDATE Equipment SET
                name = COALESCE(?, name),
                description = COALESCE(?, description),
                price_per_day = COALESCE(?, price_per_day),
                quantity_total = COALESCE(?, quantity_total),
                location = COALESCE(?, location),
                rental_conditions = COALESCE(?, rental_conditions),
                is_available = COALESCE(?, is_available)
            WHERE equipment_id = ?
        `, [
            name, description, price_per_day, quantity_total,
            location, rental_conditions, is_available, req.params.id
        ]);

        res.json({ status: 'success', message: 'Equipment updated' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ status: 'error', message: 'Failed to update equipment' });
    }
});

// ============================================
// DELETE /api/equipment/:id — Owner or Admin
// ============================================
router.delete('/:id', verifyToken, async (req, res) => {
    try {
        const [existing] = await db.query(
            'SELECT owner_id FROM Equipment WHERE equipment_id = ?',
            [req.params.id]
        );

        if (existing.length === 0) {
            return res.status(404).json({ status: 'error', message: 'Equipment not found' });
        }

        const isOwner = existing[0].owner_id === req.user.user_id;
        const isAdmin = req.user.role === 'admin';

        if (!isOwner && !isAdmin) {
            return res.status(403).json({ status: 'error', message: 'Access denied' });
        }

        await db.query('DELETE FROM Equipment WHERE equipment_id = ?', [req.params.id]);

        res.json({ status: 'success', message: 'Equipment deleted' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ status: 'error', message: 'Failed to delete equipment' });
    }
});

module.exports = router;