import { expect, test } from '@playwright/test';
import { adminPassword, as, call, fx } from '../support/stack';

// Where things sit as the window changes. The behaviour is the same at
// every width; only the place it happens moves.

test('secret details sit beside the list when there is room, in a drawer when there is not', async ({ browser }) => {
  const page = await as(browser, fx.users.admin, adminPassword);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/secrets');
  await page.getByRole('button', { name: fx.secretRef }).first().click();

  const docked = page.getByRole('complementary', { name: 'Secret details' });
  await expect(docked).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Discovered secrets' }), 'the list stays').toBeVisible();
  await docked.getByRole('button', { name: 'Close details' }).click();
  await expect(docked).toHaveCount(0);

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.getByRole('button', { name: fx.secretRef }).first().click();
  await expect(page.getByRole('dialog', { name: 'Secret details' })).toBeVisible();
});

test('on a phone the bottom tabs are the places this person can open', async ({ browser }) => {
  const requester = await as(browser, fx.users.requester);
  await requester.setViewportSize({ width: 390, height: 844 });
  await requester.goto('/');
  const tabs = requester.getByRole('navigation', { name: 'Quick links' });
  await expect(tabs.getByRole('link', { name: 'Overview' })).toHaveAttribute('aria-current', 'page');
  await expect(tabs.getByRole('link', { name: 'Requests' })).toBeVisible();
  await expect(tabs.getByRole('link', { name: 'Approvals' }), 'a requester has nothing to approve').toHaveCount(0);
  await tabs.getByRole('link', { name: 'Requests' }).click();
  await expect(requester.getByRole('heading', { name: 'My requests', level: 1 })).toBeVisible();

  const approver = await as(browser, fx.users.approver);
  await approver.setViewportSize({ width: 390, height: 844 });
  await approver.goto('/');
  await expect(approver.getByRole('navigation', { name: 'Quick links' }).getByRole('link', { name: 'Approvals' })).toBeVisible();

  await requester.setViewportSize({ width: 1280, height: 800 });
  await expect(tabs, 'the sidebar takes over').toBeHidden();
});

test('on a phone a dialog is a sheet at the bottom, with nothing cut off', async ({ browser }) => {
  const page = await as(browser, fx.users.admin, adminPassword);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Open navigation' }).click();
  await page.getByRole('dialog', { name: 'Navigation' }).getByRole('button', { name: 'Sign out' }).click();

  const dialog = page.getByRole('dialog', { name: 'Sign out of Secrets Bridge?' });
  await expect(dialog).toBeVisible();
  const box = await dialog.boundingBox();
  expect(box, 'the dialog has a box').not.toBeNull();
  expect(Math.round(box!.y + box!.height), 'it sits on the bottom edge').toBe(844);
  expect(Math.round(box!.width), 'it takes the full width').toBe(390);
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toHaveCount(0);
});

test('on a phone a scrolled Review button passes under the top bar, not over it', async ({ browser }) => {
  const requester = await as(browser, fx.users.requester);
  const ids: string[] = [];
  for (const why of ['e2e layout: the first request', 'e2e layout: the second request', 'e2e layout: the third request']) {
    const r = await call(requester, 'POST', '/api/v1/requests/read', {
      project_id: fx.project,
      environment: 'dev',
      target_provider_type: 'vault',
      target_secret_ref: fx.secretRef,
      target_keys: ['DB_USER'],
      justification: why,
    });
    expect(r.status, 'submit').toBe(201);
    ids.push(String(r.body.id));
  }
  try {
    const approver = await as(browser, fx.users.approver);
    await approver.setViewportSize({ width: 390, height: 844 });
    await approver.goto('/');
    const review = approver.getByRole('button', { name: /^Review/ }).first();
    await expect(review).toBeVisible();
    // Scroll until the button sits under the top bar, then ask what is on top there.
    const header = approver.locator('header').first();
    const hb = (await header.boundingBox())!;
    const rb = (await review.boundingBox())!;
    await approver.evaluate((dy) => window.scrollBy(0, dy), rb.y - hb.y - 4);
    const onTop = await approver.evaluate(() => {
      const btn = [...document.querySelectorAll('main button')].find((b) => /^Review/.test(b.textContent ?? ''))!;
      const r = btn.getBoundingClientRect();
      const h = document.querySelector('header')!.getBoundingClientRect();
      const y = Math.min(Math.max(r.top, h.top) + 2, h.bottom - 2);
      return document.querySelector('header')!.contains(document.elementFromPoint(r.left + r.width / 2, y));
    });
    expect(onTop, 'the top bar covers the button').toBe(true);
  } finally {
    for (const id of ids) await call(requester, 'POST', `/api/v1/requests/${id}/cancel`, {});
  }
});

test('on a phone the secrets are a list, and a path opens its details', async ({ browser }) => {
  const page = await as(browser, fx.users.admin, adminPassword);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/secrets');
  const list = page.getByRole('list', { name: 'Discovered secrets' });
  await expect(list).toBeVisible();
  await expect(page.getByRole('region', { name: 'Discovered secrets' }), 'the wide table stays hidden').toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth), 'nothing runs off the side').toBeLessThanOrEqual(390);
  await list.getByRole('button', { name: fx.secretRef }).click();
  await expect(page.getByRole('dialog', { name: 'Secret details' })).toBeVisible();
});

test('on a phone the audit filters fold away and say how many are on', async ({ browser }) => {
  const page = await as(browser, fx.users.admin, adminPassword);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/audit');
  const toggle = page.getByRole('button', { name: 'Filters', exact: true });
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByLabel('Action')).toBeHidden();
  await toggle.click();
  await expect(page.getByRole('button', { name: 'Hide filters' })).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByLabel('Action')).toBeVisible();

  await page.goto(`/audit?correlation_id=${fx.project}`);
  await expect(page.getByRole('button', { name: 'Filters · 1 on' })).toBeVisible();

  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(page.getByLabel('Action'), 'wide screens keep the filters open').toBeVisible();
  await expect(page.getByRole('button', { name: /^Filters/ })).toHaveCount(0);
});
