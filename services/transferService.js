const PrismaService = require('./prismaService');
const ResponseFormatter = require('../utils/responseFormatter');
const { verifyPin } = require('../utils/pinEncryption');

class TransferService {

  /**
   * Execute a transfer between two users.
   * Shared logic used by both the REST API and SMS webhook.
   *
   * @param {Object} params
   * @param {string} params.fromUserId - Sender user ID
   * @param {string} params.toUserId - Recipient user ID
   * @param {number} params.amount - Amount in FCFA
   * @param {string} params.pin - Sender's plain-text PIN
   * @param {string} [params.source='API'] - Origin of the request ('API' or 'SMS')
   * @param {string} [params.smsText] - Raw SMS text (for SMS origin)
   * @returns {Promise<Object>} Result object with success/error info
   */
  static async execute({ fromUserId, toUserId, amount, pin, source = 'API', smsText = null }) {
    console.log(`💸 [${source}] Transfer: ${amount} from ${fromUserId} to ${toUserId}`);

    // 1. Get sender
    const fromUser = await PrismaService.getUser(fromUserId);
    if (!fromUser) {
      return { success: false, code: 'USER_NOT_FOUND', message: 'Sender not found' };
    }

    // 2. Validate PIN
    const pinValid = await verifyPin(pin, fromUser.pin);
    if (!pinValid) {
      return { success: false, code: 'INVALID_PIN', message: 'Invalid PIN' };
    }

    // 3. Check balance
    if (amount > fromUser.balance) {
      return {
        success: false,
        code: 'INSUFFICIENT_FUNDS',
        message: 'Insufficient funds',
        data: { currentBalance: fromUser.balance, requestedAmount: amount }
      };
    }

    // 4. Check daily limit
    if (amount > 1000000) {
      return {
        success: false,
        code: 'DAILY_LIMIT_EXCEEDED',
        message: 'Daily limit exceeded (1,000,000 FCFA)',
        data: { limit: 1000000 }
      };
    }

    // 5. Generate transaction ID
    const transactionId = `TXN${Date.now()}`;

    // 6. Create transaction record
    await PrismaService.createTransaction({
      transactionId,
      type: 'TRANSFER',
      amount,
      fromUserId,
      toUserId,
      smsText: smsText || `${source}:T#${fromUserId}#${amount}#${toUserId}`
    });

    // 7. Update sender balance
    const newBalance = fromUser.balance - amount;
    await PrismaService.updateUserBalance(fromUserId, newBalance);

    // 8. Update recipient balance
    const toUser = await PrismaService.getUser(toUserId);
    if (toUser) {
      await PrismaService.updateUserBalance(toUserId, toUser.balance + amount);
    }

    // 9. Complete transaction
    const transactionRef = ResponseFormatter.generateTransactionRef();
    await PrismaService.updateTransaction(transactionId, {
      status: 'COMPLETED',
      responseText: `Transfer ${amount} FCFA to ${toUserId}`
    });

    console.log(`✅ [${source}] Transfer completed: ${amount} FCFA`);

    return {
      success: true,
      data: {
        transactionId,
        type: 'TRANSFER',
        amount,
        fromUserId,
        toUserId,
        newBalance,
        formattedBalance: ResponseFormatter.formatAmount(newBalance),
        transactionRef,
        createdAt: new Date().toISOString()
      }
    };
  }
}

module.exports = TransferService;
