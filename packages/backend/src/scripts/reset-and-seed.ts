/**
 * Full reset & reseed script.
 * Creates a demo company for development/testing:
 *   Company Code : DEMO
 *   Admin Email  : admin@demo.busync.kr
 *   Admin PW     : admin123!
 *
 * Run from packages/backend: npx tsx src/scripts/reset-and-seed.ts
 */
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Resetting and seeding database...\n');

  // ─── 0. Wipe existing data ────────────────────────────────────────────
  await prisma.chatMessage.deleteMany();
  await prisma.chatSession.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.emergencyDrop.deleteMany();
  await prisma.scheduleSlot.deleteMany();
  await prisma.schedule.deleteMany();
  await prisma.dayOffRequest.deleteMany();
  await prisma.routeAssignment.deleteMany();
  await prisma.maintenanceRecord.deleteMany();
  await prisma.companyRule.deleteMany();
  await prisma.bus.deleteMany();
  await prisma.route.deleteMany();
  await prisma.user.deleteMany();
  await prisma.company.deleteMany();
  console.log('✅ Wiped old data');

  // ─── 1. Create Demo Company ───────────────────────────────────────────
  const demo = await prisma.company.create({
    data: { name: 'Busync 데모', code: 'DEMO', isActive: true },
  });
  console.log(`✅ Company: DEMO(id=${demo.id})`);

  // ─── 2. Admin user ──────────────────────────────────────────────────
  const demoAdmin = await prisma.user.create({
    data: {
      companyId: demo.id,
      name: '관리자',
      email: 'admin@demo.busync.kr',
      phone: '010-0000-0001',
      password: await bcrypt.hash('admin123!', 10),
      role: 'ADMIN',
      employeeId: 'ADM001',
    },
  });
  console.log(`✅ Admin: ${demoAdmin.email}`);

  // ─── 3. Demo – Routes ─────────────────────────────────────────────────
  const routes = await Promise.all([
    prisma.route.create({ data: { companyId: demo.id, routeNumber: '101', name: '데모 101번', startPoint: '중앙역', endPoint: '남부터미널', isActive: true } }),
    prisma.route.create({ data: { companyId: demo.id, routeNumber: '202', name: '데모 202번', startPoint: '북부역', endPoint: '동부터미널', isActive: true } }),
  ]);
  console.log(`✅ Demo routes: ${routes.map(r => r.routeNumber).join(', ')}`);

  // ─── 4. Demo – Buses ─────────────────────────────────────────────────
  const buses = await Promise.all([
    prisma.bus.create({ data: { companyId: demo.id, busNumber: 'DEMO-001', plateNumber: '서울 00가0001', model: '현대 유니버스', year: 2023, capacity: 45, routeId: routes[0].id } }),
    prisma.bus.create({ data: { companyId: demo.id, busNumber: 'DEMO-002', plateNumber: '서울 00나0002', model: '기아 그랜버드', year: 2022, capacity: 45, routeId: routes[0].id } }),
    prisma.bus.create({ data: { companyId: demo.id, busNumber: 'DEMO-003', plateNumber: '서울 00다0003', model: '현대 뉴슈퍼에어로시티', year: 2023, capacity: 40, routeId: routes[1].id } }),
  ]);
  console.log(`✅ Demo buses: ${buses.map(b => b.busNumber).join(', ')}`);

  // ─── 5. Demo – Drivers ───────────────────────────────────────────────
  const drivers = [];
  const driverData = [
    { name: '김민준', phone: '010-1111-1001', employeeId: 'DEMO-D01', driverType: 'MAIN' as const, routeId: routes[0].id },
    { name: '이서연', phone: '010-1111-1002', employeeId: 'DEMO-D02', driverType: 'MAIN' as const, routeId: routes[0].id },
    { name: '박지호', phone: '010-1111-1003', employeeId: 'DEMO-D03', driverType: 'MAIN' as const, routeId: routes[1].id },
    { name: '최수아', phone: '010-1111-1004', employeeId: 'DEMO-D04', driverType: 'SPARE' as const, routeId: routes[0].id },
    { name: '정우진', phone: '010-1111-1005', employeeId: 'DEMO-D05', driverType: 'SPARE' as const, routeId: routes[1].id },
  ];
  for (const d of driverData) {
    const driver = await prisma.user.create({
      data: {
        companyId: demo.id,
        name: d.name,
        phone: d.phone,
        password: await bcrypt.hash('demo', 10),
        role: 'DRIVER',
        employeeId: d.employeeId,
        driverType: d.driverType,
      },
    });
    await prisma.routeAssignment.create({
      data: { driverId: driver.id, routeId: d.routeId, startDate: new Date('2026-01-01'), isActive: true },
    });
    drivers.push(driver);
  }
  console.log(`✅ Demo drivers: ${drivers.map(d => d.name).join(', ')}`);

  // ─── 6. Demo – Current Month Schedule (sample) ───────────────────────
  const schedule = await prisma.schedule.create({
    data: {
      companyId: demo.id,
      year: 2026,
      month: 3,
      status: 'PUBLISHED',
      createdBy: demoAdmin.id,
    },
  });

  // Create a few slots for each driver this week
  const today = new Date('2026-03-10');
  for (let dayOffset = 0; dayOffset < 7; dayOffset++) {
    const slotDate = new Date(today);
    slotDate.setDate(today.getDate() + dayOffset);
    for (let i = 0; i < drivers.length; i++) {
      const driver = drivers[i];
      const route = i < 3 ? routes[0] : routes[1];
      const bus = buses[Math.min(i, buses.length - 1)];
      if (dayOffset % 7 !== i % 2) {
        await prisma.scheduleSlot.create({
          data: {
            scheduleId: schedule.id,
            driverId: driver.id,
            routeId: route.id,
            busId: bus.id,
            date: slotDate,
            shift: 'FULL_DAY',
            status: 'SCHEDULED',
            isRestDay: false,
          },
        });
      }
    }
  }
  console.log('✅ Demo schedule slots created');

  // ─── 7. Demo – Maintenance Records ───────────────────────────────────
  await prisma.maintenanceRecord.create({
    data: {
      companyId: demo.id,
      busId: buses[0].id,
      type: 'OIL_CHANGE',
      status: 'SCHEDULED',
      scheduledAt: new Date('2026-03-15'),
      mileageAtService: 45000,
    },
  });
  await prisma.maintenanceRecord.create({
    data: {
      companyId: demo.id,
      busId: buses[1].id,
      type: 'TIRE_ROTATION',
      status: 'COMPLETED',
      scheduledAt: new Date('2026-03-01'),
      completedAt: new Date('2026-03-01'),
      mileageAtService: 30000,
      notes: '정상 완료',
    },
  });
  console.log('✅ Demo maintenance records');

  console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ Seed complete!

🏢 DEMO COMPANY
   Company Code : DEMO
   Admin Email  : admin@demo.busync.kr
   Admin PW     : admin123!
   Driver PW    : demo
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
