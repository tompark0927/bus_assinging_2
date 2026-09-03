import { test, expect } from '@playwright/test';

// 로그인 화면 자체를 보는 스위트라 저장된 세션을 쓰면 안 된다.
test.use({ storageState: { cookies: [], origins: [] } });

test.describe('인증 흐름', () => {
  test('로그인 페이지가 표시됨', async ({ page }) => {
    await page.goto('/login');
    // 로고는 heading 이 아니라 이미지 — 로그인 카드가 떴는지로 확인한다
    await expect(page.getByRole('img', { name: 'Busync' })).toBeVisible();
    await expect(page.getByRole('button', { name: '로그인' })).toBeVisible();
  });

  test('빈 폼 제출 시 에러 표시', async ({ page }) => {
    await page.goto('/login');
    // Clear the pre-filled fields
    await page.getByLabel('회사 코드', { exact: true }).clear();
    await page.getByLabel('이메일', { exact: true }).clear();
    await page.getByLabel('비밀번호', { exact: true }).clear();
    await page.getByRole('button', { name: /로그인/ }).click();
    // HTML5 required validation should prevent submission
  });

  test('잘못된 자격증명으로 에러 표시', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('회사 코드', { exact: true }).clear();
    await page.getByLabel('회사 코드', { exact: true }).fill('WRONG');
    await page.getByLabel('이메일', { exact: true }).clear();
    await page.getByLabel('이메일', { exact: true }).fill('wrong@test.com');
    await page.getByLabel('비밀번호', { exact: true }).clear();
    await page.getByLabel('비밀번호', { exact: true }).fill('wrongpassword');
    await page.getByRole('button', { name: /로그인/ }).click();
    // 카드 안 인라인 에러(role=alert)로 사유를 보여준다 (예: "유효하지 않은 회사 코드입니다.")
    await expect(page.getByRole('alert').first()).toBeVisible({ timeout: 10000 });
  });

  test('올바른 자격증명으로 대시보드 이동', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('회사 코드', { exact: true }).clear();
    await page.getByLabel('회사 코드', { exact: true }).fill('DEMO');
    await page.getByLabel('이메일', { exact: true }).clear();
    await page.getByLabel('이메일', { exact: true }).fill('admin@demo.busync.kr');
    await page.getByLabel('비밀번호', { exact: true }).clear();
    await page.getByLabel('비밀번호', { exact: true }).fill('admin123!');
    await page.getByRole('button', { name: /로그인/ }).click();
    await expect(page).toHaveURL(/dashboard/, { timeout: 10000 });
  });

  test('인증 없이 대시보드 접근 시 로그인 리다이렉트', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/login/);
  });
});
