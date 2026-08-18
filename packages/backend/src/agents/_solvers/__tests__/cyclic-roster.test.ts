/**
 * 순환 근무표 구성 — 단위 테스트.
 *
 * 이 방식이 지키기로 한 것들을 못 박는다. 하나라도 깨지면 그리디 시절의
 * 문제(연속 근무일 안에서 오전/오후가 뒤집히고, 그 자리에서 '오후→다음날
 * 오전'이 생겨 법정 연속 휴식 8시간이 위협받는 것)가 되돌아온다.
 */

import { blocksOf, buildLines, supportsCyclicRoster } from '../cyclic-roster';
import { solveMonthlyGrid } from '../monthly-grid-solver';
import { DEFAULT_POLICY, POLICY_PRESETS } from '../types';
import type { CompanyPolicy, SolverCrew, SolverDriver, SolverInput } from '../types';

const CYCLE = { minWork: 3, maxWork: 5, minRest: 2, maxRest: 5, maxTotalWork: 23, sweetMaxWork: 22 };

/** 차량 n대 = 짝꿍 n쌍 + 스페어 s명 (한 노선) */
function buildInput(nBuses: number, nSpares: number, opts: Partial<SolverInput> = {}): SolverInput {
  const drivers: SolverDriver[] = [];
  const crews: SolverCrew[] = [];
  for (let i = 0; i < nBuses; i++) {
    const busId = 1000 + i;
    const a = 1 + i * 2;
    const b = 2 + i * 2;
    crews.push({ id: `C${i}`, driverIds: [a, b], busId, routeId: 100 });
    for (const id of [a, b]) {
      drivers.push({
        id, name: `기사${id}`, homeBusId: busId, homeRouteId: 100,
        partnerId: id === a ? b : a, approvedDayOffs: [], recentFatigueScore: 0, isNewHire: false,
      });
    }
  }
  for (let i = 0; i < nSpares; i++) {
    drivers.push({
      id: 9000 + i, name: `스페어${i}`, approvedDayOffs: [], recentFatigueScore: 0, isNewHire: false,
    });
  }
  return {
    year: 2026, month: 7,
    drivers,
    buses: crews.map((c) => ({ id: c.busId, routeId: 100, busNumber: String(c.busId) })),
    crews,
    ...opts,
  };
}

describe('supportsCyclicRoster — 이 방식으로 짤 수 있는 입력인가', () => {
  const crews: SolverCrew[] = [{ id: 'C1', driverIds: [1, 2], busId: 10, routeId: 100 }];

  it('2교대 + 짝꿍이면 쓴다', () => {
    expect(supportsCyclicRoster(POLICY_PRESETS.CITY_2SHIFT, crews)).toBe(true);
  });

  it('1교대(마을버스)는 그리디에 맡긴다', () => {
    expect(supportsCyclicRoster(POLICY_PRESETS.VILLAGE_1SHIFT, crews)).toBe(false);
  });

  it('단독 승무(SOLO)는 그리디에 맡긴다', () => {
    const p: CompanyPolicy = { ...POLICY_PRESETS.CITY_2SHIFT, crewModel: { kind: 'SOLO', size: 1 } };
    expect(supportsCyclicRoster(p, [{ id: 'C1', driverIds: [1], busId: 10, routeId: 100 }])).toBe(false);
  });

  it('야간 연속 제한을 오후에 걸어둔 회사는 그리디로 — 한 블록 한 시프트와 충돌한다', () => {
    const p: CompanyPolicy = {
      ...POLICY_PRESETS.CITY_2SHIFT,
      constitutional: {
        ...POLICY_PRESETS.CITY_2SHIFT.constitutional,
        noNightStreak: { enabled: true, maxConsecutive: 3, nightShifts: ['PM'] },
      },
    };
    expect(supportsCyclicRoster(p, crews)).toBe(false);
  });

  it('차량에 배정된 기사가 없으면 쓸 수 없다', () => {
    expect(supportsCyclicRoster(POLICY_PRESETS.CITY_2SHIFT, [])).toBe(false);
  });
});

