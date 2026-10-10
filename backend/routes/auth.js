const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const axios = require('axios');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('../config/db');
const { verifyToken } = require('../middleware/auth');
const router = express.Router();
require('dotenv').config();
const TERMS_VERSION = '2026-10-08';

const profileUploadDir = path.join(__dirname, '..', 'uploads', 'profiles');
fs.mkdirSync(profileUploadDir, { recursive: true });
const profileImageUpload = multer({
    storage: multer.diskStorage({
        destination: profileUploadDir,
        filename: (req, file, callback) => {
            const ext = path.extname(file.originalname).toLowerCase();
            callback(null, `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`);
        }
    }),
    limits: { fileSize: 5 * 1024 * 1024, files: 1 },
    fileFilter: (req, file, callback) => {
        const allowed = new Set(['.jpg', '.jpeg', '.png', '.webp']);
        const ext = path.extname(file.originalname).toLowerCase();
        if (!allowed.has(ext) || !['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) {
            return callback(new Error('Profile photo must be a JPG, PNG, or WEBP image'));
        }
        callback(null, true);
    }
});

// ============================================
// GENERATE JWT TOKEN
// ============================================
const generateToken = (user) => {
    return jwt.sign(
        {
            user_id: user.user_id,
            email: user.email,
            role: user.role,
            full_name: user.full_name,
            auth_version: Number(user.auth_version || 0)
        },
        process.env.JWT_SECRET,
        { expiresIn: process.env.JWT_EXPIRES || '7d' }
    );
};

// ============================================
// POST /api/auth/register
// ============================================
router.post('/register', async (req, res) => {
    const { full_name, email, phone, password, role, business_name, accept_terms } = req.body;

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

    if (password.length < 8) {
        return res.status(400).json({ 
            status: 'error',
            message: 'Password must be at least 8 characters' 
        });
    }

    if (accept_terms !== true && accept_terms !== 'true') {
        return res.status(400).json({ status: 'error', message: 'You must accept the Terms and Conditions to register' });
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

        const connection = await db.getConnection();
        let user_id;
        try {
            await connection.beginTransaction();
            const [result] = await connection.query(
                `INSERT INTO User (full_name, email, phone, password_hash, role)
                 VALUES (?, ?, ?, ?, ?)`,
                [full_name.trim(), email.trim().toLowerCase(), phone.trim(), password_hash, role]
            );
            user_id = result.insertId;

            if (role === 'customer') {
                await connection.query(
                    'INSERT INTO Customer (customer_id, default_location) VALUES (?, ?)',
                    [user_id, req.body.default_location || null]
                );
            } else if (role === 'owner') {
                await connection.query(
                    'INSERT INTO Owner (owner_id, business_name, mpesa_number) VALUES (?, ?, ?)',
                    [user_id, business_name.trim(), phone.trim()]
                );
            }

            await connection.query(
                'INSERT INTO TermsAcceptance (user_id, terms_version, ip_address, user_agent) VALUES (?, ?, ?, ?)',
                [user_id, TERMS_VERSION, req.ip || null, String(req.get('user-agent') || '').slice(0, 255) || null]
            );
            await connection.commit();
        } catch (insertError) {
            await connection.rollback();
            throw insertError;
        } finally {
            connection.release();
        }

        // --- Fetch the created user ---
        const [users] = await db.query(
            `SELECT u.user_id, u.full_name, u.email, u.phone, u.profile_photo, u.role, u.auth_version, u.created_at,
                    o.business_name
             FROM User u LEFT JOIN Owner o ON o.owner_id = u.user_id
             WHERE u.user_id = ?`,
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
            `SELECT u.user_id, u.full_name, u.email, u.phone, u.profile_photo,
                    u.password_hash, u.role, u.is_active, u.auth_version, o.business_name
             FROM User u LEFT JOIN Owner o ON o.owner_id = u.user_id
             WHERE u.email = ?`,
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
// Password recovery. Configure Africa's Talking SMS, or enable local console delivery.
// ============================================
const resetSmsDevMode = () => process.env.NODE_ENV !== 'production' && process.env.PASSWORD_RESET_DEV_MODE === 'true';
const resetSmsEnabled = () => Boolean(process.env.JWT_SECRET && (
    (process.env.AT_API_KEY && process.env.AT_USERNAME) || resetSmsDevMode()
));
const normalizeResetPhone = (value) => {
    const digits = String(value || '').replace(/\D/g, '');
    if (/^0[17]\d{8}$/.test(digits)) return { international: `254${digits.slice(1)}`, local: digits };
    if (/^254[17]\d{8}$/.test(digits)) return { international: digits, local: `0${digits.slice(3)}` };
    return null;
};
const hashResetOtp = (userId, otp) => crypto.createHmac('sha256', process.env.JWT_SECRET)
    .update(`${userId}:${otp}`).digest('hex');

router.get('/password-reset/status', (req, res) => {
    res.json({
        status: 'success',
        enabled: resetSmsEnabled()
    });
});

router.post('/forgot-password', async (req, res) => {
    const phone = normalizeResetPhone(req.body.phone);
    if (!phone) {
        return res.status(400).json({ status: 'error', message: 'Enter a valid phone number' });
    }
    if (!resetSmsEnabled()) {
        return res.status(503).json({
            status: 'error',
            message: 'Password recovery is temporarily unavailable. Please try again later.'
        });
    }

    try {
        const [users] = await db.query('SELECT user_id, phone FROM User WHERE phone IN (?, ?, ?) AND is_active = TRUE', [phone.international, phone.local, `+${phone.international}`]);
        if (!users.length) {
            return res.json({
                status: 'success',
                message: 'If an active account exists for that phone number, a verification code will be sent.'
            });
        }

        const [[recentRequests]] = await db.query(
            'SELECT COUNT(*) AS total FROM PasswordResetToken WHERE user_id = ? AND created_at > DATE_SUB(NOW(), INTERVAL 1 HOUR)',
            [users[0].user_id]
        );
        if (recentRequests.total >= 3) {
            return res.json({
                status: 'success',
                message: 'If an active account exists for that phone number, a verification code will be sent.'
            });
        }

        const otp = crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');
        const tokenHash = hashResetOtp(users[0].user_id, otp);
        await db.query('UPDATE PasswordResetToken SET used_at = NOW() WHERE user_id = ? AND used_at IS NULL', [users[0].user_id]);
        await db.query(
            'INSERT INTO PasswordResetToken (user_id, token_hash, expires_at) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 10 MINUTE))',
            [users[0].user_id, tokenHash]
        );
        await db.query('DELETE FROM PasswordResetToken WHERE expires_at < DATE_SUB(NOW(), INTERVAL 1 DAY)');

        try {
            if (resetSmsDevMode() && !(process.env.AT_API_KEY && process.env.AT_USERNAME)) {
                console.info(`[password-reset-dev] Verification code: ${otp}`);
            } else {
                const smsBody = new URLSearchParams({
                    username: process.env.AT_USERNAME,
                    to: `+${phone.international}`,
                    message: `Your EventEquip password reset code is ${otp}. It expires in 10 minutes and can be used once.`
                });
                if (process.env.AT_SENDER_ID) smsBody.set('from', process.env.AT_SENDER_ID);
                await axios.post(process.env.AT_ENV === 'sandbox'
                    ? 'https://api.sandbox.africastalking.com/version1/messaging'
                    : 'https://api.africastalking.com/version1/messaging', smsBody.toString(), {
                    headers: { apiKey: process.env.AT_API_KEY, Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
                    timeout: 10000
                });
            }
        } catch (mailError) {
            await db.query('UPDATE PasswordResetToken SET used_at = NOW() WHERE token_hash = ?', [tokenHash]);
            const providerMessage = mailError.response?.data?.SMSMessageData?.Message || mailError.message;
            console.error('Password reset SMS delivery failed:', providerMessage);
            return res.status(503).json({
                status: 'error',
                message: 'We could not send a verification code right now. Please try again later.'
            });
        }

        res.json({
            status: 'success',
            message: resetSmsDevMode() && !(process.env.AT_API_KEY && process.env.AT_USERNAME)
                ? 'If an active account exists, a verification code is ready. Check the backend server console.'
                : 'If an active account exists for that phone number, a verification code will be sent.'
        });
    } catch (err) {
        console.error('Forgot password error:', err.message);
        res.status(500).json({ status: 'error', message: 'Could not process the reset request. Please try again.' });
    }
});

router.post('/verify-password-reset-code', async (req, res) => {
    const phone = normalizeResetPhone(req.body.phone);
    const otp = String(req.body.otp || '').trim();
    if (!phone || !/^\d{6}$/.test(otp)) {
        return res.status(400).json({ status: 'error', message: 'Enter the phone number and six-digit code.' });
    }

    let connection;
    try {
        const [users] = await db.query('SELECT user_id FROM User WHERE phone IN (?, ?, ?) AND is_active = TRUE LIMIT 1', [phone.international, phone.local, `+${phone.international}`]);
        if (!users.length) return res.status(400).json({ status: 'error', message: 'The code is invalid, expired, or has too many attempts. Request a new code.' });
        const userId = users[0].user_id;
        connection = await db.getConnection();
        await connection.beginTransaction();
        const [tokens] = await connection.query(
            'SELECT reset_id, token_hash, attempts FROM PasswordResetToken WHERE user_id = ? AND used_at IS NULL AND expires_at > NOW() ORDER BY created_at DESC LIMIT 1 FOR UPDATE',
            [userId]
        );
        if (!tokens.length || tokens[0].attempts >= 5) {
            await connection.rollback();
            return res.status(400).json({ status: 'error', message: 'The code is invalid, expired, or has too many attempts. Request a new code.' });
        }

        const expectedHash = Buffer.from(tokens[0].token_hash, 'hex');
        const submittedHash = Buffer.from(hashResetOtp(userId, otp), 'hex');
        if (expectedHash.length !== submittedHash.length || !crypto.timingSafeEqual(expectedHash, submittedHash)) {
            const attempts = tokens[0].attempts + 1;
            await connection.query('UPDATE PasswordResetToken SET attempts = ?, used_at = IF(? >= 5, NOW(), used_at) WHERE reset_id = ?', [attempts, attempts, tokens[0].reset_id]);
            await connection.commit();
            return res.status(400).json({ status: 'error', message: 'The code is invalid, expired, or has too many attempts. Request a new code.' });
        }

        await connection.commit();
        res.json({ status: 'success', message: 'Code verified. Choose a new password.' });
    } catch (err) {
        if (connection) await connection.rollback();
        console.error('Verify password reset code error:', err.message);
        res.status(500).json({ status: 'error', message: 'Could not verify the code. Please try again.' });
    } finally {
        if (connection) connection.release();
    }
});

router.post('/reset-password', async (req, res) => {
    const phone = normalizeResetPhone(req.body.phone);
    const otp = String(req.body.otp || '').trim();
    const password = String(req.body.password || '');
    if (!phone || !/^\d{6}$/.test(otp)) {
        return res.status(400).json({ status: 'error', message: 'Enter the phone number and six-digit code from your reset SMS.' });
    }
    if (password.length < 8) {
        return res.status(400).json({ status: 'error', message: 'Password must be at least 8 characters' });
    }

    let connection;
    try {
        const [users] = await db.query('SELECT user_id FROM User WHERE phone IN (?, ?, ?) AND is_active = TRUE LIMIT 1', [phone.international, phone.local, `+${phone.international}`]);
        if (!users.length) return res.status(400).json({ status: 'error', message: 'The code is invalid, expired, or has too many attempts. Request a new code.' });
        const userId = users[0].user_id;
        connection = await db.getConnection();
        await connection.beginTransaction();
        const [tokens] = await connection.query(
            'SELECT reset_id, user_id, token_hash, attempts FROM PasswordResetToken WHERE user_id = ? AND used_at IS NULL AND expires_at > NOW() ORDER BY created_at DESC LIMIT 1 FOR UPDATE',
            [userId]
        );
        if (!tokens.length) {
            await connection.rollback();
            return res.status(400).json({ status: 'error', message: 'The code is invalid, expired, or has too many attempts. Request a new code.' });
        }

        if (tokens[0].attempts >= 5) {
            await connection.query('UPDATE PasswordResetToken SET used_at = NOW() WHERE reset_id = ?', [tokens[0].reset_id]);
            await connection.commit();
            return res.status(400).json({ status: 'error', message: 'The code is invalid, expired, or has too many attempts. Request a new code.' });
        }
        const expectedHash = Buffer.from(tokens[0].token_hash, 'hex');
        const submittedHash = Buffer.from(hashResetOtp(userId, otp), 'hex');
        if (expectedHash.length !== submittedHash.length || !crypto.timingSafeEqual(expectedHash, submittedHash)) {
            const attempts = tokens[0].attempts + 1;
            await connection.query('UPDATE PasswordResetToken SET attempts = ?, used_at = IF(? >= 5, NOW(), used_at) WHERE reset_id = ?', [attempts, attempts, tokens[0].reset_id]);
            await connection.commit();
            return res.status(400).json({ status: 'error', message: 'The code is invalid, expired, or has too many attempts. Request a new code.' });
        }

        const passwordHash = await bcrypt.hash(password, 10);
        await connection.query('UPDATE User SET password_hash = ?, auth_version = auth_version + 1 WHERE user_id = ?', [passwordHash, userId]);
        await connection.query('UPDATE PasswordResetToken SET used_at = NOW() WHERE user_id = ? AND used_at IS NULL', [userId]);
        await connection.commit();
        res.json({ status: 'success', message: 'Password reset. You can now sign in with your new password.' });
    } catch (err) {
        if (connection) await connection.rollback();
        console.error('Reset password error:', err.message);
        res.status(500).json({ status: 'error', message: 'Could not reset the password. Please try again.' });
    } finally {
        if (connection) connection.release();
    }
});

// ============================================
// GET /api/auth/me  (protected)
// ============================================
router.get('/me', require('../middleware/auth').verifyToken, async (req, res) => {
    try {
        const [users] = await db.query(
            `SELECT u.user_id, u.full_name, u.email, u.phone, u.role, u.profile_photo, u.auth_version, u.created_at,
                    o.business_name
             FROM User u LEFT JOIN Owner o ON o.owner_id = u.user_id
             WHERE u.user_id = ?`,
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

// ============================================
// PUT /api/auth/me — Update the signed-in user's profile
// ============================================
router.put('/me', verifyToken, profileImageUpload.single('profile_photo'), async (req, res) => {
    const { full_name, email, phone, business_name, remove_photo } = req.body;
    const uploadedFile = req.file;
    const cleanName = String(full_name || '').trim();
    const cleanEmail = String(email || '').trim().toLowerCase();
    const cleanPhone = String(phone || '').trim();
    const cleanBusinessName = String(business_name || '').trim();

    if (cleanName.length < 2 || !cleanEmail || !cleanPhone) {
        if (uploadedFile) fs.unlink(uploadedFile.path, () => {});
        return res.status(400).json({ status: 'error', message: 'Name, email, and phone are required' });
    }
    if (!/^\S+@\S+\.\S+$/.test(cleanEmail)) {
        if (uploadedFile) fs.unlink(uploadedFile.path, () => {});
        return res.status(400).json({ status: 'error', message: 'Enter a valid email address' });
    }
    if (!/^(?:254|0)(?:7|1)\d{8}$/.test(cleanPhone)) {
        if (uploadedFile) fs.unlink(uploadedFile.path, () => {});
        return res.status(400).json({ status: 'error', message: 'Enter a valid Kenyan phone number' });
    }
    if (req.user.role === 'owner' && cleanBusinessName.length < 2) {
        if (uploadedFile) fs.unlink(uploadedFile.path, () => {});
        return res.status(400).json({ status: 'error', message: 'Business name is required for owners' });
    }

    try {
        const [conflicts] = await db.query(
            'SELECT user_id FROM User WHERE (email = ? OR phone = ?) AND user_id <> ? LIMIT 1',
            [cleanEmail, cleanPhone, req.user.user_id]
        );
        if (conflicts.length) {
            if (uploadedFile) fs.unlink(uploadedFile.path, () => {});
            return res.status(409).json({ status: 'error', message: 'Email or phone number is already used by another account' });
        }

        const [currentRows] = await db.query(
            'SELECT profile_photo FROM User WHERE user_id = ?', [req.user.user_id]
        );
        if (!currentRows.length) {
            if (uploadedFile) fs.unlink(uploadedFile.path, () => {});
            return res.status(404).json({ status: 'error', message: 'User not found' });
        }

        const oldPhoto = currentRows[0].profile_photo;
        const nextPhoto = uploadedFile
            ? `/uploads/profiles/${uploadedFile.filename}`
            : (String(remove_photo) === 'true' ? null : oldPhoto);
        let profileCommitted = false;
        const connection = await db.getConnection();
        try {
            await connection.beginTransaction();
            await connection.query(
                'UPDATE User SET full_name = ?, email = ?, phone = ?, profile_photo = ? WHERE user_id = ?',
                [cleanName, cleanEmail, cleanPhone, nextPhoto, req.user.user_id]
            );
            if (req.user.role === 'owner') {
                await connection.query(
                    'UPDATE Owner SET business_name = ? WHERE owner_id = ?',
                    [cleanBusinessName, req.user.user_id]
                );
            }
            await connection.commit();
            profileCommitted = true;
        } catch (updateError) {
            await connection.rollback();
            throw updateError;
        } finally {
            connection.release();
        }

        if (oldPhoto && oldPhoto !== nextPhoto && oldPhoto.startsWith('/uploads/profiles/')) {
            fs.unlink(path.join(__dirname, '..', oldPhoto.slice(1)), () => {});
        }

        const [users] = await db.query(
            `SELECT u.user_id, u.full_name, u.email, u.phone, u.role, u.profile_photo, u.created_at,
                    o.business_name
             FROM User u LEFT JOIN Owner o ON o.owner_id = u.user_id
             WHERE u.user_id = ?`,
            [req.user.user_id]
        );
        res.json({
            status: 'success',
            message: 'Profile updated successfully',
            token: generateToken(users[0]),
            user: users[0]
        });
    } catch (err) {
        if (uploadedFile && !profileCommitted) fs.unlink(uploadedFile.path, () => {});
        console.error('Update profile error:', err);
        if (err.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({ status: 'error', message: 'Email or phone number is already in use' });
        }
        res.status(500).json({ status: 'error', message: 'Failed to update profile' });
    }
});

module.exports = router;
