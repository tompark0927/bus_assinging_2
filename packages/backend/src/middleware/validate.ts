import { Request, Response, NextFunction } from 'express';
import { body, param, query, ValidationChain, validationResult } from 'express-validator';

// ─────────────────────────────────────────────────────────────────
// Generic error handler for validation results
// ─────────────────────────────────────────────────────────────────
export const handleValidationErrors = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: '입력값이 올바르지 않습니다.',
      errors: errors.array().map((e) => ({
        field: (e as { path?: string }).path ?? 'unknown',
        message: e.msg,
      })),
    });
  }
  next();
};

// Helper: wrap an array of ValidationChain + the error handler into a single middleware array
export const validate = (chains: ValidationChain[]) => [
  ...chains,
  handleValidationErrors,
];

// ─────────────────────────────────────────────────────────────────
// Common reusable validators
// ─────────────────────────────────────────────────────────────────
const isIntId = (location: 'param' | 'body', field: string, label: string) => {
  const fn = location === 'param' ? param : body;
  return fn(field)
    .notEmpty().withMessage(`${label}은(는) 필수입니다.`)
    .isInt({ min: 1 }).withMessage(`${label}은(는) 유효한 정수여야 합니다.`)
    .toInt();
};

const optionalInt = (field: string, label: string) =>
  body(field)
    .optional()
    .isInt({ min: 1 }).withMessage(`${label}은(는) 유효한 정수여야 합니다.`)
    .toInt();

