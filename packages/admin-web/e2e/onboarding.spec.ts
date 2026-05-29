import { test, expect } from '@playwright/test';

/**
 * Onboarding skip flows — newly added in priority 5.
 * These exercise the "나중에 설정" / "지금은 건너뛰기" buttons that let
 * users skip the wizard entirely and land on the dashboard.
 *
 * Requires a logged-in user. Uses the demo seed account.
 */
const DEMO = {
  companyCode: 'DEMO',
  email: 'admin@demo.busync.kr',
  password: 'admin123!',
};

async function login(page: import('@playwright/test').Page) {
  await page.goto('/login');
  await page.getByLabel(/회사 코드/).clear();
  await page.getByLabel(/회사 코드/).fill(DEMO.companyCode);
  await page.getByLabel(/이메일/).clear();
  await page.getByLabel(/이메일/).fill(DEMO.email);
  await page.getByLabel(/비밀번호/).clear();
  await page.getByLabel(/비밀번호/).fill(DEMO.password);
  await page.getByRole('button', { name: /로그인/ }).click();
  await page.waitForURL(/dashboard/, { timeout: 10000 });
}

test.describe('온보딩 스킵 흐름', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'happy-path 한 브라우저만');

  test('헤더의 "나중에 설정" 버튼이 대시보드로 보냄', async ({ page }) => {
    await login(page);
    await page.goto('/dashboard/onboarding');
    await page.getByRole('button', { name: /나중에 설정/ }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
  });

  test('초기 단계의 "지금은 건너뛰기" 카드가 대시보드로 보냄', async ({ page }) => {
    await login(page);
    await page.goto('/dashboard/onboarding');
    await page.getByRole('button', { name: /지금은 건너뛰기/ }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
  });
});
