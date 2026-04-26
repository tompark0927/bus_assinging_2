import { Router } from 'express';
import {
  getSchedule,
  getScheduleList,
  generateSchedule,
  updateScheduleSlot,
  manualOverrideSlot,
  publishSchedule,
  deleteSchedule,
  exportScheduleExcel,
  getAIRecommendations,
  bisExport,
} from '../controllers/scheduleController';
import { authenticate, requireRole } from '../middleware/auth';
import { scheduleValidation } from '../middleware/validate';

const router = Router();

/**
 * @swagger
 * tags:
 *   name: Schedules
 *   description: 배차표 생성/관리/발행
 */

router.use(authenticate);

/**
 * @swagger
 * /schedules:
 *   get:
 *     tags: [Schedules]
 *     summary: 배차표 목록 조회
 *     responses:
 *       200:
 *         description: 배차표 목록 (year/month 기준)
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   id: { type: string }
 *                   year: { type: integer }
 *                   month: { type: integer }
 *                   status: { type: string, enum: [DRAFT, PUBLISHED] }
 *                   createdAt: { type: string, format: date-time }
 */
router.get('/', getScheduleList);

/**
 * @swagger
 * /schedules/{year}/{month}:
 *   get:
 *     tags: [Schedules]
 *     summary: 특정 월 배차표 상세 조회
 *     parameters:
 *       - in: path
 *         name: year
 *         required: true
 *         schema: { type: integer, example: 2026 }
 *       - in: path
 *         name: month
 *         required: true
 *         schema: { type: integer, example: 3 }
 *     responses:
 *       200:
 *         description: 배차표 상세 (슬롯 포함)
 *       404:
 *         description: 배차표 없음
 */
router.get('/:year/:month', ...scheduleValidation.getSchedule, getSchedule);

/**
 * @swagger
 * /schedules/generate:
 *   post:
 *     tags: [Schedules]
 *     summary: 배차표 자동 생성
 *     description: DISPATCH 권한 필요. 5일 근무/2일 휴무 기본 사이클로 배차표 생성
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [year, month]
 *             properties:
 *               year: { type: integer, example: 2026 }
 *               month: { type: integer, example: 4 }
 *     responses:
 *       201:
 *         description: 배차표 생성 완료
 *       409:
 *         description: 해당 월 배차표 이미 존재
 */
router.post('/generate', requireRole('DISPATCH'), ...scheduleValidation.generate, generateSchedule);
router.put('/slots/:slotId', requireRole('DISPATCH'), ...scheduleValidation.updateSlot, updateScheduleSlot);
router.put('/slots/:slotId/override', requireRole('DISPATCH'), manualOverrideSlot);

/**
 * @swagger
 * /schedules/{year}/{month}/publish:
 *   put:
 *     tags: [Schedules]
 *     summary: 배차표 발행
 *     description: DISPATCH 권한 필요. 발행 시 전체 기사에게 푸시 알림 전송
 *     parameters:
 *       - in: path
 *         name: year
 *         required: true
 *         schema: { type: integer }
 *       - in: path
 *         name: month
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: 발행 완료
 *       404:
 *         description: 배차표 없음
 */
router.put('/:year/:month/publish', requireRole('DISPATCH'), ...scheduleValidation.publish, publishSchedule);
router.delete('/:year/:month', requireRole('DISPATCH'), ...scheduleValidation.delete, deleteSchedule);

/**
 * @swagger
 * /schedules/{year}/{month}/export:
 *   get:
 *     tags: [Schedules]
 *     summary: 배차표 Excel 내보내기
 *     description: DISPATCH 권한 필요
 *     parameters:
 *       - in: path
 *         name: year
 *         required: true
 *         schema: { type: integer }
 *       - in: path
 *         name: month
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: Excel 파일 다운로드
 *         content:
 *           application/vnd.openxmlformats-officedocument.spreadsheetml.sheet:
 *             schema:
 *               type: string
 *               format: binary
 */
router.get('/:year/:month/export', requireRole('DISPATCH'), ...scheduleValidation.export, exportScheduleExcel);
router.get('/:year/:month/bis-export', requireRole('DISPATCH'), ...scheduleValidation.export, bisExport);
router.post('/:year/:month/ai-recommendations', requireRole('DISPATCH'), ...scheduleValidation.aiRecommendations, getAIRecommendations);

export default router;
