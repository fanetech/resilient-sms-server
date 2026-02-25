const express = require('express');
const router = express.Router();
const PrismaService = require('../services/prismaService');
const ResponseFormatter = require('../utils/responseFormatter');
const SMSParser = require('../utils/smsParser');
const { verifyPin } = require('../utils/pinEncryption');
const TransferService = require('../services/transferService');

/**
 * POST /api/transactions/transfer
 * Execute a money transfer between users
 */
router.post('/transfer', async (req, res) => {
  const { from, to, amount, pin } = req.body;

  console.log(`💸 req.body:`, req.body);

  try {
    // Validate required fields
    if (!from || !to || !amount || !pin) {
      return res.status(400).json({
        status: 'error',
        code: 'MISSING_FIELDS',
        message: 'from, to, amount, and pin are required'
      });
    }

    // Find users by phone number
    const fromUser = await PrismaService.getUserByPhone(from);
    if (!fromUser) {
      return res.status(404).json({
        status: 'error',
        code: 'USER_NOT_FOUND',
        message: 'Sender not found'
      });
    }

    const toUser = await PrismaService.getUserByPhone(to);
    if (!toUser) {
      return res.status(404).json({
        status: 'error',
        code: 'USER_NOT_FOUND',
        message: 'Recipient not found'
      });
    }

    // Verify token ownership
    if (req.user.userId !== fromUser.userId) {
      return res.status(403).json({
        status: 'error',
        code: 'FORBIDDEN',
        message: 'Token does not match from'
      });
    }

    // Execute transfer using shared service
    const result = await TransferService.execute({
      fromUserId: fromUser.userId,
      toUserId: toUser.userId,
      amount,
      pin,
      source: 'API'
    });

    if (!result.success) {
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
        data: result.data
      });
    }

    res.json({
      status: 'success',
      data: result.data
    });

  } catch (error) {
    console.error('❌ Transfer API error:', error);
    res.status(500).json({
      status: 'error',
      code: 'TRANSFER_FAILED',
      message: error.message
    });
  }
});

/**
 * POST /api/transactions/payment
 * Make a payment to a merchant
 */
router.post('/payment', async (req, res) => {
  const { fromUserId, merchantId, amount, pin } = req.body;

  console.log(`🛍️ API Payment: ${amount} from ${fromUserId} to ${merchantId}`);

  try {
    // Validate required fields
    if (!fromUserId || !merchantId || !amount || !pin) {
      return res.status(400).json({
        status: 'error',
        code: 'MISSING_FIELDS',
        message: 'fromUserId, merchantId, amount, and pin are required'
      });
    }

    // Verify token ownership
    if (req.user.userId !== fromUserId) {
      return res.status(403).json({
        status: 'error',
        code: 'FORBIDDEN',
        message: 'Token does not match fromUserId'
      });
    }

    // Get sender
    const fromUser = await PrismaService.getUser(fromUserId);
    if (!fromUser) {
      return res.status(404).json({
        status: 'error',
        code: 'USER_NOT_FOUND',
        message: 'User not found'
      });
    }

    // Validate PIN
    const pinValid = await verifyPin(pin, fromUser.pin);
    if (!pinValid) {
      return res.status(403).json({
        status: 'error',
        code: 'INVALID_PIN',
        message: 'Invalid PIN'
      });
    }

    // Check balance
    if (amount > fromUser.balance) {
      return res.status(400).json({
        status: 'error',
        code: 'INSUFFICIENT_FUNDS',
        message: 'Insufficient funds',
        data: {
          currentBalance: fromUser.balance,
          requestedAmount: amount
        }
      });
    }

    // Generate transaction ID
    const transactionId = `TXN${Date.now()}`;

    // Create transaction
    await PrismaService.createTransaction({
      transactionId,
      type: 'PAYMENT',
      amount,
      fromUserId,
      toUserId: merchantId,
      smsText: `API:P#${fromUserId}#${amount}#${merchantId}`
    });

    // Update sender balance
    const newBalance = fromUser.balance - amount;
    await PrismaService.updateUserBalance(fromUserId, newBalance);

    // Update merchant balance
    const merchant = await PrismaService.getUser(merchantId);
    if (merchant) {
      await PrismaService.updateUserBalance(merchantId, merchant.balance + amount);
    }

    // Complete transaction
    const transactionRef = ResponseFormatter.generateTransactionRef();
    await PrismaService.updateTransaction(transactionId, {
      status: 'COMPLETED',
      responseText: `Payment ${amount} FCFA to ${merchantId}`
    });

    console.log(`✅ Payment completed: ${amount} FCFA`);

    res.json({
      status: 'success',
      data: {
        transactionId,
        type: 'PAYMENT',
        amount,
        fromUserId,
        merchantId,
        newBalance,
        formattedBalance: ResponseFormatter.formatAmount(newBalance),
        transactionRef,
        createdAt: new Date().toISOString()
      }
    });

  } catch (error) {
    console.error('❌ Payment API error:', error);
    res.status(500).json({
      status: 'error',
      code: 'PAYMENT_FAILED',
      message: error.message
    });
  }
});

