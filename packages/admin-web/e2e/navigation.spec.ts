import { test, expect } from '@playwright/test';

test.describe('사이드바 네비게이션', () => {
  test.beforeEach(async ({ page }) => {
    // Login before each test
    await page.goto('/login');
    await page.getByLabel(/회사 코드/).clear();
    await page.getByLabel(/회사 코드/).fill('DEMO');
    await page.getByLabel(/이메일/).clear();
    await page.getByLabel(/이메일/).fill('admin@demo.busync.kr');
    await page.getByLabel(/비밀번호/).clear();
    await page.getByLabel(/비밀번호/).fill('admin123!');
    await page.getByRole('button', { name: /로그인/ }).click();
    await expect(page).toHaveURL(/dashboard/, { timeout: 10000 });
  });

  test('대시보드 링크가 활성화됨', async ({ page }) => {
    const dashboardLink = page.getByRole('link', { name: '대시보드' });
    await expect(dashboardLink).toBeVisible();
  });

  test('배차표 페이지로 이동', async ({ page }) => {
    await page.getByRole('link', { name: '배차표' }).click();
    await expect(page).toHaveURL(/schedule/);
  });

  test('기사 관리 페이지로 이동', async ({ page }) => {
    await page.getByRole('link', { name: '기사 관리' }).click();
    await expect(page).toHaveURL(/drivers/);
  });

  test('버스 관리 페이지로 이동', async ({ page }) => {
    await page.getByRole('link', { name: '버스 관리' }).click();
    await expect(page).toHaveURL(/buses/);
  });

  test('노선 관리 페이지로 이동', async ({ page }) => {
    await page.getByRole('link', { name: '노선 관리' }).click();
    await expect(page).toHaveURL(/routes/);
  });

  test('휴무 요청 페이지로 이동', async ({ page }) => {
    await page.getByRole('link', { name: '휴무 요청' }).click();
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
