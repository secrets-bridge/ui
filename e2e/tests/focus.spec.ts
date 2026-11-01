import { expect, test, type Page } from '@playwright/test';
import { as, call, fx, requestRef, signIn, userPassword } from '../support/stack';
import { secondFactor } from '../support/totp';

// Overview and Approvals put the one next thing first. The decision there
// is the same decision as on the request page: it goes through the same
// dialogs, the same second factor and the same api.

test.describe.configure({ mode: 'serial' });

async function submit(page: Page, why: string): Promise<string> {
  const r = await call(page, 'POST', '/api/v1/requests/read', {
    project_id: fx.project,
    environment: 'dev',
    target_provider_type: 'vault',
    target_secret_ref: fx.secretRef,
    target_keys: ['DB_USER'],
    justification: why,
  });
  expect(r.status, 'submit').toBe(201);
  return String(r.body.id);
}

const cancel = (page: Page, id: string) => call(page, 'POST', `/api/v1/requests/${id}/cancel`, {});

test('Approvals shows the oldest request first and decides it with the second factor', async ({ browser }) => {
  test.setTimeout(120_000);
  const requester = await as(browser, fx.users.requester);
  const first = await submit(requester, 'e2e focus: the oldest request');
  const second = await submit(requester, 'e2e focus: the next request');

  const approver = await as(browser, fx.users.approver);
  const auth = await secondFactor(approver, fx.users.approver);
  await call(approver, 'POST', '/api/v1/auth/logout');
  await signIn(approver, fx.users.approver, userPassword);

  await approver.goto('/approvals');
  await expect(approver.getByRole('heading', { name: 'Approvals', level: 1 })).toBeVisible();
  const next = approver.locator('section', { hasText: 'Next up' });
  const count = async (id: string) => next.getByText(requestRef(id)).count();
  // Older requests from other specs can sit ahead of these two; decide on
  // whichever is up, and check the order through the page's own rows.
  await expect(approver.getByRole('button', { name: `Review ${requestRef(second)}` })).toBeVisible();
  expect(await count(second), 'the newer request is not next').toBe(0);

  const ref = await next.getByText(/^REQ-/).first().innerText();
  await next.getByRole('button', { name: 'Reject…', exact: true }).click();
  await expect(approver.getByRole('dialog', { name: new RegExp(ref) })).toBeVisible();
  await approver.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();

  await next.getByRole('button', { name: 'Approve…', exact: true }).click();
  const dialog = approver.getByRole('dialog', { name: `Approve ${ref}?` });
  await dialog.getByRole('button', { name: 'Approve', exact: true }).click();
  const stepUp = approver.getByRole('dialog', { name: "Confirm it's you" });
  await expect(stepUp).toBeVisible();
  await stepUp.locator('#stepup-code').fill(await auth.next());
  await stepUp.getByRole('button', { name: 'Confirm' }).click();
  await expect(approver.getByText(`You approved ${ref}.`)).toBeVisible();
  await expect(next.getByText(ref, { exact: true })).toHaveCount(0);

  await cancel(requester, first);
  await cancel(requester, second);
});

test('the filters narrow Then, and nobody sees their own request', async ({ browser }) => {
  const lead = await as(browser, fx.users.lead);
  const mine = await submit(lead, 'e2e focus: my own request');
  const requester = await as(browser, fx.users.requester);
  const a = await submit(requester, 'e2e focus: filter one');
  const b = await submit(requester, 'e2e focus: filter two');

  await lead.goto('/approvals');
  await expect(lead.getByRole('button', { name: `Review ${requestRef(b)}` })).toBeVisible();
  await expect(lead.getByText(requestRef(mine)), 'your own request is not for you to decide').toHaveCount(0);

  await lead.getByRole('button', { name: 'Production only' }).click();
  await expect(lead.getByRole('button', { name: `Review ${requestRef(b)}` })).toHaveCount(0);
  await expect(lead.getByText('Nothing here matches these filters.')).toBeVisible();
  await lead.getByRole('button', { name: 'Production only' }).click();
  await expect(lead.getByRole('button', { name: `Review ${requestRef(b)}` })).toBeVisible();

  await cancel(lead, mine);
  await cancel(requester, a);
  await cancel(requester, b);
});

