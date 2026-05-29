import { Router } from 'express';
import {
  getUsers,
  getUserById,
  createUser,
  updateUser,
  deleteUser,
  resetPassword,
  exportMyData,
  deleteMyData,
  getDataCategories,
} from '../controllers/userController';
import { authenticate, requireRole, requireOfficeStaff } from '../middleware/auth';
import { userValidation } from '../middleware/validate';

const router = Router();

/**
 * @swagger
 * tags:
 *   name: Users
 *   description: 사용자(기사/관리자) 관리
 */

router.use(authenticate);

// ─────────────────────────────────────────
// 개인정보보호법 — 내 데이터 관리 (모든 인증된 사용자)
// 주의: /me/* 경로는 /:id 보다 먼저 선언해야 함
// ─────────────────────────────────────────

/**
 * @swagger
 * /users/me/data-categories:
 *   get:
 *     tags: [Users]
 *     summary: 내 데이터 카테고리 및 건수 조회
 *     responses:
 *       200:
 *         description: 데이터 카테고리 목록
 */
router.get('/me/data-categories', getDataCategories);

/**
 * @swagger
 * /users/me/export:
 *   get:
 *     tags: [Users]
 *     summary: 내 개인정보 JSON 다운로드
 *     responses:
 *       200:
 *         description: JSON 파일 다운로드
 */
router.get('/me/export', exportMyData);

/**
 * @swagger
 * /users/me/data:
 *   delete:
 *     tags: [Users]
 *     summary: 내 계정 삭제 (개인정보 익명화)
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [password]
 *             properties:
 *               password: { type: string }
 *     responses:
 *       200:
 *         description: 삭제 완료
 */
router.delete('/me/data', deleteMyData);

/**
 * @swagger
 * /users:
 *   get:
 *     tags: [Users]
 *     summary: 사용자 목록 조회
 *     parameters:
 *       - in: query
 *         name: role
 *         schema:
 *           type: string
 *           enum: [DRIVER, DISPATCH, HR, ACCOUNTING, ADMIN]
 *         description: 역할별 필터
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [ACTIVE, INACTIVE]
 *     responses:
 *       200:
 *         description: 사용자 목록
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   id: { type: string }
 *                   name: { type: string }
 *                   email: { type: string }
 *                   role: { type: string }
 *                   employeeNumber: { type: string }
 *                   status: { type: string }
 */
router.get('/', requireOfficeStaff, getUsers);
router.get('/:id', ...userValidation.getById, getUserById);

/**
 * @swagger
 * /users:
 *   post:
 *     tags: [Users]
 *     summary: 사용자 생성
 *     description: DISPATCH 또는 HR 권한 필요
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, email, employeeNumber, role]
 *             properties:
 *               name: { type: string, example: 홍길동 }
 *               email: { type: string, example: hong@example.com }
 *               employeeNumber: { type: string, example: DRV099 }
 *               role: { type: string, enum: [DRIVER, DISPATCH, HR, ACCOUNTING, ADMIN] }
 *               phone: { type: string, example: "010-1234-5678" }
 *     responses:
 *       201:
 *         description: 사용자 생성 완료
 *       409:
 *         description: 이메일 또는 사원번호 중복
 */
router.post('/', requireRole('DISPATCH', 'HR'), ...userValidation.create, createUser);

/**
 * @swagger
 * /users/{id}:
 *   put:
 *     tags: [Users]
 *     summary: 사용자 정보 수정
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name: { type: string }
 *               phone: { type: string }
 *               role: { type: string }
 *               status: { type: string }
 *     responses:
 *       200:
 *         description: 수정 완료
 *       404:
 *         description: 사용자 없음
 */
router.put('/:id', ...userValidation.update, updateUser);

/**
 * @swagger
 * /users/{id}:
 *   delete:
 *     tags: [Users]
 *     summary: 사용자 삭제 (비활성화)
 *     description: DISPATCH 또는 HR 권한 필요
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: 삭제 완료
 *       404:
 *         description: 사용자 없음
 */
router.delete('/:id', requireRole('DISPATCH', 'HR'), ...userValidation.delete, deleteUser);
router.post('/:id/reset-password', requireRole('DISPATCH', 'HR'), ...userValidation.resetPassword, resetPassword);

export default router;
