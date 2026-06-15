import { Response } from 'express';
import bcrypt from 'bcryptjs';
import { prisma } from '../utils/prisma';
import { AuthRequest, isFullAccess } from '../middleware/auth';
import logger from '../utils/logger';
import { getPagination, paginatedResponse } from '../utils/pagination';
import { createAuditLog } from '../utils/auditLog';
import { generateInitialPassword, normalizePhone } from '../utils/initialPassword';

const userSelect = {
  id: true,
  name: true,
  email: true,
  phone: true,
  role: true,
  employeeId: true,
  licenseNumber: true,
  driverType: true,
  isActive: true,
  vacationDays: true,
  createdAt: true,
  updatedAt: true,
};

export const getUsers = async (req: AuthRequest, res: Response) => {
  try {
    const { role, isActive, search, driverType, staff } = req.query;

    const where: Record<string, unknown> = { companyId: req.user!.companyId };
    if (role) where.role = role;
    // staff=1 → 직원(관리자) 계정만: 기사(DRIVER) 외 모든 역할. (계정 관리 페이지용)
    else if (staff === '1') where.role = { not: 'DRIVER' };
    if (isActive !== undefined) where.isActive = isActive === 'true';
    if (driverType) where.driverType = driverType;
    if (search) {
      where.OR = [
        { name: { contains: search as string, mode: 'insensitive' } },
        { email: { contains: search as string, mode: 'insensitive' } },
        { employeeId: { contains: search as string } },
      ];
    }

    const pagination = getPagination(req);
    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        select: userSelect,
        orderBy: { name: 'asc' },
        skip: pagination.skip,
        take: pagination.limit,
      }),
      prisma.user.count({ where }),
    ]);

    // 기사별 올해 사용 휴가 수(비반려 휴무요청) — 잔여 휴가 = vacationDays - vacationUsed
    const driverIds = users.filter((u) => u.role === 'DRIVER').map((u) => u.id);
    let usedMap = new Map<number, number>();
    if (driverIds.length > 0) {
      const year = new Date().getFullYear();
      const grouped = await prisma.dayOffRequest.groupBy({
        by: ['driverId'],
        where: {
          companyId: req.user!.companyId,
          driverId: { in: driverIds },
          status: { not: 'REJECTED' },
          date: { gte: new Date(Date.UTC(year, 0, 1)), lt: new Date(Date.UTC(year + 1, 0, 1)) },
        },
        _count: { _all: true },
      });
      usedMap = new Map(grouped.map((g) => [g.driverId, g._count._all]));
    }
    const data = users.map((u) => ({ ...u, vacationUsed: usedMap.get(u.id) ?? 0 }));

    return res.json({ success: true, ...paginatedResponse(data, total, pagination) });
  } catch (error) {
    logger.error(error);
    return res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
  }
};

export const getUserById = async (req: AuthRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id);

    // 본인 프로필 또는 full-access 역할(OWNER/DIRECTOR/ADMIN) 만 조회 가능
    if (!isFullAccess(req.user!.role) && req.user!.id !== id) {
      return res.status(403).json({ success: false, message: '권한이 없습니다.' });
    }

    const user = await prisma.user.findFirst({
      where: { id, companyId: req.user!.companyId },
      select: {
        ...userSelect,
        companyId: true,
        routeAssignments: {
          where: { isActive: true },
          include: { route: true },
        },
      },
    });

    if (!user) {
      return res.status(404).json({ success: false, message: '사용자를 찾을 수 없습니다.' });
    }

    return res.json({ success: true, data: user });
  } catch (error) {
    logger.error(error);
    return res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
  }
};

