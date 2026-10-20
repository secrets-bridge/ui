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
  otherEnv: string;
  otherTeam: string;
  connection: string;
  destinationRef: string;
  users: { admin: string; requester: string; approver: string; outsider: string; filler: string; lead: string };
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
/** The two values stored in Vault for fx.secretRef (DB_USER, DB_PASSWORD). */
export const vaultValues = [need('E2E_VALUE_USER'), need('E2E_VALUE_PASS')];
/** The values a value provider fills into the cross-team request (CT_KEY1, CT_KEY2). */
export const fillValues = [need('E2E_FILL_1'), need('E2E_FILL_2')];
/** The value already in the cross-team destination that a patch must keep. */
export const keepValue = need('E2E_KEEP');

/**
 * Reads a KV v2 secret straight from the stack's Vault, to check what the
 * agent wrote. The data stays in memory; callers compare, never print.
 */
export async function vaultData(path: string): Promise<Record<string, string>> {
  const res = await fetch(`${need('E2E_VAULT_URL')}/v1/sbkv/data/${path}`, { headers: { 'X-Vault-Token': need('E2E_VAULT_TOKEN') } });
  if (!res.ok) throw new Error(`vault read ${res.status}`);
  const body = (await res.json()) as { data?: { data?: Record<string, string> } };
  return body.data?.data ?? {};
}

/** REQ-XXXXXX, the way the console names a request. */
export function requestRef(id: string): string {
  return 'REQ-' + id.replace(/-/g, '').slice(0, 6).toUpperCase();
}

/**
 * Records a value the test read from the page (a TOTP setup key) so the
 * leak scan also fails if it ever lands in test output. The file is in
 * the state dir, mode 600, never uploaded. In GitHub Actions,
 * mask-recorded.ts also masks the value in the job log as soon as the
 * step that recorded it ends.
 */
export function keepOutOfArtifacts(value: string): void {
  appendFileSync(`${need('E2E_STATE')}/test-secrets`, value + '\n', { mode: 0o600 });
}

/** A path in the state dir (mode 700, never uploaded) for per-run test state. */
export function statePath(name: string): string {
  return `${need('E2E_STATE')}/${name}`;
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
