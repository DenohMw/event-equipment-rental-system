const express = require('express');
const db = require('../config/db');
const { verifyToken, requireRole } = require('../middleware/auth');
const { stkPush, formatPhone } = require('../services/mpesa');
const router = express.Router();

// ============================================
// POST /api/payments/stk-push — Initiate payment
// ============================================
router.post('/stk-push', verifyToken, requireRole('customer'), async (req, res) => {
    const { booking_id, phone } = req.body;

    if (!booking_id || !phone) {
        return res.status(400).json({
            status: 'error',
            message: 'Required: booking_id, phone'
        });
    }

    try {
        const [bookings] = await db.query(
            'SELECT booking_id, booking_ref, total_amount, status FROM Booking WHERE booking_id = ? AND customer_id = ?',
            [booking_id, req.user.user_id]
        );

        if (bookings.length === 0) {
            return res.status(404).json({ status: 'error', message: 'Booking not found' });
        }

        const booking = bookings[0];

        if (booking.status !== 'confirmed') {
            return res.status(400).json({
                status: 'error',
                message: `Booking must be in "confirmed" status to pay. Current: ${booking.status}`
            });
        }

        const [existingPayments] = await db.query(
            'SELECT payment_id FROM Payment WHERE booking_id = ? AND status = "completed"',
            [booking_id]
        );

        if (existingPayments.length > 0) {
            return res.status(400).json({
                status: 'error',
                message: 'This booking is already paid'
            });
        }

        let formattedPhone;
        try {
            formattedPhone = formatPhone(phone);
        } catch (err) {
            return res.status(400).json({ status: 'error', message: err.message });
        }

        const result = await stkPush({
            phone: formattedPhone,
            amount: booking.total_amount,
            bookingRef: booking.booking_ref,
            description: `Payment for ${booking.booking_ref}`
        });

        await db.query(`
            INSERT INTO Payment (booking_id, customer_id, amount, phone_number, status, mpesa_receipt)
            VALUES (?, ?, ?, ?, 'pending', ?)
        `, [
            booking_id,
            req.user.user_id,
            booking.total_amount,
            formattedPhone,
            result.CheckoutRequestID
        ]);

        res.json({
            status: 'success',
            message: 'STK Push sent. Check your phone and enter PIN.',
            checkout_request_id: result.CheckoutRequestID,
            merchant_request_id: result.MerchantRequestID,
            booking_ref: booking.booking_ref,
            amount: booking.total_amount
        });

    } catch (err) {
        console.error('STK Push error:', err);
        res.status(500).json({
            status: 'error',
            message: 'We could not start your payment right now. Please try again shortly.'
        });
    }
});

// ============================================
// POST /api/payments/callback — Safaricom callback
// ============================================
router.post('/callback', async (req, res) => {
    console.log('M-Pesa callback received:', JSON.stringify(req.body, null, 2));
    res.json({ ResultCode: 0, ResultDesc: 'Accepted' });

    try {
        const callback = req.body.Body?.stkCallback;
        if (!callback) return;

        const checkoutRequestId = callback.CheckoutRequestID;
        const resultCode = callback.ResultCode;
        const resultDesc = callback.ResultDesc;

        const [payments] = await db.query(
            'SELECT payment_id, booking_id FROM Payment WHERE mpesa_receipt = ?',
            [checkoutRequestId]
        );

        if (payments.length === 0) {
            console.error('Payment record not found for:', checkoutRequestId);
            return;
        }

        const payment = payments[0];

        if (resultCode === 0) {
            const items = callback.CallbackMetadata?.Item || [];
            const getItem = (name) => items.find(i => i.Name === name)?.Value;

            const mpesaReceipt = getItem('MpesaReceiptNumber');
            const amount = getItem('Amount');

            await db.query(`
                UPDATE Payment 
                SET status = 'completed', mpesa_receipt = ?, transaction_date = NOW()
                WHERE payment_id = ?
            `, [mpesaReceipt, payment.payment_id]);

            await db.query(
                'UPDATE Booking SET status = "paid" WHERE booking_id = ?',
                [payment.booking_id]
            );

            const [bookingInfo] = await db.query(
                'SELECT customer_id, owner_id, booking_ref FROM Booking WHERE booking_id = ?',
                [payment.booking_id]
            );

            if (bookingInfo.length > 0) {
                const { customer_id, owner_id, booking_ref } = bookingInfo[0];

                await db.query(`
                    INSERT INTO Notification (user_id, title, message, type, reference_id)
                    VALUES 
                    (?, 'Payment Successful', ?, 'payment', ?),
                    (?, 'Payment Received', ?, 'payment', ?)
                `, [
                    customer_id,
                    `Payment of KSh ${amount} for ${booking_ref} successful. Receipt: ${mpesaReceipt}`,
                    payment.booking_id,
                    owner_id,
                    `Payment of KSh ${amount} received for ${booking_ref}`,
                    payment.booking_id
                ]);
            }

            console.log(`✅ Payment successful: ${mpesaReceipt}`);
        } else {
            await db.query(
                'UPDATE Payment SET status = "failed" WHERE payment_id = ?',
                [payment.payment_id]
            );
            console.log(`❌ Payment failed: ${resultDesc}`);
        }
    } catch (err) {
        console.error('Callback processing error:', err);
    }
});

// ============================================
// GET /api/payments/status/:bookingId
// ============================================
router.get('/status/:bookingId', verifyToken, async (req, res) => {
    try {
        const [rows] = await db.query(`
            SELECT p.*, b.booking_ref, b.status AS booking_status
            FROM Payment p
            JOIN Booking b ON p.booking_id = b.booking_id
            WHERE p.booking_id = ?
            ORDER BY p.payment_id DESC
            LIMIT 1
        `, [req.params.bookingId]);

        if (rows.length === 0) {
            return res.json({ status: 'success', payment: null });
        }

        res.json({ status: 'success', payment: rows[0] });
    } catch (err) {
        console.error(err);
        res.status(500).json({ status: 'error', message: 'Failed to fetch payment status' });
    }
});

// ============================================
// GET /api/payments/my — Customer payment history
// ============================================
router.get('/my', verifyToken, requireRole('customer'), async (req, res) => {
    try {
        const [rows] = await db.query(`
            SELECT p.*, b.booking_ref, e.name AS equipment_name
            FROM Payment p
            JOIN Booking b ON p.booking_id = b.booking_id
            JOIN Equipment e ON b.equipment_id = e.equipment_id
            WHERE p.customer_id = ?
            ORDER BY p.created_at DESC
        `, [req.user.user_id]);

        res.json({ status: 'success', payments: rows });
    } catch (err) {
        console.error(err);
        res.status(500).json({ status: 'error', message: 'Failed to fetch payments' });
    }
});

module.exports = router;
