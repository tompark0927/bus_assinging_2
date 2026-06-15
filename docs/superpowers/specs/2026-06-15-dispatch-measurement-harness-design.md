# 배차 측정 잣대 (Dispatch Measurement Harness) — 설계 문서

- 날짜: 2026-06-15
- 상위 프로그램: 배차 AI 종합 개선 (A안: 측정 → 데이터 연결 → 안전 강제 → 최적화)
- 본 문서 범위: **하위 프로젝트 1 — 측정 잣대 구축**

## 1. 목적과 동기

배차 AI를 "더 정확하고 효율적"으로 개선하려면, 먼저 **믿을 수 있는 측정 잣대**가 있어야 한다. 변경 전후를 객관적 수치로 비교할 수 없으면 "개선했다"를 증명할 수 없다.

현재 측정 인프라의 문제:

1. **순수 솔버 백테스트(`scripts/dispatch-solver-backtest.ts`)가 비결정론적이다.** 합성 입력을 `Math.random()`으로 생성(`:113-114,124,153,192`)하므로 매 실행이 달라 before/after 1:1 비교가 불가능하다. npm 스크립트에도 등록돼 있지 않다.
2. **효율(활용률)을 재는 지표가 없다.** SPARE 기사 유휴/활용률을 측정하는 코드가 어디에도 없다. 일을 전혀 안 받은 기사는 fairness 집계에서 아예 빠진다(`fairness.ts:121-144`) — 가장 불공정한 결과가 점수에 안 잡힌다.
3. **품질 공식이 두 갈래로 갈려 있다.** 솔버 리포트(`monthly-grid-solver.ts:1040`)와 에이전트용(`fairness.ts:191`)이 서로 다르고, 야간 공정성은 AM/PM 라벨 불일치로 사실상 측정되지 않는다(`fairness.ts:81-85` vs 솔버의 `AM/PM`).
4. **단일 시나리오·단일 실행**이라 분포(min/중앙값/p25)를 모른 채 통과/실패만 본다.
5. **느슨한 게이트.** 에이전트 백테스트는 "+20 개선이면 통과"(`dispatch-simulation.ts:199-207`)라 절대 품질이 낮아도 통과할 수 있다.

본 하위 프로젝트는 **솔버 출력 품질을 결정론적·다차원·다시나리오로 측정**하는 도구를 만든다. 이 잣대가 생긴 뒤에야 하위 프로젝트 2~4(데이터 연결, 안전 강제, 최적화)의 효과를 깨끗이 증명할 수 있다.

## 2. 범위

### 포함
- 순수(in-memory) 솔버 품질 측정: `SolverInput → solveMonthlyGrid → QualityReport`. DB·LLM 미포함.
- 단일 품질 스코어러 `scheduleQuality(input, output)` — 측정의 단일 진실원.
- 결정론적 합성 시나리오 스위트(고정 시드 × 회사 형태 매트릭스).
- baseline ↔ candidate 비교 + 절대 목표 게이트 + 기계판독(JSON) 출력.
- 기존 `dispatch-solver-backtest.ts` 확장/대체 및 npm 스크립트 등록.

### 제외 (명시적 비범위)
- **솔버 내부 목적함수(`objective`, `candidateCost`) 변경 금지.** 본 프로젝트는 *측정 도구만* 만든다. 솔버 목적함수를 측정 스코어에 정렬하는 일은 하위 프로젝트 4의 작업이다. (측정기가 솔버보다 먼저 바뀌면 안 됨 — 잣대의 독립성 유지.)
- 프로덕션 DB에 쓰는 LLM 에이전트 백테스트(`scripts/backtest-dispatch.ts`)의 contamination 위험 제거 — **별도 건**으로 분리.
- 실데이터 파생 시나리오 — 이번엔 합성 스위트만 (사용자 결정).

## 3. 아키텍처

세 개의 독립 단위로 구성한다. 각 단위는 단일 책임을 가지며 독립적으로 테스트 가능하다.

```
scenarios.ts ──(SolverInput[])──> [solveMonthlyGrid] ──(SolverOutput)──> quality.ts
   (시드 생성)                         (기존, 불변)                      (scheduleQuality)
                                                                            │
                                                                       QualityReport
                                                                            │
                                          harness.ts (스위트 실행·비교·게이트·JSON 출력)
```

