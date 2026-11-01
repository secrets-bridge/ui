import { expect, test } from '@playwright/test';
import { adminPassword, as, fx } from '../support/stack';

// Administration is one entry in the sidebar with its own navigation, so
// the sidebar stays short. Hiding a link isn't authorization: rbac.spec.ts
// covers what the api refuses.

test('the sidebar has one Administration entry, and it opens the first section', async ({ browser }) => {
  const page = await as(browser, fx.users.admin, adminPassword);
  const main = page.getByRole('navigation', { name: 'Main' });
  await main.getByRole('link', { name: 'Administration' }).click();

  await expect(page).toHaveURL(/\/admin\/users$/);
  await expect(page.getByRole('heading', { name: 'Accounts', level: 1 })).toBeVisible();
  for (const name of ['Teams', 'Roles', 'Workflows', 'Policies']) {
    await expect(main.getByRole('link', { name, exact: true }), `${name} moved out of the sidebar`).toHaveCount(0);
  }

  const nav = page.getByRole('navigation', { name: 'Administration' });
  await nav.getByRole('link', { name: 'Role assignments' }).click();
  await expect(page.getByRole('heading', { name: 'Role assignments', level: 1 })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Role assignments' })).toHaveAttribute('aria-current', 'page');
  await expect(main.getByRole('link', { name: 'Administration' }), 'still marked as where you are').toHaveAttribute('aria-current', 'page');
});

test('someone waiting for an account shows on every section until you open Accounts', async ({ browser }) => {
  const page = await as(browser, fx.users.admin, adminPassword);
  await page.route(/\/api\/v1\/users\/pending/, (route) =>
    route.fulfill({ json: { total: 2, users: [{ id: '00000000-0000-4000-8000-000000000001', email: 'a@example.com', display_name: 'A', waiting_since: new Date().toISOString() }] } }),
  );
  await page.goto('/admin/teams');
  await expect(page.getByText('2 people are waiting for account approval.')).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Main' }).getByLabel('2 waiting for approval')).toBeVisible();

  await page.getByRole('link', { name: 'Review accounts' }).click();
  await expect(page).toHaveURL(/\/admin\/users$/);
  await expect(page.getByText('2 people are waiting for account approval.')).toHaveCount(0);
});

test('someone with no admin section sees no admin menu, and /admin sends them home', async ({ browser }) => {
  const page = await as(browser, fx.users.requester);
  await page.goto('/admin/users');
  await expect(page.getByText("You can't approve new users.")).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Administration' })).toHaveCount(0);

  await page.goto('/admin');
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('heading', { name: 'Overview', level: 1 })).toBeVisible();
});

test('on a phone the sections are a select', async ({ browser }) => {
  const page = await as(browser, fx.users.admin, adminPassword);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/admin/teams');
  await expect(page.getByRole('navigation', { name: 'Administration' })).toBeHidden();

  const select = page.getByRole('combobox', { name: 'Administration section' });
  await expect(select).toHaveValue('/admin/teams');
  await select.selectOption('/admin/roles');
  await expect(page.getByRole('heading', { name: 'Roles', level: 1 })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, 'sideways scroll on a phone').toBe(0);
});
