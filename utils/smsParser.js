class SMSParser {
  /**
   * Parse incoming SMS text into structured data
   * Expected format: COMMAND#TRANSACTION_ID#PARAMS#PIN
   */
  static parse(smsText) {
    try {
      const trimmed = smsText.trim();
      const parts = trimmed.split('#');

      if (parts.length < 2) {
        throw new Error('Invalid SMS format - minimum 2 parts required (COMMAND#ID)');
      }

      const [command, transactionId, ...params] = parts;

      console.log(`🔍 Parsed SMS - Command: ${command}, ID: ${transactionId}, Params: ${params.length}`);

      return {
        command: command.toUpperCase(),
        transactionId: transactionId,
        params: params,
        raw: smsText
      };
    } catch (error) {
      throw new Error(`SMS parsing failed: ${error.message}`);
    }
  }

  /**
   * Validate parsed SMS structure based on transaction type
   */
  static validateTransaction(parsedSMS) {
    const { command, transactionId, params } = parsedSMS;

    // Validate transaction ID (minimum 3 characters)
    if (!transactionId || transactionId.length < 3) {
      return { valid: false, error: 'Invalid transaction ID - minimum 3 characters required' };
    }

    // Validate by command type
    switch (command) {
      case 'T': // Transfer: T#ID#AMOUNT#RECIPIENT#PIN
        if (params.length < 3) {
          return { valid: false, error: 'Transfer requires: amount, recipient, PIN' };
        }
        break;

      case 'P': // Payment: P#ID#AMOUNT#MERCHANT#PIN
        if (params.length < 3) {
          return { valid: false, error: 'Payment requires: amount, merchant, PIN' };
        }
        break;

      case 'B': // Balance: B#ID##PIN (empty amount/recipient)
        if (params.length < 1) {
          return { valid: false, error: 'Balance check requires PIN' };
        }
        break;

      default:
        return { valid: false, error: `Unknown command: ${command}. Supported: T(Transfer), P(Payment), B(Balance)` };
    }

    console.log(`✅ SMS validation passed for command: ${command}`);
    return { valid: true };
  }

  /**
   * Parse compressed amount (50K → 50000, 1.5M → 1500000)
   */
  static parseAmount(amountStr) {
    if (!amountStr) return 0;

    const match = amountStr.match(/^(\d+(?:\.\d+)?)(K|M)?$/i);
    if (!match) {
      throw new Error(`Invalid amount format: ${amountStr}. Expected: 50K, 1.5M, or 50000`);
    }

    let amount = parseFloat(match[1]);
    const unit = match[2];

    if (unit === 'K' || unit === 'k') amount *= 1000;
    if (unit === 'M' || unit === 'm') amount *= 1000000;

    console.log(`💰 Amount parsed: ${amountStr} → ${amount}`);
    return amount;
  }

  /**
   * Parse compressed user ID (U3456 → USER003456)
   */
  static parseUserId(compressedId) {
    if (!compressedId) return null;

    // Expand compressed user IDs
    if (compressedId.startsWith('U')) {
      return `USER${compressedId.substring(1).padStart(6, '0')}`;
    }
    if (compressedId.startsWith('M')) {
      return `MERCHANT${compressedId.substring(1).padStart(6, '0')}`;
    }

    // Return as-is if no compression pattern
    return compressedId;
  }
}

module.exports = SMSParser;
