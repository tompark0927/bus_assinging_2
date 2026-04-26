import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding demo company...');

  // 1. Create or find Demo Company
  const demoCompany = await prisma.company.upsert({
    where: { code: 'demo' },
    update: {},
    create: {
      name: '부싱크 운수(주) (Demo)',
      code: 'demo',
      isActive: true,
    },
  });

  console.log('Created company:', demoCompany.name);

  // 2. Create Demo Admin User
  const hashedPassword = await bcrypt.hash('demo', 10);
  
  const adminUser = await prisma.user.upsert({
    where: {
      companyId_employeeId: { companyId: demoCompany.id, employeeId: 'admin' }
    },
    update: {},
    create: {
      companyId: demoCompany.id,
      employeeId: 'admin',
      name: '데모 관리자',
      password: hashedPassword,
      phone: '010-0000-0000',
      role: 'ADMIN',
      email: 'demo@busync.com'
    },
  });

  console.log('Created admin user:', adminUser.name);

  // 3. Create Demo Driver User
  const driverUser = await prisma.user.upsert({
    where: {
      companyId_employeeId: { companyId: demoCompany.id, employeeId: 'driver' }
    },
    update: {},
    create: {
      companyId: demoCompany.id,
      employeeId: 'driver',
      name: '홍길동 기사',
      password: hashedPassword,
      phone: '010-1111-2222',
      role: 'DRIVER',
      email: 'driver@busync.com',
      driverType: 'MAIN'
    },
  });

  console.log('Created driver user:', driverUser.name);

  console.log('✅ Demo seed complete!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
