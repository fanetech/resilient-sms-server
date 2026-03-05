const express = require('express');
const router = express.Router();
const TransactionController = require('../controllers/transactionController');
const AfricasTalkingService = require('../services/africasTalkingService');
const TransferService = require('../services/transferService');
const ResponseFormatter = require('../utils/responseFormatter');
const PrismaService = require('../services/prismaService');

/**
 * AfricasTalking SMS Webhook Endpoint
 * Receives incoming SMS and processes transactions
 */
router.post('/webhook', async (req, res) => {
  console.log('📨 AfricasTalking SMS Webhook received');
  console.log('📋 Webhook data:', req.body);

  try {
    // Extract SMS data - support both Twilio (Body/From/To) and AfricasTalking (text/from/to)
    const text = req.body.Body || req.body.text;
    const from = req.body.From || req.body.from;
    const to = req.body.To || req.body.to;
    const id = req.body.MessageSid || req.body.id;
    const date = req.body.date;

    // Validate required fields
    if (!text || !from) {
      console.error('❌ Missing required fields: text or from');
      return res.status(400).json({
        error: 'Missing required fields',
        required: ['text/Body', 'from/From']
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
 * POST /api/sms/callback
 * Africa's Talking SMS Callback endpoint.
 * Receives incoming SMS and processes transactions.
 *
 * Africa's Talking sends: { from, to, text, id, date }
 * SMS Format: T#transactionId#amount#toPhone#pin
 * Example: T#TXN001#5000#22676543211#123456
 */
router.post('/callback', async (req, res) => {
  console.log('📨 SMS Callback received');
  console.log('📋 Request body:', req.body);

  const { from, to, text, id, date } = req.body;

  try {
    // Validate required fields
    if (!from || !text) {
      return res.status(400).json({
        status: 'error',
        code: 'MISSING_FIELDS',
        message: 'from and text are required'
      });
    }

    console.log(`📱 SMS from ${from}: "${text}"`);

    // Parse SMS text: COMMAND#fromUserId#toUserId#amount#pin
    const parts = text.trim().split('#');
    const command = parts[0];

    if (!command) {
      return res.status(400).json({
        status: 'error',
        code: 'MISSING_COMMAND',
        message: 'command is required (T, P, B)'
      });
    }

    switch (command.toUpperCase()) {
      case 'T': {
        // Format: T#transactionId#amount#toPhone#pin
        const [, transactionId, amountStr, toPhone, pin] = parts;
        const amount = parseFloat(amountStr);

        if (!transactionId || !toPhone || !amount || !pin) {
          return res.status(400).json({
            status: 'error',
            code: 'MISSING_FIELDS',
            message: 'Format: T#transactionId#amount#toPhone#pin'
          });
        }

        // Find sender by phone number (from Africa's Talking)
        const fromUser = await PrismaService.getUserByPhone(from);
        if (!fromUser) {
          const errorResponse = ResponseFormatter.formatError(transactionId, 'USER_NOT_FOUND');
          try {
            await AfricasTalkingService.sendSMS(from, errorResponse);
          } catch (smsErr) {
            console.error(`❌ Failed to send error SMS:`, smsErr.message);
          }
          return res.status(404).json({
            status: 'error',
            code: 'USER_NOT_FOUND',
            message: 'Sender not found',
            response: errorResponse
          });
        }

        // Find recipient by phone number
        const toUser = await PrismaService.getUserByPhone(toPhone);
        if (!toUser) {
          const errorResponse = ResponseFormatter.formatError(transactionId, 'USER_NOT_FOUND');
          try {
            await AfricasTalkingService.sendSMS(from, errorResponse);
          } catch (smsErr) {
            console.error(`❌ Failed to send error SMS:`, smsErr.message);
          }
          return res.status(404).json({
            status: 'error',
            code: 'USER_NOT_FOUND',
            message: 'Recipient not found',
            response: errorResponse
          });
        }

        const result = await TransferService.execute({
          fromUserId: fromUser.userId,
          toUserId: toUser.userId,
          amount,
          pin,
          source: 'CALLBACK'
        });

        if (!result.success) {
          // Format error response like TransactionController
          const errorResponse = ResponseFormatter.formatError(transactionId, result.code, result.data);

          // Send error SMS to sender
          try {
            await AfricasTalkingService.sendSMS(from, errorResponse);
            console.log(`✅ Error SMS sent to sender: ${from}`);
          } catch (smsErr) {
            console.error(`❌ Failed to send error SMS:`, smsErr.message);
          }

          const statusMap = {
            USER_NOT_FOUND: 404,
            INVALID_PIN: 403,
            INSUFFICIENT_FUNDS: 400,
            DAILY_LIMIT_EXCEEDED: 400
          };
          return res.status(statusMap[result.code] || 400).json({
            status: 'error',
            code: result.code,
            message: result.message,
            data: result.data,
            response: errorResponse
          });
        }

        // Format success response like TransactionController
        const successResponse = ResponseFormatter.formatSuccess(transactionId, {
          balance: result.data.newBalance,
          transactionRef: result.data.transactionRef
        });

        // Send SMS notifications after successful transfer
        const smsResults = { sender: null, recipient: null };

        try {
          // SMS to sender (success response)
          try {
            smsResults.sender = await AfricasTalkingService.sendSMS(from, successResponse);
            console.log(`✅ SMS sent to sender: ${from}`);
          } catch (smsErr) {
            console.error(`❌ Failed to send SMS to sender:`, smsErr.message);
          }

          // SMS to recipient (credit notification)
          if (toUser?.phone) {
            const recipientMsg = `Vous avez recu ${amount} FCFA de ${fromUser?.name || fromUser.userId}. Ref: ${result.data.transactionRef}`;
            try {
              smsResults.recipient = await AfricasTalkingService.sendSMS(toUser.phone, recipientMsg);
              console.log(`✅ SMS sent to recipient: ${toUser.phone}`);
            } catch (smsErr) {
              console.error(`❌ Failed to send SMS to recipient:`, smsErr.message);
            }
          }
        } catch (smsError) {
          console.error('❌ SMS notification error:', smsError.message);
        }

        return res.json({
          status: 'success',
          data: result.data,
          response: successResponse,
          smsNotifications: {
            senderNotified: !!smsResults.sender,
            recipientNotified: !!smsResults.recipient
          }
        });
      }

      default:
        return res.status(400).json({
          status: 'error',
          code: 'UNKNOWN_COMMAND',
          message: `Unknown command: ${command}. Supported: T(Transfer), P(Payment), B(Balance)`
        });
    }

  } catch (error) {
    console.error('❌ Callback error:', error);
    res.status(500).json({
      status: 'error',
      code: 'CALLBACK_FAILED',
      message: error.message
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
