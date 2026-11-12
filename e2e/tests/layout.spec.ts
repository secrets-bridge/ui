import { expect, test } from '@playwright/test';
import { adminPassword, as, fx } from '../support/stack';

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
