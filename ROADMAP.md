# Busync 로드맵 v2 — Agent-First

> 마지막 업데이트: 2026-04-10
> **비전: 배차 담당자와 대타 코디네이터의 일을 AI 에이전트가 100% 대체한다**
> 우리가 파는 것은 소프트웨어가 아니라 **24시간 일하는 AI 직원**이다.

---

## 0. 무엇이 바뀌었나 — v1 → v2

| | v1 (03-18) | v2 (지금) |
|--|--|--|
| AI 역할 | 자동화 보조 (챗봇·추천·요약) | **인간 직무 대체 (배차/대타 담당자)** |
| 핵심 산출물 | ERP + 모바일 앱 | ERP + 모바일 앱 + **두 개의 자율 에이전트** |
| 가격 모델 | SaaS ₩99~199K/월 | **AI 직원 임대 ₩1,800K/월** (인건비 기준) |
| 회사당 MRR | ₩99K~199K | ₩1,800K (9배) |
| 핵심 KPI | 배차 정확도, 가용성 | **에이전트 자율 결정 비율 95%+** |
| 경쟁 우위 | 올인원 ERP | **AI 직원이 일하는 회사** |

### 핵심 통찰

1. **회사의 비싼 인력 = 배차 담당자 (월 ₩400만)** 와 **결원 처리하는 관리자 시간 (월 ₩100만 상당)**.
2. 이 두 자리를 에이전트가 100% 대체하면 회사 입장에서 **₩320만/월 순절감**.
3. 그 절감의 일부(₩180만)를 우리가 가져가는 것 = 경영자가 거절할 수 없는 숫자.
4. 단순 SaaS와 달리 "AI 직원 임대"는 **인건비 항목으로 회계 처리** → 결재가 빠름.

---

## 1. 두 핵심 에이전트

### 1-1. DispatchAgent — 배차 담당자 대체

**대체 대상:** 월급 ₩300~500만의 배차 담당자 1명

**책임 (사람이 하던 일 그대로):**
1. 월간 배차표 생성 (5/2 사이클 + 노선 균형 + 노조 규칙 준수)
2. 휴무 신청 처리 (승인/거절 + 영향 분석 + 대안 제시)
3. 일일 조정 (병가, 차량 고장, 노선 변경, 결원)
4. 신규 기사 입사 시 배차 통합
5. 공정성 모니터링 (야간/주말/인기노선 편차)
6. 노조 규칙 변경 시 자동 재계산

**Tools (~25개):**
```
[조회]
get_drivers(filters)              — 기사 풀, 자격, 면허 만료
get_routes()                       — 운행 노선
get_active_schedule(month)         — 현재 배차표
get_dayoff_requests(status)        — 휴무 신청
get_company_rules(category)        — 회사·노조 규칙 (자연어)
get_driver_history(driverId)       — 야간/주말/인기노선 누적
get_fatigue_score(driverId)        — 피로도 (연속 야간, 주간 시간)
get_route_assignments()            — 노선 고정 배치
get_holiday_calendar()             — 공휴일·특별일

[생성·수정]
draft_monthly_schedule(month, params)
modify_slot(slotId, change)
swap_drivers(slotA, slotB)
publish_schedule(scheduleId)       — 휴먼 승인 필수 (Constitutional)
approve_dayoff(requestId)
reject_dayoff(requestId, reason)

[분석·검증]
score_fairness(scheduleId)         — 공정성 지수 (편차 합)
simulate_against_rule(scheduleId, ruleId)
detect_constraint_violation(scheduleId)
explain_decision(action, context)  — 자연어 근거 생성

[알림]
notify_driver(driverId, message)
notify_admin(message, severity)
request_human_review(reason)       — 휴먼 게이트
```

**Human Gates (휴먼 개입 지점):**
- 월간 배차표 발행 직전 1번 (관리자 검토 + 승인 버튼)
- 노조 규칙 신규 추가 시 1번 (해석 확인)
- 그 외 모든 일일 조정은 자율

### 1-2. EmergencyAgent — 대타 코디네이터 대체

**대체 대상:** 결원 발생 시 전화 30~50통 돌리는 관리자 작업

