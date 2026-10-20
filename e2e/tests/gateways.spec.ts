import { expect, test, type Page } from '@playwright/test';
import { adminPassword, as, call, fx, keepOutOfArtifacts } from '../support/stack';
import { secondFactor, stepUp } from '../support/totp';

// Gateways admin page and the request page's Argo CD panel (ui#163).
// Enrolling needs the Gateway binary, so this covers what the console
// does on its own: who sees the page, the one-time enrollment token
// (shown masked, never in browser storage, gone on close) and the
// request page for an environment the control plane observes.

test.describe.configure({ mode: 'serial' });

const MASK = '••••••••••••';

/** n random bytes as hex (WebCrypto, so no node typings). */
function rnd(n: number): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => b.toString(16).padStart(2, '0')).join('');
}

async function storageHolds(page: Page, value: string) {
  return page.evaluate(async (v) => {
    const dbs = typeof indexedDB.databases === 'function' ? await indexedDB.databases() : [];
    return {
      local: JSON.stringify({ ...localStorage }).includes(v),
      session: JSON.stringify({ ...sessionStorage }).includes(v),
      cookie: document.cookie.includes(v),
      indexedDB: dbs.length > 0,
    };
  }, value);
}

test('an admin creates a Gateway and its enrollment token is shown once, masked, and never stored', async ({ browser }) => {
  const admin = await as(browser, fx.users.admin, adminPassword);
  const auth = await secondFactor(admin, fx.users.admin);
  await stepUp(admin, auth);

  await admin.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Gateways' }).click();
  await expect(admin.getByRole('heading', { name: 'Gateways', level: 1 })).toBeVisible();

  const name = `e2e-gw-${rnd(3)}`;
  await admin.getByRole('button', { name: 'Create gateway' }).click();
  const create = admin.getByRole('dialog', { name: 'Create gateway' });
  await create.locator('#gw-name').fill(name);
  await create.locator('#gw-boundary').fill('cluster e2e-cluster');
  await create.getByRole('button', { name: 'Create gateway' }).click();

  const mint = admin.getByRole('dialog', { name: 'Create enrollment token' });
  await expect(mint).toBeVisible();
  await mint.getByRole('button', { name: 'Create token' }).click();

  const shown = admin.getByRole('dialog', { name: 'Enrollment token' });
  const field = shown.getByLabel('Enrollment token', { exact: true });
  // A text matcher prints what it received when it fails, which here would
  // be the token. Compare with a boolean instead.
  const masked = () => field.evaluate((el, m) => (el.textContent ?? '').replace(/\s+/g, ' ').trim() === m, MASK);
  await expect.poll(masked, { message: 'the token is masked when the panel opens' }).toBe(true);
  await shown.getByRole('button', { name: 'Show token' }).click();
  await expect(field).not.toHaveText(MASK);
  const token = ((await field.textContent()) ?? '').trim();
  expect(token.length, 'the token is on screen after Show token').toBeGreaterThan(20);
  keepOutOfArtifacts(token);

  expect(await storageHolds(admin, token), 'the token is in browser storage').toEqual({ local: false, session: false, cookie: false, indexedDB: false });
  await shown.getByRole('button', { name: 'Hide token' }).click();
  await expect.poll(masked, { message: 'the token is masked again after Hide token' }).toBe(true);

  // Not copied: closing asks once, then closes.
  await shown.getByRole('button', { name: 'Done' }).click();
  await expect(shown.getByText("You haven't copied the token.")).toBeVisible();
  await shown.getByRole('button', { name: 'Close anyway' }).click();
  await expect(shown).toBeHidden();

  const after = await admin.evaluate((v) => document.documentElement.outerHTML.includes(v), token);
  expect(after, 'the token is still in the page after close').toBe(false);
  expect(await storageHolds(admin, token), 'the token is in browser storage after close').toEqual({ local: false, session: false, cookie: false, indexedDB: false });

  // The list shows the new Gateway as pending, and its detail carries
  // the token's metadata only.
  const row = admin.getByRole('row', { name: new RegExp(name) });
  await expect(row.getByText('Pending', { exact: true })).toBeVisible();
  const list = await call(admin, 'GET', '/api/v1/admin/gateways');
  const gw = (list.body.items as Array<{ id: string; name: string }>).find((g) => g.name === name);
  expect(gw, 'the Gateway is listed').toBeTruthy();
  const detail = await call(admin, 'GET', `/api/v1/admin/gateways/${gw!.id}`);
  expect((detail.body.enrollment_tokens as unknown[]).length).toBe(1);
  expect(JSON.stringify(detail.body).includes(token), 'the detail echoes the token').toBe(false);
});

test('a developer sees no Gateways menu, and the page and its api refuse them', async ({ browser }) => {
  const page = await as(browser, fx.users.requester);
  await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Overview' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Gateways' })).toHaveCount(0);
  await page.goto('/admin/gateways');
  await expect(page.getByText("You can't view Gateways.")).toBeVisible();
  expect((await call(page, 'GET', '/api/v1/admin/gateways')).status, 'GET /admin/gateways').toBe(403);
  expect((await call(page, 'POST', '/api/v1/admin/gateways', { name: 'e2e-nope', boundary: 'x' })).status, 'POST /admin/gateways').toBe(403);
});

test('a change in an environment the control plane observes shows "No observation configured"', async ({ browser }) => {
  const admin = await as(browser, fx.users.admin, adminPassword);
  const src = await call(admin, 'GET', `/api/v1/admin/environments/${fx.envDev}/observation-source`);
  expect(src.status).toBe(200);
  expect(src.body.observation_source).toBe('control_plane');

  const page = await as(browser, fx.users.requester);
  const value = `e2e-gw-value-${rnd(8)}`;
  keepOutOfArtifacts(value);
  const r = await call(page, 'POST', '/api/v1/requests', {
    project_id: fx.project,
    environment: 'dev',
    target_provider_type: 'vault',
    target_secret_ref: fx.secretRef,
    key_values: { DB_PASSWORD: value },
    justification: 'e2e observation panel check',
  });
  expect(r.status, 'submit a change').toBe(201);
  const id = String(r.body.id);

  const obs = await call(page, 'GET', `/api/v1/requests/${id}/observations`);
  expect(obs.status).toBe(200);
  expect(obs.body.rollup).toBe('none');

  await page.goto(`/requests/${id}`);
  const panel = page.getByRole('region', { name: 'Argo CD' });
  await expect(panel).toBeVisible();
  await expect(panel.getByText('No observation configured')).toBeVisible();
  await expect(panel.getByText(/fail/i)).toHaveCount(0);
});
