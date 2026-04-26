import { Response } from 'express';
import Anthropic from '@anthropic-ai/sdk';
import * as XLSX from 'xlsx';
import { prisma } from '../utils/prisma';
import { AuthRequest } from '../middleware/auth';
import { sendBulkPushNotifications } from '../services/notificationService';
import logger from '../utils/logger';
import { parseIdParam } from '../utils/helpers';
import { createAuditLog } from '../utils/auditLog';
import { getPagination, paginatedResponse } from '../utils/pagination';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SHIFT_HOURS: Record<string, number> = {
  FULL_DAY: 8,
  MORNING: 4,
  AFTERNOON: 4,
};

// ─────────────────────────────────────────────────────────────────
// 급여 설정 조회
// ─────────────────────────────────────────────────────────────────
export const getPayrollSetting = async (req: AuthRequest, res: Response) => {
  try {
    const setting = await prisma.payrollSetting.findUnique({
      where: { companyId: req.user!.companyId },
    });

    if (!setting) {
      return res.json({
        success: true,
        data: {
          companyId: req.user!.companyId,
          baseSalary: 3000000,
          overtimeRate: 1.5,
          nightShiftBonus: 50000,
          holidayRate: 2.0,
          nationalPensionRate: 4.5,
          healthInsuranceRate: 3.545,
          employmentInsRate: 0.9,
        },
      });
    }

    return res.json({ success: true, data: setting });
  } catch (error) {
    logger.error(error);
    return res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
  }
};

// ─────────────────────────────────────────────────────────────────
// 급여 설정 저장
// ─────────────────────────────────────────────────────────────────
export const upsertPayrollSetting = async (req: AuthRequest, res: Response) => {
  try {
    const { baseSalary, overtimeRate, nightShiftBonus, holidayRate,
      nationalPensionRate, healthInsuranceRate, employmentInsRate } = req.body;

    const setting = await prisma.payrollSetting.upsert({
      where: { companyId: req.user!.companyId },
      create: {
        companyId: req.user!.companyId,
        baseSalary: Number(baseSalary),
        overtimeRate: Number(overtimeRate),
        nightShiftBonus: Number(nightShiftBonus),
        holidayRate: Number(holidayRate),
        nationalPensionRate: Number(nationalPensionRate),
        healthInsuranceRate: Number(healthInsuranceRate),
        employmentInsRate: Number(employmentInsRate),
      },
      update: {
        baseSalary: Number(baseSalary),
        overtimeRate: Number(overtimeRate),
        nightShiftBonus: Number(nightShiftBonus),
        holidayRate: Number(holidayRate),
        nationalPensionRate: Number(nationalPensionRate),
        healthInsuranceRate: Number(healthInsuranceRate),
        employmentInsRate: Number(employmentInsRate),
      },
    });

    return res.json({ success: true, data: setting });
  } catch (error) {
    logger.error(error);
    return res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
  }
};

// ─────────────────────────────────────────────────────────────────
// 호봉 테이블 조회
// ─────────────────────────────────────────────────────────────────
export const getHoboongTable = async (req: AuthRequest, res: Response) => {
  try {
    const table = await prisma.hoboongTable.findMany({
      where: { companyId: req.user!.companyId },
      orderBy: { level: 'asc' },
    });
    return res.json({ success: true, data: table });
  } catch (error) {
    logger.error(error);
    return res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
  }
};

// ─────────────────────────────────────────────────────────────────
// 호봉 테이블 저장 (전체 교체)
// ─────────────────────────────────────────────────────────────────
export const saveHoboongTable = async (req: AuthRequest, res: Response) => {
  try {
    const companyId = req.user!.companyId;
    const { rows } = req.body as { rows: { level: number; baseSalary: number }[] };

    await prisma.$transaction([
      prisma.hoboongTable.deleteMany({ where: { companyId } }),
      prisma.hoboongTable.createMany({
        data: rows.map(r => ({ companyId, level: Number(r.level), baseSalary: Number(r.baseSalary) })),
      }),
    ]);

    const saved = await prisma.hoboongTable.findMany({
      where: { companyId },
      orderBy: { level: 'asc' },
    });

    return res.json({ success: true, data: saved, message: `호봉 테이블 ${rows.length}개 저장되었습니다.` });
  } catch (error) {
    logger.error(error);
    return res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
  }
};

