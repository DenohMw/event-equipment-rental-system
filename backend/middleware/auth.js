const jwt = require('jsonwebtoken');
const db = require('../config/db');
require('dotenv').config();

// ============================================
// VERIFY JWT TOKEN
// ============================================
const verifyToken = async (req, res, next) => {
    // Get token from Authorization header
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];  // "Bearer TOKEN"

    if (!token) {
        return res.status(401).json({ 
            status: 'error',
            message: 'No token provided. Please login.' 
        });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const [users] = await db.query('SELECT auth_version FROM User WHERE user_id = ?', [decoded.user_id]);
        if (!users.length || Number(users[0].auth_version) !== Number(decoded.auth_version || 0)) {
            return res.status(401).json({ status: 'error', message: 'Session expired. Please sign in again.' });
        }
        req.user = decoded;  // { user_id, role, email, full_name, auth_version }
        next();
    } catch (err) {
        if (err.name === 'TokenExpiredError') {
            return res.status(401).json({ 
                status: 'error',
                message: 'Token expired. Please login again.' 
            });
        }
        if (err.name === 'JsonWebTokenError') {
            return res.status(403).json({ 
            status: 'error',
            message: 'Invalid token.' 
            });
        }
        console.error('Token validation error:', err.message);
        return res.status(500).json({ status: 'error', message: 'Could not validate session.' });
    }
};

// ============================================
// CHECK USER ROLE
// ============================================
const requireRole = (...allowedRoles) => {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({ 
                status: 'error',
                message: 'Authentication required.' 
            });
        }

        if (!allowedRoles.includes(req.user.role)) {
            return res.status(403).json({ 
                status: 'error',
                message: `Access denied. Required role: ${allowedRoles.join(' or ')}` 
            });
        }

        next();
    };
};

module.exports = { verifyToken, requireRole };
