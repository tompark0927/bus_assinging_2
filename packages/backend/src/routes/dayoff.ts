import { Router } from 'express';
import {
  getDayOffRequests,
  createDayOffRequest,
  reviewDayOffRequest,
  cancelDayOffRequest,
} from '../controllers/dayoffController';
import { authenticate, requireRole } from '../middleware/auth';
import { dayoffValidation } from '../middleware/validate';

const router = Router();

/**
 * @swagger
 * tags:
 *   name: DayOff
 *   description: 휴무 요청/승인 관리
 */

router.use(authenticate);

/**
 * @swagger
 * /dayoff:
 *   get:
 *     tags: [DayOff]
 *     summary: 휴무 요청 목록 조회
 *     description: 기사는 본인 요청만, 관리자는 전체 조회
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [PENDING, APPROVED, REJECTED]
 *       - in: query
 *         name: month
 *         schema: { type: integer }
 *       - in: query
 *         name: year
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: 휴무 요청 목록
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
 *                   date: { type: string, format: date }
 *                   reason: { type: string }
 *                   status: { type: string, enum: [PENDING, APPROVED, REJECTED] }
 */
router.get('/', getDayOffRequests);

/**
 * @swagger
 * /dayoff:
 *   post:
 *     tags: [DayOff]
 *     summary: 휴무 요청 생성
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [date]
 *             properties:
 *               date:
 *                 type: string
 *                 format: date
 *                 example: "2026-04-15"
 *               reason:
 *                 type: string
 *                 example: 개인 사유
 *     responses:
 *       201:
 *         description: 휴무 요청 생성 완료
 *       409:
 *         description: 해당 날짜 이미 요청 존재
 */
router.post('/', ...dayoffValidation.create, createDayOffRequest);

/**
 * @swagger
 * /dayoff/{id}/review:
 *   put:
 *     tags: [DayOff]
 *     summary: 휴무 요청 승인/거절
 *     description: DISPATCH 권한 필요. 승인 시 배차표에 자동 반영
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [action]
 *             properties:
 *               action:
 *                 type: string
 *                 enum: [APPROVE, REJECT]
 *               rejectReason:
 *                 type: string
 *     responses:
 *       200:
 *         description: 처리 완료
 *       404:
 *         description: 요청 없음
 */
router.put('/:id/review', requireRole('DISPATCH'), ...dayoffValidation.review, reviewDayOffRequest);
router.delete('/:id', ...dayoffValidation.cancel, cancelDayOffRequest);

export default router;
