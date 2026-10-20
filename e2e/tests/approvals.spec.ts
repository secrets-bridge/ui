import { expect, test, type Page } from '@playwright/test';
import { adminPassword, as, call, fx, signIn, userPassword } from '../support/stack';
import { secondFactor, stepUp } from '../support/totp';

test.describe.configure({ mode: 'serial' });

async function submitRead(page: Page, why: string): Promise<string> {
  const r = await call(page, 'POST', `/api/v1/projects/${fx.project}/environments/${fx.envDev}/request`, {
    target_provider_type: 'vault',
    target_secret_ref: fx.secretRef,
    target_keys: ['DB_USER'],
    justification: why,
  });
  expect(r.status, 'submit').toBe(201);
  return String(r.body.request_id ?? r.body.id);
}

async function status(page: Page, id: string): Promise<string> {
  return String((await call(page, 'GET', `/api/v1/requests/${id}`)).body.status);
}

test('an approval with a stale second factor asks for it again and only then records the vote', async ({ browser }) => {
  const requester = await as(browser, fx.users.requester);
  const id = await submitRead(requester, 'e2e step-up check for an approval');

  const approver = await as(browser, fx.users.approver);
  const auth = await secondFactor(approver, fx.users.approver);
  // A new session has no second factor yet: sign out and back in.
  await call(approver, 'POST', '/api/v1/auth/logout');
  await signIn(approver, fx.users.approver, userPassword);

  await approver.goto(`/requests/${id}`);
  // Exact names: the user menu shows the account's display name, which
  // for this account starts with "Approve" too.
  await approver.getByRole('button', { name: 'Approve…', exact: true }).click();
  await approver.getByRole('dialog').getByRole('button', { name: 'Approve', exact: true }).click();

  const stepUpDialog = approver.getByRole('dialog', { name: "Confirm it's you" });
  await expect(stepUpDialog).toBeVisible();
  expect(await status(approver, id), 'no vote before the second factor').toBe('pending');

  await stepUpDialog.locator('#stepup-code').fill(await auth.next());
  await stepUpDialog.getByRole('button', { name: 'Confirm' }).click();
  await expect.poll(() => status(approver, id)).toBe('approved');
});

test("nobody, admin included, can approve or reject their own request", async ({ browser }) => {
  const admin = await as(browser, fx.users.admin, adminPassword);
  const auth = await secondFactor(admin, fx.users.admin);
  await stepUp(admin, auth);
  const id = await submitRead(admin, 'e2e separation of duties check');

  await admin.goto(`/requests/${id}`);
  // The request itself has loaded (its justification shows) before the
  // absence checks, so they can't pass on a half-rendered page.
  await expect(admin.getByText('e2e separation of duties check').first()).toBeVisible();
  await expect(admin.getByRole('button', { name: 'Approve…', exact: true })).toHaveCount(0);
  await expect(admin.getByRole('button', { name: 'Reject…', exact: true })).toHaveCount(0);

  // The server refuses it too, whatever the page shows.
  const ap = await call(admin, 'POST', `/api/v1/requests/${id}/approve`, { comment: 'mine' });
  expect(ap.status).toBe(403);
  expect(ap.body.error).toBe('separation_of_duties_violated');
  const rj = await call(admin, 'POST', `/api/v1/requests/${id}/reject`, { reason: 'mine to close' });
  expect(rj.status).toBe(403);
  expect(rj.body.error).toBe('separation_of_duties_violated');
  expect(await status(admin, id)).toBe('pending');
});
