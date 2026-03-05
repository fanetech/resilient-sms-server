const SMSParser = require('../utils/smsParser');
const ResponseFormatter = require('../utils/responseFormatter');
const PrismaService = require('../services/prismaService');
const TransferService = require('../services/transferService');
const { verifyPin } = require('../utils/pinEncryption');

class TransactionController {

  /**
   * Main entry point for processing SMS transactions
   */
  static async processSMSTransaction(smsText, senderNumber) {
    console.log(`📨 Processing SMS from ${senderNumber}: "${smsText}"`);

    try {
      // Parse SMS
      const parsedSMS = SMSParser.parse(smsText);
      console.log('📋 SMS parsed:', parsedSMS);

      // Validate structure
      const validation = SMSParser.validateTransaction(parsedSMS);
      if (!validation.valid) {
        return ResponseFormatter.formatError(parsedSMS.transactionId, validation.error);
      }

      // Router vers bon handler
      switch (parsedSMS.command) {
        case 'T':
          return await this.processTransfer(parsedSMS, senderNumber);
        case 'P':
          return await this.processPayment(parsedSMS, senderNumber);
        case 'B':
          return await this.processBalance(parsedSMS, senderNumber);
        default:
          throw new Error(`Unsupported command: ${parsedSMS.command}`);
      }

    } catch (error) {
      console.error('❌ SMS processing error:', error);
      const txId = smsText.split('#')[1] || 'UNK';
      return ResponseFormatter.formatError(txId, 'PROCESSING_FAILED');
    }
  }

  /**
   * Process transfer transaction: T#ID#AMOUNT#RECIPIENT#PIN
   */
  static async processTransfer(parsedSMS, _senderNumber) {
    const { transactionId, params } = parsedSMS;
    const [amountStr, senderPhone, recipient, pin] = params;

    console.log(`💸 [SMS] Processing transfer: ${amountStr} from ${senderPhone} to ${recipient}`);

    try {
      const amount = SMSParser.parseAmount(amountStr);

      // Find sender by phone number (from SMS body)
      const fromUser = await PrismaService.getUserByPhone(senderPhone);
      if (!fromUser) {
        return ResponseFormatter.formatError(transactionId, 'USER_NOT_FOUND');
      }

      // Find recipient by phone number
      const toUser = await PrismaService.getUserByPhone(recipient);
      if (!toUser) {
        return ResponseFormatter.formatError(transactionId, 'RECIPIENT_NOT_FOUND');
      }

      // Use shared transfer service
      const result = await TransferService.execute({
        fromUserId: fromUser.userId,
        toUserId: toUser.userId,
        amount,
        pin,
        source: 'SMS',
        smsText: parsedSMS.raw
      });

      if (!result.success) {
        return ResponseFormatter.formatError(
          transactionId,
          result.code,
          result.data
        );
      }

      return ResponseFormatter.formatSuccess(transactionId, {
        balance: result.data.newBalance,
        transactionRef: result.data.transactionRef
      });

    } catch (error) {
      console.error('❌ Transfer error:', error);
      return ResponseFormatter.formatError(transactionId, 'TRANSFER_FAILED');
    }
  }

  /**
   * Process payment transaction: P#ID#AMOUNT#MERCHANT#PIN
   */
  static async processPayment(parsedSMS, senderNumber) {
    const { transactionId, params } = parsedSMS;
    const [amountStr, merchant, pin] = params;

    console.log(`🛍️ Processing payment: ${amountStr} to ${merchant}`);

    try {
      const amount = SMSParser.parseAmount(amountStr);

      // Find sender by phone number
      const fromUser = await PrismaService.getUserByPhone(senderNumber);
      if (!fromUser) {
        return ResponseFormatter.formatError(transactionId, 'USER_NOT_FOUND');
      }

      // Find merchant by phone number
      const merchantUser = await PrismaService.getUserByPhone(merchant);
      if (!merchantUser) {
        return ResponseFormatter.formatError(transactionId, 'MERCHANT_NOT_FOUND');
      }

      // Valider PIN
      const pinValid = await verifyPin(pin, fromUser.pin);
      if (!pinValid) {
        return ResponseFormatter.formatError(transactionId, 'INVALID_PIN');
      }

      // Vérifier solde
      if (amount > fromUser.balance) {
        return ResponseFormatter.formatError(
          transactionId,
          'INSUFFICIENT_FUNDS',
          { balance: fromUser.balance }
        );
      }

      // Créer transaction
      await PrismaService.createTransaction({
        transactionId,
        type: 'PAYMENT',
        amount,
        fromUserId: fromUser.userId,
        toUserId: merchantUser.userId,
        smsText: parsedSMS.raw
      });

      // Mettre à jour soldes
      const newBalance = fromUser.balance - amount;
      await PrismaService.updateUserBalance(fromUser.userId, newBalance);
      await PrismaService.updateUserBalance(merchantUser.userId, merchantUser.balance + amount);

      // Compléter transaction
      const transactionRef = ResponseFormatter.generateTransactionRef();
      await PrismaService.updateTransaction(transactionId, {
        status: 'COMPLETED',
        responseText: `Payment ${amount} FCFA to ${merchantUser.userId}`
      });

      console.log(`✅ Payment successful: ${amount} FCFA to ${merchant}, Balance: ${newBalance}`);

      return ResponseFormatter.formatSuccess(transactionId, {
        paid: amount,
        balance: newBalance,
        transactionRef
      });

    } catch (error) {
      console.error('❌ Payment processing error:', error);

      try {
        await PrismaService.updateTransaction(transactionId, {
          status: 'FAILED',
          errorMessage: error.message
        });
      } catch (dbError) {
        console.error('❌ Failed to log error to DB:', dbError);
      }

      return ResponseFormatter.formatError(transactionId, 'PAYMENT_FAILED');
    }
  }

  /**
   * Process balance inquiry: B#ID##PIN
   */
  static async processBalance(parsedSMS, senderNumber) {
    const { transactionId, params } = parsedSMS;
    const pin = params[params.length - 1]; // PIN is last param

    console.log(`💰 Processing balance inquiry`);

    try {
      // Récupérer utilisateur
      let user = await PrismaService.getUserByPhone(senderNumber);
      if (!user) {
        user = await PrismaService.getUser('USER3456');
      }

      if (!user) {
        return ResponseFormatter.formatError(transactionId, 'USER_NOT_FOUND');
      }

      // Valider PIN
      const pinValid = await verifyPin(pin, user.pin);
      if (!pinValid) {
        return ResponseFormatter.formatError(transactionId, 'INVALID_PIN');
      }

      // Créer transaction balance
      await PrismaService.createTransaction({
        transactionId,
        type: 'BALANCE',
        amount: null,
        fromUserId: user.userId,
        toUserId: null,
        smsText: parsedSMS.raw
      });

      // Marquer comme complétée
      await PrismaService.updateTransaction(transactionId, {
        status: 'COMPLETED',
        responseText: `Balance inquiry: ${user.balance} FCFA`
      });

      console.log(`💰 Balance inquiry: ${user.balance} FCFA`);

      return ResponseFormatter.formatSuccess(transactionId, {
        balance: user.balance,
        credit: 0 // Demo: pas de crédit
      });

    } catch (error) {
      console.error('❌ Balance inquiry error:', error);
      return ResponseFormatter.formatError(transactionId, 'BALANCE_INQUIRY_FAILED');
    }
  }
}

module.exports = TransactionController;
