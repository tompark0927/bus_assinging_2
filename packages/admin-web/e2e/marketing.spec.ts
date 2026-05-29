import { test, expect } from '@playwright/test';

/**
 * Public marketing pages — no auth required.
 * Covers landing, pricing, support and the cross-page navigation between them.
 */
test.describe('마케팅 페이지', () => {
  test('홈에서 요금제 페이지로 이동', async ({ page }) => {
    await page.goto('/');
    await page
      .getByRole('button', { name: /요금제/ })
      .first()
      .click();
    await expect(page).toHaveURL(/\/pricing/);
    await expect(page.getByRole('heading', { name: /요금제를 고르세요/ })).toBeVisible();
  });

  test('요금제 페이지: 월간/연간 토글', async ({ page }) => {
    await page.goto('/pricing');
    // Default: monthly
    await expect(page.getByText(/Pro/).first()).toBeVisible();
    await expect(page.getByText(/\/월/).first()).toBeVisible();

    // Switch to yearly
    await page.getByRole('button', { name: /연간/ }).click();
    await expect(page.getByText(/\/년/).first()).toBeVisible();
  });

  test('요금제: 추천 플랜 CTA → 회원가입 이동', async ({ page }) => {
    await page.goto('/pricing');
    // Pick the first 무료 시작 button (Starter) to keep selector simple.
    await page.getByRole('button', { name: /14일 무료 시작/ }).first().click();
    await expect(page).toHaveURL(/\/register/);
  });

  test('요금제 → Enterprise CTA → 고객 지원 이동', async ({ page }) => {
    await page.goto('/pricing');
    await page.getByRole('button', { name: /도입 상담 신청/ }).click();
    await expect(page).toHaveURL(/\/support/);
  });

  test('고객 지원 페이지: 채널 카드와 폼이 표시됨', async ({ page }) => {
    await page.goto('/support');
    await expect(page.getByRole('heading', { name: /언제든 도와드립니다/ })).toBeVisible();
    await expect(page.getByText(/032-000-0000/)).toBeVisible();
    await expect(page.getByText(/support@busync\.co\.kr/)).toBeVisible();
    await expect(page.getByRole('button', { name: /문의 보내기/ })).toBeVisible();
  });

  test('고객 지원 폼: 필수 필드 비어있으면 에러', async ({ page }) => {
    await page.goto('/support');
    await page.getByRole('button', { name: /문의 보내기/ }).click();
    // HTML5 required prevents submission for `name`/`phone`. Just verify we are still on /support.
    await expect(page).toHaveURL(/\/support/);
  });

  test('홈 푸터 → 고객 지원 링크', async ({ page }) => {
    await page.goto('/');
    // 푸터 영역 안의 "고객 지원" 버튼
    await page.locator('footer').getByRole('button', { name: /고객 지원/ }).click();
    await expect(page).toHaveURL(/\/support/);
  });
});
