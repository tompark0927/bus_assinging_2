import { mapPreferredRouteIds } from '../services/solverDispatchService';

describe('mapPreferredRouteIds', () => {
  it('priority 오름차순으로 정렬하여 routeId 배열을 반환한다', () => {
    const prefs = [
      { routeId: 300, priority: 3 },
      { routeId: 100, priority: 1 },
      { routeId: 200, priority: 2 },
    ];
    expect(mapPreferredRouteIds(prefs)).toEqual([100, 200, 300]);
  });

  it('빈 배열 입력 시 빈 배열을 반환한다', () => {
    expect(mapPreferredRouteIds([])).toEqual([]);
  });

  it('원본 배열을 변경하지 않는다 (immutable)', () => {
    const prefs = [
      { routeId: 200, priority: 2 },
      { routeId: 100, priority: 1 },
    ];
    const original = [...prefs];
    mapPreferredRouteIds(prefs);
    expect(prefs).toEqual(original);
  });

  it('단일 항목은 그대로 반환한다', () => {
    expect(mapPreferredRouteIds([{ routeId: 42, priority: 1 }])).toEqual([42]);
  });
});
