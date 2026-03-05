const twilio = require('twilio');

class SmsService {
  constructor() {
    if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN || !process.env.TWILIO_PHONE_NUMBER) {
      console.warn('⚠️ Twilio credentials not configured. SMS sending will fail.');
      this.initialized = false;
      return;
    }

    this.client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    this.from = process.env.TWILIO_PHONE_NUMBER;
    this.initialized = true;

    console.log(`✅ Twilio initialized - From: ${this.from}`);
  }

  /**
   * Send SMS via Twilio
   */
  async sendSMS(phoneNumber, message) {
    if (!this.initialized) {
      console.error('❌ Twilio not initialized. Check credentials.');
      throw new Error('Twilio not initialized');
    }

    try {
      console.log(`📤 Sending SMS to ${phoneNumber}: "${message}"`);

      // Validate message length
      if (message.length > 160) {
        console.warn(`⚠️ SMS message too long: ${message.length} chars`);
        message = message.substring(0, 157) + '...';
      }

      const formattedNumber = this.formatPhoneNumber(phoneNumber);

      const result = await this.client.messages.create({
        body: message,
        from: this.from,
        to: formattedNumber
      });

      console.log(`✅ SMS sent - SID: ${result.sid}, Status: ${result.status}`);

      return {
        success: true,
        result: result,
        provider: 'twilio',
        cost: result.price
      };

    } catch (error) {
      console.error('❌ Twilio SMS error:', error);
      throw new Error(`SMS send failed: ${error.message}`);
    }
  }

  /**
   * Format phone number to E.164 format required by Twilio
   */
  formatPhoneNumber(phoneNumber) {
    let formatted = phoneNumber.replace(/[^\d+]/g, '');

    if (!formatted.startsWith('+') && formatted.length > 10) {
      formatted = '+' + formatted;
    }

    if (formatted.length === 8 && !formatted.startsWith('+')) {
      formatted = '+226' + formatted;
    }

    console.log(`📞 Phone number formatted: ${phoneNumber} → ${formatted}`);
    return formatted;
  }

  /**
   * Get SMS delivery reports
   */
  async getDeliveryReports() {
    if (!this.initialized) {
      throw new Error('Twilio not initialized');
    }

    try {
      const messages = await this.client.messages.list({ limit: 20 });
      console.log(`📊 Fetched ${messages.length} delivery reports`);
      return messages;
    } catch (error) {
      console.error('❌ Error fetching delivery reports:', error);
      throw error;
    }
  }

  /**
   * Get account balance
   */
  async getBalance() {
    if (!this.initialized) {
      throw new Error('Twilio not initialized');
    }

    try {
      const balance = await this.client.balance.fetch();
      console.log(`💰 Twilio balance: ${balance.balance} ${balance.currency}`);
      return balance;
    } catch (error) {
      console.error('❌ Error fetching balance:', error);
      throw error;
    }
  }
}

module.exports = new SmsService();
