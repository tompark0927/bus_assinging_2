import { buildScenario, SCENARIO_SUITE, type ScenarioSpec } from '../bench/scenarios';
import { POLICY_PRESETS } from '../types';

const spec: ScenarioSpec = {
  label: 'test-city-medium', seed: 123, policy: 'CITY_2SHIFT',
  routes: 2, busesPerRoute: 5, sparesPerRoute: 2,
  weekdayOps: 1, weekendOps: 1, dayOffDensity: 0.3, year: 2026, month: 5,
};

describe('buildScenario', () => {
  it('같은 spec은 비트 단위로 동일한 SolverInput을 만든다', () => {
    expect(JSON.stringify(buildScenario(spec))).toEqual(JSON.stringify(buildScenario(spec)));
  });
  it('시드가 다르면 입력이 달라진다', () => {
    expect(JSON.stringify(buildScenario(spec))).not.toEqual(JSON.stringify(buildScenario({ ...spec, seed: 999 })));
  });
  it('PAIR 모델: 노선당 buses*2 home + spares, crew 구성', () => {
    const input = buildScenario(spec);
    expect(input.drivers.length).toBe(24); // 2*(5*2 + 2)
    expect(input.buses.length).toBe(10);
    expect(input.crews?.length).toBe(10);
    expect(input.drivers.filter((d) => d.homeBusId === undefined).length).toBe(4);
  });
  it('생성된 입력은 솔버가 받아들이는 형태다 (year/month/policy)', () => {
    const input = buildScenario(spec);
    expect(input.year).toBe(2026);
    expect(input.month).toBe(5);
    expect(input.policy?.shiftSystem.kind).toBe('TWO_SHIFT');
  });
  it('한 달 내내 운휴인 차량은 생성하지 않는다 (ghost bus 제거)', () => {
    // busesPerRoute=5, weekday 0.6 -> floor(5*0.6)=3 운행, weekend 0.4 -> floor(5*0.4)=2 운행.
    // position 3,4 는 평일·주말 모두 운휴 -> 제외. route당 3대만 생성.
    const ghostSpec: ScenarioSpec = { ...spec, weekdayOps: 0.6, weekendOps: 0.4, routes: 1, busesPerRoute: 5, sparesPerRoute: 0 };
    const input = buildScenario(ghostSpec);
    expect(input.buses.length).toBe(3);
    expect(input.buses.every((bus) => (bus.operatingDates?.length ?? 0) > 0)).toBe(true);
    // 모든 home 기사의 homeBusId 가 실제 생성된 버스를 가리킨다
    const busIds = new Set(input.buses.map((bus) => bus.id));
    expect(input.drivers.filter((d) => d.homeBusId !== undefined).every((d) => busIds.has(d.homeBusId!))).toBe(true);
  });
  it('SOLO 모델 (VILLAGE_1SHIFT): 차당 1명, partnerId 없음', () => {
    const vil: ScenarioSpec = { ...spec, policy: 'VILLAGE_1SHIFT', routes: 1, busesPerRoute: 3, sparesPerRoute: 1 };
    const input = buildScenario(vil);
    expect(input.drivers.length).toBe(4); // 3*1 + 1 spare
    expect(input.crews?.every((c) => c.driverIds.length === 1)).toBe(true);
    expect(input.drivers.filter((d) => d.partnerId !== undefined).length).toBe(0);
  });
});

describe('buildScenario — 선호 노선 (preferredRouteIds)', () => {
  it('spare 기사에게 homeRouteId 기반 preferredRouteIds가 설정된다', () => {
    const input = buildScenario(spec);
    const spares = input.drivers.filter((d) => d.homeBusId === undefined);
    expect(spares.length).toBeGreaterThan(0);
    expect(spares.every((d) => d.preferredRouteIds !== undefined && d.preferredRouteIds.length > 0)).toBe(true);
    // preferredRouteIds[0] 은 homeRouteId 와 같아야 함
    expect(spares.every((d) => d.preferredRouteIds![0] === d.homeRouteId)).toBe(true);
  });
});

describe('buildScenario — 신규 입사 (NEW_HIRE) 면제', () => {
  // spec: routes=1, sparesPerRoute=2 → s===0 && r===1 조건의 spare가 신규 입사자
  const newHireSpec: ScenarioSpec = {
    label: 'test-newhire', seed: 42, policy: 'CITY_2SHIFT',
    routes: 1, busesPerRoute: 2, sparesPerRoute: 2,
    weekdayOps: 1, weekendOps: 1, dayOffDensity: 0, year: 2026, month: 5,
  };

  it('첫 번째 route의 첫 번째 spare는 isNewHire=true이다', () => {
    const input = buildScenario(newHireSpec);
    const spares = input.drivers.filter((d) => d.homeBusId === undefined);
    expect(spares.some((d) => d.isNewHire)).toBe(true);
  });

  it('신규 입사 spare에게 workDayTarget.exemptReason === NEW_HIRE가 설정된다', () => {
    const input = buildScenario(newHireSpec);
    const newHire = input.drivers.find((d) => d.isNewHire);
    expect(newHire).toBeDefined();
    expect(newHire!.workDayTarget?.exemptReason).toBe('NEW_HIRE');
  });

  it('신규 입사 spare에게 approvedDayOffs가 14개 이상이다 (월 초반 입사 시뮬레이션)', () => {
    const input = buildScenario(newHireSpec);
    const newHire = input.drivers.find((d) => d.isNewHire);
    expect(newHire).toBeDefined();
    expect(newHire!.approvedDayOffs.length).toBeGreaterThanOrEqual(14);
  });

  it('workDayTarget 밴드가 회사 정책(CITY_2SHIFT)과 일치한다', () => {
    const input = buildScenario(newHireSpec);
    const newHire = input.drivers.find((d) => d.isNewHire);
    const bands = POLICY_PRESETS.CITY_2SHIFT.workdayBands;
    expect(newHire!.workDayTarget).toMatchObject({
      min: bands.hardMin,
      max: bands.hardMax,
      softMin: bands.sweetMin,
      softMax: bands.sweetMax,
    });
  });

  it('VILLAGE_1SHIFT 정책에서도 신규 입사 spare에 밴드가 VILLAGE_1SHIFT 기준으로 설정된다', () => {
    const vilSpec: ScenarioSpec = { ...newHireSpec, policy: 'VILLAGE_1SHIFT' };
    const input = buildScenario(vilSpec);
    const newHire = input.drivers.find((d) => d.isNewHire);
    const bands = POLICY_PRESETS.VILLAGE_1SHIFT.workdayBands;
    expect(newHire!.workDayTarget?.exemptReason).toBe('NEW_HIRE');
    expect(newHire!.workDayTarget?.min).toBe(bands.hardMin);
  });
});

describe('SCENARIO_SUITE', () => {
  it('다양한 정책과 규모를 포함한다', () => {
    expect(SCENARIO_SUITE.length).toBe(21);
    const policies = new Set(SCENARIO_SUITE.map((s) => s.policy));
    expect(policies.has('CITY_2SHIFT')).toBe(true);
    expect(policies.has('VILLAGE_1SHIFT')).toBe(true);
  });
  it('라벨이 모두 고유하다', () => {
    const labels = SCENARIO_SUITE.map((s) => s.label);
    expect(new Set(labels).size).toBe(labels.length);
  });
  it('모든 시나리오가 예외 없이 빌드된다', () => {
    for (const spec of SCENARIO_SUITE) expect(() => buildScenario(spec)).not.toThrow();
  });
});