test('a request past its deadline never takes Next up', async ({ browser }) => {
  const requester = await as(browser, fx.users.requester);
  const late = await submit(requester, 'e2e focus: past its deadline');

  const lead = await as(browser, fx.users.lead);
  await lead.route(/\/api\/v1\/workflows$/, async (route) => {
    const res = await route.fetch();
    const rows = (await res.json()) as { request_ttl_seconds: number }[];
    await route.fulfill({ response: res, json: (Array.isArray(rows) ? rows : []).map((w) => ({ ...w, request_ttl_seconds: 1 })) });
  });

  // The workflow's one-second limit has to run out before the page reads
  // the clock, or the request is still decidable.
  await lead.waitForTimeout(1_500);
  await lead.goto('/approvals');
  await expect(lead.getByRole('button', { name: `Review ${requestRef(late)}` })).toBeVisible();
  await expect(lead.getByText('past its deadline').first()).toBeVisible();
  await expect(lead.locator('section', { hasText: 'Next up' }), 'nothing left to approve').toHaveCount(0);

  await cancel(requester, late);
});

test('someone whose approver role is limited gets a sentence, not an empty page', async ({ browser }) => {
  const lead = await as(browser, fx.users.lead);
  await lead.route(/\/api\/v1\/users\/me$/, async (route) => {
    const res = await route.fetch();
    await route.fulfill({ response: res, json: { ...(await res.json()), global_permissions: [] } });
  });
  await lead.route(/\/api\/v1\/requests\?status=pending/, (route) => route.fulfill({ json: [] }));
  await lead.goto('/approvals');
  await expect(lead.getByText('Deciding from this console needs a company-wide approver role.')).toBeVisible();
});

test('someone who only approves lands on Approvals, and sees no Requests', async ({ browser }) => {
  const lead = await as(browser, fx.users.lead);
  await lead.route(/\/api\/v1\/users\/me$/, async (route) => {
    const res = await route.fetch();
    const me = await res.json();
    await route.fulfill({ response: res, json: { ...me, permissions: me.permissions.filter((p: string) => p !== 'secret.request') } });
  });
  await lead.goto('/requests');
  await expect(lead).toHaveURL(/\/approvals$/);
  const nav = lead.getByRole('navigation', { name: 'Main' });
  await expect(nav.getByRole('link', { name: 'Approvals' })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Requests' })).toHaveCount(0);
});

test('counters are tabs: arrows move between them, and each shows its list', async ({ browser }) => {
  const requester = await as(browser, fx.users.requester);
  const id = await submit(requester, 'e2e focus: in motion');
  await requester.goto('/');
  const tabs = requester.getByRole('tablist', { name: 'Show' });
  await tabs.getByRole('tab', { name: /Needs you/ }).focus();
  await requester.keyboard.press('ArrowRight');
  await expect(tabs.getByRole('tab', { name: /In motion/ })).toHaveAttribute('aria-selected', 'true');
  await expect(tabs.getByRole('tab', { name: /In motion/ })).toBeFocused();
  await expect(requester.getByRole('tabpanel').getByRole('link', { name: 'DB_USER', exact: true }).first()).toBeVisible();
  await requester.keyboard.press('ArrowRight');
  await expect(tabs.getByRole('tab', { name: /Closed/ })).toHaveAttribute('aria-selected', 'true');
  await cancel(requester, id);
});

test('the scope in the top bar filters Overview, Approvals and Requests, and only those', async ({ browser }) => {
  const requester = await as(browser, fx.users.requester);
  const id = await submit(requester, 'e2e focus: scope');
  await requester.goto('/requests');
  const row = requester.getByRole('region', { name: 'Your requests' }).getByText(requestRef(id));
  await expect(row).toBeVisible();

  const scope = requester.getByRole('combobox', { name: 'Scope' });
  await scope.selectOption({ label: 'e2e-other · dev' });
  await expect(row).toHaveCount(0);
  await scope.selectOption({ index: 0 });
  await expect(row).toBeVisible();

  await requester.goto('/secrets');
  await expect(requester.getByRole('combobox', { name: 'Scope' })).toHaveCount(0);
  await expect(requester.getByRole('link', { name: 'Docs' })).toBeVisible();
  await cancel(requester, id);
});
