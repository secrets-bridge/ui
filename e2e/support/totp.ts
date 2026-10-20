import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { expect, type Page } from '@playwright/test';
import { call, keepOutOfArtifacts, statePath } from './stack';

// RFC 6238 (SHA-1, 30 s, 6 digits) with WebCrypto, so the suite needs no
// TOTP package. Codes are computed here and typed into the page; they
// are never logged.

function base32(s: string): Uint8Array<ArrayBuffer> {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const clean = s.toUpperCase().replace(/[\s=-]/g, '');
  const out: number[] = [];
  let bits = 0;
  let value = 0;
  for (const ch of clean) {
    const i = alphabet.indexOf(ch);
    if (i < 0) throw new Error('setup key is not base32');
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}

const step = (t: number) => Math.floor(t / 30_000);

async function codeAt(key: string, counter: number): Promise<string> {
  const msg = new Uint8Array(8);
  let c = counter;
  for (let i = 7; i >= 0; i--) {
    msg[i] = c & 0xff;
    c = Math.floor(c / 256);
  }
  const k = await crypto.subtle.importKey('raw', base32(key), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', k, msg));
  const off = mac[mac.length - 1] & 0x0f;
  const bin = ((mac[off] & 0x7f) << 24) | (mac[off + 1] << 16) | (mac[off + 2] << 8) | mac[off + 3];
  return String(bin % 1_000_000).padStart(6, '0');
}

/**
 * One TOTP factor per account. `next()` waits for a time step after the
 * last one used, because the api refuses a code it has already accepted.
 */
export class Authenticator {
  private lastStep: number;
  constructor(
    private readonly key: string,
    private readonly file?: string,
    lastStep = -1,
  ) {
    this.lastStep = lastStep;
  }

  async next(): Promise<string> {
    while (step(Date.now()) <= this.lastStep) {
      await new Promise((r) => setTimeout(r, 1_000));
    }
    this.lastStep = step(Date.now());
    this.save();
    return codeAt(this.key, this.lastStep);
  }

  /** Persists the key and last step so a later spec file reuses the factor without replaying a code. */
  save(): void {
    if (this.file) writeFileSync(this.file, `${this.key} ${this.lastStep}`, { mode: 0o600 });
  }
}

/**
 * The account's TOTP factor: enrolled through /me/mfa the first time any
 * spec needs it, then reused from the state dir. Accounts are shared
 * across spec files and a second factor can't be added without a fresh
 * first one, so each account gets exactly one.
 */
export async function secondFactor(page: Page, email: string): Promise<Authenticator> {
  const file = statePath(`totp-${email}`);
  if (existsSync(file)) {
    const [key, last] = readFileSync(file, 'utf8').trim().split(' ');
    return new Authenticator(key, file, Number(last));
  }
  return enrollTotp(page, file);
}

/** Adds an authenticator app on /me/mfa the way a person does, reading the setup key off the page. */
export async function enrollTotp(page: Page, file?: string): Promise<Authenticator> {
  await page.goto('/me/mfa');
  await page.getByRole('button', { name: /^Add authenticator app/ }).click();
  const drawer = page.getByRole('dialog');
  await drawer.locator('#totp-label').fill('e2e');
  await drawer.getByRole('button', { name: 'Show the code to scan' }).click();
  await drawer.getByText("Can't scan? Type the setup key instead").click();
  const key = ((await drawer.locator('details code').textContent()) ?? '').replace(/\s+/g, '');
  if (!key) throw new Error('no setup key on the page');
  keepOutOfArtifacts(key);
  const auth = new Authenticator(key, file);
  await drawer.locator('#totp-code').fill(await auth.next());
  await drawer.getByRole('button', { name: 'Add app' }).click();
  await drawer.waitFor({ state: 'hidden' });
  return auth;
}

/** A fresh second factor on the page's session through the api (challenge + verify). */
export async function stepUp(page: Page, auth: Authenticator): Promise<void> {
  const factors = await call(page, 'GET', '/api/v1/users/me/mfa/factors');
  const list = (Array.isArray(factors.body) ? factors.body : (factors.body.factors ?? factors.body.items ?? [])) as Array<{ id: string; kind: string }>;
  const totp = list.find((f) => f.kind === 'totp');
  expect(totp, 'the account has a TOTP factor').toBeTruthy();
  const ch = await call(page, 'POST', '/api/v1/auth/mfa/challenge', { kind: 'totp' });
  expect([200, 201]).toContain(ch.status);
  const v = await call(page, 'POST', '/api/v1/auth/mfa/verify', {
    challenge_id: ch.body.challenge_id,
    factor_id: totp!.id,
    code: await auth.next(),
  });
  expect([200, 204]).toContain(v.status);
}
