import { expect, test, type Browser, type Page } from '@playwright/test';
import { adminPassword, as, call, fx } from '../support/stack';
import { secondFactor, stepUp } from '../support/totp';

// Admins pick people by name or email and read names in the lists,
// instead of handling raw user ids. Someone the lookup refuses keeps the
// plain id box. Every grant and member added here is removed again, so
// the other specs see the seeded accounts unchanged.

test.describe.configure({ mode: 'serial' });

const admin = (browser: Browser) => as(browser, fx.users.admin, adminPassword);

async function userId(page: Page, email: string): Promise<string> {
  const r = await call(page, 'GET', `/api/v1/users?q=${encodeURIComponent(email)}`);
  expect(r.status, 'user search').toBe(200);
  return String((r.body.users as { id: string }[])[0].id);
}

function grantDrawer(page: Page) {
  return page.getByRole('dialog', { name: 'Grant a role' });
}

async function openGrant(page: Page) {
  await page.goto('/admin/assignments');
  await page.getByRole('button', { name: 'Grant a role' }).click();
  return grantDrawer(page);
}

test('a role is granted by picking a name, and the list says who has it', async ({ browser }) => {
  const page = await admin(browser);
  // The api is moving role grants behind a fresh second factor. Stepping
  // up first works on either side of that change.
  await stepUp(page, await secondFactor(page, fx.users.admin));
  const drawer = await openGrant(page);
  const person = drawer.getByRole('combobox', { name: 'Person' });
  await expect(person, 'focus starts in the first field').toBeFocused();

  await person.fill('outsider');
  await drawer.getByRole('option', { name: /Outsider/ }).click();
  await expect(person).toHaveValue('Outsider');
  await expect(person).toHaveAccessibleDescription('e2e-outsider@example.com');
  await expect(person).not.toBeEditable();

  await drawer.locator('#grant-role-id').selectOption({ label: 'approver (built in)' });
  await drawer.locator('#grant-project').selectOption(fx.otherProject);
  await drawer.getByRole('button', { name: 'Grant role' }).click();
  await expect(page.getByText('Granted approver to Outsider.')).toBeVisible();

  const id = await userId(page, 'e2e-outsider@example.com');
  const grants = (await call(page, 'GET', '/api/v1/user-roles')).body as unknown as { user_id: string; scope?: { project_id?: string } }[];
  expect(grants.some((g) => g.user_id === id && g.scope?.project_id === fx.otherProject), 'the grant went to the picked person').toBe(true);

  await expect(page.getByText(id)).toHaveCount(0);
  await page.getByRole('textbox', { name: 'Filter by person or role' }).fill('e2e-outsider@');
  await expect(page.getByText('e2e-outsider@example.com').first()).toBeVisible();

  await page.getByRole('button', { name: 'Revoke approver from Outsider' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Revoke' }).click();
  await expect(page.getByText('Revoked approver from Outsider.')).toBeVisible();
});

test('nothing is granted until someone is picked', async ({ browser }) => {
  const page = await admin(browser);
  const drawer = await openGrant(page);
  await drawer.getByRole('combobox', { name: 'Person' }).fill('outsider');
  await drawer.locator('#grant-role-id').selectOption({ label: 'approver (built in)' });
  await drawer.getByRole('button', { name: 'Grant role' }).click();
  await expect(drawer.getByText('Choose someone, or enter their user id.')).toBeVisible();
  await expect(drawer.getByRole('combobox', { name: 'Person' }), 'focus moves to the field').toBeFocused();
});

test('Enter picks the person and sends nothing', async ({ browser }) => {
  const page = await admin(browser);
  const posted: string[] = [];
  page.on('request', (r) => {
    if (r.method() === 'POST' && r.url().endsWith('/api/v1/user-roles')) posted.push(r.url());
  });
  const drawer = await openGrant(page);
  await drawer.locator('#grant-role-id').selectOption({ label: 'approver (built in)' });
  const person = drawer.getByRole('combobox', { name: 'Person' });
  await person.fill('outsider');
  await expect(drawer.getByRole('option', { name: /Outsider/ })).toBeVisible();
  await person.press('Enter');
  await expect(person).toHaveValue('Outsider');
  await drawer.getByRole('button', { name: 'Cancel' }).click();
  await expect(drawer).toBeHidden();
  expect(posted, 'Enter sent the grant').toEqual([]);
});

test('a pasted user id shows who it is, and Change starts again', async ({ browser }) => {
  const page = await admin(browser);
  const id = await userId(page, 'e2e-lead@example.com');
  const drawer = await openGrant(page);
  const person = drawer.getByRole('combobox', { name: 'Person' });
  await person.fill(id);
  await expect(person).toHaveValue('Lead');
  await expect(drawer.getByText('e2e-lead@example.com')).toBeVisible();
  await drawer.getByRole('button', { name: 'Change' }).click();
  await expect(person).toHaveValue('');
  await expect(person).toBeFocused();
});

test('Escape closes the list first and the drawer second', async ({ browser }) => {
  const page = await admin(browser);
  const drawer = await openGrant(page);
  const person = drawer.getByRole('combobox', { name: 'Person' });
  await person.fill('e2e-');
  await expect(drawer.getByRole('listbox')).toBeVisible();
  await person.press('Escape');
  await expect(drawer.getByRole('listbox')).toBeHidden();
  await expect(drawer).toBeVisible();
  await person.press('Escape');
  await expect(drawer).toBeHidden();
});

test('a team member is added from the keyboard, and a member can\'t be picked twice', async ({ browser }) => {
  const page = await admin(browser);
  const requester = await userId(page, 'e2e-requester@example.com');
  await page.goto(`/admin/teams?team=${fx.team}`);

  const members = page.getByRole('region', { name: 'Members of e2e-alpha' });
  await expect(members.getByText('e2e-requester@example.com')).toBeVisible();
  await expect(members.getByText(requester), 'a raw id in the list').toHaveCount(0);

  const person = page.getByRole('combobox', { name: 'Add a member' });
  await person.fill('e2e-requester');
  const taken = page.getByRole('option', { name: /Requester/ });
  await expect(taken).toHaveAttribute('aria-disabled', 'true');
  await expect(taken).toContainText('Already a member');
  await taken.click({ force: true });
  await expect(person, 'a member can be clicked but not picked').toHaveValue('e2e-requester');

  await person.fill('outsider');
  await expect(page.getByRole('option', { name: /Outsider/ })).toBeVisible();
  await person.press('Enter');
  await expect(person).toHaveValue('Outsider');
  await expect(members.getByText('e2e-outsider@example.com'), 'Enter picks; it must not submit').toHaveCount(0);

  await page.getByRole('button', { name: 'Add member' }).click();
  await expect(members.getByText('e2e-outsider@example.com')).toBeVisible();
  await expect(person, 'the field empties for the next one').toHaveValue('');

  await page.getByRole('button', { name: 'Remove Outsider' }).click();
  const confirm = page.getByRole('dialog');
  await expect(confirm).toContainText('Outsider leaves e2e-alpha.');
  await confirm.getByRole('button', { name: 'Remove member' }).click();
  await expect(members.getByText('e2e-outsider@example.com')).toHaveCount(0);
});

test('someone the lookup refuses keeps the plain id box and never calls it', async ({ browser }) => {
  const page = await admin(browser);
  const asked: string[] = [];
  page.on('request', (r) => {
    if (/\/api\/v1\/users\?/.test(r.url())) asked.push(r.url());
  });
  await page.route(/\/api\/v1\/users\/me$/, async (route) => {
    const res = await route.fetch();
    await route.fulfill({ response: res, json: { ...(await res.json()), global_permissions: [] } });
  });

  const drawer = await openGrant(page);
  await expect(drawer.getByRole('combobox', { name: 'Person' })).toHaveCount(0);
  await expect(drawer.getByRole('textbox', { name: 'Person' })).toHaveAttribute('placeholder', /^00000000/);
  await expect(drawer.getByText('Each person can find their user id on their Profile page.')).toBeVisible();
  expect(asked, 'the lookup was called').toEqual([]);
});

test('a failed search says so, disabled accounts stay out, and a full page says to narrow it', async ({ browser }) => {
  const page = await admin(browser);
  const person = (n: number, over: object = {}) => ({
    id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    email: `p${n}@example.com`,
    display_name: `Person ${n}`,
    disabled: false,
    ...over,
  });
  await page.route(/\/api\/v1\/users\?q=/, async (route) => {
    const q = new URL(route.request().url()).searchParams.get('q');
    if (q === 'boom') return route.fulfill({ status: 500, json: { error: 'internal' } });
    if (q === 'gone') return route.fulfill({ json: { users: [person(1, { disabled: true }), person(2)] } });
    if (q === 'lots') return route.fulfill({ json: { users: Array.from({ length: 20 }, (_, i) => person(i)) } });
    return route.fulfill({ json: { users: [] } });
  });

  const drawer = await openGrant(page);
  const box = drawer.getByRole('combobox', { name: 'Person' });

  await box.fill('boom');
  await expect(drawer.getByText("Couldn't search. Paste the user id instead.")).toBeVisible();

  await box.fill('gone');
  const disabled = drawer.getByRole('option', { name: /Person 1/ });
  await expect(disabled).toHaveAttribute('aria-disabled', 'true');
  await expect(disabled).toContainText('Disabled');
  await box.press('Enter');
  await expect(box, 'Enter skips a disabled account').toHaveValue('Person 2');

  await drawer.getByRole('button', { name: 'Change' }).click();
  await box.fill('lots');
  await expect(drawer.getByText('Showing the first 20. Keep typing to narrow it down.')).toBeVisible();

  await box.fill('nobody');
  await expect(drawer.getByText('No one matches “nobody”.')).toBeVisible();
});
