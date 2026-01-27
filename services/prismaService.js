const { PrismaClient } = require('@prisma/client');

class PrismaService {
  constructor() {
    this.prisma = new PrismaClient({
      log: process.env.NODE_ENV === 'development'
        ? ['query', 'info', 'warn', 'error']
        : ['error'],
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

  // Get transaction by ID
  async getTransaction(transactionId) {
    try {
      const transaction = await this.prisma.transaction.findUnique({
        where: { transactionId: transactionId },
        include: {
          fromUser: { select: { name: true, userId: true } },
          toUser: { select: { name: true, userId: true } }
        }
      });

      return transaction;
    } catch (error) {
      console.error('❌ Error getting transaction:', error);
      throw error;
    }
  }

  // Get transaction history with pagination
  async getTransactionHistory(userId, limit = 20, offset = 0) {
    try {
      const transactions = await this.prisma.transaction.findMany({
        where: {
          OR: [
            { fromUserId: userId },
            { toUserId: userId }
          ]
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset
      });

      return transactions;
    } catch (error) {
      console.error('❌ Error getting transaction history:', error);
      throw error;
    }
  }

  // Get transaction count for user
  async getTransactionCount(userId) {
    try {
      const count = await this.prisma.transaction.count({
        where: {
          OR: [
            { fromUserId: userId },
            { toUserId: userId }
          ]
        }
      });

      return count;
    } catch (error) {
      console.error('❌ Error getting transaction count:', error);
      throw error;
    }
  }

  // Create new user
  async createUser(userData) {
    try {
      const user = await this.prisma.user.create({
        data: {
          userId: userData.userId,
          name: userData.name,
          phone: userData.phone,
          pin: userData.pin,
          balance: userData.balance || 0
        }
      });

      console.log(`👤 User created: ${user.userId}`);
      return user;
    } catch (error) {
      console.error('❌ Error creating user:', error);
      throw error;
    }
  }

  // Update user PIN
  async updateUserPin(userId, newPin) {
    try {
      const user = await this.prisma.user.update({
        where: { userId: userId },
        data: { pin: newPin }
      });

      console.log(`🔑 PIN updated: ${userId}`);
      return user;
    } catch (error) {
      console.error('❌ Error updating PIN:', error);
      throw error;
    }
  }

  // Get all users
  async getAllUsers() {
    try {
      const users = await this.prisma.user.findMany({
        orderBy: { createdAt: 'desc' }
      });

      return users;
    } catch (error) {
      console.error('❌ Error getting all users:', error);
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
