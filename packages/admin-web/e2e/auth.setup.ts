import { test as setup, expect } from '@playwright/test';

/**
 * 로그인 한 번만 하고 세션을 파일로 남긴다.
 *
 * 예전에는 테스트마다 beforeEach 로 로그인했다. 19번 로그인이 같은 IP 에서
 * 연달아 들어가니 **브루트포스 방지(15분 10회)에 걸려 429** 가 떨어졌고,
 * CI 에서 로그인이 필요한 테스트가 무더기로 실패했다. 제품이 제 일을 한 것이라
 * 한도를 낮출 게 아니라 테스트가 세션을 재사용해야 한다.
 * (덤으로 스위트가 훨씬 빨라진다)
 */
const AUTH_FILE = 'playwright/.auth/admin.json';

setup('로그인 세션 저장', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('회사 코드', { exact: true }).clear();
  await page.getByLabel('회사 코드', { exact: true }).fill('DEMO');
  await page.getByLabel('이메일', { exact: true }).clear();
  await page.getByLabel('이메일', { exact: true }).fill('admin@demo.busync.kr');
  await page.getByLabel('비밀번호', { exact: true }).clear();
  await page.getByLabel('비밀번호', { exact: true }).fill('admin123!');
  await page.getByRole('button', { name: /로그인/ }).click();
  await expect(page).toHaveURL(/dashboard/, { timeout: 15000 });

  await page.context().storageState({ path: AUTH_FILE });
});
