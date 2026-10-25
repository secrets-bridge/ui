import { readFileSync } from 'node:fs';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { adminPassword, call, fx, keepOutOfArtifacts, signIn, statePath } from '../support/stack';
import { secondFactor } from '../support/totp';

// Agent onboarding v2 (skills#116, ui#176). The seed enrolled e2e-agent
// with the challenge flow (enroll-agent.mjs), so its agent secret and
// X25519 private key exist only in the state dir. These specs check that:
//
// - the enrollment token is never rendered, is copied once with
//   copySecret, and is then gone from the page and absent from storage;
// - the private key and the agent secret are nowhere in the DOM, the api
//   responses the page received, or browser storage;
// - the fingerprint the console shows is the one of the key the agent
//   holds;
// - creating a rotation token asks for a fresh second factor first.
//
// Values are compared with booleans, never with text matchers.

test.describe.configure({ mode: 'serial' });

const privateKey = readFileSync(statePath('agent-creds/private_key'), 'utf8').trim();
const agentSecret = readFileSync(statePath('agent-creds/agent_secret'), 'utf8').trim();

/** A signed-in admin whose page may use the clipboard, and every api response body it gets. */
async function admin(browser: Browser): Promise<{ page: Page; bodies: () => Promise<string[]> }> {
  const ctx = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await ctx.newPage();
  const pending: Promise<string>[] = [];
  page.on('response', (res) => {
    if (new URL(res.url()).pathname.startsWith('/api/')) pending.push(res.text().catch(() => ''));
  });
  await signIn(page, fx.users.admin, adminPassword);
  return { page, bodies: () => Promise.all(pending) };
}

/** Where a value shows up in the page and browser storage. */
async function traces(page: Page, value: string) {
  return page.evaluate(async (v) => {
    const dbs = typeof indexedDB.databases === 'function' ? await indexedDB.databases() : [];
    return {
      dom: document.documentElement.outerHTML.includes(v) || Array.from(document.querySelectorAll('input, textarea')).some((el) => (el as HTMLInputElement).value.includes(v)),
      local: JSON.stringify({ ...localStorage }).includes(v),
      session: JSON.stringify({ ...sessionStorage }).includes(v),
      cookie: document.cookie.includes(v),
      indexedDB: dbs.length > 0,
    };
  }, value);
}
const NONE = { dom: false, local: false, session: false, cookie: false, indexedDB: false };

/**
 * The kubectl apply steps of a command that are not server-side. Client-side
 * apply copies a Secret, plaintext agent_secret and private_key included,
 * into the kubectl.kubernetes.io/last-applied-configuration annotation.
 */
function clientSideApplies(command: string): string[] {
  return command
    .replace(/\\\n/g, ' ')
    .split(/[|\n]/)
    .filter((step) => /\bkubectl\b.*\bapply\b/.test(step) && !/\s--server-side\b/.test(step));
}

