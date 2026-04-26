import { Router } from 'express';
import {
  getEmergencyDrops,
  createEmergencyDrop,
  acceptEmergencySlot,
  cancelEmergencyDrop,
} from '../controllers/emergencyController';
import { authenticate, requireRole } from '../middleware/auth';
import { emergencyValidation } from '../middleware/validate';

const router = Router();

/**
 * @swagger
 * tags:
 *   name: Emergency
 *   description: 당일 긴급 슬롯 드랍/수락
 */

router.use(authenticate);

/**
 * @swagger
 * /emergency:
 *   get:
 *     tags: [Emergency]
 *     summary: 긴급 드랍 목록 조회
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [OPEN, ACCEPTED, CANCELLED]
 *       - in: query
 *         name: date
 *         schema: { type: string, format: date }
 *     responses:
 *       200:
 *         description: 긴급 드랍 목록
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   id: { type: string }
 *                   slotId: { type: string }
 *                   droppedByUserId: { type: string }
 *                   acceptedByUserId: { type: string, nullable: true }
 *                   reason: { type: string }
 *                   status: { type: string, enum: [OPEN, ACCEPTED, CANCELLED] }
 *                   date: { type: string, format: date }
 */
router.get('/', getEmergencyDrops);

/**
 * @swagger
 * /emergency:
 *   post:
 *     tags: [Emergency]
 *     summary: 긴급 슬롯 드랍 생성
 *     description: 당일 배차 슬롯을 드랍하고 쉬는 기사들에게 푸시 알림 전송
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [slotId, reason]
 *             properties:
 *               slotId:
 *                 type: string
 *                 description: 드랍할 배차 슬롯 ID
 *               reason:
 *                 type: string
 *                 example: 건강 사유
 *     responses:
 *       201:
 *         description: 드랍 생성 및 알림 전송 완료
 *       400:
 *         description: 유효하지 않은 슬롯
 */
router.post('/', ...emergencyValidation.create, createEmergencyDrop);

/**
 * @swagger
 * /emergency/{id}/accept:
 *   put:
 *     tags: [Emergency]
 *     summary: 긴급 슬롯 수락
 *     description: 쉬는 기사가 드랍된 슬롯 수락
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: 수락 완료, 배차표 자동 업데이트
 *       404:
 *         description: 드랍 없음
 *       409:
 *         description: 이미 다른 기사가 수락
 */
router.put('/:id/accept', ...emergencyValidation.accept, acceptEmergencySlot);
router.put('/:id/cancel', requireRole('DISPATCH'), ...emergencyValidation.cancel, cancelEmergencyDrop);

export default router;