/**
 * GET /api/transactions/balance
 * Get user account balance
 */
router.get('/balance', async (req, res) => {
  const { userId, pin } = req.query;

  console.log(`💰 API Balance inquiry: ${userId}`);

  try {
    if (!userId || !pin) {
      return res.status(400).json({
        status: 'error',
        code: 'MISSING_FIELDS',
        message: 'userId and pin are required'
      });
    }

    // Verify token ownership
    if (req.user.userId !== userId) {
      return res.status(403).json({
        status: 'error',
        code: 'FORBIDDEN',
        message: 'Token does not match userId'
      });
    }

    // Get user
    const user = await PrismaService.getUser(userId);
    if (!user) {
      return res.status(404).json({
        status: 'error',
        code: 'USER_NOT_FOUND',
        message: 'User not found'
      });
    }

    // Validate PIN
    const pinValid = await verifyPin(pin, user.pin);
    if (!pinValid) {
      return res.status(403).json({
        status: 'error',
        code: 'INVALID_PIN',
        message: 'Invalid PIN'
      });
    }

    res.json({
      status: 'success',
      data: {
        userId: user.userId,
        balance: user.balance,
        formattedBalance: `${ResponseFormatter.formatAmount(user.balance)} FCFA`,
        credit: 0,
        lastUpdated: user.updatedAt
      }
    });

  } catch (error) {
    console.error('❌ Balance API error:', error);
    res.status(500).json({
      status: 'error',
      code: 'BALANCE_INQUIRY_FAILED',
      message: error.message
    });
  }
});

/**
 * GET /api/transactions/history
 * Get transaction history for a user
 */
router.get('/history', async (req, res) => {
  const { userId, limit = 20, offset = 0 } = req.query;

  console.log(`📜 API Transaction history: ${userId}`);

  try {
    if (!userId) {
      return res.status(400).json({
        status: 'error',
        code: 'MISSING_FIELDS',
        message: 'userId is required'
      });
    }

    // Verify token ownership
    if (req.user.userId !== userId) {
      return res.status(403).json({
        status: 'error',
        code: 'FORBIDDEN',
        message: 'You can only view your own transaction history'
      });
    }

    const transactions = await PrismaService.getTransactionHistory(
      userId,
      parseInt(limit),
      parseInt(offset)
    );

    const total = await PrismaService.getTransactionCount(userId);

    res.json({
      status: 'success',
      data: {
        transactions: transactions.map(tx => ({
          transactionId: tx.transactionId,
          type: tx.type,
          amount: tx.amount,
          formattedAmount: tx.amount ? ResponseFormatter.formatAmount(tx.amount) : null,
          status: tx.status,
          fromUserId: tx.fromUserId,
          toUserId: tx.toUserId,
          createdAt: tx.createdAt,
          completedAt: tx.completedAt
        })),
        pagination: {
          total,
          limit: parseInt(limit),
          offset: parseInt(offset),
          hasMore: parseInt(offset) + transactions.length < total
        }
      }
    });

  } catch (error) {
    console.error('❌ History API error:', error);
    res.status(500).json({
      status: 'error',
      code: 'HISTORY_FAILED',
      message: error.message
    });
  }
});

/**
 * GET /api/transactions/:transactionId
 * Get details of a specific transaction
 */
router.get('/:transactionId', async (req, res) => {
  const { transactionId } = req.params;

  console.log(`🔍 API Transaction details: ${transactionId}`);

  try {
    const transaction = await PrismaService.getTransaction(transactionId);

    if (!transaction) {
      return res.status(404).json({
        status: 'error',
        code: 'TRANSACTION_NOT_FOUND',
        message: 'Transaction not found'
      });
    }

    // Verify token ownership - user must be sender or receiver
    if (req.user.userId !== transaction.fromUserId && req.user.userId !== transaction.toUserId) {
      return res.status(403).json({
        status: 'error',
        code: 'FORBIDDEN',
        message: 'You can only view your own transactions'
      });
    }

    res.json({
      status: 'success',
      data: {
        transactionId: transaction.transactionId,
        type: transaction.type,
        amount: transaction.amount,
        formattedAmount: transaction.amount ? ResponseFormatter.formatAmount(transaction.amount) : null,
        status: transaction.status,
        fromUserId: transaction.fromUserId,
        toUserId: transaction.toUserId,
        smsText: transaction.smsText,
        responseText: transaction.responseText,
        errorMessage: transaction.errorMessage,
        createdAt: transaction.createdAt,
        completedAt: transaction.completedAt
      }
    });

  } catch (error) {
    console.error('❌ Transaction details API error:', error);
    res.status(500).json({
      status: 'error',
      code: 'TRANSACTION_DETAILS_FAILED',
      message: error.message
    });
  }
});

module.exports = router;
