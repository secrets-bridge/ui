import { expect, test, type Page } from '@playwright/test';
import { as, call, fx, requestRef } from '../support/stack';

// Request again reopens a closed request as the same request: same
// operation, keys and reason, and it needs approval again. New values
// never come back. These run on cancelled requests, the closed state a
// requester can reach alone; every closed state shows the same button.

test.describe.configure({ mode: 'serial' });

const WHY = 'e2e request again keeps this reason';

async function cancel(page: Page, id: string): Promise<void> {
  expect((await call(page, 'POST', `/api/v1/requests/${id}/cancel`, {})).status, 'cancel').toBe(200);
}

async function submitRead(page: Page): Promise<string> {
  const r = await call(page, 'POST', '/api/v1/requests/read', {
    project_id: fx.project,
    environment: 'dev',
    target_provider_type: 'vault',
    target_secret_ref: fx.secretRef,
    target_keys: ['DB_USER'],
    justification: WHY,
  });
  expect(r.status, 'read submit').toBe(201);
  return String(r.body.id);
}

async function newRequestId(page: Page, oldId: string): Promise<string> {
  await expect(page).not.toHaveURL(new RegExp(oldId));
  const id = new URL(page.url()).pathname.split('/').pop();
  expect(id).toBeTruthy();
  return String(id);
}

test('a change request comes back as a change, with its keys and reason but no values', async ({ browser }) => {
  const page = await as(browser, fx.users.requester);
  const first = await call(page, 'POST', '/api/v1/requests', {
    project_id: fx.project,
    environment: 'dev',
    target_provider_type: 'vault',
    target_secret_ref: fx.secretRef,
    key_values: { DB_USER: 'e2e-first-value' },
    justification: WHY,
  });
  expect(first.status, 'patch submit').toBe(201);
  const id = String(first.body.id);
  await cancel(page, id);

  await page.goto(`/requests/${id}`);
  await page.getByRole('button', { name: 'Request again' }).click();
  const drawer = page.getByRole('dialog', { name: 'Request access' });
  await expect(drawer.getByRole('radio', { name: 'Change values' })).toBeChecked();
  await expect(drawer.locator('#ra-secret')).toHaveValue(fx.secretRef);
  await expect(drawer.getByRole('checkbox', { name: 'DB_USER' })).toBeChecked();
  await expect(drawer.getByRole('checkbox', { name: 'DB_PASSWORD' })).not.toBeChecked();
  await expect(drawer.locator('#ra-why')).toHaveValue(WHY);

  const value = drawer.locator('input[type=password]');
  await expect(value).toHaveCount(1);
  await expect(value, 'an old value came back').toHaveValue('');

  await drawer.getByRole('button', { name: 'Submit request' }).click();
  await expect(drawer.getByText('Enter a new value for every key you picked.')).toBeVisible();

  await value.fill('e2e-second-value');
  await drawer.getByRole('button', { name: 'Submit request' }).click();
  const again = await newRequestId(page, id);
  const body = (await call(page, 'GET', `/api/v1/requests/${again}`)).body;
  expect(body.type).toBe('patch');
  expect(body.status).toBe('pending');
  expect(body.target_keys).toEqual(['DB_USER']);
  expect(body.justification).toBe(WHY);
  await cancel(page, again);
});

test('a read request comes back as a read, with only the keys it named', async ({ browser }) => {
  const page = await as(browser, fx.users.requester);
  const id = await submitRead(page);
  await cancel(page, id);

  await page.goto(`/requests/${id}`);
  await page.getByRole('button', { name: 'Request again' }).click();
  const drawer = page.getByRole('dialog', { name: 'Request access' });
  await expect(drawer.getByRole('radio', { name: 'Read values' })).toBeChecked();
  await expect(drawer.getByRole('checkbox', { name: 'DB_USER' })).toBeChecked();
  await expect(drawer.getByRole('checkbox', { name: 'DB_PASSWORD' })).not.toBeChecked();
  await expect(drawer.locator('#ra-why')).toHaveValue(WHY);
});

