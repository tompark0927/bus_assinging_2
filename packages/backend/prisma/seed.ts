import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  // 프로덕션 환경에서 실수로 시드 실행 방지
  if (process.env.NODE_ENV === 'production') {
    console.error('프로덕션 환경에서는 시드를 실행할 수 없습니다.');
    console.error('개발 환경에서만 실행하세요: NODE_ENV=development npm run db:seed');
    process.exit(1);
  }

  console.log('🌱 데이터베이스 시드 시작...');

  // Create Company — id는 명시하지 않음. 명시 INSERT는 Postgres serial 시퀀스를 진행시키지
  // 않아 이후 회사 등록 시 unique(id) 충돌(P2002)을 유발하기 때문.
  const company = await prisma.company.upsert({
    where: { code: 'DEMO' },
    update: {},
    create: {
      name: 'Busync 데모 회사',
      code: 'DEMO',
    },
  });
  console.log('✅ 회사 생성:', company.name);

  // Create office staff accounts (역할별 계정)
  const officeStaff = [
    { name: '김대표',   email: 'owner@demo.busync.kr',      phone: '032-000-0001', role: 'OWNER'      as const, employeeId: 'OWN001' },
    { name: '박소장',   email: 'director@demo.busync.kr',    phone: '032-000-0002', role: 'DIRECTOR'   as const, employeeId: 'DIR001' },
    { name: '관리자',   email: 'admin@demo.busync.kr',       phone: '032-000-0000', role: 'ADMIN'      as const, employeeId: 'ADM001' },
    { name: '이배차',   email: 'dispatch@demo.busync.kr',    phone: '032-000-0003', role: 'DISPATCH'   as const, employeeId: 'DSP001' },
    { name: '최인사',   email: 'hr@demo.busync.kr',          phone: '032-000-0004', role: 'HR'         as const, employeeId: 'HRM001' },
    { name: '정경리',   email: 'accounting@demo.busync.kr',  phone: '032-000-0005', role: 'ACCOUNTING' as const, employeeId: 'ACC001' },
    { name: '한안전',   email: 'safety@demo.busync.kr',      phone: '032-000-0006', role: 'SAFETY_MGR' as const, employeeId: 'SAF001' },
  ];

  const staffPassword = await bcrypt.hash('admin123!', 10);
  for (const staff of officeStaff) {
    await prisma.user.upsert({
      where: { email: staff.email },
      update: {},
      create: {
        name: staff.name,
        email: staff.email,
        phone: staff.phone,
        password: staffPassword,
        role: staff.role,
        employeeId: staff.employeeId,
      },
    });
  }
  console.log('✅ 사무직 계정 생성 완료 (7명)');

  // Create routes
  const routes = await Promise.all([
    prisma.route.upsert({
      where: { routeNumber: '16' },
      update: {},
      create: {
        routeNumber: '16',
        name: '16번 노선',
        description: '시내버스 16번 노선',
        startPoint: '인천시청',
        endPoint: '연수구',
      },
    }),
    prisma.route.upsert({
      where: { routeNumber: '23' },
      update: {},
      create: {
        routeNumber: '23',
        name: '23번 노선',
        description: '시내버스 23번 노선',
        startPoint: '부평역',
        endPoint: '동인천역',
      },
    }),
    prisma.route.upsert({
      where: { routeNumber: '37' },
      update: {},
      create: {
        routeNumber: '37',
        name: '37번 노선',
        description: '시내버스 37번 노선',
        startPoint: '계양구',
        endPoint: '남동구',
      },
    }),
  ]);
  console.log('✅ 노선 생성 완료:', routes.map(r => r.routeNumber).join(', '));

  // Create buses
  const buses = await Promise.all([
    prisma.bus.upsert({
      where: { busNumber: 'BUS01' },
      update: {},
      create: {
        busNumber: 'BUS01',
        plateNumber: '인천12가3456',
        model: '현대 뉴 슈퍼 에어로시티',
        year: 2022,
        capacity: 40,
        routeId: routes[0].id,
      },
    }),
    prisma.bus.upsert({
      where: { busNumber: 'BUS02' },
      update: {},
      create: {
        busNumber: 'BUS02',
        plateNumber: '인천12나3457',
        model: '현대 뉴 슈퍼 에어로시티',
        year: 2021,
        capacity: 40,
        routeId: routes[0].id,
      },
    }),
    prisma.bus.upsert({
      where: { busNumber: 'BUS03' },
      update: {},
      create: {
        busNumber: 'BUS03',
        plateNumber: '인천12다3458',
        model: '현대 블루시티',
        year: 2023,
        capacity: 40,
        routeId: routes[1].id,
      },
    }),
    prisma.bus.upsert({
      where: { busNumber: 'BUS04' },
      update: {},
      create: {
        busNumber: 'BUS04',
        plateNumber: '인천12라3459',
        model: '현대 뉴 슈퍼 에어로시티',
        year: 2022,
        capacity: 40,
        routeId: routes[2].id,
      },
    }),
  ]);
  console.log('✅ 버스 생성 완료:', buses.map(b => b.busNumber).join(', '));

  // Create sample drivers
  const driverData = [
    { name: '김철수', email: 'driver1@demo.busync.kr', phone: '010-1234-5678', employeeId: 'DRV001', driverType: 'MAIN' as const, routeId: routes[0].id },
    { name: '이영희', email: 'driver2@demo.busync.kr', phone: '010-2345-6789', employeeId: 'DRV002', driverType: 'MAIN' as const, routeId: routes[0].id },
    { name: '박민준', email: 'driver3@demo.busync.kr', phone: '010-3456-7890', employeeId: 'DRV003', driverType: 'MAIN' as const, routeId: routes[1].id },
    { name: '최지훈', email: 'driver4@demo.busync.kr', phone: '010-4567-8901', employeeId: 'DRV004', driverType: 'MAIN' as const, routeId: routes[1].id },
    { name: '정수민', email: 'driver5@demo.busync.kr', phone: '010-5678-9012', employeeId: 'DRV005', driverType: 'MAIN' as const, routeId: routes[2].id },
    { name: '한동훈', email: 'driver6@demo.busync.kr', phone: '010-6789-0123', employeeId: 'DRV006', driverType: 'SPARE' as const, routeId: routes[0].id },
    { name: '오세진', email: 'driver7@demo.busync.kr', phone: '010-7890-1234', employeeId: 'DRV007', driverType: 'SPARE' as const, routeId: routes[1].id },
  ];

  for (const driverInfo of driverData) {
    const driverPassword = await bcrypt.hash(driverInfo.employeeId, 10);
    const driver = await prisma.user.upsert({
      where: { email: driverInfo.email },
      update: {},
      create: {
        name: driverInfo.name,
        email: driverInfo.email,
        phone: driverInfo.phone,
        password: driverPassword,
        role: 'DRIVER',
        employeeId: driverInfo.employeeId,
        driverType: driverInfo.driverType,
        licenseNumber: `${driverInfo.employeeId}-LIC`,
      },
    });

    // Assign to route
    const existingAssignment = await prisma.routeAssignment.findFirst({
      where: { driverId: driver.id, isActive: true },
    });

    if (!existingAssignment) {
      await prisma.routeAssignment.create({
        data: {
          driverId: driver.id,
          routeId: driverInfo.routeId,
          startDate: new Date('2024-01-01'),
          isActive: true,
        },
      });
    }
  }
  console.log('✅ 기사 계정 생성 완료 (7명)');

  // Create sample company rules
  const rules = [
    {
      title: '기본 근무 패턴',
      content: '5일 근무 후 2일 휴무를 기본 패턴으로 한다. 모든 기사는 이 사이클을 따른다.',
      category: 'work-pattern',
    },
    {
      title: '연속 운행 제한',
      content: '연속 운행 시간은 4시간을 초과할 수 없으며, 초과 시 30분 이상 휴식을 취해야 한다.',
      category: 'safety',
    },
    {
      title: '일일 근무 시간',
      content: '1일 총 근무시간은 10시간을 초과할 수 없다.',
      category: 'safety',
    },
    {
      title: '메인 기사 규정',
      content: '메인 기사는 특정 노선에 고정 배치되며, 해당 노선의 모든 운행을 담당한다.',
      category: 'driver-type',
    },
    {
      title: '스페어 기사 규정',
      content: '스페어 기사는 결원 발생 시 우선 투입되며, 여러 노선을 운행할 수 있다.',
      category: 'driver-type',
    },
  ];

  for (const rule of rules) {
    await prisma.companyRule.upsert({
      where: { id: -1 }, // Force create
      update: {},
      create: rule,
    }).catch(async () => {
      // If upsert fails, just create
      const exists = await prisma.companyRule.findFirst({
        where: { title: rule.title },
      });
      if (!exists) {
        await prisma.companyRule.create({ data: rule });
      }
    });
  }
  console.log('✅ 회사 규칙 생성 완료');

  console.log('\n🎉 시드 완료!');
  console.log('─────────────────────────────────');
  console.log('📌 사무직 계정 (비밀번호: admin123!)');
  console.log('  대표이사:  owner@demo.busync.kr');
  console.log('  관리소장:  director@demo.busync.kr');
  console.log('  관리자:    admin@demo.busync.kr');
  console.log('  배차담당:  dispatch@demo.busync.kr');
  console.log('  총무/인사: hr@demo.busync.kr');
  console.log('  경리:      accounting@demo.busync.kr');
  console.log('  안전관리:  safety@demo.busync.kr');
  console.log('📌 기사 계정 (사원번호 = 비밀번호)');
  console.log('  driver1@demo.busync.kr / DRV001');
  console.log('─────────────────────────────────');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