export const createUser = async (req: AuthRequest, res: Response) => {
  try {
    const { name, email, phone, role, licenseNumber, driverType, password, vacationDays } = req.body;
    let { employeeId } = req.body;

    const effectiveRole = role || 'DRIVER';

    // 기사는 전화번호 필수 (전화번호로 로그인 + 최초 비밀번호에 사용)
    if (effectiveRole === 'DRIVER') {
      const digits = String(phone ?? '').replace(/\D/g, '');
      if (digits.length < 4) {
        return res.status(400).json({ success: false, message: '기사는 전화번호가 필수입니다. (최초 비밀번호 생성에 사용됩니다)' });
      }
    }

    // 사원번호 미입력 시 자동 생성 (DRV001, DRV002, ...) — 온보딩 수동 입력 등
    if (!employeeId) {
      const last = await prisma.user.findFirst({
        where: { companyId: req.user!.companyId, role: 'DRIVER' },
        orderBy: { employeeId: 'desc' },
        select: { employeeId: true },
      });
      let next = 1;
      if (last?.employeeId) {
        const n = parseInt(last.employeeId.replace(/\D/g, ''), 10);
        if (!isNaN(n)) next = n + 1;
      }
      employeeId = `DRV${String(next).padStart(3, '0')}`;
    }

    const existingUser = await prisma.user.findFirst({
      where: { companyId: req.user!.companyId, OR: [{ email }, { employeeId }] },
    });

    if (existingUser) {
      return res.status(409).json({ success: false, message: '이미 존재하는 이메일 또는 사원번호입니다.' });
    }

    // 기사 + 비밀번호 미지정 → 최초 비밀번호 = 이름(영문 키 입력)+전화번호 뒷4자리, 변경 강제
    const isDriverAutoPw = effectiveRole === 'DRIVER' && !password;
    const initialPlain = isDriverAutoPw
      ? generateInitialPassword(name, phone)
      : (password || employeeId);
    const hashedPassword = await bcrypt.hash(initialPlain, 10);

    const user = await prisma.user.create({
      data: {
        companyId: req.user!.companyId,
        name,
        email,
        phone: phone ? normalizePhone(phone) : phone,
        role: effectiveRole,
        employeeId,
        licenseNumber,
        driverType,
        ...(vacationDays !== undefined ? { vacationDays } : {}),
        password: hashedPassword,
        mustChangePassword: isDriverAutoPw,
      },
      select: userSelect,
    });

    await createAuditLog({
      req: req as any,
      action: 'CREATE',
      entityType: 'User',
      entityId: user.id,
      changes: {
        name: { old: null, new: name },
        email: { old: null, new: email },
        role: { old: null, new: role || 'DRIVER' },
        employeeId: { old: null, new: employeeId },
      },
    });

    return res.status(201).json({ success: true, data: user });
  } catch (error) {
    logger.error(error);
    return res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
  }
};

