const bcrypt = require('bcrypt');

const SALT_ROUNDS = 10;

/**
 * Hash a PIN using bcrypt
 * @param {string} pin - Plain text PIN
 * @returns {Promise<string>} Hashed PIN
 */
async function hashPin(pin) {
  return bcrypt.hash(pin, SALT_ROUNDS);
}

/**
 * Verify a PIN against a hashed PIN
 * @param {string} pin - Plain text PIN to verify
 * @param {string} hashedPin - Hashed PIN from database
 * @returns {Promise<boolean>} True if PIN matches
 */
async function verifyPin(pin, hashedPin) {
  return bcrypt.compare(pin, hashedPin);
}

/**
 * Check if a PIN is already hashed (bcrypt hashes start with $2)
 * @param {string} pin - PIN to check
 * @returns {boolean} True if PIN appears to be hashed
 */
function isHashed(pin) {
  return pin && pin.startsWith('$2');
}

module.exports = {
  hashPin,
  verifyPin,
  isHashed,
};
