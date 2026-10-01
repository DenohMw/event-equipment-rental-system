const jwt = require('jsonwebtoken');
require('dotenv').config();

// ============================================
// VERIFY JWT TOKEN
// ============================================
const verifyToken = (req, res, next) => {
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
        req.user = decoded;  // { user_id, role, email, full_name }
        next();
    } catch (err) {
        if (err.name === 'TokenExpiredError') {
            return res.status(401).json({ 
                status: 'error',
                message: 'Token expired. Please login again.' 
            });
        }
        return res.status(403).json({ 
            status: 'error',
            message: 'Invalid token.' 
        });
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