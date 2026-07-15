# App Review 제출 문구 모음 (2026-07 재심사)

⚠️ 제출 전 `[COMPANY_CODE]` / `[PHONE]` / `[PASSWORD]` / `[MODEL]` / `[VERSION]` 자리를 실제 값으로 채울 것.
⚠️ 데모 계정은 반드시 `mustChangePassword=false` 상태 + 배차표/휴무/알림 데이터가 채워진 상태여야 함.
⚠️ iPad 실기기 검증을 하지 않았다면 해당 문장을 "We verified the fix on iPhone hardware and iPad simulator in Release configuration." 으로 교체.

---

## 1. Resolution Center 답장 (빌드 5 재제출 시)

Subject: Guideline 2.1(a) — Unresponsiveness after login: root cause identified and fixed

Hello, and thank you for the detailed review.

We reproduced the conditions of the issue and identified the root cause. The app requested push-notification permission (a native dialog) at the exact moment the login→home navigation transition and keyboard dismissal were in progress. Under this timing, touch handling could deadlock — matching the behavior your reviewer observed on iPad Air (iPadOS 26.5.2). It also explains why the app worked normally after relaunch (the session was already saved, so no transition/permission race occurred).

Fixes in this build (1.0.0, build 6):
1. On iPad hardware, the app no longer triggers the notification-permission system dialog. We reproduced the reported freeze on a physical iPad and traced it to the system permission prompt: after it dismisses in iPhone-compatibility mode, the app's window did not regain touch focus (backgrounding and reopening the app restored it). The app is iPhone-targeted; on iPads, push registration now occurs silently only if permission was already granted.
2. The permission dialog (on iPhone) is now requested only after the login navigation transition fully completes — never during screen transitions.
3. A duplicate concurrent permission request was removed; a guard structurally prevents concurrent native dialogs.
4. The keyboard is dismissed before the post-login screen transition begins.

We verified on a physical iPad ([MODEL], iPadOS [VERSION]) and iPhone: fresh install → log in → grant/deny notification permission → the app remains fully responsive.

Demo account (unchanged):
- Company code: [COMPANY_CODE]
- Phone: [PHONE]
- Password: [PASSWORD]

Note: Busync is an employee app for bus companies — accounts are provisioned by company administrators, and there is no in-app sign-up. The demo account above is pre-configured to skip the first-login password change so you can access all features immediately.

Thank you — we appreciate the pointer to iPad testing.

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