// ─────────────────────────────────────────────────────────────────
// 조합비 목록 조회
// ─────────────────────────────────────────────────────────────────
export const getUnionDues = async (req: AuthRequest, res: Response) => {
  try {
    const dues = await prisma.unionDue.findMany({
      where: { companyId: req.user!.companyId },
      orderBy: { createdAt: 'asc' },
    });
    return res.json({ success: true, data: dues });
  } catch (error) {
    logger.error(error);
    return res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
  }
};

// ─────────────────────────────────────────────────────────────────
// 조합비 저장 (전체 교체)
// ─────────────────────────────────────────────────────────────────
export const saveUnionDues = async (req: AuthRequest, res: Response) => {
  try {
    const companyId = req.user!.companyId;
    const { dues } = req.body as {
      dues: { name: string; type: string; amount: number; isActive: boolean }[]
    };

    await prisma.$transaction([
      prisma.unionDue.deleteMany({ where: { companyId } }),
      prisma.unionDue.createMany({
        data: dues.map(d => ({
          companyId,
          name: d.name,
          type: d.type || 'FIXED',
          amount: Number(d.amount),
          isActive: d.isActive !== false,
        })),
      }),
    ]);

    const saved = await prisma.unionDue.findMany({
      where: { companyId },
      orderBy: { createdAt: 'asc' },
    });

    return res.json({ success: true, data: saved, message: `조합비 ${dues.length}개 저장되었습니다.` });
  } catch (error) {
    logger.error(error);
    return res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
  }
};

// ─────────────────────────────────────────────────────────────────
// 급여 엑셀 파일 → Claude AI 분석
// POST /api/v1/payroll/analyze-excel
// ─────────────────────────────────────────────────────────────────
export const analyzePayrollExcel = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: '파일을 업로드해 주세요.' });
    }

    // Excel → text
    const workbook = XLSX.read(Buffer.from(req.file.buffer), {
      type: 'buffer', cellDates: true, cellFormula: true,
    });

    let fullText = '';
    for (const sheetName of workbook.SheetNames.slice(0, 5)) {
      const ws = workbook.Sheets[sheetName];
      if (!ws['!ref']) continue;
      const csv = XLSX.utils.sheet_to_csv(ws, { FS: '|' });
      const lines = csv.split('\n').slice(0, 150).join('\n');
      fullText += `\n\n=== 시트: "${sheetName}" ===\n${lines}`;
    }

    logger.info(`[payroll] 엑셀 분석 요청: ${fullText.length}자`);

    const resp = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      system: `당신은 한국 버스회사 급여 담당 전문가입니다.
업로드된 급여 파일(엑셀)을 분석하여 급여 체계를 정확히 파악하세요.
순수 JSON만 출력하고 설명이나 마크다운은 포함하지 마세요.`,
      messages: [{
        role: 'user',
        content: `아래는 버스회사 급여 관련 엑셀 파일입니다. "|"는 셀 구분자입니다.

다음 정보를 정확하게 추출해주세요:

1. **호봉 테이블**: 호봉(급여 단계)별 기본급
   - level: 호봉 숫자 (1, 2, 3, ...)
   - baseSalary: 해당 호봉의 월 기본급 (원)

2. **조합비/공제 항목**: 매월 급여에서 공제되는 항목들
   - name: 항목명 (예: "노동조합비", "상조회비", "공제회비", "복지기금")
   - type: "FIXED"(고정금액) 또는 "PERCENTAGE"(급여의 %)
   - amount: 금액(원) 또는 비율(%)

3. **4대보험 요율** (있으면):
   - nationalPensionRate: 국민연금 (%)
   - healthInsuranceRate: 건강보험 (%)
   - employmentInsRate: 고용보험 (%)

4. **기사별 호봉 정보** (있으면):
   - name: 기사 이름
   - hoboong: 현재 호봉

5. **기타 수당 체계** (있으면):
   - overtimeRate: 연장근로 배율
   - nightShiftBonus: 야간수당 (원)

출력 형식:
{
  "hoboongTable": [
    {"level": 1, "baseSalary": 2800000},
    {"level": 2, "baseSalary": 2900000}
  ],
  "unionDues": [
    {"name": "노동조합비", "type": "FIXED", "amount": 30000},
    {"name": "상조회비", "type": "FIXED", "amount": 10000}
  ],
  "insuranceRates": {
    "nationalPensionRate": 4.5,
    "healthInsuranceRate": 3.545,
    "employmentInsRate": 0.9
  },
  "driverHoboong": [
    {"name": "홍길동", "hoboong": 5}
  ],
  "allowances": {
    "overtimeRate": 1.5,
    "nightShiftBonus": 50000
  },
  "summary": "분석된 급여 체계 요약 (한국어 2-3문장)"
}

엑셀 내용:
${fullText}`,
      }],
    });

    const raw = (resp.content[0] as { type: string; text: string }).text;
    logger.info(`[payroll] Claude 응답: ${raw.length}자`);

    // Parse JSON
    let parsed: Record<string, unknown> = {};
    try {
      const clean = raw.replace(/```json\s*/gi, '').replace(/```\s*/gi, '').trim();
      const match = clean.match(/\{[\s\S]*\}/);
      if (match) parsed = JSON.parse(match[0]);
    } catch {
      parsed = {};
    }

    return res.json({ success: true, data: parsed });
  } catch (error) {
    logger.error('[payroll] analyzePayrollExcel 오류', error);
    return res.status(500).json({ success: false, message: '분석 중 오류가 발생했습니다.' });
  }
};

