# Busync — Final Pre-Launch Manual Test Plan (main branch)

> Goal: manually walk the **entire** service (Admin Web + Mobile App + Backend behavior) step by step, including edge cases, before publishing online.
> **Verified against the `main` branch** (merge commit `8ed7a63`, PR #6). Work top to bottom — Section 1 (config) and Section 2 (test data) are prerequisites.

---

## 0. Role model on `main` (read this first)

The product has been consolidated to **two effective roles**, even though the backend `Role` enum still technically contains legacy values for backward compatibility:

| Effective role | Enum value | Where | Access |
|----------------|-----------|-------|--------|
| **관리자 (Admin)** | `ADMIN` | Admin Web | Full access to **all** admin pages **except** the Audit Log |
| **기사 (Driver)** | `DRIVER` | Mobile App | Own schedule, emergency, day-off, notifications, profile |

Key facts (verified in code):
- Company registration creates the founding user as `ADMIN` — [companiesController.ts:68](../packages/backend/src/controllers/companiesController.ts#L68).
- New staff accounts are **always** created as 관리자/`ADMIN`; the Accounts page has no role picker — [AccountsPage.tsx:215](../packages/admin-web/src/pages/AccountsPage.tsx#L215).
- Sidebar gating: `FULL_ACCESS = ['OWNER','DIRECTOR','ADMIN']` see every role-gated page; only `OWNER`/`DIRECTOR` see the Audit Log — [Layout.tsx:38,73,77-82](../packages/admin-web/src/components/Layout.tsx#L77-L82).
- Legacy roles (`OWNER, DIRECTOR, DISPATCH, HR, ACCOUNTING, SAFETY_MGR`) still exist in the Prisma enum and in backend `requireRole(...)` checks, but **cannot be assigned through the UI**.

> ⚠️ **Consequence to decide before launch:** because every app-created staff account is `ADMIN` (not `OWNER`/`DIRECTOR`), **no one can reach the Audit Log** through normal usage. Either (a) accept the audit log as internal-only, (b) change its gating to include `ADMIN`, or (c) provide a way to assign `OWNER`. See `RBAC-AUDIT` and the Appendix.

Consequently, this plan tests **one staff role (관리자)** plus **the 관리자↔기사 boundary** and **multi-tenant isolation** — not a per-role permission matrix.

---

## 0.1 How to use this plan

- **Legend:** ⬜ not run · ✅ pass · ❌ fail · ⚠️ pass-with-issue · 🚫 blocked
- Each case has an **ID**, **preconditions**, **steps**, **expected result**, and **edge cases**.
- Record actual result + screenshot/console/network capture for any ❌/⚠️.
- Test **web on Chrome + Safari**, and the **mobile app on a real iOS and a real Android device** (push + secure storage don't work on simulators/web).
- Testers needed: 1 관리자 account, plus 2–3 driver phones.

### Test environments
| Env | Web | API | Notes |
|-----|-----|-----|-------|
| Local dev | localhost:3000 | localhost:4000 | `SMS_DEV_MODE=true` → OTP prints to backend console |
| Staging | (fill in) | (fill in) | Mirror prod config; test here before prod |
| Prod | (fill in) | (fill in) | Smoke-test only after go-live |

---

## 1. Pre-launch environment & configuration checks (DO FIRST)

### 1.1 Secrets & config
- ⬜ `CFG-01` **Secrets provisioned via a secret manager in prod**, never shipped in the image/bundle. `.env` is gitignored (good — not in git), but the local `.env` contains **real-looking `ANTHROPIC_API_KEY` and `JWT_SECRET`** values; make sure that file is never shared/committed and rotate the keys if it ever left your machine. A leaked `JWT_SECRET` lets anyone forge login tokens.
- ⬜ `CFG-02` `SMS_DEV_MODE=false` in staging/prod with **real CoolSMS key/secret/sender**. Verify a real SMS actually arrives (phone OTP, find-company-code). With dev mode on, OTP only prints to the server log.
- ⬜ `CFG-03` **Redis running and reachable** in prod, `REDIS_URL` correct (with password if required). Without it, rate limiting falls back to in-memory (per-instance only → ineffective behind a load balancer). Confirm login rate limiting blocks across instances.
- ⬜ `CFG-04` **Kakao keys real** (`KAKAO_CLIENT_ID`/`SECRET`) if Kakao login is used; otherwise confirm the feature is hidden. (Backend still exposes `/auth/kakao`; current keys are placeholders.)
- ⬜ `CFG-05` `ANTHROPIC_API_KEY` valid; `AI_MODEL_CHAT` / `AI_MODEL_FAST` point to models that exist (the local `.env` had `claude-opus-4-6` — confirm it's a valid id or update).
- ⬜ `CFG-06` `FRONTEND_URL` and `ALLOWED_ORIGINS` set to the **prod web origin(s)** (https). CORS blocks other origins, allows the real one.
- ⬜ `CFG-07` `NODE_ENV=production` in prod. Confirm rate limiters are **active** (skipped when `development`).
- ⬜ `CFG-08` `trust proxy` / `X-Forwarded-For` correct so `req.ip` (audit logs, rate limits) is the real client IP behind proxy/CDN.

### 1.2 Infrastructure
- ⬜ `CFG-09` DB migrations applied to prod (`prisma migrate deploy`); schema matches code.
- ⬜ `CFG-10` HTTPS enforced end to end (web, API, `wss://`). No mixed content.
- ⬜ `CFG-11` Socket.IO connects on the prod domain (`wss` upgrade succeeds, not just polling).
- ⬜ `CFG-12` DB backup job running; a restore has been test-verified once.
- ⬜ `CFG-13` Feature flags intentional: `EMERGENCY_AGENT_ENABLED`, `DAILY_REPORT_AGENT_ENABLED`, `AUDIT_LOG_RETENTION_DISABLED`, `AUDIT_LOG_RETENTION_DAYS`.
- ⬜ `CFG-14` `/health` 200 and `/api/v1/health` `db:"ok"` on prod.
- ⬜ `CFG-15` Error monitoring receiving events; `/error-report` works and is rate-limited.

---

## 2. Test data & account setup

- ⬜ `DATA-01` Register a fresh test company (used throughout). Record: company code, 관리자 email/password. (Founder role = 관리자/ADMIN.)
- ⬜ `DATA-02` From Accounts, create 2–3 additional **staff (관리자)** accounts. Confirm there is **no role choice** — all are 관리자.
- ⬜ `DATA-03` Create master data: ≥3 routes, ≥3 buses, ≥10 drivers (mix MAIN/SPARE); give a couple near-future license/qualification expiry.
- ⬜ `DATA-04` Register **a second company** (different code) with its own data — required for multi-tenant isolation (Section 4).
- ⬜ `DATA-05` Install the mobile app on ≥2 driver phones (iOS + Android), logging in as drivers from `DATA-03`.

---

## 3. Authentication & session (web + mobile)

### 3.1 Company registration (web)
- ⬜ `AUTH-01` Register a company end to end: company name → admin account → **email OTP** (send, receive, enter, verify) → complete. Auto-login lands on `/dashboard` as 관리자.
  - Edge: OTP expiry > 5 min → expired.
  - Edge: wrong OTP 5×+ → locked; must resend.
  - Edge: resend OTP within 60s → rate-limited (1/60s).
  - Edge: same email twice / register twice → duplicate handled (409, clear message).
  - Edge: password strength meter weak→strong; reject < 8 chars and mismatched confirm.
  - Edge: register two companies with the **same name** → codes differ (collision handling).
  - Edge: >5 registrations/hour from one IP → rate-limited.

### 3.2 Login (web — email + company code + password)
- ⬜ `AUTH-02` Valid login → dashboard; token+refresh stored; reload keeps session.
- ⬜ `AUTH-03` Wrong password / email / company code → **generic** "invalid" error (no user enumeration).
- ⬜ `AUTH-04` >10 failed logins in 15 min → 429 (prod).
- ⬜ `AUTH-05` CapsLock hint shows when CapsLock is on.
- ⬜ `AUTH-06` Deleted/inactive account cannot log in.
- Edge: company A user with company B's code → rejected.
- Edge: email with spaces / different case → normalized, works.

### 3.3 Login (mobile — company code + phone + password)
- ⬜ `AUTH-07` Driver logs in with company code + phone + password → Home.
  - Edge: phone with hyphens/spaces → normalized, works.
  - Edge: **a 관리자/non-DRIVER account** tries to log in on mobile → explicitly rejected ("drivers only").
  - Edge: wrong company code → clear error.
- ⬜ `AUTH-08` **Force password change**: driver with `mustChangePassword=true` is locked to the change-password screen until changed; logout works there.
  - Edge: new password < 6 chars / mismatch → rejected.

### 3.4 Phone OTP & recovery
- ⬜ `AUTH-09` Phone OTP login (if used): send → verify → in. Wrong OTP 5× → locked. Resend < 60s → rate-limited. In dev, OTP appears in server console.
- ⬜ `AUTH-10` **Forgot password** (web): company code + email → OTP (masked email hint) → reset → auto-login. After reset, all existing sessions invalidated.
- ⬜ `AUTH-11` **Find company code**: submit registered phone/email → receive code (real SMS/email in prod).

### 3.5 Session lifecycle
- ⬜ `AUTH-12` Access-token expiry (2h) → silent refresh; original request retried.
- ⬜ `AUTH-13` Refresh-token expiry/invalid → forced logout.
- ⬜ `AUTH-14` **Token rotation/theft detection**: reuse a rotated refresh token → whole family invalidated. (Verify via API.)
- ⬜ `AUTH-15` Logout (web+mobile) clears local token/refresh/push token; server invalidates refresh; back button after logout exposes nothing.
- ⬜ `AUTH-16` Admin **force-logout** of a user → their next request fails → login; push token cleared.
- ⬜ `AUTH-17` Change password while logged in with wrong current password → rejected; correct → succeeds.

---

## 4. Access control & multi-tenant isolation

> With one staff role, the meaningful boundaries are **관리자 vs 기사** and **company vs company**. A cross-tenant leak is a hard launch blocker.

### 4.1 관리자 sees the full admin surface
- ⬜ `RBAC-01` Logged in as 관리자, the sidebar shows all operational pages: 대시보드, 배차표 관리, 대타 관리, 휴무 요청, 오늘 운행 현황, 일일 보고서, 기초 데이터, 배차 설정, 계정 관리, 회사 정보. Each opens without a permission error.
- ⬜ `RBAC-AUDIT` **Audit Log gating.** As a 관리자 account, `/dashboard/audit` is **not** in the sidebar and navigating to it directly is blocked; `GET /audit-logs` returns 403. Confirm this is the intended launch behavior. **If audit logs should be visible to 관리자, this is a defect** — the page is gated to `OWNER`/`DIRECTOR`, which the UI never assigns (see Appendix).

### 4.2 기사 (DRIVER) boundary
- ⬜ `RBAC-02` A DRIVER token **cannot** call staff/office endpoints (e.g., `GET /users`, `GET /audit-logs`, `POST /schedules/generate-v2`, `PUT /schedules/:y/:m/publish`, `PUT /dayoff/:id/review`, `POST /emergency/:id/manual-fill`, `POST /users`) → **403**. Test at the API level, not just the app UI.
- ⬜ `RBAC-03` A DRIVER can only act on **their own** resources: view own schedule/summary, accept emergency drops, create/cancel own day-off, read/mark own notifications, change own password. Attempting another driver's data → 403/404.
- ⬜ `RBAC-04` A 관리자 cannot log in to the **mobile app** (drivers only) and a DRIVER cannot log in to the **web dashboard**.

### 4.3 Legacy-role safety (backward compat)
- ⬜ `RBAC-05` Because backend `requireRole('DISPATCH','HR', ...)` checks still exist, confirm a 관리자 (`ADMIN`) is **not accidentally blocked** from any admin action that routes through those checks (schedule generate/publish, day-off review, user CRUD, policy update, emergency manage, basic data CRUD). All should succeed via `isFullAccess`.
- ⬜ `RBAC-06` If any legacy-role user still exists in prod data (e.g., a pre-existing `OWNER`/`DISPATCH`), spot-check they still function and aren't broken by the consolidation.

### 4.4 Tenant isolation (companies A vs B from DATA-04)
- ⬜ `TEN-01` As company A 관리자, guessing company B IDs in URLs/API (`/schedules/...`, `/users/:id`, `/dayoff/:id`, `/emergency/:id`, `/buses/:id`, `/routes/:id`) → **404/403, never B's data**.
- ⬜ `TEN-02` Global search as A returns only A's users/routes/buses/posts.
- ⬜ `TEN-03` Company A's Socket.IO room receives **only** A's events (publish/emergency/dayoff), never B's.
- ⬜ `TEN-04` Login scoping: A's credentials rejected under B's company code.

---

## 5. Admin Web — module by module (all accessible to 관리자)

### 5.1 Onboarding (`/dashboard/onboarding`)
- ⬜ `WEB-ONB-01` **Excel import**: download template → fill → upload (drag-drop + click) → analysis spinner → preview counts + tabs → confirm → saved → redirect to schedule.
  - Edge: non-xlsx (.pdf/.csv) → rejected; > 10MB → rejected; malformed/empty sheet → warnings, no partial import; duplicate/missing columns → surfaced before save; large file → completes, UI not frozen.
- ⬜ `WEB-ONB-02` **Manual entry** 3-step wizard (routes → buses → drivers), each requires ≥1 row; "완료" saves all; done summary correct.
  - Edge: advance a step with 0 rows → blocked.

### 5.2 Dashboard (`/dashboard`)
- ⬜ `WEB-DASH-01` Loads with correct month/date; schedule status badge (Draft/Published/Missing) accurate.
- ⬜ `WEB-DASH-02` Counts correct: pending day-offs, open emergencies, active drivers (main/spare), buses, routes.
- ⬜ `WEB-DASH-03` License/qualification **D-30 expiry** alerts list the right drivers.
- ⬜ `WEB-DASH-04` "Next-month not prepared" warning appears within D-7 of month end with no next-month schedule.
- ⬜ `WEB-DASH-05` Quick links navigate to correct pages.
- Edge: brand-new company with no data → empty states, sensible zeros, no crash.

### 5.3 Basic Data (`/dashboard/data`)
- ⬜ `WEB-DATA-01` Drivers tab: create / edit / delete (soft-delete → inactive) / reset password (temp password shown in toast). Search by name/phone/employee ID.
- ⬜ `WEB-DATA-02` Set driver type MAIN/SPARE, assigned bus, vacation days, license & qualification expiry — persist and reflect on dashboard/solver.
- ⬜ `WEB-DATA-03` Buses tab: CRUD; route assignment; bus/plate uniqueness enforced (server) → duplicate rejected.
- ⬜ `WEB-DATA-04` Routes tab: CRUD; route number uniqueness; start/end points saved.
- Edge: delete a driver/bus/route referenced by a PUBLISHED schedule → defined behavior (block or keep historical slot), no dangling crash.
- Edge: duplicate phone/employee ID → rejected.
- Edge: long names / special chars / emoji → stored & displayed safely (no XSS).

### 5.4 Dispatch Settings / Policy (`/dashboard/settings`)
- ⬜ `WEB-SET-01` Apply presets **CITY_2SHIFT** and **VILLAGE_1SHIFT** → fields populate with expected defaults.
- ⬜ `WEB-SET-02` Configure workday bands (hard/sweet min-max), rest cycle (work/rest days, consecutive toggle), shift system, crew model (SOLO/PAIR/TRIO) → save persists.
- ⬜ `WEB-SET-03` Toggle each **constitutional rule** + params: noNightStreak, weeklyMaxWorkDays, noSameDayDoubleAssign, minRestBetweenShifts, noAssignOnApprovedOff, noExpiredLicense, noExpiredQualification, guaranteedWeekendOff, noNewHireSolo, noBlockedRoute → save + reload persists.
- Edge: hardMin > hardMax (or sweet outside hard) → validation blocks save.
- Edge: change policy → generate schedule respects it (cross-check Section 10).

### 5.5 Schedule management (`/dashboard/schedule`) — core
- ⬜ `WEB-SCH-01` **AI generation (v2)**: wizard → generate → DRAFT grid; result panel shows slots created, policy, elapsed, metrics (fairness, workday spread, violations), unfilled slots, hard-violators, exempted drivers.
- ⬜ `WEB-SCH-02` Cell colors match status (SCHEDULED/DROPPED/FILLED/COMPLETED/ABSENT/REST); labels show route/shift/bus.
- ⬜ `WEB-SCH-03` Edit filled cell (DRAFT only): change driver/route/bus/shift/notes → saves; marked manual override; rule/rest warnings appear; **force-approve requires a reason**.
- ⬜ `WEB-SCH-04` Add slot on empty cell (route required for work day; rest day without route).
- ⬜ `WEB-SCH-05` **Undo** last manual override reverts correctly.
- ⬜ `WEB-SCH-06` Filters (type ALL/MAIN/SPARE, route, name) + bulk multi-select + bulk update.
- ⬜ `WEB-SCH-07` Quality checklist: unfilled by route, bus-assignment gaps, approved-day-off-not-reflected, workday spread, pending day-off count.
- ⬜ `WEB-SCH-08` Header stats (total/work/rest/dropped/filled/absent/completed, filled-rate %) correct.
- ⬜ `WEB-SCH-09` **Export Excel** → valid .xlsx, correct columns/data.
- ⬜ `WEB-SCH-10` **BIS export** downloads and matches spec.
- ⬜ `WEB-SCH-11` **Print** modal: column selection + orientation → preview correct → PDF captures all columns.
- ⬜ `WEB-SCH-12` **Publish**: confirm → PUBLISHED → grid read-only → all drivers notified (Section 7).
- ⬜ `WEB-SCH-13` **Delete** only on DRAFT; PUBLISHED/ARCHIVED cannot be deleted or overwritten by regenerate.
- ⬜ `WEB-SCH-14` AI slot-filling recommendations return sensible suggestions for unfilled slots.
- Edge: generate with no drivers/routes/buses → clear 422, not a crash.
- Edge: regenerate over a DRAFT with manual edits → overwrite confirmation; declining preserves edits.
- Edge: attempt to overwrite a PUBLISHED month → blocked.
- Edge: more slots than drivers / many day-offs → unfilled slots reported, no hang.
- Edge: month navigation across **year boundary** (Dec→Jan) → correct data.
- Edge: two 관리자 edit the same schedule concurrently → last-write behavior defined, no silent loss (watch real-time invalidation).

### 5.6 Day-off approval (`/dashboard/dayoff`)
- ⬜ `WEB-DO-01` Calendar + list; status tabs (All/PENDING/APPROVED/REJECTED) with correct counts.
- ⬜ `WEB-DO-02` **Approve** → driver notified; if driver had a working slot, an open/DROPPED slot is auto-created + available drivers notified.
- ⬜ `WEB-DO-03` **Reject** requires a reason → driver sees the note.
- ⬜ `WEB-DO-04` Cancel removes the request.
- ⬜ `WEB-DO-05` SLA "days waiting" badge escalates amber → red with age.
- Edge: approve a day-off already in a **PUBLISHED** schedule → schedule/quality-check flags it; driver unassigned/dropped correctly.
- Edge: overlapping/duplicate requests same driver+date → no double slot.
- Edge: driver with 0 balance → approval behavior defined.

### 5.7 Emergency management (`/dashboard/emergency`)
- ⬜ `WEB-EM-01` Open drops auto-refresh (~10s); show original driver, date, shift, route, bus, escalation level (0–4), time since creation.
- ⬜ `WEB-EM-02` **Manual drop creation** (slot + reason) → OPEN drop → available drivers notified.
- ⬜ `WEB-EM-03` **Manual fill** (assign driver) → FILLED → assigned driver notified.
- ⬜ `WEB-EM-04` **Cancel** → CANCELLED → slot reverts → notifications sent.
- ⬜ `WEB-EM-05` Recent activity tab: FILLED + CANCELLED, last 7 days, newest first.
- ⬜ `WEB-EM-06` Escalation badges 0 (초기) → 4 (최종위기) render correctly.
- Edge: two actors fill the **same** drop simultaneously → one wins; other sees "already taken".
- Edge: drop passes departure while OPEN → auto-expires EXPIRED, slot ABSENT (see EM-ESC).

### 5.8 Today Operation (`/dashboard/today`)
- ⬜ `WEB-TODAY-01` Correct date header; KPI cards (total/normal/emergency-filled/dropped-waiting/absent) accurate.
- ⬜ `WEB-TODAY-02` Red banner "충원 필요 대타 N건" when open emergencies today; "관리하기" → Emergency.
- ⬜ `WEB-TODAY-03` Route breakdown lists slots by route/shift with driver + status colors; updates on `emergency:new/filled`.
- Edge: day with no schedule → empty state.

### 5.9 Daily Reports (`/dashboard/daily-reports`)
- ⬜ `WEB-DR-01` List shows dates + severity (INFO/ATTENTION/URGENT) + unread; detail renders markdown.
- ⬜ `WEB-DR-02` "읽음 처리" marks read; "다시 생성" regenerates (warns about cost, updates content).
- Edge: company with no reports → empty state.
- Edge: auto-generation runs after 09:00 KST for a real (non-`BT`) company (see DR-CRON).

### 5.10 Accounts (`/dashboard/accounts`)
- ⬜ `WEB-ACC-01` Create staff account → **no role selector**; the new account is 관리자/`ADMIN`. Temp password shown in toast; appears in list with the 관리자 badge.
- ⬜ `WEB-ACC-02` Edit account fields (name, email, phone, employee ID); delete (soft) → cannot log in; reset password shows new temp password.
- ⬜ `WEB-ACC-03` Search filters by name/email/employee ID.
- ⬜ `WEB-ACC-04` Email is required for a 관리자 account ([AccountsPage.tsx:235](../packages/admin-web/src/pages/AccountsPage.tsx#L235)) → creating without email is rejected.
- Edge: duplicate email/employee ID → rejected.
- Edge: DRIVER accounts do **not** appear here (staff-only list); drivers are managed under 기초 데이터.
- Edge: 관리자 cannot delete/deactivate their own currently-logged-in account into a lockout (verify defined behavior).

### 5.11 Company Info (`/dashboard/company`)
- ⬜ `WEB-CO-01` Edit company name (≤50 chars) → dirty flag → save/revert; drivers see the new name in the app.
- ⬜ `WEB-CO-02` Company code read-only ("변경 불가"); stats cards (active drivers/buses/routes) correct.

### 5.12 Audit Log (`/dashboard/audit`)
- ⬜ `WEB-AUD-01` See `RBAC-AUDIT`: with a normal 관리자 account this page is **not reachable** (gated `OWNER`/`DIRECTOR`). Decide/confirm intended behavior before launch.
- ⬜ `WEB-AUD-02` **If** you enable access for testing (temporarily set a user to `OWNER`/`DIRECTOR` in the DB, or update the gating): perform several actions (create user, publish schedule, approve day-off) → they appear with correct user/action/entity/timestamp; filters (action/entity/date) + reset + sort + expandable before/after diff (with IP/user-agent) work.

### 5.13 Cross-cutting web UX
- ⬜ `WEB-UX-01` Notifications inbox (bell): unread badge, list, mark-one/all read, click navigates; auto-refresh.
- ⬜ `WEB-UX-02` Command palette (Cmd/Ctrl+K); `?` shortcut help; ESC closes modals; tab order sane; focus trap in modals.
- ⬜ `WEB-UX-03` **Help modals** — ⚠️ *`HelpModal.tsx` and `help/` are untracked and NOT part of `main`.* If you ship this build without committing them, help buttons won't exist; if you do commit them, test that the `?` icon opens correct per-page content and ESC/backdrop closes.
- ⬜ `WEB-UX-04` Dark mode toggles all surfaces, persists across reload, no flash.
- ⬜ `WEB-UX-05` Responsive at 375 / 768 / 1024px — sidebar collapses, tables scroll, buttons tappable.
- ⬜ `WEB-UX-06` Loading skeletons, empty states, error banners appear (throttle network to verify).
- ⬜ `WEB-UX-07` ErrorBoundary shows fallback (not white screen) on component crash; client error posts to `/error-report`.
- ⬜ `WEB-UX-08` Direct messages (if enabled): send/receive, unread count, `dm:read` real-time.
- ⬜ `WEB-UX-09` Posts/announcements: create NORMAL + URGENT → notification fires; read receipts visible to staff.

---

## 6. Mobile App — screen by screen (기사/DRIVER)

### 6.1 Home
- ⬜ `MOB-HOME-01` Correct greeting/date; bell shows unread count → Notifications.
- ⬜ `MOB-HOME-02` Today card states: loading, no schedule this month, no slot today, **rest day (휴무)**, working (route/shift/bus/status chip).
- ⬜ `MOB-HOME-03` Emergency alert card appears only when open drops exist (excluding own); tap → Emergency.
- ⬜ `MOB-HOME-04` Upcoming next-3 work days; tap row → detail.
- ⬜ `MOB-HOME-05` **Next-month day-off reminder** within 7 days of month end (if no next-month request), once/day; "확인" → DayOff create with next month preselected; "닫기" dismisses for the day.

### 6.2 Schedule
- ⬜ `MOB-SCH-01` Month navigation (incl. year boundary); stats (work/rest); calendar colors; today highlighted.
- ⬜ `MOB-SCH-02` Work-day list ascending; tap day/row → detail sheet (date/route/shift/bus/status).
- ⬜ `MOB-SCH-03` Pull-to-refresh updates.
- Edge: month with no **published** schedule → empty state (driver must not see unpublished DRAFT).

### 6.3 Emergency
- ⬜ `MOB-EM-01` Available drops auto-refresh (~5s); today badged; own drops excluded.
- ⬜ `MOB-EM-02` **Accept**: confirm → success modal + vibration → slot appears in own schedule; list refreshes.
- ⬜ `MOB-EM-03` **Request substitute for my shift**: expand → pick upcoming shift chip → reason (required) → confirm destructive dialog → success; other drivers notified.
- ⬜ `MOB-EM-04` Emergency push on another screen refetches lists; regaining focus refetches.
- Edge: two drivers accept the same drop → one succeeds, other gets "이미 다른 사람이 받았습니다".
- Edge: accept with no network → offline behavior (MOB-OFF).

### 6.4 Day-off
- ⬜ `MOB-DO-01` Create: calendar work-day dots; past dates disabled; multi-select dates; optional reason; balance pill (red if ≤0); submit → PENDING in history.
- ⬜ `MOB-DO-02` History cards show status + review note (on reject); cancel only while PENDING.
- ⬜ `MOB-DO-03` Deep-link from Home reminder preselects next month.
- Edge: select an already-requested date → prevented/deduped.
- Edge: request more days than balance → defined behavior (blocked or flagged).

### 6.5 Profile & settings
- ⬜ `MOB-PROF-01` Profile: name, formatted phone, monthly activity (work/rest/accepted substitutes).
- ⬜ `MOB-PROF-02` Change password (current + new×2, ≥6, match) → success.
- ⬜ `MOB-PROF-03` Notification settings: master mute; per-channel receive + vibration (EMERGENCY/SCHEDULE/DAYOFF); emergency-channel warning; auto-saves + persists across relaunch.
- ⬜ `MOB-PROF-04` Logout: confirm → clears secure store + push token + query cache → login; relaunch stays logged out.

### 6.6 Notifications
- ⬜ `MOB-NOTIF-01` Grouped by date (Today/Yesterday/…); type icons/colors; unread bold + dot; tap marks read; mark-all works.

### 6.7 Offline & device
- ⬜ `MOB-OFF-01` Airplane mode → offline banner; GET screens show cached data; cache-age sensible.
- ⬜ `MOB-OFF-02` Write offline (day-off/accept) → queued (banner count up), no crash.
- ⬜ `MOB-OFF-03` Reconnect → queue auto-flushes (or via sync button); caches refetch; queued writes land **exactly once** (no duplicates).
- ⬜ `MOB-PUSH-01` First launch: permission prompt (iOS); deny handled gracefully; grant registers Expo push token to backend.
- ⬜ `MOB-PUSH-02` Push token registered offline is retried and synced on reconnect.
- ⬜ `MOB-PUSH-03` Emergency push uses high-priority channel (sound + strong vibration on Android); respects per-channel mute.
- ⬜ `MOB-DEEP-01` Deep links (`busync://…`, `https://busync.kr/…`) open the correct screen when app is cold, backgrounded, foregrounded.
- ⬜ `MOB-MIG-01` Legacy plain-text tokens migrate to secure store on upgrade without forcing unexpected re-login.

---

## 7. End-to-end integration flows (web ↔ mobile)

- ⬜ `E2E-01` **Full monthly cycle**: onboard → set policy → generate DRAFT → tweak cells → publish → all driver phones get `SCHEDULE_PUBLISHED` push + see the month; today/upcoming match the grid.
- ⬜ `E2E-02` **Drop → accept**: Driver A requests substitute (reason) → OPEN drop → available drivers (incl. B) get push + see it → B accepts → A's slot FILLED (by B) → B's schedule includes it → admin Emergency/Today reflect FILLED; A can't be re-assigned that slot.
- ⬜ `E2E-03` **Day-off → approve → schedule**: driver requests next-month off → 관리자 sees PENDING + dashboard count → approves → driver gets `DAY_OFF_APPROVED` push → date becomes rest/dropped; if it opened a slot, others notified.
- ⬜ `E2E-04` **Reject path**: 관리자 rejects with reason → driver gets `DAY_OFF_REJECTED` push + note; schedule unchanged.
- ⬜ `E2E-05` **Emergency escalation (D-2)**: hold an open drop ~2 days out → escalation → 관리자 gets real-time `emergency:urgent` (15s red toast) + in-app notification. (Adjust a test slot's date; see EM-ESC.)
- ⬜ `E2E-06` **Manual fill**: 관리자 assigns a driver → that driver gets push + slot appears; open count drops.
- ⬜ `E2E-07` **Absent path**: let an open drop pass departure → auto-expires; slot ABSENT; reflected in Today + Daily Report.
- ⬜ `E2E-08` **Company-name change** propagates to the driver app after refresh/relaunch.

---

## 8. Real-time (Socket.IO) & scheduled jobs

### 8.1 Socket.IO
- ⬜ `RT-01` With the dashboard open, trigger and confirm toast + cache refresh for: `schedule:published`, `emergency:new`, `emergency:urgent` (15s), `dayoff:reviewed`, `notification:new`, `dm:new`/`dm:read`.
- ⬜ `RT-02` Drop and restore network → socket auto-reconnects (≤10 attempts) and resumes events.
- ⬜ `RT-03` Events scoped to the company room only (re-verify `TEN-03`).
- ⬜ `RT-04` `dm:read` can't be spoofed for a conversation the user isn't part of.

### 8.2 Cron / background jobs
- ⬜ `EM-ESC` Emergency escalation tick (~10 min): open drops re-evaluated; D-2 alerts fire; expired drops → ABSENT. Only **one** of AI-agent vs deterministic escalation runs (per `EMERGENCY_AGENT_ENABLED`).
- ⬜ `DR-CRON` Daily report engine (hourly after 09:00 KST): one report/company/day; `BT`-prefixed companies excluded; idempotent.
- ⬜ `AUD-RET` Audit-log retention (24h): logs older than the window (90d default) purged; disable flag respected.
- ⬜ `AGENT-01` If EMERGENCY_AGENT_ENABLED: agent decisions recorded (cost, tool calls, status); a 관리자 can view and **override** a decision.

---

## 9. Non-functional

### 9.1 Security
- ⬜ `SEC-01` No secrets in client bundles / network responses.
- ⬜ `SEC-02` **IDOR sweep**: for every `/:id` endpoint, company A can't read/modify company B or another user's object (extends `TEN-01`).
- ⬜ `SEC-03` **XSS**: inject `<script>`/HTML into free-text (driver name, reason, notes, post content, day-off reason, company name) → rendered as text everywhere (web tables + mobile cards).
- ⬜ `SEC-04` **Rate limits in prod**: login (10/15m), OTP send (1/60s), OTP verify (5 tries), register (5/h), general API (100/60s), upload (10/60s), error-report (10/60s), global (1500/15m) → 429 + Retry-After.
- ⬜ `SEC-05` Password policy enforced server-side (8–128, upper+digit+special) even if client bypassed.
- ⬜ `SEC-06` File upload: only xlsx/xls (MIME + extension), 10MB cap; renamed executable rejected.
- ⬜ `SEC-07` JWT tampering (alg none / modified payload / expired) → rejected.
- ⬜ `SEC-08` CORS: disallowed origin blocked; only `ALLOWED_ORIGINS` permitted.
- ⬜ `SEC-09` Privacy endpoints: `GET /users/me/export` returns the user's data; `DELETE /users/me/data` requires password + anonymizes.
- ⬜ `SEC-10` Audit log captures security-relevant actions (login, password change, force-logout, account changes) with correct IP — **but note it's currently only viewable by `OWNER`/`DIRECTOR`** (`RBAC-AUDIT`).

### 9.2 Performance & resilience
- ⬜ `PERF-01` Schedule generation for 100+ drivers / multiple routes / full month completes acceptably; progress shown, no freeze.
- ⬜ `PERF-02` Large tables (1000+ drivers/audit logs) paginate/scroll smoothly; search responsive.
- ⬜ `PERF-03` Backend stable under concurrent load; no memory leak over a soak (watch `/api/v1/health` memory).
- ⬜ `PERF-04` DB down briefly → clean 5xx (no crash) → recovers; `/api/v1/health` shows `db:error` then `ok`.
- ⬜ `PERF-05` Redis down (if used) → rate limiting degrades gracefully (in-memory), app still serves.

### 9.3 Compatibility & accessibility
- ⬜ `A11Y-01` Web keyboard-only navigation of core flows; visible focus; ARIA on modals/alerts; screen-reader spot check.
- ⬜ `COMPAT-01` Web on latest Chrome, Safari, Edge, Firefox; mobile web on iOS Safari + Android Chrome.
- ⬜ `COMPAT-02` Mobile app across small/large iPhone, notched/non-notched Android, oldest supported OS.
- ⬜ `I18N-01` All UI copy correct Korean; dates/times in KST; no missing translation keys.

---

## 10. Solver correctness & constitutional rules (deep dive)

> Generate schedules and verify the output **honors the policy**, not just that it ran.

- ⬜ `SOLV-01` **R1 min/max workdays**: no driver below hard-min or above hard-max; sweet-range bias visible; hard-violators reported, not silently produced.
- ⬜ `SOLV-02` **R2 max consecutive days**: no driver exceeds the consecutive-work limit (check across week boundaries).
- ⬜ `SOLV-03` **R9 guaranteed weekend off**: each driver meets the weekend-off minimum.
- ⬜ `SOLV-04` **Rest cycle**: alternating work/rest respected; month-boundary carryover considered.
- ⬜ `SOLV-05` **noAssignOnApprovedOff**: approved day-off never overwritten.
- ⬜ `SOLV-06` **noExpiredLicense / noExpiredQualification**: expired-doc drivers not assigned when rule on.
- ⬜ `SOLV-07` **noSameDayDoubleAssign**: no driver on two routes/shifts same day.
- ⬜ `SOLV-08` **minRestBetweenShifts / noNightStreak**: enforced when enabled.
- ⬜ `SOLV-09` **noNewHireSolo**: <7-day hires not solo when rule requires pairing.
- ⬜ `SOLV-10` **Crew models**: SOLO/PAIR/TRIO produce the right driver count per bus/shift.
- ⬜ `SOLV-11` **Shift systems**: 1/2/3-shift + alternating-day produce expected slot structure.
- ⬜ `SOLV-12` **Familiarity/preferences**: drivers preferentially on assigned/preferred routes; tie-break by preference.
- ⬜ `SOLV-13` **Determinism**: same inputs → same schedule.
- ⬜ `SOLV-14` **Infeasible input**: more slots than capacity → unfilled slots + hard-violators reported, no rule violations, no hang.
- ⬜ `SOLV-15` **Exemptions**: exempt drivers handled and listed, not counted as violations.

---

## 11. Launch go / no-go checklist

- ⬜ Section 1 green — especially `CFG-02` (real SMS), `CFG-03` (Redis), `CFG-06/07` (CORS + NODE_ENV), `CFG-01` (prod secret provisioning).
- ⬜ Section 4 green — **any cross-tenant leak (Section 4.4) is a hard blocker**; the 관리자↔기사 boundary (`RBAC-02/03/04`) holds at the API level.
- ⬜ `RBAC-AUDIT` resolved — decide whether 관리자 should see the Audit Log and act on it.
- ⬜ All E2E flows (Section 7) pass on real devices; push verified on real iOS **and** Android.
- ⬜ Backup + restore verified (`CFG-12`); rate limits verified active (`SEC-04`).
- ⬜ Decide whether the (untracked) Help-modal feature ships; if yes, commit + test (`WEB-UX-03`).
- ⬜ No open `❌` in Sections 1, 4, 7, 10; known `⚠️` documented with owner + follow-up.
- ⬜ Rollback plan documented (revert web/app/API + DB migration).

---

### Appendix — launch-readiness flags found during `main` review
1. **Audit Log unreachable for 관리자.** The page + `GET /audit-logs` are gated to `OWNER`/`DIRECTOR` ([Layout.tsx:73](../packages/admin-web/src/components/Layout.tsx#L73)), but the UI only ever creates `ADMIN` accounts and registration makes the founder `ADMIN` ([companiesController.ts:68](../packages/backend/src/controllers/companiesController.ts#L68)). Result: no app-created user can view audit logs. Decide: include `ADMIN` in the gating, or provide a way to grant `OWNER`. (`RBAC-AUDIT`, `WEB-AUD-01`)
2. **Legacy roles still in the codebase.** The Prisma `Role` enum and many `requireRole('DISPATCH','HR',...)` checks still reference removed roles. They're harmless as long as `ADMIN` is `isFullAccess`, but they're dead surface area — plan a cleanup and confirm `ADMIN` isn't blocked anywhere (`RBAC-05`).
3. **`SMS_DEV_MODE=true`** in the local env — OTP won't actually SMS until set false with real CoolSMS creds (`CFG-02`).
4. **Kakao / CoolSMS creds are placeholders** — those login/recovery paths won't work in prod until filled (`CFG-02`, `CFG-04`).
5. **Redis optional locally** (memory fallback) — prod must run Redis for effective, multi-instance rate limiting (`CFG-03`).
6. **`AI_MODEL_CHAT`** value should be confirmed against a currently valid model id (`CFG-05`).
7. **Help-modal feature is uncommitted** (`HelpModal.tsx`, `help/` are untracked) — not part of `main` (`WEB-UX-03`).
8. **Secrets are in local `.env` (gitignored, not committed)** — ensure prod uses a secret manager and rotate anything that may have been exposed (`CFG-01`).
