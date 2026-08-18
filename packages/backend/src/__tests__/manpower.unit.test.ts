/**
 * 인력 계산 — "이 배차를 돌리려면 몇 명이 필요한가".
 *
 * 격일제에서 1일 2교대로 넘어가는 회사가 제일 먼저 묻는 숫자다. 틀리면
 * 채용 계획이 틀어지므로 산수를 못 박는다. 기준값은 성민버스 실데이터
 * (3노선 × 14대, 평일 12 / 토 11 / 휴일 10, 108명, 2026년 7월 = 2,160칸).
 */

jest.mock('../utils/prisma');
jest.mock('../services/solverDispatchService', () => ({
  loadCompanyPolicy: jest.fn(),
}));

import { prisma } from '../utils/prisma';
import { loadCompanyPolicy } from '../services/solverDispatchService';
import { computeManpowerPlan } from '../services/manpowerService';
import { POLICY_PRESETS } from '../agents/_solvers/types';

/* eslint-disable @typescript-eslint/no-explicit-any */
const mockPrisma = prisma as any;
const mockPolicy = loadCompanyPolicy as jest.Mock;

/** 노선 1개 = 차량 14대 (성민 실제 구성) */
function route(id: number, routeNumber: string) {
  return {
    id,
    routeNumber,
    weekdayBuses: 12,
    saturdayBuses: 11,
    holidayBuses: 10,
    buses: Array.from({ length: 14 }, (_, i) => ({
      id: id * 100 + i,
      busNumber: `${id}${String(i).padStart(2, '0')}`,
    })),
  };
}

function drivers(main: number, spare: number) {
  return [
    ...Array.from({ length: main }, () => ({ driverType: 'MAIN' })),
    ...Array.from({ length: spare }, () => ({ driverType: 'SPARE' })),
  ];
}

describe('computeManpowerPlan — 성민버스 2026년 7월', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPolicy.mockResolvedValue(POLICY_PRESETS.CITY_2SHIFT);
    mockPrisma.route.findMany.mockResolvedValue([route(1, '16'), route(2, '9'), route(3, '3-2')]);
    mockPrisma.user.findMany.mockResolvedValue(drivers(84, 24));
  });

  it('필요 칸수와 현재 인력을 집계한다', async () => {
    const p = await computeManpowerPlan(5, 2026, 7);
    // 3노선 × (평일 23일 × 12 + 토 4 × 11 + 일 4 × 10) × 2교대
    expect(p.totalCells).toBe(2160);
    expect(p.currentDrivers).toBe(108);
    expect(p.mainDrivers).toBe(84);
    expect(p.spareDrivers).toBe(24);
    expect(p.daysInMonth).toBe(31);
    expect(p.unconfigured).toBe(false);
  });

  it('1인당 근무일과 가동률을 낸다', async () => {
    const p = await computeManpowerPlan(5, 2026, 7);
    expect(p.perDriverDays).toBe(20); // 2160 / 108
    expect(p.currentDutyRatio).toBe(0.645); // 20 / 31
  });

  it('5일 근무 2일 휴무는 97.5명 — 지금 인력이 10.5명 남는다', async () => {
    const p = await computeManpowerPlan(5, 2026, 7);
    const c = p.cycles.find((x) => x.workDays === 5 && x.restDays === 2)!;
    expect(c.dutyRatio).toBe(0.714);
    expect(c.monthlyWorkDays).toBe(22.1);
    expect(c.requiredDrivers).toBe(97.5);
    expect(c.gap).toBe(10.5);
  });

  it('4일 근무 2일 휴무는 104.5명 — 현재 인력에 가장 가깝다', async () => {
    const p = await computeManpowerPlan(5, 2026, 7);
    const c = p.cycles.find((x) => x.workDays === 4 && x.restDays === 2)!;
    expect(c.requiredDrivers).toBe(104.5);
    expect(c.isBestFit).toBe(true);
    // 권장은 하나뿐
    expect(p.cycles.filter((x) => x.isBestFit)).toHaveLength(1);
  });

  it('사람이 모자란 형태는 부족분을 음수 gap 으로 알려준다', async () => {
    const p = await computeManpowerPlan(5, 2026, 7);
    const c = p.cycles.find((x) => x.workDays === 3 && x.restDays === 2)!;
    expect(c.requiredDrivers).toBeGreaterThan(108);
    expect(c.gap).toBeLessThan(0);
  });

  it('정책 근무일 상한(23일)을 넘는 형태는 표시만 하고 권장하지 않는다', async () => {
    const p = await computeManpowerPlan(5, 2026, 7);
    const c = p.cycles.find((x) => x.workDays === 6 && x.restDays === 1)!;
    expect(c.monthlyWorkDays).toBeGreaterThan(23);
    expect(c.exceedsPolicyMax).toBe(true);
    expect(c.isBestFit).toBe(false);
  });

  it('요일별 대수를 설정하지 않았으면 과대 추정임을 알린다', async () => {
    mockPrisma.route.findMany.mockResolvedValue([
      { ...route(1, '16'), weekdayBuses: null, saturdayBuses: null, holidayBuses: null },
    ]);
    const p = await computeManpowerPlan(5, 2026, 7);
    expect(p.unconfigured).toBe(true);
    expect(p.totalCells).toBe(14 * 2 * 31); // 전 차량 매일 운행
  });

  it('기사가 한 명도 없어도 터지지 않는다', async () => {
    mockPrisma.user.findMany.mockResolvedValue([]);
    const p = await computeManpowerPlan(5, 2026, 7);
    expect(p.currentDrivers).toBe(0);
    expect(p.perDriverDays).toBe(0);
    // 필요 인원은 인력과 무관하게 나온다
    expect(p.cycles.find((x) => x.workDays === 5 && x.restDays === 2)!.requiredDrivers).toBe(97.5);
  });

  it('계산 근거로 노선별 대수를 함께 준다', async () => {
    const p = await computeManpowerPlan(5, 2026, 7);
    expect(p.routes).toHaveLength(3);
    expect(p.routes[0]).toEqual({
      routeNumber: '16', registered: 14, weekday: 12, saturday: 11, holiday: 10,
    });
  });
});
