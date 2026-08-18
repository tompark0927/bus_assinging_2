/**
 * Stage 3 v3 — 일별 시프트 그리드 솔버 (정책 외부화 완료, Stage 1).
 *
 * 정책 기반 동작:
 *   - 회사 정책: input.policy (workdayBands + restCycle)
 *   - 운전자 override: driver.workDayTarget (NEW_HIRE 등 예외만 설정)
 *   - 미지정 시 DEFAULT_POLICY (CITY_2SHIFT = 성민버스 패턴) 사용 → 백워드 호환
 *
 * 운영 모델 (현재는 페어 + 2교대만, Stage 2 에서 일반화 예정):
 *   - 운전자 단일 풀 (MAIN/SPARE 구분 없음)
 *   - 페어 = 한 차량의 주 운전자 2명 (매일 동시 출근 X)
 *   - 휴무 사이클: policy.restCycle (5/2, 6/1 등)
 *   - 주간 슬롯 교대: 한 주 AM 위주 → 다음 주 PM 위주 (소프트, 공정성)
 *   - 노선 이동 거의 없음 (요청·특수상황만)
 *
 * 알고리즘:
 *   Phase A — 운전자별 휴무 패턴 사전 생성 (restCycle 기반 offset rotation)
 *   Phase B — 운행 슬롯 채우기: HOME → SAME_ROUTE → CROSS_ROUTE 순
 *   Phase C — 로컬 서치 (공정성 + 주간 슬롯 일관성 개선)
 */

import {
  checkAssignment,
  countWeekendDays,
  formatDate,
  isWeekend,
  parseDate,
  validateFullGrid,
  wouldViolateGridRules,
  type ConstraintContext,
} from './constraints';
import {
  DEFAULT_POLICY,
  DEFAULT_WEIGHTS,
  type AssignedSlot,
  type CompanyPolicy,
  type ConstitutionalViolation,
  type DriverWorkload,
  type Familiarity,
  type RestCyclePolicy,
  type ShiftSlot,
  type ShiftSystemPolicy,
  type SolverBus,
  type SolverCrew,
  type SolverDriver,
  type SolverInput,
  type SolverMetrics,
  type SolverOutput,
  type SolverPartnership,
  type SolverWeights,
  type UnfilledSlot,
  type WorkloadEvaluation,
} from './types';
import { buildCyclicRoster, supportsCyclicRoster } from './cyclic-roster';
import { createRng, type Rng } from '../../utils/seededRng';

// ─────────────────────────────────────────────
// 근무일수 평가 (tiered, 정책 기반)
// ─────────────────────────────────────────────
//
// 우선순위:
//   1. driver.workDayTarget 이 있으면 그 운전자만의 범위 사용
//   2. 없으면 회사 policy.workdayBands 사용
//
// tier:
//   SWEET_SPOT      — [softMin, softMax]                    무페널티
//   ACCEPTABLE_LOW  — [hardMin, softMin-1]                  belowSweetPenalty
//   ACCEPTABLE_HIGH — [softMax+1, hardMax]                  aboveSweetPenalty
//   UNDER_MIN       — < hardMin (exemptReason 없을 때)      hard violation
//   OVER_MAX        — > hardMax (면제 무관)                  hard violation
//   EXEMPTED        — < hardMin + driver.exemptReason 있음  무페널티

const HARD_VIOLATION_PENALTY = 1e9; // local search 가 사실상 거부할 큰 finite 값

/** localSearch 기본 시드 (randomSeed 미지정 시). 고정값이라 프로덕션도 동일 입력 → 동일 결과. */
const DEFAULT_SOLVER_SEED = 1234567;

/**
 * 운전자에게 적용되는 effective bands.
 *
 * 우선순위:
 *   - driver.workDayTarget 이 있으면 그 값 (모든 필드)
 *   - 없으면 policy.workdayBands
 *
 * 페널티 강도(belowSweetPenalty/aboveSweetPenalty)는 항상 회사 정책 사용.
 *
 * exemptReason 은 별개로 처리 — workDays < 회사 hardMin 일 때만 발동
 * (즉 "회사 기준으로는 UNDER_MIN 인데 exempted=true 로 면제" 의미).
 */
function resolveEffectiveBands(
  driver: SolverDriver,
  policy: CompanyPolicy,
): {
  hardMin: number;
  hardMax: number;
  softMin: number;
  softMax: number;
} {
  const bands = policy.workdayBands;
  const override = driver.workDayTarget;
  if (override) {
    return {
      hardMin: override.min,
      hardMax: override.max,
      softMin: override.softMin,
      softMax: override.softMax,
    };
  }
  return {
    hardMin: bands.hardMin,
    hardMax: bands.hardMax,
    softMin: bands.sweetMin,
    softMax: bands.sweetMax,
  };
}

export function evaluateWorkload(
  driver: SolverDriver,
  workDays: number,
  policy: CompanyPolicy = DEFAULT_POLICY,
): WorkloadEvaluation {
  const eff = resolveEffectiveBands(driver, policy);
  const bands = policy.workdayBands;
  const override = driver.workDayTarget;
  const appliedRange = { min: eff.hardMin, max: eff.hardMax };
  const appliedSweetRange = { min: eff.softMin, max: eff.softMax };

  // exemptReason 은 회사 정책 기준 UNDER_MIN 일 때만 발동
  // (운전자 본인 effective bands 안에 들어와도 exemptReason 만으로는 면제 표시 안 함 —
  //  override 의 min/max 가 이미 적정 범위를 정의했으므로 별도 면제 불필요)
  const wouldBeUnderCompany = workDays < bands.hardMin;
  const hasExemption = !!override?.exemptReason && wouldBeUnderCompany;

  // OVER_MAX — 면제 불가 (노동법·안전 마지노선, 항상 effective hardMax 적용)
  if (workDays > eff.hardMax) {
    return {
      tier: 'OVER_MAX',
      hardViolation: true,
      softPenalty: HARD_VIOLATION_PENALTY,
      exempted: false,
      appliedRange,
      appliedSweetRange,
    };
  }

  // UNDER_MIN — effective hardMin 미만
  if (workDays < eff.hardMin) {
    // override.exemptReason 있으면 면제 (effective hardMin 도 통과 못한 경우도 포함)
    if (override?.exemptReason) {
      return {
        tier: 'UNDER_MIN',
        hardViolation: false,
        softPenalty: 0,
        exempted: true,
        exemptionReason: override.exemptReason,
        exemptionNote: override.exemptNote,
        appliedRange,
        appliedSweetRange,
      };
    }
    return {
      tier: 'UNDER_MIN',
      hardViolation: true,
      softPenalty: HARD_VIOLATION_PENALTY,
      exempted: false,
      appliedRange,
      appliedSweetRange,
    };
  }

  // 이하 effective bands 안 — tier 는 effective 기준
  // SWEET_SPOT
  if (workDays >= eff.softMin && workDays <= eff.softMax) {
    return {
      tier: 'SWEET_SPOT',
      hardViolation: false,
      softPenalty: 0,
      exempted: hasExemption,
      exemptionReason: hasExemption ? override!.exemptReason : undefined,
      exemptionNote: hasExemption ? override!.exemptNote : undefined,
      appliedRange,
      appliedSweetRange,
    };
  }

  // ACCEPTABLE_LOW: [hardMin, softMin-1]
  if (workDays < eff.softMin) {
    return {
      tier: 'ACCEPTABLE_LOW',
      hardViolation: false,
      // exempted 면 페널티 0, 아니면 sweet 거리 × belowSweetPenalty
      softPenalty: hasExemption ? 0 : bands.belowSweetPenalty * (eff.softMin - workDays),
      exempted: hasExemption,
      exemptionReason: hasExemption ? override!.exemptReason : undefined,
      exemptionNote: hasExemption ? override!.exemptNote : undefined,
      appliedRange,
      appliedSweetRange,
    };
  }

  // ACCEPTABLE_HIGH: [softMax+1, hardMax]
  return {
    tier: 'ACCEPTABLE_HIGH',
    hardViolation: false,
    softPenalty: bands.aboveSweetPenalty * (workDays - eff.softMax),
    exempted: false,
    appliedRange,
    appliedSweetRange,
  };
}

// ─────────────────────────────────────────────
// Public entry
// ─────────────────────────────────────────────

