import { buildScenario, SCENARIO_SUITE, type ScenarioSpec } from '../bench/scenarios';

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
