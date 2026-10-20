import { appendFileSync } from 'node:fs';
import { expect, type Browser, type Page } from '@playwright/test';

// What stack.sh seeded. Ids and emails only; passwords and the canary
// come from their own variables so they stay masked in CI.
export type Fixtures = {
  project: string;
  otherProject: string;
  envDev: string;
  envProd: string;
  secretId: string;
  secretRef: string;
  users: { admin: string; requester: string; approver: string; outsider: string };
};

function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set: run e2e/scripts/stack.sh up and seed, then source the state`);
  return v;
}

export const fx: Fixtures = JSON.parse(need('E2E_FIXTURES'));
export const adminPassword = need('E2E_ADMIN_PASSWORD');
export const userPassword = need('E2E_USER_PASSWORD');
export const canary = need('E2E_CANARY');

/**
 * Records a value the test read from the page (a TOTP setup key) so the
 * leak scan also fails if it ever lands in test output. The file is in
 * the state dir, mode 600, never uploaded.
 */
export function keepOutOfArtifacts(value: string): void {
  appendFileSync(`${need('E2E_STATE')}/test-secrets`, value + '\n', { mode: 0o600 });
}

export async function signIn(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/login');
  await page.locator('#login-email').fill(email);
  await page.locator('#login-password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

/** A fresh browser context signed in as one user. */
export async function as(browser: Browser, email: string, password = userPassword): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await signIn(page, email, password);
  return page;
}

/** The api's answer, as JSON, to a call made with the page's own session cookie. */
export async function call(page: Page, method: 'GET' | 'POST', path: string, data?: unknown) {
  const res = await page.request.fetch(path, { method, data });
  let body: Record<string, unknown> = {};
  try {
    body = await res.json();
  } catch {
    // empty or non-JSON body
  }
  return { status: res.status(), body };
}
