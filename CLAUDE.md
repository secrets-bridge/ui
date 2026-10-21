# CLAUDE.md: secrets-bridge/ui

Instructions for Claude Code and contributors working in this repo. For the whole platform, see https://secrets-bridge.io.

## What this repo is

The Secrets Bridge dashboard: a React + TypeScript + Vite single-page app served by nginx. It talks only to the control plane API at `/api/v1` on the same origin.

## Layout

| Path | Purpose |
|---|---|
| `src/api/*.ts` | One TanStack Query module per API area; `client.ts` sends requests with `credentials: 'include'` so the HttpOnly session cookie rides along (the SPA never sees a token) |
| `src/auth` | `AuthContext` builds identity from `GET /users/me`; there is no token in JS, only the HttpOnly session cookie |
| `src/pages` | Overview, requests and request detail (with the inline reveal), My projects and environment pages, inbox and fill (cross-team), secrets catalog, agents and enrollment, audit, profile and MFA settings, project and team policies |
| `src/pages/admin` | Projects, teams, roles, assignments, workflows, policies, provider connections, gateways, platform settings |
| `src/ui`, `src/layout` | Shared components (DataTable, Drawer, Dialog, Field, Status, EnvTag, Banner, ...) and the app shell |
| `src/index.css`, `src/theme` | Design tokens for light and dark, the type scale and the theme switch |
| `nginx/` | nginx config with security headers |

## Build and test

```bash
npm ci
npm run dev       # local dev server
npm run lint
npx tsc -b        # typecheck
npm run build     # CI also enforces a bundle-size budget
docker build -t sb-ui:dev .
```

For a full local stack (api, Postgres, Redis, ingress), use the platform `docker-compose.yml` described in the docs.

### Browser security suite (`e2e/`, ui#152)

Playwright specs for the session cookie, RBAC denial, MFA step-up, separation of duties, prod direct reveal, the reveal itself (explicit click, Hide now, the policy's time limit) and value leaks, run by `.github/workflows/e2e.yml` on every PR against a throwaway stack (empty Postgres and Redis, a dev Vault, the published api and agent images, this build behind `vite preview`). Locally: point `E2E_DATABASE_URL` / `E2E_REDIS_URL` at an empty database, run `e2e/scripts/stack.sh up` and `seed`, source `$E2E_STATE/secrets.env`, export `E2E_FIXTURES="$(cat $E2E_STATE/fixtures.json)"`, then `npm run build && npm run e2e`, and `stack.sh scan` / `down` after. A stack is good for one run (each account gets one second factor, kept in the state dir), so reseed between runs. Keep the artifact rules: no trace, video, screenshot or page snapshot (a failing matcher always writes one, so `support/drop-error-context.ts` stays first in the reporter list and deletes it), generated secrets only, and wait for real content before asserting something is absent. Never point a text matcher (`toHaveText`, `toContainText`, `toHaveValue`) at an element that can hold a secret, because a failure prints what it received; compare with a boolean (`expect.poll(() => locator.evaluate(...)).toBe(true)`), and pass any value the api mints during a run to `keepOutOfArtifacts` so the leak scan covers it.

## Rules for this repo

- **No tokens or secret values in browser storage**: no localStorage, sessionStorage, IndexedDB or JS-readable cookies. Auth is the api's HttpOnly session cookie, so a reload restores the session from it. When that session expires or is revoked, the next 401 clears the query cache and sends the tab to `/login`.
- **No provider credentials and no direct provider calls.** The browser talks only to the API.
- Reveal fetches are never cached or refetched automatically, and plaintext is cleared from state on close and unmount. A reveal always starts from an explicit click on the request page, never on page load.
- Decode revealed values with `decodeSecret` and encode typed values that the api expects as base64 with `encodeSecret` (`src/lib/decodeSecret.ts`). Plain `atob()` / `btoa()` break non-ASCII text.
- Value inputs use `type="password"` and are reset after submit.
- A mutation whose variables or response carry a secret (value, password, token, TOTP seed or code) uses `useSensitiveMutation` and calls `reset()` once done; TanStack otherwise keeps it in the MutationCache.
- Copy secrets with `copySecret` from `src/lib/secretClipboard.ts`, never `navigator.clipboard` directly.
- No server-side rendering.
- Mutations invalidate their query keys; do not call `refetch()` by hand.
- Show API errors inline with their status; never use `alert()`.
- Follow the design system: one primary button per view, verbs in sentence case, lists in `DataTable`, status as a glyph plus the exact word, times in UTC, errors under their field. Never show a value, its length or a hash outside the reveal panel.
- Client-side validation (Zod) is for feedback only. The API is the authority.
- Keep the initial bundle within the CI budget.

## Contributing

Feature branch off `main`, conventional commits, small PRs, CI green, then open a PR for maintainer review. Never push to `main`. Features that need a new endpoint land in `api` first.

This repo is public. Keep hostnames, account IDs, real secret paths and company names out of code, fixtures, screenshots, commits, PRs and issues.

**No AI attribution.** Commits and PRs describe the change, nothing else. Don't add `Co-Authored-By` trailers for AI assistants, "Generated with ..." lines or links to AI sessions to commit messages, PR titles or PR bodies. A squash merge copies the PR body into the commit on `main`, where it can't be edited later. If you use a coding assistant, turn off its commit and PR attribution in its settings.
