const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('../config/db');
const { verifyToken, requireRole } = require('../middleware/auth');
const router = express.Router();

const equipmentUploadDir = path.join(__dirname, '..', 'uploads', 'equipment');
fs.mkdirSync(equipmentUploadDir, { recursive: true });
const equipmentImageUpload = multer({
    storage: multer.diskStorage({
        destination: equipmentUploadDir,
        filename: (req, file, callback) => {
            const extension = path.extname(file.originalname).toLowerCase();
            callback(null, `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${extension}`);
        }
    }),
    limits: { fileSize: 5 * 1024 * 1024, files: 5 },
    fileFilter: (req, file, callback) => {
        if (!file.mimetype || !file.mimetype.startsWith('image/')) {
            return callback(new Error('Only image files are allowed'));
        }
        callback(null, true);
    }
});

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
// GET /api/equipment/locations
// List all active Kenyan locations, grouped by region
// ============================================
router.get('/locations', async (req, res) => {
    try {
        const [rows] = await db.query(`
            SELECT location_id, name, county, region 
            FROM Location 
            WHERE is_active = TRUE 
            ORDER BY region, county, name
        `);

        // Group by region for easier dropdown rendering
        const grouped = {};
        rows.forEach(function (loc) {
            if (!grouped[loc.region]) {
                grouped[loc.region] = [];
            }
            grouped[loc.region].push({
                location_id: loc.location_id,
                name: loc.name,
                county: loc.county
            });
        });

        res.json({
            status: 'success',
            total: rows.length,
            locations: rows,
            grouped: grouped
        });
    } catch (err) {
        console.error('Locations error:', err);
        res.status(500).json({
            status: 'error',
            message: 'Failed to fetch locations'
        });
    }
});

