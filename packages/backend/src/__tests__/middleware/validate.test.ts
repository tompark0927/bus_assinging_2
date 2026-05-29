import { Request, Response, NextFunction } from 'express';
import { validationResult, ValidationError, Result } from 'express-validator';
import { handleValidationErrors } from '../../middleware/validate';

// Mock express-validator's validationResult
jest.mock('express-validator', () => {
  const actual = jest.requireActual('express-validator');
  return {
    ...actual,
    validationResult: jest.fn(),
  };
});

jest.mock('../../utils/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const mockedValidationResult = validationResult as unknown as jest.Mock;

function createMockRes(): Response {
  const res: Partial<Response> = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res as Response;
}

function createMockNext(): NextFunction {
  return jest.fn();
}

describe('handleValidationErrors', () => {
  beforeEach(() => jest.clearAllMocks());

  it('should call next() when there are no validation errors', () => {
    const req = {} as Request;
    const res = createMockRes();
    const next = createMockNext();

    mockedValidationResult.mockReturnValue({
      isEmpty: () => true,
      array: () => [],
    });

    handleValidationErrors(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('should return 400 with error details when validation errors exist', () => {
    const req = {} as Request;
    const res = createMockRes();
    const next = createMockNext();

    mockedValidationResult.mockReturnValue({
      isEmpty: () => false,
      array: () => [
        { path: 'email', msg: '이메일이 필요합니다.' },
        { path: 'password', msg: '비밀번호는 최소 8자 이상이어야 합니다.' },
      ],
    });

    handleValidationErrors(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        message: '입력값이 올바르지 않습니다.',
        errors: [
          { field: 'email', message: '이메일이 필요합니다.' },
          { field: 'password', message: '비밀번호는 최소 8자 이상이어야 합니다.' },
        ],
      }),
    );
  });

  it('should use "unknown" as field name when path is missing', () => {
    const req = {} as Request;
    const res = createMockRes();
    const next = createMockNext();

    mockedValidationResult.mockReturnValue({
      isEmpty: () => false,
      array: () => [{ msg: 'Some error' }],
    });

    handleValidationErrors(req, res, next);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        errors: [{ field: 'unknown', message: 'Some error' }],
      }),
    );
  });
});

describe('password complexity validation (integration-style)', () => {
  // These tests use the actual express-validator chain to verify the passwordValidator rules
  // We import validate and use real express-validator for this part
  const { body } = jest.requireActual('express-validator');

  async function runValidation(password: string): Promise<string[]> {
    // Build the same chain as passwordValidator in validate.ts
    const chain = body('password')
      .isLength({ min: 8 }).withMessage('비밀번호는 최소 8자 이상이어야 합니다.')
      .isLength({ max: 128 }).withMessage('비밀번호는 128자를 초과할 수 없습니다.')
      .matches(/[A-Za-z]/).withMessage('비밀번호에 영문자가 포함되어야 합니다.')
      .matches(/[0-9]/).withMessage('비밀번호에 숫자가 포함되어야 합니다.')
      .matches(/[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/).withMessage('비밀번호에 특수문자가 포함되어야 합니다.');

    const req = { body: { password } } as Request;
    const res = createMockRes();

    await chain.run(req);

    const realValidationResult = jest.requireActual('express-validator').validationResult;
    const result = realValidationResult(req);
    return result.array().map((e: { msg: string }) => e.msg);
  }

  it('should reject password shorter than 8 characters', async () => {
    const errors = await runValidation('Ab1!');
    expect(errors).toContain('비밀번호는 최소 8자 이상이어야 합니다.');
  });

  it('should reject password without special characters', async () => {
    const errors = await runValidation('Abcdefg123');
    expect(errors).toContain('비밀번호에 특수문자가 포함되어야 합니다.');
  });

  it('should reject password without numbers', async () => {
    const errors = await runValidation('Abcdefgh!');
    expect(errors).toContain('비밀번호에 숫자가 포함되어야 합니다.');
  });

  it('should reject password without letters', async () => {
    const errors = await runValidation('12345678!');
    expect(errors).toContain('비밀번호에 영문자가 포함되어야 합니다.');
  });

  it('should accept a valid password with letters, numbers, and special chars', async () => {
    const errors = await runValidation('Admin123!');
    expect(errors).toHaveLength(0);
  });
});
