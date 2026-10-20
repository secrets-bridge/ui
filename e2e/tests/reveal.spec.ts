import { expect, test, type Page } from '@playwright/test';
import { as, call, fx, vaultValues } from '../support/stack';
import { secondFactor, stepUp, type Authenticator } from '../support/totp';

// The reveal contract (ui CLAUDE.md): values show only after an explicit
// click and a fresh second factor, never on page load, never in browser
// storage, and they're cleared on Hide now and when the reveal's time is
// up. Values are only checked for presence, never printed or asserted as
// text, so a failure can't put them in the report.

test.describe.configure({ mode: 'serial' });

async function onPage(page: Page): Promise<boolean> {
  return page.evaluate(
    (vals) => vals.some((v) => document.body.innerText.includes(v) || document.documentElement.outerHTML.includes(v)),
    vaultValues,
  );
}

async function inStorage(page: Page): Promise<boolean> {
  return page.evaluate((vals) => {
    const all = JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage });
    return vals.some((v) => all.includes(v));
  }, vaultValues);
}

async function confirmStepUp(page: Page, auth: Authenticator): Promise<void> {
  const dialog = page.getByRole('dialog', { name: "Confirm it's you" });
  await expect(dialog).toBeVisible();
  await dialog.locator('#stepup-code').fill(await auth.next());
  await dialog.getByRole('button', { name: 'Confirm' }).click();
}

async function waitExecuted(page: Page, id: string): Promise<void> {
  await expect
    .poll(async () => (await call(page, 'GET', `/api/v1/requests/${id}`)).body.status, { timeout: 60_000, message: 'the agent ran the read' })
    .toBe('executed');
}

test('values show only after an explicit reveal with a fresh second factor, and Hide now clears them', async ({ browser }) => {
  const requester = await as(browser, fx.users.requester);
  const auth = await secondFactor(requester, fx.users.requester);
  const r = await call(requester, 'POST', `/api/v1/projects/${fx.project}/environments/${fx.envDev}/request`, {
    target_provider_type: 'vault',
    target_secret_ref: fx.secretRef,
    target_keys: ['DB_USER', 'DB_PASSWORD'],
    justification: 'e2e reveal through an approved request',
  });
  expect(r.status, 'submit').toBe(201);
  const id = String(r.body.request_id ?? r.body.id);

  const approver = await as(browser, fx.users.approver);
  await stepUp(approver, await secondFactor(approver, fx.users.approver));
  expect((await call(approver, 'POST', `/api/v1/requests/${id}/approve`, { comment: 'e2e' })).status, 'approve').toBe(200);
  await waitExecuted(requester, id);

  await requester.goto(`/requests/${id}`);
  await expect(requester.getByText('Values are ready to reveal')).toBeVisible();
  expect(await onPage(requester), 'values on the page before any reveal').toBe(false);

  await requester.getByRole('button', { name: 'Reveal values…', exact: true }).click();
  await confirmStepUp(requester, auth);
  const panel = requester.getByRole('region', { name: 'Revealed values' });
  await expect(panel).toBeVisible();
  await expect(panel.getByRole('timer')).toBeVisible();
  expect(await onPage(requester), 'the revealed values are on the page').toBe(true);
  expect(await inStorage(requester), 'revealed values in browser storage').toBe(false);

  await panel.getByRole('button', { name: 'Hide now' }).click();
  await expect(panel).toBeHidden();
  expect(await onPage(requester), 'values left on the page after Hide now').toBe(false);

  // A reload never reveals by itself.
  await requester.reload();
  await expect(requester.getByText('e2e reveal through an approved request').first()).toBeVisible();
  await expect(requester.getByRole('region', { name: 'Revealed values' })).toHaveCount(0);
  expect(await onPage(requester), 'values on the page after a reload').toBe(false);
});

test("a direct reveal closes itself when the policy's time is up and clears the values", async ({ browser }) => {
  // Two fresh TOTP codes (each waits for a new 30 s step), the agent's read
  // and the 10 s reveal TTL run past the default 90 s.
  test.setTimeout(180_000);
  const page = await as(browser, fx.users.requester);
  const auth = await secondFactor(page, fx.users.requester);

  await page.goto(`/projects/${fx.project}/env/${fx.envDev}`);
  await page.getByRole('button', { name: `Reveal ${fx.secretRef}` }).click();
  const drawer = page.getByRole('dialog', { name: 'Reveal directly' });
  await drawer.getByRole('checkbox', { name: 'DB_USER' }).check();
  await drawer.getByRole('checkbox', { name: 'DB_PASSWORD' }).check();
  await drawer.locator('#dr-why').fill('e2e direct reveal that times out');
  await drawer.getByRole('button', { name: 'Reveal directly' }).click();
  // The policy says requires_mfa and this session is new, so the direct
  // reveal asks for the second factor before anything is created.
  await confirmStepUp(page, auth);

  await expect(page).toHaveURL(/\/requests\//);
  const id = page.url().split('/requests/')[1].split(/[?#]/)[0];
  await waitExecuted(page, id);
  await page.reload();
  await expect(page.getByText('Values are ready to reveal')).toBeVisible();
  await page.getByRole('button', { name: 'Reveal values…', exact: true }).click();
  await confirmStepUp(page, auth);

  const panel = page.getByRole('region', { name: 'Revealed values' });
  await expect(panel).toBeVisible();
  expect(await onPage(page), 'the revealed values are on the page').toBe(true);

  // reveal_ttl_seconds is 10 in the seeded policy: the panel closes on its
  // own, with no click, and takes the values with it.
  await expect(panel).toBeHidden({ timeout: 30_000 });
  expect(await onPage(page), 'values left on the page after the time ran out').toBe(false);
});
