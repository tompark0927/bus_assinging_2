import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  // 통합 테스트만 실행 (unit.test.ts 제외, controllers/ 제외)
  testMatch: [
    '<rootDir>/src/__tests__/auth.test.ts',
    '<rootDir>/src/__tests__/multitenancy*.test.ts',
    '<rootDir>/src/__tests__/emergency-e2e.test.ts',
    '<rootDir>/src/__tests__/health.test.ts',
  ],
  // Prisma mock 제거 — real DB 사용
  setupFiles: ['<rootDir>/src/__tests__/setup.ts'],
  testTimeout: 30000,
};

export default config;
