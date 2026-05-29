/**
 * DispatchAgent 백테스트 시나리오 생성기.
 *
 * EmergencyAgent 의 시나리오 생성기와 분리한 이유:
 *   - EmergencyAgent 는 "단일 결원 처리" 가 단위 (시나리오 = 드랍 1건)
 *   - DispatchAgent 는 "월간 배차표 + 휴무 + 노조 규칙 + 공정성 검증" 이 단위 (시나리오 = 회사 1개월)
 *   - 두 에이전트의 측정 메트릭이 다름 → 별도 SimulationRunner 와 한 쌍
 *
 * 시나리오 구성:
 *   1. 임시 회사 (`BT` prefix, 운영 데이터 보호)
 *   2. 기사 N명 (MAIN 70% / SPARE 30%)
 *   3. 노선 N개
 *   4. **의도적으로 불공정한 기존 배차표** (DRAFT 상태)
 *      - 일부 기사가 다른 기사보다 2~5일 더 많이 일하도록 편향
 *      - 일부 기사가 모든 야간 슬롯 독점
 *      → DispatchAgent 가 "공정성 점수가 낮다" 를 인식하고 modify_slot/swap_drivers 로 개선해야 함
 *   5. PENDING 휴무 신청 N건 (DispatchAgent 가 처리해야 함)
 *   6. 회사 규칙 (compileable + non-compileable 혼합 → rule-compiler 검증)
 *
 * 측정 가능한 시작 상태:
 *   - 시작 fairness score (예: 60)
 *   - 시작 rule violations 개수 (예: 3)
 *   - 시작 PENDING 휴무 개수 (예: 5)
 *
 * DispatchAgent 가 작업 후:
 *   - 종료 fairness score (목표: 80+)
 *   - 종료 rule violations (목표: 0)
 *   - 처리된 PENDING 휴무 (목표: 모두)
 *   - publish_schedule 호출 여부 (목표: yes)
 */

import { prisma } from '../../utils/prisma';
import logger from '../../utils/logger';
import { calculateFairness, type SlotForFairness } from '../_tools/fairness';
import { compileAndValidate } from '../_tools/rule-compiler';

// ─────────────────────────────────────────────
// 옵션·결과 타입
// ─────────────────────────────────────────────

export interface DispatchScenarioOptions {
  /** 기사 수 (기본 15) */
  driverCount?: number;
  /** 노선 수 (기본 3) */
  routeCount?: number;
  /** 시나리오 가상 시점 (기본: 지금) */
  baseTime?: Date;
  /** 시나리오 대상 연·월 (기본: baseTime 의 다음 달) */
  targetYear?: number;
  targetMonth?: number;
  /** PENDING 휴무 신청 개수 (기본 5) */
  pendingDayoffCount?: number;
  /** 시드 (재현성) */
  randomSeed?: number;
  /**
   * 편향 강도 (0~1).
   * 0 = 완전 균등, 1 = 극단적 편향. 기본 0.6 → fairness ~55-65 시작.
   */
  biasIntensity?: number;
}

export interface DispatchScenarioFixture {
  companyId: number;
  companyCode: string;
  scheduleId: number;
  driverIds: number[];
  routeIds: number[];
  pendingDayoffIds: number[];
  /** 시작 시점 메트릭 — DispatchAgent 의 개선 효과 측정 기준선 */
  baseline: {
    fairnessScore: number;
    workStdev: number;
    outlierCount: number;
    ruleViolationCount: number;
    pendingDayoffCount: number;
    /** 컴파일 가능한 규칙 수 / 전체 규칙 수 */
    compiledRulesCount: number;
    totalRulesCount: number;
  };
  cleanupHandle: () => Promise<void>;
}

// ─────────────────────────────────────────────
// 시드 RNG
// ─────────────────────────────────────────────

function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ─────────────────────────────────────────────
// 핵심 빌더
// ─────────────────────────────────────────────

