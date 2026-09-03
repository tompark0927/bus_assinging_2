import { test, expect } from '@playwright/test';

/** 사이드바로 범위를 좁힌다 — 대시보드 본문에도 같은 이름의 바로가기 링크가 있다. */
const sidebar = (page: import('@playwright/test').Page) =>
  page.getByRole('navigation', { name: /메인 네비게이션/ });

test.describe('사이드바 네비게이션', () => {
  // 로그인은 auth.setup.ts 에서 한 번만 한다 (storageState 재사용).
  test.beforeEach(async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/dashboard/, { timeout: 10000 });
  });

  test('대시보드 링크가 활성화됨', async ({ page }) => {
    const dashboardLink = sidebar(page).getByRole('link', { name: '대시보드' });
    await expect(dashboardLink).toBeVisible();
  });

  test('배차표 페이지로 이동', async ({ page }) => {
    await sidebar(page).getByRole('link', { name: '배차표 관리', exact: true }).click();
    await expect(page).toHaveURL(/schedule/);
  });

  // 기사/버스/노선 관리는 '기초 데이터' 한 페이지로 통합됐다 (구 /drivers, /buses, /routes 없음).
  test('기초 데이터 페이지로 이동', async ({ page }) => {
    await sidebar(page).getByRole('link', { name: '기초 데이터', exact: true }).click();
    await expect(page).toHaveURL(/data/);
  });

  // 대타 관리는 정식 오픈 전까지 사이드바에서 뺐다(Layout.tsx). 라우트는 살아
  // 있으므로 주소로 들어가는 것만 확인한다 — 메뉴를 되살리면 위 형태로 되돌린다.
  test('대타 관리는 사이드바에 없지만 주소로는 열린다', async ({ page }) => {
    await expect(
      sidebar(page).getByRole('link', { name: '대타 관리', exact: true }),
    ).toHaveCount(0);
    await page.goto('/dashboard/emergency');
    await expect(page).toHaveURL(/emergency/);
  });

  test('오늘 운행 현황 페이지로 이동', async ({ page }) => {
    await sidebar(page).getByRole('link', { name: '오늘 운행 현황', exact: true }).click();
    await expect(page).toHaveURL(/today/);
  });

  test('배차표 검산 페이지로 이동', async ({ page }) => {
    await sidebar(page).getByRole('link', { name: '배차표 검산', exact: true }).click();
    await expect(page).toHaveURL(/inspect/);
  });

  test('배차 설정 페이지로 이동', async ({ page }) => {
    await sidebar(page).getByRole('link', { name: '배차 설정', exact: true }).click();
    await expect(page).toHaveURL(/settings/);
  });

  test('계정 관리 페이지로 이동', async ({ page }) => {
    await sidebar(page).getByRole('link', { name: '계정 관리', exact: true }).click();
    await expect(page).toHaveURL(/accounts/);
  });

  test('회사 정보 페이지로 이동', async ({ page }) => {
    await sidebar(page).getByRole('link', { name: '회사 정보', exact: true }).click();
    await expect(page).toHaveURL(/company/);
  });

  test('휴무 요청 페이지로 이동', async ({ page }) => {
    await sidebar(page).getByRole('link', { name: '휴무 요청', exact: true }).click();
    await expect(page).toHaveURL(/dayoff/);
  });

  test('사이드바에 사용자 이름이 표시됨', async ({ page }) => {
    const sidebar = page.getByRole('navigation', { name: /메인 네비게이션/ });
    await expect(sidebar).toBeVisible();
  });

  test('Cmd+K로 커맨드 팔레트 열기', async ({ page }) => {
    await page.keyboard.press('Meta+k');
    // Command palette should appear
    await expect(page.getByPlaceholder(/검색|메뉴|명령/i)).toBeVisible({ timeout: 3000 });
  });

  test('로그아웃 버튼 클릭 시 로그인 페이지로 이동', async ({ page }) => {
    await page.getByRole('button', { name: /로그아웃/ }).click();
    await expect(page).toHaveURL(/login/);
  });
});
