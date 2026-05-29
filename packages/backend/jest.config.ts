import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.test.ts'],
  testPathIgnorePatterns: [
    // 통합 테스트는 jest.integration.config.ts로 실행 (real DB 필요)
    '<rootDir>/src/__tests__/auth.test.ts',
    '<rootDir>/src/__tests__/multitenancy',
    '<rootDir>/src/__tests__/emergency-e2e',
  ],
  moduleNameMapper: {
    // Prisma 클라이언트는 모의 객체로 대체
    '^../utils/prisma$': '<rootDir>/src/__mocks__/prisma.ts',
    '^../../utils/prisma$': '<rootDir>/src/__mocks__/prisma.ts',
    '^./prisma$': '<rootDir>/src/__mocks__/prisma.ts',
  },
  setupFiles: ['<rootDir>/src/__tests__/setup.ts'],
  testTimeout: 30000,
  coverageDirectory: 'coverage',
  collectCoverageFrom: [
    'src/controllers/**/*.ts',
    'src/middleware/**/*.ts',
    'src/utils/**/*.ts',
    '!src/**/*.d.ts',
  ],
  coverageThreshold: {
    global: {
      lines: 40,
      functions: 40,
    },
  },
};

export default config;