export function solveMonthlyGrid(input: SolverInput): SolverOutput {
  const weights = input.weights ?? DEFAULT_WEIGHTS;
  const policy = input.policy ?? DEFAULT_POLICY;
  const restCycle = policy.restCycle;
  const monthStart = new Date(Date.UTC(input.year, input.month - 1, 1));
  const monthEnd = new Date(Date.UTC(input.year, input.month, 0));
  const days = enumerateDays(monthStart, monthEnd);

  const driverMap = new Map<number, SolverDriver>(
    input.drivers.map((d) => [d.id, d]),
  );
  const ctx: ConstraintContext = {
    drivers: driverMap,
    driverSlots: new Map(),
  };

  // 차량 → crew 매핑 (Stage 1 partnerships 와 Stage 2 crews 둘 다 지원)
  const crews = normalizeToCrews(input);
  validateCrewModel(crews, policy);
  const crewByBus = new Map<number, SolverCrew>(crews.map((c) => [c.busId, c]));
  // 운전자 → homeBusId, homeRouteId
  const homeBusByDriver = new Map<number, number>();
  const homeRouteByDriver = new Map<number, number>();
  for (const d of input.drivers) {
    if (d.homeBusId !== undefined) homeBusByDriver.set(d.id, d.homeBusId);
    if (d.homeRouteId !== undefined) homeRouteByDriver.set(d.id, d.homeRouteId);
  }
  // 노선별 운전자 풀 (homeRoute 기준)
  const driversByRoute = new Map<number, SolverDriver[]>();
  for (const d of input.drivers) {
    if (d.homeRouteId === undefined) continue;
    const arr = driversByRoute.get(d.homeRouteId) ?? [];
    arr.push(d);
    driversByRoute.set(d.homeRouteId, arr);
  }

  // ── 순환 근무표 경로 (2교대 + 짝꿍) ───
  //
  // 짤 수 있는 구조라면 하루씩 그리디로 채우지 않고, "누가 며칠 일하고 며칠
  // 쉬나"를 먼저 확정한 뒤 그 위에 시프트를 얹는다. 연속 근무일 안에서
  // 시프트가 바뀌는 일이 구조적으로 없어지고, 오후→다음날 오전(법 제44조의6
  // 연속 휴식 8시간을 위협하는 조합)도 나오지 않는다. cyclic-roster.ts 참고.
  if (supportsCyclicRoster(policy, crews)) {
    const roster = buildCyclicRoster({
      days,
      drivers: input.drivers,
      buses: input.buses,
      crews,
      policy,
      ctx,
    });
    // 로컬 서치는 돌리지 않는다 — SWAP 은 시프트가 같은 슬롯끼리만 바꾸지만
    // 근무 블록의 경계를 흐트러뜨려, 방금 세운 5일 블록 구조를 깎아먹는다.
    const violations = validateFullGrid(input.drivers, roster.slots, monthStart, monthEnd, policy);
    const workloads = computeWorkloads(input.drivers, roster.slots, policy);
    const metrics = computeMetrics(workloads, roster.slots, violations, roster.unfilled, 0, weights, restCycle);
    const summary = renderSummary(input, metrics, workloads, roster.unfilled);
    const restingByDate: Record<string, number[]> = {};
    for (const [date, busIds] of roster.restingByDate) restingByDate[date] = busIds;
    return { slots: roster.slots, unfilled: roster.unfilled, workloads, metrics, summary, restingByDate };
  }

  // ── Phase A: 운전자별 휴무 패턴 사전 생성 ───
  // restCycle 기반 사이클 (5/2, 6/1 등). 운전자별 시작 offset 을 다르게 해서
  // 같은 차량의 페어가 동시에 휴무 안 되도록 분산.
  const restPlan = buildRestPlan(input.drivers, days, restCycle, input.buses, monthStart);

  // ── Phase B: 일별 슬롯 채우기 ───
  const slots: AssignedSlot[] = [];
  const unfilled: UnfilledSlot[] = [];

  for (const day of days) {
    const dayOfWeek = parseDate(day).getUTCDay();

    for (const bus of input.buses) {
      // 운휴 처리
      if (bus.operatingDates && !bus.operatingDates.includes(day)) continue;

      const crew = crewByBus.get(bus.id);
      if (!crew) continue;

      // 격일제: 차량별 운행일 사이클 (busId + day 의 패리티로 결정)
      if (policy.shiftSystem.kind === 'ALTERNATING_DAY') {
        const period = policy.shiftSystem.periodDays;
        const dayIdx = Math.floor(
          (parseDate(day).getTime() - monthStart.getTime()) / (24 * 60 * 60 * 1000),
        );
        if ((dayIdx + bus.id) % period !== 0) continue;
      }

      // 그날 그 차의 정책별 슬롯 채우기
      const slotsToday = policy.shiftSystem.slots.map((shift) => ({
        shift: shift as ShiftSlot,
        date: day,
        busId: bus.id,
        routeId: bus.routeId,
      }));

      for (const s of slotsToday) {
        const pickResult = pickDriver({
          slot: s,
          ctx,
          crew,
          driversByRoute,
          allDrivers: input.drivers,
          restPlan,
          restCycle,
          policy,
          monthStart,
          monthEnd,
        });

        if (pickResult.driver) {
          const fam = familiarityFor(pickResult.driver, s.busId, s.routeId);
          addSlot(ctx, slots, {
            date: s.date,
            busId: s.busId,
            routeId: s.routeId,
            shift: s.shift,
            driverId: pickResult.driver.id,
            familiarity: fam.familiarity,
            isHomeBus: fam.isHomeBus,
          });
        } else {
          unfilled.push({
            date: s.date,
            busId: s.busId,
            routeId: s.routeId,
            shift: s.shift,
            reason: pickResult.reason,
          });
        }
      }
    }
  }

  // ── Phase C: 로컬 서치 ───
  const iterations = input.localSearchIterations ?? 1000;
  const searchRng = createRng(input.randomSeed ?? DEFAULT_SOLVER_SEED);
  const swaps = localSearch(ctx, slots, unfilled, input.drivers, weights, restCycle, policy, iterations, monthStart, searchRng, monthEnd, restPlan);

  // ── 메트릭 ───
  const violations = validateFullGrid(input.drivers, slots, monthStart, monthEnd, policy);
  const workloads = computeWorkloads(input.drivers, slots, policy);
  const metrics = computeMetrics(workloads, slots, violations, unfilled, swaps, weights, restCycle);
  const summary = renderSummary(input, metrics, workloads, unfilled);

  return { slots, unfilled, workloads, metrics, summary };
}

// ─────────────────────────────────────────────
// Phase A: 휴무 패턴 사전 생성
// ─────────────────────────────────────────────

interface RestPlan {
  /** driverId → Set<date(YYYY-MM-DD)> (계획 휴무일) */
  restDays: Map<number, Set<string>>;
  /**
   * driverId → date → 그날 맡을 시프트 (담당 차량이 있는 기사만).
   *
   * 휴무 패턴을 확정한 뒤 그 위에 시프트를 얹는 2단계의 결과다. 한 근무
   * 블록은 같은 시프트로 가고, 휴무를 지나면 반대로 바꾼다 — 짝꿍은 서로
   * 반대 시프트라 한 차의 오전·오후가 자연히 채워진다.
   * 스페어는 계획을 두지 않는다. 빈자리를 메우는 역할이라 그날 필요한
   * 시프트를 따라가야 하기 때문이다.
   */
  plannedShift: Map<number, Map<string, ShiftSlot>>;
}

/**
 * 운전자마다 휴무 사이클 패턴을 생성.
 *
 * 핵심 원칙: 같은 날 너무 많은 운전자가 동시에 휴무 X.
 * 노선 단위로 모든 운전자(HOME + SPARE)에게 시간차 offset 부여.
 *
 * 알고리즘:
 *   1. 노선별 그룹화 (homeRouteId)
 *   2. 노선 내 운전자 정렬: (homeBusId 있음 우선, 그 다음 spare) → 안정 정렬
 *   3. 노선 운전자 N명에게 offset i × cycleLen / N 분배
 *      → 매일 ~ N/cycleLen 명 휴무 (균등)
 *   4. PAIR/TRIO 인 경우 같은 차의 두/세 운전자가 인접 offset 으로 가지 않도록
 *      bus 단위 stride 적용 (driverIdxInCrew × cycleLen/crewSize)
 *
 * 예 — VILLAGE_1SHIFT (8 SOLO + 4 spare, cycleLen=7):
 *   12 운전자 → offset 0,0,1,1,2,2,3,3,4,4,5,6 (균등 분포)
 *   → 매일 ~12/7 ≈ 1.7명 휴무 / 8 차량 → 최소 2명 가용 → 미배정 거의 0
 *
 * 예 — CITY_2SHIFT (8 PAIR + 4 spare, cycleLen=7):
 *   16 home + 4 spare = 20 → offset 0..6 균등 + 페어 내 cycleLen/2 stride
 *   → 매일 ~3명 휴무, 한 차의 페어 둘이 동시 휴무 X
 */
/** 수요 기반 휴무 계획의 운전자 상태 */
interface RestState {
  runLen: number;   // 현재 연속 근무일
  restLeft: number; // 남은 연속 휴무일
  work: number;     // 누적 근무일
  rest: number;     // 누적 휴무일
}

/**
 * 휴무 계획 — "누가 언제 쉬는가".
 *
 * 표준 rostering 은 휴무 패턴을 먼저 확정하고 그 위에 시프트를 얹는다
 * (Er-Rbib et al. 2021 'fixed days off'; Optibus rostering). 여기가 그 1단계다.
 *
 * 핵심은 **그날 실제로 필요한 인원에 휴무 인원을 맞추는 것**이다. 요일별
 * 운행 대수 때문에 하루에 필요한 사람 수가 달라지는데(성민: 평일 72 / 토 66 /
 * 일 60명), 휴무를 전원 5/2 고정으로 잡으면 슬롯이 적은 날 계획에 없던 사람이
 * 강제로 쉬게 되고 5일 근무 블록이 3일+1일로 잘린다.
 *
 * 규칙:
 *   · 그날 쉬어야 할 인원 = max(전체 - 필요 인원, 사이클상 반드시 쉬어야 할 사람)
 *   · 쉴 사람은 연속 근무가 긴 사람부터 (쉴 자격을 먼저 얻은 순서)
 *   · 짝꿍이 이미 쉬는 날은 피한다 — 한 차의 두 기사가 같이 빠지면 그 차를
 *     통째로 남에게 맡겨야 한다
 *   · 한 번 쉬기 시작하면 연속 휴무일을 채운다 (2일 붙여 쉬기)
 * 운행 계획이 없으면(전 차량 매일 운행) 필요 인원이 무한대가 되어 사이클
 * 그대로 동작한다 — 기존 동작과 같다.
 */
