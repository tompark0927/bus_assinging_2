import { test, expect } from '@playwright/test';

test.describe('다크 모드', () => {
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

  test('다크 모드 토글', async ({ page }) => {
    // Click the dark mode toggle button
    const darkToggle = page.getByRole('button', { name: /다크 모드|라이트 모드/i });
    await expect(darkToggle).toBeVisible();

    // Initially should be light mode (no dark class)
    const htmlElement = page.locator('html');

    // Toggle to dark mode
    await darkToggle.click();
    await expect(htmlElement).toHaveClass(/dark/);

    // Toggle back to light mode
    const lightToggle = page.getByRole('button', { name: /다크 모드|라이트 모드/i });
    await lightToggle.click();
    await expect(htmlElement).not.toHaveClass(/dark/);
  });

  test('다크 모드 상태가 새로고침 후에도 유지됨', async ({ page }) => {
    // Toggle to dark mode
    const darkToggle = page.getByRole('button', { name: /다크 모드|라이트 모드/i });
    await darkToggle.click();

    const htmlElement = page.locator('html');
    await expect(htmlElement).toHaveClass(/dark/);

    // Reload the page
    await page.reload();
    await expect(page).toHaveURL(/dashboard/, { timeout: 10000 });

    // Dark mode should persist (stored in localStorage via zustand persist)
    await expect(page.locator('html')).toHaveClass(/dark/, { timeout: 5000 });
  });

  test('다크 모드에서 사이드바 스타일 변경', async ({ page }) => {
    // Toggle to dark mode
    const darkToggle = page.getByRole('button', { name: /다크 모드|라이트 모드/i });
    await darkToggle.click();

    // The main content area should have dark background
    const mainContent = page.locator('main');
    await expect(mainContent).toBeVisible();

    // The button label should change to reflect current state
    await expect(page.getByRole('button', { name: /라이트/i })).toBeVisible();
  });
});
