/**
 * 단위 테스트 — computeCarryOverPattern 순수 헬퍼
 *
 * DB·솔버 없이 순수 함수만 검증.
 *
 * 검증 항목:
 *   1. 슬롯 없음 → undefined
 *   2. 연속 근무일 카운트 (prevMonthEnd 에서 역방향)
 *   3. 중간에 휴무가 있으면 스트릭이 끊김
 *   4. lastShift — 마지막 근무일 슬롯 (PM 우선)
 *   5. lastWeekDominantShift — 마지막 7일 중 AM/PM 빈도 비교
 */
import { computeCarryOverPattern } from '../services/solverDispatchService';

// 헬퍼: 슬롯 생성 (isRestDay 기본 false = 근무)
function slot(date: string, shift: string, isRestDay = false) {
  return { date, shift, isRestDay };
}

describe('computeCarryOverPattern', () => {
  // ── 기본 케이스 ─────────────────────────────────────────────

  it('슬롯이 없으면 undefined 를 반환한다', () => {
    expect(computeCarryOverPattern([], '2026-01-31')).toBeUndefined();
  });

  // ── consecutiveWorkDays ──────────────────────────────────────

  it('prevMonthEnd 까지 4일 연속 근무 → consecutiveWorkDays=4', () => {
    const slots = [
      slot('2026-01-28', 'AM'),
      slot('2026-01-29', 'AM'),
      slot('2026-01-30', 'PM'),
      slot('2026-01-31', 'AM'),
    ];
    const result = computeCarryOverPattern(slots, '2026-01-31');
    expect(result).toBeDefined();
    expect(result!.consecutiveWorkDays).toBe(4);
  });

  it('prevMonthEnd 당일만 근무 → consecutiveWorkDays=1', () => {
    const slots = [
      slot('2026-01-29', 'AM'), // 그냥 앞날짜는 없음 (휴무)
      slot('2026-01-31', 'PM'),
    ];
    // Jan 30 에 슬롯 없음 → 스트릭 끊김
    const result = computeCarryOverPattern(slots, '2026-01-31');
    expect(result).toBeDefined();
    expect(result!.consecutiveWorkDays).toBe(1);
  });

  it('중간에 휴무(isRestDay=true) 가 있으면 연속 스트릭이 끊긴다', () => {
    const slots = [
      slot('2026-01-26', 'AM'),
      slot('2026-01-27', 'AM'),
      slot('2026-01-28', 'AM', true), // 휴무 — 스트릭 끊김
      slot('2026-01-29', 'PM'),
      slot('2026-01-30', 'AM'),
      slot('2026-01-31', 'PM'),
    ];
    const result = computeCarryOverPattern(slots, '2026-01-31');
    expect(result).toBeDefined();
    // Jan 28 이 휴무이므로 29, 30, 31 만 연속 → 3
    expect(result!.consecutiveWorkDays).toBe(3);
  });

  it('슬롯이 있어도 prevMonthEnd 당일이 휴무면 consecutiveWorkDays=0', () => {
    const slots = [
      slot('2026-01-30', 'AM'),
      slot('2026-01-31', 'AM', true), // 마지막 날 휴무
    ];
    const result = computeCarryOverPattern(slots, '2026-01-31');
    expect(result).toBeDefined();
    expect(result!.consecutiveWorkDays).toBe(0);
  });

  it('prevMonthEnd 에 슬롯이 아예 없으면 consecutiveWorkDays=0', () => {
    const slots = [
      slot('2026-01-28', 'AM'),
      slot('2026-01-29', 'AM'),
      slot('2026-01-30', 'AM'),
      // Jan 31 슬롯 없음
    ];
    const result = computeCarryOverPattern(slots, '2026-01-31');
    expect(result).toBeDefined();
    expect(result!.consecutiveWorkDays).toBe(0);
  });

  // ── lastShift ────────────────────────────────────────────────

  it('마지막 근무일의 시프트가 lastShift 가 된다', () => {
    const slots = [
      slot('2026-01-29', 'AM'),
      slot('2026-01-30', 'PM'),
      slot('2026-01-31', 'AM'),
    ];
    const result = computeCarryOverPattern(slots, '2026-01-31');
    expect(result!.lastShift).toBe('AM');
  });

  it('마지막 근무일에 AM 과 PM 이 모두 있으면 PM 을 선택한다', () => {
    const slots = [
      slot('2026-01-31', 'AM'),
      slot('2026-01-31', 'PM'),
    ];
    const result = computeCarryOverPattern(slots, '2026-01-31');
    expect(result!.lastShift).toBe('PM');
  });

  it('마지막 슬롯이 휴무이면 lastShift=null', () => {
    const slots = [
      slot('2026-01-30', 'PM'),
      slot('2026-01-31', 'AM', true), // 휴무
    ];
    const result = computeCarryOverPattern(slots, '2026-01-31');
    expect(result!.lastShift).toBeNull();
  });

  it('prevMonthEnd 에 슬롯 없으면 lastShift=null', () => {
    const slots = [
      slot('2026-01-30', 'PM'),
      // Jan 31 없음
    ];
    const result = computeCarryOverPattern(slots, '2026-01-31');
    expect(result!.lastShift).toBeNull();
  });

  // ── lastWeekDominantShift ────────────────────────────────────

  it('마지막 7일에 AM 5회 PM 2회 → AM', () => {
    const slots = [
      slot('2026-01-25', 'AM'),
      slot('2026-01-26', 'AM'),
      slot('2026-01-27', 'AM'),
      slot('2026-01-28', 'PM'),
      slot('2026-01-29', 'AM'),
      slot('2026-01-30', 'PM'),
      slot('2026-01-31', 'AM'),
    ];
    const result = computeCarryOverPattern(slots, '2026-01-31');
    expect(result!.lastWeekDominantShift).toBe('AM');
  });

  it('마지막 7일에 AM 3회 PM 3회 → MIXED (동점)', () => {
    const slots = [
      slot('2026-01-25', 'AM'),
      slot('2026-01-26', 'PM'),
      slot('2026-01-28', 'AM'),
      slot('2026-01-29', 'PM'),
      slot('2026-01-30', 'AM'),
      slot('2026-01-31', 'PM'),
    ];
    const result = computeCarryOverPattern(slots, '2026-01-31');
    expect(result!.lastWeekDominantShift).toBe('MIXED');
  });

  it('마지막 7일에 PM 4회 AM 1회 → PM', () => {
    const slots = [
      slot('2026-01-27', 'AM'),
      slot('2026-01-28', 'PM'),
      slot('2026-01-29', 'PM'),
      slot('2026-01-30', 'PM'),
      slot('2026-01-31', 'PM'),
    ];
    const result = computeCarryOverPattern(slots, '2026-01-31');
    expect(result!.lastWeekDominantShift).toBe('PM');
  });

  it('마지막 7일에 근무 슬롯이 없으면 lastShift 로 폴백', () => {
    // 전월 초에만 슬롯이 있고, 마지막 7일(25~31)은 비어있음
    // 단, lastShift 는 마지막 근무일 기반이므로 Jan 20 → AM
    const slots = [
      slot('2026-01-15', 'AM'),
      slot('2026-01-18', 'PM'),
      slot('2026-01-20', 'AM'),
    ];
    const result = computeCarryOverPattern(slots, '2026-01-31');
    expect(result).toBeDefined();
    // 마지막 7일 슬롯 없음 → lastShift('AM') 로 폴백
    expect(result!.lastWeekDominantShift).toBe('AM');
  });

  it('마지막 7일 슬롯도 없고 lastShift 도 null 이면 MIXED', () => {
    // 유일한 슬롯이 휴무이고 마지막 7일 이전에 있는 경우
    const slots = [
      slot('2026-01-15', 'AM', true), // 휴무
    ];
    const result = computeCarryOverPattern(slots, '2026-01-31');
    expect(result).toBeDefined();
    expect(result!.lastWeekDominantShift).toBe('MIXED');
  });

  // ── 슬롯 정렬 무관 ────────────────────────────────────────────

  it('슬롯 순서가 뒤섞여 있어도 올바르게 처리한다', () => {
    const slots = [
      slot('2026-01-31', 'PM'),
      slot('2026-01-28', 'AM'),
      slot('2026-01-29', 'AM'),
      slot('2026-01-30', 'AM'),
    ];
    const result = computeCarryOverPattern(slots, '2026-01-31');
    expect(result!.consecutiveWorkDays).toBe(4);
    expect(result!.lastShift).toBe('PM');
  });
});