**책임:**
1. 슬롯 드랍 즉시 후보 기사 분석
2. 단계별 푸시 전송 (Top-3 → Top-10 → 전체)
3. 응답 모니터링 + 시간 제한 관리
4. 수락 시 골든 티켓 자동 지급
5. 모든 단계 실패 시에만 관리자 호출
6. 사후 분석 (응답률, 거부 사유 학습)

**Tools (~15개):**
```
list_off_duty_drivers(date, shift)
score_acceptance_likelihood(driverId, slot)
  · 골든티켓 잔액 (높으면 인센티브 효과 ↓)
  · 최근 7일 대타 횟수 (피로도)
  · 거주지-차고지 거리
  · 사전 등록 선호도 ("야간 OK")
  · 과거 응답률
get_driver_preferences(driverId)
get_recent_overtime(driverId)
send_targeted_push(driverIds, payload)
wait_for_response(driverIds, seconds)
record_acceptance(driverId, slotId)
issue_golden_ticket(driverId, count)
escalate_to_admin(reason)
generate_postmortem(dropId)
```

**Human Gates:** 모든 단계 실패 시에만. 그 외 100% 자율.

---

## 2. 단계별 실행 로드맵

### PHASE 0 — 기반 정리 (지금)

| 작업 | 상태 |
|------|:----:|
| 5개 런타임 에러 수정 (EmergencyStatus enum, AuditLog FK, Company seq, Jest CLI, rate limiter) | ✅ |
| 백엔드 313/313 단위 테스트 통과 | ✅ |
| 어드민웹 빌드 + 모바일 타입체크 통과 | ✅ |
| 프로덕션 마이그레이션 (`prisma migrate deploy`) | ⏳ |
| `@anthropic-ai/claude-agent-sdk` 도입 | ⏳ |
| `packages/backend/src/agents/` 디렉터리 구조 + `_core/` 인프라 | ⏳ |
| `AgentDecision` Prisma 모델 + 마이그레이션 | ⏳ |
| 시뮬레이션 환경 v0 — 작년 데이터 import 스크립트 | ⏳ |

### PHASE 1 — EmergencyAgent v1 (작은 절반부터)

> 결원 처리는 책임 범위가 좁고 결과가 즉시 측정 가능 (수락률). PoC로 최적.

**산출물:**
- `agents/emergency.agent.ts` — 도구 15개 + 시스템 프롬프트
- `agents/_core/base-agent.ts` — BaseAgent (도구 루프, 컨텍스트 영속화, 에러 복구)
- `agents/_core/decision-logger.ts` — 모든 결정 → DB 영구 기록
- `agents/_core/constitutional.ts` — 절대 금지 규칙 검증
- `agents/_core/simulation.ts` — 백테스트 환경

**시뮬레이션 백테스트:**
- 파일럿 회사 작년 모든 결원 사건 (~150건) → 에이전트가 다시 결정
- 비교: 30분 내 수락률, 평균 응답 시간, 거부 횟수, 토큰 비용
- **출시 기준:** 시뮬레이션 30분 내 수락률 ≥ 70% (수작업 평균 ~50%)

> 백테스트 데이터는 익명화된 파일럿 회사의 1년치 운영 기록을 사용. 제품 자체는 전국 모든 버스 회사를 대상으로 한 SaaS이며, 특정 회사에 종속된 코드·로직·UI 텍스트는 일절 포함하지 않는다.

**리스크 노출:** 0 (시뮬레이션만, 실 데이터 영향 없음)

### PHASE 2 — DispatchAgent v1 (어려운 절반)

> 가장 큰 가치. 가장 큰 차별화.

**산출물:**
- `agents/dispatch.agent.ts` — 도구 25개
- `agents/_tools/fairness.ts` — 공정성 지수 계산기
- `agents/_tools/rule-compiler.ts` — 자연어 노조 규칙 → 검증 함수 컴파일러
- 백테스트 비교 리포트 자동 생성