export const updateUser = async (req: AuthRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id);

    // Verify company
    const existingUser = await prisma.user.findFirst({ where: { id, companyId: req.user!.companyId } });
    if (!existingUser) {
      return res.status(404).json({ success: false, message: '사용자를 찾을 수 없습니다.' });
    }

    // 권한: full-access 역할(OWNER/DIRECTOR/ADMIN) 만 다른 사용자 수정 가능. 본인은 누구나 가능.
    const isAdmin = isFullAccess(req.user!.role);
    if (!isAdmin && req.user!.id !== id) {
      return res.status(403).json({ success: false, message: '권한이 없습니다.' });
    }

    const { name, phone, licenseNumber, driverType, isActive, role, email, vacationDays } = req.body;

    const updateData: Record<string, unknown> = { name, phone, licenseNumber };

    // 이메일 변경 — 정규화 없이 입력 그대로 저장(로그인은 입력값 정확 매칭). 전역 unique 라 중복 체크.
    if (email !== undefined) {
      const trimmed = typeof email === 'string' ? email.trim() : email;
      if (trimmed) {
        // email 은 전역 unique → findUnique 로 전역 중복 체크 (멀티테넌시 가드 예외 대상)
        const dup = await prisma.user.findUnique({ where: { email: trimmed }, select: { id: true } });
        if (dup && dup.id !== id) {
          return res.status(409).json({ success: false, message: '이미 사용 중인 이메일입니다.' });
        }
      }
      updateData.email = trimmed || null;
    }

    // 민감 필드(역할/활성 상태/기사 유형) 는 full-access 역할만 변경 가능
    if (isAdmin) {
      if (driverType !== undefined) updateData.driverType = driverType;
      if (isActive !== undefined) updateData.isActive = isActive;
      if (vacationDays !== undefined) updateData.vacationDays = vacationDays;
      if (role !== undefined) {
        // 권한 상승 방지: 자신의 role 은 변경 불가 (OWNER 가 자기 자신을 ADMIN 으로 강등 등은 별도 트랜잭션 필요)
        if (req.user!.id === id) {
          return res.status(400).json({ success: false, message: '본인의 역할은 변경할 수 없습니다.' });
        }
        updateData.role = role;
      }
    }

    // Build changes diff for audit
    const auditChanges: Record<string, { old: unknown; new: unknown }> = {};
    if (name !== undefined) auditChanges.name = { old: existingUser.name, new: name };
    if (phone !== undefined) auditChanges.phone = { old: existingUser.phone, new: phone };
    if (licenseNumber !== undefined) auditChanges.licenseNumber = { old: existingUser.licenseNumber, new: licenseNumber };
    if (driverType !== undefined) auditChanges.driverType = { old: existingUser.driverType, new: driverType };
    if (isActive !== undefined) auditChanges.isActive = { old: existingUser.isActive, new: isActive };
    if (vacationDays !== undefined) auditChanges.vacationDays = { old: existingUser.vacationDays, new: vacationDays };
    if (role !== undefined) auditChanges.role = { old: existingUser.role, new: role };
    if (email !== undefined) auditChanges.email = { old: existingUser.email, new: email };

    const user = await prisma.user.update({
      where: { id },
      data: updateData,
      select: userSelect,
    });

    await createAuditLog({
      req: req as any,
      action: 'UPDATE',
      entityType: 'User',
      entityId: id,
      changes: auditChanges,
    });

    return res.json({ success: true, data: user });
  } catch (error) {
    logger.error(error);
    return res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
  }
};

export const deleteUser = async (req: AuthRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id);

    const existingUser = await prisma.user.findFirst({ where: { id, companyId: req.user!.companyId } });
    if (!existingUser) {
      return res.status(404).json({ success: false, message: '사용자를 찾을 수 없습니다.' });
    }

    // Soft delete
    await prisma.user.update({
      where: { id },
      data: { isActive: false },
    });

    await createAuditLog({
      req: req as any,
      action: 'DELETE',
      entityType: 'User',
      entityId: id,
      changes: {
        isActive: { old: true, new: false },
        name: { old: existingUser.name, new: existingUser.name },
      },
    });

    return res.json({ success: true, message: '사용자가 비활성화되었습니다.' });
  } catch (error) {
    logger.error(error);
    return res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
  }
};

// ─────────────────────────────────────────
// 개인정보보호법 (Korean Privacy Law) Compliance
// ─────────────────────────────────────────

