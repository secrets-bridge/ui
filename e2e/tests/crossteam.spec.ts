import { expect, test, type Locator, type Page } from '@playwright/test';
import { as, call, fillValues, fx, keepValue, requestRef, vaultData } from '../support/stack';
import { secondFactor, stepUp, type Authenticator } from '../support/totp';

// The cross-team flow: a lead in team alpha asks team beta's value
// provider for values; the provider fills them; an approver who is
// neither verifies; the agent writes them. The lead and the provider can
// both approve, so separation of duties is the only thing stopping them
// from verifying. Filled values are compared in memory only, never
// printed or matched as text.

test.describe.configure({ mode: 'serial' });

async function submitCrossTeam(page: Page, why: string): Promise<string> {
  const r = await call(page, 'POST', '/api/v1/requests/cross-team', {
    project_id: fx.project,
    environment: 'dev',
    target_team_id: fx.otherTeam,
    target_project_id: fx.otherProject,
    target_environment_id: fx.otherEnv,
    destination_provider_connection_id: fx.connection,
    destination_secret_ref: fx.destinationRef,
    destination_keys: ['CT_KEY1', 'CT_KEY2'],
    justification: why,
  });
  expect(r.status, 'cross-team submit').toBe(201);
  expect(r.body.status).toBe('pending_values');
  return String(r.body.id ?? r.body.request_id);
}

async function status(page: Page, id: string): Promise<string> {
  return String((await call(page, 'GET', `/api/v1/requests/${id}`)).body.status);
}

async function fillValuesOn(page: Page): Promise<boolean> {
  return page.evaluate((vals) => {
    const html = document.documentElement.outerHTML + document.body.innerText;
    const inputs = Array.from(document.querySelectorAll('input, textarea')).map((el) => (el as HTMLInputElement).value).join('\n');
    const storage = JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage });
    return vals.some((v) => html.includes(v) || inputs.includes(v) || storage.includes(v));
  }, fillValues);
}

/** Answers the step-up prompt if the action asks for one, then waits for `done`. */
async function stepUpIfAsked(page: Page, auth: Authenticator, done: Locator): Promise<void> {
  const dialog = page.getByRole('dialog', { name: "Confirm it's you" });
  await expect(dialog.or(done).first()).toBeVisible();
  if (await dialog.isVisible()) {
    await dialog.locator('#stepup-code').fill(await auth.next());
    await dialog.getByRole('button', { name: 'Confirm' }).click();
  }
  try {
    await expect(done).toBeVisible();
  } catch (err) {
    // Say which error banner the page showed instead. Banners carry the
    // api's status and error code, never a value.
    const banners = await page.getByRole('alert').allInnerTexts().catch(() => []);
    const stillAsking = (await dialog.isVisible()) ? await dialog.innerText() : '';
    throw new Error(`${(err as Error).message}\nbanners on the page: ${JSON.stringify(banners)}\nstep-up dialog: ${JSON.stringify(stillAsking)}`, {
      cause: err,
    });
  }
}