// ─────────────────────────────────────────────────────────────────
// AI 분석 결과 확정 저장
// POST /api/v1/payroll/confirm-rules
// ─────────────────────────────────────────────────────────────────
export const confirmPayrollRules = async (req: AuthRequest, res: Response) => {
  try {
    const companyId = req.user!.companyId;
    const {
      hoboongTable,
      unionDues,
      insuranceRates,
      driverHoboong,
      allowances,
    } = req.body;

    const ops: Promise<unknown>[] = [];

    // 호봉 테이블 저장
    if (Array.isArray(hoboongTable) && hoboongTable.length > 0) {
      ops.push(
        prisma.hoboongTable.deleteMany({ where: { companyId } }).then(() =>
          prisma.hoboongTable.createMany({
            data: hoboongTable.map((r: { level: number; baseSalary: number }) => ({
              companyId,
              level: Number(r.level),
              baseSalary: Number(r.baseSalary),
            })),
          })
        )
      );
    }

    // 조합비 저장
    if (Array.isArray(unionDues) && unionDues.length > 0) {
      ops.push(
        prisma.unionDue.deleteMany({ where: { companyId } }).then(() =>
          prisma.unionDue.createMany({
            data: unionDues.map((d: { name: string; type: string; amount: number }) => ({
              companyId,
              name: d.name,
              type: d.type || 'FIXED',
              amount: Number(d.amount),
              isActive: true,
            })),
          })
        )
      );
    }

    // 4대보험 + 수당 설정 저장
    if (insuranceRates || allowances) {
      const upsertData: Record<string, number> = {};
      if (insuranceRates?.nationalPensionRate) upsertData.nationalPensionRate = Number(insuranceRates.nationalPensionRate);
      if (insuranceRates?.healthInsuranceRate) upsertData.healthInsuranceRate = Number(insuranceRates.healthInsuranceRate);
      if (insuranceRates?.employmentInsRate) upsertData.employmentInsRate = Number(insuranceRates.employmentInsRate);
      if (allowances?.overtimeRate) upsertData.overtimeRate = Number(allowances.overtimeRate);
      if (allowances?.nightShiftBonus) upsertData.nightShiftBonus = Number(allowances.nightShiftBonus);

      if (Object.keys(upsertData).length > 0) {
        ops.push(
          prisma.payrollSetting.upsert({
            where: { companyId },
            create: {
              companyId,
              baseSalary: 3000000,
              overtimeRate: upsertData.overtimeRate ?? 1.5,
              nightShiftBonus: upsertData.nightShiftBonus ?? 50000,
              holidayRate: 2.0,
              nationalPensionRate: upsertData.nationalPensionRate ?? 4.5,
              healthInsuranceRate: upsertData.healthInsuranceRate ?? 3.545,
              employmentInsRate: upsertData.employmentInsRate ?? 0.9,
            },
            update: upsertData,
          })
        );
      }
    }

    await Promise.all(ops);

    // 기사별 호봉 업데이트
    if (Array.isArray(driverHoboong) && driverHoboong.length > 0) {
      for (const dh of driverHoboong as { name: string; hoboong: number }[]) {
        if (!dh.name || !dh.hoboong) continue;
        await prisma.user.updateMany({
          where: { companyId, name: dh.name, role: 'DRIVER' },
          data: { hoboong: Number(dh.hoboong) },
        });
      }
    }

    return res.json({ success: true, message: '급여 규칙이 저장되었습니다. 다음 달부터 자동 적용됩니다.' });
  } catch (error) {
    logger.error('[payroll] confirmPayrollRules 오류', error);
    return res.status(500).json({ success: false, message: '저장 중 오류가 발생했습니다.' });
  }
};