function buildRestPlan(
  drivers: SolverDriver[],
  days: string[],
  restCycle: RestCyclePolicy,
  buses: SolverBus[] | undefined,
  monthStart: Date,
): RestPlan {
  const cycleLen = restCycle.workDays + restCycle.restDays;
  const restDays = new Map<number, Set<string>>();
  const plannedShift = new Map<number, Map<string, ShiftSlot>>();
  const crewIndex = new Map<number, number>(); // driverId → 차량 내 순번(0=정, 1=부)

  // ── 노선별 일일 필요 인원 = 그날 운행 차량 수 × 2교대 ──
  const demand = new Map<number, Map<string, number>>();
  for (const b of buses ?? []) {
    const per = demand.get(b.routeId) ?? new Map<string, number>();
    const runs = b.operatingDates ? new Set(b.operatingDates) : null;
    for (const d of days) {
      if (runs && !runs.has(d)) continue;
      per.set(d, (per.get(d) ?? 0) + 2);
    }
    demand.set(b.routeId, per);
  }

  // ── 노선별 그룹화. 담당 노선이 없는 기사(스페어)는 노선에 고르게 나눠
  //    붙인다 — 계획 목적일 뿐 실제 배정은 솔버가 자유롭게 한다.
  const byRoute = new Map<number, SolverDriver[]>();
  const orphans: SolverDriver[] = [];
  for (const d of drivers) {
    if (d.homeRouteId === undefined) { orphans.push(d); continue; }
    const arr = byRoute.get(d.homeRouteId) ?? [];
    arr.push(d);
    byRoute.set(d.homeRouteId, arr);
  }
  const routeIds = [...byRoute.keys()].sort((a, b) => a - b);
  if (routeIds.length === 0 && orphans.length > 0) {
    byRoute.set(-1, orphans);
  } else {
    orphans.sort((a, b) => a.id - b.id);
    orphans.forEach((d, i) => byRoute.get(routeIds[i % routeIds.length])!.push(d));
  }

  for (const [routeId, group] of byRoute.entries()) {
    // 노선 내 정렬: 담당 차량 있는 기사 먼저 → 차량별로 묶여 짝꿍이 인접
    group.sort((a, b) => {
      const ah = a.homeBusId !== undefined ? 0 : 1;
      const bh = b.homeBusId !== undefined ? 0 : 1;
      if (ah !== bh) return ah - bh;
      if (a.homeBusId !== undefined && b.homeBusId !== undefined && a.homeBusId !== b.homeBusId) {
        return a.homeBusId - b.homeBusId;
      }
      return a.id - b.id;
    });

    const N = group.length;
    const state = new Map<number, RestState>();
    const partnerOf = new Map<number, number[]>();
    for (const d of group) {
      if (d.homeBusId === undefined) continue;
      const mates = group.filter((x) => x.homeBusId === d.homeBusId && x.id !== d.id).map((x) => x.id);
      partnerOf.set(d.id, mates);
    }

    // 초기 위상 — 첫날부터 휴무가 고르게 흩어지도록. 같은 차의 짝꿍은
    // 사이클의 절반만큼 어긋나게 해 동시 휴무를 피한다.
    const idxInBus = new Map<number, number>();
    for (let i = 0; i < N; i++) {
      const d = group[i];
      let phase = Math.floor((i * cycleLen) / Math.max(N, 1));
      if (d.homeBusId !== undefined) {
        const k = idxInBus.get(d.homeBusId) ?? 0;
        idxInBus.set(d.homeBusId, k + 1);
        if (k > 0) phase = (phase + Math.floor(cycleLen / 2)) % cycleLen;
        crewIndex.set(d.id, k);
      }
      const carry = d.carryOverPattern?.consecutiveWorkDays ?? 0;
      phase = (phase - carry + cycleLen) % cycleLen;
      state.set(d.id, {
        runLen: phase < restCycle.workDays ? phase : 0,
        restLeft: phase < restCycle.workDays ? 0 : cycleLen - phase,
        work: 0,
        rest: 0,
      });
      restDays.set(d.id, new Set());
    }

    const perDayDemand = demand.get(routeId);

    // 짝꿍은 항상 반대 시프트 — 한 차의 오전·오후가 그 차 사람들로 채워진다.
    // 한 달 안에서는 고정(블록이 100% 같은 시프트), 공평성은 달마다 뒤집어 맞춘다.
    const monthParity = monthStart.getUTCMonth() % 2;
    const fixedShift = new Map<number, ShiftSlot>();
    for (const d of group) {
      if (d.homeBusId === undefined) continue; // 스페어는 빈자리를 따라간다
      fixedShift.set(d.id, ((crewIndex.get(d.id) ?? 0) + monthParity) % 2 === 0 ? 'PM' : 'AM');
    }

    for (const day of days) {
      // 그날 필요한 인원과 시프트별 정원. 운행 계획이 없으면 무제한.
      const need = perDayDemand?.get(day);
      const capAM = need === undefined ? Infinity : Math.ceil(need / 2);
      const capPM = need === undefined ? Infinity : need - Math.ceil(need / 2);

      // 반드시 쉬는 사람: 승인 휴무 · 연속 근무 한도 도달 · 연속 휴무 진행 중
      const forced = new Set<number>();
      for (const d of group) {
        const st = state.get(d.id)!;
        if (d.approvedDayOffs.includes(day) || st.runLen >= restCycle.workDays || st.restLeft > 0) {
          forced.add(d.id);
        }
      }

      // 오래 일한 사람이 쉬도록, 근무는 연속 근무가 짧은 사람부터 채운다
      const pick = (pool: SolverDriver[], cap: number) =>
        [...pool]
          .sort((a, b) => {
            const sa = state.get(a.id)!, sb = state.get(b.id)!;
            if (sa.runLen !== sb.runLen) return sa.runLen - sb.runLen;
            if (sa.work !== sb.work) return sa.work - sb.work;
            return a.id - b.id;
          })
          .slice(0, cap === Infinity ? pool.length : cap);

      const free = group.filter((d) => !forced.has(d.id));
      const workAM = pick(free.filter((d) => fixedShift.get(d.id) === 'AM'), capAM);
      const workPM = pick(free.filter((d) => fixedShift.get(d.id) === 'PM'), capPM);
      // 남은 정원은 스페어가 메운다 — 그래서 스페어는 시프트를 고정하지 않는다
      const gap =
        need === undefined
          ? Infinity
          : capAM - workAM.length + (capPM - workPM.length);
      const workSpare = pick(free.filter((d) => !fixedShift.has(d.id)), gap);

      const working = new Set([...workAM, ...workPM, ...workSpare].map((d) => d.id));

      for (const d of group) {
        const st = state.get(d.id)!;
        if (working.has(d.id)) {
          st.work++;
          st.runLen++;
          st.restLeft = 0;
        } else {
          restDays.get(d.id)!.add(day);
          st.rest++;
          st.runLen = 0;
          st.restLeft = st.restLeft > 0 ? st.restLeft - 1 : restCycle.restDays - 1;
        }
      }
    }

    // ── 2단계: 확정된 휴무 패턴 위에 시프트를 얹는다 ──
    // 위에서 정한 고정 시프트를 근무일에 그대로 깔아준다.
    for (const d of group) {
      const fixed = fixedShift.get(d.id);
      if (!fixed) continue;
      const rest = restDays.get(d.id)!;
      const plan = new Map<string, ShiftSlot>();
      for (const day of days) if (!rest.has(day)) plan.set(day, fixed);
      plannedShift.set(d.id, plan);
    }
  }

  return { restDays, plannedShift };
}

// ─────────────────────────────────────────────
// Phase B: 운전자 선택
// ─────────────────────────────────────────────

interface PickArgs {
  slot: { date: string; busId: number; routeId: number; shift: ShiftSlot };
  ctx: ConstraintContext;
  crew: SolverCrew;
  driversByRoute: Map<number, SolverDriver[]>;
  allDrivers: SolverDriver[];
  restPlan: RestPlan;
  restCycle: RestCyclePolicy;
  policy: CompanyPolicy;
  monthStart: Date;
  monthEnd: Date;
}

interface PickResult {
  driver: SolverDriver | null;
  familiarity: Familiarity;
  reason: string;
}

