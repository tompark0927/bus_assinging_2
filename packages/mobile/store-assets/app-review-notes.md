# App Review 제출 문구 모음 (2026-07 재심사)

⚠️ 제출 전 `[COMPANY_CODE]` / `[PHONE]` / `[PASSWORD]` / `[MODEL]` / `[VERSION]` 자리를 실제 값으로 채울 것.
⚠️ 데모 계정은 반드시 `mustChangePassword=false` 상태 + 배차표/휴무/알림 데이터가 채워진 상태여야 함.
✅ iPad 실기기 검증 완료: SDK 54 빌드에서 로그인 → 권한 다이얼로그 응답 → 화면 정상 반응 확인.
   제출 대상: production 빌드 8 (EAS id 211a2c61-e80f-496f-8919-300377c52165), 버전 1.0.1.

---

## 1. Resolution Center 답장 (빌드 8 재제출 시)

Subject: Guideline 2.1(a) — Unresponsiveness after login: root cause fixed and verified on iPad

Hello, and thank you for the detailed review and for pointing us to iPad testing.

We reproduced the freeze on a physical iPad and identified the root cause. The app's application framework (React Native) was on a version that predates the modern iOS window/scene lifecycle. On iPadOS 26 in iPhone-compatibility mode, when the system notification-permission dialog dismissed, the app window did not reliably regain touch focus — leaving the UI unresponsive until the app was backgrounded and reopened. This matches exactly what your reviewer observed, and why a relaunch appeared to fix it.

Fix in this build (1.0.1, build 8):
- We upgraded the app's framework to a current version (Expo SDK 54 / React Native 0.81) that adopts the modern iOS scene-based lifecycle. This resolves the window-focus loss after the permission dialog.
- We verified on a physical iPad that a fresh install → log in → respond to the notification-permission dialog (both Allow and Don't Allow) → the app remains fully responsive with no freeze.
- As additional hardening, the permission prompt is now requested only after the login screen transition completes, and duplicate concurrent permission requests were removed.

We verified on a physical iPad ([MODEL], iPadOS [VERSION]) and on iPhone: fresh install → log in → grant/deny notification permission → the app remains fully responsive throughout.

Demo account:
- Company code: [COMPANY_CODE]
- Phone: [PHONE]
- Password: [PASSWORD]

Note: Busync is an employee app for bus companies — accounts are provisioned by company administrators, and there is no in-app sign-up. The demo account above is pre-configured to skip the first-login password change so you can access all features immediately.

Thank you again.

---

## 2. App Review Information 노트 (App Store Connect 상시 노트 필드)

About this app: Busync (버스잉크) is a B2B dispatch-management app for bus-company drivers in Korea. Company administrators create driver accounts and publish monthly duty schedules via a separate web console; drivers use this app to check assignments, request days off, and respond to urgent substitute-driving requests via push notifications. There is no in-app account creation — accounts are provisioned by administrators only, and account deletion is handled by the company administrator (Guideline 5.1.1(v) in-app deletion therefore does not apply).

Demo account:
- Company code (회사 코드): [COMPANY_CODE]
- Phone (전화번호): [PHONE]
- Password (비밀번호): [PASSWORD]

This account is pre-loaded with a published schedule, day-off history, and notifications so all screens show real data. It is configured to skip the first-login forced password change.

Feature notes for review:
- Push notifications deliver urgent substitute requests (긴급/대타 tab) and schedule updates. The permission prompt appears ~1 second after first login.
- The 휴무신청 (day-off request) tab lets drivers request days off for the following month; approval happens on the admin console.
- The app is Korean-language only, targeting the Korean market.

---

## 3. Google Play — App access 안내 (Play Console → App content → App access)

This app requires login. Accounts are created by company administrators; there is no self-registration.
- Company code: [COMPANY_CODE] / Phone: [PHONE] / Password: [PASSWORD]
- The account is pre-configured with schedule data and skips the forced first-login password change.

---

## 제출 전 최종 체크리스트

- [ ] 데모 계정 mustChangePassword=false 확인 (DB에서 직접)
- [ ] 데모 계정에 배차표(이번 달 발행분)·휴무 내역·알림 데이터 존재 확인
- [ ] api.busync.kr 헬스 체크 200 확인
- [ ] iPad 실기기(또는 최소 Release 시뮬레이터) 테스트: 삭제 → 설치 → 로그인 → 권한 허용/거부 → 전 탭 터치
- [ ] eas build --platform ios --profile production (빌드 5)
- [ ] eas submit + Resolution Center 답장 (위 1번 문구)
- [ ] Android: eas build/submit + Play 데이터 보안 양식 + App access 문구 (위 3번)
