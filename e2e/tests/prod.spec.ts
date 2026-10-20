import { expect, test } from '@playwright/test';
import { as, call, fx } from '../support/stack';
import { enrollTotp, stepUp } from '../support/totp';

// Direct reveal is never offered on a prod environment, and the api
// refuses it there even with the permission and a fresh second factor.

test('production offers no direct reveal, and the api refuses one', async ({ browser }) => {
  const page = await as(browser, fx.users.requester);

  await page.goto(`/projects/${fx.project}/env/${fx.envDev}`);
  await expect(page.getByRole('button', { name: `Reveal ${fx.secretRef}` })).toBeVisible();

  await page.goto(`/projects/${fx.project}/env/${fx.envProd}`);
  // Wait for the bound secret's row before checking what isn't there: an
  // absence check passes trivially on a page that hasn't loaded yet.
  await expect(page.getByText(fx.secretRef).first()).toBeVisible();
  await expect(page.getByRole('button', { name: /^Reveal / })).toHaveCount(0);

  const auth = await enrollTotp(page);
  await stepUp(page, auth);
  const r = await call(page, 'POST', `/api/v1/projects/${fx.project}/environments/${fx.envProd}/direct-reveal`, {
    target_provider_type: 'vault',
    target_secret_ref: fx.secretRef,
    target_keys: ['DB_PASSWORD'],
    justification: 'e2e prod direct reveal attempt',
  });
  expect(r.status, 'prod direct reveal').toBe(403);
  expect(JSON.stringify(r.body)).toMatch(/prod/);
});
