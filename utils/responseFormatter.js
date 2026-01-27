class ResponseFormatter {
  /**
   * Format successful transaction response
   * Format: OK#TRANSACTION_ID#DATA_FIELDS
   */
  static formatSuccess(transactionId, data) {
    let response = `OK#${transactionId}`;

    // Add balance if provided
    if (data.balance !== undefined) {
      response += `#BAL:${this.formatAmount(data.balance)}`;
    }

    // Add transaction reference if provided
    if (data.transactionRef) {
      response += `#TXN:${data.transactionRef}`;
    }

    // Add credit balance if provided
    if (data.credit !== undefined) {
      response += `#CREDIT:${this.formatAmount(data.credit)}`;
    }

    // Add paid amount if provided
    if (data.paid !== undefined) {
      response += `#PAID:${this.formatAmount(data.paid)}`;
    }

    // Ensure SMS length limit (160 characters)
    if (response.length > 160) {
      console.warn(`⚠️ SMS response too long: ${response.length} chars, truncating...`);
      response = response.substring(0, 157) + '...';
    }

    console.log(`✅ Success response formatted: "${response}"`);
    return response;
  }

  /**
   * Format error transaction response
   * Format: ERR#TRANSACTION_ID#ERROR_MESSAGE#ADDITIONAL_DATA
   */
  static formatError(transactionId, error, additionalData = null) {
    let response = `ERR#${transactionId}#${error}`;

    // Add additional data if provided
    if (additionalData) {
      if (additionalData.balance !== undefined) {
        response += `#BAL:${this.formatAmount(additionalData.balance)}`;
      }
      if (additionalData.limit !== undefined) {
        response += `#LIMIT:${this.formatAmount(additionalData.limit)}`;
      }
    }

    // Ensure SMS length limit
    if (response.length > 160) {
      console.warn(`⚠️ SMS error response too long: ${response.length} chars, truncating...`);
      response = response.substring(0, 157) + '...';
    }

    console.log(`❌ Error response formatted: "${response}"`);
    return response;
  }

  /**
   * Format amount for SMS compression (50000 → 50K, 1500000 → 1.5M)
   */
  static formatAmount(amount) {
    if (amount >= 1000000) {
      const millions = amount / 1000000;
      return millions % 1 === 0 ? `${millions}M` : `${millions.toFixed(1)}M`;
    }

    if (amount >= 1000) {
      return `${Math.floor(amount / 1000)}K`;
    }

    return amount.toString();
  }

  /**
   * Generate unique transaction reference
   */
  static generateTransactionRef() {
    const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    let result = '';
    for (let i = 0; i < 6; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    console.log(`🔗 Generated transaction reference: ${result}`);
    return result;
  }
}

module.exports = ResponseFormatter;
