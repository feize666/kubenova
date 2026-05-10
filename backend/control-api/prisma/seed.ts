import { PrismaClient } from '@prisma/client';
import { randomBytes, scrypt } from 'crypto';
import { promisify } from 'util';

const scryptAsync = promisify(scrypt);

async function hashPassword(plain: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const derivedKey = (await scryptAsync(plain, salt, 64)) as Buffer;
  return `${salt}:${derivedKey.toString('hex')}`;
}

const prisma = new PrismaClient();

async function main(): Promise<void> {
  console.log('Seeding database...');

  // ── Admin user ────────────────────────────────────────────────────────────
  const adminEmail = 'admin@local.dev';
  const existingAdmin = await prisma.user.findUnique({ where: { email: adminEmail } });
  if (!existingAdmin) {
    const passwordHash = await hashPassword('admin123456');
    await prisma.user.create({
      data: {
        email: adminEmail,
        name: 'Local Admin',
        role: 'admin',
        isActive: true,
        passwordHash,
      },
    });
  } else {
    await prisma.user.update({
      where: { email: adminEmail },
      data: { name: 'Local Admin', role: 'admin', isActive: true },
    });
  }
  console.log('  [1/1] User seeded.');

  console.log('Seeding complete.');
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error: unknown) => {
    console.error('Prisma seed failed:', error);
    await prisma.$disconnect();
    process.exit(1);
  });