/** `sha256:<hex>` of the X25519 public key that belongs to a base64 private key (WebCrypto). */
async function fingerprintOf(privB64: string): Promise<string> {
  const raw = Uint8Array.from(atob(privB64), (c) => c.charCodeAt(0));
  // PKCS#8 wrapper for a raw X25519 private key (RFC 8410).
  const prefix = [0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x6e, 0x04, 0x22, 0x04, 0x20];
  const pkcs8 = new Uint8Array([...prefix, ...raw]);
  const key = await crypto.subtle.importKey('pkcs8', pkcs8, { name: 'X25519' }, true, ['deriveBits']);
  const jwk = await crypto.subtle.exportKey('jwk', key);
  const pub = Uint8Array.from(atob((jwk.x ?? '').replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', pub));
  return 'sha256:' + Array.from(hash, (b) => b.toString(16).padStart(2, '0')).join('');
}

test('an admin onboards an agent: the token is copied once and never stored, and no private key reaches the page', async ({ browser }) => {
  const { page, bodies } = await admin(browser);

  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Agents' }).click();
  await expect(page.getByRole('heading', { name: 'Agents', level: 1 })).toBeVisible();

  // The seeded agent, with the fingerprint of the key it holds.
  const expected = await fingerprintOf(privateKey);
  await page.getByRole('button', { name: 'e2e-agent', exact: true }).first().click();
  const detail = page.getByRole('dialog', { name: 'e2e-agent' });
  await expect(detail.getByText(fx.agent)).toBeVisible();
  await expect(detail.getByText(expected, { exact: true })).toBeVisible();
  await expect(detail.getByText(/X25519 public key, version \d+/)).toBeVisible();
  await expect(detail.getByText(/certificate/i)).toHaveCount(0);
  await detail.getByRole('button', { name: 'Close', exact: true }).last().click();

  // Create a one-time token. Its value is read from the api response only,
  // so the test knows what to look for without the page ever showing it.
  await page.getByRole('button', { name: 'Enroll an agent' }).first().click();
  const form = page.getByRole('dialog', { name: 'Enroll an agent' });
  await form.locator('#enroll-connection').selectOption(fx.connection);
  await form.locator('#enroll-cluster').fill('e2e-cluster-onboard');
  const minted = page.waitForResponse((r) => r.url().includes('/agent-enrollment-token') && r.request().method() === 'POST');
  await form.getByRole('button', { name: 'Create enrollment token' }).click();
  const res = await minted;
  expect(res.status(), 'token created').toBe(201);
  const token = String(((await res.json()) as { enrollment_token?: string }).enrollment_token ?? '');
  expect(token.length, 'the api returned a token').toBeGreaterThan(20);
  keepOutOfArtifacts(token);

  const steps = page.getByRole('dialog', { name: 'Onboard the agent' });
  await expect(steps.getByText('The private key never leaves your machine.')).toBeVisible();
  await expect(steps.getByRole('heading', { name: '2. Paste the one-time token at the prompt' })).toBeVisible();
  expect(await traces(page, token), 'the token before copy').toEqual(NONE);

  // Every command reads the token from stdin and carries none.
  const command = steps.getByLabel('Enrollment command', { exact: true });
  for (const store of ['AWS Secrets Manager', 'Vault', 'Kubernetes Secret', 'Secret manifest']) {
    await steps.getByRole('tab', { name: store }).click();
    const text = (await command.textContent()) ?? '';
    expect(text.includes('--token-file -'), `${store}: token on stdin`).toBe(true);
    expect(text.includes(token), `${store}: the command holds the token`).toBe(false);
    expect(clientSideApplies(text), `${store}: a client-side kubectl apply`).toEqual([]);
    if (store === 'Secret manifest') {
      expect(text.includes('kubectl -n secrets-bridge apply --server-side --field-manager=secrets-bridge-agent -f -'), 'manifest: server-side apply').toBe(true);
    }
  }
  await expect(steps.getByText('Never commit this manifest.')).toBeVisible();
  const helm = (await steps.getByLabel('Helm command', { exact: true }).textContent()) ?? '';
  expect(helm.includes('identity.existingSecret='), 'helm uses identity.existingSecret').toBe(true);
  expect(/enrollment\.|identity\.mode|persistence/.test(helm), 'helm still sets the old enrollment values').toBe(false);

  // Copy once: the clipboard gets the token, then the page lets go of it.
  await steps.getByRole('button', { name: 'Copy token' }).click();
  await expect(steps.getByRole('button', { name: 'Copied', exact: true })).toBeDisabled();
  const clip = await page.evaluate(async (t) => (await navigator.clipboard.readText()) === t, token);
  expect(clip, 'the clipboard holds the token').toBe(true);
  expect(await traces(page, token), 'the token after copy').toEqual(NONE);

  // Copied, so Done closes without asking.
  await steps.getByRole('button', { name: 'Done' }).click();
  await expect(steps).toBeHidden();
  expect(await traces(page, token), 'the token after close').toEqual(NONE);

  // No private key or agent secret anywhere the browser got to see.
  for (const [what, v] of [
    ['private key', privateKey],
    ['agent secret', agentSecret],
  ] as const) {
    expect(await traces(page, v), `the ${what} in the page or storage`).toEqual(NONE);
    const seen = (await bodies()).some((b) => b.includes(v));
    expect(seen, `the ${what} in an api response`).toBe(false);
  }
  const listed = await call(page, 'GET', '/api/v1/admin/agents');
  const raw = JSON.stringify(listed.body);
  expect(raw.includes(privateKey) || raw.includes(agentSecret), 'the admin projection carries key material').toBe(false);
});

test('creating a rotation token asks for a fresh second factor, and the token is copied once', async ({ browser }) => {
  // The admin's factor (added on the first spec that needs it), then a new
  // session, which has no second-factor stamp yet.
  const auth = await secondFactor((await admin(browser)).page, fx.users.admin);
  const { page } = await admin(browser);

  await page.goto('/agents');
  await page.getByRole('button', { name: 'e2e-agent', exact: true }).first().click();
  await page.getByRole('dialog', { name: 'e2e-agent' }).getByRole('button', { name: 'Rotate key…' }).click();
  const start = page.getByRole('dialog', { name: 'Rotate the key of e2e-agent?' });
  await expect(start).toBeVisible();

  const tokens: string[] = [];
  page.on('response', async (r) => {
    if (r.url().includes('/key-rotation') && r.request().method() === 'POST' && r.ok()) {
      const t = String(((await r.json().catch(() => ({}))) as { rotation_token?: string }).rotation_token ?? '');
      if (t) {
        keepOutOfArtifacts(t);
        tokens.push(t);
      }
    }
  });

  // Without a fresh factor nothing is created: cancel the step-up.
  await start.getByRole('button', { name: 'Create rotation token' }).click();
  const confirm = page.getByRole('dialog', { name: "Confirm it's you" });
  await expect(confirm.locator('#stepup-code')).toBeVisible();
  await confirm.getByRole('button', { name: 'Cancel' }).click();
  await expect(start.getByText('No rotation token was created.', { exact: true })).toBeVisible();
  expect(tokens.length, 'a rotation token without a second factor').toBe(0);

  // With it, the token comes back once and is never rendered.
  await start.getByRole('button', { name: 'Create rotation token' }).click();
  await confirm.locator('#stepup-code').fill(await auth.next());
  await confirm.getByRole('button', { name: 'Confirm' }).click();
  const steps = page.getByRole('dialog', { name: 'Rotate the key of e2e-agent' });
  await expect(steps.getByRole('heading', { name: '2. Paste the rotation token at the prompt' })).toBeVisible();
  await expect.poll(() => tokens.length, { message: 'one rotation token' }).toBe(1);
  const token = tokens[0];
  expect(await traces(page, token), 'the rotation token before copy').toEqual(NONE);
  const rotation = steps.getByLabel('Rotation command', { exact: true });
  for (const store of ['AWS Secrets Manager', 'Vault', 'Kubernetes Secret', 'Secret manifest']) {
    await steps.getByRole('tab', { name: store }).click();
    const command = (await rotation.textContent()) ?? '';
    expect(command.includes('rotate-key') && command.includes('--rotation-token-file -'), `${store}: rotate-key reads the token from stdin`).toBe(true);
    expect(command.includes(token), `${store}: the command holds the token`).toBe(false);
    expect(clientSideApplies(command), `${store}: a client-side kubectl apply`).toEqual([]);
    if (store === 'Kubernetes Secret' || store === 'Secret manifest') {
      expect(command.includes('apply --server-side --field-manager=secrets-bridge-agent --force-conflicts -f -'), `${store}: server-side apply`).toBe(true);
    }
  }

  await steps.getByRole('button', { name: 'Copy token' }).click();
  await expect(steps.getByRole('button', { name: 'Copied', exact: true })).toBeDisabled();
  expect(await page.evaluate(async (t) => (await navigator.clipboard.readText()) === t, token), 'the clipboard holds the token').toBe(true);
  expect(await traces(page, token), 'the rotation token after copy').toEqual(NONE);
  await steps.getByRole('button', { name: 'Done' }).click();
  await expect(steps).toBeHidden();
  expect(await traces(page, privateKey), 'the private key in the page or storage').toEqual(NONE);
});
