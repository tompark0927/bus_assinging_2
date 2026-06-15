# 배차 측정 잣대 (Dispatch Measurement Harness) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 솔버 출력 품질을 결정론적·다차원·다시나리오로 재는 측정 잣대를 구축해, 이후 배차 AI 개선의 효과를 객관적으로 증명할 수 있게 한다.

**Architecture:** 순수(in-memory) 측정. 시드 RNG로 합성 시나리오를 결정론적으로 생성 → 기존 `solveMonthlyGrid`(불변) 실행 → 단일 스코어러 `scheduleQuality`로 다차원 품질 측정 → 하니스가 분포 집계·절대 게이트·baseline 델타·JSON 출력. 솔버 내부 목적함수는 건드리지 않는다(잣대 독립성).

**Tech Stack:** TypeScript, Node, Jest(ts-jest), ts-node CLI. DB/LLM 미사용.

**참고 스펙:** `docs/superpowers/specs/2026-06-15-dispatch-measurement-harness-design.md`

**중요 제약 (jest 발견 규칙):** jest는 `roots: ['<rootDir>/src']` + `testMatch: ['**/__tests__/**/*.test.ts']`. 따라서 테스트 대상 로직은 모두 `src/` 아래에 두고, 테스트는 `src/**/__tests__/`에 둔다. CLI 래퍼만 `scripts/`에 둔다.

---

## File Structure

생성/수정 파일과 책임:

- **생성** `src/utils/seededRng.ts` — 결정론적 RNG(mulberry32) + 헬퍼. 단일 책임: 시드 기반 난수.
- **수정** `src/agents/_core/dispatch-scenario-generator.ts:87`, `src/agents/_core/scenario-generator.ts:54` — 중복 `mulberry32`를 `seededRng`에서 import (DRY).
- **생성** `src/agents/_solvers/quality.ts` — `scheduleQuality(input, output): QualityReport`. 단일 품질 스코어러(측정의 진실원).
- **생성** `src/agents/_solvers/bench/scenarios.ts` — `ScenarioSpec`, `buildScenario(spec): SolverInput`, `SCENARIO_SUITE`. 결정론적 합성 시나리오.
- **생성** `src/agents/_solvers/bench/harness.ts` — `runSuite`, `aggregate`, `evaluateGates`, `compareToBaseline`. 하니스 코어(순수, 테스트 가능).
- **생성** `scripts/backtest/solver-harness.ts` — 얇은 CLI(인자 파싱·콘솔 출력·JSON 파일 I/O·exitCode).
- **생성** `scripts/backtest/baselines/solver-baseline.json` — 현재 솔버 기준선.
- **삭제** `scripts/dispatch-solver-backtest.ts` — 새 하니스로 대체.
- **수정** `packages/backend/package.json` — `backtest:solver` 스크립트 추가.
- **테스트** `src/utils/__tests__/seededRng.test.ts`, `src/agents/_solvers/__tests__/quality.test.ts`, `src/agents/_solvers/__tests__/scenarios.test.ts`, `src/agents/_solvers/__tests__/harness.test.ts`.

모든 명령은 `packages/backend/`에서 실행한다.

---

### Task 1: 시드 RNG 유틸 추출

**Files:**
- Create: `packages/backend/src/utils/seededRng.ts`
- Test: `packages/backend/src/utils/__tests__/seededRng.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

`packages/backend/src/utils/__tests__/seededRng.test.ts`:

```ts
import { createRng, rngInt, rngChance, rngPick } from '../seededRng';

