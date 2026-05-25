# 내 정보 스크린 — 이번 달 활동 요약 섹션

**Date:** 2026-05-25
**Status:** Approved (pending spec review)

## 배경 / 문제

기사 앱의 "내 정보"(ProfileScreen) 화면에서 계정 정보 카드와 배지를 제거한 뒤,
화면이 비어 보인다. UX 개선을 위해 한눈에 보는 활동 요약을 추가한다.

사용자가 정한 방향:
- **목표**: 한눈에 보는 활동 요약 + 기능보다는 깔끔하게 채우기
- 채택: "이번 달 활동 요약" 카드 (운행일 / 휴무일 / 대타 수락 3칸)
- 제외: 다음 운행 한 줄, 지원·정보 섹션, 노선 선호 설정

## 목표 (Goals)

- ProfileScreen 헤더와 기존 "설정" 카드 사이에 활동 요약 카드 1개 추가
- 3개 통계 타일: **운행일**, **휴무일**, **대타 수락** (모두 이번 달 기준)
- 휴무일 계산은 내 배차(ScheduleScreen)와 동일한 병합 규칙 사용
- 백엔드는 단일 요약 엔드포인트로 세 값을 한 번에 제공 (단일 소스)

## 비목표 (Non-Goals)

- 다음 운행 미리보기 (제거 결정)
- 지원·정보 섹션 / 문의하기 / 이용약관 (제외 결정)
- 노선 선호 설정 노출 (이번 범위 아님)
- 누적(전체 기간) 통계 — 이번 달만 표시

## 용어 / 계산 규칙

내 배차 화면에서 이미 적용된 병합 규칙을 그대로 따른다:

- `isRest(slot) = slot.isRestDay || slot.status === 'DROPPED'`
- **운행일 (workDays)** = `!isRest(slot)` 인 슬롯 수
- **휴무일 (restDays)** = `isRest(slot)` 인 슬롯 수
- **대타 수락 (acceptedSubstitutes)** = 이번 달, 내가 충원한 긴급 대타 건수
  - `EmergencyDrop.filledBy === 본인 id`
  - `EmergencyDrop.status === 'FILLED'`
  - 연결된 `slot.date` 가 해당 연·월 범위 내

## 아키텍처

### 1. 백엔드 — 월간 요약 엔드포인트

**Route:** `GET /schedules/:year/:month/summary`

- 기존 `getSchedule` 와 동일하게 기사 본인 범위로 동작 (인증된 `req.user`)
- 컨트롤러: `scheduleController.getMyMonthlySummary` (신규)
- 응답:

```json
{
  "success": true,
  "data": {
    "year": 2026,
    "month": 5,
    "workDays": 22,
    "restDays": 2,
    "acceptedSubstitutes": 1
  }
}
```

- 동작:
  1. 해당 회사·연·월의 schedule 을 찾고, 본인(`driverId = req.user.id`) 슬롯만 조회
     (`isRestDay`, `status` 필드 필요)
  2. 위 병합 규칙으로 `workDays` / `restDays` 계산.
     schedule 이 없으면 둘 다 0
  3. `EmergencyDrop` 에서 `filledBy = req.user.id`, `status = 'FILLED'`,
     `slot.date` ∈ [월 시작, 월 끝] 인 건수를 세어 `acceptedSubstitutes` 산출
  4. 항상 숫자 3개를 담은 객체 반환 (null 없음)

- 날짜 범위: slot 의 `@db.Date` 는 UTC 자정으로 저장되므로,
  월 경계 비교는 UTC 기준 `gte 월초`, `lt 다음달 1일` 로 처리

### 2. 모바일 — API 클라이언트

`packages/mobile/src/services/api.ts` 의 `schedulesApi` 에 추가:

```ts
getMonthlySummary: (year: number, month: number) =>
  api.get(`/schedules/${year}/${month}/summary`),
```

### 3. 모바일 — ProfileScreen

- 신규 `useQuery({ queryKey: ['my-monthly-summary', year, month], queryFn })`
  - `year` / `month` = 현재 날짜 기준
- 헤더와 "설정" 카드 사이에 활동 요약 카드 렌더:
  - 카드 제목: "이번 달 활동 요약"
  - 3개 타일 (운행일 파랑 / 휴무일 초록 / 대타 수락 주황) — 내 배차 통계와 동일한 톤
  - 로딩 중: Skeleton 타일
  - 데이터 없음/에러: 0 으로 표시 (카드는 유지)
- 기존 헤더(이름·전화), 설정 카드, 로그아웃, 버전 표기는 변경 없음

## 데이터 흐름

```
ProfileScreen
  └─ useQuery(['my-monthly-summary', year, month])
       └─ GET /schedules/:year/:month/summary
            └─ scheduleController.getMyMonthlySummary
                 ├─ schedule.slots(where driverId = me)  → workDays / restDays
                 └─ emergencyDrop(filledBy = me, FILLED, slot.date in month) → acceptedSubstitutes
```

## 에러 처리

- 백엔드 오류 시 기존 패턴대로 500 + `{ success:false, message }`
- 프론트: 쿼리 실패해도 카드는 0 값으로 표시 (화면 깨짐 방지)
- 월에 schedule 이 없을 때: workDays/restDays = 0, acceptedSubstitutes 는 독립 계산

## 테스트

- 백엔드 컨트롤러 단위 테스트 (`getMyMonthlySummary`):
  - 정상 슬롯 → work/rest 병합 규칙 검증 (DROPPED 가 rest 로 집계되는지)
  - schedule 없는 달 → 0/0, 대타 수락은 별도 계산
  - 대타 수락 카운트: `filledBy=me & FILLED & slot.date 월 내` 만 집계,
    OPEN/CANCELLED·타인 충원·다른 달은 제외
- 모바일: 타입 체크(`tsc --noEmit`) 통과, 로딩/0값 렌더 수동 확인

## 영향 범위 (파일)

- `packages/backend/src/controllers/scheduleController.ts` — `getMyMonthlySummary` 추가
- `packages/backend/src/routes/schedules.ts` — `GET /:year/:month/summary` 라우트 등록 (기존 `/:year/:month/publish` 와 동일 패턴, 충돌 없음)
- `packages/mobile/src/services/api.ts` — `getMonthlySummary` 추가
- `packages/mobile/src/screens/ProfileScreen.tsx` — 활동 요약 카드 + 쿼리
- 백엔드 테스트 파일 (해당 컨트롤러 테스트)