// ─────────────────────────────────────────────────────────────────
// 월별 급여 자동 계산 (호봉 + 조합비 반영)
// ─────────────────────────────────────────────────────────────────
export const calculatePayroll = async (req: AuthRequest, res: Response) => {
  try {
    const { year, month } = req.body;
    const companyId = req.user!.companyId;

    const setting = await prisma.payrollSetting.findUnique({ where: { companyId } });
    const s = setting || {
      baseSalary: 3000000,
      overtimeRate: 1.5,
      nightShiftBonus: 50000,
      holidayRate: 2.0,
      nationalPensionRate: 4.5,
      healthInsuranceRate: 3.545,
      employmentInsRate: 0.9,
    };

    // 호봉 테이블 로드
    const hoboongRows = await prisma.hoboongTable.findMany({
      where: { companyId },
      orderBy: { level: 'asc' },
    });
    const hoboongMap = new Map(hoboongRows.map(r => [r.level, r.baseSalary]));

    // 활성 조합비
    const unionDueRows = await prisma.unionDue.findMany({
      where: { companyId, isActive: true },
    });

    const startDate = new Date(Number(year), Number(month) - 1, 1);
    const endDate = new Date(Number(year), Number(month), 0);

    const slots = await prisma.scheduleSlot.findMany({
      where: {
        schedule: { companyId },
        date: { gte: startDate, lte: endDate },
      },
      include: { driver: true },
    });

    // 기사별 집계
    const driverMap: Record<number, {
      driverId: number;
      workDays: number;
      totalHours: number;
      nightShifts: number;
      driver: typeof slots[0]['driver'];
    }> = {};

    for (const slot of slots) {
      if (slot.isRestDay) continue;
      const dId = slot.driverId;
      if (!driverMap[dId]) {
        driverMap[dId] = { driverId: dId, workDays: 0, totalHours: 0, nightShifts: 0, driver: slot.driver };
      }
      driverMap[dId].workDays += 1;
      driverMap[dId].totalHours += SHIFT_HOURS[slot.shift] || 8;
      if (slot.shift === 'AFTERNOON') driverMap[dId].nightShifts += 1;
    }

    const workingDaysInMonth = getWorkingDays(Number(year), Number(month));

    const upsertOps = Object.values(driverMap).map(data => {
      // 기사 호봉으로 기본급 결정
      const driverHoboong = data.driver.hoboong;
      const hoboongBaseSalary = driverHoboong ? hoboongMap.get(driverHoboong) : undefined;
      const effectiveBaseSalary = hoboongBaseSalary ?? s.baseSalary;

      // 근무일수 비례 기본급
      const dailyRate = effectiveBaseSalary / workingDaysInMonth;
      const earnedBase = Math.round(dailyRate * data.workDays);

      // 연장수당
      const standardMonthlyHours = workingDaysInMonth * 8;
      const overtimeHours = Math.max(0, data.totalHours - standardMonthlyHours);
      const hourlyRate = effectiveBaseSalary / (workingDaysInMonth * 8);
      const overtimePay = Math.round(overtimeHours * hourlyRate * s.overtimeRate);

      // 야간수당
      const nightShiftPay = data.nightShifts * s.nightShiftBonus;

      // 총 지급액
      const grossPay = earnedBase + overtimePay + nightShiftPay;

      // 4대보험 공제
      const insuranceDeduction = Math.round(
        grossPay * (s.nationalPensionRate + s.healthInsuranceRate + s.employmentInsRate) / 100
      );

      // 조합비 공제 계산
      let unionDuesTotal = 0;
      for (const due of unionDueRows) {
        if (due.type === 'PERCENTAGE') {
          unionDuesTotal += Math.round(grossPay * due.amount / 100);
        } else {
          unionDuesTotal += Math.round(due.amount);
        }
      }

      const totalDeductions = insuranceDeduction + unionDuesTotal;
      const netPay = grossPay - totalDeductions;

      if (netPay < 0) {
        throw new Error(
          `${data.driverId}번 기사: 공제액(${totalDeductions.toLocaleString()}원)이 총급여(${grossPay.toLocaleString()}원)를 초과합니다.`
        );
      }

      return prisma.payrollRecord.upsert({
        where: { companyId_driverId_year_month: { companyId, driverId: data.driverId, year: Number(year), month: Number(month) } },
        create: {
          companyId, driverId: data.driverId, year: Number(year), month: Number(month),
          hoboong: driverHoboong || null,
          baseSalary: earnedBase, workDays: data.workDays, overtimePay, nightShiftPay,
          holidayPay: 0, grossPay,
          deductions: insuranceDeduction,
          unionDues: unionDuesTotal,
          netPay, isConfirmed: false,
        },
        update: {
          hoboong: driverHoboong || null,
          baseSalary: earnedBase, workDays: data.workDays, overtimePay, nightShiftPay,
          grossPay,
          deductions: insuranceDeduction,
          unionDues: unionDuesTotal,
          netPay, isConfirmed: false,
        },
        include: { driver: { select: { id: true, name: true, employeeId: true, hoboong: true } } },
      });
    });

    const results = await prisma.$transaction(upsertOps);

    // Audit log for each calculated payroll record
    for (const record of results) {
      await createAuditLog({
        req: req as any,
        action: 'CREATE',
        entityType: 'PayrollRecord',
        entityId: record.id,
        changes: {
          year: { old: null, new: Number(year) },
          month: { old: null, new: Number(month) },
          grossPay: { old: null, new: record.grossPay },
          netPay: { old: null, new: record.netPay },
        },
      });
    }

    const negativeNetPayWarnings = results
      .filter(r => r.netPay < 0)
      .map(r => `${r.driver.name}: 실수령액 ${r.netPay.toLocaleString()}원 (공제액 초과)`);

    return res.json({
      success: true,
      data: results,
      message: `${results.length}명의 급여가 계산되었습니다.`,
      warnings: negativeNetPayWarnings.length > 0 ? negativeNetPayWarnings : undefined,
    });
  } catch (error: any) {
    logger.error(error);
    const message = error?.message?.includes('공제액')
      ? error.message
      : '서버 오류가 발생했습니다.';
    const status = error?.message?.includes('공제액') ? 400 : 500;
    return res.status(status).json({ success: false, message });
  }
};

