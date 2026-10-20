import { expect, test } from '@playwright/test';
import { as, call, fx } from '../support/stack';

// The requester is a global developer and the outsider a developer scoped
// to e2e-other only. Neither holds an admin permission.

test('a developer sees no admin menu, and an admin page and its api refuse them', async ({ browser }) => {
  const page = await as(browser, fx.users.requester);
  await expect(page.getByRole('navigation', { name: 'Main' }).getByText('Admin', { exact: true })).toHaveCount(0);

  await page.goto('/admin/users');
  await expect(page.getByText("You can't approve new users.")).toBeVisible();
  expect((await call(page, 'GET', '/api/v1/users/pending')).status, 'GET /users/pending').toBe(403);
  const grant = await call(page, 'POST', '/api/v1/user-roles', { user_id: 'x', role_id: 'x', scope: {} });
  expect(grant.status, 'POST /user-roles').toBe(403);
});

test('a developer scoped to one project sees only that project', async ({ browser }) => {
  const page = await as(browser, fx.users.outsider);
  await page.goto('/projects');
  const projects = page.getByRole('region', { name: 'Your projects and environments' });
  await expect(projects.getByRole('link', { name: 'e2e-other' }).first()).toBeVisible();
  await expect(projects.getByRole('link', { name: 'e2e-app' })).toHaveCount(0);
});

test("a developer scoped to another project can't open this one", async ({ browser }) => {
  const page = await as(browser, fx.users.outsider);
  await page.goto(`/projects/${fx.project}/env/${fx.envDev}`);
  await expect(page.getByRole('heading', { name: "You can't open this environment" })).toBeVisible();
  const r = await call(page, 'GET', `/api/v1/projects/${fx.project}`);
  expect([403, 404], 'GET another project').toContain(r.status);
});
