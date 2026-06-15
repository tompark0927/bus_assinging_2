import { buildScenario, SCENARIO_SUITE, type ScenarioSpec } from '../bench/scenarios';

const spec: ScenarioSpec = {
  label: 'test-city-medium', seed: 123, policy: 'CITY_2SHIFT',
  routes: 2, busesPerRoute: 5, sparesPerRoute: 2,
  weekdayOps: 0.95, weekendOps: 0.75, dayOffDensity: 0.3, year: 2026, month: 5,
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
});

describe('SCENARIO_SUITE', () => {
  it('다양한 정책과 규모를 포함한다', () => {
    expect(SCENARIO_SUITE.length).toBeGreaterThanOrEqual(18);
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