### 3.1 `quality.ts` — 단일 품질 스코어러
- 위치: `src/agents/_solvers/quality.ts`
- 순수 함수: `scheduleQuality(input: SolverInput, output: SolverOutput): QualityReport`
- 솔버가 이미 계산한 `SolverMetrics`를 입력으로 받되, **누락·왜곡 지표를 자체 재계산**한다(솔버 내부를 바꾸지 않기 위해 측정기 쪽에서 보강).

`QualityReport` 필드:

| 분류 | 필드 | 정의 / 현재 문제 해결 |
|---|---|---|
| 균형 | `workDayStdev` | 근무일수 표준편차. **전 활성 기사 포함**(0일 기사도) — 현재 누락 해결 |
| 균형 | `nightStdev` | 야간 시프트 표준편차. **솔버 시프트 라벨(AM/PM 등)을 정규화**해 실제 야간 측정 — 라벨 버그 해결 |
| 균형 | `weekendStdev` | 주말 근무 표준편차 (전 기사 포함) |
| 활용 | `activeDriverRate` | 한 슬롯이라도 받은 기사 / 전 활성 기사 |
| 활용 | `spareUtilizationRate` | SPARE 기사 평균 근무일 / 기대치 — **신규 지표(효율 핵심)** |
| 활용 | `idleDriverCount` | 0일 기사 수 (과잉 인력 또는 배정 실패 신호) |
| 충족 | `unfilledRate` | 미배정 슬롯 / 전체 슬롯 |
| 충족 | `homeBusRate`, `crossRouteRate` | 솔버 값 통합 |
| 충족 | `preferenceSatisfactionRate` | 선호 노선 충족률 — **신규**(하위 4에서 선호 연결 시 효과 측정용). 입력에 선호 없으면 `null` |
| 충족 | `dayOffSatisfactionRate` | 선호 휴무 충족률 — 실제 계산(현재 1로 위조된 값 대체) |
| 안전 | `hardViolationCount` | 워크데이 밴드 하드위반 (면제 제외) |
| 안전 | `constitutionalViolationCount` | 헌법 룰 위반 수(룰별 분해 포함) |
| 안전 | `restCycleCompliance` | 휴무 사이클 준수율 |
| 종합 | `compositeScore` | 위 지표들의 가중합 0~100. **문서화된 가중치**(매직넘버 금지), 팀 크기·월 길이로 정규화해 포화(0 붕괴) 방지 |

설계 원칙:
- 야간/주말 판정은 **시프트 라벨 정규화 맵**을 통해 일관 처리(시내 2교대 AM/PM, 3교대 MORNING/AFTERNOON/NIGHT, 마을 1교대 등 정책별 매핑).
- `compositeScore` 가중치는 파일 상단 상수로 모아 주석에 근거를 단다. 측정용이므로 솔버 `objective`와 별개이되, 같은 차원을 포함하도록 설계(추후 정렬 용이).
- 0명·빈 입력 등 엣지케이스에서 NaN/예외 없이 정의된 값 반환.

### 3.2 `scenarios.ts` — 결정론적 합성 시나리오 스위트
- 위치: `scripts/backtest/scenarios.ts`
- **시드 RNG 통합**: 중복된 `mulberry32`(`dispatch-scenario-generator.ts:87`, `scenario-generator.ts:54`)를 공용 유틸 `src/utils/seededRng.ts`로 추출해 재사용.
- `buildScenario(spec: ScenarioSpec): SolverInput` — 시드와 형태 파라미터로 완전 결정론적 입력 생성. 기존 `dispatch-solver-backtest.ts:buildInput`의 합성 로직을 시드화하여 이전.
- **시나리오 매트릭스** (`ScenarioSpec[]`): 고정 시드 × 형태:
  - 정책: 시내 2교대(`CITY_2SHIFT`), 마을 1교대(`VILLAGE_1SHIFT`)
  - 인력 여유: 빠듯(기사:슬롯 비율 낮음) / 적정 / 여유
  - 휴무 신청 밀도: 낮음/보통/높음
  - 특수: 신입+면제 포함, SPARE 풀 포함
  - 규모: 소(~30명)·중(~96명)·대(성민 ~152명)
  - 각 형태 × 2~3 시드 → 약 20~30개 시나리오
- 각 시나리오는 라벨과 메타(예상 baseline 난이도)를 갖는다.

