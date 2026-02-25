const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
require('dotenv').config();

const app = express();

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Log all incoming requests
app.use((req, res, next) => {
  console.log(`📨 ${req.method} ${req.path} - ${new Date().toISOString()}`);
  next();
});

// Auth middleware
const authMiddleware = require('./middleware/auth');

// Public routes (no auth required)
app.use('/api/sms', require('./routes/sms'));

// User routes: skip auth for register and login
app.use('/api/users', (req, res, next) => {
  const publicPaths = ['/register', '/login', '/reset-pin'];
  if (publicPaths.includes(req.path) && req.method === 'POST') {
    return next();
  }
  authMiddleware(req, res, next);
}, require('./routes/users'));

// Protected routes (auth required)
app.use('/api/transactions', authMiddleware, require('./routes/transactions'));

// Health check endpoint with Prisma stats
app.get('/health', async (req, res) => {
  try {
    const PrismaService = require('./services/prismaService');
    const stats = await PrismaService.getStats();

    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      version: '1.0.0',
      smsProvider: 'AfricasTalking',
      database: 'PostgreSQL + Prisma ORM',
      stats: stats
    });
  } catch (error) {
    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      database: 'PostgreSQL + Prisma ORM',
      dbError: 'Could not fetch stats'
    });
  }
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    message: 'Resilient SMS Server - AfricasTalking Gateway',
    version: '1.0.0',
    endpoints: {
      health: 'GET /health',
      sms: {
        webhook: 'POST /api/sms/webhook',
        send: 'POST /api/sms/send',
        balance: 'GET /api/sms/balance',
        test: 'GET /api/sms/test'
      },
      transactions: {
        transfer: 'POST /api/transactions/transfer',
        payment: 'POST /api/transactions/payment',
        balance: 'GET /api/transactions/balance',
        history: 'GET /api/transactions/history',
        details: 'GET /api/transactions/:transactionId'
      },
      users: {
        register: 'POST /api/users/register',
        login: 'POST /api/users/login',
        resetPin: 'POST /api/users/reset-pin',
        profile: 'GET /api/users/:userId',
        changePin: 'PUT /api/users/:userId/pin',
        list: 'GET /api/users'
      }
    }
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('❌ Server Error:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: err.message
  });
});

// 404 handler (Express 5 syntax)
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('🛑 Shutting down server...');
  try {
    const PrismaService = require('./services/prismaService');
    await PrismaService.disconnect();
  } catch (error) {
    // Ignore if service not initialized
  }
  process.exit(0);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Resilient SMS Server running on port ${PORT}`);
  console.log(`📱 SMS webhook: http://localhost:${PORT}/api/sms/webhook`);
  console.log(`🏥 Health check: http://localhost:${PORT}/health`);
  console.log(`📡 SMS Provider: AfricasTalking`);
  console.log(`💾 Database: PostgreSQL + Prisma ORM`);
});
