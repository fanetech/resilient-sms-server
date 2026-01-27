const express = require('express');
const router = express.Router();
const TransactionController = require('../controllers/transactionController');
const AfricasTalkingService = require('../services/africasTalkingService');

/**
 * AfricasTalking SMS Webhook Endpoint
 * Receives incoming SMS and processes transactions
 */
router.post('/webhook', async (req, res) => {
  console.log('📨 AfricasTalking SMS Webhook received');
  console.log('📋 Webhook data:', req.body);

  try {
    // Extract SMS data from AfricasTalking webhook
    const { text, from, to, id, date } = req.body;

    // Validate required fields
    if (!text || !from) {
      console.error('❌ Missing required fields: text or from');
      return res.status(400).json({
        error: 'Missing required fields',
        required: ['text', 'from']
      });
    }

    const smsData = {
      text: text,
      from: from,
      to: to,
      messageId: id,
      receivedAt: date || new Date().toISOString()
    };

    console.log(`📱 SMS Data: "${smsData.text}" from ${smsData.from}`);

    // Process transaction
    const response = await TransactionController.processSMSTransaction(
      smsData.text,
      smsData.from
    );

    console.log(`🔄 Transaction response: "${response}"`);

    // Send response SMS back to sender
    if (response) {
      try {
        const smsResult = await AfricasTalkingService.sendSMS(smsData.from, response);
        console.log(`✅ Response SMS sent successfully`);

        res.status(200).json({
          status: 'success',
          processed: true,
          response: response,
          smsSent: true,
          cost: smsResult.cost
        });

      } catch (smsError) {
        console.error('❌ Failed to send response SMS:', smsError);

        res.status(200).json({
          status: 'partial_success',
          processed: true,
          response: response,
          smsSent: false,
          error: 'Failed to send response SMS'
        });
      }
    } else {
      res.status(200).json({
        status: 'success',
        processed: true,
        response: null
      });
    }

  } catch (error) {
    console.error('❌ Webhook processing error:', error);
    res.status(500).json({
      status: 'error',
      message: error.message,
      processed: false
    });
  }
});

/**
 * Manual SMS send endpoint (for testing)
 */
router.post('/send', async (req, res) => {
  try {
    const { phoneNumber, message } = req.body;

    if (!phoneNumber || !message) {
      return res.status(400).json({
        error: 'phoneNumber and message are required'
      });
    }

    console.log(`📤 Manual SMS send request: ${phoneNumber} - "${message}"`);

    const result = await AfricasTalkingService.sendSMS(phoneNumber, message);

    res.json({
      status: 'success',
      result: result,
      cost: result.cost
    });

  } catch (error) {
    console.error('❌ Manual SMS send error:', error);
    res.status(500).json({
      error: error.message
    });
  }
});

/**
 * Get SMS delivery reports
 */
router.get('/reports', async (req, res) => {
  try {
    console.log('📊 Fetching SMS delivery reports');

    const reports = await AfricasTalkingService.getDeliveryReports();

    res.json({
      status: 'success',
      reports: reports
    });

  } catch (error) {
    console.error('❌ Error fetching reports:', error);
    res.status(500).json({
      error: error.message
    });
  }
});

/**
 * Get AfricasTalking account balance
 */
router.get('/balance', async (req, res) => {
  try {
    console.log('💰 Fetching AfricasTalking balance');

    const balance = await AfricasTalkingService.getBalance();

    res.json({
      status: 'success',
      balance: balance
    });

  } catch (error) {
    console.error('❌ Error fetching balance:', error);
    res.status(500).json({
      error: error.message
    });
  }
});

/**
 * Test endpoint - SMS service status
 */
router.get('/test', (req, res) => {
  res.json({
    message: 'AfricasTalking SMS service is running',
    timestamp: new Date().toISOString(),
    provider: 'AfricasTalking',
    endpoints: {
      webhook: 'POST /api/sms/webhook',
      send: 'POST /api/sms/send',
      reports: 'GET /api/sms/reports',
      balance: 'GET /api/sms/balance',
      test: 'GET /api/sms/test'
    },
    sampleTransaction: {
      transfer: 'T#A7F#50K#U3456#1234',
      payment: 'P#B2C#15K#M7890#1234',
      balance: 'B#C3D##1234'
    }
  });
});

module.exports = router;
