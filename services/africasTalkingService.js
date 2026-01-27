const africastalking = require('africastalking');

class AfricasTalkingService {
  constructor() {
    // Validate required credentials
    if (!process.env.AFRICASTALKING_API_KEY || !process.env.AFRICASTALKING_USERNAME) {
      console.warn('⚠️ AfricasTalking credentials not configured. SMS sending will fail.');
      this.initialized = false;
      return;
    }

    // Initialize AfricasTalking client
    this.client = africastalking({
      apiKey: process.env.AFRICASTALKING_API_KEY,
      username: process.env.AFRICASTALKING_USERNAME,
    });

    this.sms = this.client.SMS;
    this.initialized = true;

    console.log(`✅ AfricasTalking initialized - Username: ${process.env.AFRICASTALKING_USERNAME}`);
  }

  /**
   * Send SMS via AfricasTalking
   */
  async sendSMS(phoneNumber, message) {
    if (!this.initialized) {
      console.error('❌ AfricasTalking not initialized. Check credentials.');
      throw new Error('AfricasTalking not initialized');
    }

    try {
      console.log(`📤 Sending SMS to ${phoneNumber}: "${message}"`);

      // Validate message length
      if (message.length > 160) {
        console.warn(`⚠️ SMS message too long: ${message.length} chars`);
        message = message.substring(0, 157) + '...';
      }

      // Format phone number
      const formattedNumber = this.formatPhoneNumber(phoneNumber);

      // Prepare SMS options
      const options = {
        to: [formattedNumber],
        message: message,
      };

      // Add sender ID if configured
      if (process.env.SMS_SHORTCODE) {
        options.from = process.env.SMS_SHORTCODE;
      }

      // Send SMS
      const result = await this.sms.send(options);

      // Log result
      if (result.SMSMessageData.Recipients.length > 0) {
        const recipient = result.SMSMessageData.Recipients[0];
        console.log(`✅ SMS sent - Status: ${recipient.status}, Cost: ${recipient.cost}`);
      }

      return {
        success: true,
        result: result,
        provider: 'africastalking',
        cost: result.SMSMessageData.Recipients[0]?.cost
      };

    } catch (error) {
      console.error('❌ AfricasTalking SMS error:', error);
      throw new Error(`SMS send failed: ${error.message}`);
    }
  }

  /**
   * Format phone number for AfricasTalking
   */
  formatPhoneNumber(phoneNumber) {
    // Remove any non-digit characters except +
    let formatted = phoneNumber.replace(/[^\d+]/g, '');

    // Add + if missing and number looks international
    if (!formatted.startsWith('+') && formatted.length > 10) {
      formatted = '+' + formatted;
    }

    // Ensure Burkina Faso format for local numbers
    if (formatted.length === 8 && !formatted.startsWith('+')) {
      formatted = '+226' + formatted; // Burkina Faso country code
    }

    console.log(`📞 Phone number formatted: ${phoneNumber} → ${formatted}`);
    return formatted;
  }

  /**
   * Get SMS delivery reports
   */
  async getDeliveryReports() {
    if (!this.initialized) {
      throw new Error('AfricasTalking not initialized');
    }

    try {
      const reports = await this.sms.fetchMessages();
      console.log(`📊 Fetched ${reports.SMSMessageData.Messages.length} delivery reports`);
      return reports;
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
      throw new Error('AfricasTalking not initialized');
    }

    try {
      const balance = await this.client.APPLICATION.fetchApplicationData();
      console.log(`💰 AfricasTalking balance: ${balance.UserData.balance}`);
      return balance;
    } catch (error) {
      console.error('❌ Error fetching balance:', error);
      throw error;
    }
  }
}

module.exports = new AfricasTalkingService();