**시뮬레이션 백테스트:**
- 작년 12개 월간 배차표 → 에이전트가 재생성
- **출시 기준 (모두 충족):**
  - 작년 실제 배차 대비 90%+ 일치
  - 공정성 지수 (편차) 작년보다 30%+ 개선
  - 노조 규칙 위반 0건
  - **블라인드 평가:** 노조위원장에게 익명으로 두 안 보여주고 선호 선택 → 에이전트 우선 선택률 ≥ 50%

### PHASE 3 — 1호 베타 고객 · Co-pilot 모드

> 휴먼 인 더 루프. 에이전트가 결정, 인간이 매번 승인.

**작동 방식:**
- 매일 09:00 — 에이전트가 그날 결정 보고서 생성
- 관리자 5분 검토 → 승인 / 수정 / 거부
- 모든 수정·거부는 학습 데이터 (시스템 프롬프트의 "주의사항" 자동 갱신)

**일일 측정:**
- 인간 거부율 (목표 < 5%)
- 인간 수정율 (목표 < 10%)
- 결정 1회당 평균 도구 호출 수
- 토큰 비용

**자율 모드 진입 조건:**
- 14일 연속 거부율 < 5% AND 수정율 < 10%
- 노조 항의 0건
- 관리자가 "이거 없으면 어떻게 일하지" 라고 말하기

### PHASE 4 — 자율 모드 (Autonomy)

> 에이전트 단독 결정. 배차 담당자는 모니터링 역할로 전환.

**변경:**
- 일일 보고서 → 주간 요약 (5분/주)
- 관리자 권한 그대로, 사용 빈도 ↓
- 회사에 첫 정산: 인건비 절감액 ₩400만 - ₩180만 = **₩220만/월 순절감** 데이터 제공

**안전 장치:**
- 5초 롤백 (CancelDecision 도구) — 모든 결정 5초 내 취소 가능
- Constitutional rules — 절대 위반 불가 12개 (예: "동일 기사 야간 4일 연속 금지")
- 결정 추적 — 모든 도구 호출 + 추론 로그 → AgentDecision 테이블 영구 저장
- 휴먼 fallback — 에이전트 다운 시 결정론적 5/2 알고리즘 자동 인계

### PHASE 5 — 2~3호 고객 + 모듈 확장

| 단계 | 목표 |
|------|------|
| 5-1 | 수도권 버스 회사 2개 영업 (1호 베타 익명 레퍼런스 + ROI 데이터) |
| 5-2 | OnboardingAgent — 신규 회사 데이터 마이그레이션 1주 → 1일 |
| 5-3 | AccidentAgent — 사고 보고서 자동 작성·보험 접수 |
| 5-4 | SafetyAgent — DTG 분석·교육 미이수 자동 알림 |
| 5-5 | PayrollAgent — 4대보험·소득세·대타 수당 자동 계산 |

**성공 기준:** 3개사, MRR ₩5,400,000+

### PHASE 6 — 정부 인증 + 전국 확장 (2027)

- ISMS-P, CSAP 취득
- 국토교통부 우수 솔루션 인정 → 전국 권장
- 100개사 → MRR ₩180M → 연 매출 ₩2.16B
- "AI 직원 임대" 카테고리를 한국 시장에 정의

---

## 3. 기술 아키텍처

### 3-1. 디렉터리 구조

```
packages/backend/src/agents/
├── _core/
│   ├── base-agent.ts          # 도구 루프 + 컨텍스트 + 에러 복구
│   ├── decision-logger.ts     # AgentDecision DB 영구 기록
│   ├── constitutional.ts      # 절대 금지 규칙 검증
│   ├── tool-registry.ts       # 도구 등록 + 권한 체크
│   ├── simulation.ts          # 시뮬레이션·백테스트
│   └── prompt-evolver.ts      # 인간 거부 → 시스템 프롬프트 자동 갱신
├── _tools/
│   ├── fairness.ts            # 공정성 점수
│   ├── rule-compiler.ts       # 자연어 → 검증 함수
│   ├── push.ts                # 푸시 알림
│   ├── prisma-tools.ts        # DB 조회·수정 (테넌트 격리 강제)
│   └── ...
├── dispatch.agent.ts          # DispatchAgent
├── emergency.agent.ts         # EmergencyAgent
└── onboarding.agent.ts        # PHASE 5
```

### 3-2. 모델 선택

