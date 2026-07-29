import { Router } from 'express';
import {
  getSchedule,
  getScheduleList,
  generateSchedule,
  updateScheduleSlot,
  createScheduleSlot,
  manualOverrideSlot,
  publishSchedule,
  deleteSchedule,
  exportScheduleExcel,
  getAIRecommendations,
  bisExport,
  getMyMonthlySummary,
  listMonthSchedules,
  duplicateSchedule,
  renameSchedule,
} from '../controllers/scheduleController';
import { authenticate, requireRole, AuthRequest } from '../middleware/auth';
import { saveEngineDraft, getPostingView } from '../services/engineScheduleService';
import logger from '../utils/logger';
import { prisma } from '../utils/prisma';
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
router.get('/:year/:month/summary', ...scheduleValidation.getSchedule, getMyMonthlySummary);
// 멀티 초안: 해당 월의 모든 배차표(초안 프로필 + 발행본) 목록
router.get('/:year/:month/drafts', requireRole('DISPATCH'), ...scheduleValidation.getSchedule, listMonthSchedules);
// 멀티 초안: 배차표 복제 (새 초안 프로필로)
router.post('/by-id/:id/duplicate', requireRole('DISPATCH'), duplicateSchedule);
// 멀티 초안: 프로필 이름 변경
router.put('/by-id/:id/rename', requireRole('DISPATCH'), renameSchedule);

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

/**
 * @swagger
 * /schedules/generate-v2:
 *   post:
 *     tags: [Schedules]
 *     summary: 배차표 생성 v2 (정책 기반 솔버 — CompanyPolicy + monthly-grid-solver)
 *     description: |
 *       회사 정책 (workdayBands, restCycle, shiftSystem, crewModel, constitutional) 자동 로드.
 *       PAIR/SOLO/TRIO + 1/2/3교대 + 격일제 모두 지원.
 *       기존 DRAFT 가 있으면 overwriteDraft=true 로 덮어쓰기 가능 (PUBLISHED 는 절대 불가).
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [year, month]
 *             properties:
 *               year: { type: integer, example: 2026 }
 *               month: { type: integer, example: 5 }
 *               overwriteDraft: { type: boolean, default: false }
 *     responses:
 *       201:
 *         description: 배차표 생성 완료 (메트릭 + 위반 + 면제 적용 운전자 포함)
 *       409:
 *         description: 발행/아카이브된 배차표 존재 (덮어쓰기 불가)
 *       422:
 *         description: 회사 데이터 부족 (운전자/차량/매핑 없음)
 */
router.post(
  '/generate-v2',
  requireRole('DISPATCH'),
  async (req, res) => {
    try {
      const { generateMonthlyScheduleV2 } = await import(
        '../services/solverDispatchService'
      );
      const { year, month, name, workDays, restDays, newHireDriverIds, blockedRoutes } = req.body as {
        year: number;
        month: number;
        /** 초안 프로필 이름 (선택) — 미지정 시 "초안 N" 자동 부여 */
        name?: string;
        /** 근무/휴무 사이클 (선택) — 회사 정책의 restCycle 을 오버라이드 */
        workDays?: number;
        restDays?: number;
        newHireDriverIds?: number[];
        blockedRoutes?: { routeId: number; driverIds: number[] }[];
      };
      if (!year || !month || month < 1 || month > 12) {
        return res
          .status(400)
          .json({ error: { code: 'INVALID_INPUT', message: 'year/month 필수, month 는 1~12' } });
      }
      const auth = (req as unknown as { user?: { companyId: number; id: number } }).user;
      if (!auth) {
        return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: '인증 필요' } });
      }
      const result = await generateMonthlyScheduleV2({
        companyId: auth.companyId,
        year,
        month,
        adminId: auth.id,
        name: typeof name === 'string' && name.trim() ? name.trim().slice(0, 50) : undefined,
        restCycleOverride:
          Number.isInteger(workDays) && Number.isInteger(restDays) &&
          (workDays as number) >= 1 && (workDays as number) <= 7 &&
          (restDays as number) >= 1 && (restDays as number) <= 7
            ? { workDays: workDays as number, restDays: restDays as number }
            : undefined,
        newHireDriverIds: Array.isArray(newHireDriverIds) ? newHireDriverIds : undefined,
        blockedRoutes: Array.isArray(blockedRoutes) ? blockedRoutes : undefined,
      });
      return res.status(201).json({
        scheduleId: result.scheduleId,
        slotsCreated: result.slotsCreated,
        policyUsed: result.policyUsed,
        elapsedMs: result.elapsedMs,
        summary: result.output.summary,
        metrics: result.output.metrics,
        unfilled: result.output.unfilled.slice(0, 50),
        hardViolators: result.output.workloads
          .filter((w) => w.workloadEval.hardViolation)
          .slice(0, 50),
        exempted: result.output.workloads
          .filter((w) => w.workloadEval.exempted)
          .slice(0, 50),
      });
    } catch (e) {
      const msg = (e as Error).message;
      const statusCode = msg.includes('이미 발행') || msg.includes('이미 있습니다') || msg.includes('이미 5개')
        ? 409
        : msg.includes('없습니다')
        ? 422
        : 500;
      // 내부 오류 문구(영문/기술 상세)는 사용자에게 그대로 노출하지 않음
      const safeMsg = /[가-힣]/.test(msg) ? msg : '배차표 생성 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.';
      return res.status(statusCode).json({
        error: { code: 'GENERATE_V2_FAILED', message: safeMsg },
      });
    }
  },
);