// ============================================
// GET /api/equipment — List equipment with filters
// ============================================
router.get('/', async (req, res) => {
    const {
        category, location, region, county, min_price, max_price, search,
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
    if (region) {
        sql += ' AND e.location IN (SELECT name FROM Location WHERE is_active = TRUE AND region = ?)';
        params.push(region);
    }
    if (county) {
        sql += ' AND e.location IN (SELECT name FROM Location WHERE is_active = TRUE AND county = ?)';
        params.push(county);
    }
    if (min_price) { sql += ' AND e.price_per_day >= ?'; params.push(Number(min_price)); }
    if (max_price) { sql += ' AND e.price_per_day <= ?'; params.push(Number(max_price)); }
    if (search) { sql += ' AND (e.name LIKE ? OR e.description LIKE ?)'; params.push(`%${search}%`, `%${search}%`); }

    const sortOptions = {
        'newest': 'e.created_at DESC',
        'price_low': 'e.price_per_day ASC',
        'price_high': 'e.price_per_day DESC',
        'rating': 'e.avg_rating DESC',
        'popular': 'e.total_bookings DESC'
    };
    sql += ` ORDER BY ${sortOptions[sort] || sortOptions.newest}`;

    const offset = (Number(page) - 1) * Number(limit);
    sql += ' LIMIT ? OFFSET ?';
    params.push(Number(limit), offset);

    try {
        const [rows] = await db.query(sql, params);

        let countSql = `
            SELECT COUNT(*) AS total
            FROM Equipment e
            JOIN Category c ON e.category_id = c.category_id
            WHERE e.is_available = TRUE AND e.is_approved = TRUE
        `;
        const countParams = [];
        if (category) { countSql += ' AND c.name = ?'; countParams.push(category); }
        if (location) { countSql += ' AND e.location = ?'; countParams.push(location); }
        if (region) {
            countSql += ' AND e.location IN (SELECT name FROM Location WHERE is_active = TRUE AND region = ?)';
            countParams.push(region);
        }
        if (county) {
            countSql += ' AND e.location IN (SELECT name FROM Location WHERE is_active = TRUE AND county = ?)';
            countParams.push(county);
        }
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

        const [images] = await db.query(
            'SELECT image_id, image_url, is_primary, display_order FROM EquipmentImage WHERE equipment_id = ? ORDER BY display_order',
            [req.params.id]
        );

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
router.post('/', verifyToken, requireRole('owner'), equipmentImageUpload.array('images', 5), async (req, res) => {
    const {
        category_id, name, description, price_per_day,
        quantity_total, location, rental_conditions
    } = req.body;

    if (!category_id || !name || !price_per_day || !quantity_total || !location) {
        for (const file of req.files || []) fs.unlink(file.path, () => {});
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
            Number(price_per_day), Number(quantity_total), Number(quantity_total),
            location, rental_conditions || null
        ]);

        const files = req.files || [];
        if (files.length) {
            const connection = await db.getConnection();
            try {
                await connection.beginTransaction();
                for (let index = 0; index < files.length; index++) {
                    await connection.query(
                        `INSERT INTO EquipmentImage (equipment_id, image_url, is_primary, display_order)
                         VALUES (?, ?, ?, ?)`,
                        [result.insertId, `/uploads/equipment/${files[index].filename}`, index === 0, index]
                    );
                }
                await connection.commit();
            } catch (imageError) {
                await connection.rollback();
                await db.query('DELETE FROM Equipment WHERE equipment_id = ?', [result.insertId]);
                throw imageError;
            } finally {
                connection.release();
            }
        }

        res.status(201).json({
            status: 'success',
            message: 'Equipment added successfully. Pending admin approval.',
            equipment_id: result.insertId
        });
    } catch (err) {
        for (const file of req.files || []) {
            fs.unlink(file.path, () => {});
        }
        console.error(err);
        res.status(500).json({ status: 'error', message: 'Failed to add equipment' });
    }
});

// ============================================
// PUT /api/equipment/:id — Update (owner only)
// Builds the UPDATE dynamically and recalculates quantity_available
// whenever quantity_total changes.
// ============================================
router.put('/:id', verifyToken, requireRole('owner'), async (req, res) => {
    const {
        name, description, price_per_day, quantity_total,
        location, rental_conditions, is_available
    } = req.body;

    try {
        // 1. Verify ownership
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

        // 2. Build the update dynamically
        const updates = [];
        const params = [];
        let quantityChanged = false;

        if (name !== undefined && name !== null && String(name).trim() !== '') {
            updates.push('name = ?');
            params.push(String(name).trim());
        }

        if (description !== undefined && description !== null) {
            updates.push('description = ?');
            const desc = String(description).trim();
            params.push(desc === '' ? null : desc);
        }

        if (price_per_day !== undefined && price_per_day !== null && price_per_day !== '') {
            const price = Number(price_per_day);
            if (isNaN(price) || price < 0) {
                return res.status(400).json({ status: 'error', message: 'Invalid price_per_day' });
            }
            updates.push('price_per_day = ?');
            params.push(price);
        }

        if (quantity_total !== undefined && quantity_total !== null && quantity_total !== '') {
            const qty = Number(quantity_total);
            if (isNaN(qty) || qty < 1) {
                return res.status(400).json({ status: 'error', message: 'Invalid quantity_total' });
            }
            updates.push('quantity_total = ?');
            params.push(qty);
            quantityChanged = true;
        }

        if (location !== undefined && location !== null && String(location).trim() !== '') {
            updates.push('location = ?');
            params.push(String(location).trim());
        }

        if (rental_conditions !== undefined && rental_conditions !== null) {
            updates.push('rental_conditions = ?');
            const cond = String(rental_conditions).trim();
            params.push(cond === '' ? null : cond);
        }

        if (is_available !== undefined && is_available !== null) {
            updates.push('is_available = ?');
            params.push(is_available ? 1 : 0);
        }

        if (updates.length === 0) {
            return res.status(400).json({
                status: 'error',
                message: 'No fields provided for update'
            });
        }

        // 3. If quantity_total is being reduced, ensure it does not
        // fall below the number of currently booked units.
        if (quantityChanged) {
            const [booked] = await db.query(`
                SELECT COALESCE(SUM(quantity), 0) AS booked
                FROM Booking
                WHERE equipment_id = ?
                  AND status IN ('confirmed','paid','delivered','rented')
            `, [req.params.id]);

            const bookedQty = Number(booked[0].booked);
            const newTotal = Number(quantity_total);

            if (bookedQty > newTotal) {
                return res.status(400).json({
                    status: 'error',
                    message: `Cannot reduce total below ${bookedQty} units. That many are currently reserved by active bookings.`
                });
            }
        }

        // 4. Run the update
        params.push(req.params.id);

        await db.query(
            'UPDATE Equipment SET ' + updates.join(', ') + ' WHERE equipment_id = ?',
            params
        );

        // 5. Recalculate quantity_available if quantity_total changed
        if (quantityChanged) {
            await db.query(`
                UPDATE Equipment e
                SET quantity_available = GREATEST(0, e.quantity_total - COALESCE(
                    (SELECT SUM(b.quantity)
                     FROM Booking b
                     WHERE b.equipment_id = e.equipment_id
                       AND b.status IN ('confirmed','paid','delivered','rented')),
                    0
                ))
                WHERE e.equipment_id = ?
            `, [req.params.id]);
        }

        // 6. Return the fresh row
        const [updated] = await db.query(
            'SELECT equipment_id, name, description, price_per_day, quantity_total, quantity_available, location, rental_conditions, is_available FROM Equipment WHERE equipment_id = ?',
            [req.params.id]
        );

        res.json({
            status: 'success',
            message: 'Equipment updated',
            equipment: updated[0]
        });

    } catch (err) {
        console.error('Equipment update error:', err);
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
