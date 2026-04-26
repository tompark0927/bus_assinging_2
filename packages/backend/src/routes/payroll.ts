import { Router } from 'express';
import multer from 'multer';
import {
  getPayrollSetting, upsertPayrollSetting,
  calculatePayroll, getPayrollRecords, confirmPayroll, updatePayrollRecord,
  getHoboongTable, saveHoboongTable,
  getUnionDues, saveUnionDues,
  analyzePayrollExcel, confirmPayrollRules,
} from '../controllers/payrollController';
import { authenticate, requireRole } from '../middleware/auth';
import { payrollValidation } from '../middleware/validate';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

/**
 * @swagger
 * tags:
 *   name: Payroll
 *   description: 급여 계산/조회/확정 (ACCOUNTING 권한 필요)
 */

router.use(authenticate, requireRole('ACCOUNTING'));

router.get('/settings', getPayrollSetting);
router.put('/settings', ...payrollValidation.upsertSettings, upsertPayrollSetting);

/**
 * @swagger
 * /payroll:
 *   get:
 *     tags: [Payroll]
 *     summary: 급여 내역 조회
 *     parameters:
 *       - in: query
 *         name: year
 *         required: true
 *         schema: { type: integer, example: 2026 }
 *       - in: query
 *         name: month
 *         required: true
 *         schema: { type: integer, example: 3 }
 *       - in: query
 *         name: userId
 *         schema: { type: string }
 *         description: 특정 사용자 필터 (생략 시 전체)
 *     responses:
 *       200:
 *         description: 급여 레코드 목록
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   id: { type: string }
 *                   userId: { type: string }
 *                   userName: { type: string }
 *                   year: { type: integer }
 *                   month: { type: integer }
 *                   basePay: { type: number }
 *                   overtimePay: { type: number }
 *                   totalPay: { type: number }
 *                   status: { type: string, enum: [DRAFT, CONFIRMED] }
 */
router.get('/', ...payrollValidation.getRecords, getPayrollRecords);

/**
 * @swagger
 * /payroll/calculate:
 *   post:
 *     tags: [Payroll]
 *     summary: 급여 일괄 계산
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [year, month]
 *             properties:
 *               year: { type: integer, example: 2026 }
 *               month: { type: integer, example: 3 }
 *     responses:
 *       200:
 *         description: 계산 완료
 *       409:
 *         description: 이미 확정된 급여
 */
router.post('/calculate', ...payrollValidation.calculate, calculatePayroll);

/**
 * @swagger
 * /payroll/confirm:
 *   post:
 *     tags: [Payroll]
 *     summary: 급여 확정
 *     description: 확정 후 수정 불가
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [year, month]
 *             properties:
 *               year: { type: integer, example: 2026 }
 *               month: { type: integer, example: 3 }
 *     responses:
 *       200:
 *         description: 확정 완료
 */
router.post('/confirm', ...payrollValidation.confirm, confirmPayroll);
router.patch('/:id', ...payrollValidation.updateRecord, updatePayrollRecord);

// 호봉 테이블
router.get('/hoboong', getHoboongTable);
router.put('/hoboong', ...payrollValidation.saveHoboongTable, saveHoboongTable);

// 조합비
router.get('/union-dues', getUnionDues);
router.put('/union-dues', ...payrollValidation.saveUnionDues, saveUnionDues);

// AI 급여 파일 분석
router.post('/analyze-excel', upload.single('file'), analyzePayrollExcel);
router.post('/confirm-rules', confirmPayrollRules);

export default router;
