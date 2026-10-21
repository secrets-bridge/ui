import { expect, test, type Page } from '@playwright/test';
import { as, call, fx, keepOutOfArtifacts, statePath } from '../support/stack';
import { Authenticator, secondFactor, stepUp } from '../support/totp';

// An action that needs a second factor, from an account that has none,
// adds one in place (ui#169): the step-up modal opens the enrollment
// drawer over the page, then asks for the new factor once more, and the
// action goes through. The newcomer account starts with no factor.

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

async function openApprove(page: Page, id: string): Promise<void> {
  await page.goto(`/requests/${id}`);
  await page.getByRole('button', { name: 'Approve…', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Approve', exact: true }).click();
}

test('an approver with no second factor adds one from the Approve dialog, and the vote goes through', async ({ browser }) => {
  const requester = await as(browser, fx.users.requester);
  const id = await submitRead(requester, 'e2e approve with no second factor yet');

  const page = await as(browser, fx.users.newcomer);
  await openApprove(page, id);

  // The Approve dialog stays open underneath, so every click below has
  // to land on the step-up layer, not on that dialog's scrim.
  const add = page.getByRole('dialog', { name: 'Add a second factor' });
  await expect(add).toBeVisible();
  expect(await status(page, id), 'no vote before the second factor').toBe('pending');
  await add.getByRole('button', { name: 'Add authenticator app…' }).click();

  const drawer = page.getByRole('dialog', { name: 'Add authenticator app' });
  await drawer.locator('#totp-label').fill('e2e');
  await drawer.getByRole('button', { name: 'Show the code to scan' }).click();
  await drawer.getByText("Can't scan? Type the setup key instead").click();
  const key = ((await drawer.locator('details code').textContent()) ?? '').replace(/\s+/g, '');
  expect(key, 'a setup key on the page').not.toBe('');
  keepOutOfArtifacts(key);
  const auth = new Authenticator(key, statePath(`totp-${fx.users.newcomer}`));
  await drawer.locator('#totp-code').fill(await auth.next());
  await drawer.getByRole('button', { name: 'Add app' }).click();

  const confirm = page.getByRole('dialog', { name: "Confirm it's you" });
  await expect(confirm.getByText('Your authenticator app is added.')).toBeVisible();
  expect(await status(page, id), 'adding a factor records no vote').toBe('pending');
  // The code that added the app won't be accepted again: the next one.
  await confirm.locator('#stepup-code').fill(await auth.next());
  await confirm.getByRole('button', { name: 'Confirm' }).click();

  await expect.poll(() => status(page, id)).toBe('approved');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('a factor removed in another tab mid step-up offers to add one instead of hanging', async ({ browser }) => {
  const requester = await as(browser, fx.users.requester);
  const id = await submitRead(requester, 'e2e factor removed during the step-up');

  // The other tab has a fresh second factor, so it may remove the factor.
  const other = await as(browser, fx.users.newcomer);
  const auth = await secondFactor(other, fx.users.newcomer);
  await stepUp(other, auth);

  // A new session has no stamp yet, so Approve asks for the factor.
  const page = await as(browser, fx.users.newcomer);
  await openApprove(page, id);
  const confirm = page.getByRole('dialog', { name: "Confirm it's you" });
  await expect(confirm.locator('#stepup-code')).toBeVisible();

  const factors = await call(other, 'GET', '/api/v1/users/me/mfa/factors');
  const list = (Array.isArray(factors.body) ? factors.body : []) as Array<{ id: string }>;
  expect(list.length, 'the account has one factor').toBe(1);
  const removed = await call(other, 'DELETE', `/api/v1/users/me/mfa/factors/${list[0].id}`);
  expect(removed.status, 'factor removed').toBeLessThan(300);

  // The ceremony's next calls learn there is no factor. They must not
  // wait on the modal they run in: the modal offers to add one.
  await confirm.locator('#stepup-code').fill('000000');
  await confirm.getByRole('button', { name: 'Confirm' }).click();
  const add = page.getByRole('dialog', { name: 'Add a second factor' });
  await expect(add).toBeVisible();

  await add.getByRole('button', { name: 'Cancel' }).click();
  await expect(add).toBeHidden();
  expect(await status(page, id), 'nothing recorded').toBe('pending');
});
