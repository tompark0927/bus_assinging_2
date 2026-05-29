/**
 * 합성 시나리오 생성기 — 백테스트용 임시 DB 픽스처를 생성한다.
 *
 * 왜 필요한가:
 *   PHASE 1 출시 기준은 "시뮬레이션 30분 내 수락률 ≥ 70%". 이를 측정하려면 현실적인
 *   드랍 시나리오가 필요하다. 실 운영 데이터가 충분히 쌓일 때까지는 합성 데이터로 검증한다.
 *
 * 작동 방식:
 *   1) `generateScenarioFixture(opts)` — 임시 회사 + 기사 N명 + 노선 + 슬롯 + 드랍 N건 생성
 *      - 모든 행에 `[BACKTEST]` 마크 (정리 시 식별)
 *      - 회사 코드는 `BT{timestamp}` 형식 — 운영 데이터와 충돌 없음
 *   2) `cleanupFixture(companyId)` — 외래키 순서에 맞춰 모든 데이터 삭제
 *   3) 드랍은 다양한 긴급도(CRITICAL/HIGH/NORMAL) 분포로 생성되어 에이전트의 분기 로직 검증
 *
 * 안전 장치:
 *   - 회사 코드 prefix `BT` + 회사명 prefix `[BACKTEST]` 로 운영 회사와 명확히 구분
 *   - 정리 함수는 BT prefix 회사만 삭제 (다른 회사 보호)
 *   - 트랜잭션으로 일관성 보장
 */

import type { Prisma } from '@prisma/client';
import { prisma } from '../../utils/prisma';
import logger from '../../utils/logger';
import type { DropScenario, HistoricalOutcome } from './simulation';

// ─────────────────────────────────────────────
// 옵션 + 결과 타입
// ─────────────────────────────────────────────

export interface GenerateOptions {
  /** 생성할 기사 수 (기본 20) */
  driverCount?: number;
  /** 생성할 노선 수 (기본 5) */
  routeCount?: number;
  /** 생성할 드랍 수 (= 시나리오 수, 기본 30) */
  dropCount?: number;
  /** 가상 "현재 시각" — 모든 드랍의 virtualNow 가 이 시각으로 정렬됨 (기본: 지금) */
  baseTime?: Date;
  /** 긴급도 분포 (합 = 1.0). 기본: critical 0.2 / high 0.3 / normal 0.5 */
  urgencyMix?: { critical: number; high: number; normal: number };
  /** 시나리오에 actualOutcome 을 함께 생성 (백테스트 비교용, 기본 true) */
  generateActualOutcomes?: boolean;
  /**
   * 합성 actualOutcome 의 시드 (재현 가능한 백테스트를 위해).
   * 기본: baseTime.getTime() 사용 — 같은 baseTime 이면 같은 결과.
   */
  randomSeed?: number;
}

/**
 * 결정론적 RNG (Mulberry32) — 같은 시드로 항상 같은 시퀀스 반환.
 * 백테스트 재현성에 필수.
 */
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

export interface GeneratedFixture {
  companyId: number;
  companyCode: string;
  scenarios: DropScenario[];
  driverIds: number[];
  routeIds: number[];
  scheduleId: number;
  cleanupHandle: () => Promise<void>;
}

// ─────────────────────────────────────────────
// 헬퍼: 가짜 면허/자격증 만료일 (충분히 미래)
// ─────────────────────────────────────────────

function farFutureDate(baseTime: Date, daysFromNow = 365): Date {
  return new Date(baseTime.getTime() + daysFromNow * 24 * 3600 * 1000);
}

/**
 * 출발 시각으로부터 minutesBefore 분 전에 발생한 가상 드랍의 virtualNow 계산.
 *
 * EmergencyDrop 의 출발 시각은 `slot.date` (자정 UTC) + shift hour (KST 기준).
 * MORNING shift = KST 06:00 = UTC 21:00 (전날).
 * 우리는 시나리오의 virtualNow 를 "지금부터 X분 후 출발" 형태로 계산해야 함.
 */