// 비밀번호 복잡도 검증 (8자 이상, 영문+숫자+특수문자)
const passwordValidator = (field: string, required = true) => {
  let chain = body(field);
  if (!required) chain = chain.optional() as typeof chain;
  return chain
    .isLength({ min: 8 }).withMessage('비밀번호는 최소 8자 이상이어야 합니다.')
    .isLength({ max: 128 }).withMessage('비밀번호는 128자를 초과할 수 없습니다.')
    .matches(/[A-Za-z]/).withMessage('비밀번호에 영문자가 포함되어야 합니다.')
    .matches(/[0-9]/).withMessage('비밀번호에 숫자가 포함되어야 합니다.')
    .matches(/[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/).withMessage('비밀번호에 특수문자가 포함되어야 합니다.');
};

const requiredString = (field: string, label: string, opts?: { min?: number; max?: number }) =>
  body(field)
    .trim()
    .notEmpty().withMessage(`${label}은(는) 필수입니다.`)
    .isLength({ min: opts?.min ?? 1, max: opts?.max ?? 500 })
    .withMessage(`${label}은(는) ${opts?.min ?? 1}~${opts?.max ?? 500}자 이내여야 합니다.`);

const optionalString = (field: string, label: string, opts?: { max?: number }) =>
  body(field)
    .optional()
    .trim()
    .isLength({ max: opts?.max ?? 500 })
    .withMessage(`${label}은(는) ${opts?.max ?? 500}자 이내여야 합니다.`);

const yearMonthParams = () => [
  param('year')
    .isInt({ min: 2000, max: 2100 }).withMessage('연도는 2000~2100 범위여야 합니다.')
    .toInt(),
  param('month')
    .isInt({ min: 1, max: 12 }).withMessage('월은 1~12 범위여야 합니다.')
    .toInt(),
];

const yearMonthBody = () => [
  body('year')
    .notEmpty().withMessage('연도는 필수입니다.')
    .isInt({ min: 2000, max: 2100 }).withMessage('연도는 2000~2100 범위여야 합니다.')
    .toInt(),
  body('month')
    .notEmpty().withMessage('월은 필수입니다.')
    .isInt({ min: 1, max: 12 }).withMessage('월은 1~12 범위여야 합니다.')
    .toInt(),
];

const yearMonthQuery = () => [
  query('year')
    .optional()
    .isInt({ min: 2000, max: 2100 }).withMessage('연도는 2000~2100 범위여야 합니다.')
    .toInt(),
  query('month')
    .optional()
    .isInt({ min: 1, max: 12 }).withMessage('월은 1~12 범위여야 합니다.')
    .toInt(),
];

// ─────────────────────────────────────────────────────────────────
// AUTH
// ─────────────────────────────────────────────────────────────────
export const authValidation = {
  login: validate([
    requiredString('companyCode', '회사 코드', { min: 2, max: 10 }),
    body('email')
      .trim()
      .notEmpty().withMessage('이메일 또는 사원번호는 필수입니다.'),
    body('password')
      .notEmpty().withMessage('비밀번호는 필수입니다.')
      .isLength({ min: 4 }).withMessage('비밀번호는 최소 4자 이상이어야 합니다.'),
  ]),

  refresh: validate([
    requiredString('refreshToken', '리프레시 토큰'),
  ]),

  pushToken: validate([
    body('expoPushToken')
      .optional({ values: 'null' })
      .isString().withMessage('푸시 토큰은 문자열이어야 합니다.'),
  ]),

  sendPhoneOtp: validate([
    body('phone')
      .trim()
      .notEmpty().withMessage('전화번호는 필수입니다.')
      .matches(/^01[016789]-?\d{3,4}-?\d{4}$/).withMessage('유효한 전화번호 형식이어야 합니다. (01X-XXXX-XXXX)'),
  ]),

  verifyPhoneOtp: validate([
    body('phone')
      .trim()
      .notEmpty().withMessage('전화번호는 필수입니다.'),
    body('otp')
      .trim()
      .notEmpty().withMessage('인증번호는 필수입니다.')
      .isLength({ min: 4, max: 6 }).withMessage('인증번호는 4~6자리여야 합니다.'),
  ]),

  forceLogout: validate([
    param('userId')
      .isInt({ min: 1 }).withMessage('사용자 ID는 유효한 정수여야 합니다.')
      .toInt(),
  ]),

  // 비밀번호 재설정 — OTP 발송 요청
  forgotPasswordSendOtp: validate([
    requiredString('companyCode', '회사 코드', { min: 2, max: 10 }),
    body('identifier')
      .trim()
      .notEmpty().withMessage('이메일은 필수입니다.')
      .isEmail().withMessage('유효한 이메일 형식이어야 합니다.'),
  ]),

  // 비밀번호 재설정 — OTP 검증 + 새 비밀번호
  forgotPasswordReset: validate([
    requiredString('companyCode', '회사 코드', { min: 2, max: 10 }),
    body('identifier')
      .trim()
      .notEmpty().withMessage('이메일은 필수입니다.')
      .isEmail().withMessage('유효한 이메일 형식이어야 합니다.'),
    body('otp')
      .trim()
      .notEmpty().withMessage('인증번호는 필수입니다.')
      .isLength({ min: 4, max: 6 }).withMessage('인증번호는 4~6자리여야 합니다.'),
    passwordValidator('newPassword'),
  ]),

  // 회사 코드 찾기
  findCompanyCode: validate([
    body('phone')
      .trim()
      .notEmpty().withMessage('전화번호는 필수입니다.')
      .matches(/^01[016789]-?\d{3,4}-?\d{4}$/).withMessage('유효한 전화번호 형식이어야 합니다. (01X-XXXX-XXXX)'),
  ]),

  // 이메일 인증 — OTP 발송
  sendEmailOtp: validate([
    body('email')
      .trim()
      .notEmpty().withMessage('이메일은 필수입니다.')
      .isEmail().withMessage('유효한 이메일 형식이어야 합니다.'),
  ]),

  // 이메일 인증 — OTP 검증
  verifyEmailOtp: validate([
    body('email')
      .trim()
      .notEmpty().withMessage('이메일은 필수입니다.')
      .isEmail().withMessage('유효한 이메일 형식이어야 합니다.'),
    body('otp')
      .trim()
      .notEmpty().withMessage('인증번호는 필수입니다.')
      .isLength({ min: 4, max: 6 }).withMessage('인증번호는 4~6자리여야 합니다.'),
  ]),
};

// ─────────────────────────────────────────────────────────────────
// USERS
// ─────────────────────────────────────────────────────────────────
export const userValidation = {
  getById: validate([
    isIntId('param', 'id', '사용자 ID'),
  ]),

  create: validate([
    requiredString('name', '이름', { min: 2, max: 50 }),
    body('email')
      .trim()
      .notEmpty().withMessage('이메일은 필수입니다.')
      .isEmail().withMessage('유효한 이메일 형식이어야 합니다.'),
    body('phone')
      .optional()
      .trim()
      .matches(/^01[016789]-?\d{3,4}-?\d{4}$/).withMessage('유효한 전화번호 형식이어야 합니다.'),
    body('role')
      .optional()
      .isIn(['ADMIN', 'DRIVER', 'DISPATCH', 'HR', 'ACCOUNTING', 'SAFETY_MGR'])
      .withMessage('유효한 역할이어야 합니다. (ADMIN, DRIVER, DISPATCH, HR, ACCOUNTING, SAFETY_MGR)'),
    requiredString('employeeId', '사원번호', { min: 1, max: 20 }),
    optionalString('licenseNumber', '면허번호', { max: 30 }),
    body('driverType')
      .optional()
      .isIn(['MAIN', 'SPARE'])
      .withMessage('기사 유형은 MAIN 또는 SPARE여야 합니다.'),
    body('vacationDays')
      .optional()
      .isInt({ min: 0, max: 366 }).withMessage('휴가 일수는 0~366 사이의 정수여야 합니다.')
      .toInt(),
    passwordValidator('password', false),
  ]),

  update: validate([
    isIntId('param', 'id', '사용자 ID'),
    optionalString('name', '이름', { max: 50 }),
    body('email')
      .optional({ checkFalsy: true })
      .trim()
      .isEmail().withMessage('유효한 이메일 형식이어야 합니다.'),
    body('phone')
      .optional()
      .trim()
      .matches(/^01[016789]-?\d{3,4}-?\d{4}$/).withMessage('유효한 전화번호 형식이어야 합니다.'),
    body('role')
      .optional()
      .isIn(['ADMIN', 'DRIVER', 'DISPATCH', 'HR', 'ACCOUNTING', 'SAFETY_MGR'])
      .withMessage('유효한 역할이어야 ��니다.'),
    body('driverType')
      .optional()
      .isIn(['MAIN', 'SPARE'])
      .withMessage('기사 유형은 MAIN 또는 SPARE여야 합니다.'),
    body('isActive')
      .optional()
      .isBoolean().withMessage('활성 상태는 boolean이어야 합니다.'),
    body('vacationDays')
      .optional()
      .isInt({ min: 0, max: 366 }).withMessage('휴가 일수는 0~366 사이의 정수여야 합니다.')
      .toInt(),
  ]),

  delete: validate([
    isIntId('param', 'id', '사용자 ID'),
  ]),

  resetPassword: validate([
    isIntId('param', 'id', '사용자 ID'),
    passwordValidator('newPassword', false),
  ]),
};

// ─────────────────────────────────────────────────────────────────
// BUSES
// ─────────────────────────────────────────────────────────────────
export const busValidation = {
  getById: validate([
    isIntId('param', 'id', '버스 ID'),
  ]),

  create: validate([
    requiredString('busNumber', '버스 번호', { min: 1, max: 20 }),
    requiredString('plateNumber', '차량 번호판', { min: 1, max: 20 }),
    optionalString('model', '모델', { max: 50 }),
    body('year')
      .optional()
      .isInt({ min: 1990, max: 2100 }).withMessage('연식은 1990~2100 범위여야 합니다.')
      .toInt(),
    body('capacity')
      .optional()
      .isInt({ min: 1, max: 200 }).withMessage('수용 인원은 1~200 범위여야 합니다.')
      .toInt(),
    optionalInt('routeId', '노선 ID'),
  ]),

  update: validate([
    isIntId('param', 'id', '버스 ID'),
    optionalString('busNumber', '버스 번호', { max: 20 }),
    optionalString('plateNumber', '차량 번호판', { max: 20 }),
    optionalString('model', '모델', { max: 50 }),
    body('year')
      .optional()
      .isInt({ min: 1990, max: 2100 }).withMessage('연식은 1990~2100 범위여야 합니다.')
      .toInt(),
    body('capacity')
      .optional()
      .isInt({ min: 1, max: 200 }).withMessage('수용 인원은 1~200 범위여야 합니다.')
      .toInt(),
    optionalInt('routeId', '노선 ID'),
    body('isActive')
      .optional()
      .isBoolean().withMessage('활성 상태는 boolean이어야 합니다.'),
  ]),

  delete: validate([
    isIntId('param', 'id', '버스 ID'),
  ]),

  updateLocation: validate([
    isIntId('param', 'id', '버스 ID'),
    body('latitude')
      .notEmpty().withMessage('위도는 필수입니다.')
      .isFloat({ min: -90, max: 90 }).withMessage('위도는 -90~90 범위여야 합니다.')
      .toFloat(),
    body('longitude')
      .notEmpty().withMessage('경도는 필수입니다.')
      .isFloat({ min: -180, max: 180 }).withMessage('경도는 -180~180 범위여야 합니다.')
      .toFloat(),
    body('mileageDelta')
      .optional()
      .isInt({ min: 0 }).withMessage('주행거리는 0 이상이어야 합니다.')
      .toInt(),
  ]),
};

// ─────────────────────────────────────────────────────────────────
// ROUTES
// ─────────────────────────────────────────────────────────────────
export const routeValidation = {
  getById: validate([
    isIntId('param', 'id', '노선 ID'),
  ]),

  create: validate([
    requiredString('routeNumber', '노선 번호', { min: 1, max: 20 }),
    requiredString('name', '노선 이름', { min: 1, max: 100 }),
    optionalString('description', '설명'),
    optionalString('startPoint', '출발지', { max: 100 }),
    optionalString('endPoint', '도착지', { max: 100 }),
  ]),

  update: validate([
    isIntId('param', 'id', '노선 ID'),
    optionalString('routeNumber', '노선 번호', { max: 20 }),
    optionalString('name', '노선 이름', { max: 100 }),
    optionalString('description', '설명'),
    optionalString('startPoint', '출발지', { max: 100 }),
    optionalString('endPoint', '도착지', { max: 100 }),
    body('isActive')
      .optional()
      .isBoolean().withMessage('활성 상태는 boolean이어야 합니다.'),
  ]),

  delete: validate([
    isIntId('param', 'id', '노선 ID'),
  ]),

  assignDriver: validate([
    isIntId('param', 'id', '노선 ID'),
    isIntId('body', 'driverId', '기사 ID'),
    body('startDate')
      .notEmpty().withMessage('시작일은 필수입니다.')
      .isISO8601().withMessage('시작일은 유효한 날짜 형식이어야 합니다.'),
  ]),

  removeDriver: validate([
    isIntId('param', 'id', '노선 ID'),
    param('driverId')
      .isInt({ min: 1 }).withMessage('기사 ID는 유효한 정수여야 합니다.')
      .toInt(),
  ]),
};

// ─────────────────────────────────────────────────────────────────
// SCHEDULES
// ─────────────────────────────────────────────────────────────────
export const scheduleValidation = {
  getSchedule: validate([
    ...yearMonthParams(),
  ]),

  generate: validate([
    ...yearMonthBody(),
    body('workDays')
      .optional()
      .isInt({ min: 1, max: 7 }).withMessage('근무일은 1~7 범위여야 합니다.')
      .toInt(),
    body('restDays')
      .optional()
      .isInt({ min: 0, max: 7 }).withMessage('휴무일은 0~7 범위여야 합니다.')
      .toInt(),
  ]),

  updateSlot: validate([
    param('slotId')
      .isInt({ min: 1 }).withMessage('슬롯 ID는 유효한 정수여야 합니다.')
      .toInt(),
    optionalInt('driverId', '기사 ID'),
    optionalInt('routeId', '노선 ID'),
    optionalInt('busId', '버스 ID'),
    body('shift')
      .optional()
      .isIn(['FULL_DAY', 'MORNING', 'AFTERNOON'])
      .withMessage('시프트는 FULL_DAY, MORNING, AFTERNOON 중 하나여야 합니다.'),
    body('status')
      .optional()
      .isIn(['SCHEDULED', 'DROPPED', 'FILLED', 'CANCELLED'])
      .withMessage('유효한 상태값이어야 합니다.'),
    body('isRestDay')
      .optional()
      .isBoolean().withMessage('휴무 여부는 boolean이어야 합니다.'),
    optionalString('notes', '메모'),
  ]),

  publish: validate([
    ...yearMonthParams(),
  ]),

  delete: validate([
    ...yearMonthParams(),
  ]),

  export: validate([
    ...yearMonthParams(),
  ]),

  aiRecommendations: validate([
    ...yearMonthParams(),
    optionalString('notes', '참고 사항'),
  ]),
};

// ─────────────────────────────────────────────────────────────────
// DAY OFF
// ─────────────────────────────────────────────────────────────────
export const dayoffValidation = {
  create: validate([
    body('date')
      .notEmpty().withMessage('날짜는 필수입니다.')
      .isISO8601().withMessage('날짜는 유효한 형식이어야 합니다. (YYYY-MM-DD)'),
    optionalString('reason', '사유'),
  ]),

  review: validate([
    isIntId('param', 'id', '요청 ID'),
    body('status')
      .notEmpty().withMessage('상태는 필수입니다.')
      .isIn(['APPROVED', 'REJECTED'])
      .withMessage('상태는 APPROVED 또는 REJECTED여야 합니다.'),
    optionalString('reviewNote', '검토 메모'),
  ]),

  cancel: validate([
    isIntId('param', 'id', '요청 ID'),
  ]),
};

// ───────────────────��─────────────────────────────────────────────
// EMERGENCY
// ─────────────────────────────────────────────────────────────────
export const emergencyValidation = {
  create: validate([
    isIntId('body', 'slotId', '슬롯 ID'),
    requiredString('reason', '사유', { min: 1, max: 500 }),
  ]),

  accept: validate([
    isIntId('param', 'id', '드랍 ID'),
  ]),

  cancel: validate([
    isIntId('param', 'id', '드랍 ID'),
  ]),
};

// ─────────────────────────────────────────────────────────────────
// PAYROLL
// ─────────────────────────────────────────────────────────────────
export const payrollValidation = {
  upsertSettings: validate([
    body('baseSalary')
      .notEmpty().withMessage('기본급은 필수입니다.')
      .isFloat({ min: 0 }).withMessage('기본급은 0 이상이어야 합니다.'),
    body('overtimeRate')
      .notEmpty().withMessage('연장근로 배율은 필수입니다.')
      .isFloat({ min: 1, max: 5 }).withMessage('연장근로 배율은 1~5 범위여야 합니다.'),
    body('nightShiftBonus')
      .notEmpty().withMessage('야간수당은 필수입니다.')
      .isFloat({ min: 0 }).withMessage('야간수당은 0 이상이어야 합니다.'),
    body('holidayRate')
      .notEmpty().withMessage('휴일 배율은 필수입니다.')
      .isFloat({ min: 1, max: 5 }).withMessage('휴일 배율은 1~5 범위여야 합니다.'),
    body('nationalPensionRate')
      .notEmpty().withMessage('국민연금 요율은 필수입니다.')
      .isFloat({ min: 0, max: 50 }).withMessage('국민연금 요율은 0~50% 범위여야 합니다.'),
    body('healthInsuranceRate')
      .notEmpty().withMessage('건강보험 요율은 필수입니다.')
      .isFloat({ min: 0, max: 50 }).withMessage('건강보험 요율은 0~50% 범위여야 합니다.'),
    body('employmentInsRate')
      .notEmpty().withMessage('고용보험 요율은 필수입니다.')
      .isFloat({ min: 0, max: 50 }).withMessage('고용보험 요율은 0~50% 범위여야 합니다.'),
  ]),

  calculate: validate([
    ...yearMonthBody(),
  ]),

  confirm: validate([
    ...yearMonthBody(),
  ]),

  getRecords: validate([
    ...yearMonthQuery(),
  ]),

  updateRecord: validate([
    isIntId('param', 'id', '급여 기록 ID'),
    body('baseSalary').optional().isFloat({ min: 0 }).withMessage('기본급은 0 이상이어야 합니다.'),
    body('overtimePay').optional().isFloat({ min: 0 }).withMessage('연장수당은 0 이상이어야 합니다.'),
    body('nightShiftPay').optional().isFloat({ min: 0 }).withMessage('야간수당은 0 이상이어야 합니다.'),
    body('holidayPay').optional().isFloat({ min: 0 }).withMessage('휴일수당은 0 이상이어야 합니다.'),
    body('deductions').optional().isFloat({ min: 0 }).withMessage('공제액은 0 이상이어야 합니다.'),
    body('unionDues').optional().isFloat({ min: 0 }).withMessage('조합비는 0 이상이어야 합니다.'),
    optionalString('note', '메모'),
    body('hoboong').optional().isInt({ min: 1 }).withMessage('호봉은 1 이상이어야 합니다.'),
  ]),

  saveHoboongTable: validate([
    body('rows')
      .isArray({ min: 1 }).withMessage('호봉 테이블은 1개 이상의 행이 필요합니다.'),
    body('rows.*.level')
      .isInt({ min: 1 }).withMessage('호봉 레벨은 1 이상의 정수여야 합니다.'),
    body('rows.*.baseSalary')
      .isFloat({ min: 0 }).withMessage('기본급은 0 이상이어야 합니다.'),
  ]),

  saveUnionDues: validate([
    body('dues')
      .isArray({ min: 1 }).withMessage('조합비 목록은 1개 이상이어야 합니다.'),
    body('dues.*.name')
      .trim()
      .notEmpty().withMessage('항목명은 필수입니다.'),
    body('dues.*.type')
      .optional()
      .isIn(['FIXED', 'PERCENTAGE']).withMessage('유형은 FIXED 또는 PERCENTAGE여야 합니다.'),
    body('dues.*.amount')
      .isFloat({ min: 0 }).withMessage('금액은 0 이상이어야 합니다.'),
  ]),
};

// ─────────────────────────────────────────────────────────────────
// RULES
// ─────────────────────────────────────────────────────────────────
export const ruleValidation = {
  create: validate([
    requiredString('title', '제목', { min: 1, max: 200 }),
    requiredString('content', '내용', { min: 1, max: 5000 }),
    optionalString('category', '카테고리', { max: 50 }),
  ]),

  update: validate([
    isIntId('param', 'id', '규칙 ID'),
    optionalString('title', '제목', { max: 200 }),
    optionalString('content', '내용', { max: 5000 }),
    optionalString('category', '카테고리', { max: 50 }),
    body('isActive')
      .optional()
      .isBoolean().withMessage('활성 상태는 boolean이어야 합니다.'),
  ]),

  delete: validate([
    isIntId('param', 'id', '규칙 ID'),
  ]),
};

// ─────────────────────────────────────────────────────────────────
// POSTS
// ─────────────────────────────────────────────────────────────────
export const postValidation = {
  getById: validate([
    isIntId('param', 'id', '게시글 ID'),
  ]),

  create: validate([
    body('boardType')
      .notEmpty().withMessage('게시판 유형은 필수입니다.')
      .isIn(['NOTICE', 'SAFETY', 'ROUTE', 'SUGGESTION', 'FREE'])
      .withMessage('유효한 게시판 유형이어야 합니다. (NOTICE, SAFETY, ROUTE, SUGGESTION, FREE)'),
    requiredString('title', '제목', { min: 1, max: 200 }),
    requiredString('content', '내용', { min: 1, max: 10000 }),
    body('isAnonymous')
      .optional()
      .isBoolean().withMessage('익명 여부는 boolean이어야 합니다.'),
    body('isPinned')
      .optional()
      .isBoolean().withMessage('고정 여부는 boolean이어야 합니다.'),
    body('isUrgent')
      .optional()
      .isBoolean().withMessage('긴급 여부는 boolean이어야 합니다.'),
    optionalInt('routeId', '노선 ID'),
  ]),

  update: validate([
    isIntId('param', 'id', '게시글 ID'),
    optionalString('title', '제목', { max: 200 }),
    optionalString('content', '내용', { max: 10000 }),
    body('isPinned')
      .optional()
      .isBoolean().withMessage('고정 여부는 boolean이어야 합니다.'),
    body('isUrgent')
      .optional()
      .isBoolean().withMessage('긴급 여부는 boolean이어야 합니다.'),
  ]),

  delete: validate([
    isIntId('param', 'id', '게시글 ID'),
  ]),

  getReads: validate([
    isIntId('param', 'id', '게시글 ID'),
  ]),
};

// ─────────────────────────────────────────────────────────────────
// DM (Direct Messages)
// ─────────────────────────────────────────────────────────────────
export const dmValidation = {
  getMessages: validate([
    param('partnerId')
      .isInt({ min: 1 }).withMessage('상대방 ID�� 유효한 정수여야 합니다.')
      .toInt(),
  ]),

  send: validate([
    isIntId('body', 'receiverId', '수신자 ID'),
    requiredString('content', '메시지 내용', { min: 1, max: 2000 }),
  ]),
};

// ─────────────────────────────────────────────────────────────────
// ATTENDANCE
// ─────────────────────────────────────────────────────────────────
export const attendanceValidation = {
  upsert: validate([
    isIntId('body', 'driverId', '기사 ID'),
    body('date')
      .notEmpty().withMessage('날짜는 필수입니다.')
      .isISO8601().withMessage('유효한 날짜 형식이어야 합니다.'),
    body('checkIn')
      .optional()
      .isISO8601().withMessage('출근 시간은 유효한 날짜 형식이어야 합니다.'),
    body('checkOut')
      .optional()
      .isISO8601().withMessage('퇴근 시간은 유효한 날짜 형식이어야 합니다.'),
    body('status')
      .optional()
      .isIn(['PRESENT', 'ABSENT', 'LATE', 'HALF_DAY', 'HOLIDAY'])
      .withMessage('유효한 근태 상태여야 합니다.'),
    optionalString('notes', '메모'),
  ]),

  gpsCheckIn: validate([
    body('latitude')
      .notEmpty().withMessage('위도는 필수입니다.')
      .isFloat({ min: -90, max: 90 }).withMessage('위도는 -90~90 범위여야 합니다.')
      .toFloat(),
    body('longitude')
      .notEmpty().withMessage('경도는 필수입니다.')
      .isFloat({ min: -180, max: 180 }).withMessage('경도는 -180~180 범위여야 합니다.')
      .toFloat(),
  ]),

  gpsCheckOut: validate([
    body('latitude')
      .notEmpty().withMessage('위도는 필수입니다.')
      .isFloat({ min: -90, max: 90 }).withMessage('위도는 -90~90 범위여야 합니다.')
      .toFloat(),
    body('longitude')
      .notEmpty().withMessage('경도는 필수입니다.')
      .isFloat({ min: -180, max: 180 }).withMessage('경도는 -180~180 범위여야 합니다.')
      .toFloat(),
  ]),
};

// ─────────────────────────────────────────────────────────────────
// INSPECTION
// ─────────────────────────────────────────────────────────────────
export const inspectionValidation = {
  submit: validate([
    isIntId('body', 'busId', '버스 ID'),
    body('date')
      .notEmpty().withMessage('날짜는 필수입니다.')
      .isISO8601().withMessage('유효한 날짜 형식이어야 합니다.'),
    body('items')
      .isArray({ min: 1 }).withMessage('점검 항목은 1개 이상이어야 합니다.'),
    body('items.*.id')
      .notEmpty().withMessage('점검 항목 ID는 필수입니다.'),
    body('items.*.result')
      .isIn(['PASS', 'FAIL', 'N/A']).withMessage('점검 결과는 PASS, FAIL, N/A 중 하나여야 합니다.'),
    optionalString('notes', '메모', { max: 1000 }),
  ]),
};

// ─────────────────────────────────────────────────────────────────
// MAINTENANCE
// ─────────────────────────────────────────────────────────────────
export const maintenanceValidation = {
  create: validate([
    isIntId('body', 'busId', '버스 ID'),
    body('type')
      .notEmpty().withMessage('정비 유형은 필수입니다.')
      .isIn(['ROUTINE', 'REPAIR', 'INSPECTION', 'TIRE', 'OIL_CHANGE', 'BRAKE', 'ENGINE', 'BODY', 'ELECTRICAL', 'OTHER'])
      .withMessage('유효한 정비 유형이어야 합니다.'),
    body('scheduledAt')
      .notEmpty().withMessage('예정일은 필수입니다.')
      .isISO8601().withMessage('예정일은 유효한 날짜 형식이어야 합니다.'),
    optionalString('notes', '메모', { max: 1000 }),
    body('mileageAtService')
      .optional()
      .isInt({ min: 0 }).withMessage('주행거리는 0 이상이어야 합니다.'),
  ]),

  update: validate([
    isIntId('param', 'id', '정비 기록 ID'),
    body('status')
      .optional()
      .isIn(['SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'])
      .withMessage('유효한 정비 상태여야 합니다.'),
    body('completedAt')
      .optional()
      .isISO8601().withMessage('완료일은 유효한 날짜 형식이어야 합니다.'),
    optionalString('notes', '메모', { max: 1000 }),
  ]),

  delete: validate([
    isIntId('param', 'id', '정비 기록 ID'),
  ]),
};

// ─────────────────────────────────────────────────────────────────
// APPROVALS
// ─────────────────────────────────────────────────────────────────
export const approvalValidation = {
  getById: validate([
    isIntId('param', 'id', '결재 ID'),
  ]),

  create: validate([
    body('type')
      .notEmpty().withMessage('결재 유형은 필수입니다.')
      .isIn(['DAY_OFF', 'SHIFT_CHANGE', 'EXPENSE', 'MAINTENANCE', 'INCIDENT', 'PURCHASE', 'OTHER'])
      .withMessage('유효한 결재 유형이어야 합니다.'),
    requiredString('title', '제목', { min: 1, max: 200 }),
    requiredString('content', '내용', { min: 1, max: 5000 }),
    body('approverIds')
      .optional()
      .isArray().withMessage('결재자 목록은 배열이어야 합니다.'),
    body('approverIds.*')
      .optional()
      .isInt({ min: 1 }).withMessage('결재자 ID는 유효한 정수여야 합니다.'),
  ]),

  process: validate([
    isIntId('param', 'id', '결재 ID'),
    body('action')
      .notEmpty().withMessage('결재 동작은 필수입니다.')
      .isIn(['approve', 'reject'])
      .withMessage('결재 동작은 approve 또는 reject여야 합니다.'),
    optionalString('comment', '코멘트', { max: 1000 }),
  ]),

  cancel: validate([
    isIntId('param', 'id', '결재 ID'),
  ]),
};

// ─────────────────────────────────────────────────────────────────
// SAFETY
// ─────────────────────────────────────────────────────────────────
export const safetyValidation = {
  createIncident: validate([
    isIntId('body', 'driverId', '기사 ID'),
    body('date')
      .notEmpty().withMessage('날짜는 필수입니다.')
      .isISO8601().withMessage('유효한 날짜 형식이어야 합니다.'),
    requiredString('type', '유형', { min: 1, max: 50 }),
    requiredString('description', '설명', { min: 1, max: 2000 }),
    body('penalty')
      .optional()
      .isFloat({ min: 0 }).withMessage('벌금은 0 이상이어야 합니다.'),
    optionalString('notes', '메모', { max: 1000 }),
  ]),

  resolveIncident: validate([
    isIntId('param', 'id', '사고 기록 ID'),
    optionalString('notes', '메모', { max: 1000 }),
  ]),

  deleteIncident: validate([
    isIntId('param', 'id', '사고 기록 ID'),
  ]),

  createTraining: validate([
    isIntId('body', 'driverId', '기사 ID'),
    requiredString('type', '교육 유형', { min: 1, max: 100 }),
    body('completedAt')
      .notEmpty().withMessage('완료일은 필수입니다.')
      .isISO8601().withMessage('유효한 ���짜 형식이어야 합니다.'),
    body('expiresAt')
      .optional()
      .isISO8601().withMessage('만료일은 유효한 날짜 형식이어야 합니다.'),
    optionalString('institution', '교육 기관', { max: 200 }),
    optionalString('notes', '메모', { max: 1000 }),
  ]),

  updateDriverLicense: validate([
    param('driverId')
      .isInt({ min: 1 }).withMessage('기사 ID는 유효한 정수여야 합니다.')
      .toInt(),
    optionalString('licenseNumber', '면허번호', { max: 30 }),
    body('licenseExpiresAt')
      .optional()
      .isISO8601().withMessage('면허 만료일은 유효한 날짜 형식이어야 합니다.'),
    body('qualificationExpiresAt')
      .optional()
      .isISO8601().withMessage('자격 만료일은 유효한 날짜 형식이어야 합니다.'),
  ]),
};

// ─────────────────────────────────────────────────────────────────
// NOTIFICATIONS
// ─────────────────────────────────────────────────────────────────
export const notificationValidation = {
  markAsRead: validate([
    isIntId('param', 'id', '알림 ID'),
  ]),
};

// ─────────────────────────────────────────────────────────────────
// CHAT (AI)
// ─────────────────────────────────────────────────────────────────
export const chatValidation = {
  createSession: validate([
    optionalString('title', '세션 제목', { max: 200 }),
  ]),

  getSession: validate([
    isIntId('param', 'id', '세션 ID'),
  ]),

  sendMessage: validate([
    isIntId('param', 'id', '세션 ID'),
    requiredString('message', '메시지', { min: 1, max: 5000 }),
    body('saveAsRule')
      .optional()
      .isBoolean().withMessage('규칙 저장 여부는 boolean이어야 합니다.'),
  ]),

  deleteSession: validate([
    isIntId('param', 'id', '세션 ID'),
  ]),
};

// ─────────────────────────────────────────────────────────────────
// CONTACTS
// ─────────────────────────────────────────────────────────────────
export const contactValidation = {
  submit: validate([
    requiredString('name', '이름', { min: 1, max: 50 }),
    body('phone')
      .trim()
      .notEmpty().withMessage('연락처는 필수입니다.')
      .matches(/^01[016789]-?\d{3,4}-?\d{4}$/).withMessage('유효한 전화번호 형식이어야 합니다.'),
    body('email')
      .optional({ checkFalsy: true })
      .trim()
      .isEmail().withMessage('유효한 이메일 형식이어야 합니다.')
      .isLength({ max: 200 }).withMessage('이메일은 200자 이내여야 합니다.'),
    body('topic')
      .optional({ checkFalsy: true })
      .isIn(['general', 'demo', 'pricing', 'bug']).withMessage('유효하지 않은 문의 유형입니다.'),
    body('buses')
      .optional()
      .isInt({ min: 0 }).withMessage('버스 수는 0 이상의 정수여야 합니다.'),
    body('employees')
      .optional()
      .isInt({ min: 0 }).withMessage('직원 수는 0 이상의 정수여야 합니다.'),
    optionalString('message', '메시지', { max: 2000 }),
  ]),
};

// ─────────────────────────────────────────────────────────────────
// COMPANIES
// ─────────────────────────────────────────────────────────────────
export const companyValidation = {
  register: validate([
    requiredString('companyName', '회사명', { min: 2, max: 100 }),
    // 회사 코드는 서버에서 회사명으로 자동 생성하므로 입력받지 않는다.
    requiredString('adminName', '관리자 이름', { min: 2, max: 50 }),
    body('adminEmail')
      .trim()
      .notEmpty().withMessage('관리자 이메일은 필수입니다.')
      .isEmail().withMessage('유효한 이메일 형식이어야 합니다.'),
    body('adminPassword')
      .notEmpty().withMessage('비밀번호는 필수입니다.')
      .isLength({ min: 8 }).withMessage('비밀번호는 최소 8자 이상이어야 합니다.'),
    body('adminPhone')
      .trim()
      .notEmpty().withMessage('관리자 전화번호는 필수입니다.')
      .matches(/^01[016789]-?\d{3,4}-?\d{4}$/).withMessage('유효한 전화번호 형식이어야 합니다.'),
  ]),

  checkCode: validate([
    param('code')
      .trim()
      .notEmpty().withMessage('회사 코드는 필수입니다.')
      .matches(/^[A-Za-z0-9]{2,10}$/).withMessage('회사 코드는 영문/숫자 2~10자여야 합니다.'),
  ]),
};

// ─────────────────────────────────────────────────────────────────
// ONBOARDING
// ─────────────────────────────────────────────────────────────────
export const onboardingValidation = {
  confirmImport: validate([
    body('drivers')
      .optional()
      .isArray().withMessage('기사 목록은 배열이어야 합니다.'),
    body('routes')
      .optional()
      .isArray().withMessage('노선 목록은 배열이어야 합니다.'),
    body('buses')
      .optional()
      .isArray().withMessage('버스 목록은 배열이어야 합니다.'),
  ]),
};
