// Prisma 클라이언트 모의 객체 — 테스트에서 DB 없이 동작
/* eslint-disable @typescript-eslint/no-explicit-any */

type MockModel = Record<string, jest.Mock<any, any>>;

const createMockModel = (): MockModel => ({
  findUnique: jest.fn(),
  findFirst: jest.fn(),
  findMany: jest.fn(),
  create: jest.fn(),
  createMany: jest.fn(),
  update: jest.fn(),
  updateMany: jest.fn(),
  upsert: jest.fn(),
  delete: jest.fn(),
  deleteMany: jest.fn(),
  count: jest.fn(),
  aggregate: jest.fn(),
  groupBy: jest.fn(),
});

type MockPrisma = {
  [K: string]: MockModel | jest.Mock<any, any>;
  $transaction: jest.Mock<any, any>;
  $disconnect: jest.Mock<any, any>;
  $queryRaw: jest.Mock<any, any>;
};

export const prisma: MockPrisma = {
  company: createMockModel(),
  user: createMockModel(),
  bus: createMockModel(),
  route: createMockModel(),
  schedule: createMockModel(),
  scheduleSlot: createMockModel(),
  dayOffRequest: createMockModel(),
  emergencyDrop: createMockModel(),
  notification: createMockModel(),
  companyRule: createMockModel(),
  maintenanceRecord: createMockModel(),
  contactInquiry: createMockModel(),
  attendanceRecord: createMockModel(),
  payrollSetting: createMockModel(),
  payrollRecord: createMockModel(),
  dailyInspection: createMockModel(),
  incidentRecord: createMockModel(),
  trainingRecord: createMockModel(),
  refreshToken: createMockModel(),
  hoboongTable: createMockModel(),
  unionDue: createMockModel(),
  otpVerification: createMockModel(),
  auditLog: createMockModel(),
  directMessage: createMockModel(),
  approval: createMockModel(),
  approvalStep: createMockModel(),
  routeAssignment: createMockModel(),
  $transaction: jest.fn((cb: unknown): any => {
    if (typeof cb === 'function') return Promise.resolve(cb(prisma));
    return Promise.all(cb as Promise<unknown>[]);
  }),
  $queryRaw: jest.fn().mockResolvedValue([{ '?column?': 1 }]),
  $disconnect: jest.fn(),
};
