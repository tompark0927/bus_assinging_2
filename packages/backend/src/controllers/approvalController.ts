import { Response } from 'express';
import { prisma } from '../utils/prisma';
import { AuthRequest } from '../middleware/auth';
import { sendPushNotification } from '../services/notificationService';
import { dispatchImmediateEmergency } from '../services/emergencyAgentRunner';
import logger from '../utils/logger';
import { parseIdParam } from '../utils/helpers';
import { createAuditLog } from '../utils/auditLog';
import { getPagination, paginatedResponse } from '../utils/pagination';

// 결재 목록 조회
export const getApprovals = async (req: AuthRequest, res: Response) => {
  try {
    const { status, type, role } = req.query;
    const userId = req.user!.id;
    const companyId = req.user!.companyId;

    let where: Record<string, unknown> = { companyId };

    if (status) where.status = status;
    if (type) where.type = type;

    // role=requester: 내가 기안한 것
    // role=approver: 내가 결재해야 할 것
    // 없으면: ADMIN은 전체, DRIVER는 본인 기안만
    if (role === 'requester') {
      where.requesterId = userId;
    } else if (role === 'approver') {
      // 내가 결재자인 것만
      const myStepApprovalIds = await prisma.approvalStep.findMany({
        where: { approverId: userId },
        select: { approvalId: true },
      });
      where.id = { in: myStepApprovalIds.map(s => s.approvalId) };
    } else if (req.user!.role === 'DRIVER') {
      where.requesterId = userId;
    }

    const pagination = getPagination(req);
    const [approvals, total] = await Promise.all([
      prisma.approval.findMany({
        where,
        include: {
          requester: { select: { id: true, name: true, employeeId: true } },
          steps: {
            include: {
              approver: { select: { id: true, name: true, role: true } },
            },
            orderBy: { step: 'asc' },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: pagination.skip,
        take: pagination.limit,
      }),
      prisma.approval.count({ where }),
    ]);

    return res.json({ success: true, ...paginatedResponse(approvals, total, pagination) });
  } catch (error) {
    logger.error(error);
    return res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
  }
};

// 결재 상세 조회
export const getApproval = async (req: AuthRequest, res: Response) => {
  try {
    const id = parseIdParam(req.params.id, res, '결재 ID');
    if (id === null) return;

    const approval = await prisma.approval.findFirst({
      where: { id, companyId: req.user!.companyId },
      include: {
        requester: { select: { id: true, name: true, employeeId: true, role: true } },
        steps: {
          include: {
            approver: { select: { id: true, name: true, role: true } },
          },
          orderBy: { step: 'asc' },
        },
      },
    });

    if (!approval) {
      return res.status(404).json({ success: false, message: '결재를 찾을 수 없습니다.' });
    }

    // DRIVER는 본인 기안 또는 본인이 결재자인 것만
    if (req.user!.role === 'DRIVER') {
      const isRequester = approval.requesterId === req.user!.id;
      const isApprover = approval.steps.some(s => s.approverId === req.user!.id);
      if (!isRequester && !isApprover) {
        return res.status(403).json({ success: false, message: '권한이 없습니다.' });
      }
    }

    return res.json({ success: true, data: approval });
  } catch (error) {
    logger.error(error);
    return res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
  }
};

// 결재 기안 (생성)
export const createApproval = async (req: AuthRequest, res: Response) => {
  try {
    const { type, title, content, data, approverIds } = req.body;

    if (!type || !title || !content) {
      return res.status(400).json({ success: false, message: '유형, 제목, 내용을 입력해주세요.' });
    }

    // approverIds: 결재선 (순서대로)
    // 미지정 시 회사 ADMIN들을 자동 배정
    let resolvedApproverIds: number[] = approverIds || [];
    if (resolvedApproverIds.length === 0) {
      const admins = await prisma.user.findMany({
        where: { companyId: req.user!.companyId, role: 'ADMIN', isActive: true },
        select: { id: true },
        orderBy: { id: 'asc' },
      });
      resolvedApproverIds = admins.map(a => a.id);
    }

    if (resolvedApproverIds.length === 0) {
      return res.status(400).json({ success: false, message: '결재자가 없습니다.' });
    }

    const approval = await prisma.approval.create({
      data: {
        companyId: req.user!.companyId,
        type,
        title,
        content,
        data: data || undefined,
        status: 'PENDING',
        requesterId: req.user!.id,
        currentStep: 0,
        totalSteps: resolvedApproverIds.length,
        steps: {
          create: resolvedApproverIds.map((approverId: number, index: number) => ({
            step: index,
            approverId,
            status: index === 0 ? 'PENDING' : 'DRAFT',
          })),
        },
      },
      include: {
        requester: { select: { id: true, name: true, employeeId: true } },
        steps: {
          include: {
            approver: { select: { id: true, name: true, role: true } },
          },
          orderBy: { step: 'asc' },
        },
      },
    });

    await createAuditLog({
      req: req as any,
      action: 'CREATE',
      entityType: 'Approval',
      entityId: approval.id,
      changes: {
        type: { old: null, new: type },
        title: { old: null, new: title },
        status: { old: null, new: 'PENDING' },
        approverIds: { old: null, new: resolvedApproverIds },
      },
    });

    // 첫 번째 결재자에게 알림
    await sendPushNotification(
      resolvedApproverIds[0],
      '📝 새 결재 요청',
      `${req.user!.name}님이 "${title}" 결재를 요청했습니다.`,
      'APPROVAL_REQUESTED',
      { approvalId: approval.id }
    );

    return res.status(201).json({ success: true, data: approval });
  } catch (error) {
    logger.error(error);
    return res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
  }
};

// 결재 승인/반려
export const processApproval = async (req: AuthRequest, res: Response) => {
  try {
    const id = parseIdParam(req.params.id, res, '결재 ID');
    if (id === null) return;
    const { action, comment } = req.body; // action: 'approve' | 'reject'

    if (!['approve', 'reject'].includes(action)) {
      return res.status(400).json({ success: false, message: '승인 또는 반려를 선택해주세요.' });
    }

    const approval = await prisma.approval.findFirst({
      where: { id, companyId: req.user!.companyId },
      include: {
        requester: { select: { id: true, name: true } },
        steps: { orderBy: { step: 'asc' } },
      },
    });

    if (!approval) {
      return res.status(404).json({ success: false, message: '결재를 찾을 수 없습니다.' });
    }

    if (approval.status !== 'PENDING') {
      return res.status(400).json({ success: false, message: '이미 처리된 결재입니다.' });
    }

    // 현재 단계의 결재자인지 확인
    const currentStepData = approval.steps.find(s => s.step === approval.currentStep);
    if (!currentStepData || currentStepData.approverId !== req.user!.id) {
      return res.status(403).json({ success: false, message: '현재 결재 순서가 아닙니다.' });
    }

    if (action === 'reject') {
      // 반려: 전체 결재 반려
      await prisma.$transaction([
        prisma.approvalStep.update({
          where: { id: currentStepData.id },
          data: { status: 'REJECTED', comment, actedAt: new Date() },
        }),
        prisma.approval.update({
          where: { id },
          data: {
            status: 'REJECTED',
            rejectedBy: req.user!.id,
            rejectReason: comment,
            completedAt: new Date(),
          },
        }),
      ]);

      await sendPushNotification(
        approval.requesterId,
        '❌ 결재 반려',
        `"${approval.title}" 결재가 반려되었습니다. 사유: ${comment || '없음'}`,
        'APPROVAL_REJECTED',
        { approvalId: id }
      );
    } else {
      // 승인
      const isLastStep = approval.currentStep >= approval.totalSteps - 1;

      if (isLastStep) {
        // 최종 승인: 스텝 업데이트 + 결재 상태 + 사이드이펙트를 하나의 트랜잭션으로 처리
        let dropForEscalation: { id: number; slotDate: Date; shift: string; routeId: number } | null = null;

        await prisma.$transaction(async (tx) => {
          await tx.approvalStep.update({
            where: { id: currentStepData.id },
            data: { status: 'APPROVED', comment, actedAt: new Date() },
          });

          await tx.approval.update({
            where: { id },
            data: { status: 'APPROVED', completedAt: new Date() },
          });

          // DAY_OFF / SHIFT_CHANGE 결재 승인 시 → DayOffRequest 생성 + EmergencyDrop 연동
          if (approval.type === 'DAY_OFF' || approval.type === 'SHIFT_CHANGE') {
            const approvalData = approval.data as Record<string, string> | null;
            const dateStr = approvalData?.date;
            if (dateStr) {
              const dayOffDate = new Date(dateStr + 'T00:00:00');
              const year = dayOffDate.getFullYear();
              const month = dayOffDate.getMonth() + 1;

              await tx.dayOffRequest.create({
                data: {
                  companyId: req.user!.companyId,
                  driverId: approval.requesterId,
                  date: dayOffDate,
                  reason: approval.content,
                  status: 'APPROVED',
                  reviewedBy: req.user!.id,
                  reviewNote: `결재 #${id} 통해 자동 승인`,
                },
              });

              const schedule = await tx.schedule.findUnique({
                where: { companyId_year_month: { companyId: req.user!.companyId, year, month } },
              });

              if (schedule) {
                const slot = await tx.scheduleSlot.findFirst({
                  where: {
                    scheduleId: schedule.id,
                    driverId: approval.requesterId,
                    date: dayOffDate,
                    isRestDay: false,
                    status: 'SCHEDULED',
                  },
                });

                if (slot) {
                  const existingDrop = await tx.emergencyDrop.findUnique({ where: { slotId: slot.id } });
                  if (!existingDrop) {
                    const drop = await tx.emergencyDrop.create({
                      data: {
                        slotId: slot.id,
                        driverId: approval.requesterId,
                        reason: `${approval.type === 'SHIFT_CHANGE' ? '교대' : '휴무'} 결재 승인 - ${approval.content}`,
                        status: 'OPEN',
                      },
                    });

                    await tx.scheduleSlot.update({
                      where: { id: slot.id },
                      data: { status: 'DROPPED', isRestDay: true },
                    });

                    // 에스컬레이션은 트랜잭션 외부에서 실행 (외부 API 호출 포함)
                    dropForEscalation = { id: drop.id, slotDate: slot.date, shift: slot.shift, routeId: slot.routeId };

                    logger.info('결재 승인 → EmergencyDrop 생성', {
                      type: approval.type,
                      approvalId: id,
                      slotId: slot.id,
                      date: dateStr,
                    });
                  }
                }
              }
            }
          }
        });

        // 트랜잭션 성공 후 결원 처리 (fire-and-forget — 에이전트 또는 폴백)
        if (dropForEscalation !== null) {
          const d = dropForEscalation as { id: number; slotDate: Date; shift: string; routeId: number };
          dispatchImmediateEmergency({
            dropId: d.id,
            slotDate: d.slotDate,
            shift: d.shift,
            companyId: req.user!.companyId,
            routeId: d.routeId,
          });
        }

        await sendPushNotification(
          approval.requesterId,
          '✅ 결재 승인',
          `"${approval.title}" 결재가 최종 승인되었습니다.`,
          'APPROVAL_APPROVED',
          { approvalId: id }
        );
      } else {
        // 다음 단계로
        const nextStep = approval.currentStep + 1;
        await prisma.$transaction([
          prisma.approval.update({
            where: { id },
            data: { currentStep: nextStep },
          }),
          prisma.approvalStep.update({
            where: { approvalId_step: { approvalId: id, step: nextStep } },
            data: { status: 'PENDING' },
          }),
        ]);

        const nextStepData = approval.steps.find(s => s.step === nextStep);
        if (nextStepData) {
          await sendPushNotification(
            nextStepData.approverId,
            '📝 결재 요청',
            `${approval.requester.name}님의 "${approval.title}" 결재를 검토해주세요.`,
            'APPROVAL_REQUESTED',
            { approvalId: id }
          );
        }
      }
    }

    const updated = await prisma.approval.findFirst({
      where: { id, companyId: req.user!.companyId },
      include: {
        requester: { select: { id: true, name: true, employeeId: true } },
        steps: {
          include: {
            approver: { select: { id: true, name: true, role: true } },
          },
          orderBy: { step: 'asc' },
        },
      },
    });

    await createAuditLog({
      req: req as any,
      action: 'UPDATE',
      entityType: 'Approval',
      entityId: id,
      changes: {
        status: { old: 'PENDING', new: updated?.status },
        action: { old: null, new: action },
        comment: { old: null, new: comment || null },
        step: { old: approval.currentStep, new: updated?.currentStep },
      },
    });

    return res.json({ success: true, data: updated });
  } catch (error) {
    logger.error(error);
    return res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
  }
};

// 결재 취소 (기안자만, PENDING 상태만)
export const cancelApproval = async (req: AuthRequest, res: Response) => {
  try {
    const id = parseIdParam(req.params.id, res, '결재 ID');
    if (id === null) return;

    const approval = await prisma.approval.findFirst({
      where: { id, companyId: req.user!.companyId },
    });

    if (!approval) {
      return res.status(404).json({ success: false, message: '결재를 찾을 수 없습니다.' });
    }

    if (approval.requesterId !== req.user!.id && req.user!.role !== 'ADMIN') {
      return res.status(403).json({ success: false, message: '본인이 기안한 결재만 취소할 수 있습니다.' });
    }

    if (approval.status !== 'PENDING') {
      return res.status(400).json({ success: false, message: '대기 중인 결재만 취소할 수 있습니다.' });
    }

    await prisma.approval.update({
      where: { id },
      data: { status: 'CANCELLED', completedAt: new Date() },
    });

    return res.json({ success: true, message: '결재가 취소되었습니다.' });
  } catch (error) {
    logger.error(error);
    return res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
  }
};

// 결재 통계 (관리자용)
export const getApprovalStats = async (req: AuthRequest, res: Response) => {
  try {
    const companyId = req.user!.companyId;

    const [pending, approved, rejected, total] = await Promise.all([
      prisma.approval.count({ where: { companyId, status: 'PENDING' } }),
      prisma.approval.count({ where: { companyId, status: 'APPROVED' } }),
      prisma.approval.count({ where: { companyId, status: 'REJECTED' } }),
      prisma.approval.count({ where: { companyId } }),
    ]);

    // 내가 처리해야 할 결재 수
    const myPending = await prisma.approvalStep.count({
      where: {
        approverId: req.user!.id,
        status: 'PENDING',
        approval: { status: 'PENDING', companyId },
      },
    });

    return res.json({
      success: true,
      data: { pending, approved, rejected, total, myPending },
    });
  } catch (error) {
    logger.error(error);
    return res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
  }
};
