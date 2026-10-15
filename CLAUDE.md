# CLAUDE.md: secrets-bridge/ui

Instructions for Claude Code and contributors working in this repo. For the whole platform, see https://secrets-bridge.io.

## What this repo is

The Secrets Bridge dashboard: a React + TypeScript + Vite single-page app served by nginx. It talks only to the control plane API at `/api/v1` on the same origin.

## Layout

| Path | Purpose |
|---|---|
| `src/api/*.ts` | One TanStack Query module per API area; `client.ts` adds the bearer token |
| `src/auth` | `AuthContext`; the token lives in React state only |
| `src/pages` | Requests, request detail, reveal session, inbox and fill (cross-team), secrets catalog, agents, audit, MFA settings, project and team policies |
| `src/pages/admin` | Projects, teams, roles, assignments, workflows, policies, provider connections, integrations, platform settings |
| `src/ui`, `src/layout` | Shared components and the app shell |
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

## Rules for this repo

- **No tokens or secret values in browser storage**: no localStorage, sessionStorage, IndexedDB or cookies. A hard refresh signs the user out by design.
- **No provider credentials and no direct provider calls.** The browser talks only to the API.
- Reveal fetches are never cached or refetched automatically, and plaintext is cleared from state on close and unmount.
- Value inputs use `type="password"` and are reset after submit.
- No server-side rendering.
- Mutations invalidate their query keys; do not call `refetch()` by hand.
- Show API errors inline with their status; never use `alert()`.
- Client-side validation (Zod) is for feedback only. The API is the authority.
- Keep the initial bundle within the CI budget.

## Contributing

Feature branch off `main`, conventional commits, small PRs, CI green, then open a PR for maintainer review. Never push to `main`. Features that need a new endpoint land in `api` first.

This repo is public. Keep hostnames, account IDs, real secret paths and company names out of code, fixtures, screenshots, commits, PRs and issues.