// ─────────────────────────────────────────────────────────────────
// 급여 기록 조회
// ─────────────────────────────────────────────────────────────────
export const getPayrollRecords = async (req: AuthRequest, res: Response) => {
  try {
    const { year, month } = req.query;
    const companyId = req.user!.companyId;

    if (!year || !month || isNaN(Number(year)) || isNaN(Number(month))) {
      return res.status(400).json({ success: false, message: 'year, month 파라미터가 필요합니다.' });
    }

    const where = { companyId, year: Number(year), month: Number(month) };
    const pagination = getPagination(req);
    const [records, totalCount] = await Promise.all([
      prisma.payrollRecord.findMany({
        where,
        include: { driver: { select: { id: true, name: true, employeeId: true, driverType: true, hoboong: true } } },
        orderBy: { driver: { employeeId: 'asc' } },
        skip: pagination.skip,
        take: pagination.limit,
      }),
      prisma.payrollRecord.count({ where }),
    ]);

    const total = records.reduce((s, r) => ({
      grossPay: s.grossPay + r.grossPay,
      deductions: s.deductions + r.deductions,
      unionDues: s.unionDues + r.unionDues,
      netPay: s.netPay + r.netPay,
    }), { grossPay: 0, deductions: 0, unionDues: 0, netPay: 0 });

    return res.json({ success: true, ...paginatedResponse(records, totalCount, pagination), total });
  } catch (error) {
    logger.error(error);
    return res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
  }
};

