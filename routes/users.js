const express = require('express');
const router = express.Router();
const PrismaService = require('../services/prismaService');
const ResponseFormatter = require('../utils/responseFormatter');
const { hashPin, verifyPin } = require('../utils/pinEncryption');

/**
 * POST /api/users/register
 * Register a new user
 */
router.post('/register', async (req, res) => {
  const { name, phone, pin } = req.body;

  console.log(`👤 API User registration: ${phone}`);

  try {
    // Validate required fields
    if (!phone || !pin) {
      return res.status(400).json({
        status: 'error',
        code: 'MISSING_FIELDS',
        message: 'phone and pin are required'
      });
    }

    // Validate PIN format (4 digits)
    if (!/^\d{4}$/.test(pin)) {
      return res.status(400).json({
        status: 'error',
        code: 'INVALID_PIN_FORMAT',
        message: 'PIN must be 4 digits'
      });
    }

    // Check if phone already exists
    const existingUser = await PrismaService.getUserByPhone(phone);
    if (existingUser) {
      return res.status(409).json({
        status: 'error',
        code: 'PHONE_EXISTS',
        message: 'Phone number already registered'
      });
    }

    // Generate user ID
    const userId = `USER${Date.now().toString().slice(-6)}`;

    // Hash PIN before storing
    const hashedPin = await hashPin(pin);

    // Create user
    const user = await PrismaService.createUser({
      userId,
      name: name || null,
      phone,
      pin: hashedPin,
      balance: 0
    });

    console.log(`✅ User registered: ${userId}`);

    res.status(201).json({
      status: 'success',
      data: {
        userId: user.userId,
        name: user.name,
        phone: user.phone,
        balance: user.balance,
        createdAt: user.createdAt
      }
    });

  } catch (error) {
    console.error('❌ Registration API error:', error);
    res.status(500).json({
      status: 'error',
      code: 'REGISTRATION_FAILED',
      message: error.message
    });
  }
});

/**
 * POST /api/users/login
 * Authenticate user with phone and PIN
 */
router.post('/login', async (req, res) => {
  const { phone, pin } = req.body;

  console.log(`🔐 API User login: ${phone}`);

  try {
    // Validate required fields
    if (!phone || !pin) {
      return res.status(400).json({
        status: 'error',
        code: 'MISSING_FIELDS',
        message: 'phone and pin are required'
      });
    }

    // Get user by phone
    const user = await PrismaService.getUserByPhone(phone);
    if (!user) {
      return res.status(401).json({
        status: 'error',
        code: 'INVALID_CREDENTIALS',
        message: 'Invalid phone or PIN'
      });
    }

    // Validate PIN
    const pinValid = await verifyPin(pin, user.pin);
    if (!pinValid) {
      return res.status(401).json({
        status: 'error',
        code: 'INVALID_CREDENTIALS',
        message: 'Invalid phone or PIN'
      });
    }

    // Generate simple token (in production, use JWT)
    const token = Buffer.from(`${user.userId}:${Date.now()}`).toString('base64');

    console.log(`✅ User logged in: ${user.userId}`);

    res.json({
      status: 'success',
      data: {
        userId: user.userId,
        name: user.name,
        phone: user.phone,
        balance: user.balance,
        formattedBalance: `${ResponseFormatter.formatAmount(user.balance)} FCFA`,
        token
      }
    });

  } catch (error) {
    console.error('❌ Login API error:', error);
    res.status(500).json({
      status: 'error',
      code: 'LOGIN_FAILED',
      message: error.message
    });
  }
});

/**
 * GET /api/users/:userId
 * Get user profile
 */
router.get('/:userId', async (req, res) => {
  const { userId } = req.params;

  console.log(`👤 API Get user profile: ${userId}`);

  try {
    const user = await PrismaService.getUser(userId);

    if (!user) {
      return res.status(404).json({
        status: 'error',
        code: 'USER_NOT_FOUND',
        message: 'User not found'
      });
    }

    res.json({
      status: 'success',
      data: {
        userId: user.userId,
        name: user.name,
        phone: user.phone,
        balance: user.balance,
        formattedBalance: `${ResponseFormatter.formatAmount(user.balance)} FCFA`,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt
      }
    });

  } catch (error) {
    console.error('❌ Get user API error:', error);
    res.status(500).json({
      status: 'error',
      code: 'GET_USER_FAILED',
      message: error.message
    });
  }
});

/**
 * PUT /api/users/:userId/pin
 * Change user PIN
 */
router.put('/:userId/pin', async (req, res) => {
  const { userId } = req.params;
  const { currentPin, newPin } = req.body;

  console.log(`🔑 API Change PIN: ${userId}`);

  try {
    // Validate required fields
    if (!currentPin || !newPin) {
      return res.status(400).json({
        status: 'error',
        code: 'MISSING_FIELDS',
        message: 'currentPin and newPin are required'
      });
    }

    // Validate new PIN format
    if (!/^\d{4}$/.test(newPin)) {
      return res.status(400).json({
        status: 'error',
        code: 'INVALID_PIN_FORMAT',
        message: 'New PIN must be 4 digits'
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

    // Validate current PIN
    const pinValid = await verifyPin(currentPin, user.pin);
    if (!pinValid) {
      return res.status(403).json({
        status: 'error',
        code: 'INVALID_PIN',
        message: 'Current PIN is incorrect'
      });
    }

    // Hash and update PIN
    const hashedNewPin = await hashPin(newPin);
    await PrismaService.updateUserPin(userId, hashedNewPin);

    console.log(`✅ PIN changed: ${userId}`);

    res.json({
      status: 'success',
      message: 'PIN updated successfully'
    });

  } catch (error) {
    console.error('❌ Change PIN API error:', error);
    res.status(500).json({
      status: 'error',
      code: 'CHANGE_PIN_FAILED',
      message: error.message
    });
  }
});

/**
 * GET /api/users
 * List all users (for testing/admin)
 */
router.get('/', async (req, res) => {
  console.log(`👥 API List users`);

  try {
    const users = await PrismaService.getAllUsers();

    res.json({
      status: 'success',
      data: {
        users: users.map(user => ({
          userId: user.userId,
          name: user.name,
          phone: user.phone,
          balance: user.balance,
          formattedBalance: `${ResponseFormatter.formatAmount(user.balance)} FCFA`,
          createdAt: user.createdAt
        })),
        total: users.length
      }
    });

  } catch (error) {
    console.error('❌ List users API error:', error);
    res.status(500).json({
      status: 'error',
      code: 'LIST_USERS_FAILED',
      message: error.message
    });
  }
});

module.exports = router;