function virtualNowForUrgency(slotDate: Date, shift: 'MORNING' | 'AFTERNOON' | 'FULL_DAY', minutesBefore: number): Date {
  const hourKst = shift === 'AFTERNOON' ? 14 : 6;
  const departure = new Date(slotDate.toISOString().slice(0, 10) + 'T00:00:00Z');
  departure.setUTCHours(hourKst - 9, 0, 0, 0);
  return new Date(departure.getTime() - minutesBefore * 60 * 1000);
}

// ─────────────────────────────────────────────
// 메인: 픽스처 생성
// ─────────────────────────────────────────────

export async function generateScenarioFixture(opts: GenerateOptions = {}): Promise<GeneratedFixture> {
  const driverCount = opts.driverCount ?? 20;
  const routeCount = opts.routeCount ?? 5;
  const dropCount = opts.dropCount ?? 30;
  const baseTime = opts.baseTime ?? new Date();
  const urgencyMix = opts.urgencyMix ?? { critical: 0.2, high: 0.3, normal: 0.5 };
  const generateActuals = opts.generateActualOutcomes ?? true;
  const seed = opts.randomSeed ?? baseTime.getTime();
  const rng = mulberry32(seed);

  // 분포 합 정규화 (오차 허용)
  const sum = urgencyMix.critical + urgencyMix.high + urgencyMix.normal;
  if (Math.abs(sum - 1.0) > 0.01) {
    throw new Error(`urgencyMix 합 ${sum.toFixed(2)} ≠ 1.0`);
  }

  // 회사 식별자 — 충돌 방지 + 정리 시 식별
  const ts = baseTime.getTime();
  const companyCode = `BT${ts.toString().slice(-8)}`;
  const companyName = `[BACKTEST] 합성 회사 ${ts}`;

  logger.info(`[ScenarioGen] 픽스처 생성 시작 company=${companyCode} drivers=${driverCount} drops=${dropCount}`);

  // ─── 1단계: 회사 + 기사 + 노선 (트랜잭션) ───
  const setup = await prisma.$transaction(async (tx) => {
    const company = await tx.company.create({
      data: { code: companyCode, name: companyName, isActive: true },
    });

    // 관리자 1명 (draft_monthly_schedule 등에 필요)
    await tx.user.create({
      data: {
        companyId: company.id,
        name: '[BT] 관리자',
        email: `bt-admin-${ts}@backtest.local`,
        password: 'backtest-locked', // 로그인 불가 (해시 아님)
        role: 'ADMIN',
        employeeId: `BTA${ts.toString().slice(-4)}`,
        isActive: true,
      },
    });

    // 기사 N명
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
            licenseExpiresAt: farFutureDate(baseTime, 365),
            qualificationExpiresAt: farFutureDate(baseTime, 365),
            isActive: true,
          },
        })
      )
    );

    // 노선 N개 — Route.routeNumber 는 현재 schema 에서 globally unique 라 timestamp 포함
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

    return { company, drivers, routes };
  });

  // ─── 2단계: 배차표 + 슬롯 + 드랍 ───
  // 드랍 분포: critical/high/normal 비율대로 생성
  const criticalCount = Math.floor(dropCount * urgencyMix.critical);
  const highCount = Math.floor(dropCount * urgencyMix.high);
  const normalCount = dropCount - criticalCount - highCount;

  const urgencySpec: Array<{ urgency: 'critical' | 'high' | 'normal'; minutesBefore: number }> = [
    ...Array.from({ length: criticalCount }, (_, i) => ({
      urgency: 'critical' as const,
      minutesBefore: 5 + (i % 25), // 5~29분
    })),
    ...Array.from({ length: highCount }, (_, i) => ({
      urgency: 'high' as const,
      minutesBefore: 35 + (i % 80), // 35~114분
    })),
    ...Array.from({ length: normalCount }, (_, i) => ({
      urgency: 'normal' as const,
      minutesBefore: 180 + (i % 1440), // 3시간 ~ 24시간+
    })),
  ];

  // 배차표는 baseTime 의 월 기준 1개 생성
  const year = baseTime.getUTCFullYear();
  const month = baseTime.getUTCMonth() + 1;

  const schedule = await prisma.schedule.create({
    data: {
      companyId: setup.company.id,
      year,
      month,
      status: 'PUBLISHED', // 발행된 배차표 상태에서 결원 발생
      createdBy: setup.drivers[0].id, // 임의
    },
  });

  // 드랍별로: 슬롯 생성 → 드랍 생성
  const scenarios: DropScenario[] = [];
  const dropIds: number[] = [];

  for (let i = 0; i < dropCount; i++) {
    const spec = urgencySpec[i];
    const route = setup.routes[i % setup.routes.length];
    const droppedDriver = setup.drivers[i % setup.drivers.length];
    const shift: 'MORNING' | 'AFTERNOON' = i % 2 === 0 ? 'MORNING' : 'AFTERNOON';

    // 드랍 발생 날짜는 baseTime 의 같은 날 또는 며칠 후 (긴급도가 NORMAL 이면 며칠 후)
    const slotDate = new Date(baseTime);
    if (spec.urgency === 'normal') {
      // NORMAL 은 1~2일 후 출발
      slotDate.setUTCDate(slotDate.getUTCDate() + 1 + (i % 2));
    }
    // CRITICAL/HIGH 는 같은 날
    slotDate.setUTCHours(0, 0, 0, 0);

    // 슬롯 생성
    const slot = await prisma.scheduleSlot.create({
      data: {
        scheduleId: schedule.id,
        driverId: droppedDriver.id,
        routeId: route.id,
        date: slotDate,
        shift,
        status: 'DROPPED',
        isRestDay: false,
      },
    });

    // 드랍 생성
    const drop = await prisma.emergencyDrop.create({
      data: {
        slotId: slot.id,
        driverId: droppedDriver.id,
        reason: `[BT] ${spec.urgency} 시나리오 #${i + 1}`,
        status: 'OPEN',
        escalationLevel: 0,
      },
    });
    dropIds.push(drop.id);

    const virtualNow = virtualNowForUrgency(slotDate, shift, spec.minutesBefore);

    // 합성 actualOutcome (백테스트 비교용) — 시드 RNG 로 결정론적 분포
    let actualOutcome: HistoricalOutcome | undefined;
    if (generateActuals) {
      // 합성 가정: critical 50%, high 70%, normal 85% 성공
      const successRate =
        spec.urgency === 'critical' ? 0.5 : spec.urgency === 'high' ? 0.7 : 0.85;
      const accepted = rng() < successRate;
      actualOutcome = {
        accepted,
        acceptedByDriverId: accepted
          ? setup.drivers[Math.floor(rng() * setup.drivers.length)].id
          : undefined,
        minutesUntilAcceptance: accepted
          ? Math.max(1, Math.floor(spec.minutesBefore * (0.3 + rng() * 0.6)))
          : undefined,
      };
    }

    scenarios.push({
      id: `bt-${spec.urgency}-${i + 1}`,
      companyId: setup.company.id,
      virtualNow,
      dropId: drop.id,
      actualOutcome,
      metadata: { urgency: spec.urgency, generatedAt: baseTime.toISOString() },
    });
  }

  logger.info(
    `[ScenarioGen] 픽스처 생성 완료 company=${companyCode} ` +
      `scenarios=${scenarios.length} (critical=${criticalCount} high=${highCount} normal=${normalCount})`
  );

  return {
    companyId: setup.company.id,
    companyCode,
    scenarios,
    driverIds: setup.drivers.map((d) => d.id),
    routeIds: setup.routes.map((r) => r.id),
    scheduleId: schedule.id,
    cleanupHandle: () => cleanupFixture(setup.company.id, companyCode),
  };
}

