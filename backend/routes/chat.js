const express = require('express');
const db = require('../config/db');
const { verifyToken } = require('../middleware/auth');
const router = express.Router();

// ============================================
// GET /api/chat/conversations
// List all conversations for the current user
// ============================================
router.get('/conversations', verifyToken, async (req, res) => {
    const userId = req.user.user_id;

    try {
        // Get the latest message per conversation partner
        const [rows] = await db.query(`
            SELECT 
                other_user_id,
                other_user_name,
                other_user_role,
                other_user_photo,
                message_text AS last_message,
                sent_at AS last_message_time,
                is_read AS last_message_read,
                (
                    SELECT COUNT(*) FROM Message 
                    WHERE sender_id = other_user_id 
                      AND receiver_id = ? 
                      AND is_read = FALSE
                ) AS unread_count
            FROM (
                SELECT 
                    CASE 
                        WHEN m.sender_id = ? THEN m.receiver_id
                        ELSE m.sender_id
                    END AS other_user_id,
                    u.full_name AS other_user_name,
                    u.role AS other_user_role,
                    u.profile_photo AS other_user_photo,
                    m.message_text,
                    m.sent_at,
                    m.is_read,
                    ROW_NUMBER() OVER (
                        PARTITION BY CASE 
                            WHEN m.sender_id = ? THEN m.receiver_id
                            ELSE m.sender_id
                        END
                        ORDER BY m.sent_at DESC
                    ) AS rn
                FROM Message m
                JOIN User u ON u.user_id = CASE 
                    WHEN m.sender_id = ? THEN m.receiver_id
                    ELSE m.sender_id
                END
                WHERE m.sender_id = ? OR m.receiver_id = ?
            ) AS latest
            WHERE rn = 1
            ORDER BY sent_at DESC
        `, [userId, userId, userId, userId, userId, userId]);

        res.json({ status: 'success', conversations: rows });
    } catch (err) {
        console.error('Conversations error:', err);
        res.status(500).json({ status: 'error', message: 'Failed to load conversations' });
    }
});

// ============================================
// GET /api/chat/history/:otherUserId
// Get full message history with another user
// ============================================

if (!otherUserId || isNaN(otherUserId) || otherUserId <= 0) {
    return res.status(400).json({ status: 'error', message: 'Invalid user ID' });
}

router.get('/history/:otherUserId', verifyToken, async (req, res) => {
    const userId = req.user.user_id;
    const otherUserId = Number(req.params.otherUserId);
    const limit = Math.min(Number(req.query.limit) || 50, 100);
    const offset = Number(req.query.offset) || 0;

    try {
        // Verify the other user exists
        const [otherUsers] = await db.query(
            'SELECT user_id, full_name, role, profile_photo FROM User WHERE user_id = ?',
            [otherUserId]
        );

        if (otherUsers.length === 0) {
            return res.status(404).json({ status: 'error', message: 'User not found' });
        }

        // Get messages between the two users
        const [messages] = await db.query(`
            SELECT 
                m.message_id,
                m.sender_id,
                m.receiver_id,
                m.equipment_id,
                m.booking_id,
                m.message_text,
                m.is_read,
                m.read_at,
                m.sent_at,
                u.full_name AS sender_name
            FROM Message m
            JOIN User u ON u.user_id = m.sender_id
            WHERE (m.sender_id = ? AND m.receiver_id = ?)
               OR (m.sender_id = ? AND m.receiver_id = ?)
            ORDER BY m.sent_at DESC
            LIMIT ? OFFSET ?
        `, [userId, otherUserId, otherUserId, userId, limit, offset]);

        // Reverse to chronological order
        messages.reverse();

        // Mark unread messages as read
        await db.query(`
            UPDATE Message 
            SET is_read = TRUE, read_at = NOW()
            WHERE sender_id = ? AND receiver_id = ? AND is_read = FALSE
        `, [otherUserId, userId]);

        res.json({
            status: 'success',
            other_user: otherUsers[0],
            messages,
            count: messages.length
        });
    } catch (err) {
        console.error('History error:', err);
        res.status(500).json({ status: 'error', message: 'Failed to load message history' });
    }
});

// ============================================
// GET /api/chat/unread-count
// Total unread messages for current user
// ============================================
router.get('/unread-count', verifyToken, async (req, res) => {
    try {
        const [rows] = await db.query(
            'SELECT COUNT(*) AS unread FROM Message WHERE receiver_id = ? AND is_read = FALSE',
            [req.user.user_id]
        );

        res.json({ status: 'success', unread: rows[0].unread });
    } catch (err) {
        console.error('Unread count error:', err);
        res.status(500).json({ status: 'error', message: 'Failed to get unread count' });
    }
});

// ============================================
// POST /api/chat/send (REST fallback)
// Send a message without Socket.io
// ============================================
router.post('/send', verifyToken, async (req, res) => {
    const { receiver_id, message_text, equipment_id, booking_id } = req.body;

    if (!receiver_id || !message_text?.trim()) {
        return res.status(400).json({
            status: 'error',
            message: 'Required: receiver_id, message_text'
        });
    }

    try {
        // Verify the receiver exists
        const [otherUsers] = await db.query(
            'SELECT user_id FROM User WHERE user_id = ?',
            [receiver_id]
        );

        if (otherUsers.length === 0) {
            return res.status(404).json({ status: 'error', message: 'Receiver not found' });
        }

        // Insert message
        const [result] = await db.query(
            `INSERT INTO Message (sender_id, receiver_id, equipment_id, booking_id, message_text)
             VALUES (?, ?, ?, ?, ?)`,
            [req.user.user_id, receiver_id, equipment_id || null, booking_id || null, message_text.trim()]
        );

        // Emit to Socket.io if the io instance is available
        const io = req.app.get('io');
        if (io) {
            const roomId = `chat_${[req.user.user_id, receiver_id].sort((a, b) => a - b).join('_')}`;
            io.to(roomId).emit('receive_message', {
                message_id: result.insertId,
                sender_id: req.user.user_id,
                receiver_id: Number(receiver_id),
                message_text: message_text.trim(),
                equipment_id: equipment_id || null,
                booking_id: booking_id || null,
                is_read: false,
                sent_at: new Date().toISOString()
            });
        }

        res.status(201).json({
            status: 'success',
            message_id: result.insertId
        });
    } catch (err) {
        console.error('Send message error:', err);
        res.status(500).json({ status: 'error', message: 'Failed to send message' });
    }
});

module.exports = router;