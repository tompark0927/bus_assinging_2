/**
 * 주휴일(근로기준법 제55조) 대타 자격 검사 단위 테스트.
 *
 * - weekBoundsUTC: 일요일 시작 UTC 주 경계 (solver countByWeek 와 동일 규약)
 * - wouldExceedWeeklyWork: maxDays 경계, 규칙 비활성, date-range/PUBLISHED where 구성
 *
 * db 는 주입식(fake) 이고 policy 를 명시 전달하므로 실제 DB·loadCompanyPolicy 불필요.
 */
import type { Prisma } from '@prisma/client';
import { weekBoundsUTC, wouldExceedWeeklyWork } from '../../services/weeklyRestEligibility';
import type { CompanyPolicy } from '../../agents/_solvers/types';

function policyWithMaxDays(maxDays: number, enabled = true): CompanyPolicy {
  return { constitutional: { weeklyMaxWorkDays: { enabled, maxDays } } } as unknown as CompanyPolicy;
}

/** scheduleSlot.count 만 가진 가짜 트랜잭션 클라이언트. */
function fakeDb(count: number) {
  const countFn = jest.fn().mockResolvedValue(count);
  return {
    db: { scheduleSlot: { count: countFn } } as unknown as Prisma.TransactionClient,
    countFn,
  };
}

describe('weekBoundsUTC', () => {
  it('수요일(2026-07-15) → 일요일(07-12)~토요일(07-18)', () => {
    const { weekStart, weekEnd } = weekBoundsUTC('2026-07-15');
    expect(weekStart.toISOString().slice(0, 10)).toBe('2026-07-12');
    expect(weekEnd.toISOString().slice(0, 10)).toBe('2026-07-18');
  });

  it('주 경계: 일요일 입력은 그 자신이 weekStart', () => {
    const { weekStart } = weekBoundsUTC('2026-07-12');
    expect(weekStart.toISOString().slice(0, 10)).toBe('2026-07-12');
  });

  it('주 경계: 토요일 입력은 그 자신이 weekEnd', () => {
    const { weekStart, weekEnd } = weekBoundsUTC('2026-07-18');
    expect(weekStart.toISOString().slice(0, 10)).toBe('2026-07-12');
    expect(weekEnd.toISOString().slice(0, 10)).toBe('2026-07-18');
  });

  it('월 경계를 넘는 주: 2026-08-01(토) → weekStart 2026-07-26', () => {
    const { weekStart, weekEnd } = weekBoundsUTC('2026-08-01');
    expect(weekStart.toISOString().slice(0, 10)).toBe('2026-07-26');
    expect(weekEnd.toISOString().slice(0, 10)).toBe('2026-08-01');
  });

  it('불변식: weekStart=일요일, weekEnd=토요일, 6일 간격, 입력 포함', () => {
    for (const iso of ['2026-02-28', '2026-12-31', '2027-01-01']) {
      const { weekStart, weekEnd } = weekBoundsUTC(iso);
      expect(weekStart.getUTCDay()).toBe(0);
      expect(weekEnd.getUTCDay()).toBe(6);
      expect((weekEnd.getTime() - weekStart.getTime()) / 86_400_000).toBe(6);
      const d = new Date(`${iso}T00:00:00.000Z`);
      expect(d >= weekStart && d <= weekEnd).toBe(true);
    }
  });
});

describe('wouldExceedWeeklyWork', () => {
  const base = { driverId: 7, dateISO: '2026-07-15', companyId: 1 };

  it('근무 6일 / maxDays 6 → 부적격 (그 휴일에 대타 맡으면 주 7일)', async () => {
    const { db } = fakeDb(6);
    const r = await wouldExceedWeeklyWork(db, { ...base, policy: policyWithMaxDays(6) });
    expect(r.eligible).toBe(false);
    expect(r.weeklyWorkDays).toBe(6);
    expect(r.maxDays).toBe(6);
    expect(r.ruleEnabled).toBe(true);
  });

  it('근무 5일 / maxDays 6 → 적격 (맡아도 6일·1휴일 유지)', async () => {
    const { db } = fakeDb(5);
    const r = await wouldExceedWeeklyWork(db, { ...base, policy: policyWithMaxDays(6) });
    expect(r.eligible).toBe(true);
    expect(r.weeklyWorkDays).toBe(5);
  });

  it('규칙 비활성(enabled=false) → 항상 적격, count 미조회', async () => {
    const { db, countFn } = fakeDb(99);
    const r = await wouldExceedWeeklyWork(db, {
      ...base,
      policy: policyWithMaxDays(6, false),
    });
    expect(r.eligible).toBe(true);
    expect(r.ruleEnabled).toBe(false);
    expect(countFn).not.toHaveBeenCalled();
  });

  it('회사별 maxDays override(5) 반영: 근무 5일 → 부적격', async () => {
    const { db } = fakeDb(5);
    const r = await wouldExceedWeeklyWork(db, { ...base, policy: policyWithMaxDays(5) });
    expect(r.eligible).toBe(false);
    expect(r.maxDays).toBe(5);
  });

  it('count where: 해당 주 date 범위 + PUBLISHED + 근무상태 + excludeSlotId', async () => {
    const { db, countFn } = fakeDb(3);
    await wouldExceedWeeklyWork(db, {
      ...base,
      excludeSlotId: 555,
      policy: policyWithMaxDays(6),
    });
    const where = countFn.mock.calls[0][0].where;
    expect(where.driverId).toBe(7);
    expect(where.isRestDay).toBe(false);
    expect(where.status).toEqual({ in: ['SCHEDULED', 'FILLED'] });
    expect(where.schedule).toEqual({ status: 'PUBLISHED', companyId: 1 });
    expect(where.id).toEqual({ not: 555 });
    expect(where.date.gte.toISOString().slice(0, 10)).toBe('2026-07-12');
    expect(where.date.lte.toISOString().slice(0, 10)).toBe('2026-07-18');
  });
});