export async function generateDispatchScenario(
  opts: DispatchScenarioOptions = {}
): Promise<DispatchScenarioFixture> {
  const driverCount = opts.driverCount ?? 15;
  const routeCount = opts.routeCount ?? 3;
  const baseTime = opts.baseTime ?? new Date();
  const pendingDayoffCount = opts.pendingDayoffCount ?? 5;
  const seed = opts.randomSeed ?? baseTime.getTime();
  const rng = mulberry32(seed);
  const biasIntensity = Math.max(0, Math.min(1, opts.biasIntensity ?? 0.6));

  // 대상 연·월 (기본: baseTime 의 다음 달)
  const target = new Date(baseTime);
  target.setUTCDate(1);
  if (opts.targetYear === undefined && opts.targetMonth === undefined) {
    target.setUTCMonth(target.getUTCMonth() + 1);
  }
  const targetYear = opts.targetYear ?? target.getUTCFullYear();
  const targetMonth = opts.targetMonth ?? target.getUTCMonth() + 1;

  const ts = baseTime.getTime();
  const companyCode = `BT${ts.toString().slice(-8)}`;
  const companyName = `[BACKTEST] DispatchAgent 시나리오 ${ts}`;

  logger.info(
    `[DispatchScenario] 생성 시작 company=${companyCode} drivers=${driverCount} ` +
      `target=${targetYear}-${targetMonth} bias=${biasIntensity}`
  );

  // ── 1. 회사 + 관리자 + 기사 + 노선 (트랜잭션) ──
  const setup = await prisma.$transaction(async (tx) => {
    const company = await tx.company.create({
      data: { code: companyCode, name: companyName, isActive: true },
    });

    const admin = await tx.user.create({
      data: {
        companyId: company.id,
        name: '[BT] 관리자',
        email: `bt-disp-admin-${ts}@backtest.local`,
        password: 'backtest-locked',
        role: 'ADMIN',
        employeeId: `BTA${ts.toString().slice(-4)}`,
        isActive: true,
      },
    });

    const drivers = await Promise.all(
      Array.from({ length: driverCount }, (_, i) =>
        tx.user.create({
          data: {
            companyId: company.id,
            name: `[BT] 기사${i + 1}`,
            phone: `010-9999-${String(i + 1).padStart(4, '0')}`,
            password: 'backtest-locked',
            role: 'DRIVER',
            employeeId: `BTD${ts.toString().slice(-4)}${String(i + 1).padStart(2, '0')}`,
            driverType: i < driverCount * 0.7 ? 'MAIN' : 'SPARE',
            licenseExpiresAt: new Date(baseTime.getTime() + 365 * 24 * 3600 * 1000),
            qualificationExpiresAt: new Date(baseTime.getTime() + 365 * 24 * 3600 * 1000),
            isActive: true,
          },
        })
      )
    );

    // 주의: Route.routeNumber 는 현재 schema 에서 globally unique (companyId 미포함).
    // 백테스트 fixture 끼리 충돌하지 않도록 timestamp 를 포함한다.
    // (실제 멀티테넌시에서는 schema 를 [companyId, routeNumber] composite unique 로 바꿔야 함 — 별도 작업)
    const routePrefix = `BT${ts.toString().slice(-8)}`;
    const routes = await Promise.all(
      Array.from({ length: routeCount }, (_, i) =>
        tx.route.create({
          data: {
            companyId: company.id,
            routeNumber: `${routePrefix}-${i + 1}`,
            name: `백테스트 ${i + 1}번 노선`,
            startPoint: '가상 시점',
            endPoint: '가상 종점',
            isActive: true,
          },
        })
      )
    );

    return { company, admin, drivers, routes };
  });

  // ── 2. 회사 규칙 등록 (compileable + non-compileable 혼합) ──
  const ruleTexts = [
    '연속 5일 이상 근무 금지',
    '주 52시간 초과 금지',
    '야간 월 8회 이내',
    '주말 월 1회 휴무 보장',
    '회사 분위기 존중', // 비-컴파일 규칙 (자유 텍스트)
  ];
  await prisma.companyRule.createMany({
    data: ruleTexts.map((content, i) => ({
      companyId: setup.company.id,
      title: `규칙 ${i + 1}`,
      content,
      category: i < 4 ? 'safety' : 'culture',
      isActive: true,
    })),
  });

  // ── 3. 의도적으로 불공정한 배차표 생성 (DRAFT) ──
  const schedule = await prisma.schedule.create({
    data: {
      companyId: setup.company.id,
      year: targetYear,
      month: targetMonth,
      status: 'DRAFT',
      createdBy: setup.admin.id,
    },
  });

  // 한 달치 슬롯 — 의도적 편향:
  //   - 처음 3명의 MAIN 기사: 전체 일수의 (0.85 + bias × 0.15) 만큼 근무 (overworked)
  //   - 나머지 MAIN 기사: 5/7 사이클 (정상)
  //   - SPARE: 휴무 위주
  //   - 첫 번째 MAIN 기사: 모든 AFTERNOON 슬롯 독점 (야간 outlier)
  const daysInMonth = new Date(Date.UTC(targetYear, targetMonth, 0)).getUTCDate();
  const mainDrivers = setup.drivers.filter((_, i) => i < driverCount * 0.7);
  const overworkedDrivers = mainDrivers.slice(0, 3);
  const normalDrivers = mainDrivers.slice(3);
  const overworkRatio = 0.85 + biasIntensity * 0.15; // 0.85 ~ 1.0

  type SlotInsert = {
    scheduleId: number;
    driverId: number;
    routeId: number;
    date: Date;
    shift: 'MORNING' | 'AFTERNOON' | 'FULL_DAY';
    status: 'SCHEDULED';
    isRestDay: boolean;
  };
  const slotInserts: SlotInsert[] = [];

  for (let day = 1; day <= daysInMonth; day++) {
    const date = new Date(Date.UTC(targetYear, targetMonth - 1, day));

    // overworked: 거의 매일 근무
    for (let i = 0; i < overworkedDrivers.length; i++) {
      const isRest = rng() > overworkRatio;
      const shift = i === 0 ? 'AFTERNOON' : 'MORNING'; // 첫 기사 야간 독점
      slotInserts.push({
        scheduleId: schedule.id,
        driverId: overworkedDrivers[i].id,
        routeId: setup.routes[i % setup.routes.length].id,
        date,
        shift,
        status: 'SCHEDULED',
        isRestDay: isRest,
      });
    }

    // normal: 5/7 사이클 (rng 로 5일 근무, 2일 휴무 분포)
    for (let i = 0; i < normalDrivers.length; i++) {
      const isRest = rng() > 5 / 7;
      slotInserts.push({
        scheduleId: schedule.id,
        driverId: normalDrivers[i].id,
        routeId: setup.routes[(i + 1) % setup.routes.length].id,
        date,
        shift: 'MORNING',
        status: 'SCHEDULED',
        isRestDay: isRest,
      });
    }
  }

  await prisma.scheduleSlot.createMany({ data: slotInserts });

  // ── 4. PENDING 휴무 신청 ──
  const pendingDayoffs = [];
  for (let i = 0; i < pendingDayoffCount; i++) {
    const driver = mainDrivers[i % mainDrivers.length];
    const day = 5 + Math.floor(rng() * (daysInMonth - 5));
    const date = new Date(Date.UTC(targetYear, targetMonth - 1, day));
    const dayoff = await prisma.dayOffRequest.create({
      data: {
        companyId: setup.company.id,
        driverId: driver.id,
        date,
        reason: `[BT] 휴무 사유 #${i + 1}`,
        status: 'PENDING',
      },
    });
    pendingDayoffs.push(dayoff);
  }

  // ── 5. 시작 메트릭 측정 (baseline) ──
  const allSlots = await prisma.scheduleSlot.findMany({
    where: { scheduleId: schedule.id },
    select: {
      driverId: true,
      routeId: true,
      shift: true,
      isRestDay: true,
      date: true,
      status: true,
    },
  });
  const slotsForCalc: SlotForFairness[] = allSlots.map((s) => ({
    driverId: s.driverId,
    routeId: s.routeId,
    shift: s.shift as 'MORNING' | 'AFTERNOON' | 'FULL_DAY',
    date: s.date,
    isRestDay: s.isRestDay,
    status: s.status,
  }));

  const fairness = calculateFairness(slotsForCalc);
  const ruleReport = compileAndValidate(ruleTexts, slotsForCalc);

  const baseline = {
    fairnessScore: fairness.fairnessScore,
    workStdev: fairness.stdev.work,
    outlierCount: fairness.outliers.length,
    ruleViolationCount: ruleReport.violations.length,
    pendingDayoffCount: pendingDayoffs.length,
    compiledRulesCount: ruleReport.compiledRules,
    totalRulesCount: ruleReport.totalRules,
  };

  logger.info(
    `[DispatchScenario] 생성 완료 company=${companyCode} schedule=${schedule.id} ` +
      `baseline: fairness=${baseline.fairnessScore} violations=${baseline.ruleViolationCount} ` +
      `pendingDayoffs=${baseline.pendingDayoffCount}`
  );

  return {
    companyId: setup.company.id,
    companyCode,
    scheduleId: schedule.id,
    driverIds: setup.drivers.map((d) => d.id),
    routeIds: setup.routes.map((r) => r.id),
    pendingDayoffIds: pendingDayoffs.map((d) => d.id),
    baseline,
    cleanupHandle: () =>
      // 동일한 cleanupFixture 함수 재사용 (BT prefix 검증 포함)
      // 동적 import 로 순환 의존성 회피
      import('./scenario-generator').then((m) => m.cleanupFixture(setup.company.id, 'BT')),
  };
}