// ─────────────────────────────────────────────
// 정리: 외래키 순서 + 안전 검증
// ─────────────────────────────────────────────

/**
 * 백테스트 픽스처 회사의 모든 데이터를 삭제.
 *
 * 안전 장치: companyCode 가 'BT' prefix 인지 확인 (운영 회사 보호).
 * 외래키 순서대로 cascade 가 안 되는 모델은 명시 삭제.
 */
export async function cleanupFixture(companyId: number, expectedCodePrefix = 'BT'): Promise<void> {
  // 안전 검증: 회사 코드 prefix 확인
  const company = await prisma.company.findUnique({ where: { id: companyId } });
  if (!company) {
    logger.warn(`[ScenarioGen] cleanupFixture: company=${companyId} 없음 (이미 삭제됨?)`);
    return;
  }
  if (!company.code.startsWith(expectedCodePrefix)) {
    throw new Error(
      `[ScenarioGen] cleanupFixture: 회사 코드 '${company.code}' 가 '${expectedCodePrefix}' prefix 가 아님 — 운영 데이터 보호 거부`
    );
  }

  // 외래키 순서: 자식 → 부모
  // 백테스트가 생성·수정할 수 있는 모든 테이블을 명시 삭제 (Prisma 는 cascade 자동 안 함).
  await prisma.$transaction(async (tx) => {
    // 1. 슬롯 의존 자료 → 슬롯 → 배차표
    const slots = await tx.scheduleSlot.findMany({
      where: { schedule: { companyId } },
      select: { id: true },
    });
    const slotIds = slots.map((s) => s.id);
    if (slotIds.length > 0) {
      await tx.emergencyDrop.deleteMany({ where: { slotId: { in: slotIds } } });
      await tx.scheduleSlot.deleteMany({ where: { id: { in: slotIds } } });
    }
    await tx.schedule.deleteMany({ where: { companyId } });

    // 2. companyId 직접 보유 모델
    await tx.agentDecision.deleteMany({ where: { companyId } });
    await tx.dayOffRequest.deleteMany({ where: { companyId } });
    await tx.companyRule.deleteMany({ where: { companyId } });
    await tx.attendanceRecord.deleteMany({ where: { companyId } });
    await tx.driverTag.deleteMany({ where: { companyId } });
    await tx.auditLog.deleteMany({ where: { companyId } });
    await tx.dailyReport.deleteMany({ where: { companyId } });

    // 3. 사용자 의존 자료
    const userIds = (
      await tx.user.findMany({ where: { companyId }, select: { id: true } })
    ).map((u) => u.id);
    if (userIds.length > 0) {
      await tx.notification.deleteMany({ where: { userId: { in: userIds } } });
      await tx.refreshToken.deleteMany({ where: { userId: { in: userIds } } });
      await tx.driverPreference.deleteMany({ where: { driverId: { in: userIds } } });
      await tx.routeAssignment.deleteMany({ where: { driverId: { in: userIds } } });
    }

    // 4. 노선 → 사용자 → 회사
    await tx.route.deleteMany({ where: { companyId } });
    await tx.user.deleteMany({ where: { companyId } });
    await tx.company.delete({ where: { id: companyId } });
  });

  logger.info(`[ScenarioGen] 픽스처 정리 완료 company=${company.code}`);
}

/**
 * 모든 백테스트 회사를 일괄 정리 (운영 사고 복구용).
 * 'BT' prefix 회사만 대상.
 */
export async function cleanupAllBacktestFixtures(): Promise<{ deletedCompanies: number }> {
  const companies = await prisma.company.findMany({
    where: { code: { startsWith: 'BT' } },
    select: { id: true, code: true },
  });

  for (const c of companies) {
    try {
      await cleanupFixture(c.id, 'BT');
    } catch (err) {
      logger.error(`[ScenarioGen] cleanup ${c.code} 실패`, err);
    }
  }

  return { deletedCompanies: companies.length };
}