| 용도 | 모델 | 이유 |
|------|------|------|
| 멀티스텝 추론 (배차 최적화, 의사결정) | **Claude Opus 4.6** | 가장 정확한 추론, 도구 호출 신뢰도 |
| 빠른 분류·추출 (규칙 파싱, 도구 라우팅) | **Claude Haiku 4.5** | 비용·속도 |
| 보고서·설명 생성 | Sonnet 4.6 | 균형 |

### 3-3. 결정 추적 (Decision Provenance)

```prisma
model AgentDecision {
  id             Int      @id @default(autoincrement())
  companyId      Int
  agentName      String   // 'dispatch' | 'emergency' | 'onboarding'
  sessionId      String
  toolCalls      Json     // [{tool, args, result, ts}]
  finalAction    String
  reasoning      String   // 자연어 근거 (관리자에게 표시)
  humanOverride  Boolean  @default(false)
  overrideReason String?
  tokensUsed     Int
  costKrw        Decimal  @db.Decimal(10, 2)
  createdAt      DateTime @default(now())

  company Company @relation(fields: [companyId], references: [id])
  @@index([companyId, agentName, createdAt])
}
```

> 인간이 결정을 거부할 때마다 그 사유는 다음 결정의 학습 컨텍스트로 들어간다.
> 1주일이면 에이전트가 그 회사의 "분위기"를 이해함.

### 3-4. Constitutional Rules (절대 금지 12개)

```typescript
export const CONSTITUTIONAL_RULES = [
  '동일 기사 야간 4일 연속 금지',
  '주 52시간 상한 (1일 8시간 기준)',
  '연속 운행 4시간 초과 금지 (버스기사 특례)',
  '운행 후 최소 8시간 휴식 의무',
  '휴무 승인된 날에 배차 금지',
  '면허 만료된 기사 배차 금지',
  '적성검사 만료 D-day 이후 배차 금지',
  '같은 노선 모든 기사가 동시 휴무 금지',
  '주말 휴무 최소 월 1회 보장',
  '신규 기사 입사 첫 주 단독 배차 금지',
  '과거 사고 이력 있는 노선에 해당 기사 재배치 금지',
  '발행된 배차표는 휴먼 승인 없이 변경 불가 (긴급 결원 제외)',
];
```

도구 호출 시점에 시스템이 검증. 위반 시도 → 도구 거부 + 에이전트에 사유 반환 → 에이전트 재시도.

### 3-5. 시뮬레이션 환경

```typescript
class SimulationEnvironment {
  // 작년 데이터를 그 시점으로 "되감기"
  async rewindToDate(date: Date): Promise<void>

  // 그 시점의 결정 요청
  async runDecision(agent: BaseAgent, event: HistoricalEvent)

  // 에이전트 결정 vs 실제 결정 비교
  async compare(agentResult, actualResult): Promise<SimulationReport>

  // 12개월 백테스트
  async backtest(agent: BaseAgent, year: number): Promise<BacktestReport>
}
```

> 새 모델·새 프롬프트 배포 전 항상 백테스트 통과 필수.
> 백테스트 실패 → 자동 롤백.

### 3-6. 멀티테넌시·보안

이미 갖춘 기반 활용:
- [tenantContext.ts](packages/backend/src/utils/tenantContext.ts) — AsyncLocalStorage로 companyId 격리
- [prisma.ts](packages/backend/src/utils/prisma.ts) `$use` 미들웨어 — cross-tenant 접근 차단
- 통합 테스트 32개 통과

에이전트 도구는 **반드시** `tenantContext` 안에서만 호출. 도구 등록 시 `requireCompanyContext: true` 강제.

---

## 4. 비즈니스 모델 — "AI 직원 임대"

### 4-1. 신규 가격표

| 플랜 | 대상 | 가격 | 포함 |
|------|------|------|------|
| **솔로** | 단일 에이전트 (대타만) | ₩500,000/월 | EmergencyAgent + 모바일 앱 + 알림 |
| **풀** ⭐ | 두 에이전트 묶음 | ₩1,800,000/월 | Dispatch + Emergency + ERP 전체 |
| **엔터프라이즈** | 50대+ | 협의 (₩3,000,000~) | 전체 + 사고·안전·회계 에이전트 |
| **무료 백테스트** | 신규 잠재 고객 | 무료 | "작년 데이터로 에이전트가 했다면" 보고서 |