test("named keys don't widen to every key when the binding allows them all", async ({ browser }) => {
  const page = await as(browser, fx.users.requester);
  const id = await submitRead(page);
  await cancel(page, id);

  // The seeded binding names its keys, so the list is rewritten to the
  // form a binding with no key limit returns: one row with no key name.
  await page.route(/\/api\/v1\/projects\/[^/]+\/environments\/[^/]+\/secrets$/, async (route) => {
    const res = await route.fetch();
    const rows = (await res.json()) as { key_name: string }[];
    await route.fulfill({ response: res, json: rows.slice(0, 1).map((row) => ({ ...row, key_name: '' })) });
  });

  await page.goto(`/requests/${id}`);
  await page.getByRole('button', { name: 'Request again' }).click();
  const drawer = page.getByRole('dialog', { name: 'Request access' });
  await expect(drawer.getByRole('radio', { name: 'Only these keys' })).toBeChecked();
  await expect(drawer.getByRole('radio', { name: 'All keys in this secret' })).not.toBeChecked();
  await expect(drawer.getByRole('textbox', { name: 'Key names, separated by commas' })).toHaveValue('DB_USER');
});

test('a project the person no longer has asks them to choose again', async ({ browser }) => {
  const page = await as(browser, fx.users.requester);
  const id = await submitRead(page);
  await cancel(page, id);

  await page.route(/\/api\/v1\/users\/me$/, async (route) => {
    const res = await route.fetch();
    await route.fulfill({ response: res, json: { ...(await res.json()), projects: [] } });
  });

  await page.goto(`/requests/${id}`);
  await page.getByRole('button', { name: 'Request again' }).click();
  const drawer = page.getByRole('dialog', { name: 'Request access' });
  await drawer.getByRole('button', { name: 'Submit request' }).click();
  await expect(drawer.getByText('Choose a project and environment.')).toBeVisible();
});

test('a cross-team request comes back in the cross-team form, filled in', async ({ browser }) => {
  const page = await as(browser, fx.users.lead);
  const first = await call(page, 'POST', '/api/v1/requests/cross-team', {
    project_id: fx.project,
    environment: 'dev',
    target_team_id: fx.otherTeam,
    target_project_id: fx.otherProject,
    target_environment_id: fx.otherEnv,
    destination_provider_connection_id: fx.connection,
    destination_secret_ref: fx.destinationRef,
    destination_keys: ['CT_KEY1', 'CT_KEY2'],
    justification: WHY,
  });
  expect(first.status, 'cross-team submit').toBe(201);
  const id = String(first.body.id ?? first.body.request_id);
  await cancel(page, id);

  await page.goto(`/requests/${id}`);
  await page.getByRole('button', { name: 'Request again' }).click();
  const drawer = page.getByRole('dialog', { name: 'Ask another team for values' });
  await expect(drawer.locator('#ct-team')).toHaveValue(fx.otherTeam);
  await expect(drawer.locator('#ct-project')).toHaveValue(fx.otherProject);
  await expect(drawer.locator('#ct-env')).toHaveValue(fx.otherEnv);
  await expect(drawer.locator('#ct-connection')).toHaveValue(fx.connection);
  await expect(drawer.locator('#ct-ref')).toHaveValue(fx.destinationRef);
  await expect(drawer.locator('#ct-keys')).toHaveValue('CT_KEY1, CT_KEY2');
  await expect(drawer.locator('#ct-why')).toHaveValue(WHY);

  await drawer.getByRole('button', { name: 'Send request' }).click();
  const again = await newRequestId(page, id);
  const body = (await call(page, 'GET', `/api/v1/requests/${again}`)).body;
  expect(body.type).toBe('cross_team');
  expect(body.status).toBe('pending_values');
  expect(body.target_team_id).toBe(fx.otherTeam);
  expect(body.destination_secret_ref).toBe(fx.destinationRef);
  expect(body.destination_keys).toEqual(['CT_KEY1', 'CT_KEY2']);
  await cancel(page, again);
});

test('a failed request on the Overview offers Request again', async ({ browser }) => {
  const page = await as(browser, fx.users.requester);
  const id = await submitRead(page);
  await cancel(page, id);

  // Making the agent fail on demand isn't worth the setup: the row is
  // reported as failed, and the rest is the real page.
  await page.route(/\/api\/v1\/requests\?/, async (route) => {
    const res = await route.fetch();
    const rows = (await res.json()) as { id: string }[];
    await route.fulfill({ response: res, json: rows.map((row) => (row.id === id ? { ...row, status: 'failed' } : row)) });
  });

  await page.goto('/');
  await page.getByRole('button', { name: `Request again ${requestRef(id)}` }).click();
  const drawer = page.getByRole('dialog', { name: 'Request access' });
  await expect(drawer.getByRole('radio', { name: 'Read values' })).toBeChecked();
  await expect(drawer.locator('#ra-secret')).toHaveValue(fx.secretRef);
  await expect(drawer.locator('#ra-why')).toHaveValue(WHY);
});
