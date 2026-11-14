import { expect, test } from '@playwright/test';
import { adminPassword, as, call, fx } from '../support/stack';
import { secondFactor } from '../support/totp';

// Role, team and policy writes need a fresh second factor. The console
// asks for it over the form, and the write finishes without starting
// over. The grant is revoked again, so the other specs see the seeded
// accounts unchanged.

test('granting a role asks for the second factor once, and the grant goes through', async ({ browser }) => {
  const setup = await as(browser, fx.users.admin, adminPassword);
  const auth = await secondFactor(setup, fx.users.admin);
  const found = await call(setup, 'GET', `/api/v1/users?q=${encodeURIComponent('e2e-outsider@example.com')}`);
  const id = String((found.body.users as { id: string }[])[0].id);

  // A new session has no stamp yet.
  const page = await as(browser, fx.users.admin, adminPassword);
  await page.goto('/admin/assignments');
  await page.getByRole('button', { name: 'Grant a role' }).click();
  const drawer = page.getByRole('dialog', { name: 'Grant a role' });
  await drawer.getByRole('combobox', { name: 'Person' }).fill('outsider');
  await drawer.getByRole('option', { name: /Outsider/ }).click();
  await drawer.locator('#grant-role-id').selectOption({ label: 'approver (built in)' });
  await drawer.locator('#grant-project').selectOption(fx.otherProject);
  await drawer.getByRole('button', { name: 'Grant role' }).click();

  const confirm = page.getByRole('dialog', { name: "Confirm it's you" });
  await confirm.locator('#stepup-code').fill(await auth.next());
  await confirm.getByRole('button', { name: 'Confirm' }).click();
  await expect(confirm).toBeHidden();
  await expect(page.getByText('Granted approver to Outsider.')).toBeVisible();
  await expect(drawer, 'the drawer closes on its own').toBeHidden();

  const roles = (await call(page, 'GET', '/api/v1/roles')).body as unknown as { id: string; name: string }[];
  const approver = roles.find((r) => r.name === 'approver')?.id;
  const grants = (await call(page, 'GET', '/api/v1/user-roles')).body as unknown as { user_id: string; role_id: string }[];
  expect(grants.filter((g) => g.user_id === id && g.role_id === approver), 'one grant, not two').toHaveLength(1);

  // The session is fresh now, so revoking doesn't ask again.
  await page.getByRole('button', { name: 'Revoke approver from Outsider' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Revoke' }).click();
  await expect(page.getByText('Revoked approver from Outsider.')).toBeVisible();
});

// The api refuses a move that would bring a team under a team where the
// mover holds a role limited to that team (api#339). The console says why
// in words. The refusal itself is the api's to test, so the api's answer
// is stubbed here.
test('a refused team move says why, in words', async ({ browser }) => {
  const page = await as(browser, fx.users.admin, adminPassword);
  await page.route(new RegExp(`/api/v1/teams/${fx.team}$`), (route) =>
    route.request().method() === 'PUT'
      ? route.fulfill({ status: 403, json: { error: 'self_scope_expansion_not_allowed' } })
      : route.fallback(),
  );
  await page.goto(`/admin/teams?team=${fx.team}`);
  await page.getByRole('button', { name: 'Edit team' }).click();
  const drawer = page.getByRole('dialog', { name: 'Edit team' });
  await drawer.locator('#team-parent').selectOption(fx.otherTeam);
  await drawer.getByRole('button', { name: 'Save team' }).click();
  await expect(drawer.getByText('Not saved.')).toBeVisible();
  await expect(drawer.getByText(/so moving this team under it would widen your own access/)).toBeVisible();
  await expect(drawer.getByText('self_scope_expansion_not_allowed'), 'the raw code is not shown').toHaveCount(0);
});
