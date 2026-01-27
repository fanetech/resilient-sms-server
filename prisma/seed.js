const { PrismaClient } = require('@prisma/client');
const { hashPin } = require('../utils/pinEncryption');

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database...');

  // Hash the default PIN
  const hashedPin = await hashPin('1234');

  // Créer utilisateurs demo
  const alice = await prisma.user.upsert({
    where: { userId: 'USER3456' },
    update: { pin: hashedPin },
    create: {
      userId: 'USER3456',
      balance: 500000,
      pin: hashedPin,
      name: 'Alice Ouedraogo',
      phone: '22676543210'
    }
  });

  const ibrahim = await prisma.user.upsert({
    where: { userId: 'USER7890' },
    update: { pin: hashedPin },
    create: {
      userId: 'USER7890',
      balance: 750000,
      pin: hashedPin,
      name: 'Ibrahim Sanogo',
      phone: '22676543211'
    }
  });

  const merchant = await prisma.user.upsert({
    where: { userId: 'MERCHANT001' },
    update: { pin: hashedPin },
    create: {
      userId: 'MERCHANT001',
      balance: 1000000,
      pin: hashedPin,
      name: 'Boutique Centrale',
      phone: '22676543212'
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
