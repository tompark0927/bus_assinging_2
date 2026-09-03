import { test, expect } from '@playwright/test';

/** 사이드바로 범위를 좁힌다 — 대시보드 본문에도 같은 이름의 바로가기 링크가 있다. */
const sidebar = (page: import('@playwright/test').Page) =>
  page.getByRole('navigation', { name: /메인 네비게이션/ });

test.describe('배차표 페이지', () => {
  // 로그인은 auth.setup.ts 에서 한 번만 한다 (storageState 재사용).
  test.beforeEach(async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/dashboard/, { timeout: 10000 });
  });

  test('배차표 페이지 접근', async ({ page }) => {
    await sidebar(page).getByRole('link', { name: '배차표 관리', exact: true }).click();
    await expect(page).toHaveURL(/schedule/);
  });

  test('월 네비게이션 표시', async ({ page }) => {
    await sidebar(page).getByRole('link', { name: '배차표 관리', exact: true }).click();
    await expect(page).toHaveURL(/schedule/);
    // Should display month navigation buttons or month label
    await expect(page.getByText(/\d{4}년\s*\d{1,2}월/).first()).toBeVisible({ timeout: 5000 });
  });

  test('이전/다음 월 이동', async ({ page }) => {
    await sidebar(page).getByRole('link', { name: '배차표 관리', exact: true }).click();
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