### 4-2. 회사 입장 ROI

```
배차 담당자 1명:        ₩4,000,000/월 (급여 + 4대보험)
대타 코디네이터 시간:   ₩1,000,000/월 (월 25h × ₩40,000)
─────────────────────────────────────
총 인건비:              ₩5,000,000/월

Busync 풀 플랜:         ₩1,800,000/월
─────────────────────────────────────
순 절감:                ₩3,200,000/월 = ₩38,400,000/년
```

### 4-3. 영업 화법

```
"배차 담당자 1명 인건비 ₩400만에서 ₩180만으로 줄여드립니다.
 첫 3개월 무료. 인건비 절감 ₩200만 미만이면 전액 환불."
```

### 4-4. 매출 시나리오 (v1 대비 9배)

| Phase | 시점 | 고객사 | MRR | 연 매출 |
|-------|------|:-----:|:---:|:------:|
| 4 | 2026 Q3 | 1 | ₩1.8M | ₩21.6M |
| 5 | 2026 Q4 | 3 | ₩5.4M | ₩64.8M |
| 6 | 2027 Q2 | 10 | ₩18M | ₩216M |
| 6 | 2027 Q4 | 30 | ₩54M | ₩648M |
| ∞ | 2028 | 100 | ₩180M | ₩2.16B |

---

## 5. 리스크 매트릭스

| 리스크 | 확률 | 영향 | 완화 |
|-------|:---:|:---:|------|
| 에이전트 환각으로 잘못된 배차 | 중 | 극대 | Constitutional rules + 휴먼 검토 + 5초 롤백 + 결정론적 fallback |
| 노조 거부 | 고 | 극대 | 백테스트 결과 투명 공개 + 노조 간부 사전 미팅 + "AI가 더 공정" 데이터 |
| 회사 가격 거부감 | 중 | 고 | 첫 3개월 무료 + 인건비 절감 보장 + 미달 시 환불 |
| 모델 비용 폭증 | 저 | 중 | Haiku 라우팅 + 일일 토큰 예산 + 결정 캐시 |
| 에이전트 다운 | 저 | 고 | 결정론적 fallback 자동 인계 |
| 50~60대 기사 거부감 | 중 | 중 | UI 단순화 (이미 v1) + 1:1 교육 + 의사결정 한국어 설명 |
| 데이터 유출 | 저 | 극대 | 멀티테넌시 격리 (이미 통합 테스트 32개 통과) + ISMS-P |
| 노동법 위반 결정 | 저 | 극대 | Constitutional Rule로 12개 하드코딩 + 도구 단계 검증 |

---

## 6. 즉시 실행 항목 (이번 주)

1. ✅ **5개 런타임 에러 수정** — EmergencyStatus enum, AuditLog FK, Company seq, Jest CLI, rate limiter
2. ✅ **이 ROADMAP v2 확정**
3. ⏳ **에이전트 코어 구현** — 기존 `@anthropic-ai/sdk` 위에 BaseAgent 도구 루프 직접 구현 (Claude Agent SDK는 코드 편집형 에이전트 특화이므로 미사용. 도메인 에이전트는 Anthropic SDK의 tool use API로 충분 + 의존성 churn 회피)
4. ⏳ **`AgentDecision` Prisma 모델 + 마이그레이션**
5. ⏳ **`agents/_core/` 인프라 6개 파일 (BaseAgent, DecisionLogger, Constitutional, ToolRegistry, Simulation, PromptEvolver)**
6. ⏳ **Constitutional rules 12개 하드코딩**
7. ⏳ **EmergencyAgent skeleton (도구 5개로 시작)** — list_off_duty_drivers, score_acceptance, send_push, wait_response, record_acceptance
8. ⏳ **첫 백테스트 PoC** — 작년 결원 사건 10건으로 시뮬레이션
9. ⏳ **파일럿 회사 작년 12개월 데이터 import 스크립트** (백테스트 전용, 익명화)

