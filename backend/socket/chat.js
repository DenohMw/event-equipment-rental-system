const jwt = require('jsonwebtoken');
const db = require('../config/db');
require('dotenv').config();

// ============================================
// Get room ID for a conversation between two users
// Sorts IDs so both sides compute the same room name
// ============================================
function getRoomId(userId1, userId2) {
    const sorted = [Number(userId1), Number(userId2)].sort((a, b) => a - b);
    return `chat_${sorted[0]}_${sorted[1]}`;
}

// ============================================
// Socket.io handler
// ============================================
module.exports = (io) => {

    // ----------------------------------------
    // AUTHENTICATION MIDDLEWARE
    // Runs before a socket connection is accepted
    // ----------------------------------------
    io.use((socket, next) => {
        const token = socket.handshake.auth?.token;

        if (!token) {
            return next(new Error('No token provided'));
        }

        try {
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            socket.user = decoded;  // { user_id, email, role, full_name }
            next();
        } catch (err) {
            return next(new Error('Invalid token'));
        }
    });

    // ----------------------------------------
    // CONNECTION HANDLER
    // ----------------------------------------
    io.on('connection', (socket) => {
        const userId = socket.user.user_id;
        console.log(`🔌 User connected: ${userId} (${socket.user.full_name})`);

        // Join personal room for direct notifications
        socket.join(`user_${userId}`);

        // ----------------------------------------
        // JOIN A CONVERSATION ROOM
        // ----------------------------------------
        socket.on('join_room', async ({ other_user_id }) => {
            if (!other_user_id) {
                return socket.emit('error', { message: 'other_user_id required' });
            }

            const roomId = getRoomId(userId, other_user_id);
            socket.join(roomId);
            console.log(`User ${userId} joined room ${roomId}`);

            // Mark all messages from other_user as read
            try {
                await db.query(
                    `UPDATE Message 
                     SET is_read = TRUE, read_at = NOW()
                     WHERE sender_id = ? AND receiver_id = ? AND is_read = FALSE`,
                    [other_user_id, userId]
                );
            } catch (err) {
                console.error('Error marking messages as read:', err);
            }

            // Notify the room that this user is active
            io.to(roomId).emit('user_active', {
                user_id: userId,
                full_name: socket.user.full_name
            });
        });

        // ----------------------------------------
        // SEND A MESSAGE
        // ----------------------------------------
        socket.on('send_message', async (data) => {
            const { receiver_id, equipment_id, booking_id, message_text } = data;

            if (!receiver_id || !message_text || !message_text.trim()) {
                return socket.emit('error', { message: 'receiver_id and message_text required' });
            }

            try {
                // Save to database
                const [result] = await db.query(
                    `INSERT INTO Message (sender_id, receiver_id, equipment_id, booking_id, message_text)
                     VALUES (?, ?, ?, ?, ?)`,
                    [
                        userId,
                        receiver_id,
                        equipment_id || null,
                        booking_id || null,
                        message_text.trim()
                    ]
                );

                const messageId = result.insertId;

                // Build the message object
                const messageObj = {
                    message_id: messageId,
                    sender_id: userId,
                    receiver_id: Number(receiver_id),
                    equipment_id: equipment_id || null,
                    booking_id: booking_id || null,
                    message_text: message_text.trim(),
                    is_read: false,
                    sent_at: new Date().toISOString()
                };

                // Emit to the conversation room
                const roomId = getRoomId(userId, receiver_id);
                io.to(roomId).emit('receive_message', messageObj);

                // Also emit to receiver's personal room (in case they're not in the chat room)
                io.to(`user_${receiver_id}`).emit('new_message_notification', {
                    from: userId,
                    from_name: socket.user.full_name,
                    preview: message_text.trim().substring(0, 50),
                    message_id: messageId
                });

            } catch (err) {
                console.error('Send message error:', err);
                socket.emit('error', { message: 'Failed to send message' });
            }
        });

        // ----------------------------------------
        // TYPING INDICATOR
        // ----------------------------------------
        socket.on('typing', ({ receiver_id, is_typing }) => {
            const roomId = getRoomId(userId, receiver_id);
            socket.to(roomId).emit('user_typing', {
                user_id: userId,
                is_typing
            });
        });

        // ----------------------------------------
        // MARK MESSAGES AS READ
        // ----------------------------------------
        socket.on('mark_read', async ({ other_user_id }) => {
            try {
                await db.query(
                    `UPDATE Message 
                     SET is_read = TRUE, read_at = NOW()
                     WHERE sender_id = ? AND receiver_id = ? AND is_read = FALSE`,
                    [other_user_id, userId]
                );

                // Notify the other user
                const roomId = getRoomId(userId, other_user_id);
                io.to(roomId).emit('messages_read', {
                    reader_id: userId,
                    read_at: new Date().toISOString()
                });
            } catch (err) {
                console.error('Mark read error:', err);
            }
        });

        // ----------------------------------------
        // DISCONNECT
        // ----------------------------------------
        socket.on('disconnect', () => {
            console.log(`🔌 User disconnected: ${userId}`);
        });
    });
};