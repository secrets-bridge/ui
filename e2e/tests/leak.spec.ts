import { expect, test } from '@playwright/test';
import { as, canary, fx } from '../support/stack';

// A value typed into a change request leaves no trace in the browser
// once it's submitted (ui CLAUDE.md: value inputs are type=password and
// reset after submit, sensitive mutations are cleared). The CI leak scan
// then checks the api log and all test output for the same canary.

test('a submitted change value is gone from the page and browser storage', async ({ browser }) => {
  const page = await as(browser, fx.users.requester);
  await page.goto(`/projects/${fx.project}/env/${fx.envDev}`);
  await page.getByRole('button', { name: 'Request access' }).first().click();

  const drawer = page.getByRole('dialog', { name: 'Request access' });
  await drawer.getByRole('radio', { name: 'Change values' }).check();
  // Opened from the environment page the drawer may already have the
  // scope (and secret) chosen; pick them from the option lists if not.
  const scope = drawer.locator('#ra-scope');
  if (!(await scope.inputValue())) {
    const v = await scope.locator('option', { hasText: 'e2e-app' }).filter({ hasText: 'dev' }).first().getAttribute('value');
    await scope.selectOption(v ?? '');
  }
  const secret = drawer.locator('#ra-secret');
  await secret.waitFor();
  if (!(await secret.inputValue())) {
    const v = await secret.locator('option', { hasText: fx.secretRef }).first().getAttribute('value');
    await secret.selectOption(v ?? '');
  }
  await drawer.getByRole('checkbox', { name: 'DB_PASSWORD' }).check();
  const value = drawer.locator('fieldset', { hasText: 'New values' }).locator('input[type="password"]').first();
  await expect(value).toHaveAttribute('type', 'password');
  await value.fill(canary);
  await drawer.locator('#ra-why').fill('e2e leak check for a submitted value');
  // The check below must be able to see the value: before submit it does.
  const before = await page.evaluate((c) => Array.from(document.querySelectorAll('input')).some((el) => el.value.includes(c)), canary);
  expect(before, 'the check finds the value while it is in the form').toBe(true);
  await drawer.getByRole('button', { name: 'Submit request' }).click();
  await expect(page.getByText(/Request .+ submitted\./)).toBeVisible();

  const traces = await page.evaluate((c) => {
    const inputs = Array.from(document.querySelectorAll('input, textarea')).some((el) => (el as HTMLInputElement).value.includes(c));
    const text = document.body.innerText.includes(c) || document.documentElement.outerHTML.includes(c);
    const storage = JSON.stringify({ ...localStorage }).includes(c) || JSON.stringify({ ...sessionStorage }).includes(c);
    return { inputs, text, storage };
  }, canary);
  expect(traces, 'the canary is still in the page or browser storage').toEqual({ inputs: false, text: false, storage: false });

  // Opening the form again starts empty.
  await page.getByRole('button', { name: 'Request access' }).first().click();
  await drawer.getByRole('radio', { name: 'Change values' }).check();
  const again = await page.evaluate((c) => Array.from(document.querySelectorAll('input')).some((el) => el.value.includes(c)), canary);
  expect(again, 'the reopened form still holds the value').toBe(false);
});
