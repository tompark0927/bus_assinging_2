/**
 * 주휴일(근로기준법 제55조) 대타 자격 검사.
 *
 * AI 배차 생성이 이미 강제하는 `weeklyMaxWorkDays` 헌법 규칙(주 일~토, 기본 최대 6근무일 =
 * 주 1휴일 보장)을 대타(EmergencyDrop) 수락·배정 경로에도 동일하게 적용한다.
 *
 * 판정: 기사 X가 날짜 D의 대타를 맡으면, D가 속한 주(일요일 시작, UTC)의 근무일이
 * maxDays 를 초과(= 그 주 0휴일)하는가?  이미 maxDays 일 근무 중이면 부적격.
 *
 * 주 계산은 solver(constraints.ts countByWeek / monthly-grid-solver wouldViolateGridRules)와
 * 동일한 "일요일 시작, UTC, date-only" 규약을 그대로 따른다 — 생성 로직과 100% 일치.
 */
import { Prisma } from '@prisma/client';
import { prisma } from '../utils/prisma';
import { loadCompanyPolicy } from './solverDispatchService';
import { DEFAULT_CONSTITUTIONAL, type CompanyPolicy } from '../agents/_solvers/types';

/** 근무일로 카운트하는 슬롯 상태 (DROPPED/ABSENT/COMPLETED 제외 — 휴식/과거로 취급) */
const WORK_STATUSES: Array<'SCHEDULED' | 'FILLED'> = ['SCHEDULED', 'FILLED'];

/** 날짜 문자열(YYYY-MM-DD)이 속한 주의 [일요일, 토요일] 경계 (UTC date-only). */
export function weekBoundsUTC(dateISO: string): { weekStart: Date; weekEnd: Date } {
  const [y, m, d] = dateISO.split('-').map(Number);
  const base = new Date(Date.UTC(y, m - 1, d));
  const dow = base.getUTCDay(); // 일요일 = 0
  const weekStart = new Date(base);
  weekStart.setUTCDate(base.getUTCDate() - dow);
  const weekEnd = new Date(weekStart);
  weekEnd.setUTCDate(weekStart.getUTCDate() + 6);
  return { weekStart, weekEnd };
}

/** 회사 정책에서 weeklyMaxWorkDays 규칙 추출 (미지정 시 디폴트). */
function getWeeklyRule(policy: CompanyPolicy | undefined) {
  return policy?.constitutional?.weeklyMaxWorkDays ?? DEFAULT_CONSTITUTIONAL.weeklyMaxWorkDays;
}

export interface WeeklyRestCheck {
  /** true = 대타 수락/배정 가능 (주휴일 유지) */
  eligible: boolean;
  /** 해당 주 현재 근무일 수 (대상 슬롯 제외) */
  weeklyWorkDays: number;
  /** 주 최대 근무일 상한 */
  maxDays: number;
  /** 규칙 활성 여부 (false 면 제약 없음 → 항상 eligible) */
  ruleEnabled: boolean;
}

/**
 * 기사가 특정 날짜의 대타를 맡으면 그 주 근무일 상한을 넘는지 검사.
 *
 * @param db prisma 또는 트랜잭션 클라이언트(tx) — 수락 트랜잭션 내 원자적 재검사를 위해 주입.
 *           (PrismaClient 는 TransactionClient 인터페이스를 구조적으로 만족하므로 둘 다 전달 가능)
 */
export async function wouldExceedWeeklyWork(
  db: Prisma.TransactionClient,
  args: {
    driverId: number;
    /** 대타 슬롯 날짜 (YYYY-MM-DD) */
    dateISO: string;
    companyId: number;
    /** 카운트에서 제외할 슬롯 ID (대상 대타 슬롯 자신 — 방어용) */
    excludeSlotId?: number;
    /** 정책 프리로드 (배치 호출 시 중복 로드 방지) */
    policy?: CompanyPolicy;
  },
): Promise<WeeklyRestCheck> {
  const policy = args.policy ?? (await loadCompanyPolicy(args.companyId));
  const rule = getWeeklyRule(policy);
  const maxDays = rule?.maxDays ?? 6;

  if (!rule?.enabled) {
    return { eligible: true, weeklyWorkDays: 0, maxDays, ruleEnabled: false };
  }

  const { weekStart, weekEnd } = weekBoundsUTC(args.dateISO);
  const weeklyWorkDays = await db.scheduleSlot.count({
    where: {
      driverId: args.driverId,
      isRestDay: false,
      status: { in: WORK_STATUSES },
      date: { gte: weekStart, lte: weekEnd },
      schedule: { status: 'PUBLISHED', companyId: args.companyId },
      ...(args.excludeSlotId ? { id: { not: args.excludeSlotId } } : {}),
    },
  });

  // 이미 maxDays 근무 → 하나 더 맡으면 주 0휴일 → 부적격
  return { eligible: weeklyWorkDays < maxDays, weeklyWorkDays, maxDays, ruleEnabled: true };
}

/**
 * 기사 대타 목록용 배치 필터 — 본인 드랍 제외 + 주휴일 위반이 되는 드랍 제외.
 *
 * 드랍들을 주(일요일 시작)별로 묶어, 주당 근무일 카운트를 1회씩만 조회한다(성능).
 */
export async function filterEligibleDropsForDriver<
  T extends { driverId: number; slot: { date: Date } },
>(driverId: number, drops: T[], companyId: number): Promise<T[]> {
  // 본인이 드랍한 건은 자기 자신이 수락할 수 없으므로 우선 제외 (기존 클라이언트 필터의 서버 승격)
  const others = drops.filter((d) => d.driverId !== driverId);
  if (others.length === 0) return [];

  const policy = await loadCompanyPolicy(companyId);
  const rule = getWeeklyRule(policy);
  if (!rule?.enabled) return others; // 규칙 비활성 → 제약 없음
  const { maxDays } = rule;

  const countCache = new Map<string, number>();
  const result: T[] = [];

  for (const drop of others) {
    const dateISO = drop.slot.date.toISOString().slice(0, 10);
    const { weekStart, weekEnd } = weekBoundsUTC(dateISO);
    const key = weekStart.toISOString().slice(0, 10);

    let count = countCache.get(key);
    if (count === undefined) {
      count = await prisma.scheduleSlot.count({
        where: {
          driverId,
          isRestDay: false,
          status: { in: WORK_STATUSES },
          date: { gte: weekStart, lte: weekEnd },
          schedule: { status: 'PUBLISHED', companyId },
        },
      });
      countCache.set(key, count);
    }

    if (count < maxDays) result.push(drop);
  }

  return result;
}
