/**
 * 배차 설정 → AI 엔진 정책 매핑
 *
 * 핵심 불변식: **기본 프리셋(CITY_2SHIFT)에서는 엔진 기본값과 같은 결과**여야
 * 한다. 매핑이 붙었다고 기존 회사의 배차표가 갑자기 달라지면 안 된다.
 */
import { POLICY_PRESETS } from '../agents/_solvers/types';
import {
  mapCompanyPolicyToEngineValues,
  mergeEnginePolicy,
} from '../services/enginePolicyMapper';

describe('mapCompanyPolicyToEngineValues', () => {
  it('시내 2교대 프리셋 → 엔진 기본값과 충돌하지 않는 값', () => {
    const v = mapCompanyPolicyToEngineValues(POLICY_PRESETS.CITY_2SHIFT);
    expect(v.max_consecutive_enabled).toBe(true);
    expect(v.max_consecutive_days).toBe(6); // 엔진 카탈로그 기본값과 동일
    expect(v.monthly_band_enabled).toBe(true);
    expect(v.monthly_work_days).toEqual([18, 23]); // 배차 설정의 하드 밴드
    // 시내 2교대 프리셋은 최소 휴식 보장이 켜져 있다 (여객자동차법 시행규칙
    // 제44조의6) — 발행 게이트의 W1 경고와 생성 규칙을 일치시킨다
    expect(v.forbid_pm_to_am).toBe(true);
    expect(v.pair_swap_rule).toBeUndefined(); // 2교대 짝궁은 엔진 설정을 따른다
  });

  it('마을 1교대 프리셋 → 짝궁 교대 없음', () => {
    const v = mapCompanyPolicyToEngineValues(POLICY_PRESETS.VILLAGE_1SHIFT);
    expect(v.pair_swap_rule).toBe('manual');
    expect(v.monthly_work_days).toEqual([22, 27]);
  });

  it('연속근무 상한은 3~10일로 클램프한다', () => {
    const p = {
      ...POLICY_PRESETS.CITY_2SHIFT,
      constitutional: {
        ...POLICY_PRESETS.CITY_2SHIFT.constitutional,
        weeklyMaxWorkDays: { enabled: true, maxDays: 99 },
      },
    };
    expect(mapCompanyPolicyToEngineValues(p).max_consecutive_days).toBe(10);
  });

  it('규칙을 끄면 엔진에서도 꺼진다', () => {
    const p = {
      ...POLICY_PRESETS.CITY_2SHIFT,
      constitutional: {
        ...POLICY_PRESETS.CITY_2SHIFT.constitutional,
        weeklyMaxWorkDays: { enabled: false, maxDays: 6 },
        minRestBetweenShifts: { enabled: false, minHours: 8 },
      },
    };
    const v = mapCompanyPolicyToEngineValues(p);
    expect(v.max_consecutive_enabled).toBe(false);
    expect(v.max_consecutive_days).toBeUndefined(); // 꺼졌으면 값은 건드리지 않는다
    expect(v.forbid_pm_to_am).toBe(false);
  });
});

describe('mergeEnginePolicy', () => {
  it('엔진 고유 설정·공휴일은 보존하고 겹치는 키만 덮어쓴다', () => {
    const saved = {
      values: { rotation_step: -1, fairness_lambda: 7, monthly_work_days: [20, 23] },
      holidays: ['2026-08-15'],
      special_reductions: [['2026-09-01', '2026-09-03', '아시아드'] as [string, string, string]],
    };
    const merged = mergeEnginePolicy(saved, POLICY_PRESETS.CITY_2SHIFT);
    expect(merged.values?.rotation_step).toBe(-1);
    expect(merged.values?.fairness_lambda).toBe(7);
    expect(merged.values?.monthly_work_days).toEqual([18, 23]); // 배차 설정이 이긴다
    expect(merged.holidays).toEqual(['2026-08-15']);
    expect(merged.special_reductions).toHaveLength(1);
  });

  it('엔진에 저장된 정책이 없어도 배차 설정만으로 만들어진다', () => {
    const merged = mergeEnginePolicy(null, POLICY_PRESETS.CITY_2SHIFT);
    expect(merged.values?.monthly_work_days).toEqual([18, 23]);
    expect(merged.holidays).toEqual([]);
  });
});