function pickDriver(args: PickArgs): PickResult {
  const { slot, ctx, crew, driversByRoute, allDrivers, restPlan, restCycle, policy, monthStart, monthEnd } = args;

  // 후보 우선순위: ① 차량 주 운전자 (HOME) → ② 같은 노선 → ③ 다른 노선 (canCrossRoute 인 경우만)
  const homeIds = new Set(crew.driverIds);
  const homeCandidates = crew.driverIds
    .map((id) => ctx.drivers.get(id))
    .filter((d): d is SolverDriver => !!d);
  const sameRouteCandidates = (driversByRoute.get(slot.routeId) ?? []).filter(
    (d) => !homeIds.has(d.id),
  );
  const crossRouteCandidates = allDrivers.filter(
    (d) =>
      d.canCrossRoute === true &&
      d.homeRouteId !== slot.routeId,
  );

  // EMERGENCY 티어 — 다른 모든 티어 실패 시 fallback.
  // canCrossRoute=false 운전자도 포함하되 친화도 페널티 표시.
  // 미배정 슬롯 발생 방지가 가장 중요 (배차 미배정은 운영 사고).
  const emergencyCandidates = allDrivers.filter(
    (d) =>
      !homeIds.has(d.id) &&
      d.homeRouteId !== slot.routeId &&
      d.canCrossRoute !== true, // canCrossRoute=true 면 이미 CROSS_ROUTE 티어에서 시도
  );

  const tiers: Array<{ list: SolverDriver[]; familiarity: Familiarity; isEmergency?: boolean }> = [
    { list: homeCandidates, familiarity: 'HOME' },
    { list: sameRouteCandidates, familiarity: 'SAME_ROUTE' },
    { list: crossRouteCandidates, familiarity: 'CROSS_ROUTE' },
    { list: emergencyCandidates, familiarity: 'CROSS_ROUTE', isEmergency: true },
  ];

  // 2단 통과 — 1차는 "연속 근무 블록의 시프트를 지키는 후보"만 본다.
  //
  // 티어(HOME > SAME_ROUTE > ...)가 하드 우선순위라, 짝꿍이 쉬는 날 홈 기사가
  // 한 명만 남으면 그 사람이 자기 블록 시프트와 무관하게 먼저 처리되는 슬롯
  // (오전)에 들어간다 — 비용을 아무리 높여도 같은 티어에 경쟁자가 없어
  // 소용이 없었다. 그래서 "블록 유지"를 티어보다 앞선 기준으로 올린다.
  // 현장 방식과도 같다: 짝꿍이 쉬면 그 자리를 스페어가 메우고, 남은 기사는
  // 자기 시프트를 그대로 간다.
  // 1차에서 아무도 못 찾으면 2차에서 조건을 풀어 미배정을 만들지 않는다.
  // 정렬은 티어당 한 번만 — candidateCost 가 비싸 2단 통과가 두 번 정렬하면
  // 솔버 실행 시간이 배로 뛴다.
  const rankedTiers = tiers.map((t) => ({ ...t, ranked: rankCandidates(t.list, slot, ctx, policy) }));
  // 3단 통과: ① 계획 시프트 일치 ② 블록 연속성 유지 ③ 자유(미배정 방지)
  for (const pass of [0, 1, 2]) {
  for (const tier of rankedTiers) {
    for (const cand of tier.ranked) {
      // ① 휴무 계획 위에 얹은 블록 시프트를 그대로 따른다
      if (pass === 0) {
        const planned = restPlan.plannedShift.get(cand.id)?.get(slot.date);
        if (planned && planned !== slot.shift) continue;
      }
      // ①② 블록 시프트 유지 — 어제 근무했다면 같은 시프트여야 한다
      if (pass <= 1) {
        const prev = ctx.driverSlots
          .get(cand.id)
          ?.find((s) => s.date === previousDate(slot.date));
        if (prev && prev.shift !== slot.shift) continue;
      }
      // 계획 휴무
      if (restPlan.restDays.get(cand.id)?.has(slot.date)) continue;
      // 헌법 + restCycle 룰 검증
      const v = checkAssignment(ctx, cand.id, slot.date, slot.shift, slot.routeId, policy);
      if (v) continue;
      if (violatesRestCycle(ctx, cand.id, slot.date, restCycle, monthStart)) continue;
      // Phase B 헌법 그리드 룰 (R1 야간연속·R2 주간최대·R9 주말최소) — 위반 후보 거부
      if (wouldViolateGridRules(ctx, cand.id, slot.date, slot.shift, policy, monthStart, monthEnd)) continue;
      // 신규 + CROSS_ROUTE/EMERGENCY 금지
      if (cand.isNewHire && tier.familiarity === 'CROSS_ROUTE') continue;
      return {
        driver: cand,
        familiarity: tier.familiarity,
        reason: tier.isEmergency ? 'EMERGENCY_FALLBACK' : 'OK',
      };
    }
  }
  }

  return {
    driver: null,
    familiarity: 'CROSS_ROUTE',
    reason: 'No driver passes restCycle + constitutional rules across all tiers (EMERGENCY 포함)',
  };
}

function rankCandidates(
  list: SolverDriver[],
  slot: { date: string; shift: ShiftSlot; routeId: number },
  ctx: ConstraintContext,
  policy: CompanyPolicy,
): SolverDriver[] {
  return [...list].sort((a, b) => {
    return candidateCost(a, slot, ctx, policy) - candidateCost(b, slot, ctx, policy);
  });
}

