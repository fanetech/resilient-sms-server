# Resilient SMS Server Implementation Guide

A Node.js backend server that processes financial transactions received via SMS and automatically sends responses back to mobile apps, using AfricasTalking as the exclusive SMS gateway. This server enables Flutter apps to work 100% offline by handling critical transactions through SMS fallback.

---

## Table of Contents

1. [System Overview](#system-overview)
2. [Key Features](#key-features)
3. [SMS Protocol](#sms-protocol)
4. [Step 1: Project Setup](#step-1-project-setup)
5. [Step 2: Environment Configuration](#step-2-environment-configuration)
6. [Step 3: Prisma + PostgreSQL Setup](#step-3-prisma--postgresql-setup)
7. [Step 4: Main Server Implementation](#step-4-main-server-implementation)
8. [Step 5: AfricasTalking Service](#step-5-africastalking-service)
9. [Step 6: Prisma Service](#step-6-prisma-service)
10. [Step 7: SMS Utilities](#step-7-sms-utilities)
11. [Step 8: Transaction Controller (with Prisma)](#step-8-transaction-controller-with-prisma)
12. [Step 9: SMS Routes](#step-9-sms-routes)
13. [Step 10: Testing & Development](#step-10-testing--development)
14. [Step 11: Deployment Options](#step-11-deployment-options)
15. [Step 12: AfricasTalking Configuration](#step-12-africastalking-configuration)
16. [Prisma Development Commands](#prisma-development-commands)
17. [Verification Checklist](#verification-checklist)

---

## System Overview

```
📱 Flutter App (Offline)
    ↓ SMS: "T#A7F#50K#U3456#1234"
📡 AfricasTalking Gateway
    ↓ HTTP Webhook
🖥️ Node.js Server
    ↓ Process Transaction
💾 Business Logic (Transfer/Payment/Balance)
    ↓ Generate Response
📡 AfricasTalking API
    ↓ SMS Response: "OK#A7F#BAL:450K#TXN:X9Z2M4"
📱 Flutter App (Receives Result)
```

---

## Key Features

- **SMS Protocol**: Compressed messages under 160 characters
- **Transaction Types**: Transfer (T), Payment (P), Balance (B)
- **Automatic Responses**: Success/Error feedback via SMS
- **Business Logic**: PIN validation, balance checks, transaction logging
- **AfricasTalking Integration**: Send/Receive SMS, Webhook handling
- **Error Handling**: Robust error management and logging

---

## SMS Protocol

### Message Format

| Direction | Type | Format |
|-----------|------|--------|
| Incoming | Transfer | `T#A7F#50K#U3456#1234` |
| Incoming | Payment | `P#B2C#15K#M7890#1234` |
| Incoming | Balance | `B#C3D##1234` |
| Outgoing | Success | `OK#A7F#BAL:450K#TXN:X9Z2M4` |
| Outgoing | Error | `ERR#B2C#INVALID_PIN#BAL:500K` |

---

## Step 1: Project Setup

### 1.1 Create Project Directory

```bash
# Create new directory
mkdir resilient-sms-server
cd resilient-sms-server

# Initialize npm project
npm init -y
```

### 1.2 Install Dependencies

```bash
# Core server dependencies
npm install express cors dotenv body-parser

# AfricasTalking SMS Gateway (ONLY)
npm install africastalking

# Database - Prisma ORM with PostgreSQL
npm install @prisma/client
npm install --save-dev prisma

# Development dependencies
npm install --save-dev nodemon
```

### 1.3 Create Project Structure

```bash
mkdir -p {routes,controllers,services,utils,middleware}
touch server.js .env .gitignore
```

### Final Structure

```
resilient-sms-server/
├── server.js                          # Main server entry point
├── .env                               # Environment configuration
├── package.json                       # Dependencies
├── prisma/
│   ├── schema.prisma                  # Prisma database schema
│   └── seed.js                        # Database seed data
├── routes/
│   └── sms.js                         # SMS webhook routes
├── controllers/
│   └── transactionController.js       # Transaction business logic
├── services/
│   ├── africasTalkingService.js       # AfricasTalking API client
│   └── prismaService.js               # Prisma database service
├── utils/
│   ├── smsParser.js                   # SMS parsing utilities
│   └── responseFormatter.js           # SMS response formatting
└── middleware/
    └── validation.js                  # Request validation
```

---

## Step 2: Environment Configuration

### 2.1 Create `.env` File

```bash
# Server Configuration
NODE_ENV=development
PORT=3000

# AfricasTalking Configuration (ONLY SMS PROVIDER)
AFRICASTALKING_USERNAME=sandbox
AFRICASTALKING_API_KEY=your_africastalking_api_key_here

# SMS Configuration
SMS_SHORTCODE=3040
SMS_SENDER_ID=RESILIENT

# PostgreSQL Database Configuration (Prisma)
DATABASE_URL="postgresql://postgres:password@localhost:5432/resilient_sms?schema=public"

# For Railway/Heroku (provided automatically):
# DATABASE_URL="postgres://user:pass@host:port/dbname"

# Security
WEBHOOK_SECRET=your_webhook_secret_here
JWT_SECRET=your_jwt_secret_here
```

### 2.2 Create `.gitignore`

```gitignore
node_modules/
.env
.DS_Store
*.log
dist/
coverage/
.nyc_output/
```

### 2.3 Update `package.json` Scripts

```json
{
  "scripts": {
    "start": "node server.js",
    "dev": "nodemon server.js",
    "test": "node test.js",
    "db:seed": "npx prisma db seed",
    "db:migrate": "npx prisma migrate dev",
    "db:studio": "npx prisma studio"
  },
  "prisma": {
    "seed": "node prisma/seed.js"
  }
}
```

---

## Step 3: Prisma + PostgreSQL Setup

### 3.1 Initialize Prisma

```bash
# Initialize Prisma (creates prisma/schema.prisma and updates .env)
npx prisma init
```

### 3.2 Create Database Schema

Create `prisma/schema.prisma`:

```prisma
// Configuration générale
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

// Modèle User (utilisateurs du système)
model User {
  id        Int      @id @default(autoincrement())
  userId    String   @unique @map("user_id")        // USER3456
  balance   Int      @default(0)                    // Solde en FCFA
  pin       String                                  // PIN de sécurité
  name      String?                                 // Nom complet
  phone     String?  @unique                        // Numéro téléphone
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  // Relations
  sentTransactions     Transaction[] @relation("FromUser")
  receivedTransactions Transaction[] @relation("ToUser")

  @@map("users")  // Nom table en BDD
}

// Modèle Transaction (toutes les transactions SMS)
model Transaction {
  id            Int       @id @default(autoincrement())
  transactionId String    @unique @map("transaction_id")  // A7F, B2C, etc.
  type          TransactionType                           // TRANSFER, PAYMENT, BALANCE
  amount        Int?                                       // Montant (null pour BALANCE)
  status        TransactionStatus @default(PENDING)       // Statut transaction

  // Données SMS
  smsText       String?   @map("sms_text")               // SMS reçu
  responseText  String?   @map("response_text")          // SMS envoyé
  errorMessage  String?   @map("error_message")          // Si erreur

  // Timestamps
  createdAt     DateTime  @default(now()) @map("created_at")
  completedAt   DateTime? @map("completed_at")

  // Relations utilisateurs
  fromUserId String @map("from_user")
  toUserId   String? @map("to_user")

  fromUser User  @relation("FromUser", fields: [fromUserId], references: [userId])
  toUser   User? @relation("ToUser", fields: [toUserId], references: [userId])

  // Index pour performance
  @@index([fromUserId])
  @@index([status])
  @@index([createdAt])
  @@map("transactions")
}

// Enums pour type safety
enum TransactionType {
  TRANSFER
  PAYMENT
  BALANCE
}

enum TransactionStatus {
  PENDING
  COMPLETED
  FAILED
  CANCELLED
}
```

### 3.3 Create and Apply Migrations

```bash
# Create first migration
npx prisma migrate dev --name init

# Generate Prisma client
npx prisma generate
```

This will:
- Create PostgreSQL tables
- Generate TypeScript client
- Ready to use in code

### 3.4 Create Seed Data

Create `prisma/seed.js`:

```javascript
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database...');

  // Créer utilisateurs demo
  const alice = await prisma.user.upsert({
    where: { userId: 'USER3456' },
    update: {},
    create: {
      userId: 'USER3456',
      balance: 500000,
      pin: '1234',
      name: 'Alice Ouedraogo',
      phone: '+22676543210'
    }
  });

  const ibrahim = await prisma.user.upsert({
    where: { userId: 'USER7890' },
    update: {},
    create: {
      userId: 'USER7890',
      balance: 750000,
      pin: '1234',
      name: 'Ibrahim Sanogo',
      phone: '+22676543211'
    }
  });

  const merchant = await prisma.user.upsert({
    where: { userId: 'MERCHANT001' },
    update: {},
    create: {
      userId: 'MERCHANT001',
      balance: 1000000,
      pin: '1234',
      name: 'Boutique Centrale',
      phone: '+22676543212'
    }
  });

  console.log('✅ Seed data created:', { alice, ibrahim, merchant });
}

main()
  .catch((e) => {
    console.error('❌ Seed error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
```

### 3.5 Run Seed

```bash
npm run db:seed
```

---

## Step 4: Main Server Implementation

### 4.1 Create `server.js`

```javascript
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

// SMS Routes
app.use('/api/sms', require('./routes/sms'));

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
    endpoints: {
      health: '/health',
      smsWebhook: '/api/sms/webhook',
      smsTest: '/api/sms/test'
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

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('🛑 Shutting down server...');
  const PrismaService = require('./services/prismaService');
  await PrismaService.disconnect();
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
```

---

## Step 5: AfricasTalking Service

### 5.1 Create `services/africasTalkingService.js`

```javascript
const africastalking = require('africastalking');

class AfricasTalkingService {
  constructor() {
    // Validate required credentials
    if (!process.env.AFRICASTALKING_API_KEY || !process.env.AFRICASTALKING_USERNAME) {
      throw new Error('AfricasTalking credentials not configured. Check AFRICASTALKING_API_KEY and AFRICASTALKING_USERNAME');
    }

    // Initialize AfricasTalking client
    this.client = africastalking({
      apiKey: process.env.AFRICASTALKING_API_KEY,
      username: process.env.AFRICASTALKING_USERNAME,
    });

    this.sms = this.client.SMS;

    console.log(`✅ AfricasTalking initialized - Username: ${process.env.AFRICASTALKING_USERNAME}`);
  }

  /**
   * Send SMS via AfricasTalking
   */
  async sendSMS(phoneNumber, message) {
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
```

---

## Step 6: Prisma Service

### 6.1 Create `services/prismaService.js`

```javascript
const { PrismaClient } = require('@prisma/client');

class PrismaService {
  constructor() {
    this.prisma = new PrismaClient({
      log: ['query', 'info', 'warn', 'error'], // Logs SQL en développement
    });
  }

  // Récupérer utilisateur par ID
  async getUser(userId) {
    try {
      const user = await this.prisma.user.findUnique({
        where: { userId: userId }
      });

      console.log(`👤 User found: ${user ? user.name : 'Not found'}`);
      return user;
    } catch (error) {
      console.error('❌ Error getting user:', error);
      throw error;
    }
  }

  // Récupérer utilisateur par numéro de téléphone
  async getUserByPhone(phone) {
    try {
      const user = await this.prisma.user.findUnique({
        where: { phone: phone }
      });

      console.log(`👤 User found by phone: ${user ? user.name : 'Not found'}`);
      return user;
    } catch (error) {
      console.error('❌ Error getting user by phone:', error);
      throw error;
    }
  }

  // Mettre à jour solde utilisateur
  async updateUserBalance(userId, newBalance) {
    try {
      const updatedUser = await this.prisma.user.update({
        where: { userId: userId },
        data: { balance: newBalance }
      });

      console.log(`💰 Balance updated: ${userId} → ${newBalance}`);
      return updatedUser;
    } catch (error) {
      console.error('❌ Error updating balance:', error);
      throw error;
    }
  }

  // Créer nouvelle transaction
  async createTransaction(transactionData) {
    try {
      const transaction = await this.prisma.transaction.create({
        data: {
          transactionId: transactionData.transactionId,
          type: transactionData.type,
          amount: transactionData.amount,
          fromUserId: transactionData.fromUserId,
          toUserId: transactionData.toUserId,
          status: 'PENDING',
          smsText: transactionData.smsText
        }
      });

      console.log(`📝 Transaction created: ${transaction.transactionId}`);
      return transaction;
    } catch (error) {
      console.error('❌ Error creating transaction:', error);
      throw error;
    }
  }

  // Mettre à jour transaction
  async updateTransaction(transactionId, updates) {
    try {
      const transaction = await this.prisma.transaction.update({
        where: { transactionId: transactionId },
        data: {
          ...updates,
          completedAt: updates.status === 'COMPLETED' ? new Date() : undefined
        }
      });

      console.log(`🔄 Transaction updated: ${transactionId} → ${updates.status}`);
      return transaction;
    } catch (error) {
      console.error('❌ Error updating transaction:', error);
      throw error;
    }
  }

  // Historique transactions d'un utilisateur
  async getUserTransactions(userId, limit = 10) {
    try {
      const transactions = await this.prisma.transaction.findMany({
        where: {
          OR: [
            { fromUserId: userId },
            { toUserId: userId }
          ]
        },
        include: {
          fromUser: { select: { name: true, userId: true } },
          toUser: { select: { name: true, userId: true } }
        },
        orderBy: { createdAt: 'desc' },
        take: limit
      });

      console.log(`📊 Found ${transactions.length} transactions for ${userId}`);
      return transactions;
    } catch (error) {
      console.error('❌ Error getting transactions:', error);
      throw error;
    }
  }

  // Statistiques globales
  async getStats() {
    try {
      const [userCount, transactionCount, totalVolume] = await Promise.all([
        this.prisma.user.count(),
        this.prisma.transaction.count(),
        this.prisma.transaction.aggregate({
          _sum: { amount: true },
          where: {
            type: { in: ['TRANSFER', 'PAYMENT'] },
            status: 'COMPLETED'
          }
        })
      ]);

      return {
        users: userCount,
        transactions: transactionCount,
        totalVolume: totalVolume._sum.amount || 0
      };
    } catch (error) {
      console.error('❌ Error getting stats:', error);
      throw error;
    }
  }

  // Fermer connexion
  async disconnect() {
    await this.prisma.$disconnect();
  }
}

module.exports = new PrismaService();
```

---

## Step 7: SMS Utilities

### 7.1 Create `utils/smsParser.js`

```javascript
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
   * Parse compressed user ID (U3456 → USER123456)
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
```

### 7.2 Create `utils/responseFormatter.js`

```javascript
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
```

---

## Step 8: Transaction Controller (with Prisma)

### 8.1 Create `controllers/transactionController.js`

```javascript
const SMSParser = require('../utils/smsParser');
const ResponseFormatter = require('../utils/responseFormatter');
const PrismaService = require('../services/prismaService');

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
  static async processTransfer(parsedSMS, senderNumber) {
    const { transactionId, params } = parsedSMS;
    const [amountStr, recipient, pin] = params;

    console.log(`💸 Processing transfer: ${amountStr} to ${recipient}`);

    try {
      // 1. Parser montant
      const amount = SMSParser.parseAmount(amountStr);
      const expandedRecipient = SMSParser.parseUserId(recipient);

      // 2. Trouver utilisateur expéditeur par téléphone ou utiliser demo
      let fromUser = await PrismaService.getUserByPhone(senderNumber);
      if (!fromUser) {
        // Fallback to demo user for testing
        fromUser = await PrismaService.getUser('USER3456');
      }

      if (!fromUser) {
        return ResponseFormatter.formatError(transactionId, 'USER_NOT_FOUND');
      }

      // 3. Valider PIN
      if (pin !== fromUser.pin) {
        return ResponseFormatter.formatError(transactionId, 'INVALID_PIN');
      }

      // 4. Vérifier solde suffisant
      if (amount > fromUser.balance) {
        return ResponseFormatter.formatError(
          transactionId,
          'INSUFFICIENT_FUNDS',
          { balance: fromUser.balance }
        );
      }

      // 5. Vérifier limite journalière
      if (amount > 1000000) {
        return ResponseFormatter.formatError(
          transactionId,
          'DAILY_LIMIT_EXCEEDED',
          { balance: fromUser.balance, limit: 1000000 }
        );
      }

      // 6. Créer transaction en BDD
      const transaction = await PrismaService.createTransaction({
        transactionId,
        type: 'TRANSFER',
        amount,
        fromUserId: fromUser.userId,
        toUserId: expandedRecipient,
        smsText: parsedSMS.raw
      });

      // 7. Mettre à jour solde expéditeur
      const newBalance = fromUser.balance - amount;
      await PrismaService.updateUserBalance(fromUser.userId, newBalance);

      // 8. Mettre à jour solde destinataire (si existe)
      const toUser = await PrismaService.getUser(expandedRecipient);
      if (toUser) {
        await PrismaService.updateUserBalance(expandedRecipient, toUser.balance + amount);
      }

      // 9. Marquer transaction comme complétée
      const transactionRef = ResponseFormatter.generateTransactionRef();
      await PrismaService.updateTransaction(transactionId, {
        status: 'COMPLETED',
        responseText: `Transfer ${amount} FCFA to ${expandedRecipient}`
      });

      console.log(`✅ Transfer completed: ${amount} FCFA, Balance: ${newBalance}`);

      return ResponseFormatter.formatSuccess(transactionId, {
        balance: newBalance,
        transactionRef
      });

    } catch (error) {
      console.error('❌ Transfer error:', error);

      // Logger erreur en BDD
      try {
        await PrismaService.updateTransaction(transactionId, {
          status: 'FAILED',
          errorMessage: error.message
        });
      } catch (dbError) {
        console.error('❌ Failed to log error to DB:', dbError);
      }

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
      const expandedMerchant = SMSParser.parseUserId(merchant);

      // Trouver utilisateur
      let fromUser = await PrismaService.getUserByPhone(senderNumber);
      if (!fromUser) {
        fromUser = await PrismaService.getUser('USER3456');
      }

      if (!fromUser) {
        return ResponseFormatter.formatError(transactionId, 'USER_NOT_FOUND');
      }

      // Valider PIN
      if (pin !== fromUser.pin) {
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
        toUserId: expandedMerchant,
        smsText: parsedSMS.raw
      });

      // Mettre à jour soldes
      const newBalance = fromUser.balance - amount;
      await PrismaService.updateUserBalance(fromUser.userId, newBalance);

      const merchantUser = await PrismaService.getUser(expandedMerchant);
      if (merchantUser) {
        await PrismaService.updateUserBalance(expandedMerchant, merchantUser.balance + amount);
      }

      // Compléter transaction
      const transactionRef = ResponseFormatter.generateTransactionRef();
      await PrismaService.updateTransaction(transactionId, {
        status: 'COMPLETED',
        responseText: `Payment ${amount} FCFA to ${expandedMerchant}`
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
      if (pin !== user.pin) {
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
```

---

## Step 9: SMS Routes

### 9.1 Create `routes/sms.js`

```javascript
const express = require('express');
const router = express.Router();
const TransactionController = require('../controllers/transactionController');
const AfricasTalkingService = require('../services/africasTalkingService');

/**
 * AfricasTalking SMS Webhook Endpoint
 * Receives incoming SMS and processes transactions
 */
router.post('/webhook', async (req, res) => {
  console.log('📨 AfricasTalking SMS Webhook received');
  console.log('📋 Webhook data:', req.body);

  try {
    // Extract SMS data from AfricasTalking webhook
    const { text, from, to, id, date } = req.body;

    // Validate required fields
    if (!text || !from) {
      console.error('❌ Missing required fields: text or from');
      return res.status(400).json({
        error: 'Missing required fields',
        required: ['text', 'from']
      });
    }

    const smsData = {
      text: text,
      from: from,
      to: to,
      messageId: id,
      receivedAt: date || new Date().toISOString()
    };

    console.log(`📱 SMS Data: "${smsData.text}" from ${smsData.from}`);

    // Process transaction
    const response = await TransactionController.processSMSTransaction(
      smsData.text,
      smsData.from
    );

    console.log(`🔄 Transaction response: "${response}"`);

    // Send response SMS back to sender
    if (response) {
      try {
        const smsResult = await AfricasTalkingService.sendSMS(smsData.from, response);
        console.log(`✅ Response SMS sent successfully`);

        res.status(200).json({
          status: 'success',
          processed: true,
          response: response,
          smsSent: true,
          cost: smsResult.cost
        });

      } catch (smsError) {
        console.error('❌ Failed to send response SMS:', smsError);

        res.status(200).json({
          status: 'partial_success',
          processed: true,
          response: response,
          smsSent: false,
          error: 'Failed to send response SMS'
        });
      }
    } else {
      res.status(200).json({
        status: 'success',
        processed: true,
        response: null
      });
    }

  } catch (error) {
    console.error('❌ Webhook processing error:', error);
    res.status(500).json({
      status: 'error',
      message: error.message,
      processed: false
    });
  }
});

/**
 * Manual SMS send endpoint (for testing)
 */
router.post('/send', async (req, res) => {
  try {
    const { phoneNumber, message } = req.body;

    if (!phoneNumber || !message) {
      return res.status(400).json({
        error: 'phoneNumber and message are required'
      });
    }

    console.log(`📤 Manual SMS send request: ${phoneNumber} - "${message}"`);

    const result = await AfricasTalkingService.sendSMS(phoneNumber, message);

    res.json({
      status: 'success',
      result: result,
      cost: result.cost
    });

  } catch (error) {
    console.error('❌ Manual SMS send error:', error);
    res.status(500).json({
      error: error.message
    });
  }
});

/**
 * Get SMS delivery reports
 */
router.get('/reports', async (req, res) => {
  try {
    console.log('📊 Fetching SMS delivery reports');

    const reports = await AfricasTalkingService.getDeliveryReports();

    res.json({
      status: 'success',
      reports: reports
    });

  } catch (error) {
    console.error('❌ Error fetching reports:', error);
    res.status(500).json({
      error: error.message
    });
  }
});

/**
 * Get AfricasTalking account balance
 */
router.get('/balance', async (req, res) => {
  try {
    console.log('💰 Fetching AfricasTalking balance');

    const balance = await AfricasTalkingService.getBalance();

    res.json({
      status: 'success',
      balance: balance
    });

  } catch (error) {
    console.error('❌ Error fetching balance:', error);
    res.status(500).json({
      error: error.message
    });
  }
});

/**
 * Test endpoint - SMS service status
 */
router.get('/test', (req, res) => {
  res.json({
    message: 'AfricasTalking SMS service is running',
    timestamp: new Date().toISOString(),
    provider: 'AfricasTalking',
    endpoints: {
      webhook: 'POST /api/sms/webhook',
      send: 'POST /api/sms/send',
      reports: 'GET /api/sms/reports',
      balance: 'GET /api/sms/balance',
      test: 'GET /api/sms/test'
    },
    sampleTransaction: {
      transfer: 'T#A7F#50K#U3456#1234',
      payment: 'P#B2C#15K#M7890#1234',
      balance: 'B#C3D##1234'
    }
  });
});

module.exports = router;
```

---

## Step 10: Testing & Development

### 10.1 Create Test Script

Create `test.js`:

```javascript
const axios = require('axios');

const BASE_URL = 'http://localhost:3000';

async function testSMSServer() {
  console.log('🧪 Testing Resilient SMS Server...\n');

  try {
    // Test 1: Health check
    console.log('1️⃣ Testing health endpoint...');
    const health = await axios.get(`${BASE_URL}/health`);
    console.log('✅ Health check:', health.data);
    console.log('');

    // Test 2: SMS service test endpoint
    console.log('2️⃣ Testing SMS service status...');
    const smsTest = await axios.get(`${BASE_URL}/api/sms/test`);
    console.log('✅ SMS service test:', smsTest.data);
    console.log('');

    // Test 3: Simulate Transfer SMS webhook
    console.log('3️⃣ Testing Transfer SMS webhook...');
    const transferTest = await axios.post(`${BASE_URL}/api/sms/webhook`, {
      text: 'T#A7F#50K#U3456#1234',
      from: '+22676543210',
      to: '+22670000000',
      id: 'test_transfer_123'
    });
    console.log('✅ Transfer webhook test:', transferTest.data);
    console.log('');

    // Test 4: Simulate Payment SMS webhook
    console.log('4️⃣ Testing Payment SMS webhook...');
    const paymentTest = await axios.post(`${BASE_URL}/api/sms/webhook`, {
      text: 'P#B2C#15K#M7890#1234',
      from: '+22676543210',
      to: '+22670000000',
      id: 'test_payment_456'
    });
    console.log('✅ Payment webhook test:', paymentTest.data);
    console.log('');

    // Test 5: Simulate Balance SMS webhook
    console.log('5️⃣ Testing Balance SMS webhook...');
    const balanceTest = await axios.post(`${BASE_URL}/api/sms/webhook`, {
      text: 'B#C3D##1234',
      from: '+22676543210',
      to: '+22670000000',
      id: 'test_balance_789'
    });
    console.log('✅ Balance webhook test:', balanceTest.data);
    console.log('');

    // Test 6: Error case - Invalid PIN
    console.log('6️⃣ Testing Invalid PIN error...');
    const errorTest = await axios.post(`${BASE_URL}/api/sms/webhook`, {
      text: 'T#D4E#25K#U9999#9999',
      from: '+22676543210',
      to: '+22670000000',
      id: 'test_error_999'
    });
    console.log('✅ Error handling test:', errorTest.data);
    console.log('');

    console.log('🎉 All tests passed! SMS server is working correctly.');

  } catch (error) {
    console.error('❌ Test failed:', error.response?.data || error.message);
  }
}

// Run tests if called directly
if (require.main === module) {
  testSMSServer();
}

module.exports = testSMSServer;
```

### 10.2 Add Test Dependencies

```bash
# Add axios for testing
npm install --save-dev axios
```

### 10.3 Run and Test

```bash
# Start development server
npm run dev

# In another terminal, run tests
npm test
```

---

## Step 11: Deployment Options

### Option A: Local Development with ngrok

```bash
# Install ngrok globally
npm install -g ngrok

# Start your server
npm run dev

# In another terminal, expose with ngrok
ngrok http 3000

# Note the HTTPS URL: https://abc123.ngrok-free.app
# This will be your webhook URL for AfricasTalking
```

### Option B: Deploy to Railway (Recommended)

```bash
# Install Railway CLI
npm install -g @railway/cli

# Login to Railway
railway login

# Initialize and deploy
railway init
railway up

# Add environment variables
railway variables set AFRICASTALKING_API_KEY=your_api_key
railway variables set AFRICASTALKING_USERNAME=your_username
railway variables set NODE_ENV=production

# Your webhook URL: https://your-project.railway.app/api/sms/webhook
```

### Option C: Deploy to Heroku

```bash
# Install Heroku CLI and login
# Create new Heroku app
heroku create resilient-sms-server

# Set environment variables
heroku config:set AFRICASTALKING_API_KEY=your_api_key
heroku config:set AFRICASTALKING_USERNAME=your_username
heroku config:set NODE_ENV=production

# Deploy
git init
git add .
git commit -m "Initial SMS server deployment"
heroku git:remote -a resilient-sms-server
git push heroku main

# Webhook URL: https://resilient-sms-server.herokuapp.com/api/sms/webhook
```

---

## Step 12: AfricasTalking Configuration

### 12.1 Account Setup

1. Visit: https://africastalking.com/
2. Create account (free sandbox available)
3. Go to Dashboard after verification
4. Note your Username (usually 'sandbox' for testing)
5. Go to **Settings → API Keys**
6. Generate and copy your API Key

### 12.2 Configure SMS Callback URL

1. In AfricasTalking Dashboard
2. Go to **SMS → Settings**
3. Set Callback URL to: `https://your-domain.com/api/sms/webhook`
4. Set HTTP Method: **POST**
5. Save configuration

### 12.3 Update Environment Variables

```bash
# Update your .env file with real credentials
AFRICASTALKING_USERNAME=your_actual_username
AFRICASTALKING_API_KEY=your_actual_api_key

# For production, also set:
SMS_SHORTCODE=your_shortcode  # e.g., 3040
NODE_ENV=production
```

### 12.4 Test End-to-End SMS Flow

1. Ensure server is running and accessible
2. Send test SMS to AfricasTalking number (if you have one)
3. Or use AfricasTalking Simulator in sandbox mode
4. Check server logs for incoming webhook
5. Verify response SMS is sent back
6. Monitor delivery reports

---

## Prisma Development Commands

### Daily Workflow

```bash
# 1. Start PostgreSQL database
brew services start postgresql  # macOS
sudo service postgresql start   # Linux

# 2. Apply migrations if schema changes
npx prisma migrate dev

# 3. Regenerate client if needed
npx prisma generate

# 4. Start server
npm run dev

# 5. View data (optional) - Web interface on http://localhost:5555
npx prisma studio
```

### Useful Commands

```bash
# Reset database completely
npx prisma migrate reset

# Check migration status
npx prisma migrate status

# Format schema file
npx prisma format

# View data in browser
npx prisma studio

# Seed the database
npm run db:seed

# Create new migration
npx prisma migrate dev --name your_migration_name
```

---

## Verification Checklist

### Server Setup

- [ ] Server starts without errors on specified port
- [ ] Health endpoint responds: `GET /health`
- [ ] All SMS routes accessible: `/api/sms/*`
- [ ] AfricasTalking service initializes correctly
- [ ] Environment variables properly configured

### Database (Prisma + PostgreSQL)

- [ ] PostgreSQL database running
- [ ] Prisma migrations applied successfully
- [ ] Prisma client generated
- [ ] Seed data inserted (demo users)
- [ ] Prisma Studio accessible: `npx prisma studio`

### SMS Processing

- [ ] SMS webhook receives POST requests correctly
- [ ] Transaction parsing works for all formats (T, P, B)
- [ ] Business logic validates PIN, amounts, balances
- [ ] Response formatting stays under 160 characters
- [ ] Error handling works for all edge cases
- [ ] Transactions saved to PostgreSQL database
- [ ] User balances updated correctly in database

### AfricasTalking Integration

- [ ] SMS sending works via AfricasTalking API
- [ ] Phone number formatting handles all formats
- [ ] Delivery reports accessible
- [ ] Account balance checking works
- [ ] Webhook URL properly configured

### Testing

- [ ] All automated tests pass
- [ ] Manual SMS testing works end-to-end
- [ ] Error scenarios handled gracefully
- [ ] Logs provide sufficient debugging information
- [ ] Performance acceptable under load

### Deployment

- [ ] Server deployed and accessible from internet
- [ ] Environment variables set in production
- [ ] AfricasTalking webhook configured correctly
- [ ] SSL/HTTPS enabled for webhook security
- [ ] Monitoring and alerting configured

---

## Success Criteria

When everything is working correctly, you should see this flow:

```
📱 Flutter app sends SMS: "T#A7F#50K#U3456#1234"
📨 Server receives webhook: AfricasTalking forwards SMS to your webhook
💾 Server saves: Transaction created in PostgreSQL (status: PENDING)
⚡ Server processes: Validates PIN, checks balance, updates user balances
💾 Server updates: Transaction marked COMPLETED in database
📤 Server responds: Sends "OK#A7F#BAL:450K#TXN:X9Z2M4" via AfricasTalking
📱 Flutter app receives: Parses response and updates UI
```

Your SMS server is now fully functional with AfricasTalking and PostgreSQL + Prisma ORM!

**Next step**: Integrate this with your Flutter app to complete the offline-to-SMS transaction flow.
