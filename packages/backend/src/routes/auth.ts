import { Router } from 'express';
import {
  login, kakaoLogin, sendPhoneOtp, verifyPhoneOtp,
  getMe, updatePushToken, changePassword,
  refreshAccessToken, logout, forceLogout,
  forgotPasswordSendOtp, forgotPasswordReset, findCompanyCode,
} from '../controllers/authController';
import { authenticate, requireAdmin } from '../middleware/auth';
import { loginLimiter, otpSendLimiter } from '../middleware/rateLimits';
import { authValidation } from '../middleware/validate';

const router = Router();

/**
 * @swagger
 * tags:
 *   name: Auth
 *   description: 인증 및 토큰 관리
 */

/**
 * @swagger
 * /auth/login:
 *   post:
 *     tags: [Auth]
 *     summary: 이메일/비밀번호 로그인
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password]
 *             properties:
 *               email:
 *                 type: string
 *                 example: admin@example.com
 *               password:
 *                 type: string
 *                 example: admin123!
 *     responses:
 *       200:
 *         description: 로그인 성공
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 accessToken:
 *                   type: string
 *                 refreshToken:
 *                   type: string
 *                 user:
 *                   type: object
 *                   properties:
 *                     id: { type: string }
 *                     name: { type: string }
 *                     role: { type: string }
 *       401:
 *         description: 인증 실패
 */
router.post('/login', loginLimiter, ...authValidation.login, login);
router.post('/kakao', loginLimiter, kakaoLogin);

// OTP (1분 1회 제한)
router.post('/phone/send-otp', otpSendLimiter, ...authValidation.sendPhoneOtp, sendPhoneOtp);
router.post('/phone/verify', loginLimiter, ...authValidation.verifyPhoneOtp, verifyPhoneOtp);

// 비밀번호 재설정 (휴대폰 OTP 기반) / 회사 코드 찾기
router.post('/forgot-password/send-otp', otpSendLimiter, ...authValidation.forgotPasswordSendOtp, forgotPasswordSendOtp);
router.post('/forgot-password/reset', loginLimiter, ...authValidation.forgotPasswordReset, forgotPasswordReset);
router.post('/find-company-code', otpSendLimiter, ...authValidation.findCompanyCode, findCompanyCode);

/**
 * @swagger
 * /auth/refresh:
 *   post:
 *     tags: [Auth]
 *     summary: Access 토큰 갱신
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [refreshToken]
 *             properties:
 *               refreshToken:
 *                 type: string
 *     responses:
 *       200:
 *         description: 새 토큰 발급
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 accessToken: { type: string }
 *                 refreshToken: { type: string }
 *       401:
 *         description: 유효하지 않은 리프레시 토큰
 */
router.post('/refresh', ...authValidation.refresh, refreshAccessToken);

/**
 * @swagger
 * /auth/logout:
 *   post:
 *     tags: [Auth]
 *     summary: 로그아웃
 *     responses:
 *       200:
 *         description: 로그아웃 성공
 */
router.post('/logout', authenticate, logout);
router.post('/force-logout/:userId', authenticate, requireAdmin, ...authValidation.forceLogout, forceLogout);

/**
 * @swagger
 * /auth/me:
 *   get:
 *     tags: [Auth]
 *     summary: 현재 로그인 사용자 정보 조회
 *     responses:
 *       200:
 *         description: 사용자 정보
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 id: { type: string }
 *                 email: { type: string }
 *                 name: { type: string }
 *                 role: { type: string, enum: [DRIVER, DISPATCH, HR, ACCOUNTING, ADMIN] }
 *                 employeeNumber: { type: string }
 *       401:
 *         description: 인증 필요
 */
router.get('/me', authenticate, getMe);
router.put('/password', authenticate, changePassword);
router.put('/push-token', authenticate, ...authValidation.pushToken, updatePushToken);

export default router;