// ─────────────────────────────────────────────────────────────────
// 급여 수동 편집 (관리자가 직접 항목 수정)
// ─────────────────────────────────────────────────────────────────
export const updatePayrollRecord = async (req: AuthRequest, res: Response) => {
  try {
    const id = parseIdParam(req.params.id, res, '급여 기록 ID');
    if (id === null) return;
    const companyId = req.user!.companyId;

    // 권한 확인: 본사 소속 레코드인지
    const existing = await prisma.payrollRecord.findFirst({ where: { id, companyId } });
    if (!existing) {
      return res.status(404).json({ success: false, message: '급여 기록을 찾을 수 없습니다.' });
    }

    const { baseSalary, overtimePay, nightShiftPay, holidayPay, deductions, unionDues, note, hoboong } = req.body;

    // 입력된 값만 업데이트 (undefined면 기존값 유지)
    const updateData: Record<string, unknown> = {};
    if (baseSalary !== undefined) updateData.baseSalary = Number(baseSalary);
    if (overtimePay !== undefined) updateData.overtimePay = Number(overtimePay);
    if (nightShiftPay !== undefined) updateData.nightShiftPay = Number(nightShiftPay);
    if (holidayPay !== undefined) updateData.holidayPay = Number(holidayPay);
    if (deductions !== undefined) updateData.deductions = Number(deductions);
    if (unionDues !== undefined) updateData.unionDues = Number(unionDues);
    if (note !== undefined) updateData.note = String(note);
    if (hoboong !== undefined) updateData.hoboong = hoboong ? Number(hoboong) : null;

    // grossPay / netPay 재계산
    const merged = { ...existing, ...updateData };
    const grossPay = (Number(merged.baseSalary) || 0) +
      (Number(merged.overtimePay) || 0) +
      (Number(merged.nightShiftPay) || 0) +
      (Number(merged.holidayPay) || 0);
    const netPay = grossPay -
      (Number(merged.deductions) || 0) -
      (Number(merged.unionDues) || 0);

    if (netPay < 0) {
      const totalDeductions = (Number(merged.deductions) || 0) + (Number(merged.unionDues) || 0);
      return res.status(400).json({
        success: false,
        message: `공제액(${totalDeductions.toLocaleString()}원)이 총급여(${grossPay.toLocaleString()}원)를 초과합니다. 공제액을 줄이거나 급여를 조정해주세요.`,
      });
    }

    updateData.grossPay = grossPay;
    updateData.netPay = netPay;

    // Build changes diff for audit
    const auditChanges: Record<string, { old: unknown; new: unknown }> = {};
    for (const key of Object.keys(updateData)) {
      if (key === 'grossPay' || key === 'netPay') continue; // computed fields
      auditChanges[key] = {
        old: (existing as Record<string, unknown>)[key],
        new: updateData[key],
      };
    }
    auditChanges.grossPay = { old: existing.grossPay, new: grossPay };
    auditChanges.netPay = { old: existing.netPay, new: netPay };

    const updated = await prisma.payrollRecord.update({
      where: { id },
      data: updateData,
      include: { driver: { select: { id: true, name: true, employeeId: true, driverType: true, hoboong: true } } },
    });

    await createAuditLog({
      req: req as any,
      action: 'UPDATE',
      entityType: 'PayrollRecord',
      entityId: id,
      changes: auditChanges,
    });

    return res.json({ success: true, data: updated });
  } catch (error) {
    logger.error(error);
    return res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
  }
};

// ─────────────────────────────────────────────────────────────────
// 급여 확정
// ─────────────────────────────────────────────────────────────────
export const confirmPayroll = async (req: AuthRequest, res: Response) => {
  try {
    const { year, month } = req.body;
    const companyId = req.user!.companyId;

    // Fetch records before confirming to get IDs for audit
    const preConfirmRecords = await prisma.payrollRecord.findMany({
      where: { companyId, year: Number(year), month: Number(month), isConfirmed: false },
      select: { id: true, netPay: true },
    });

    const records = await prisma.payrollRecord.updateMany({
      where: { companyId, year: Number(year), month: Number(month), isConfirmed: false },
      data: { isConfirmed: true, confirmedAt: new Date() },
    });

    // Audit log for each confirmed payroll record
    for (const record of preConfirmRecords) {
      await createAuditLog({
        req: req as any,
        action: 'UPDATE',
        entityType: 'PayrollRecord',
        entityId: record.id,
        changes: {
          isConfirmed: { old: false, new: true },
          confirmedAt: { old: null, new: new Date().toISOString() },
        },
      });
    }

    const payrolls = await prisma.payrollRecord.findMany({
      where: { companyId, year: Number(year), month: Number(month) },
      select: { driverId: true, netPay: true },
    });

    await sendBulkPushNotifications(
      payrolls.map(p => p.driverId),
      '💰 급여명세서',
      `${month}월 급여가 확정되었습니다. 앱에서 확인하세요.`,
      'PAYROLL_CONFIRMED',
      { year, month }
    );

    return res.json({
      success: true,
      message: `${records.count}명의 급여가 확정되었습니다.`,
    });
  } catch (error) {
    logger.error(error);
    return res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
  }
};

function getWorkingDays(year: number, month: number): number {
  const days = new Date(year, month, 0).getDate();
  let count = 0;
  for (let d = 1; d <= days; d++) {
    const day = new Date(year, month - 1, d).getDay();
    if (day !== 0 && day !== 6) count++;
  }
  return count;
}
