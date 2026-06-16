/**
 * 단위 테스트 — computeRecentFatigue 순수 헬퍼
 *
 * DB·솔버 없이 순수 함수만 검증.
 * 정규화 공식:
 *   1. avgRouteFatigue = mean(fatigueScore) of worked slots (missing → 3)
 *   2. base = (avg - 1) / 4 * 100   (1→0, 5→100)
 *   3. intensity = min(1, slots.length / 22)   (22 ≈ 풀 월)
 *   4. score = round(clamp(base * intensity, 0, 100))
 *   5. no prior slots → 30 (neutral default)
 */
import { computeRecentFatigue } from '../services/solverDispatchService';

// 헬퍼: Map 생성
function makeMap(entries: [number, number][]): Map<number, number> {
  return new Map(entries);
}

// 헬퍼: n 개의 동일 routeId 슬롯 생성
function slots(routeId: number, count: number): { routeId: number }[] {
  return Array.from({ length: count }, () => ({ routeId }));
}

describe('computeRecentFatigue', () => {
  // ── 기본 케이스 ──────────────────────────────────────────────

  it('전월 슬롯이 없으면 30(중립 기본값)을 반환한다', () => {
    const result = computeRecentFatigue([], makeMap([[1, 5]]));
    expect(result).toBe(30);
  });

  it('빈 Map 이어도 슬롯이 없으면 30 반환', () => {
    const result = computeRecentFatigue([], new Map());
    expect(result).toBe(30);
  });

  // ── 고피로도 노선 ─────────────────────────────────────────────

  it('최고 피로(5) 노선, 풀 월(22) → 100 에 가깝다 (≥95)', () => {
    const map = makeMap([[1, 5]]);
    const result = computeRecentFatigue(slots(1, 22), map);
    // base = (5-1)/4*100 = 100, intensity = 22/22 = 1 → 100
    expect(result).toBe(100);
  });

  it('최고 피로(5) 노선, 22일 초과(30) 도 100 을 초과하지 않는다', () => {
    const map = makeMap([[1, 5]]);
    const result = computeRecentFatigue(slots(1, 30), map);
    expect(result).toBe(100);
    expect(result).toBeLessThanOrEqual(100);
  });

  // ── 저피로도 노선 ─────────────────────────────────────────────

  it('최저 피로(1) 노선, 풀 월(22) → 0', () => {
    const map = makeMap([[1, 1]]);
    const result = computeRecentFatigue(slots(1, 22), map);
    // base = (1-1)/4*100 = 0, intensity = 1 → 0
    expect(result).toBe(0);
  });

  it('최저 피로(1) 노선, 소량 슬롯 → 0', () => {
    const map = makeMap([[1, 1]]);
    const result = computeRecentFatigue(slots(1, 5), map);
    expect(result).toBe(0);
  });

  // ── 단조성 ──────────────────────────────────────────────────

  it('고피로 노선 근무일 많을수록 점수 높다 (단조성: 일수)', () => {
    const map = makeMap([[1, 5]]);
    const scores = [1, 5, 11, 16, 22].map((n) =>
      computeRecentFatigue(slots(1, n), map),
    );
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i]).toBeGreaterThanOrEqual(scores[i - 1]);
    }
  });

  it('근무일 수 동일, 노선 피로도 높을수록 점수 높다 (단조성: 피로도)', () => {
    const days = 11; // 반월
    const scores = [1, 2, 3, 4, 5].map((fatigue) => {
      const map = makeMap([[1, fatigue]]);
      return computeRecentFatigue(slots(1, days), map);
    });
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i]).toBeGreaterThanOrEqual(scores[i - 1]);
    }
  });

  // ── 미등록 노선 처리 ──────────────────────────────────────────

  it('Map 에 없는 routeId → fatigue=3(중간값)으로 처리된다', () => {
    // routeId=999 는 Map 에 없음
    const result = computeRecentFatigue(slots(999, 22), new Map());
    // avg = 3, base = (3-1)/4*100 = 50, intensity = 1 → 50
    expect(result).toBe(50);
  });

  it('미등록 노선(3) 과 고피로 노선(5) 혼합 → 중간값', () => {
    // routeId=1 → 5, routeId=999 → 없음(→3)
    // 각 11개씩, avg = (5+3)/2 = 4, base=(4-1)/4*100=75, intensity=22/22=1 → 75
    const map = makeMap([[1, 5]]);
    const mixedSlots = [...slots(1, 11), ...slots(999, 11)];
    const result = computeRecentFatigue(mixedSlots, map);
    expect(result).toBe(75);
  });

  // ── 부분 월 (workload intensity 반영) ────────────────────────

  it('고피로 노선(5), 11일 근무(반월) → 약 50', () => {
    const map = makeMap([[1, 5]]);
    // base=100, intensity=11/22=0.5 → 50
    const result = computeRecentFatigue(slots(1, 11), map);
    expect(result).toBe(50);
  });

  it('중간 피로 노선(3), 풀 월(22) → 50', () => {
    const map = makeMap([[1, 3]]);
    // base=(3-1)/4*100=50, intensity=1 → 50
    const result = computeRecentFatigue(slots(1, 22), map);
    expect(result).toBe(50);
  });

  // ── 경계값 ─────────────────────────────────────────────────

  it('1개 슬롯, 중간 피로(3) → 양수, 100 이하', () => {
    const map = makeMap([[1, 3]]);
    const result = computeRecentFatigue(slots(1, 1), map);
    // base=50, intensity=1/22≈0.045 → 50*0.045≈2.27 → round → 2
    expect(result).toBeGreaterThan(0);
    expect(result).toBeLessThanOrEqual(100);
  });

  it('결과는 항상 정수이다', () => {
    const map = makeMap([[1, 4]]);
    const result = computeRecentFatigue(slots(1, 7), map);
    expect(Number.isInteger(result)).toBe(true);
  });

  it('결과는 0~100 범위를 벗어나지 않는다 (다양한 입력)', () => {
    const testCases: Array<[number, number, number]> = [
      [1, 1, 1],
      [5, 5, 30],
      [3, 3, 15],
      [2, 22, 2],
      [4, 22, 4],
    ];
    for (const [fatigue, count, routeId] of testCases) {
      const map = makeMap([[routeId, fatigue]]);
      const result = computeRecentFatigue(slots(routeId, count), map);
      expect(result).toBeGreaterThanOrEqual(0);
      expect(result).toBeLessThanOrEqual(100);
    }
  });
});
