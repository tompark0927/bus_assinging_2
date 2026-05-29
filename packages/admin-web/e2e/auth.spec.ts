import { test, expect } from '@playwright/test';

test.describe('인증 흐름', () => {
  test('로그인 페이지가 표시됨', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('heading', { name: /Busync/ })).toBeVisible();
  });

  test('빈 폼 제출 시 에러 표시', async ({ page }) => {
    await page.goto('/login');
    // Clear the pre-filled fields
    await page.getByLabel(/회사 코드/).clear();
    await page.getByLabel(/이메일/).clear();
    await page.getByLabel(/비밀번호/).clear();
    await page.getByRole('button', { name: /로그인/ }).click();
    // HTML5 required validation should prevent submission
  });

  test('잘못된 자격증명으로 에러 표시', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel(/회사 코드/).clear();
    await page.getByLabel(/회사 코드/).fill('WRONG');
    await page.getByLabel(/이메일/).clear();
    await page.getByLabel(/이메일/).fill('wrong@test.com');
    await page.getByLabel(/비밀번호/).clear();
    await page.getByLabel(/비밀번호/).fill('wrongpassword');
    await page.getByRole('button', { name: /로그인/ }).click();
    // Should show error toast
    await expect(page.getByText(/실패/)).toBeVisible({ timeout: 10000 });
  });

  test('올바른 자격증명으로 대시보드 이동', async ({ page }) => {
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

  test('인증 없이 대시보드 접근 시 로그인 리다이렉트', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/login/);
  });
});