/**
 * @swagger
 * /schedules/from-engine:
 *   post:
 *     summary: AI 배차 엔진 생성 결과를 배차표 초안으로 저장
 *     description: >
 *       엔진(/engine/generate)이 만든 cells를 그대로 받아 Schedule +
 *       SchedulePattern(순번·로테이션) + ScheduleSlot(기사 배정)으로 영속화한다.
 *       엔진은 엑셀 값(차량번호·기사명)으로 말하므로 여기서 DB id로 번역하며,
 *       매칭 실패 항목은 unmatched로 전부 돌려준다.
 *     tags: [Schedules]
 */
router.post('/from-engine', requireRole('DISPATCH'), async (req: AuthRequest, res) => {
  try {
    const { year, month, name, cells } = req.body ?? {};
    if (!Number.isInteger(year) || !Number.isInteger(month) || !cells || typeof cells !== 'object') {
      return res.status(400).json({ success: false, message: 'year, month, cells 가 필요합니다.' });
    }
    const result = await saveEngineDraft(req.user!.companyId, req.user!.id, {
      year, month, name, cells,
    });
    return res.json({ success: true, data: result });
  } catch (error) {
    const msg = error instanceof Error ? error.message : '저장에 실패했습니다.';
    logger.error(`[schedules/from-engine] ${msg}`);
    // 매칭 실패처럼 사용자가 고칠 수 있는 문제는 원문을 그대로 보여준다
    return res.status(422).json({ success: false, message: msg });
  }
});

/**
 * @swagger
 * /schedules/by-id/{id}/posting:
 *   get:
 *     summary: 게시 양식(행=차량, 열=날짜 → 순번|오전|오후) 조회
 *     description: 패턴이 없는 옛 배차표는 groups/cells 가 비어 오며 호출측이 기존 뷰로 폴백한다.
 *     tags: [Schedules]
 */
router.get('/by-id/:id/posting', async (req: AuthRequest, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ success: false, message: '잘못된 배차표 id 입니다.' });
    }
    // 타 회사 배차표 열람 차단
    const owned = await prisma.schedule.findFirst({
      where: { id, companyId: req.user!.companyId },
      select: { id: true },
    });
    if (!owned) {
      return res.status(404).json({ success: false, message: '배차표를 찾을 수 없습니다.' });
    }
    const view = await getPostingView(id);
    return res.json({ success: true, data: view });
  } catch (error) {
    logger.error(`[schedules/posting] ${error}`);
    return res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
  }
});

router.post('/slots', requireRole('DISPATCH'), createScheduleSlot);
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
