require('dotenv').config();
const axios = require('axios');

(async () => {
    try {
        console.log('\n=== STEP 1: OAuth ===');
        const auth = Buffer.from(
            process.env.MPESA_CONSUMER_KEY + ':' + process.env.MPESA_CONSUMER_SECRET
        ).toString('base64');

        const tokenRes = await axios.get(
            'https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials',
            { headers: { Authorization: 'Basic ' + auth } }
        );
        const token = tokenRes.data.access_token;
        console.log('Token (first 40):', token.substring(0, 40) + '...');
        console.log('Token length:', token.length);

        console.log('\n=== STEP 2: Config ===');
        console.log('Env:', process.env.MPESA_ENV);
        console.log('Shortcode:', process.env.MPESA_SHORTCODE);
        console.log('Passkey length:', (process.env.MPESA_PASSKEY || '').length);
        console.log('Passkey:', process.env.MPESA_PASSKEY);
        console.log('Callback URL:', process.env.MPESA_CALLBACK_URL);

        console.log('\n=== STEP 3: STK Push ===');
        const now = new Date();
        const ts = now.getFullYear().toString()
            + String(now.getMonth() + 1).padStart(2, '0')
            + String(now.getDate()).padStart(2, '0')
            + String(now.getHours()).padStart(2, '0')
            + String(now.getMinutes()).padStart(2, '0')
            + String(now.getSeconds()).padStart(2, '0');

        const pwd = Buffer.from(
            process.env.MPESA_SHORTCODE + process.env.MPESA_PASSKEY + ts
        ).toString('base64');

        console.log('Timestamp:', ts);

        const payload = {
            BusinessShortCode: process.env.MPESA_SHORTCODE,
            Password: pwd,
            Timestamp: ts,
            TransactionType: 'CustomerPayBillOnline',
            Amount: 1,
            PartyA: '254708374149',
            PartyB: process.env.MPESA_SHORTCODE,
            PhoneNumber: '254708374149',
            CallBackURL: process.env.MPESA_CALLBACK_URL,
            AccountReference: 'TEST',
            TransactionDesc: 'Test'
        };

        try {
            const res = await axios.post(
                'https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest',
                payload,
                {
                    headers: {
                        Authorization: 'Bearer ' + token,
                        'Content-Type': 'application/json'
                    }
                }
            );
            console.log('\n✅ SUCCESS:', JSON.stringify(res.data, null, 2));
        } catch (err) {
            console.log('\n❌ STK PUSH ERROR:');
            console.log(JSON.stringify(err.response?.data || err.message, null, 2));
        }
    } catch (err) {
        console.log('\n❌ FATAL:', err.message);
    }
})();