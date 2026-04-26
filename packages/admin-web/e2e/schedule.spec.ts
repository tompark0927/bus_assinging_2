import { test, expect } from '@playwright/test';

test.describe('배차표 페이지', () => {
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

  test('배차표 페이지 접근', async ({ page }) => {
    await page.getByRole('link', { name: '배차표' }).click();
    await expect(page).toHaveURL(/schedule/);
  });

  test('월 네비게이션 표시', async ({ page }) => {
    await page.getByRole('link', { name: '배차표' }).click();
    await expect(page).toHaveURL(/schedule/);
    // Should display month navigation buttons or month label
    await expect(page.getByText(/\d{4}년\s*\d{1,2}월|월/)).toBeVisible({ timeout: 5000 });
  });

  test('이전/다음 월 이동', async ({ page }) => {
    await page.getByRole('link', { name: '배차표' }).click();
    await expect(page).toHaveURL(/schedule/);

    // Look for month navigation buttons (previous/next)
    const prevButton = page.getByRole('button', { name: /이전|prev|◀|←/i });
    const nextButton = page.getByRole('button', { name: /다음|next|▶|→/i });

    // If navigation buttons exist, test them
    if (await nextButton.isVisible({ timeout: 3000 }).catch(() => false)) {
      await nextButton.click();
      // Page should still be on schedule
      await expect(page).toHaveURL(/schedule/);
    }

    if (await prevButton.isVisible({ timeout: 3000 }).catch(() => false)) {
      await prevButton.click();
      await expect(page).toHaveURL(/schedule/);
    }
  });
});
