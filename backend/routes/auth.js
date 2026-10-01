const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const db = require('../config/db');
const router = express.Router();
require('dotenv').config();

// ============================================
// GENERATE JWT TOKEN
// ============================================
const generateToken = (user) => {
    return jwt.sign(
        {
            user_id: user.user_id,
            email: user.email,
            role: user.role,
            full_name: user.full_name
        },
        process.env.JWT_SECRET,
        { expiresIn: process.env.JWT_EXPIRES || '7d' }
    );
};

// ============================================
// POST /api/auth/register
// ============================================
router.post('/register', async (req, res) => {
    const { full_name, email, phone, password, role, business_name } = req.body;

    // --- Validate input ---
    if (!full_name || !email || !phone || !password || !role) {
        return res.status(400).json({ 
            status: 'error',
            message: 'Missing required fields: full_name, email, phone, password, role' 
        });
    }

    if (!['customer', 'owner'].includes(role)) {
        return res.status(400).json({ 
            status: 'error',
            message: 'Role must be either customer or owner' 
        });
    }

    if (password.length < 6) {
        return res.status(400).json({ 
            status: 'error',
            message: 'Password must be at least 6 characters' 
        });
    }

    if (role === 'owner' && !business_name) {
        return res.status(400).json({ 
            status: 'error',
            message: 'Business name is required for owners' 
        });
    }

    // --- Check if email or phone exists ---
    try {
        const [existing] = await db.query(
            'SELECT user_id FROM User WHERE email = ? OR phone = ?',
            [email, phone]
        );

        if (existing.length > 0) {
            return res.status(409).json({ 
                status: 'error',
                message: 'Email or phone number already registered' 
            });
        }

        // --- Hash password ---
        const password_hash = await bcrypt.hash(password, 10);

        // --- Insert into User table ---
        const [result] = await db.query(
            `INSERT INTO User (full_name, email, phone, password_hash, role) 
             VALUES (?, ?, ?, ?, ?)`,
            [full_name, email, phone, password_hash, role]
        );

        const user_id = result.insertId;

        // --- Insert into role-specific table ---
        if (role === 'customer') {
            await db.query(
                'INSERT INTO Customer (customer_id, default_location) VALUES (?, ?)',
                [user_id, req.body.default_location || null]
            );
        } else if (role === 'owner') {
            await db.query(
                'INSERT INTO Owner (owner_id, business_name, mpesa_number) VALUES (?, ?, ?)',
                [user_id, business_name, phone]
            );
        }

        // --- Fetch the created user ---
        const [users] = await db.query(
            'SELECT user_id, full_name, email, phone, role, created_at FROM User WHERE user_id = ?',
            [user_id]
        );

        const user = users[0];
        const token = generateToken(user);

        res.status(201).json({
            status: 'success',
            message: 'Registration successful',
            token,
            user
        });

    } catch (err) {
        console.error('Registration error:', err);
        res.status(500).json({ 
            status: 'error',
            message: 'Registration failed. Please try again.' 
        });
    }
});

// ============================================
// POST /api/auth/login
// ============================================
router.post('/login', async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({ 
            status: 'error',
            message: 'Email and password are required' 
        });
    }

    try {
        // --- Find user ---
        const [users] = await db.query(
            `SELECT user_id, full_name, email, phone, password_hash, role, is_active 
             FROM User WHERE email = ?`,
            [email]
        );

        if (users.length === 0) {
            return res.status(401).json({ 
                status: 'error',
                message: 'Invalid email or password' 
            });
        }

        const user = users[0];

        if (!user.is_active) {
            return res.status(403).json({ 
                status: 'error',
                message: 'Account is deactivated. Contact support.' 
            });
        }

        // --- Verify password ---
        const validPassword = await bcrypt.compare(password, user.password_hash);

        if (!validPassword) {
            return res.status(401).json({ 
                status: 'error',
                message: 'Invalid email or password' 
            });
        }

        // --- Generate token ---
        const token = generateToken(user);

        // --- Remove password_hash from response ---
        delete user.password_hash;

        res.json({
            status: 'success',
            message: 'Login successful',
            token,
            user
        });

    } catch (err) {
        console.error('Login error:', err);
        res.status(500).json({ 
            status: 'error',
            message: 'Login failed. Please try again.' 
        });
    }
});

// ============================================
// GET /api/auth/me  (protected)
// ============================================
router.get('/me', require('../middleware/auth').verifyToken, async (req, res) => {
    try {
        const [users] = await db.query(
            'SELECT user_id, full_name, email, phone, role, created_at FROM User WHERE user_id = ?',
            [req.user.user_id]
        );

        if (users.length === 0) {
            return res.status(404).json({ 
                status: 'error',
                message: 'User not found' 
            });
        }

        res.json({
            status: 'success',
            user: users[0]
        });

    } catch (err) {
        console.error('Fetch user error:', err);
        res.status(500).json({ 
            status: 'error',
            message: 'Failed to fetch user' 
        });
    }
});

module.exports = router;