describe('seededRng', () => {
  it('같은 시드는 동일한 시퀀스를 만든다', () => {
    const a = createRng(42);
    const b = createRng(42);
    const seqA = [a(), a(), a(), a()];
    const seqB = [b(), b(), b(), b()];
    expect(seqA).toEqual(seqB);
  });

  it('다른 시드는 다른 시퀀스를 만든다', () => {
    const a = createRng(1);
    const b = createRng(2);
    expect(a()).not.toBeCloseTo(b(), 10);
  });

  it('rngInt는 [min, max] 정수 범위를 결정론적으로 만든다', () => {
    const r = createRng(7);
    const vals = Array.from({ length: 50 }, () => rngInt(r, 3, 6));
    expect(vals.every((v) => v >= 3 && v <= 6 && Number.isInteger(v))).toBe(true);
    const r2 = createRng(7);
    const vals2 = Array.from({ length: 50 }, () => rngInt(r2, 3, 6));
    expect(vals).toEqual(vals2);
  });

  it('rngChance와 rngPick도 결정론적이다', () => {
    const r = createRng(99);
    const c1 = Array.from({ length: 20 }, () => rngChance(r, 0.5));
    const r2 = createRng(99);
    const c2 = Array.from({ length: 20 }, () => rngChance(r2, 0.5));
    expect(c1).toEqual(c2);
    const r3 = createRng(5);
    expect(rngPick(r3, ['a', 'b', 'c'])).toBe(rngPick(createRng(5), ['a', 'b', 'c']));
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx jest src/utils/__tests__/seededRng.test.ts`
Expected: FAIL — "Cannot find module '../seededRng'".

- [ ] **Step 3: 최소 구현**

`packages/backend/src/utils/seededRng.ts`:

```ts
/**
 * 결정론적 난수 생성기 (mulberry32).
 * 같은 시드는 항상 같은 시퀀스를 만든다 — 백테스트 재현성의 기반.
 * (기존 dispatch-scenario-generator.ts / scenario-generator.ts 의 중복 구현을 여기로 통합)
 */
export type Rng = () => number;

/** 시드로 0~1 난수 함수를 만든다. */
export function createRng(seed: number): Rng {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** [min, max] 정수 (양끝 포함). */
export function rngInt(rng: Rng, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

/** [min, max) 실수. */
export function rngFloat(rng: Rng, min: number, max: number): number {
  return min + rng() * (max - min);
}

/** p 확률로 true. */
export function rngChance(rng: Rng, p: number): boolean {
  return rng() < p;
}

/** 배열에서 하나 균등 선택. */
export function rngPick<T>(rng: Rng, arr: readonly T[]): T {
  return arr[Math.floor(rng() * arr.length)];
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx jest src/utils/__tests__/seededRng.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: 기존 중복 mulberry32 통합 (DRY)**

`src/agents/_core/dispatch-scenario-generator.ts`의 로컬 `mulberry32` 함수 정의(약 `:87-95`)를 삭제하고, 파일 상단 import에 추가:

```ts
import { createRng } from '../../utils/seededRng';
```

그리고 사용처(`const rng = mulberry32(seed);`, 약 `:110`)를 다음으로 변경:

```ts
const rng = createRng(seed);
```

동일하게 `src/agents/_core/scenario-generator.ts`의 로컬 `mulberry32`(약 `:54-62`) 삭제 + import 추가:

```ts
import { createRng } from '../../utils/seededRng';
```

사용처(약 `:109`) 변경:

```ts
const rng = createRng(seed);
```

> 주의: `createRng`는 기존 `mulberry32`와 비트 단위로 동일한 알고리즘이므로 기존 백테스트 시드 의미가 보존된다.

- [ ] **Step 6: 기존 테스트 회귀 없음 확인**

Run: `npx jest src/agents/_core`
Expected: PASS — 시나리오 제너레이터 관련 기존 테스트가 통과(없으면 컴파일만 통과). 이어서 컴파일 확인:
Run: `npx tsc --noEmit`
Expected: 에러 없음.

- [ ] **Step 7: 커밋**

```bash
git add src/utils/seededRng.ts src/utils/__tests__/seededRng.test.ts src/agents/_core/dispatch-scenario-generator.ts src/agents/_core/scenario-generator.ts
git commit -m "feat(backtest): extract deterministic seeded RNG util and dedupe mulberry32"
```

---

### Task 2: 품질 스코어러 — 근무일 균형 지표

**Files:**
- Create: `packages/backend/src/agents/_solvers/quality.ts`
- Test: `packages/backend/src/agents/_solvers/__tests__/quality.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

`packages/backend/src/agents/_solvers/__tests__/quality.test.ts`:

```ts
import { scheduleQuality } from '../quality';
import type { SolverInput, SolverOutput, AssignedSlot, SolverDriver } from '../types';
import { POLICY_PRESETS } from '../types';

function driver(id: number, extra: Partial<SolverDriver> = {}): SolverDriver {
  return {
    id,
    name: `D${id}`,
    homeBusId: 100 + id,
    homeRouteId: 1,
    approvedDayOffs: [],
    recentFatigueScore: 30,
    isNewHire: false,
    ...extra,
  };
}

function slot(driverId: number, date: string, shift = 'AM'): AssignedSlot {
  return { date, busId: 100 + driverId, routeId: 1, shift, driverId, familiarity: 'HOME', isHomeBus: true };
}

function output(slots: AssignedSlot[], unfilled = 0): SolverOutput {
  return {
    slots,
    unfilled: Array.from({ length: unfilled }, (_, i) => ({
      date: '2026-05-01', busId: 999, routeId: 1, shift: 'AM', reason: 'no candidate',
    })),
    workloads: [],
    metrics: {
      fairnessScore: 0, workDayStdev: 0, workDayMean: 0, withinTargetRate: 0, withinAcceptableRate: 0,
      hardViolationCount: 0, exemptedCount: 0, homeBusRate: 0, crossRouteRate: 0, restCycleCompliance: 1,
      weeklyShiftConsistencyRate: 0, weekendStdev: 0, dayOffSatisfactionRate: 1,
      constitutionalViolations: [], unfilledCount: unfilled, localSearchSwaps: 0,
    },
    summary: '',
  };
}

function baseInput(drivers: SolverDriver[]): SolverInput {
  return { year: 2026, month: 5, drivers, buses: [], crews: [], policy: POLICY_PRESETS.CITY_2SHIFT };
}

describe('scheduleQuality — 근무일 균형', () => {
  it('일을 전혀 안 받은 기사도 stdev/idle 집계에 포함한다', () => {
    // D1: 2일, D2: 0일
    const input = baseInput([driver(1), driver(2)]);
    const out = output([slot(1, '2026-05-01'), slot(1, '2026-05-02')]);
    const q = scheduleQuality(input, out);
    expect(q.idleDriverCount).toBe(1);
    expect(q.activeDriverRate).toBeCloseTo(0.5, 5);
    // workDays = [2, 0], mean=1, stdev=1
    expect(q.workDayStdev).toBeCloseTo(1, 5);
  });

  it('완전 균등하면 stdev=0, idle=0', () => {
    const input = baseInput([driver(1), driver(2)]);
    const out = output([slot(1, '2026-05-01'), slot(2, '2026-05-01')]);
    const q = scheduleQuality(input, out);
    expect(q.workDayStdev).toBeCloseTo(0, 5);
    expect(q.idleDriverCount).toBe(0);
    expect(q.activeDriverRate).toBeCloseTo(1, 5);
  });

  it('미배정 비율을 계산한다', () => {
    const input = baseInput([driver(1)]);
    const out = output([slot(1, '2026-05-01')], 1); // 1 assigned + 1 unfilled = 2 total
    const q = scheduleQuality(input, out);
    expect(q.unfilledRate).toBeCloseTo(0.5, 5);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx jest src/agents/_solvers/__tests__/quality.test.ts`
Expected: FAIL — "Cannot find module '../quality'".

- [ ] **Step 3: 최소 구현**

`packages/backend/src/agents/_solvers/quality.ts`:

```ts
import type { SolverInput, SolverOutput, ConstitutionalRuleKey } from './types';

/** 한 그리드의 다차원 품질 측정 결과 (측정의 단일 진실원). */
export interface QualityReport {
  // ── 균형 ──
  /** 근무일수 표준편차 (전 활성 기사 포함, 0일 기사 포함). 낮을수록 공정. */
  workDayStdev: number;
  /** 야간 시프트 표준편차 (정책별 야간 라벨 정규화). */
  nightStdev: number;
  /** 주말 근무 표준편차. */
  weekendStdev: number;
  // ── 활용 ──
  /** 한 슬롯이라도 받은 기사 비율. */
  activeDriverRate: number;
  /** SPARE(홈버스 없음) 활용률 = SPARE 평균근무일 / HOME 평균근무일 (0~1, clamp). 대상 없으면 null. */
  spareUtilizationRate: number | null;
  /** 근무일 0인 기사 수. */
  idleDriverCount: number;
  // ── 충족 ──
  /** 미배정 슬롯 / 전체 슬롯. */
  unfilledRate: number;
  /** 본인 차량 배정률. */
  homeBusRate: number;
  /** 교차 노선 비율. */
  crossRouteRate: number;
  /** 선호 노선 충족률. 입력에 선호 정보 없으면 null (하위 4에서 활성화). */
  preferenceSatisfactionRate: number | null;
  /** 선호 휴무(preferredDayOffs) 충족률. 대상 없으면 null. */
  dayOffSatisfactionRate: number | null;
  // ── 안전 ──
  /** 워크데이 밴드 하드위반 기사 수 (면제 제외, 솔버 값). */
  hardViolationCount: number;
  /** 헌법 룰 위반 수 (솔버 값). */
  constitutionalViolationCount: number;
  /** 룰별 위반 수 분해. */
  constitutionalByRule: Partial<Record<ConstitutionalRuleKey, number>>;
  /** 휴무 사이클 준수율 (솔버 값). */
  restCycleCompliance: number;
  // ── 종합 ──
  /** 0~100 가중 종합 점수 (측정용, 솔버 objective 와 별개). */
  compositeScore: number;
}

/** 모집단 표준편차 (/N). 빈 배열은 0. */
function stdev(xs: number[]): number {
  if (xs.length === 0) return 0;
  const mean = xs.reduce((s, x) => s + x, 0) / xs.length;
  const variance = xs.reduce((s, x) => s + (x - mean) ** 2, 0) / xs.length;
  return Math.sqrt(variance);
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

export function scheduleQuality(input: SolverInput, output: SolverOutput): QualityReport {
  const drivers = input.drivers;
  // 기사별 근무일 카운트 (전 기사 0으로 초기화 — 일 안 받은 기사 포함)
  const workDaysById = new Map<number, number>();
  for (const d of drivers) workDaysById.set(d.id, 0);
  for (const s of output.slots) {
    workDaysById.set(s.driverId, (workDaysById.get(s.driverId) ?? 0) + 1);
  }
  const workDays = drivers.map((d) => workDaysById.get(d.id) ?? 0);
  const idleDriverCount = workDays.filter((w) => w === 0).length;
  const activeDriverRate = drivers.length === 0 ? 0 : (drivers.length - idleDriverCount) / drivers.length;

  const totalSlots = output.slots.length + output.unfilled.length;
  const unfilledRate = totalSlots === 0 ? 0 : output.unfilled.length / totalSlots;

  const report: QualityReport = {
    workDayStdev: stdev(workDays),
    nightStdev: 0,
    weekendStdev: 0,
    activeDriverRate,
    spareUtilizationRate: null,
    idleDriverCount,
    unfilledRate,
    homeBusRate: output.metrics.homeBusRate,
    crossRouteRate: output.metrics.crossRouteRate,
    preferenceSatisfactionRate: null,
    dayOffSatisfactionRate: null,
    hardViolationCount: output.metrics.hardViolationCount,
    constitutionalViolationCount: output.metrics.constitutionalViolations.length,
    constitutionalByRule: {},
    restCycleCompliance: output.metrics.restCycleCompliance,
    compositeScore: 0,
  };
  return report;
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx jest src/agents/_solvers/__tests__/quality.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: 커밋**

```bash
git add src/agents/_solvers/quality.ts src/agents/_solvers/__tests__/quality.test.ts
git commit -m "feat(backtest): scheduleQuality scorer with workday-balance metrics (incl. idle drivers)"
```

---

### Task 3: 품질 스코어러 — 야간/주말 표준편차 (라벨 정규화)

**Files:**
- Modify: `packages/backend/src/agents/_solvers/quality.ts`
- Test: `packages/backend/src/agents/_solvers/__tests__/quality.test.ts`

- [ ] **Step 1: 실패 테스트 추가**

`quality.test.ts`에 describe 블록 추가:

```ts
describe('scheduleQuality — 야간/주말 라벨 정규화', () => {
  // 2026-05-02(토), 2026-05-03(일) 주말
  it('PM(2교대 야간) 분포를 nightStdev로 잡는다 (AM/PM 라벨 버그 회귀 방지)', () => {
    const input = baseInput([driver(1), driver(2)]);
    // D1이 PM 2개 독식, D2는 PM 0개
    const out = output([
      slot(1, '2026-05-05', 'PM'),
      slot(1, '2026-05-06', 'PM'),
      slot(2, '2026-05-05', 'AM'),
      slot(2, '2026-05-06', 'AM'),
    ]);
    const q = scheduleQuality(input, out);
    // night counts = [2, 0] => stdev = 1, 절대 0이면 안 됨(버그)
    expect(q.nightStdev).toBeGreaterThan(0);
    expect(q.nightStdev).toBeCloseTo(1, 5);
  });

  it('주말 근무 분포를 weekendStdev로 잡는다', () => {
    const input = baseInput([driver(1), driver(2)]);
    // 2026-05-02(토): D1만 근무
    const out = output([slot(1, '2026-05-02', 'AM'), slot(2, '2026-05-01', 'AM')]);
    const q = scheduleQuality(input, out);
    // weekend counts = [1, 0] => stdev = 0.5
    expect(q.weekendStdev).toBeCloseTo(0.5, 5);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx jest src/agents/_solvers/__tests__/quality.test.ts -t "라벨 정규화"`
Expected: FAIL — `nightStdev`/`weekendStdev`가 0으로 계산됨.

- [ ] **Step 3: 구현 추가**

`quality.ts`에 헬퍼 추가 (파일 상단, `stdev` 아래):

```ts
import type { ShiftSystemPolicy } from './types';

/** 정책별 "야간(비선호)" 시프트 라벨 집합. */
function nightLabels(shiftSystem: ShiftSystemPolicy): Set<string> {
  switch (shiftSystem.kind) {
    case 'TWO_SHIFT':
      return new Set(['PM']);
    case 'THREE_SHIFT':
      return new Set(['NIGHT']);
    // ONE_SHIFT / ALTERNATING_DAY 는 야간 구분 없음
    default:
      return new Set<string>();
  }
}

/** UTC 기준 주말(토=6, 일=0) 여부. */
function isWeekendDate(isoDate: string): boolean {
  const dow = new Date(`${isoDate}T00:00:00Z`).getUTCDay();
  return dow === 0 || dow === 6;
}
```

`scheduleQuality` 내부에서 workDays 계산 직후, night/weekend 카운트를 추가:

```ts
  const nightSet = nightLabels(input.policy.shiftSystem);
  const nightById = new Map<number, number>();
  const weekendById = new Map<number, number>();
  for (const d of drivers) {
    nightById.set(d.id, 0);
    weekendById.set(d.id, 0);
  }
  for (const s of output.slots) {
    if (nightSet.has(s.shift)) nightById.set(s.driverId, (nightById.get(s.driverId) ?? 0) + 1);
    if (isWeekendDate(s.date)) weekendById.set(s.driverId, (weekendById.get(s.driverId) ?? 0) + 1);
  }
```

그리고 report에서 두 필드를 실제 값으로 교체:

```ts
    nightStdev: stdev(drivers.map((d) => nightById.get(d.id) ?? 0)),
    weekendStdev: stdev(drivers.map((d) => weekendById.get(d.id) ?? 0)),
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx jest src/agents/_solvers/__tests__/quality.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: 커밋**

```bash
git add src/agents/_solvers/quality.ts src/agents/_solvers/__tests__/quality.test.ts
git commit -m "feat(backtest): night/weekend stdev with policy-aware shift-label normalization"
```

---

### Task 4: 품질 스코어러 — SPARE 활용률

**Files:**
- Modify: `packages/backend/src/agents/_solvers/quality.ts`
- Test: `packages/backend/src/agents/_solvers/__tests__/quality.test.ts`

- [ ] **Step 1: 실패 테스트 추가**

`quality.test.ts`에 추가:

```ts
describe('scheduleQuality — SPARE 활용률', () => {
  it('SPARE(홈버스 없음) 활용률 = SPARE평균 / HOME평균', () => {
    // HOME D1: 4일, SPARE D2(homeBusId 없음): 2일 => 2/4 = 0.5
    const home = driver(1, { homeBusId: 101 });
    const spare = driver(2, { homeBusId: undefined, canCrossRoute: true });
    const input = baseInput([home, spare]);
    const out = output([
      slot(1, '2026-05-01'), slot(1, '2026-05-02'), slot(1, '2026-05-03'), slot(1, '2026-05-04'),
      { date: '2026-05-01', busId: 200, routeId: 1, shift: 'AM', driverId: 2, familiarity: 'SAME_ROUTE', isHomeBus: false },
      { date: '2026-05-02', busId: 200, routeId: 1, shift: 'AM', driverId: 2, familiarity: 'SAME_ROUTE', isHomeBus: false },
    ]);
    const q = scheduleQuality(input, out);
    expect(q.spareUtilizationRate).toBeCloseTo(0.5, 5);
  });

  it('SPARE가 없으면 null', () => {
    const input = baseInput([driver(1, { homeBusId: 101 })]);
    const out = output([slot(1, '2026-05-01')]);
    const q = scheduleQuality(input, out);
    expect(q.spareUtilizationRate).toBeNull();
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx jest src/agents/_solvers/__tests__/quality.test.ts -t "SPARE"`
Expected: FAIL — `spareUtilizationRate`가 항상 null.

- [ ] **Step 3: 구현 추가**

`scheduleQuality` 내부, report 생성 전에 추가:

```ts
  const spareIds = drivers.filter((d) => d.homeBusId === undefined).map((d) => d.id);
  const homeIds = drivers.filter((d) => d.homeBusId !== undefined).map((d) => d.id);
  const avg = (ids: number[]) =>
    ids.length === 0 ? 0 : ids.reduce((s, id) => s + (workDaysById.get(id) ?? 0), 0) / ids.length;
  let spareUtilizationRate: number | null = null;
  if (spareIds.length > 0) {
    const homeAvg = avg(homeIds);
    spareUtilizationRate = homeAvg === 0 ? 0 : clamp(avg(spareIds) / homeAvg, 0, 1);
  }
```

report의 `spareUtilizationRate: null,`을 다음으로 교체:

```ts
    spareUtilizationRate,
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx jest src/agents/_solvers/__tests__/quality.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: 커밋**

```bash
git add src/agents/_solvers/quality.ts src/agents/_solvers/__tests__/quality.test.ts
git commit -m "feat(backtest): SPARE driver utilization rate metric"
```

---

### Task 5: 품질 스코어러 — 선호 휴무 충족률 + 종합 점수

**Files:**
- Modify: `packages/backend/src/agents/_solvers/quality.ts`
- Test: `packages/backend/src/agents/_solvers/__tests__/quality.test.ts`

- [ ] **Step 1: 실패 테스트 추가**

`quality.test.ts`에 추가:

```ts
describe('scheduleQuality — 선호 휴무 + 종합 점수', () => {
  it('선호 휴무를 지킨 비율을 계산한다', () => {
    // D1 선호휴무 2일 중 1일에 근무 배정됨 => 1/2 충족
    const d1 = driver(1, { preferredDayOffs: ['2026-05-10', '2026-05-11'] });
    const input = baseInput([d1]);
    const out = output([slot(1, '2026-05-10')]); // 10일엔 일함(미충족), 11일은 쉼(충족)
    const q = scheduleQuality(input, out);
    expect(q.dayOffSatisfactionRate).toBeCloseTo(0.5, 5);
  });

  it('선호 휴무가 아무에게도 없으면 null', () => {
    const input = baseInput([driver(1)]);
    const out = output([slot(1, '2026-05-01')]);
    expect(scheduleQuality(input, out).dayOffSatisfactionRate).toBeNull();
  });

  it('compositeScore는 0~100 범위이고 완벽한 그리드일수록 높다', () => {
    const input = baseInput([driver(1), driver(2)]);
    const balanced = output([slot(1, '2026-05-01'), slot(2, '2026-05-01')]);
    const q = scheduleQuality(input, balanced);
    expect(q.compositeScore).toBeGreaterThanOrEqual(0);
    expect(q.compositeScore).toBeLessThanOrEqual(100);
    // 불균형 + 미배정이 있으면 점수가 더 낮다
    const worse = output([slot(1, '2026-05-01'), slot(1, '2026-05-02')], 2);
    expect(scheduleQuality(input, worse).compositeScore).toBeLessThan(q.compositeScore);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx jest src/agents/_solvers/__tests__/quality.test.ts -t "선호 휴무"`
Expected: FAIL — `dayOffSatisfactionRate` null, `compositeScore` 0.

- [ ] **Step 3: 구현 추가**

`quality.ts` 상단에 가중치 상수 추가 (import 아래):

```ts
/**
 * compositeScore 가중치 (측정 전용 — 솔버 objective 와 독립).
 * 100 에서 각 항을 차감. 값은 "1 단위 악화당 몇 점 깎을지"이며,
 * 팀 규모와 무관하게 비교 가능하도록 비율/카운트 기반으로 정규화한다.
 */
const QUALITY_WEIGHTS = {
  workStdev: 8, // 근무일 1일 stdev 당 8점
  nightStdev: 4,
  weekendStdev: 4,
  unfilledRate: 40, // 미배정 비율(0~1)에 40점 (전부 미배정이면 -40)
  idleRatio: 20, // 유휴 기사 비율(0~1)에 20점
  hardViolationRatio: 30, // (하드위반 기사 / 전체기사) 비율에 30점
  constitutionalRatio: 30, // (헌법위반 / 전체기사) 비율에 30점
  restCycleShortfall: 30, // (1 - 준수율) 에 30점
} as const;
```

`scheduleQuality` 내부, report 생성 전에 dayOff 충족률과 헌법 룰 분해, composite 계산 추가:

```ts
  // 선호 휴무 충족률: preferredDayOffs 중 실제로 근무하지 않은 날의 비율
  const workedKey = new Set(output.slots.map((s) => `${s.driverId}|${s.date}`));
  let prefTotal = 0;
  let prefMet = 0;
  for (const d of drivers) {
    for (const day of d.preferredDayOffs ?? []) {
      prefTotal += 1;
      if (!workedKey.has(`${d.id}|${day}`)) prefMet += 1;
    }
  }
  const dayOffSatisfactionRate = prefTotal === 0 ? null : prefMet / prefTotal;

  // 헌법 룰 위반 분해
  const constitutionalByRule: Partial<Record<ConstitutionalRuleKey, number>> = {};
  for (const v of output.metrics.constitutionalViolations) {
    constitutionalByRule[v.ruleKey] = (constitutionalByRule[v.ruleKey] ?? 0) + 1;
  }

  const n = Math.max(1, drivers.length);
  const idleRatio = idleDriverCount / n;
  const hardViolationRatio = output.metrics.hardViolationCount / n;
  const constitutionalRatio = output.metrics.constitutionalViolations.length / n;
  const composite =
    100 -
    QUALITY_WEIGHTS.workStdev * stdev(workDays) -
    QUALITY_WEIGHTS.nightStdev * stdev(drivers.map((d) => nightById.get(d.id) ?? 0)) -
    QUALITY_WEIGHTS.weekendStdev * stdev(drivers.map((d) => weekendById.get(d.id) ?? 0)) -
    QUALITY_WEIGHTS.unfilledRate * unfilledRate -
    QUALITY_WEIGHTS.idleRatio * idleRatio -
    QUALITY_WEIGHTS.hardViolationRatio * hardViolationRatio -
    QUALITY_WEIGHTS.constitutionalRatio * constitutionalRatio -
    QUALITY_WEIGHTS.restCycleShortfall * (1 - output.metrics.restCycleCompliance);
```

report에서 해당 필드들을 교체:

```ts
    dayOffSatisfactionRate,
    constitutionalByRule,
    compositeScore: Math.round(clamp(composite, 0, 100) * 10) / 10,
```

(report 객체에서 기존의 `dayOffSatisfactionRate: null,`, `constitutionalByRule: {},`, `compositeScore: 0,` 라인을 위 값들로 대체한다.)

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx jest src/agents/_solvers/__tests__/quality.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 5: 컴파일 확인 + 커밋**

Run: `npx tsc --noEmit`
Expected: 에러 없음.

```bash
git add src/agents/_solvers/quality.ts src/agents/_solvers/__tests__/quality.test.ts
git commit -m "feat(backtest): day-off satisfaction + normalized composite quality score"
```

---

### Task 6: 결정론적 시나리오 빌더

**Files:**
- Create: `packages/backend/src/agents/_solvers/bench/scenarios.ts`
- Test: `packages/backend/src/agents/_solvers/__tests__/scenarios.test.ts`

기존 `scripts/dispatch-solver-backtest.ts:buildInput`의 합성 로직을 시드화하여 이전한다.

- [ ] **Step 1: 실패 테스트 작성**

`packages/backend/src/agents/_solvers/__tests__/scenarios.test.ts`:

```ts
import { buildScenario, type ScenarioSpec } from '../bench/scenarios';

const spec: ScenarioSpec = {
  label: 'test-city-medium',
  seed: 123,
  policy: 'CITY_2SHIFT',
  routes: 2,
  busesPerRoute: 5,
  sparesPerRoute: 2,
  weekdayOps: 0.95,
  weekendOps: 0.75,
  dayOffDensity: 0.3,
  year: 2026,
  month: 5,
};

describe('buildScenario', () => {
  it('같은 spec은 비트 단위로 동일한 SolverInput을 만든다', () => {
    expect(JSON.stringify(buildScenario(spec))).toEqual(JSON.stringify(buildScenario(spec)));
  });

  it('시드가 다르면 입력이 달라진다', () => {
    const a = buildScenario(spec);
    const b = buildScenario({ ...spec, seed: 999 });
    expect(JSON.stringify(a)).not.toEqual(JSON.stringify(b));
  });

  it('PAIR 모델: 노선당 buses*2 home + spares, crew 구성', () => {
    const input = buildScenario(spec);
    // 2 routes * (5 buses * 2 drivers + 2 spares) = 2*(10+2) = 24
    expect(input.drivers.length).toBe(24);
    expect(input.buses.length).toBe(10);
    expect(input.crews?.length).toBe(10);
    // spare 는 homeBusId 없음
    expect(input.drivers.filter((d) => d.homeBusId === undefined).length).toBe(4);
  });

  it('생성된 입력은 솔버가 받아들이는 형태다 (year/month/policy)', () => {
    const input = buildScenario(spec);
    expect(input.year).toBe(2026);
    expect(input.month).toBe(5);
    expect(input.policy.shiftSystem.kind).toBe('TWO_SHIFT');
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx jest src/agents/_solvers/__tests__/scenarios.test.ts`
Expected: FAIL — "Cannot find module '../bench/scenarios'".

- [ ] **Step 3: 최소 구현**

`packages/backend/src/agents/_solvers/bench/scenarios.ts`:

```ts
import { POLICY_PRESETS, type SolverCrew, type SolverDriver, type SolverInput } from '../types';
import { createRng, rngInt, rngFloat, rngChance, type Rng } from '../../../utils/seededRng';

export type PolicyKey = 'CITY_2SHIFT' | 'VILLAGE_1SHIFT';

export interface ScenarioSpec {
  /** 사람이 읽는 라벨 (리포트·비교 키). */
  label: string;
  /** 결정론 시드. */
  seed: number;
  policy: PolicyKey;
  routes: number;
  busesPerRoute: number;
  sparesPerRoute: number;
  /** 평일 운행률 (0~1). */
  weekdayOps: number;
  /** 휴일 운행률 (0~1). */
  weekendOps: number;
  /** 휴무 신청 밀도 (기사별 휴무 신청 확률, 0~1). */
  dayOffDensity: number;
  year: number;
  month: number;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function randomDayOffs(rng: Rng, year: number, month: number, count: number): string[] {
  if (count <= 0) return [];
  const daysInMonth = new Date(year, month, 0).getDate();
  const set = new Set<string>();
  let guard = 0;
  while (set.size < count && guard++ < 100) {
    set.add(`${year}-${pad(month)}-${pad(rngInt(rng, 1, daysInMonth))}`);
  }
  return Array.from(set).sort();
}

function buildOperatingDates(
  year: number,
  month: number,
  weekdayOps: number,
  weekendOps: number,
  busPositionInRoute: number,
  busesInRoute: number,
): string[] {
  const daysInMonth = new Date(year, month, 0).getDate();
  const dates: string[] = [];
  for (let d = 1; d <= daysInMonth; d++) {
    const dow = new Date(Date.UTC(year, month - 1, d)).getUTCDay();
    const isWeekend = dow === 0 || dow === 6;
    const opsRate = isWeekend ? weekendOps : weekdayOps;
    if (busPositionInRoute < Math.floor(busesInRoute * opsRate)) {
      dates.push(`${year}-${pad(month)}-${pad(d)}`);
    }
  }
  return dates;
}

/** spec → 결정론적 SolverInput. */
export function buildScenario(spec: ScenarioSpec): SolverInput {
  const rng = createRng(spec.seed);
  const drivers: SolverDriver[] = [];
  const buses: { id: number; routeId: number; operatingDates?: string[] }[] = [];
  const crews: SolverCrew[] = [];

  let driverId = 1;
  let busId = 1001;
  let crewCounter = 1;
  const oneShift = spec.policy === 'VILLAGE_1SHIFT';

  for (let r = 1; r <= spec.routes; r++) {
    const routeId = r * 100;
    for (let b = 0; b < spec.busesPerRoute; b++) {
      const bId = busId++;
      buses.push({
        id: bId,
        routeId,
        operatingDates: buildOperatingDates(spec.year, spec.month, spec.weekdayOps, spec.weekendOps, b, spec.busesPerRoute),
      });

      // 마을 1교대는 차당 1명, 시내 2교대는 차당 페어 2명
      const crewDriverIds: number[] = [];
      const crewSize = oneShift ? 1 : 2;
      for (let m = 0; m < crewSize; m++) {
        const id = driverId++;
        crewDriverIds.push(id);
        drivers.push({
          id,
          name: `R${r}-차${b + 1}-${String.fromCharCode(65 + m)}`,
          homeBusId: bId,
          homeRouteId: routeId,
          partnerId: crewSize === 2 ? (m === 0 ? id + 1 : id - 1) : undefined,
          canCrossRoute: false,
          approvedDayOffs: rngChance(rng, spec.dayOffDensity)
            ? randomDayOffs(rng, spec.year, spec.month, rngInt(rng, 1, 2))
            : [],
          recentFatigueScore: rngFloat(rng, 20, 60),
          isNewHire: false,
        });
      }
      crews.push({ id: `C${crewCounter++}`, driverIds: crewDriverIds, busId: bId, routeId });
    }

    // 노선별 SPARE 풀 (homeBusId 없음)
    for (let s = 0; s < spec.sparesPerRoute; s++) {
      drivers.push({
        id: driverId++,
        name: `R${r}-여유${s + 1}`,
        homeRouteId: routeId,
        canCrossRoute: false,
        approvedDayOffs: rngChance(rng, spec.dayOffDensity)
          ? randomDayOffs(rng, spec.year, spec.month, rngInt(rng, 1, 2))
          : [],
        recentFatigueScore: rngFloat(rng, 15, 45),
        isNewHire: s === 0 && r === 1,
      });
    }
  }

  return {
    year: spec.year,
    month: spec.month,
    drivers,
    buses,
    crews,
    policy: spec.policy === 'VILLAGE_1SHIFT' ? POLICY_PRESETS.VILLAGE_1SHIFT : POLICY_PRESETS.CITY_2SHIFT,
    localSearchIterations: 2000,
  };
}
```

> 확인됨: `POLICY_PRESETS`에 `CITY_2SHIFT`와 `VILLAGE_1SHIFT` 두 키가 모두 존재한다 (`PolicyPreset = 'CITY_2SHIFT' | 'VILLAGE_1SHIFT'`, types.ts:304). 추가 대응 불필요.

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx jest src/agents/_solvers/__tests__/scenarios.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: 커밋**

```bash
git add src/agents/_solvers/bench/scenarios.ts src/agents/_solvers/__tests__/scenarios.test.ts
git commit -m "feat(backtest): deterministic synthetic scenario builder"
```

---

### Task 7: 시나리오 스위트 (매트릭스)

**Files:**
- Modify: `packages/backend/src/agents/_solvers/bench/scenarios.ts`
- Test: `packages/backend/src/agents/_solvers/__tests__/scenarios.test.ts`

- [ ] **Step 1: 실패 테스트 추가**

`scenarios.test.ts`에 추가:

```ts
import { SCENARIO_SUITE } from '../bench/scenarios';

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
    for (const spec of SCENARIO_SUITE) {
      expect(() => buildScenario(spec)).not.toThrow();
    }
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx jest src/agents/_solvers/__tests__/scenarios.test.ts -t "SCENARIO_SUITE"`
Expected: FAIL — `SCENARIO_SUITE` export 없음.

- [ ] **Step 3: 구현 추가**

`scenarios.ts` 끝에 추가:

```ts
type Shape = Omit<ScenarioSpec, 'label' | 'seed'>;

const SHAPES: { name: string; shape: Shape }[] = [
  // 시내 2교대 — 인력 여유 3단계
  { name: 'city-tight', shape: { policy: 'CITY_2SHIFT', routes: 3, busesPerRoute: 12, sparesPerRoute: 1, weekdayOps: 0.95, weekendOps: 0.8, dayOffDensity: 0.4, year: 2026, month: 5 } },
  { name: 'city-balanced', shape: { policy: 'CITY_2SHIFT', routes: 3, busesPerRoute: 12, sparesPerRoute: 4, weekdayOps: 0.95, weekendOps: 0.75, dayOffDensity: 0.3, year: 2026, month: 5 } },
  { name: 'city-loose', shape: { policy: 'CITY_2SHIFT', routes: 3, busesPerRoute: 12, sparesPerRoute: 7, weekdayOps: 0.9, weekendOps: 0.7, dayOffDensity: 0.2, year: 2026, month: 5 } },
  // 마을 1교대
  { name: 'village-tight', shape: { policy: 'VILLAGE_1SHIFT', routes: 2, busesPerRoute: 8, sparesPerRoute: 1, weekdayOps: 0.95, weekendOps: 0.85, dayOffDensity: 0.4, year: 2026, month: 5 } },
  { name: 'village-balanced', shape: { policy: 'VILLAGE_1SHIFT', routes: 2, busesPerRoute: 8, sparesPerRoute: 3, weekdayOps: 0.9, weekendOps: 0.8, dayOffDensity: 0.3, year: 2026, month: 5 } },
  // 소규모
  { name: 'small-city', shape: { policy: 'CITY_2SHIFT', routes: 1, busesPerRoute: 6, sparesPerRoute: 2, weekdayOps: 0.95, weekendOps: 0.75, dayOffDensity: 0.3, year: 2026, month: 5 } },
  // 대규모 (성민 규모)
  { name: 'large-city', shape: { policy: 'CITY_2SHIFT', routes: 3, busesPerRoute: 14, sparesPerRoute: 4, weekdayOps: 0.95, weekendOps: 0.75, dayOffDensity: 0.3, year: 2026, month: 5 } },
];

const SEEDS = [1001, 2002, 3003];

/** 형태 × 시드 매트릭스. */
export const SCENARIO_SUITE: ScenarioSpec[] = SHAPES.flatMap(({ name, shape }) =>
  SEEDS.map((seed) => ({ ...shape, label: `${name}#${seed}`, seed })),
);
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx jest src/agents/_solvers/__tests__/scenarios.test.ts`
Expected: PASS (7 tests). (7 shapes × 3 seeds = 21 ≥ 18)

- [ ] **Step 5: 커밋**

```bash
git add src/agents/_solvers/bench/scenarios.ts src/agents/_solvers/__tests__/scenarios.test.ts
git commit -m "feat(backtest): scenario suite matrix (shapes x seeds)"
```

---

### Task 8: 하니스 코어 (실행·집계·게이트·비교)

**Files:**
- Create: `packages/backend/src/agents/_solvers/bench/harness.ts`
- Test: `packages/backend/src/agents/_solvers/__tests__/harness.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

`packages/backend/src/agents/_solvers/__tests__/harness.test.ts`:

```ts
import { runSuite, aggregate, evaluateGates, compareToBaseline, DEFAULT_GATES } from '../bench/harness';
import { SCENARIO_SUITE } from '../bench/scenarios';

describe('harness', () => {
  it('runSuite는 각 시나리오에 대해 결과(또는 error)를 반환한다', () => {
    const small = SCENARIO_SUITE.filter((s) => s.label.startsWith('small-city')).slice(0, 1);
    const results = runSuite(small);
    expect(results.length).toBe(small.length);
    expect(results[0].label).toBe(small[0].label);
    // 정상 시나리오면 quality가 있고 error가 없다
    expect(results[0].error).toBeUndefined();
    expect(results[0].quality?.compositeScore).toBeGreaterThanOrEqual(0);
  });

  it('aggregate는 지표별 min/median/p25/mean을 낸다', () => {
    const stats = aggregate([
      { label: 'a', spec: {} as never, elapsedMs: 1, quality: q(80) },
      { label: 'b', spec: {} as never, elapsedMs: 1, quality: q(60) },
      { label: 'c', spec: {} as never, elapsedMs: 1, quality: q(100) },
    ]);
    expect(stats.compositeScore.min).toBe(60);
    expect(stats.compositeScore.median).toBe(80);
    expect(stats.compositeScore.mean).toBeCloseTo(80, 5);
  });

  it('evaluateGates는 절대 목표 위반을 잡는다', () => {
    const bad = [{ label: 'x', spec: {} as never, elapsedMs: 1, quality: { ...q(50), hardViolationCount: 3 } }];
    const report = evaluateGates(bad, DEFAULT_GATES);
    expect(report.passed).toBe(false);
    expect(report.failures.some((f) => f.includes('hardViolationCount'))).toBe(true);
  });

  it('compareToBaseline은 지표 델타를 만든다', () => {
    const cur = aggregate([{ label: 'a', spec: {} as never, elapsedMs: 1, quality: q(90) }]);
    const base = aggregate([{ label: 'a', spec: {} as never, elapsedMs: 1, quality: q(70) }]);
    const delta = compareToBaseline(cur, base);
    expect(delta.compositeScore.delta).toBeCloseTo(20, 5);
  });
});

// 헬퍼: 최소 QualityReport
function q(composite: number) {
  return {
    workDayStdev: 0, nightStdev: 0, weekendStdev: 0, activeDriverRate: 1, spareUtilizationRate: null,
    idleDriverCount: 0, unfilledRate: 0, homeBusRate: 1, crossRouteRate: 0, preferenceSatisfactionRate: null,
    dayOffSatisfactionRate: null, hardViolationCount: 0, constitutionalViolationCount: 0, constitutionalByRule: {},
    restCycleCompliance: 1, compositeScore: composite,
  };
}
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx jest src/agents/_solvers/__tests__/harness.test.ts`
Expected: FAIL — "Cannot find module '../bench/harness'".

- [ ] **Step 3: 최소 구현**

`packages/backend/src/agents/_solvers/bench/harness.ts`:

```ts
import { solveMonthlyGrid } from '../monthly-grid-solver';
import { scheduleQuality, type QualityReport } from '../quality';
import { buildScenario, type ScenarioSpec } from './scenarios';

export interface ScenarioResult {
  label: string;
  spec: ScenarioSpec;
  elapsedMs: number;
  quality?: QualityReport;
  error?: string;
}

/** 스위트의 각 시나리오를 풀고 품질을 측정. 한 시나리오 실패가 전체를 막지 않는다. */
export function runSuite(specs: ScenarioSpec[]): ScenarioResult[] {
  return specs.map((spec) => {
    const start = Date.now();
    try {
      const input = buildScenario(spec);
      const output = solveMonthlyGrid(input);
      return { label: spec.label, spec, elapsedMs: Date.now() - start, quality: scheduleQuality(input, output) };
    } catch (err) {
      return { label: spec.label, spec, elapsedMs: Date.now() - start, error: err instanceof Error ? err.message : String(err) };
    }
  });
}

/** 숫자형 지표 키 (집계 대상). */
const NUMERIC_KEYS = [
  'workDayStdev', 'nightStdev', 'weekendStdev', 'activeDriverRate', 'idleDriverCount',
  'unfilledRate', 'homeBusRate', 'crossRouteRate', 'hardViolationCount',
  'constitutionalViolationCount', 'restCycleCompliance', 'compositeScore',
] as const;
type NumericKey = (typeof NUMERIC_KEYS)[number];

export interface Stat {
  min: number;
  p25: number;
  median: number;
  mean: number;
  max: number;
}
export type Aggregate = Record<NumericKey, Stat>;

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor(p * (sorted.length - 1)));
  return sorted[idx];
}

function statOf(values: number[]): Stat {
  const xs = [...values].sort((a, b) => a - b);
  const mean = xs.length === 0 ? 0 : xs.reduce((s, x) => s + x, 0) / xs.length;
  return { min: xs[0] ?? 0, p25: percentile(xs, 0.25), median: percentile(xs, 0.5), mean, max: xs[xs.length - 1] ?? 0 };
}

/** 정상 결과들의 지표별 분포 통계. */
export function aggregate(results: ScenarioResult[]): Aggregate {
  const ok = results.filter((r) => r.quality);
  const out = {} as Aggregate;
  for (const key of NUMERIC_KEYS) {
    out[key] = statOf(ok.map((r) => r.quality![key] as number));
  }
  return out;
}

export interface GateSpec {
  /** workDayStdev 중앙값 상한. */
  maxWorkDayStdevMedian: number;
  /** 하드위반 합계 상한. */
  maxHardViolationTotal: number;
  /** 미배정률 중앙값 상한. */
  maxUnfilledRateMedian: number;
  /** restCycle 준수율 최소값 하한. */
  minRestCycleComplianceMin: number;
  /** 헌법위반 합계 상한. */
  maxConstitutionalTotal: number;
}

export const DEFAULT_GATES: GateSpec = {
  maxWorkDayStdevMedian: 0.8,
  maxHardViolationTotal: 0,
  maxUnfilledRateMedian: 0,
  minRestCycleComplianceMin: 1,
  maxConstitutionalTotal: 0,
};

export interface GateReport {
  passed: boolean;
  failures: string[];
}

export function evaluateGates(results: ScenarioResult[], gates: GateSpec): GateReport {
  const ok = results.filter((r) => r.quality);
  const failures: string[] = [];
  const errored = results.filter((r) => r.error);
  if (errored.length > 0) failures.push(`solver errors: ${errored.map((r) => r.label).join(', ')}`);

  const agg = aggregate(ok);
  if (agg.workDayStdev.median > gates.maxWorkDayStdevMedian)
    failures.push(`workDayStdev median ${agg.workDayStdev.median.toFixed(2)} > ${gates.maxWorkDayStdevMedian}`);
  const hardTotal = ok.reduce((s, r) => s + (r.quality!.hardViolationCount), 0);
  if (hardTotal > gates.maxHardViolationTotal)
    failures.push(`hardViolationCount total ${hardTotal} > ${gates.maxHardViolationTotal}`);
  if (agg.unfilledRate.median > gates.maxUnfilledRateMedian)
    failures.push(`unfilledRate median ${agg.unfilledRate.median.toFixed(3)} > ${gates.maxUnfilledRateMedian}`);
  if (agg.restCycleCompliance.min < gates.minRestCycleComplianceMin)
    failures.push(`restCycleCompliance min ${agg.restCycleCompliance.min.toFixed(3)} < ${gates.minRestCycleComplianceMin}`);
  const constTotal = ok.reduce((s, r) => s + r.quality!.constitutionalViolationCount, 0);
  if (constTotal > gates.maxConstitutionalTotal)
    failures.push(`constitutionalViolation total ${constTotal} > ${gates.maxConstitutionalTotal}`);

  return { passed: failures.length === 0, failures };
}

export interface DeltaReport {
  [key: string]: { current: number; baseline: number; delta: number };
}

/** 현재 집계 vs baseline 집계의 중앙값 델타. */
export function compareToBaseline(current: Aggregate, baseline: Aggregate): DeltaReport {
  const out: DeltaReport = {};
  for (const key of NUMERIC_KEYS) {
    const cur = current[key].median;
    const base = baseline[key].median;
    out[key] = { current: cur, baseline: base, delta: cur - base };
  }
  return out;
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx jest src/agents/_solvers/__tests__/harness.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: 컴파일 확인 + 커밋**

Run: `npx tsc --noEmit`
Expected: 에러 없음.

```bash
git add src/agents/_solvers/bench/harness.ts src/agents/_solvers/__tests__/harness.test.ts
git commit -m "feat(backtest): harness core — runSuite, aggregate, gates, baseline compare"
```

---

### Task 9: CLI 러너 + npm 스크립트 + 구 스크립트 제거

**Files:**
- Create: `packages/backend/scripts/backtest/solver-harness.ts`
- Delete: `packages/backend/scripts/dispatch-solver-backtest.ts`
- Modify: `packages/backend/package.json`

- [ ] **Step 1: CLI 작성**

`packages/backend/scripts/backtest/solver-harness.ts`:

```ts
/**
 * 솔버 측정 하니스 CLI — 순수(in-memory), DB·LLM 없음.
 *
 * 실행:
 *   npm run backtest:solver
 *   npm run backtest:solver -- --json --out=scripts/backtest/baselines/solver-baseline.json
 *   npm run backtest:solver -- --baseline=scripts/backtest/baselines/solver-baseline.json
 *
 * 종료 코드: 0 = 게이트 통과, 1 = 미달.
 */
import fs from 'fs';
import path from 'path';
import { SCENARIO_SUITE } from '../../src/agents/_solvers/bench/scenarios';
import {
  runSuite,
  aggregate,
  evaluateGates,
  compareToBaseline,
  DEFAULT_GATES,
  type Aggregate,
} from '../../src/agents/_solvers/bench/harness';

function getFlag(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (hit) return hit.split('=')[1];
  return process.argv.includes(`--${name}`) ? 'true' : undefined;
}

const results = runSuite(SCENARIO_SUITE);
const agg = aggregate(results);
const gate = evaluateGates(results, DEFAULT_GATES);

const sep = '═'.repeat(78);
console.log(sep);
console.log(`솔버 측정 하니스 — ${results.length}개 시나리오`);
console.log(sep);
for (const r of results) {
  if (r.error) {
    console.log(`  ✗ ${r.label}: ERROR ${r.error}`);
  } else {
    const q = r.quality!;
    console.log(
      `  ${r.label}: 종합 ${q.compositeScore} | 근무stdev ${q.workDayStdev.toFixed(2)} | ` +
        `미배정 ${(q.unfilledRate * 100).toFixed(1)}% | 하드 ${q.hardViolationCount} | ` +
        `유휴 ${q.idleDriverCount} | SPARE활용 ${q.spareUtilizationRate === null ? '-' : (q.spareUtilizationRate * 100).toFixed(0) + '%'} | ${r.elapsedMs}ms`,
    );
  }
}
console.log(sep);
const fmt = (s: { min: number; p25: number; median: number; mean: number; max: number }) =>
  `min ${s.min.toFixed(2)} / p25 ${s.p25.toFixed(2)} / median ${s.median.toFixed(2)} / mean ${s.mean.toFixed(2)} / max ${s.max.toFixed(2)}`;
console.log(`종합점수      ${fmt(agg.compositeScore)}`);
console.log(`근무일 stdev  ${fmt(agg.workDayStdev)}`);
console.log(`미배정률      ${fmt(agg.unfilledRate)}`);
console.log(`restCycle     ${fmt(agg.restCycleCompliance)}`);
console.log(sep);
console.log(`게이트: ${gate.passed ? '✓ 통과' : '✗ 미달'}`);
for (const f of gate.failures) console.log(`  ✗ ${f}`);
console.log(sep);

// baseline 비교
const baselinePath = getFlag('baseline');
if (baselinePath) {
  const base = JSON.parse(fs.readFileSync(path.resolve(baselinePath), 'utf-8')) as Aggregate;
  const delta = compareToBaseline(agg, base);
  console.log('baseline 대비 (중앙값 델타):');
  for (const [k, v] of Object.entries(delta)) {
    const arrow = v.delta > 0 ? '▲' : v.delta < 0 ? '▼' : '=';
    console.log(`  ${k}: ${v.baseline.toFixed(3)} → ${v.current.toFixed(3)} (${arrow}${Math.abs(v.delta).toFixed(3)})`);
  }
  console.log(sep);
}

// JSON 출력
if (getFlag('json') || getFlag('out')) {
  const outPath = getFlag('out');
  const payload = JSON.stringify(agg, null, 2);
  if (outPath) {
    fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
    fs.writeFileSync(path.resolve(outPath), payload);
    console.log(`집계 JSON 저장: ${outPath}`);
  } else {
    console.log(payload);
  }
}

process.exit(gate.passed ? 0 : 1);
```

- [ ] **Step 2: 구 스크립트 제거**

```bash
git rm scripts/dispatch-solver-backtest.ts
```

- [ ] **Step 3: npm 스크립트 추가**

`packages/backend/package.json`의 `scripts`에 한 줄 추가 (기존 `backtest:dispatch` 라인 아래):

```json
    "backtest:solver": "ts-node scripts/backtest/solver-harness.ts",
```

- [ ] **Step 4: 실행 스모크**

Run: `npm run backtest:solver`
Expected: 21개 시나리오 결과 + 분포 + 게이트 라인이 출력된다. (게이트는 통과/미달 무관 — 출력 형식이 정상이면 OK. 미달이면 exitCode 1이지만 출력은 정상.)

- [ ] **Step 5: 커밋**

```bash
git add scripts/backtest/solver-harness.ts package.json
git commit -m "feat(backtest): solver-harness CLI + npm script; remove legacy dispatch-solver-backtest"
```

---

### Task 10: 현재 솔버 baseline 커밋

**Files:**
- Create: `packages/backend/scripts/backtest/baselines/solver-baseline.json`

- [ ] **Step 1: baseline 생성**

Run: `npm run backtest:solver -- --out=scripts/backtest/baselines/solver-baseline.json`
Expected: `집계 JSON 저장: scripts/backtest/baselines/solver-baseline.json` 출력. 파일이 생성됨.

- [ ] **Step 2: baseline 내용 확인**

Run: `cat scripts/backtest/baselines/solver-baseline.json`
Expected: `compositeScore`, `workDayStdev` 등 각 지표의 min/p25/median/mean/max를 담은 유효한 JSON.

- [ ] **Step 3: 비교 모드 동작 확인**

Run: `npm run backtest:solver -- --baseline=scripts/backtest/baselines/solver-baseline.json`
Expected: "baseline 대비 (중앙값 델타)" 표가 출력되고 모든 델타가 0.000 (같은 솔버이므로).

- [ ] **Step 4: 커밋**

```bash
git add scripts/backtest/baselines/solver-baseline.json
git commit -m "chore(backtest): commit current solver quality baseline for sub-project 2-4 comparison"
```

---

### Task 11: 전체 검증

- [ ] **Step 1: 전체 테스트**

Run: `npx jest src/utils/__tests__/seededRng.test.ts src/agents/_solvers/__tests__/quality.test.ts src/agents/_solvers/__tests__/scenarios.test.ts src/agents/_solvers/__tests__/harness.test.ts`
Expected: 4개 스위트 모두 PASS.

- [ ] **Step 2: 타입 체크**

Run: `npx tsc --noEmit`
Expected: 에러 없음.

- [ ] **Step 3: 기존 솔버 테스트 회귀 없음**

Run: `npx jest src/agents/_solvers/__tests__/monthly-grid-solver.test.ts`
Expected: 기존 테스트 PASS (솔버 미변경 확인).

- [ ] **Step 4: 결정론 재확인**

Run: `npm run backtest:solver -- --out=/tmp/run1.json && npm run backtest:solver -- --out=/tmp/run2.json && diff /tmp/run1.json /tmp/run2.json && echo "DETERMINISTIC OK"`
Expected: `DETERMINISTIC OK` (두 실행 결과가 동일).

---

## Self-Review 결과

**Spec coverage:**
- `quality.ts` 단일 스코어러 → Task 2–5 ✓ (균형·야간라벨·SPARE·선호휴무·종합)
- 야간 라벨 버그 / 0일 기사 포함 → Task 2, 3 ✓
- SPARE 활용률 → Task 4 ✓
- 선호휴무 실측(위조값 대체) → Task 5 ✓ / 선호노선은 `preferenceSatisfactionRate: null`로 스키마 유지(데이터 미존재, 하위 4에서 활성화) — 스펙의 "입력에 선호 없으면 null"과 일치 ✓
- 시드 RNG 결정론 + 중복 제거 → Task 1 ✓
- 합성 시나리오 매트릭스(정책×여유×밀도×규모) → Task 6, 7 ✓
- 분포 집계 + 절대 게이트 + JSON 비교 → Task 8, 9 ✓
- npm 등록 + 구 스크립트 대체 → Task 9 ✓
- baseline 커밋 → Task 10 ✓
- 솔버 objective 불변 → 어떤 Task도 `monthly-grid-solver.ts`/`objective`를 수정하지 않음; Task 11 Step 3로 회귀 확인 ✓

**Placeholder scan:** 모든 코드 스텝에 실제 코드 포함. "적절히 처리" 류 없음.

**Type consistency:** `QualityReport` 필드명이 Task 2→3→4→5 및 harness `NUMERIC_KEYS`/테스트 헬퍼 `q()`와 일치. `ScenarioSpec`/`buildScenario`/`SCENARIO_SUITE`/`runSuite`/`aggregate`/`evaluateGates`/`compareToBaseline`/`DEFAULT_GATES` 시그니처가 Task 6–9에서 일관.

**확인 완료:** `POLICY_PRESETS`에 `CITY_2SHIFT`/`VILLAGE_1SHIFT` 두 키 모두 존재 (types.ts:304) — 미해결 항목 없음.
