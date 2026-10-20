import { expect, test } from '@playwright/test';
import { call, fx, signIn, userPassword } from '../support/stack';

// The session is an HttpOnly cookie the SPA never sees (ui CLAUDE.md:
// no tokens in browser storage), and losing it always lands on /login.

test('sign-in sets an HttpOnly, SameSite=Strict session cookie and keeps nothing in browser storage', async ({ page, context }) => {
  await signIn(page, fx.users.requester, userPassword);

  const session = (await context.cookies()).find((c) => c.name === 'sb_session');
  expect(session, 'an sb_session cookie').toBeTruthy();
  expect(session!.httpOnly, 'HttpOnly').toBe(true);
  expect(session!.sameSite, 'SameSite').toBe('Strict');

  const readable = await page.evaluate(() => document.cookie);
  expect(readable.includes('sb_session'), 'the session cookie is readable from JS').toBe(false);

  const stored = await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }));
  expect(stored.includes(session!.value), 'the session value is in browser storage').toBe(false);
  expect(/eyJ[A-Za-z0-9_-]{10,}\./.test(stored), 'a JWT-shaped value is in browser storage').toBe(false);
  const databases = await page.evaluate(async () => (await indexedDB.databases()).length);
  expect(databases, 'IndexedDB databases').toBe(0);
});

test('a protected page sends a signed-out visitor to /login', async ({ page }) => {
  await page.goto('/requests');
  await expect(page).toHaveURL(/\/login/);
});

test('a session ended on the server sends the open tab to /login on its next call', async ({ page }) => {
  await signIn(page, fx.users.requester, userPassword);
  await page.goto('/requests');
  await expect(page).toHaveURL(/\/requests/);

  // Log out behind the tab's back: the server revokes the session and
  // clears the cookie, the SPA still holds its cached identity.
  expect((await call(page, 'POST', '/api/v1/auth/logout')).status).toBeLessThan(300);
  expect((await call(page, 'GET', '/api/v1/users/me')).status, 'the old session still works').toBe(401);

  // The SPA's next api call gets a 401, and the SPA itself clears its
  // cache and sends the tab to /login, saying why. That call is either a
  // background refetch on /requests or the one a client-side navigation
  // to a page with nothing cached makes, whichever comes first, so the
  // click is best effort.
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('link', { name: 'Secrets' })
    .click({ timeout: 5_000 })
    .catch(() => undefined);
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByText('Your session ended. Sign in to continue where you were.')).toBeVisible();
});
