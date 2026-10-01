const mysql = require('mysql2');
require('dotenv').config();

// Create connection pool (not single connection)
const pool = mysql.createPool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    enableKeepAlive: true,
    keepAliveInitialDelay: 0
});

// Wrap with promise interface for async/await
const promisePool = pool.promise();

// Test connection on startup
promisePool.query('SELECT 1')
    .then(() => console.log('✅ MySQL connected to:', process.env.DB_NAME))
    .catch(err => {
        console.error('❌ MySQL connection failed:', err.message);
        process.exit(1);
    });

module.exports = promisePool;