export const exportMyData = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const companyId = req.user!.companyId;

    const [
      user,
      attendanceRecords,
      payrollRecords,
      dayOffRequests,
      approvalRequests,
      approvalSteps,
      trainingRecords,
      sentMessageCount,
      receivedMessageCount,
      scheduleSlots,
      incidentRecords,
    ] = await Promise.all([
      prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          role: true,
          employeeId: true,
          licenseNumber: true,
          licenseExpiresAt: true,
          qualificationExpiresAt: true,
          driverType: true,
          shiftGroup: true,
          assignedBusNumber: true,
          hoboong: true,
          isActive: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      prisma.attendanceRecord.findMany({
        where: { driverId: userId, companyId },
        select: {
          date: true, checkIn: true, checkOut: true, status: true, notes: true, createdAt: true,
        },
        orderBy: { date: 'desc' },
      }),
      prisma.payrollRecord.findMany({
        where: { driverId: userId, companyId },
        select: {
          year: true, month: true, baseSalary: true, workDays: true,
          overtimePay: true, nightShiftPay: true, holidayPay: true,
          grossPay: true, deductions: true, unionDues: true, netPay: true,
          isConfirmed: true, createdAt: true,
        },
        orderBy: [{ year: 'desc' }, { month: 'desc' }],
      }),
      prisma.dayOffRequest.findMany({
        where: { driverId: userId, companyId },
        select: {
          date: true, reason: true, status: true, reviewNote: true, createdAt: true,
        },
        orderBy: { date: 'desc' },
      }),
      prisma.approval.findMany({
        where: { requesterId: userId, companyId },
        select: {
          type: true, title: true, status: true, createdAt: true, completedAt: true,
        },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.approvalStep.findMany({
        where: { approverId: userId },
        select: {
          status: true, comment: true, actedAt: true, createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.trainingRecord.findMany({
        where: { driverId: userId, companyId },
        select: {
          type: true, completedAt: true, expiresAt: true, institution: true, notes: true,
        },
        orderBy: { completedAt: 'desc' },
      }),
      prisma.directMessage.count({ where: { senderId: userId, companyId } }),
      prisma.directMessage.count({ where: { receiverId: userId, companyId } }),
      prisma.scheduleSlot.findMany({
        where: { driverId: userId },
        select: {
          date: true, shift: true, status: true, isRestDay: true, notes: true,
        },
        orderBy: { date: 'desc' },
      }),
      prisma.incidentRecord.findMany({
        where: { driverId: userId, companyId },
        select: {
          date: true, type: true, description: true, isResolved: true, createdAt: true,
        },
        orderBy: { date: 'desc' },
      }),
    ]);

    if (!user) {
      return res.status(404).json({ success: false, message: '사용자를 찾을 수 없습니다.' });
    }

    const exportData = {
      exportedAt: new Date().toISOString(),
      exportReason: '개인정보보호법 제4조에 의한 개인정보 열람 요청',
      profile: user,
      attendanceRecords,
      payrollRecords,
      dayOffRequests,
      approvalHistory: {
        submitted: approvalRequests,
        reviewed: approvalSteps,
      },
      messages: {
        sentCount: sentMessageCount,
        receivedCount: receivedMessageCount,
        note: '메시지 내용은 개인정보 보호를 위해 건수만 포함됩니다.',
      },
      scheduleSlots,
      trainingRecords,
      incidentRecords,
    };

    const filename = `personal-data-${user.employeeId}-${new Date().toISOString().slice(0, 10)}.json`;

    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.send(JSON.stringify(exportData, null, 2));
  } catch (error) {
    logger.error(error);
    return res.status(500).json({ success: false, message: '데이터 내보내기 중 오류가 발생했습니다.' });
  }
};

export const deleteMyData = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const { password } = req.body;

    if (!password) {
      return res.status(400).json({ success: false, message: '비밀번호를 입력해주세요.' });
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      return res.status(404).json({ success: false, message: '사용자를 찾을 수 없습니다.' });
    }

    const isPasswordValid = await bcrypt.compare(password, user.password || '');
    if (!isPasswordValid) {
      return res.status(401).json({ success: false, message: '비밀번호가 일치하지 않습니다.' });
    }

    // Soft-delete + anonymize PII
    await prisma.user.update({
      where: { id: userId },
      data: {
        isActive: false,
        name: '탈퇴회원',
        email: null,
        phone: null,
        licenseNumber: null,
        password: null,
        kakaoId: null,
        expoPushToken: null,
      },
    });

    // Revoke all refresh tokens
    await prisma.refreshToken.deleteMany({ where: { userId } });

    await createAuditLog({
      req: req as any,
      action: 'DELETE',
      entityType: 'User',
      entityId: userId,
      changes: {
        action: { old: null, new: '개인정보 삭제 요청 (개인정보보호법)' },
        name: { old: user.name, new: '탈퇴회원' },
        email: { old: user.email, new: null },
        phone: { old: user.phone, new: null },
      },
    });

    return res.json({
      success: true,
      message: '계정이 삭제되었습니다. 법적 보관 의무가 있는 급여 기록(5년), 근태 기록(3년)은 보관 기간 경과 후 자동 삭제됩니다.',
    });
  } catch (error) {
    logger.error(error);
    return res.status(500).json({ success: false, message: '계정 삭제 중 오류가 발생했습니다.' });
  }
};

export const getDataCategories = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const companyId = req.user!.companyId;

    const [
      attendanceCount,
      payrollCount,
      dayOffCount,
      approvalCount,
      trainingCount,
      sentMessageCount,
      receivedMessageCount,
      scheduleSlotCount,
      incidentCount,
    ] = await Promise.all([
      prisma.attendanceRecord.count({ where: { driverId: userId, companyId } }),
      prisma.payrollRecord.count({ where: { driverId: userId, companyId } }),
      prisma.dayOffRequest.count({ where: { driverId: userId, companyId } }),
      prisma.approval.count({ where: { requesterId: userId, companyId } }),
      prisma.trainingRecord.count({ where: { driverId: userId, companyId } }),
      prisma.directMessage.count({ where: { senderId: userId, companyId } }),
      prisma.directMessage.count({ where: { receiverId: userId, companyId } }),
      prisma.scheduleSlot.count({ where: { driverId: userId } }),
      prisma.incidentRecord.count({ where: { driverId: userId, companyId } }),
    ]);

    const categories = [
      { category: '개인 프로필', count: 1, retentionYears: 0, description: '이름, 이메일, 전화번호, 면허번호 등' },
      { category: '출퇴근 기록', count: attendanceCount, retentionYears: 3, description: '근태 현황 및 출퇴근 시간' },
      { category: '급여 기록', count: payrollCount, retentionYears: 5, description: '월별 급여 내역 (법적 보관 의무)' },
      { category: '휴무 요청', count: dayOffCount, retentionYears: 3, description: '휴무 신청 및 승인/반려 내역' },
      { category: '결재 내역', count: approvalCount, retentionYears: 3, description: '전자결재 기안 및 처리 내역' },
      { category: '교육 기록', count: trainingCount, retentionYears: 5, description: '안전교육, 보수교육 등 이수 기록' },
      { category: '메시지', count: sentMessageCount + receivedMessageCount, retentionYears: 1, description: '1:1 메시지 발신/수신 건수' },
      { category: '배차 기록', count: scheduleSlotCount, retentionYears: 3, description: '배차표 근무 이력' },
      { category: '사고/위반 기록', count: incidentCount, retentionYears: 5, description: '사고, 교통법규 위반 기록' },
    ];

    return res.json({ success: true, data: categories });
  } catch (error) {
    logger.error(error);
    return res.status(500).json({ success: false, message: '데이터 카테고리 조회 중 오류가 발생했습니다.' });
  }
};

export const resetPassword = async (req: AuthRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const { newPassword } = req.body;

    const user = await prisma.user.findFirst({ where: { id, companyId: req.user!.companyId } });
    if (!user) {
      return res.status(404).json({ success: false, message: '사용자를 찾을 수 없습니다.' });
    }

    const hashedPassword = await bcrypt.hash(newPassword || user.employeeId, 10);

    // 비밀번호 변경 + 기존 세션(리프레시 토큰) 전부 삭제를 트랜잭션으로 처리
    await prisma.$transaction([
      prisma.user.update({
        where: { id },
        data: { password: hashedPassword },
      }),
      prisma.refreshToken.deleteMany({
        where: { userId: id },
      }),
    ]);

    // (\uC81C\uAC70\uB428) \uBE44\uBC00\uBC88\uD638 \uCD08\uAE30\uD654 \uD478\uC2DC \uC54C\uB9BC\uC740 \uBC1C\uC1A1\uD558\uC9C0 \uC54A\uC74C.

    return res.json({ success: true, message: '비밀번호가 초기화되었습니다.' });
  } catch (error) {
    logger.error(error);
    return res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
  }
};
