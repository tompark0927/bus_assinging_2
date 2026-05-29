/**
 * 긴급도 분류 단위 테스트.
 *
 * EmergencyAgent 의 가장 중요한 결정: 긴급도 등급. 잘못 분류하면
 * - CRITICAL 을 NORMAL 로 → Top-3 푸시 → 5분 대기 → 출발 시각 지나서 운행 멈춤
 * - NORMAL 을 CRITICAL 로 → 모든 기사 + 관리자 호출 → 알림 피로도 ↑
 *
 * 따라서 경계값(30, 120)에서의 동작이 정확해야 한다.
 */

import { classifyUrgency } from '../../agents/_tools/emergency-tools';

describe('classifyUrgency', () => {
  it('이미 출발한 슬롯 → PASSED', () => {
    expect(classifyUrgency(0)).toBe('PASSED');
    expect(classifyUrgency(-1)).toBe('PASSED');
    expect(classifyUrgency(-60)).toBe('PASSED');
  });

  it('출발 1분 전 → CRITICAL', () => {
    expect(classifyUrgency(1)).toBe('CRITICAL');
  });

  it('출발 정확히 30분 전 → CRITICAL (경계 포함)', () => {
    expect(classifyUrgency(30)).toBe('CRITICAL');
  });

  it('출발 31분 전 → HIGH', () => {
    expect(classifyUrgency(31)).toBe('HIGH');
  });

  it('출발 1시간 전 → HIGH', () => {
    expect(classifyUrgency(60)).toBe('HIGH');
  });

  it('출발 정확히 120분 전 → HIGH (경계 포함)', () => {
    expect(classifyUrgency(120)).toBe('HIGH');
  });

  it('출발 121분 전 → NORMAL', () => {
    expect(classifyUrgency(121)).toBe('NORMAL');
  });

  it('출발 6시간 전 → NORMAL', () => {
    expect(classifyUrgency(360)).toBe('NORMAL');
  });

  it('출발 1주일 전 → NORMAL', () => {
    expect(classifyUrgency(7 * 24 * 60)).toBe('NORMAL');
  });
});
