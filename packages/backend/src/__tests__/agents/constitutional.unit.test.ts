/**
 * Constitutional Rules 단위 테스트 (DB 불필요).
 *
 * 12개 절대 금지 규칙이 정확한 시점에 위반을 잡아내는지 검증.
 * 이 검증기는 도구 호출 시점에 BaseAgent 가 호출하므로, AI 환각으로 위반 시도가 와도
 * 시스템이 막아야 함 — 사람 안전과 노동법 준수의 마지막 방어선.
 */

import {
  checkConstitutional,
  CONSTITUTIONAL_RULE_NAMES,
  type ConstitutionalContext,
} from '../../agents/_core/constitutional';

const NOW = new Date('2026-04-10T08:00:00Z');

function ctx(overrides: Partial<ConstitutionalContext>): ConstitutionalContext {
  return {
    action: 'assign_slot',
    now: NOW,
    ...overrides,
  };
}

describe('Constitutional Rules', () => {
  it('규칙 12개가 모두 정의되어 있다', () => {
    expect(CONSTITUTIONAL_RULE_NAMES).toHaveLength(12);
  });

  describe('R1: 야간 4일 연속 금지', () => {
    it('연속 3일 야간은 통과', () => {
      const result = checkConstitutional(
        ctx({
          driverUpcomingShifts: [
            { date: new Date('2026-04-10'), shift: 'NIGHT' },
            { date: new Date('2026-04-11'), shift: 'NIGHT' },
            { date: new Date('2026-04-12'), shift: 'NIGHT' },
          ],
        })
      );
      expect(result).toBeNull();
    });

    it('연속 4일 야간은 위반', () => {
      const result = checkConstitutional(
        ctx({
          driverUpcomingShifts: [
            { date: new Date('2026-04-10'), shift: 'NIGHT' },
            { date: new Date('2026-04-11'), shift: 'NIGHT' },
            { date: new Date('2026-04-12'), shift: 'NIGHT' },
            { date: new Date('2026-04-13'), shift: 'NIGHT' },
          ],
        })
      );
      expect(result?.rule).toBe('no_four_consecutive_nights');
    });

    it('중간에 OFF 가 끼어 있으면 streak 리셋', () => {
      const result = checkConstitutional(
        ctx({
          driverUpcomingShifts: [
            { date: new Date('2026-04-10'), shift: 'NIGHT' },
            { date: new Date('2026-04-11'), shift: 'NIGHT' },
            { date: new Date('2026-04-12'), shift: 'OFF' },
            { date: new Date('2026-04-13'), shift: 'NIGHT' },
            { date: new Date('2026-04-14'), shift: 'NIGHT' },
          ],
        })
      );
      expect(result).toBeNull();
    });
  });

  describe('R2: 주 52시간 상한', () => {
    it('주 40시간 (5일 × 8시간) 은 통과', () => {
      const shifts = Array.from({ length: 5 }, (_, i) => ({
        date: new Date(NOW.getTime() + i * 24 * 3600 * 1000),
        shift: 'FULL_DAY' as const,
        durationHours: 8,
      }));
      expect(checkConstitutional(ctx({ driverUpcomingShifts: shifts }))).toBeNull();
    });

    it('주 56시간 (7일 × 8시간) 은 위반', () => {
      const shifts = Array.from({ length: 7 }, (_, i) => ({
        date: new Date(NOW.getTime() + i * 24 * 3600 * 1000),
        shift: 'FULL_DAY' as const,
        durationHours: 8,
      }));
      const result = checkConstitutional(ctx({ driverUpcomingShifts: shifts }));
      expect(result?.rule).toBe('weekly_52h_cap');
    });
  });

  describe('R3: 단일 슬롯 9시간 초과 금지 (운행 4h 특례 대리 검증)', () => {
    it('8시간 슬롯은 통과', () => {
      expect(
        checkConstitutional(
          ctx({
            driverUpcomingShifts: [
              { date: NOW, shift: 'FULL_DAY', durationHours: 8 },
            ],
          })
        )
      ).toBeNull();
    });

    it('10시간 슬롯은 위반', () => {
      const result = checkConstitutional(
        ctx({
          driverUpcomingShifts: [
            { date: NOW, shift: 'FULL_DAY', durationHours: 10 },
          ],
        })
      );
      expect(result?.rule).toBe('continuous_driving_4h');
    });
  });

  describe('R5: 승인된 휴무일에 배차 금지', () => {
    it('휴무 신청 승인된 날에 배차 시도 → 위반', () => {
      const dayoff = new Date('2026-04-12');
      const result = checkConstitutional(
        ctx({
          approvedDayoffs: [dayoff],
          driverUpcomingShifts: [{ date: dayoff, shift: 'FULL_DAY' }],
        })
      );
      expect(result?.rule).toBe('no_assign_on_approved_dayoff');
    });
  });

  describe('R6: 만료된 면허 기사 배차 금지', () => {
    it('어제 만료 → 위반', () => {
      const result = checkConstitutional(
        ctx({
          driverLicense: {
            licenseExpiresAt: new Date(NOW.getTime() - 24 * 3600 * 1000),
          },
        })
      );
      expect(result?.rule).toBe('no_expired_license');
    });

    it('내일 만료 → 통과 (오늘은 유효)', () => {
      const result = checkConstitutional(
        ctx({
          driverLicense: {
            licenseExpiresAt: new Date(NOW.getTime() + 24 * 3600 * 1000),
          },
        })
      );
      expect(result).toBeNull();
    });
  });

  describe('R8: 같은 노선 모든 기사 동시 휴무 금지', () => {
    it('5명 중 5명 휴무 → 위반', () => {
      const result = checkConstitutional(
        ctx({ routeDayoffCoverage: { totalDrivers: 5, offDrivers: 5 } })
      );
      expect(result?.rule).toBe('no_full_route_dayoff');
    });

    it('5명 중 4명 휴무 → 통과 (1명이 운행 가능)', () => {
      const result = checkConstitutional(
        ctx({ routeDayoffCoverage: { totalDrivers: 5, offDrivers: 4 } })
      );
      expect(result).toBeNull();
    });
  });

  describe('R10: 신규 기사 첫 주 단독 배차 금지', () => {
    it('입사 3일차 + assign_slot → 위반', () => {
      const result = checkConstitutional(
        ctx({ action: 'assign_slot', driverDaysSinceHire: 3 })
      );
      expect(result?.rule).toBe('no_solo_first_week');
    });

    it('입사 8일차 → 통과', () => {
      const result = checkConstitutional(
        ctx({ action: 'assign_slot', driverDaysSinceHire: 8 })
      );
      expect(result).toBeNull();
    });
  });

  describe('R12: 발행된 배차표 변경 불가 (긴급 결원 제외)', () => {
    it('발행 후 일반 modify → 위반', () => {
      const result = checkConstitutional(
        ctx({ action: 'modify_slot', scheduleAlreadyPublished: true })
      );
      expect(result?.rule).toBe('published_schedule_immutable');
    });

    it('발행 후 긴급 오버라이드 → 통과', () => {
      const result = checkConstitutional(
        ctx({
          action: 'modify_slot',
          scheduleAlreadyPublished: true,
          isEmergencyOverride: true,
        })
      );
      expect(result).toBeNull();
    });
  });

  describe('정상 케이스', () => {
    it('아무 위반 신호도 없으면 null', () => {
      expect(checkConstitutional(ctx({}))).toBeNull();
    });
  });
});
