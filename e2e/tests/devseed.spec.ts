import { expect, test } from '@playwright/test';
import { userPassword } from '../support/stack';

// The api seeds these three accounts only in dev with no other users. The
// stack always has its bootstrap admin, so they must not exist; the CI
// leak scan also fails if the dev seeder's boot banner shows up.
for (const email of ['admin@secrets-bridge.dev', 'approver@secrets-bridge.dev', 'requester@secrets-bridge.dev']) {
  test(`the dev-seed account ${email} can't sign in`, async ({ page }) => {
    await page.goto('/login');
    await page.locator('#login-email').fill(email);
    await page.locator('#login-password').fill(userPassword);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('alert')).toContainText("That email and password didn't match");
    await expect(page).toHaveURL(/\/login/);
  });
}
