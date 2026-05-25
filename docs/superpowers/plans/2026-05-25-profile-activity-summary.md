# Profile Activity Summary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an "이번 달 활동 요약" card (운행일 / 휴무일 / 대타 수락) to the driver app's ProfileScreen, backed by a new monthly-summary endpoint.

**Architecture:** A new driver-scoped backend endpoint `GET /schedules/:year/:month/summary` computes the three counts server-side (work/rest from the driver's slots using the same merge rule as 내 배차; accepted substitutes from FILLED emergency drops). The mobile ProfileScreen fetches it via react-query and renders a 3-tile stat card.

**Tech Stack:** Backend — Express + Prisma + Jest (mocked prisma). Mobile — React Native + Expo + @tanstack/react-query + i18next + TypeScript.

---

## File Structure

- `packages/backend/src/controllers/scheduleController.ts` — add `getMyMonthlySummary` controller
- `packages/backend/src/routes/schedules.ts` — register `GET /:year/:month/summary`
- `packages/backend/src/__tests__/controllers/schedule.test.ts` — add tests for the controller
- `packages/mobile/src/services/api.ts` — add `schedulesApi.getMonthlySummary`
- `packages/mobile/src/screens/ProfileScreen.tsx` — add the activity-summary card + query + styles
- `packages/mobile/src/i18n/locales/ko.json` — add two profile strings

---

## Task 1: Backend — `getMyMonthlySummary` controller (TDD)

**Files:**
- Modify: `packages/backend/src/controllers/scheduleController.ts`
- Test: `packages/backend/src/__tests__/controllers/schedule.test.ts`

- [ ] **Step 1: Add the failing tests**

In `packages/backend/src/__tests__/controllers/schedule.test.ts`, add `getMyMonthlySummary` to the import block at the top (the existing `import { ... } from '../../controllers/scheduleController';`). Then append this describe block at the end of the file:

```ts
// ─────────────────────────────────────────
// getMyMonthlySummary
// ─────────────────────────────────────────

describe('getMyMonthlySummary controller', () => {
  beforeEach(() => jest.clearAllMocks());

  const driverReq = (year: string, month: string) =>
    createAuthReq({
      user: { id: 10, companyId: 1, email: 'd@test.busync.kr', role: 'DRIVER', name: '기사' },
      params: { year, month },
    });

  it('counts work/rest with DROPPED merged into rest, plus accepted substitutes', async () => {
    const req = driverReq('2026', '5');
    const res = createMockRes();

    mockPrisma.schedule.findUnique.mockResolvedValue({
      id: 1,
      year: 2026,
      month: 5,
      slots: [
        { isRestDay: false, status: 'SCHEDULED' }, // work
        { isRestDay: false, status: 'FILLED' },     // work
        { isRestDay: true, status: 'SCHEDULED' },   // rest
        { isRestDay: false, status: 'DROPPED' },     // rest (merged)
      ],
    });
    mockPrisma.emergencyDrop.count.mockResolvedValue(2);

    await getMyMonthlySummary(req, res);

    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: { year: 2026, month: 5, workDays: 2, restDays: 2, acceptedSubstitutes: 2 },
    });
  });

  it('returns zeros when no schedule exists for the month', async () => {
    const req = driverReq('2026', '7');
    const res = createMockRes();

    mockPrisma.schedule.findUnique.mockResolvedValue(null);
    mockPrisma.emergencyDrop.count.mockResolvedValue(0);

    await getMyMonthlySummary(req, res);

    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: { year: 2026, month: 7, workDays: 0, restDays: 0, acceptedSubstitutes: 0 },
    });
  });

  it('only counts substitutes the driver filled, in this month', async () => {
    const req = driverReq('2026', '5');
    const res = createMockRes();

    mockPrisma.schedule.findUnique.mockResolvedValue({ id: 1, year: 2026, month: 5, slots: [] });
    mockPrisma.emergencyDrop.count.mockResolvedValue(3);

    await getMyMonthlySummary(req, res);

    expect(mockPrisma.emergencyDrop.count).toHaveBeenCalledWith({
      where: {
        filledBy: 10,
        status: 'FILLED',
        slot: { date: { gte: new Date(Date.UTC(2026, 4, 1)), lt: new Date(Date.UTC(2026, 5, 1)) } },
      },
    });
  });

  it('returns 500 on DB error', async () => {
    const req = driverReq('2026', '5');
    const res = createMockRes();

    mockPrisma.schedule.findUnique.mockRejectedValue(new Error('DB error'));

    await getMyMonthlySummary(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd packages/backend && npx jest src/__tests__/controllers/schedule.test.ts -t "getMyMonthlySummary"`
Expected: FAIL — `getMyMonthlySummary is not a function` / import error.

- [ ] **Step 3: Implement the controller**

In `packages/backend/src/controllers/scheduleController.ts`, add this function (e.g. directly after the existing `getSchedule` function, before `generateSchedule`):

```ts
// ─────────────────────────────────────────
// 기사 본인의 월간 활동 요약 (운행일 / 휴무일 / 대타 수락)
// ─────────────────────────────────────────
export const getMyMonthlySummary = async (req: AuthRequest, res: Response) => {
  try {
    const year = parseInt(req.params.year);
    const month = parseInt(req.params.month);

    // 본인 슬롯만 조회 (status/isRestDay 만 필요)
    const schedule = await prisma.schedule.findUnique({
      where: { companyId_year_month: { companyId: req.user!.companyId, year, month } },
      include: {
        slots: {
          where: { driverId: req.user!.id },
          select: { isRestDay: true, status: true },
        },
      },
    });

    // 내 배차 화면과 동일한 병합 규칙: 드랍은 휴무로 집계
    const slots = schedule?.slots ?? [];
    const isRest = (s: { isRestDay: boolean; status: string }) =>
      s.isRestDay || s.status === 'DROPPED';
    const workDays = slots.filter((s) => !isRest(s)).length;
    const restDays = slots.filter((s) => isRest(s)).length;

    // @db.Date 는 UTC 자정으로 저장 → UTC 기준 월 범위로 비교
    const monthStart = new Date(Date.UTC(year, month - 1, 1));
    const monthEnd = new Date(Date.UTC(year, month, 1)); // 다음 달 1일

    const acceptedSubstitutes = await prisma.emergencyDrop.count({
      where: {
        filledBy: req.user!.id,
        status: 'FILLED',
        slot: { date: { gte: monthStart, lt: monthEnd } },
      },
    });

    return res.json({
      success: true,
      data: { year, month, workDays, restDays, acceptedSubstitutes },
    });
  } catch (error) {
    logger.error(error);
    return res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
  }
};
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd packages/backend && npx jest src/__tests__/controllers/schedule.test.ts -t "getMyMonthlySummary"`
Expected: PASS (4 passing).

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/controllers/scheduleController.ts packages/backend/src/__tests__/controllers/schedule.test.ts
git commit -m "feat(backend): add getMyMonthlySummary controller for driver activity"
```

---

## Task 2: Backend — register the route

**Files:**
- Modify: `packages/backend/src/routes/schedules.ts`

- [ ] **Step 1: Add the controller to the route import block**

In `packages/backend/src/routes/schedules.ts`, add `getMyMonthlySummary,` to the existing import from `'../controllers/scheduleController'`:

```ts
import {
  getSchedule,
  getScheduleList,
  generateSchedule,
  updateScheduleSlot,
  manualOverrideSlot,
  publishSchedule,
  deleteSchedule,
  exportScheduleExcel,
  getAIRecommendations,
  bisExport,
  getMyMonthlySummary,
} from '../controllers/scheduleController';
```

- [ ] **Step 2: Register the GET route**

In the same file, add this line immediately after the existing `router.get('/:year/:month', ...scheduleValidation.getSchedule, getSchedule);` line:

```ts
router.get('/:year/:month/summary', ...scheduleValidation.getSchedule, getMyMonthlySummary);
```

(Reuses the existing year/month param validation. The 3-segment path does not collide with the 2-segment `/:year/:month`.)

- [ ] **Step 3: Verify the backend type-checks and the suite still passes**

Run: `cd packages/backend && npx tsc --noEmit && npx jest src/__tests__/controllers/schedule.test.ts`
Expected: tsc clean; all schedule tests PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/backend/src/routes/schedules.ts
git commit -m "feat(backend): expose GET /schedules/:year/:month/summary route"
```

---

## Task 3: Mobile — API client method

**Files:**
- Modify: `packages/mobile/src/services/api.ts`

- [ ] **Step 1: Add `getMonthlySummary` to `schedulesApi`**

In `packages/mobile/src/services/api.ts`, update the `schedulesApi` object to:

```ts
export const schedulesApi = {
  getMySchedule: (year: number, month: number) =>
    // mine=1: 기사 앱은 항상 "본인 슬롯"만 요청 (비기사 계정 로그인 시 회사 전체 노출 방지)
    api.get(`/schedules/${year}/${month}`, { params: { mine: 1 } }),
  getMonthlySummary: (year: number, month: number) =>
    api.get(`/schedules/${year}/${month}/summary`),
  list: () => api.get('/schedules'),
};
```

- [ ] **Step 2: Type-check**

Run: `cd packages/mobile && npx tsc --noEmit`
Expected: no output (clean).

- [ ] **Step 3: Commit**

```bash
git add packages/mobile/src/services/api.ts
git commit -m "feat(mobile): add schedulesApi.getMonthlySummary"
```

---

## Task 4: Mobile — i18n strings

**Files:**
- Modify: `packages/mobile/src/i18n/locales/ko.json`

- [ ] **Step 1: Add two keys to the `profile` object**

In `packages/mobile/src/i18n/locales/ko.json`, inside the `"profile": { ... }` object (which currently starts with `"accountInfo": "계정 정보",`), add these two keys:

```json
    "monthlyActivity": "이번 달 활동 요약",
    "acceptedSubstitutes": "대타 수락",
```

Place them right after the opening `"accountInfo": "계정 정보",` line. Ensure the JSON remains valid (trailing commas only between entries).

- [ ] **Step 2: Validate JSON**

Run: `cd packages/mobile && node -e "JSON.parse(require('fs').readFileSync('src/i18n/locales/ko.json','utf8')); console.log('valid')"`
Expected: `valid`

- [ ] **Step 3: Commit**

```bash
git add packages/mobile/src/i18n/locales/ko.json
git commit -m "feat(mobile): add profile activity summary i18n strings"
```

---

## Task 5: Mobile — ProfileScreen activity-summary card

**Files:**
- Modify: `packages/mobile/src/screens/ProfileScreen.tsx`

- [ ] **Step 1: Update imports**

At the top of `packages/mobile/src/screens/ProfileScreen.tsx`:

Change the React import line to include nothing new (it already imports `useState`). Add the following imports after the existing import block (alongside the other component/service imports):

```ts
import { useQuery } from '@tanstack/react-query';
import { schedulesApi } from '../services/api';
import Skeleton from '../components/Skeleton';
```

(`schedulesApi` is a named export; `api` default import already present stays as-is. `Skeleton` is the default export of the Skeleton component.)

- [ ] **Step 2: Add the summary query inside the component**

In the `ProfileScreen` component body, right after the existing `const [showPasswordModal, setShowPasswordModal] = useState(false);` line, add:

```ts
  const now = new Date();
  const summaryYear = now.getFullYear();
  const summaryMonth = now.getMonth() + 1;
  const { data: summary, isLoading: summaryLoading } = useQuery({
    queryKey: ['my-monthly-summary', summaryYear, summaryMonth],
    queryFn: () =>
      schedulesApi.getMonthlySummary(summaryYear, summaryMonth).then(r => r.data.data),
  });
```

- [ ] **Step 3: Insert the card JSX**

In the returned JSX, find the end of the profile header block — the `</View>` that closes `<View style={styles.profileHeader}>` (immediately followed by the `{/* Menu Items */}` comment). Insert this card between that closing `</View>` and the `{/* Menu Items */}` comment:

```tsx
      {/* Activity Summary */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>{t('profile.monthlyActivity')}</Text>
        {summaryLoading ? (
          <View style={styles.statsRow}>
            <Skeleton height={64} borderRadius={radius.lg} style={{ flex: 1 }} />
            <Skeleton height={64} borderRadius={radius.lg} style={{ flex: 1 }} />
            <Skeleton height={64} borderRadius={radius.lg} style={{ flex: 1 }} />
          </View>
        ) : (
          <View style={styles.statsRow}>
            <View style={[styles.statCard, { backgroundColor: colors.primaryGhost }]}>
              <Text style={[styles.statNum, { color: colors.primary }]}>{summary?.workDays ?? 0}</Text>
              <Text style={styles.statLabel}>{t('schedule.workDays')}</Text>
            </View>
            <View style={[styles.statCard, { backgroundColor: colors.successSoft }]}>
              <Text style={[styles.statNum, { color: colors.successDeep }]}>{summary?.restDays ?? 0}</Text>
              <Text style={styles.statLabel}>{t('schedule.restDays')}</Text>
            </View>
            <View style={[styles.statCard, { backgroundColor: colors.warningSoft }]}>
              <Text style={[styles.statNum, { color: colors.warningDeep }]}>{summary?.acceptedSubstitutes ?? 0}</Text>
              <Text style={styles.statLabel}>{t('profile.acceptedSubstitutes')}</Text>
            </View>
          </View>
        )}
      </View>
```

- [ ] **Step 4: Add the stat styles**

In the `const styles = StyleSheet.create({ ... })` block in the same file, add these entries (e.g. right after the `cardTitle` style):

```ts
  statsRow: { flexDirection: 'row', gap: spacing.sm },
  statCard: {
    flex: 1,
    borderRadius: radius.lg,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  statNum: { fontSize: typography['3xl'], fontWeight: weight.extrabold, letterSpacing: -0.5 },
  statLabel: { fontSize: typography.base, color: colors.textBody, marginTop: 2, fontWeight: weight.semibold },
```

- [ ] **Step 5: Type-check**

Run: `cd packages/mobile && npx tsc --noEmit`
Expected: no output (clean).

- [ ] **Step 6: Commit**

```bash
git add packages/mobile/src/screens/ProfileScreen.tsx
git commit -m "feat(mobile): add monthly activity summary card to ProfileScreen"
```

---

## Final Verification

- [ ] **Backend:** `cd packages/backend && npx tsc --noEmit && npx jest src/__tests__/controllers/schedule.test.ts`
- [ ] **Mobile:** `cd packages/mobile && npx tsc --noEmit`
- [ ] Manually confirm the ProfileScreen renders the new card with 운행일 / 휴무일 / 대타 수락, showing skeletons while loading and `0` when a month has no data.