test('a value provider fills it, nobody involved can verify, and an independent approver lets the agent write it', async ({ browser }) => {
  // Three accounts enroll and step up (each TOTP code waits for a fresh
  // 30 s step) and the agent runs the patch: past the default 90 s.
  test.setTimeout(180_000);
  const requester = await as(browser, fx.users.lead);
  const id = await submitCrossTeam(requester, 'e2e cross-team values from team beta');
  const ref = requestRef(id);

  // The value provider opens the fill page from the request's link. The
  // inbox list stays empty for a global value_provider grant until api#166.
  const filler = await as(browser, fx.users.filler);
  const fillerAuth = await secondFactor(filler, fx.users.filler);
  await filler.goto(`/inbox/${id}`);
  for (const [i, key] of ['CT_KEY1', 'CT_KEY2'].entries()) {
    await expect(filler.locator(`#fill-${key}`)).toHaveAttribute('type', 'password');
    await filler.locator(`#fill-${key}`).fill(fillValues[i]);
  }
  await filler.locator('#fill-comment').fill('e2e fill');
  expect(await fillValuesOn(filler), 'the check sees the values while they are in the form').toBe(true);
  await filler.getByRole('button', { name: 'Send 2 values' }).click();
  await stepUpIfAsked(filler, fillerAuth, filler.getByRole('status').getByText(`Sent 2 values for ${ref}`));
  await expect(filler).toHaveURL(/\/inbox$/);
  expect(await fillValuesOn(filler), 'filled values left in the page or storage').toBe(false);
  await expect.poll(() => status(requester, id)).toBe('pending_verification');

  // The lead sees key names only, and can't vote on their own request.
  await requester.goto(`/requests/${id}`);
  await expect(requester.getByText('Verify the filled values')).toBeVisible();
  await expect(requester.getByText("You can't vote on this request: you asked for it.")).toBeVisible();
  expect(await fillValuesOn(requester), 'filled values on the requester page').toBe(false);
  const asRequester = await call(requester, 'GET', `/api/v1/requests/${id}`);
  expect(fillValues.some((v) => JSON.stringify(asRequester.body).includes(v)), 'filled values in the request the requester reads').toBe(false);
  // Past the permission and step-up checks, so only separation of duties
  // can refuse it.
  await stepUp(requester, await secondFactor(requester, fx.users.lead));
  const vote = { voted_as: 'source', decision: 'approve', comment: 'e2e' };
  const rv = await call(requester, 'POST', `/api/v1/requests/${id}/verify`, vote);
  expect([rv.status, rv.body.error ?? rv.body.code]).toEqual([403, 'separation_of_duties_violated']);

  // Neither can the value provider.
  await filler.goto(`/requests/${id}`);
  await expect(filler.getByText("You can't vote on this request: you provided the values.")).toBeVisible();
  const fv = await call(filler, 'POST', `/api/v1/requests/${id}/verify`, vote);
  expect([fv.status, fv.body.error ?? fv.body.code], 'the value provider verifying').toEqual([403, 'separation_of_duties_violated']);

  // An approver who is neither verifies as source.
  const approver = await as(browser, fx.users.approver);
  const approverAuth = await secondFactor(approver, fx.users.approver);
  await approver.goto(`/requests/${id}`);
  await expect(approver.getByText('Verify the filled values')).toBeVisible();
  await approver.getByRole('button', { name: 'Approve…', exact: true }).click();
  await approver.getByRole('dialog').getByRole('button', { name: 'Approve', exact: true }).click();
  await stepUpIfAsked(approver, approverAuth, approver.getByRole('status').getByText(`Approved ${ref}`));

  // The agent writes the two keys and leaves the rest of the secret alone.
  await expect.poll(() => status(requester, id), { timeout: 60_000, message: 'the agent ran the patch' }).toBe('executed');
  const stored = await vaultData(fx.destinationRef);
  expect(
    { one: stored.CT_KEY1 === fillValues[0], two: stored.CT_KEY2 === fillValues[1], kept: stored.UNTOUCHED === keepValue },
    'what the agent wrote to Vault',
  ).toEqual({ one: true, two: true, kept: true });
});

test('a value provider can refuse with a reason, and the requester sees it refused', async ({ browser }) => {
  const requester = await as(browser, fx.users.requester);
  const id = await submitCrossTeam(requester, 'e2e cross-team request that gets refused');
  const ref = requestRef(id);

  const filler = await as(browser, fx.users.filler);
  const auth = await secondFactor(filler, fx.users.filler);
  await filler.goto(`/inbox/${id}`);
  await filler.getByRole('button', { name: 'Refuse…', exact: true }).click();
  const dialog = filler.getByRole('dialog', { name: `Refuse ${ref}?` });
  await dialog.locator('#refuse-reason').fill('too short');
  await dialog.getByRole('button', { name: 'Refuse request' }).click();
  await expect(dialog.getByText(/Give a reason of at least 10 characters/)).toBeVisible();
  expect(await status(requester, id), 'a too-short reason refuses nothing').toBe('pending_values');

  await dialog.locator('#refuse-reason').fill('team beta does not own these values');
  await dialog.getByRole('button', { name: 'Refuse request' }).click();
  await stepUpIfAsked(filler, auth, filler.getByRole('status').getByText(`Refused ${ref}`));
  await expect.poll(() => status(requester, id)).toBe('refused');

  await requester.goto(`/requests/${id}`);
  await expect(requester.getByText(/^Refused by /).first()).toBeVisible();
  await expect(requester.getByText('team beta does not own these values').first()).toBeVisible();
});
