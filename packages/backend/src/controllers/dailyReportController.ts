/**
 * DailyReport REST API.
 *
 * 관리자가 일일 보고서를 조회·읽음 처리·재생성하는 엔드포인트.
 *
 * 라우트:
 *   GET    /api/v1/daily-reports             — 목록 (필터·페이지)
 *   GET    /api/v1/daily-reports/:id         — 상세 (마크다운 본문 + 구조화 요약)
 *   POST   /api/v1/daily-reports/:id/read    — 읽음 처리
 *   POST   /api/v1/daily-reports/regenerate  — 특정 날짜 재생성 (force=true 로 호출)
 *
 * 보안: 회사 격리 자동, ADMIN/DISPATCH/OWNER/DIRECTOR 권한.
 */

import type { Response } from 'express';
import type { Prisma } from '@prisma/client';
import { prisma } from '../utils/prisma';
import { AuthRequest } from '../middleware/auth';
import logger from '../utils/logger';
import { runDailyReportForCompany } from '../services/dailyReportRunner';

// ─────────────────────────────────────────────
// GET /daily-reports
// ─────────────────────────────────────────────

export const listDailyReports = async (req: AuthRequest, res: Response) => {
  try {
    const companyId = req.user!.companyId;
    const {
      severity,
      isRead,
      from,
      to,
      page = '1',
      pageSize = '30',
    } = req.query as Record<string, string | undefined>;

    const where: Prisma.DailyReportWhereInput = { companyId };
    if (severity) where.severity = severity;
    if (isRead !== undefined) where.isRead = isRead === 'true';
    if (from || to) {
      where.reportDate = {};
      if (from) (where.reportDate as Prisma.DateTimeFilter).gte = new Date(from);
      if (to) {
        const end = new Date(to);
        end.setHours(23, 59, 59, 999);
        (where.reportDate as Prisma.DateTimeFilter).lte = end;
      }
    }

    const pageNum = Math.max(1, parseInt(page, 10));
    const sizeNum = Math.min(100, Math.max(1, parseInt(pageSize, 10)));

    const [items, total] = await Promise.all([
      prisma.dailyReport.findMany({
        where,
        select: {
          id: true,
          reportDate: true,
          generatedAt: true,
          severity: true,
          isRead: true,
          readById: true,
          readAt: true,
          summary: true,
        },
        orderBy: { reportDate: 'desc' },
        skip: (pageNum - 1) * sizeNum,
        take: sizeNum,
      }),
      prisma.dailyReport.count({ where }),
    ]);

    return res.json({
      success: true,
      data: {
        items,
        total,
        page: pageNum,
        pageSize: sizeNum,
        totalPages: Math.ceil(total / sizeNum),
      },
    });
  } catch (error) {
    logger.error('listDailyReports error', error);
    return res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
  }
};

// ─────────────────────────────────────────────
// GET /daily-reports/:id
// ─────────────────────────────────────────────

export const getDailyReport = async (req: AuthRequest, res: Response) => {
  try {
    const companyId = req.user!.companyId;
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ success: false, message: '잘못된 보고서 ID' });
    }

    const report = await prisma.dailyReport.findFirst({
      where: { id, companyId },
      include: {
        readBy: { select: { id: true, name: true, employeeId: true } },
      },
    });

    if (!report) {
      return res.status(404).json({ success: false, message: '보고서를 찾을 수 없습니다.' });
    }

    return res.json({ success: true, data: report });
  } catch (error) {
    logger.error('getDailyReport error', error);
    return res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
  }
};

// ─────────────────────────────────────────────
// POST /daily-reports/:id/read
// ─────────────────────────────────────────────

export const markDailyReportRead = async (req: AuthRequest, res: Response) => {
  try {
    const companyId = req.user!.companyId;
    const userId = req.user!.id;
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ success: false, message: '잘못된 보고서 ID' });
    }

    // 회사 격리 검증
    const report = await prisma.dailyReport.findFirst({
      where: { id, companyId },
      select: { id: true, isRead: true },
    });
    if (!report) {
      return res.status(404).json({ success: false, message: '보고서를 찾을 수 없습니다.' });
    }
    if (report.isRead) {
      return res.json({ success: true, data: { id: report.id, alreadyRead: true } });
    }

    const updated = await prisma.dailyReport.update({
      where: { id: report.id },
      data: {
        isRead: true,
        readById: userId,
        readAt: new Date(),
      },
      include: {
        readBy: { select: { id: true, name: true, employeeId: true } },
      },
    });

    return res.json({ success: true, data: updated });
  } catch (error) {
    logger.error('markDailyReportRead error', error);
    return res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
  }
};

// ─────────────────────────────────────────────
// POST /daily-reports/regenerate
// ─────────────────────────────────────────────

export const regenerateDailyReport = async (req: AuthRequest, res: Response) => {
  try {
    const companyId = req.user!.companyId;
    // body 에 force 가 없어도 기본 force=true (재생성 의도가 명확)
    const result = await runDailyReportForCompany(companyId, { force: true });

    if ('skipped' in result) {
      return res.status(409).json({
        success: false,
        message: `재생성 실패: ${result.reason}`,
      });
    }

    return res.json({
      success: true,
      data: {
        decisionId: result.decisionId,
        status: result.status,
        finalAction: result.finalAction,
        toolCallCount: result.toolCalls.length,
        costKrw: result.costKrw,
      },
    });
  } catch (error) {
    logger.error('regenerateDailyReport error', error);
    return res.status(500).json({ success: false, message: '재생성 중 오류가 발생했습니다.' });
  }
};