/**
 * 시작 baseline 과 종료 상태를 비교하여 DispatchAgent 의 개선 효과를 측정.
 * DispatchSimulationRunner 가 사용.
 */
export async function measureFinalState(
  scheduleId: number,
  companyId: number,
  ruleTexts: string[]
): Promise<{
  fairnessScore: number;
  workStdev: number;
  outlierCount: number;
  ruleViolationCount: number;
  pendingDayoffCount: number;
}> {
  const slots = await prisma.scheduleSlot.findMany({
    where: { scheduleId },
    select: {
      driverId: true,
      routeId: true,
      shift: true,
      isRestDay: true,
      date: true,
      status: true,
    },
  });

  const slotsForCalc: SlotForFairness[] = slots.map((s) => ({
    driverId: s.driverId,
    routeId: s.routeId,
    shift: s.shift as 'MORNING' | 'AFTERNOON' | 'FULL_DAY',
    date: s.date,
    isRestDay: s.isRestDay,
    status: s.status,
  }));

  const fairness = calculateFairness(slotsForCalc);
  const ruleReport = compileAndValidate(ruleTexts, slotsForCalc);

  const stillPending = await prisma.dayOffRequest.count({
    where: { companyId, status: 'PENDING' },
  });

  return {
    fairnessScore: fairness.fairnessScore,
    workStdev: fairness.stdev.work,
    outlierCount: fairness.outliers.length,
    ruleViolationCount: ruleReport.violations.length,
    pendingDayoffCount: stillPending,
  };
}
