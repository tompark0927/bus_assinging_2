/**
 * 운행 계획 — "그날 어느 차가 나가는가"
 *
 * 성민버스 실측(2020-10): 노선당 등록 14대 중 평일 12 / 토 11 / 일·공휴일 10.
 * 이 규칙을 모르고 "전 차량 매일 운행"으로 배차하면 한 달에 400칸 넘게
 * 없는 근무가 생기고 인력이 모자란 것처럼 보인다. 그 계산을 검증한다.
 */

jest.mock('../utils/prisma');

import { prisma } from '../utils/prisma';
import {
  buildOperatingPlan,
  countForDate,
  persistRestingVehicles,
} from '../services/operatingPlanService';

/* eslint-disable @typescript-eslint/no-explicit-any */
const mockPrisma = prisma as any;

/** 노선 1개 = 차량 n대 */
function route(id: number, routeNumber: string, n: number, counts: Partial<Record<'weekdayBuses' | 'saturdayBuses' | 'holidayBuses', number>> = {}) {
  return {
    id, routeNumber,
    weekdayBuses: counts.weekdayBuses ?? null,
    saturdayBuses: counts.saturdayBuses ?? null,
    holidayBuses: counts.holidayBuses ?? null,
    buses: Array.from({ length: n }, (_, i) => ({
      id: id * 100 + i, busNumber: `${id}${String(i).padStart(2, '0')}`,
    })),
  };
}

describe('countForDate — 그날 몇 대가 나가나', () => {
  const rule = { busIds: [1, 2, 3, 4], weekdayBuses: 3, saturdayBuses: 2, holidayBuses: 1 };
  const d = (s: string) => new Date(`${s}T00:00:00.000Z`);

  it('평일은 평일 대수', () => {
    expect(countForDate(rule, d('2026-07-01'), false)).toBe(3); // 수
  });

  it('토요일은 토요일 대수', () => {
    expect(countForDate(rule, d('2026-07-04'), false)).toBe(2);
  });

  it('일요일은 휴일 대수', () => {
    expect(countForDate(rule, d('2026-07-05'), false)).toBe(1);
  });

  it('공휴일이 평일에 걸려도 휴일 대수 — 실측 10/9(금) 공휴일 → 10대', () => {
    expect(countForDate(rule, d('2026-07-01'), true)).toBe(1);
  });

  it('공휴일이 토요일에 걸려도 휴일 대수 — 실측 10/3(토) 개천절 → 10대', () => {
    expect(countForDate(rule, d('2026-07-04'), true)).toBe(1);
  });

  it('미설정(null)이면 전 차량 운행', () => {
    const none = { busIds: [1, 2, 3, 4], weekdayBuses: null, saturdayBuses: null, holidayBuses: null };
    expect(countForDate(none, d('2026-07-01'), false)).toBe(4);
  });
});

describe('buildOperatingPlan', () => {
  beforeEach(() => jest.clearAllMocks());

  const 성민 = () => [
    route(1, '16', 14, { weekdayBuses: 12, saturdayBuses: 11, holidayBuses: 10 }),
    route(2, '9', 14, { weekdayBuses: 12, saturdayBuses: 11, holidayBuses: 10 }),
    route(3, '3-2', 14, { weekdayBuses: 12, saturdayBuses: 11, holidayBuses: 10 }),
  ];

  it('성민버스 규칙(14대 중 평일12/토11/휴일10)으로 실측 칸수를 재현한다', async () => {
    mockPrisma.route.findMany.mockResolvedValue(성민());
    const plan = await buildOperatingPlan(1, 2020, 10);

    // 실측 2112칸. 우리 공휴일표는 음력 공휴일을 2024~2030 만 담고 있어
    // 2020 추석(10/1~2)이 평일로 계산된다 → 그 2일치 24칸(3노선×2대×2교대)
    // 만큼 더 나온다. 2026년 이후 실사용 구간에서는 이 격차가 없다.
    expect(plan.totalCells).toBe(2112 + 24);
    expect(plan.unconfigured).toBe(false);
  });

  it('공휴일은 일요일과 같은 대수로 계산한다 (2026 설날 연휴)', async () => {
    mockPrisma.route.findMany.mockResolvedValue(성민());
    const plan = await buildOperatingPlan(1, 2026, 2);
    // 2026-02-16~18 설날 연휴 — 월·화·수인데도 휴일 대수(10대)여야 한다
    for (const day of ['2026-02-16', '2026-02-17', '2026-02-18']) {
      const resting = plan.restingByDate.get(day) ?? [];
      expect(resting).toHaveLength(12); // 3노선 × (14-10)
    }
  });

  it('감차가 특정 차량에 몰리지 않고 고르게 돌아간다', async () => {
    mockPrisma.route.findMany.mockResolvedValue([
      route(1, '16', 14, { weekdayBuses: 12, saturdayBuses: 11, holidayBuses: 10 }),
    ]);
    const plan = await buildOperatingPlan(1, 2026, 7);

    const workDays = [...plan.busOperatingDates.values()].map((v) => v.length);
    const min = Math.min(...workDays);
    const max = Math.max(...workDays);
    // 차량 간 운행일수 편차가 2일 이내
    expect(max - min).toBeLessThanOrEqual(2);
    expect(plan.busOperatingDates.size).toBe(14); // 모든 차량이 일부는 운행
  });

  it('설정이 하나도 없으면 unconfigured=true (기존 동작 유지)', async () => {
    mockPrisma.route.findMany.mockResolvedValue([route(1, '16', 14)]);
    const plan = await buildOperatingPlan(1, 2026, 7);
    expect(plan.unconfigured).toBe(true);
    // 전 차량이 매일 운행
    expect(plan.totalCells).toBe(14 * 2 * 31);
    expect(plan.restingByDate.size).toBe(0);
  });

  it('설정 대수가 등록 대수보다 크면 등록 대수로 자른다', async () => {
    mockPrisma.route.findMany.mockResolvedValue([
      route(1, '16', 5, { weekdayBuses: 99, saturdayBuses: 99, holidayBuses: 99 }),
    ]);
    const plan = await buildOperatingPlan(1, 2026, 7);
    expect(plan.totalCells).toBe(5 * 2 * 31);
    expect(plan.restingByDate.size).toBe(0);
  });

  it('요약에 노선별 등록/요일 대수를 담는다', async () => {
    mockPrisma.route.findMany.mockResolvedValue([
      route(1, '16', 14, { weekdayBuses: 12, saturdayBuses: 11, holidayBuses: 10 }),
    ]);
    const plan = await buildOperatingPlan(1, 2026, 7);
    expect(plan.summary[0]).toEqual({
      routeNumber: '16', registered: 14, weekday: 12, saturday: 11, holiday: 10,
    });
  });
});

describe('persistRestingVehicles', () => {
  beforeEach(() => jest.clearAllMocks());

  it('감차를 operating:false 패턴으로 저장한다', async () => {
    mockPrisma.schedulePattern.createMany.mockResolvedValue({ count: 2 });
    const n = await persistRestingVehicles(7, new Map([['2026-07-01', [10, 11]]]));
    expect(n).toBe(2);
    const rows = mockPrisma.schedulePattern.createMany.mock.calls[0][0].data;
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      scheduleId: 7, busId: 10, operating: false, underlyingSlot: 0, displaySlot: null,
    });
  });

  it('감차가 없으면 쓰지 않는다', async () => {
    const n = await persistRestingVehicles(7, new Map());
    expect(n).toBe(0);
    expect(mockPrisma.schedulePattern.createMany).not.toHaveBeenCalled();
  });
});