describe('buildLines — 1단계 근무/휴무 패턴', () => {
  it('매일 정확히 필요한 수만큼 근무한다 (어긋나면 그만큼 공석이 된다)', () => {
    const demand = new Array(31).fill(9);
    const lines = buildLines(14, { demand, seed: 1, cycle: CYCLE });
    for (let d = 0; d < 31; d++) {
      expect(lines.filter((l) => l[d]).length).toBe(9);
    }
  });

  it('근무 블록이 정책 상한(5일)을 넘지 않는다', () => {
    const lines = buildLines(14, { demand: new Array(31).fill(9), seed: 1, cycle: CYCLE });
    for (const l of lines) {
      for (const [s, e] of blocksOf(l)) expect(e - s + 1).toBeLessThanOrEqual(CYCLE.maxWork);
    }
  });

  it('한 달 근무일 상한을 넘기지 않는다 — 넘겨 채우느니 공석으로 드러낸다', () => {
    // 14유닛으로 매일 14개를 요구 = 쉴 틈 없는 수요
    const lines = buildLines(14, { demand: new Array(31).fill(14), seed: 1, cycle: CYCLE });
    for (const l of lines) expect(l.filter(Boolean).length).toBeLessThanOrEqual(CYCLE.maxTotalWork);
  });

  it('그 차가 안 나가는 날(강제 휴무)에는 배정하지 않는다', () => {
    const forcedRest = Array.from({ length: 14 }, (_, i) =>
      Array.from({ length: 31 }, (_, d) => i === 0 && d >= 10 && d < 15),
    );
    const lines = buildLines(14, { demand: new Array(31).fill(9), seed: 1, cycle: CYCLE, forcedRest });
    for (let d = 10; d < 15; d++) expect(lines[0][d]).toBe(false);
  });

  it('주간 최대 근무일을 지킨다', () => {
    const weekOfDay = Array.from({ length: 28 }, (_, d) => Math.floor(d / 7));
    const lines = buildLines(14, {
      demand: new Array(28).fill(12), seed: 1, cycle: CYCLE,
      grid: { weekOfDay, isWeekendDay: new Array(28).fill(false), maxPerWeek: 6 },
    });
    for (const l of lines) {
      for (let w = 0; w < 4; w++) {
        expect(l.slice(w * 7, w * 7 + 7).filter(Boolean).length).toBeLessThanOrEqual(6);
      }
    }
  });

  it('월 최소 주말 휴무를 보장한다', () => {
    const isWeekendDay = Array.from({ length: 28 }, (_, d) => d % 7 === 5 || d % 7 === 6);
    const lines = buildLines(14, {
      demand: new Array(28).fill(13), seed: 1, cycle: CYCLE,
      grid: {
        weekOfDay: Array.from({ length: 28 }, (_, d) => Math.floor(d / 7)),
        isWeekendDay, minWeekendOff: 1,
      },
    });
    for (const l of lines) {
      const weekendOff = isWeekendDay.filter((w, d) => w && !l[d]).length;
      expect(weekendOff).toBeGreaterThanOrEqual(1);
    }
  });
});

describe('solveMonthlyGrid — 순환 근무표 경로 (성민 구조)', () => {
  // 14대 × 2교대 × 31일 = 868칸. 한 사람 20일씩 태우려면 44명이 필요하다
  // (짝꿍 28 + 스페어 16). 인력이 이보다 적으면 공석이 남는 게 정상이다.
  const result = solveMonthlyGrid(buildInput(14, 16));

  it('공석이 없다', () => {
    expect(result.unfilled).toHaveLength(0);
  });

  it('연속 근무일 안에서 시프트가 바뀌지 않는다 — 이 방식의 존재 이유', () => {
    const byDriver = new Map<number, Map<string, string>>();
    for (const s of result.slots) {
      if (!byDriver.has(s.driverId)) byDriver.set(s.driverId, new Map());
      byDriver.get(s.driverId)!.set(s.date, s.shift);
    }
    let changes = 0;
    for (const days of byDriver.values()) {
      const sorted = [...days.keys()].sort();
      for (let i = 1; i < sorted.length; i++) {
        const prev = new Date(`${sorted[i - 1]}T00:00:00.000Z`);
        prev.setUTCDate(prev.getUTCDate() + 1);
        if (prev.toISOString().slice(0, 10) !== sorted[i]) continue;
        if (days.get(sorted[i - 1]) !== days.get(sorted[i])) changes++;
      }
    }
    expect(changes).toBe(0);
  });

  it('오후 근무 다음날 오전 근무가 없다 (법 제44조의6 연속 휴식 8시간)', () => {
    const pm = new Set(result.slots.filter((s) => s.shift === 'PM').map((s) => `${s.driverId}|${s.date}`));
    const bad = result.slots.filter((s) => {
      if (s.shift !== 'AM') return false;
      const prev = new Date(`${s.date}T00:00:00.000Z`);
      prev.setUTCDate(prev.getUTCDate() - 1);
      return pm.has(`${s.driverId}|${prev.toISOString().slice(0, 10)}`);
    });
    expect(bad).toHaveLength(0);
  });

  it('같은 차의 오전·오후는 서로 다른 사람이다', () => {
    const cell = new Map<string, number>();
    for (const s of result.slots) cell.set(`${s.date}|${s.busId}|${s.shift}`, s.driverId);
    for (const [key, driverId] of cell) {
      const [date, busId, shift] = key.split('|');
      const other = cell.get(`${date}|${busId}|${shift === 'AM' ? 'PM' : 'AM'}`);
      if (other !== undefined) expect(other).not.toBe(driverId);
    }
  });

  it('같은 날 두 번 배정되는 기사가 없다', () => {
    const seen = new Set<string>();
    for (const s of result.slots) {
      const k = `${s.driverId}|${s.date}`;
      expect(seen.has(k)).toBe(false);
      seen.add(k);
    }
  });

  it('메인 기사는 자기 차만 탄다', () => {
    const cross = result.slots.filter((s) => !s.isHomeBus && s.driverId < 9000);
    expect(cross).toHaveLength(0);
  });

  it('헌법 룰 위반이 없다', () => {
    expect(result.metrics.constitutionalViolations).toHaveLength(0);
  });

  it('휴무 승인일에는 배정하지 않는다', () => {
    const input = buildInput(14, 16);
    input.drivers[0].approvedDayOffs = ['2026-07-06', '2026-07-07', '2026-07-08'];
    const r = solveMonthlyGrid(input);
    const bad = r.slots.filter(
      (s) => s.driverId === input.drivers[0].id && input.drivers[0].approvedDayOffs.includes(s.date),
    );
    expect(bad).toHaveLength(0);
  });

  it('감차 계획을 함께 돌려준다 — 화면·인쇄물이 같은 사실을 보게 하는 근거', () => {
    // 차량 절반만 운행하는 계획을 주면 나머지가 감차로 나와야 한다
    const input = buildInput(14, 16);
    const days = Array.from({ length: 31 }, (_, i) => `2026-07-${String(i + 1).padStart(2, '0')}`);
    input.buses = input.buses.map((b, i) => ({ ...b, operatingDates: i < 10 ? days : [] }));
    const r = solveMonthlyGrid(input);
    expect(r.restingByDate).toBeDefined();
    for (const day of days) {
      expect(r.restingByDate![day] ?? []).toHaveLength(4);
    }
  });
});