### 3.3 `harness.ts` — 실행·비교·게이트·출력
- 위치: `scripts/backtest/solver-harness.ts` (기존 `dispatch-solver-backtest.ts` 대체)
- 동작:
  1. 스위트의 각 시나리오에 대해 `solveMonthlyGrid` 실행 → `scheduleQuality` 적용 → `QualityReport` 수집.
  2. **분포 집계**: 지표별 min/중앙값/p25/평균 보고.
  3. **절대 목표 게이트**: 예) `workDayStdev < 0.8`, `hardViolationCount == 0`, `unfilledRate == 0`(인력 충분 시나리오), `restCycleCompliance == 1`, `spareUtilizationRate ≥` 하한. 시나리오별 통과/실패 + 전체 게이트.
  4. **비교 모드**: `--baseline <file.json> --out <file.json>`. 현재 결과를 JSON으로 저장하고, baseline JSON과 지표 델타(개선/악화)를 표로 출력. → 하위 2~4 각 변경의 효과를 자동 비교.
  5. CLI 플래그: `--seed`, `--scenarios=<glob/label>`, `--json`, `--baseline`, `--out`. 시드 고정 시 재현 가능.
  6. 게이트 미달 시 `process.exitCode=1` (CI 연동).
- npm 스크립트 등록: `"backtest:solver": "ts-node scripts/backtest/solver-harness.ts"`, 비교용 예시 문서화.

## 4. 데이터 흐름

```
ScenarioSpec(시드+형태)
  → buildScenario  → SolverInput (결정론적)
  → solveMonthlyGrid (기존, 불변)  → SolverOutput
  → scheduleQuality  → QualityReport
  → harness: 분포 집계 + 절대 게이트 + (옵션) baseline 델타 + JSON 출력
```

## 5. 에러 처리
- 솔버가 던지는 경우(예: crew 검증 실패) 해당 시나리오를 `error` 상태로 기록하고 나머지는 계속 실행(전체 중단 금지).
- `scheduleQuality`는 빈/이상 입력에서도 예외 없이 정의된 값 반환(0명, 미배정 100% 등).
- baseline JSON 스키마 불일치 시 명확한 메시지로 실패.

## 6. 테스트 전략
- `quality.ts` 단위 테스트:
  - 알려진 작은 그리드에서 각 지표 값 정확성(수기 계산과 일치).
  - 야간 라벨 정규화: PM/NIGHT 위주 스케줄에서 `nightStdev`가 0이 아님(현재 버그 회귀 방지).
  - 0일 기사 포함 시 `workDayStdev`·`idleDriverCount`에 반영됨.
  - 빈 입력·전원 미배정 엣지케이스에서 NaN 없음.
- `scenarios.ts` 결정론 테스트: 같은 시드 → 동일 `SolverInput`(깊은 비교). 다른 시드 → 다른 입력.
- `harness.ts` 통합 테스트(스모크): 작은 스위트 1회 실행이 예외 없이 완료되고 JSON 출력 스키마가 유효.
- 회귀: 현재 솔버를 스위트에 돌려 **baseline JSON을 커밋**(`scripts/backtest/baselines/`). 하위 2~4는 이 baseline 대비 델타로 검증.

## 7. 성공 기준 (이 하위 프로젝트의 "완료")
1. `npm run backtest:solver`가 결정론적으로 실행되어 20~30개 시나리오의 다차원 품질 분포를 출력한다.
2. 같은 시드 2회 실행 결과가 비트 단위로 동일하다.
3. `scheduleQuality`가 야간·SPARE 활용·선호·일 안 받은 기사를 포함해 측정하며, 단위 테스트가 정확성을 검증한다.
4. baseline JSON을 저장하고, 임의의 솔버 변경 후 델타를 표로 비교할 수 있다.
5. 솔버 내부 목적함수는 변경되지 않았다(측정기 독립성 확인).
6. 현재 솔버 baseline이 커밋되어 하위 프로젝트 2~4의 기준선이 된다.

## 8. 미해결/후속 (비범위, 기록용)
- LLM 에이전트 백테스트의 프로덕션 DB contamination 제거(트랜잭션 샌드박스/전용 DB) — 별도 하위 프로젝트.
- `scheduleQuality`를 솔버 `objective`/리포트와 통일 — 하위 프로젝트 4.
- 실데이터 파생 시나리오 옵션 — 향후 필요 시.
