const axios = require('axios');
require('dotenv').config();

const BASE_URL = process.env.MPESA_ENV === 'production'
    ? 'https://api.safaricom.co.ke'
    : 'https://sandbox.safaricom.co.ke';

// ============================================
// GET OAUTH ACCESS TOKEN (cached for 55 min)
// ============================================
let cachedToken = null;
let tokenExpiry = null;

async function getAccessToken() {
    if (cachedToken && tokenExpiry && Date.now() < tokenExpiry) {
        return cachedToken;
    }

    const auth = Buffer.from(
        `${process.env.MPESA_CONSUMER_KEY}:${process.env.MPESA_CONSUMER_SECRET}`
    ).toString('base64');

    try {
        const { data } = await axios.get(
            `${BASE_URL}/oauth/v1/generate?grant_type=client_credentials`,
            { headers: { Authorization: `Basic ${auth}` } }
        );

        cachedToken = data.access_token;
        tokenExpiry = Date.now() + (55 * 60 * 1000);
        return cachedToken;
    } catch (err) {
        console.error('M-Pesa OAuth error:', err.response?.data || err.message);
        throw new Error('Failed to get M-Pesa access token');
    }
}

// ============================================
// GENERATE PASSWORD
// ============================================
function generatePassword(timestamp) {
    const str = `${process.env.MPESA_SHORTCODE}${process.env.MPESA_PASSKEY}${timestamp}`;
    return Buffer.from(str).toString('base64');
}

// ============================================
// TIMESTAMP (YYYYMMDDHHmmss)
// ============================================
function getTimestamp() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    return `${year}${month}${day}${hours}${minutes}${seconds}`;
}

// ============================================
// FORMAT PHONE
// ============================================
function formatPhone(phone) {
    let cleaned = String(phone).replace(/\D/g, '');
    if (cleaned.startsWith('0')) {
        cleaned = '254' + cleaned.substring(1);
    }
    if (cleaned.startsWith('7') || cleaned.startsWith('1')) {
        cleaned = '254' + cleaned;
    }
    if (!cleaned.startsWith('254')) {
        throw new Error('Invalid Kenyan phone number');
    }
    if (cleaned.length !== 12) {
        throw new Error('Phone number must be 12 digits (254XXXXXXXXX)');
    }
    return cleaned;
}

// ============================================
// STK PUSH
// ============================================
async function stkPush({ phone, amount, bookingRef, description }) {
    const token = await getAccessToken();
    const timestamp = getTimestamp();
    const password = generatePassword(timestamp);
    const formattedPhone = formatPhone(phone);

    const payload = {
        BusinessShortCode: process.env.MPESA_SHORTCODE,
        Password: password,
        Timestamp: timestamp,
        TransactionType: 'CustomerPayBillOnline',
        Amount: Math.round(amount),
        PartyA: formattedPhone,
        PartyB: process.env.MPESA_SHORTCODE,
        PhoneNumber: formattedPhone,
        CallBackURL: process.env.MPESA_CALLBACK_URL,
        AccountReference: bookingRef,
        TransactionDesc: description || `Payment for ${bookingRef}`
    };

    try {
        const { data } = await axios.post(
            `${BASE_URL}/mpesa/stkpush/v1/processrequest`,
            payload,
            {
                headers: {
                    Authorization: `Bearer ${token.trim()}`,
                    'Content-Type': 'application/json'
                }
            }
        );
        return data;
    } catch (err) {
        console.error('STK Push error:', err.response?.data || err.message);
        throw new Error('Failed to initiate STK Push');
    }
}

// ============================================
// STK QUERY
// ============================================
async function stkQuery(checkoutRequestId) {
    const token = await getAccessToken();
    const timestamp = getTimestamp();
    const password = generatePassword(timestamp);

    const payload = {
        BusinessShortCode: process.env.MPESA_SHORTCODE,
        Password: password,
        Timestamp: timestamp,
        CheckoutRequestID: checkoutRequestId
    };

    const { data } = await axios.post(
        `${BASE_URL}/mpesa/stkpushquery/v1/query`,
        payload,
        {
            headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        }
    );
    return data;
}

module.exports = {
    getAccessToken,
    stkPush,
    stkQuery,
    formatPhone,
    getTimestamp,
    generatePassword
};