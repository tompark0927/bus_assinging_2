import type { CompanyPolicy } from '../agents/_solvers/types';

/**
 * 배차 설정(Company.policy) → AI 배차 엔진(Python) 정책 매핑.
 *
 * 두 설정이 따로 놀던 문제를 막는다. 예전에는 [배차 설정]이 TS 솔버
 * (monthly-grid-solver) 전용이라, 담당자가 거기서 근무일수·안전룰을 바꿔도
 * 실제 배차표를 만드는 Python 엔진(/engine/generate)은 자기 저장소의 정책만
 * 읽어 아무 영향이 없었다. 이제 겹치는 항목은 **운영 정책이 단일 소스**이고,
 * 생성·검산 요청마다 여기서 엔진 값으로 변환해 덮어쓴다.
 *
 * 겹치지 않는 항목은 그대로 각자의 주인을 따른다:
 *   - 엔진 전용: 순번 로테이션, 감차 방식·표기, 예비 운영, 공정성 λ,
 *     휴무 자동승낙, 공휴일 캘린더 → [배차 설정 → 엔진 튜닝]
 *   - 엔진이 표현하지 못함(미반영): 1교대/3교대·주 단위 교대(shiftSystem),
 *     승무 모델 SOLO/PAIR/TRIO 인원수(crewModel), 면허·자격 만료 제외,
 *     승인 휴무 배정 금지, 월 최소 주말휴무, 신규기사 단독 금지,
 *     사고 노선 금지 → 엔진은 AM/PM 2교대 짝궁 구조를 전제한다.
 *
 * 매핑은 **기본 프리셋(CITY_2SHIFT)에서 엔진 기본값과 같은 결과**가 나오도록
 * 보수적으로 잡았다 (기존 회사의 생성 결과가 갑자기 달라지지 않게).
 */

/** 운영 정책이 주인인 엔진 키 — 엔진 튜닝 탭에서는 읽기 전용으로 표시한다 */
export const ENGINE_KEYS_OWNED_BY_DISPATCH_SETTINGS = [
  'max_consecutive_enabled',
  'max_consecutive_days',
  'monthly_band_enabled',
  'monthly_work_days',
  'forbid_pm_to_am',
] as const;

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

/**
 * 배차 설정 → 엔진 values 부분집합.
 * 값을 못 정하는 항목은 키를 넣지 않는다 (엔진 저장값·카탈로그 기본값 유지).
 */
export function mapCompanyPolicyToEngineValues(policy: CompanyPolicy): Record<string, unknown> {
  const out: Record<string, unknown> = {};

  // 최대 연속 근무일 — restCycle.workDays(5근2휴의 '5')는 목표 사이클이지
  // 상한이 아니다. 하드 상한은 헌법 룰 weeklyMaxWorkDays 가 맞다.
  const weekly = policy.constitutional?.weeklyMaxWorkDays;
  if (weekly) {
    out.max_consecutive_enabled = !!weekly.enabled;
    if (weekly.enabled && Number.isFinite(weekly.maxDays)) {
      out.max_consecutive_days = clamp(Math.round(weekly.maxDays), 3, 10);
    }
  }

  // 월 근무일수(만근) 범위 — 배차 설정의 하드 밴드를 그대로 쓴다
  const bands = policy.workdayBands;
  if (bands && Number.isFinite(bands.hardMin) && Number.isFinite(bands.hardMax)) {
    out.monthly_band_enabled = true;
    out.monthly_work_days = [
      clamp(Math.round(bands.hardMin), 15, 27),
      clamp(Math.round(bands.hardMax), 15, 27),
    ];
  }

  // 오후 근무 다음날 오전 금지 = 운행 후 최소 휴식 보장(여객자동차법 시행규칙
  // 제44조의6). 엔진에는 시각 개념이 없어 PM→AM 조합 금지로만 표현된다.
  const minRest = policy.constitutional?.minRestBetweenShifts;
  if (minRest) out.forbid_pm_to_am = !!minRest.enabled;

  // 1인 승무·1교대 회사는 '짝궁 오전/오후 교대' 자체가 성립하지 않는다.
  // (2교대 짝궁 회사는 엔진 설정의 교대 규칙을 그대로 둔다)
  if (policy.crewModel?.kind === 'SOLO' || policy.shiftSystem?.kind === 'ONE_SHIFT') {
    out.pair_swap_rule = 'manual';
  }

  return out;
}

export interface EnginePolicyDoc {
  values?: Record<string, unknown>;
  holidays?: string[];
  special_reductions?: [string, string, string][];
  /**
   * 연도별 공휴일 확인 이력 (holidayPolicyService 소관).
   * DB 에만 남는 값이라 mergeEnginePolicy 가 만드는 엔진 요청 본문에는 넣지 않는다.
   */
  holiday_review?: Record<string, unknown>;
}

/**
 * 엔진에 보낼 최종 정책.
 *
 * **저장된 엔진 튜닝 값(`saved.values`)은 더 이상 읽지 않는다** (2026-08-31).
 * 손잡이가 22개나 되니 회사마다 다른 값이 쌓였고, 그 값들이 솔버 가중치와
 * 서로 싸워 달마다 배차표 모양이 달라졌다 — 8월 배차표가 무너진 원인이다.
 * 이제 배차 규칙은 **기본 틀**(엔진 `frame.py`, 13일 계단 사이클)이 정하고,
 * 회사가 고르는 것은 **공휴일**뿐이다.
 *
 * 넘어가는 값은 두 가지뿐:
 *   · 운영 정책이 주인인 법규 항목 (연속근무·월 근무일수·최소 휴식)
 *   · 공휴일·특별감차 (회사가 해마다 확인해 확정한 것)
 */
export function mergeEnginePolicy(
  savedEnginePolicy: EnginePolicyDoc | null | undefined,
  companyPolicy: CompanyPolicy,
): EnginePolicyDoc {
  const saved = savedEnginePolicy ?? {};
  return {
    values: mapCompanyPolicyToEngineValues(companyPolicy),
    holidays: saved.holidays ?? [],
    special_reductions: saved.special_reductions ?? [],
  };
}