/** 후보 비용 — 작을수록 우선. 정책 기반. */
/** 다음날 (YYYY-MM-DD) */
function nextDate(date: string): string {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** 전날 (YYYY-MM-DD) — 연속 근무 블록 판정용 */
function previousDate(date: string): string {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

function candidateCost(
  driver: SolverDriver,
  slot: { date: string; shift: ShiftSlot; routeId: number },
  ctx: ConstraintContext,
  policy: CompanyPolicy,
): number {
  const current = ctx.driverSlots.get(driver.id)?.length ?? 0;

  // 1) Tiered workload cost — evaluateWorkload 의 (current+1) 시뮬레이션.
  //
  //    원칙: 비용이 낮을수록 우선 선택. underloaded 운전자가 우선이어야 부하 분산됨.
  //    - OVER_MAX 진입 = 절대 회피 (1e6)
  //    - ACCEPTABLE_HIGH 진입 = sweetMax 초과 → 회피 (50)
  //    - SWEET_SPOT 안 = 무차별 (0~1 범위, current 작을수록 살짝 우선)
  //    - ACCEPTABLE_LOW / UNDER_MIN = sweet 까지 끌어올려야 함 → current 가 작을수록
  //      더 우선 (current 자체를 비용으로). 0인 spare > 5일 spare > 10일 spare.
  //    - EXEMPTED 면 sweet 의무 없음 → 후순위로 큰 상수.
  const projectedEval = evaluateWorkload(driver, current + 1, policy);
  const sweet = projectedEval.appliedSweetRange;
  let workloadCost: number;
  if (projectedEval.tier === 'OVER_MAX') {
    workloadCost = 1e6;
  } else if (projectedEval.tier === 'ACCEPTABLE_HIGH') {
    workloadCost = 50;
  } else if (projectedEval.exempted) {
    // 스페어(하한 면제) — 예전엔 일률적으로 100 이라 0일짜리와 17일짜리가
    // 같은 값이었다. 그래서 스페어끼리 부하가 전혀 분산되지 않고 누구는 4일,
    // 누구는 21일이 됐다. 고정기사보다는 뒤에 두되(+40), 스페어끼리는
    // 적게 일한 사람이 먼저 뽑히도록 현재 부하에 비례시킨다.
    workloadCost = 40 + current;
  } else if (projectedEval.tier === 'SWEET_SPOT') {
    // sweet 안 — current 를 sweet 중심에서 약간 우선 (underloaded 미세 선호)
    const center = (sweet.min + sweet.max) / 2;
    workloadCost = Math.abs(current + 1 - center) * 0.5;
  } else {
    // ACCEPTABLE_LOW or UNDER_MIN — sweet 까지 부족분에 비례
    // 현재 workload 가 작을수록 비용 낮음 (가장 부족한 운전자 먼저 채움)
    workloadCost = current; // 0 → 0, 5일 → 5, 10일 → 10
  }

  // 2-a) 연속 근무 블록 안에서는 시프트를 바꾸지 않는다.
  //      현장은 "5일 내리 오후" 처럼 한 블록을 같은 시프트로 간다. 중간에
  //      오전이 끼면 오후→다음날 오전(휴식 8시간 미만)이 만들어지고, 기사도
  //      생활 리듬이 깨진다. 휴무로 블록이 끊긴 뒤에는 자유롭게 바꾼다.
  const prevDaySlot = ctx.driverSlots
    .get(driver.id)
    ?.find((s) => s.date === previousDate(slot.date));
  const blockShiftCost = prevDaySlot && prevDaySlot.shift !== slot.shift ? 300 : 0;

  // 2) 주간 슬롯 일관성 — 이번 주에 이미 다른 슬롯 한 적 있으면 페널티
  const weekSlots = sameWeekSlots(ctx, driver.id, slot.date);
  const sameShiftThisWeek = weekSlots.filter((s) => s.shift === slot.shift).length;
  const otherShiftThisWeek = weekSlots.filter((s) => s.shift !== slot.shift).length;
  const consistencyCost = otherShiftThisWeek > 0 && sameShiftThisWeek === 0 ? 30 : 0;

  // 3) 주간 슬롯 교대 — TWO_SHIFT.weeklyAlternation 일 때만 발동
  let alternationCost = 0;
  if (
    policy.shiftSystem.kind === 'TWO_SHIFT' &&
    policy.shiftSystem.weeklyAlternation
  ) {
    const prevWeekShift = lastWeekDominantShift(ctx, driver.id, slot.date);
    alternationCost = prevWeekShift && prevWeekShift === slot.shift ? 15 : 0;
  }

  // 4) 피로도
  const fatigueCost = (driver.recentFatigueScore / 100) * 10;

  // 5) 주말 분배
  const weekendCount =
    ctx.driverSlots.get(driver.id)?.filter((s) => isWeekend(s.date)).length ?? 0;
  const weekendCost = isWeekend(slot.date) ? weekendCount * 5 : 0;

  // 6) 선호 노선 미충족 페널티
  const preferenceCost = driver.preferredRouteIds && driver.preferredRouteIds.length > 0 && !driver.preferredRouteIds.includes(slot.routeId)
    ? 2 // 약한 타이브레이커 — 근무일 밴드 결정을 뒤집지 않도록 작게 유지 (12→2)
    : 0;

  return workloadCost + blockShiftCost + consistencyCost + alternationCost
    + fatigueCost + weekendCost + preferenceCost;
}

function sameWeekSlots(
  ctx: ConstraintContext,
  driverId: number,
  date: string,
): AssignedSlot[] {
  const target = parseDate(date);
  const weekStart = new Date(target);
  weekStart.setUTCDate(target.getUTCDate() - target.getUTCDay());
  const weekEnd = new Date(weekStart);
  weekEnd.setUTCDate(weekStart.getUTCDate() + 6);

  return (ctx.driverSlots.get(driverId) ?? []).filter((s) => {
    const d = parseDate(s.date);
    return d >= weekStart && d <= weekEnd;
  });
}

/**
 * 지난 주에 가장 많이 한 슬롯 반환 (1교대 / 격일제 등은 항상 동일하므로 의미없음).
 * 2교대 weeklyAlternation 정책에서만 사용.
 */
function lastWeekDominantShift(
  ctx: ConstraintContext,
  driverId: number,
  date: string,
): ShiftSlot | null {
  const target = parseDate(date);
  const thisWeekStart = new Date(target);
  thisWeekStart.setUTCDate(target.getUTCDate() - target.getUTCDay());
  const lastWeekStart = new Date(thisWeekStart);
  lastWeekStart.setUTCDate(thisWeekStart.getUTCDate() - 7);
  const lastWeekEnd = new Date(thisWeekStart);
  lastWeekEnd.setUTCDate(thisWeekStart.getUTCDate() - 1);

  const slots = (ctx.driverSlots.get(driverId) ?? []).filter((s) => {
    const d = parseDate(s.date);
    return d >= lastWeekStart && d <= lastWeekEnd;
  });
  if (slots.length === 0) return null;
  // 다중 슬롯 지원: 가장 많은 shift 반환 (tie 면 null)
  const counts = new Map<ShiftSlot, number>();
  for (const s of slots) counts.set(s.shift, (counts.get(s.shift) ?? 0) + 1);
  let best: ShiftSlot | null = null;
  let bestCount = 0;
  let tied = false;
  for (const [shift, count] of counts.entries()) {
    if (count > bestCount) {
      best = shift;
      bestCount = count;
      tied = false;
    } else if (count === bestCount) {
      tied = true;
    }
  }
  return tied ? null : best;
}

// ─────────────────────────────────────────────
// RestCycle 룰 검증 (5/2, 6/1, 격일제 등)
// ─────────────────────────────────────────────

function violatesRestCycle(
  ctx: ConstraintContext,
  driverId: number,
  date: string,
  rule: RestCyclePolicy,
  monthStart?: Date,
): boolean {
  const slotDates = new Set(
    (ctx.driverSlots.get(driverId) ?? []).map((s) => s.date),
  );
  const driver = ctx.drivers.get(driverId);
  // carryOverPattern.consecutiveWorkDays 가 있으면 전월 말 연속 근무일을 backward 시작값으로
  // (조건: 솔버 시작일=monthStart 이전 슬롯이 카운트 안 되도록 streak 가 month start 까지 도달했을 때만)
  const carryOver = driver?.carryOverPattern?.consecutiveWorkDays ?? 0;

  // 양방향 streak — date 를 추가했다고 가정하고 앞·뒤 연속 근무 합산
  let backward = 0;
  let cursor = parseDate(date);
  let reachedMonthStart = false;
  for (let i = 0; i < rule.workDays; i++) {
    cursor.setUTCDate(cursor.getUTCDate() - 1);
    if (monthStart && cursor < monthStart) {
      reachedMonthStart = true;
      break;
    }
    const iso = formatDate(cursor);
    if (slotDates.has(iso)) backward++;
    else break;
  }
  // 전월 carryOver 합산 — backward 가 month start 까지 끊김없이 도달한 경우만
  if (reachedMonthStart && carryOver > 0) {
    backward += carryOver;
  }

  let forward = 0;
  cursor = parseDate(date);
  for (let i = 0; i < rule.workDays; i++) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    const iso = formatDate(cursor);
    if (slotDates.has(iso)) forward++;
    else break;
  }

  // 총 streak = backward + 1 (오늘) + forward
  return backward + 1 + forward > rule.workDays;
}

// ─────────────────────────────────────────────
// 슬롯 추가/제거 헬퍼
// ─────────────────────────────────────────────

function addSlot(
  ctx: ConstraintContext,
  slots: AssignedSlot[],
  slot: AssignedSlot,
): void {
  slots.push(slot);
  const arr = ctx.driverSlots.get(slot.driverId) ?? [];
  arr.push(slot);
  ctx.driverSlots.set(slot.driverId, arr);
}

// ─────────────────────────────────────────────
// 공유 feasibility 프레디케이트 (FILL + REASSIGN 공용)
// ─────────────────────────────────────────────

/**
 * 주어진 운전자(driverId)가 슬롯(date/shift/routeId)을 받을 수 있는지 판별.
 * FILL move 와 REASSIGN move 양쪽에서 동일하게 사용하는 단일 진입점.
 *
 * 검증 내용:
 *   1. checkAssignment — 승인휴무·면허·자격·중복배정 등 헌법 슬롯 단위 룰
 *   2. violatesRestCycle — 연속근무 사이클 위반
 *   3. wouldViolateGridRules — 야간 연속·주간 최대·주말 최소 등 그리드 집계 룰
 *
 * REASSIGN 용도: ctx 에서 슬롯 S 를 잠시 A 에서 제거한 상태에서 호출해야
 * B 의 restCycle/checkAssignment 가 정확히 평가된다.
 * (ctx mutation + revert 는 호출자 책임)
 */
function canAssignFill(
  ctx: ConstraintContext,
  driverId: number,
  date: string,
  shift: ShiftSlot,
  routeId: number,
  restCycle: RestCyclePolicy,
  policy: CompanyPolicy,
  monthStart: Date,
  monthEnd: Date,
): boolean {
  // 앞뒤 날 근무와 시프트가 어긋나면 안 된다 — 한 블록은 같은 시프트로 간다.
  // (오후 → 다음날 오전은 법정 휴식 8시간도 위협한다)
  const mine = ctx.driverSlots.get(driverId);
  if (mine) {
    const prev = mine.find((s) => s.date === previousDate(date));
    if (prev && prev.shift !== shift) return false;
    const nxt = mine.find((s) => s.date === nextDate(date));
    if (nxt && nxt.shift !== shift) return false;
  }
  return (
    checkAssignment(ctx, driverId, date, shift, routeId, policy) === null &&
    !violatesRestCycle(ctx, driverId, date, restCycle, monthStart) &&
    !wouldViolateGridRules(ctx, driverId, date, shift, policy, monthStart, monthEnd)
  );
}

// ─────────────────────────────────────────────
// FILL move 헬퍼 — 그리드 후처리 제약 사전 검증
// ─────────────────────────────────────────────


// ─────────────────────────────────────────────
// Phase C: 로컬 서치
// ─────────────────────────────────────────────

function localSearch(
  ctx: ConstraintContext,
  slots: AssignedSlot[],
  unfilled: UnfilledSlot[],
  drivers: SolverDriver[],
  weights: SolverWeights,
  restCycle: RestCyclePolicy,
  policy: CompanyPolicy,
  iterations: number,
  monthStart: Date,
  rng: Rng,
  monthEnd: Date,
  /** Phase A 가 세운 휴무 계획 — 5일 근무/2일 휴무 블록의 근거 */
  restPlan: RestPlan,
): number {
  let swaps = 0;
  let currentObj = objective(slots, drivers, weights, policy, unfilled.length);

  // ── Phase C-1: SWAP phase (identical to baseline, RNG-driven) ─────────────
  // This is the original local-search SWAP loop, now using the unfilled-aware
  // objective. Because unfilled.length is constant during SWAP (swaps don't
  // change unfilled), the acceptance criterion (newObj < currentObj) is
  // equivalent to the original — the constant unfilled penalty cancels out.
  for (let i = 0; i < iterations; i++) {
    if (slots.length < 2) break;
    const a = Math.floor(rng() * slots.length);
    let b = Math.floor(rng() * slots.length);
    if (a === b) continue;
    const sa = slots[a];
    const sb = slots[b];
    if (sa.driverId === sb.driverId) continue;

    // 같은 노선 안에서만 교환 (familiarity 보존)
    if (sa.routeId !== sb.routeId) continue;
    // 시프트가 다른 슬롯끼리는 바꾸지 않는다 — Phase B 가 맞춰 놓은 연속 근무
    // 블록의 시프트(5일 내리 오후)를 지역 탐색이 되돌려 놓기 때문이다.
    // 근무일수 균형은 같은 시프트 안에서의 교환·REASSIGN 으로도 충분히 잡힌다.
    if (sa.shift !== sb.shift) continue;

    if (!canSwap(ctx, sa, sb, restCycle, policy, monthStart, monthEnd)) continue;

    applySwap(ctx, sa, sb);
    const newObj = objective(slots, drivers, weights, policy, unfilled.length);
    if (newObj < currentObj) {
      currentObj = newObj;
      swaps++;
    } else {
      applySwap(ctx, sa, sb);
    }
  }

  // ── Phase C-2: FILL pass (greedy, deterministic, no RNG) ─────────────────
  // Runs AFTER the SWAP phase so the SWAP's RNG sequence and slot indices are
  // unaffected. Greedily fills remaining unfilled slots with the most
  // under-loaded feasible same-route driver. Multiple passes until no progress.
  const maxFillPasses = 5; // enough for most tight scenarios
  for (let pass = 0; pass < maxFillPasses && unfilled.length > 0; pass++) {
    let anyFilled = false;
    for (let u = unfilled.length - 1; u >= 0; u--) {
      const U = unfilled[u];

      // Find candidates on same route only
      const routeDriverSet = new Set<number>();
      for (const d of drivers) {
        if (d.homeRouteId === U.routeId) routeDriverSet.add(d.id);
      }
      for (const s of slots) {
        if (s.routeId === U.routeId) routeDriverSet.add(s.driverId);
      }

      // Filter to feasible: all hard constraints + grid-level rules (shared predicate)
      const allFeasible = drivers.filter(
        (d) =>
          routeDriverSet.has(d.id) &&
          canAssignFill(ctx, d.id, U.date, U.shift, U.routeId, restCycle, policy, monthStart, monthEnd),
      );
      // 계획 휴무일에는 넣지 않는다 — Phase A 가 세운 5일 근무/2일 휴무 블록을
      // 지키기 위함이다. 이 걸러내기가 없으면 빈자리 메우기가 휴무 블록을 잘라
      // "3일 일하고 하루 쉬고 또…" 처럼 근무가 잘게 부서진다.
      // 다만 아무도 없으면 미배정(운영 사고)보다는 낫기에 허용한다.
      const offPlanFeasible = allFeasible.filter((d) => !restPlan.restDays.get(d.id)?.has(U.date));
      const feasible = offPlanFeasible.length > 0 ? offPlanFeasible : allFeasible;
      if (feasible.length === 0) continue;

      // Pick most under-loaded driver; tie-break by id asc (deterministic)
      feasible.sort((a, b) => {
        const aCount = ctx.driverSlots.get(a.id)?.length ?? 0;
        const bCount = ctx.driverSlots.get(b.id)?.length ?? 0;
        if (aCount !== bCount) return aCount - bCount;
        return a.id - b.id;
      });
      const chosen = feasible[0];

      const familiarity: Familiarity =
        chosen.homeBusId === U.busId
          ? 'HOME'
          : chosen.homeRouteId === U.routeId
            ? 'SAME_ROUTE'
            : 'CROSS_ROUTE';

      const newSlot: AssignedSlot = {
        date: U.date,
        busId: U.busId,
        routeId: U.routeId,
        shift: U.shift,
        driverId: chosen.id,
        familiarity,
        isHomeBus: chosen.homeBusId === U.busId,
      };

      // Tentatively apply
      addSlot(ctx, slots, newSlot);
      unfilled.splice(u, 1);

      const newObj = objective(slots, drivers, weights, policy, unfilled.length);
      if (newObj < currentObj) {
        currentObj = newObj;
        swaps++;
        anyFilled = true;
      } else {
        // Revert cleanly — no orphan slots/ctx leaks
        const slotIdx = slots.indexOf(newSlot);
        if (slotIdx >= 0) slots.splice(slotIdx, 1);
        const driverArr = ctx.driverSlots.get(chosen.id);
        if (driverArr) {
          const dIdx = driverArr.indexOf(newSlot);
          if (dIdx >= 0) driverArr.splice(dIdx, 1);
        }
        unfilled.splice(u, 0, U);
      }
    }
    if (!anyFilled) break; // no progress in this pass → stop early
  }

  // ── Phase C-3: REASSIGN — over-loaded → under-loaded transfers (same route) ──
  //
  // Goal: reduce workDayStdev by MOVING assigned slots from donor (over-loaded) drivers
  // to recipient (under-loaded) feasible drivers on the SAME route.
  //
  // Unlike SWAP (which exchanges two slots without changing counts), REASSIGN changes
  // workday counts and therefore directly reduces variance.
  //
  // Donor selection rule:
  //   A is a donor candidate iff aCount > sweetMin(A).
  //   Reasoning: after donating one slot, A's count becomes aCount-1.
  //   If aCount > sweetMin, then aCount-1 >= sweetMin (still at or above sweet floor).
  //   Drivers already at/below sweetMin should NOT donate — that would worsen their own load.
  //   OVER_MAX (aCount > hardMax) drivers always qualify (aCount > softMin trivially true).
  //
  // Recipient selection rule:
  //   B is a recipient candidate iff bCount < sweetMin(B) (under-loaded, needs more work)
  //   AND homeRouteId === S.routeId (same-route restriction, SP4-3 handles cross-route).
  //   Among feasible under-loaded candidates, pick the MOST under-loaded (fewest slots).
  //   Tie-break by id asc (deterministic).
  //
  // The objective check is the ultimate acceptance gate.
  // Seeded rng picks the donor slot — deterministic.
  //
  // Iteration budget: same `iterations` bound as SWAP/FILL.
  // RNG sequence continues from where FILL left off (FILL is deterministic / no rng draws).
  for (let i = 0; i < iterations; i++) {
    if (slots.length === 0) break;

    // Pick a random assigned slot S
    const idx = Math.floor(rng() * slots.length);
    const S = slots[idx];
    const A = ctx.drivers.get(S.driverId);
    if (!A) continue;

    // Donor pre-filter: A must have count > sweetMin (can afford to give up one slot)
    const aCount = ctx.driverSlots.get(A.id)?.length ?? 0;
    const aEval = evaluateWorkload(A, aCount, policy);
    const aSweetMin = aEval.appliedSweetRange.min;
    if (aCount <= aSweetMin) continue; // A is at/below sweet floor — not a donor

    // Find under-loaded feasible same-route recipients (B !== A)
    // 1. Build same-route driver set (by homeRouteId matching S.routeId)
    const routeDrivers = drivers.filter(
      (d) => d.id !== A.id && d.homeRouteId === S.routeId,
    );

    // 2. Among route drivers, find those that are under-loaded (bCount < sweetMin(B))
    //    AND pass feasibility after temporarily removing S from A's ctx list.
    //    We must remove S from A's list before checking B's constraints so that
    //    checkAssignment / violatesRestCycle see the post-move state correctly.
    const aArr = ctx.driverSlots.get(A.id)!;
    const aIdxInArr = aArr.indexOf(S);
    if (aIdxInArr >= 0) aArr.splice(aIdxInArr, 1); // temporarily remove from A

    let bestB: SolverDriver | null = null;
    let bestBCount = Infinity;

    for (const B of routeDrivers) {
      const bCount = ctx.driverSlots.get(B.id)?.length ?? 0;
      const bEval = evaluateWorkload(B, bCount, policy);
      const bSweetMin = bEval.appliedSweetRange.min;
      // Recipient: must be under-loaded (below sweet min)
      if (bCount >= bSweetMin) continue;
      // 계획 휴무일에는 재배치하지 않는다 (휴무 블록 보존)
      if (restPlan.restDays.get(B.id)?.has(S.date)) continue;
      // Must pass all hard constraints with S.date/shift/routeId
      if (!canAssignFill(ctx, B.id, S.date, S.shift, S.routeId, restCycle, policy, monthStart, monthEnd)) continue;
      // Pick the most under-loaded (fewest slots); tie-break by id asc
      if (bCount < bestBCount || (bCount === bestBCount && bestB !== null && B.id < bestB.id)) {
        bestB = B;
        bestBCount = bCount;
      }
    }

    // Restore A's ctx list before deciding
    if (aIdxInArr >= 0) aArr.splice(aIdxInArr, 0, S);

    if (!bestB) continue; // no eligible recipient found

    // === MOVE: S from A → bestB ===
    // 1. Remove S from A's ctx list
    const aArrForMove = ctx.driverSlots.get(A.id)!;
    const aIdxMove = aArrForMove.indexOf(S);
    if (aIdxMove >= 0) aArrForMove.splice(aIdxMove, 1);

    // 2. Store originals for revert
    const origDriverId = S.driverId;
    const origFamiliarity = S.familiarity;
    const origIsHomeBus = S.isHomeBus;

    // 3. Assign S to bestB — recompute familiarity/isHomeBus
    S.driverId = bestB.id;
    S.isHomeBus = bestB.homeBusId === S.busId;
    S.familiarity = S.isHomeBus
      ? 'HOME'
      : bestB.homeRouteId === S.routeId
        ? 'SAME_ROUTE'
        : 'CROSS_ROUTE';

    // 4. Add S to bestB's ctx list
    const bArr = ctx.driverSlots.get(bestB.id) ?? [];
    bArr.push(S);
    ctx.driverSlots.set(bestB.id, bArr);

    // 5. Evaluate objective
    const newObj = objective(slots, drivers, weights, policy, unfilled.length);
    if (newObj < currentObj) {
      // Accept the move
      currentObj = newObj;
      swaps++;
    } else {
      // REVERT: move S back to A, restore familiarity/isHomeBus
      const bArrRevert = ctx.driverSlots.get(bestB.id)!;
      const bIdxRevert = bArrRevert.indexOf(S);
      if (bIdxRevert >= 0) bArrRevert.splice(bIdxRevert, 1);

      S.driverId = origDriverId;
      S.familiarity = origFamiliarity;
      S.isHomeBus = origIsHomeBus;

      // Restore to A's ctx list at original position
      const aArrRevert = ctx.driverSlots.get(A.id)!;
      if (aIdxMove >= 0) {
        aArrRevert.splice(aIdxMove, 0, S);
      } else {
        aArrRevert.push(S);
      }
    }
  }

  return swaps;
}

function canSwap(
  ctx: ConstraintContext,
  sa: AssignedSlot,
  sb: AssignedSlot,
  restCycle: RestCyclePolicy,
  policy: CompanyPolicy,
  monthStart: Date,
  monthEnd: Date,
): boolean {
  const tmpA = ctx.driverSlots.get(sa.driverId)!;
  const tmpB = ctx.driverSlots.get(sb.driverId)!;

  const idxA = tmpA.indexOf(sa);
  if (idxA >= 0) tmpA.splice(idxA, 1);
  const idxB = tmpB.indexOf(sb);
  if (idxB >= 0) tmpB.splice(idxB, 1);

  const violB = checkAssignment(ctx, sb.driverId, sa.date, sa.shift, sa.routeId, policy);
  const violA = checkAssignment(ctx, sa.driverId, sb.date, sb.shift, sb.routeId, policy);
  const ftB = violatesRestCycle(ctx, sb.driverId, sa.date, restCycle, monthStart);
  const ftA = violatesRestCycle(ctx, sa.driverId, sb.date, restCycle, monthStart);
  // Grid-level constitutional rules (R1 noNightStreak, R2 weeklyMaxWorkDays, R9 guaranteedWeekendOff).
  // Checked in the temp-removed state so wouldViolateGridRules sees the correct post-swap context.
  const grB = wouldViolateGridRules(ctx, sb.driverId, sa.date, sa.shift, policy, monthStart, monthEnd);
  const grA = wouldViolateGridRules(ctx, sa.driverId, sb.date, sb.shift, policy, monthStart, monthEnd);

  if (idxA >= 0) tmpA.splice(idxA, 0, sa);
  if (idxB >= 0) tmpB.splice(idxB, 0, sb);

  return !violA && !violB && !ftA && !ftB && !grA && !grB;
}

/**
 * Compute familiarity and isHomeBus for a driver assigned to a given bus/route.
 *
 * Mirrors the exact tier logic used by pickDriver (HOME → SAME_ROUTE → CROSS_ROUTE)
 * and the FILL / REASSIGN moves so all code paths stay consistent.
 *
 * HOME        = driver.homeBusId === busId
 * SAME_ROUTE  = driver.homeRouteId === routeId  (and NOT home bus)
 * CROSS_ROUTE = everything else
 */
function familiarityFor(
  driver: SolverDriver,
  busId: number,
  routeId: number,
): { familiarity: Familiarity; isHomeBus: boolean } {
  const isHomeBus = driver.homeBusId === busId;
  const familiarity: Familiarity = isHomeBus
    ? 'HOME'
    : driver.homeRouteId === routeId
      ? 'SAME_ROUTE'
      : 'CROSS_ROUTE';
  return { familiarity, isHomeBus };
}

function applySwap(
  ctx: ConstraintContext,
  sa: AssignedSlot,
  sb: AssignedSlot,
): void {
  const oldA = sa.driverId;
  const oldB = sb.driverId;

  const arrA = ctx.driverSlots.get(oldA)!;
  const arrB = ctx.driverSlots.get(oldB)!;
  arrA.splice(arrA.indexOf(sa), 1);
  arrB.splice(arrB.indexOf(sb), 1);

  sa.driverId = oldB;
  sb.driverId = oldA;

  // Recompute familiarity/isHomeBus for the new driver assignment.
  // Without this, labels stay stale after the swap (e.g. HOME but homeBusId !== busId).
  const driverB = ctx.drivers.get(oldB)!;
  const driverA = ctx.drivers.get(oldA)!;
  const famA = familiarityFor(driverB, sa.busId, sa.routeId);
  sa.familiarity = famA.familiarity;
  sa.isHomeBus = famA.isHomeBus;
  const famB = familiarityFor(driverA, sb.busId, sb.routeId);
  sb.familiarity = famB.familiarity;
  sb.isHomeBus = famB.isHomeBus;

  arrB.push(sa);
  arrA.push(sb);
  ctx.driverSlots.set(sb.driverId, arrA);
  ctx.driverSlots.set(sa.driverId, arrB);
}

// ─────────────────────────────────────────────
// 목적함수
// ─────────────────────────────────────────────

function objective(
  slots: AssignedSlot[],
  drivers: SolverDriver[],
  weights: SolverWeights,
  policy: CompanyPolicy,
  unfilledCount: number,
): number {
  const counts = new Map<number, number>();
  const weekendCounts = new Map<number, number>();
  // 주별 슬롯 분포 — Map<weekKey, Map<shift, count>>
  const weeklyShifts = new Map<string, Map<ShiftSlot, number>>();
  let crossRoute = 0;

  for (const s of slots) {
    counts.set(s.driverId, (counts.get(s.driverId) ?? 0) + 1);
    if (isWeekend(s.date)) {
      weekendCounts.set(s.driverId, (weekendCounts.get(s.driverId) ?? 0) + 1);
    }
    if (s.familiarity === 'CROSS_ROUTE') crossRoute++;
    // 주간 슬롯 카운트 — 시프트 종류별
    const wk = weekKey(s.date, s.driverId);
    const cur = weeklyShifts.get(wk) ?? new Map<ShiftSlot, number>();
    cur.set(s.shift, (cur.get(s.shift) ?? 0) + 1);
    weeklyShifts.set(wk, cur);
  }

  // Tiered workload penalty — hard violation 은 거대 페널티 (1e9),
  // ACCEPTABLE_LOW/HIGH 는 작은 페널티, SWEET_SPOT 과 EXEMPTED 는 0.
  let workdayPenalty = 0;
  for (const d of drivers) {
    const c = counts.get(d.id) ?? 0;
    workdayPenalty += evaluateWorkload(d, c, policy).softPenalty;
  }

  // 주간 슬롯 일관성 — 다중 슬롯 시스템에서만 의미
  // 페널티 = (해당 주 총 슬롯 - 그 주 가장 많은 슬롯 카운트)
  // 즉 "비주력 슬롯" 의 합계. 한 주 단일 슬롯이면 0.
  let consistencyPenalty = 0;
  if (policy.shiftSystem.slots.length >= 2) {
    for (const shiftCounts of weeklyShifts.values()) {
      const values = Array.from(shiftCounts.values());
      const total = values.reduce((a, b) => a + b, 0);
      const max = values.reduce((a, b) => Math.max(a, b), 0);
      consistencyPenalty += total - max;
    }
  }

  const weekendVar = variance(Array.from(weekendCounts.values()));
  const fatigueVar = variance(
    drivers.map((d) => {
      const c = counts.get(d.id) ?? 0;
      return d.recentFatigueScore + c * 2;
    }),
  );

  let preferencePenalty = 0;
  const prefByDriver = new Map(drivers.filter(d => d.preferredRouteIds && d.preferredRouteIds.length > 0).map(d => [d.id, new Set(d.preferredRouteIds)]));
  for (const s of slots) {
    const pref = prefByDriver.get(s.driverId);
    if (pref && !pref.has(s.routeId)) preferencePenalty++;
  }

  return (
    workdayPenalty * weights.workdayDeviation +
    consistencyPenalty * weights.weeklyShiftConsistency +
    crossRoute * weights.familiarityCost +
    weekendVar * weights.weekendFairness +
    fatigueVar * weights.fatigueVariance +
    preferencePenalty * weights.routePreference +
    unfilledCount * weights.unfilled
  );
}

function weekKey(date: string, driverId: number): string {
  const d = parseDate(date);
  const ws = new Date(d);
  ws.setUTCDate(d.getUTCDate() - d.getUTCDay());
  return `${driverId}-${formatDate(ws)}`;
}

function variance(arr: number[]): number {
  if (arr.length === 0) return 0;
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  return arr.reduce((acc, x) => acc + (x - mean) ** 2, 0) / arr.length;
}

function stdev(arr: number[]): number {
  return Math.sqrt(variance(arr));
}

// ─────────────────────────────────────────────
// 메트릭 + 워크로드
// ─────────────────────────────────────────────

function computeWorkloads(
  drivers: SolverDriver[],
  slots: AssignedSlot[],
  policy: CompanyPolicy,
): DriverWorkload[] {
  const map = new Map<number, DriverWorkload>();
  for (const d of drivers) {
    map.set(d.id, {
      driverId: d.id,
      driverName: d.name,
      workDays: 0,
      weekendShifts: 0,
      amShifts: 0,
      pmShifts: 0,
      shiftCounts: {},
      homeBusDays: 0,
      crossRouteDays: 0,
      longestStreak: 0,
      withinTarget: false,
      withinAcceptable: false,
      violatesRestCycle: false,
      // 임시 디폴트 — 아래 마지막 루프에서 evaluateWorkload 로 채움
      workloadEval: {
        tier: 'SWEET_SPOT',
        hardViolation: false,
        softPenalty: 0,
        exempted: false,
        appliedRange: {
          min: policy.workdayBands.hardMin,
          max: policy.workdayBands.hardMax,
        },
        appliedSweetRange: {
          min: policy.workdayBands.sweetMin,
          max: policy.workdayBands.sweetMax,
        },
      },
    });
  }

  // 날짜순 슬롯 수집
  const byDriver = new Map<number, AssignedSlot[]>();
  for (const s of slots) {
    const arr = byDriver.get(s.driverId) ?? [];
    arr.push(s);
    byDriver.set(s.driverId, arr);
  }

  for (const [driverId, dSlots] of byDriver.entries()) {
    const w = map.get(driverId);
    if (!w) continue;
    w.workDays = dSlots.length;
    // 시프트 카운트 — 모든 시프트 종류
    for (const s of dSlots) {
      w.shiftCounts[s.shift] = (w.shiftCounts[s.shift] ?? 0) + 1;
    }
    // Stage 1 호환 alias
    w.amShifts = w.shiftCounts['AM'] ?? 0;
    w.pmShifts = w.shiftCounts['PM'] ?? 0;
    w.weekendShifts = dSlots.filter((s) => isWeekend(s.date)).length;
    w.homeBusDays = dSlots.filter((s) => s.isHomeBus).length;
    w.crossRouteDays = dSlots.filter((s) => s.familiarity === 'CROSS_ROUTE').length;

    // 가장 긴 연속 근무 일수
    const dates = dSlots.map((s) => s.date).sort();
    let maxStreak = 1;
    let cur = 1;
    for (let i = 1; i < dates.length; i++) {
      const prev = parseDate(dates[i - 1]);
      const next = parseDate(dates[i]);
      const diff = (next.getTime() - prev.getTime()) / (24 * 60 * 60 * 1000);
      if (diff === 1) cur++;
      else cur = 1;
      if (cur > maxStreak) maxStreak = cur;
    }
    w.longestStreak = dates.length > 0 ? maxStreak : 0;
  }

  for (const d of drivers) {
    const w = map.get(d.id)!;
    const ev = evaluateWorkload(d, w.workDays, policy);
    w.workloadEval = ev;
    // sweet spot
    w.withinTarget = ev.tier === 'SWEET_SPOT';
    // acceptable (sweet + low/high + 면제자)
    w.withinAcceptable =
      ev.tier === 'SWEET_SPOT' ||
      ev.tier === 'ACCEPTABLE_LOW' ||
      ev.tier === 'ACCEPTABLE_HIGH' ||
      ev.exempted;
    // restCycle.workDays + 1 보다 긴 streak 면 위반 (5/2 의 경우 6일)
    w.violatesRestCycle = w.longestStreak > policy.restCycle.workDays;
  }
  return Array.from(map.values());
}

function computeMetrics(
  workloads: DriverWorkload[],
  slots: AssignedSlot[],
  violations: ConstitutionalViolation[],
  unfilled: UnfilledSlot[],
  localSearchSwaps: number,
  weights: SolverWeights,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  restCycle: RestCyclePolicy,
): SolverMetrics {
  // 균형·목표 지표는 면제 기사(신규·스페어 등)를 제외한 정규 풀 기준으로 계산.
  // 스페어 기사는 정규 배차가 적은 것이 정상이라 포함하면 편차·충족률이 왜곡된다.
  const regular = workloads.filter((w) => !w.workloadEval.exempted);
  const workDays = regular.map((w) => w.workDays);
  const weekendShifts = regular.map((w) => w.weekendShifts);
  const total = slots.length;
  const homeCount = slots.filter((s) => s.isHomeBus).length;
  const crossCount = slots.filter((s) => s.familiarity === 'CROSS_ROUTE').length;
  const restCycleViolators = workloads.filter((w) => w.violatesRestCycle).length;

  const workDayMean =
    workDays.length === 0
      ? 0
      : workDays.reduce((a, b) => a + b, 0) / workDays.length;
  const workDayStdev = stdev(workDays);
  const weekendStdev = stdev(weekendShifts);
  const inTarget = regular.filter((w) => w.withinTarget).length;
  const withinTargetRate = regular.length === 0 ? 0 : inTarget / regular.length;
  const inAcceptable = regular.filter((w) => w.withinAcceptable).length;
  const withinAcceptableRate =
    regular.length === 0 ? 0 : inAcceptable / regular.length;
  const hardViolationCount = workloads.filter(
    (w) => w.workloadEval.hardViolation,
  ).length;
  const exemptedCount = workloads.filter((w) => w.workloadEval.exempted).length;
  const homeBusRate = total === 0 ? 0 : homeCount / total;
  const crossRouteRate = total === 0 ? 0 : crossCount / total;
  const restCycleCompliance =
    workloads.length === 0 ? 1 : 1 - restCycleViolators / workloads.length;

  // 주간 슬롯 일관성 — 한 주 단일 슬롯 비율
  const weeklyShifts = new Map<string, Map<ShiftSlot, number>>();
  for (const s of slots) {
    const wk = weekKey(s.date, s.driverId);
    const cur = weeklyShifts.get(wk) ?? new Map<ShiftSlot, number>();
    cur.set(s.shift, (cur.get(s.shift) ?? 0) + 1);
    weeklyShifts.set(wk, cur);
  }
  let consistentWeeks = 0;
  for (const shiftCounts of weeklyShifts.values()) {
    if (shiftCounts.size <= 1) consistentWeeks++;
  }
  const weeklyShiftConsistencyRate =
    weeklyShifts.size === 0 ? 1 : consistentWeeks / weeklyShifts.size;

  // 공정성 점수 = 100 - workStd*10 - weekendStd*5 - crossRate*100
  //              - (1-restCycleCompliance)*50 - hardViolations*15
  const fairnessScore = Math.max(
    0,
    Math.min(
      100,
      100 -
        workDayStdev * 10 -
        weekendStdev * 5 -
        crossRouteRate * 100 -
        (1 - restCycleCompliance) * 50 -
        hardViolationCount * 15,
    ),
  );

  return {
    fairnessScore: Math.round(fairnessScore * 10) / 10,
    workDayStdev: round(workDayStdev),
    workDayMean: round(workDayMean),
    withinTargetRate: round(withinTargetRate),
    withinAcceptableRate: round(withinAcceptableRate),
    hardViolationCount,
    exemptedCount,
    homeBusRate: round(homeBusRate),
    crossRouteRate: round(crossRouteRate),
    restCycleCompliance: round(restCycleCompliance),
    weeklyShiftConsistencyRate: round(weeklyShiftConsistencyRate),
    weekendStdev: round(weekendStdev),
    dayOffSatisfactionRate: 1,
    constitutionalViolations: violations,
    unfilledCount: unfilled.length,
    localSearchSwaps,
  };
}

function round(n: number, digits = 3): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

function renderSummary(
  input: SolverInput,
  metrics: SolverMetrics,
  workloads: DriverWorkload[],
  unfilled: UnfilledSlot[],
): string {
  const offTarget = workloads.filter((w) => !w.withinTarget);
  const hardViolators = workloads.filter((w) => w.workloadEval.hardViolation);
  const exempted = workloads.filter((w) => w.workloadEval.exempted);
  const restCycleViolators = workloads.filter((w) => w.violatesRestCycle);
  const policy = input.policy ?? DEFAULT_POLICY;
  const b = policy.workdayBands;
  const presetTag = policy.preset ? ` [${policy.preset}]` : '';
  const lines = [
    `${input.year}년 ${input.month}월 배차 생성 완료${presetTag}`,
    `공정성 점수: ${metrics.fairnessScore}/100 (목표 ≥ 85)`,
    `근무일수: 평균 ${metrics.workDayMean}일, 표준편차 ${metrics.workDayStdev}일 (목표 < 0.8)`,
    `${b.sweetMin}~${b.sweetMax}일 충족률: ${(metrics.withinTargetRate * 100).toFixed(1)}% (sweet spot)`,
    `${b.hardMin}~${b.hardMax}일 충족률: ${(metrics.withinAcceptableRate * 100).toFixed(1)}% (acceptable, 면제자 포함)`,
    `Hard 위반: ${metrics.hardViolationCount}명 (목표 0)`,
    `면제 적용: ${metrics.exemptedCount}명`,
    `restCycle 룰 준수: ${(metrics.restCycleCompliance * 100).toFixed(1)}% (목표 100%, ${policy.restCycle.workDays}/${policy.restCycle.restDays})`,
    `본인 차량 배정률: ${(metrics.homeBusRate * 100).toFixed(1)}% (목표 ≥ 80%)`,
    `타 노선 투입률: ${(metrics.crossRouteRate * 100).toFixed(1)}% (목표 < 5%)`,
    `주간 슬롯 일관성: ${(metrics.weeklyShiftConsistencyRate * 100).toFixed(1)}% (한 주 단일 슬롯 비율)`,
    `미배정 슬롯: ${metrics.unfilledCount}개`,
    `헌법 룰 위반: ${metrics.constitutionalViolations.length}건`,
    `로컬 서치 개선: ${metrics.localSearchSwaps}회 swap`,
  ];

  // Hard violation — 가장 먼저, 굵게 강조
  if (hardViolators.length > 0) {
    lines.push('');
    lines.push(`🚨 Hard 위반 (즉시 검토 필요):`);
    for (const w of hardViolators) {
      lines.push(
        `   ${w.driverName}: ${w.workDays}일 근무 — ${w.workloadEval.tier} (허용범위 ${w.workloadEval.appliedRange.min}~${w.workloadEval.appliedRange.max}일)`,
      );
    }
  }

  // 면제 적용자 — 회사 담당자가 "왜 이 사람이 이렇게 일했지?" 이해하도록 표시
  if (exempted.length > 0) {
    lines.push('');
    lines.push(`ℹ️  면제 적용 (${exempted.length}명):`);
    for (const w of exempted) {
      const reason = w.workloadEval.exemptionReason ?? 'OTHER';
      const note = w.workloadEval.exemptionNote ? ` — ${w.workloadEval.exemptionNote}` : '';
      lines.push(
        `   ${w.driverName}: ${w.workDays}일 근무 — UNDER_MIN 제외됨 (${reason})${note}`,
      );
    }
  }

  if (offTarget.length > 0) {
    const nonHardNonExempt = offTarget.filter(
      (w) => !w.workloadEval.hardViolation && !w.workloadEval.exempted,
    );
    if (nonHardNonExempt.length > 0) {
      const sample = nonHardNonExempt
        .slice(0, 5)
        .map((w) => `${w.driverName}(${w.workDays}일/${w.workloadEval.tier})`)
        .join(', ');
      lines.push(
        `타겟 이탈 (acceptable 범위): ${nonHardNonExempt.length}명 (${sample}${nonHardNonExempt.length > 5 ? ' …' : ''})`,
      );
    }
  }
  if (restCycleViolators.length > 0) {
    lines.push(
      `⚠ 5/2 룰 위반: ${restCycleViolators.length}명 (${restCycleViolators.slice(0, 3).map((w) => `${w.driverName}(${w.longestStreak}일 연속)`).join(', ')})`,
    );
  }
  if (unfilled.length > 0) {
    lines.push(
      `⚠ 미배정: ${unfilled.slice(0, 3).map((u) => `${u.date} ${u.shift} bus#${u.busId}`).join(' / ')}${unfilled.length > 3 ? ' …' : ''}`,
    );
  }
  return lines.join('\n');
}

// ─────────────────────────────────────────────
// 날짜 enum
// ─────────────────────────────────────────────

function enumerateDays(start: Date, end: Date): string[] {
  const out: string[] = [];
  const cur = new Date(start);
  while (cur <= end) {
    out.push(formatDate(cur));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out;
}

// ─────────────────────────────────────────────
// Crew 정규화 (Stage 1 partnerships → Stage 2 crews)
// ─────────────────────────────────────────────

/**
 * input.crews 가 있으면 그대로 사용, 아니면 input.partnerships 를 SolverCrew 로 변환.
 * 둘 다 없으면 빈 배열 반환 (운휴 가정).
 */
function normalizeToCrews(input: SolverInput): SolverCrew[] {
  if (input.crews && input.crews.length > 0) return input.crews;
  if (input.partnerships && input.partnerships.length > 0) {
    return input.partnerships.map(
      (p): SolverCrew => ({
        id: p.id,
        driverIds: [p.driverAId, p.driverBId],
        busId: p.busId,
        routeId: p.routeId,
      }),
    );
  }
  // 양쪽 다 없으면 — 차량은 있는데 매핑 없음 → 솔버는 빈 슬롯 그리드 반환
  // (silent failure 보다 빈 입력 명시적 표시)
  if (input.buses.length > 0) {
    throw new Error(
      `SolverInput: 차량 ${input.buses.length}대 가 있는데 crews/partnerships 매핑이 없습니다. ` +
        `최소 한 차량당 한 crew (PAIR=2명/SOLO=1명/TRIO=3명) 가 필요합니다.`,
    );
  }
  return [];
}

/** crew.driverIds.length 가 정책의 crewModel.size 와 일치하는지 검증 */
function validateCrewModel(crews: SolverCrew[], policy: CompanyPolicy): void {
  const expectedSize = policy.crewModel.size;
  const mismatches = crews.filter((c) => c.driverIds.length !== expectedSize);
  if (mismatches.length > 0) {
    const sample = mismatches
      .slice(0, 3)
      .map(
        (c) =>
          `crew ${c.id} (bus ${c.busId}): ${c.driverIds.length}명 (정책: ${expectedSize}명)`,
      )
      .join(', ');
    throw new Error(
      `Crew size mismatch with policy.crewModel.${policy.crewModel.kind}(size=${expectedSize}). ` +
        `위반 ${mismatches.length}건: ${sample}`,
    );
  }
}
