# SDK 54 업그레이드 검증 체크리스트 (1.0.1)

빌드: EAS `preview` 프로필 (Android APK / iOS 내부 배포)
설치 전 **기존 앱 반드시 삭제** (런타임 1.0.0 → 1.0.1 교체이므로 잔존 상태 배제).

## A. iPhone (실기기)
- [ ] 콜드 스타트: 스플래시 → BootSplash(로고+애니메이션) → 로그인 화면. 로고 전환 시 깜빡임 없음
- [ ] 로그인 → 홈 진입, **~1초 후 알림 권한 다이얼로그 표시**
- [ ] 권한 "허용" 후 즉시 전 탭(홈/배차표/긴급·대타/휴무신청/내정보) 터치 반응
- [ ] 강제 종료 → 재실행 → 자동 로그인 유지
- [ ] 다른 계정으로 재로그인 시 권한 다이얼로그 재표시 안 됨(이미 결정됨)
- [ ] 알림 수신 테스트: 관리자 콘솔에서 배차표 발행 → 푸시 도착 → 탭하면 배차표 화면 이동
- [ ] 배차표 달력 렌더/스크롤, 휴무 신청 플로우, 긴급/대타 목록, 프로필 비밀번호 변경 모달
- [ ] 로그아웃 → 로그인 화면 복귀

## B. iPad (실기기, 호환 모드) — 핵심 회귀 테스트
- [ ] 삭제 → 설치 → 로그인
- [ ] **알림 권한 다이얼로그가 표시되지 않아야 함** (iPad 가드)
- [ ] 홈 진입 직후 모든 탭/버튼 터치 반응 (프리즈 없음)
- [ ] 5분 정도 전체 화면 순회 — 반응성 유지
- [ ] (선택, 여유 있으면) SDK 54 에서 iPadOS 26 다이얼로그 버그가 재현되는지 확인하려면:
      notifications.ts 의 iPad 가드 임시 주석 → dev 빌드로 iPad 설치 → 로그인 → 다이얼로그 응답 후 터치 확인.
      정상이면 다음 릴리스에서 가드 제거 검토. **이번 제출 빌드에서는 가드 유지.**

## C. Android (실기기, Android 13+)
- [ ] 삭제 → APK 설치 → 로그인
- [ ] **POST_NOTIFICATIONS 권한 다이얼로그 표시** (홈 진입 ~1초 후)
- [ ] "허용 안 함" 선택해도 앱 정상 동작 (푸시만 비활성)
- [ ] 재설치 후 "허용" → 푸시 수신 + 알림 채널 2종(Busync 알림/긴급 운행 알림) 생성 확인
      (설정 → 앱 → Busync → 알림)
- [ ] 뒤로가기 버튼: 탭 간 이동/앱 종료 자연스러움
- [ ] 전 화면 순회 (레이아웃 깨짐 없는지 — RN 0.81 렌더러 변경 확인)

## D. 공통 회귀
- [ ] i18n 한국어 문구 정상 (react-i18next + React 19)
- [ ] 오프라인 전환(비행기 모드) → 오프라인 배너 표시, 캐시된 배차표 열람
- [ ] 온라인 복귀 → 자동 재동기화
- [ ] 앱 아이콘/스플래시 정상

## E. 제출 전 (모두 통과 후)
- [ ] `eas build --platform all --profile production`
- [ ] iOS: `eas submit` → Resolution Center 답장(store-assets/app-review-notes.md, "build 6" 표현을 실제 빌드 번호로)
- [ ] Android: `eas submit` → Play 내부 테스트 트랙부터
- [ ] 데모 계정 mustChangePassword=false + 데이터 채움 재확인

## 알려진 잔여 사항 (비차단)
- dev 서버(8081)는 SDK 51 프로세스로 떠 있음 → 재시작 필요: `npx expo start -c`
- Expo Go 로는 SDK 54 테스트 불가 → dev 빌드(`preview`/`development` 프로필) 사용
- userInterfaceStyle 경고(Android): expo-system-ui 미설치로 Android 에서 라이트 모드 강제 안 됨 — 화면들은 색상 하드코딩이라 실사용 영향 없음
- setNotificationHandler 가 notifications.ts / notificationService.ts 두 곳에서 등록됨(마지막 import 승자) — 업그레이드 전부터 동일. 추후 통합 권장
- 딥링크 웹 파일(AASA/assetlinks) 미호스팅 — 승인 후 작업