---

## 7. 락인 매트릭스 — Phase 4 이후

Busync를 다른 시스템으로 교체하려면:

| 전환 비용 | 난이도 |
|----------|:----:|
| **에이전트가 학습한 회사 분위기** (1년치 거부·수정 패턴) | 🔴 이전 불가 |
| 수년간 배차/급여/인사/안전 데이터 | 🔴 극히 어려움 |
| Constitutional Rule + 노조 규칙 컴파일러 결과 | 🔴 극히 어려움 |
| 결재선, 급여 체계 재설정 | 🔴 극히 어려움 |
| 전 직원 재교육 (특히 고령 기사) | 🔴 극히 어려움 |
| DTG/BIS/은행 API 재연동 | 🟠 매우 어려움 |
| **AI 직원 다시 학습** | 🔴 6개월+ |

> v1 락인보다 한 단계 더 강력. **"AI 직원이 학습한 우리 회사"는 복제가 불가능**.

---

## 8. 경쟁 우위 — 왜 우리가 이기는가

```
기존 ERP (큐버스/서울소프트/우리정보):
  ✅ 배차 도구 / ❌ AI / ❌ 자율 결정 / ❌ 인건비 대체
  → 배차 담당자가 ERP를 "사용한다"

기존 모빌리티 플랫폼 (티라이즈업/킹버스):
  ✅ 관제·예약 / ❌ 배차 / ❌ AI / ❌ 자율 결정
  → 시내버스 부적합

Busync v2:
  ✅ AI 에이전트가 배차 담당자를 "대체한다"
  ✅ AI 에이전트가 대타 코디네이터를 "대체한다"
  ✅ 한국 시장 경쟁자 0
  ✅ 인건비 회계 항목으로 결재 = 결정 빠름
```

**킬러 차별점 5가지:**

1. **DispatchAgent** — 인간 배차 담당자를 대체. 월 ₩400만 절감.
2. **EmergencyAgent** — 인간 대타 코디네이터를 대체. 30분 수락률 70%+.
3. **결정 학습** — 인간 거부 패턴을 학습해 회사 분위기 이해.
4. **백테스트** — 작년 데이터로 "내가 했다면" 무료 데모.
5. **Constitutional Safety** — 절대 위반 불가 규칙 12개로 노동법 자동 준수.

---

## 9. 성공의 정의

이 로드맵이 성공한 모습:

```
2026년 10월 어느 날 아침. 어느 버스 회사의 관리자가 출근한다.

스마트폰 알림:
  "어젯밤 김기사 결원 → 박기사 5분 내 수락 → 골든티켓 +1 지급. 정상 운행."
  "오늘 배차 검토 (5분): 변경 3건 — 야간 균형 조정. [승인]"

5분 검토. 승인. 끝.

배차표 만들던 옛날엔 매일 4시간이 사라졌다. 지금은 30분/주.

월말, 회사 통장에서 ₩180만이 빠져나가고,
Busync가 만들어낸 ₩320만이 회사에 남는다.

6개월 후, 인근 회사들이 묻기 시작한다.
"그 회사 뭐 쓴다고? — 사람이 안 짠다며?"
```

이 그림이 현실이 되면 — 한국 모든 버스 회사가 3년 안에 Busync를 쓴다.

---

## 10. 전체 단계 요약

```
PHASE 0  ─ 기반 정리           ←  지금
              ↓
PHASE 1  ─ EmergencyAgent v1    (작은 절반, 백테스트)
              ↓
PHASE 2  ─ DispatchAgent v1     (어려운 절반, 백테스트)
              ↓
PHASE 3  ─ 1호 베타 Co-pilot    (휴먼 인 더 루프)
              ↓
PHASE 4  ─ 자율 모드            ("AI 직원 임대" 시작 — 1호 고객 정산)
              ↓
PHASE 5  ─ 2~3호 + 모듈 확장    (Onboarding/Accident/Safety/Payroll Agent)
              ↓
PHASE 6  ─ 정부 인증 + 전국     (ISMS-P/CSAP, 100개사)
              ↓
   ∞     ─ 한국 버스 회사의 디폴트 AI 직원
```
