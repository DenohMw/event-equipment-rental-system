const express = require('express');
const http = require('http');
const cors = require('cors');
const path = require('path');
const { Server } = require('socket.io');
require('dotenv').config();

// Import database connection (this also tests it)
const db = require('./config/db');

// Initialize Express
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: process.env.CLIENT_URL || '*',
        methods: ['GET', 'POST'],
        credentials: true
    }
});

// Initialize Socket.io chat handler
require('./socket/chat')(io);

// ============================================
// MIDDLEWARE
// ============================================
app.use(cors({
    origin: process.env.CLIENT_URL || '*',
    credentials: true
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Serve uploaded files statically
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Serve the frontend pages and their assets from the project frontend folder.
app.use(express.static(path.join(__dirname, '../frontend')));

// Make io available to routes
app.set('io', io);

// Simple request logger
app.use((req, res, next) => {
    console.log(`${req.method} ${req.url}`);
    next();
});

// ============================================
// ROUTES
// ============================================


// Import routes
const authRoutes = require('./routes/auth');

// Mount routes
app.use('/api/auth', authRoutes);


const equipmentRoutes = require('./routes/equipment');
app.use('/api/equipment', equipmentRoutes);

const bookingRoutes = require('./routes/booking');
app.use('/api/bookings', bookingRoutes);

const paymentRoutes = require('./routes/payment');
app.use('/api/payments', paymentRoutes);

const chatRoutes = require('./routes/chat');
app.use('/api/chat', chatRoutes);

const reviewRoutes = require('./routes/review');
app.use('/api/reviews', reviewRoutes);

const adminRoutes = require('./routes/admin');
app.use('/api/admin', adminRoutes);

// Health check
app.get('/api/health', (req, res) => {
    res.json({
        status: 'success',
        message: 'EventEquip Kenya API is running',
        version: '1.0.0',
        timestamp: new Date().toISOString()
    });
});

// Test database connection endpoint
app.get('/api/test-db', async (req, res) => {
    try {
        const [rows] = await db.query('SELECT COUNT(*) AS user_count FROM User');
        res.json({
            status: 'success',
            message: 'Database connected',
            user_count: rows[0].user_count
        });
    } catch (err) {
        console.error('Database check failed:', err);
        res.status(500).json({
            status: 'error',
            message: 'We could not complete the database check right now.'
        });
    }
});

// ============================================
// ERROR HANDLING
// ============================================

// 404 handler
app.use((req, res) => {
    res.status(404).json({
        status: 'error',
        message: 'The requested service could not be found.'
    });
});

// Global error handler
app.use((err, req, res, next) => {
    console.error('Server error:', err);
    const status = err.status || 500;
    res.status(status).json({
        status: 'error',
        message: status >= 500
            ? 'We could not complete your request right now. Please try again shortly.'
            : (err.expose ? err.message : 'We could not process your request.')
    });
});


// ============================================
// START SERVER
// ============================================
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log('============================================');
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`📡 API URL: http://localhost:${PORT}`);
    console.log('============================================');
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (err) => {
    console.error('Unhandled Promise Rejection:', err.message);
});

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err.message);
    process.exit(1);
});