describe('그리디 경로는 그대로 — 회귀 방지', () => {
  it('1교대 회사는 restingByDate 를 돌려주지 않는다 (운행 계획을 덮어쓰지 않는다)', () => {
    const input = buildInput(6, 2, { policy: POLICY_PRESETS.VILLAGE_1SHIFT });
    // SOLO 정책이라 crews 를 1인으로 맞춘다
    input.crews = (input.crews ?? []).map((c) => ({ ...c, driverIds: [c.driverIds[0]] }));
    const r = solveMonthlyGrid(input);
    expect(r.restingByDate).toBeUndefined();
  });

  it('디폴트 정책은 여전히 CITY_2SHIFT', () => {
    expect(DEFAULT_POLICY.preset).toBe('CITY_2SHIFT');
  });
});

describe('월 경계 — 1일은 근무 사이클의 시작이 아니다', () => {
  it('월 초에 전원이 길게 쉬지 않는다 (전원 휴무 상태로 출발하지 않는다)', () => {
    const r = solveMonthlyGrid(buildInput(14, 16));
    const first = new Map<number, string>();
    for (const s of r.slots) {
      const cur = first.get(s.driverId);
      if (!cur || s.date < cur) first.set(s.driverId, s.date);
    }
    // 1일부터 나오는 사람이 과반이어야 한다
    const day1 = [...first.values()].filter((d) => d === '2026-07-01').length;
    expect(day1).toBeGreaterThan(first.size / 2);
    // 대다수가 첫 사흘 안에 근무를 시작한다 (전원 휴무 출발이면 5일까지 밀린다)
    const within3 = [...first.values()].filter((d) => Number(d.slice(-2)) <= 3).length;
    expect(within3 / first.size).toBeGreaterThan(0.8);
  });

  it('전월 마지막 연속 근무일수를 이어받는다', () => {
    const input = buildInput(14, 16);
    // 전원에게 전월 이월 정보를 준다 — 짝꿍 절반은 블록 2일째(계속 나와야 함),
    // 나머지는 휴무 중. 2일째면 최소 근무 블록(3일)에 못 미쳐 반드시 이어간다.
    input.drivers = input.drivers.map((d, i) => ({
      ...d,
      carryOverPattern: {
        consecutiveWorkDays: i % 4 < 2 ? 2 : 0,
        lastShift: null,
        lastWeekDominantShift: 'MIXED' as const,
      },
    }));
    const r = solveMonthlyGrid(input);
    const onDay1 = new Set(r.slots.filter((s) => s.date === '2026-07-01').map((s) => s.driverId));
    // 블록 2일째였던 사람은 1일에도 나와야 한다 (최소 블록 길이를 못 채웠다)
    const carried = input.drivers.filter((_, i) => i % 4 < 2).map((d) => d.id);
    const workedOnDay1 = carried.filter((id) => onDay1.has(id)).length;
    expect(workedOnDay1).toBeGreaterThan(carried.length / 2);
  });
});
