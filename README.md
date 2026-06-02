<p align="center">
  <a href="https://github.com/secrets-bridge"><img src="https://raw.githubusercontent.com/secrets-bridge/.github/main/profile/logo.svg" alt="Secrets Bridge" width="520" /></a>
</p>

<p align="center">
  <b>The brain behind your secrets.</b><br/>
  Unified secrets control plane for cloud-native teams.<br/>
  <a href="https://secrets-bridge.io">secrets-bridge.io</a> · <a href="https://github.com/secrets-bridge">all repos</a>
</p>

---
# secrets-bridge / ui

Dashboard SPA — React 18 + TypeScript + Vite + Tailwind. Talks only to the Control Plane API. **No SSR.** Production bundle served by nginx; same-hostname path-based routing co-locates the UI and the api.

## Production posture

```
Browser
  ↓ HTTPS to secrets-bridge.example.com
Ingress / ALB
  ├── /          → ui service (nginx serving the SPA bundle)
  └── /api/v1/*  → api service (Go + Fiber control plane)
```

The UI container ships only the built static bundle. Same-origin requests mean **no CORS**, **same-origin cookies for auth**, and a **single TLS cert**. Cross-origin deployment is supported via the `VITE_API_BASE_URL` build arg, but discouraged — it adds CORS pre-flight on every request and requires careful cookie attribute coordination with the api.

## Auth model

Slice C landed the cookie-only swap. The SPA **never holds a token**:

- The api sets an HttpOnly Secure SameSite=Strict cookie on `POST /auth/login` or `GET /auth/oidc/callback`.
- Every fetch carries the cookie automatically — `src/api/client.ts` uses `credentials: 'include'` so cross-origin dev still works.
- `AuthContext` derives identity from `/users/me` exclusively. `login(identity, token)` was replaced with `refresh()`; `logout()` is async + calls `POST /auth/logout`.
- 401 maps to `meStatus === 'idle'` (unauthenticated) rather than `'error'`. First visit to `/login` doesn't show a retry banner.

**OIDC sign-in is auto-discovered.** `useOidcAvailable()` (`src/api/oidc.ts`) probes `/auth/oidc/start` with `redirect: 'manual'`. The Login page conditionally renders "Sign in with SSO" when the api advertises OIDC.

**App-MFA step-up is global** (Slices H–I + K-fix-2). Tier 2 ops (approve / reject / reveal-wrap) can return `401 + WWW-Authenticate: step-up`. `routeAuthSignals` inside `src/api/client.ts::request()` routes EVERY API call (TanStack-hooked OR direct `await api.get(...)`) through the same step-up modal singleton — `requestStepUp()` returns a promise the fetch layer awaits, and on `'verified'` the original request **auto-retries** so the caller's `await` resolves with the success value as if MFA never happened. N concurrent 401s share ONE modal via module-scoped pending-promise dedup. The 412 `mfa_enrollment_required` and 401 `factor_compromised` shapes route to `/me/mfa` and `/login` respectively.

**My Projects sidebar (Slice L5).** The dev-facing entry point. `useMe()` returns each project's environments inline; the per-env page (`/projects/:id/env/:env_id`) shows secret key names + a Reveal CTA (non_prod) or Request CTA (any env). Routes through the L4 endpoints (`/projects/:id/environments/:env_id/{secrets,request,direct-reveal}`); a 403 from direct-reveal (PROD env / policy denied / perm missing) surfaces as an inline `ApiError.message`.

## Hard rules

| Rule | How enforced |
|---|---|
| **No token in any storage** (BRD §15 Frontend boundary) | Cookie is the only auth surface; there's no token in JS state to leak. The 85% rewrite of `AuthContext` in Slice C ripped out `sessionStorage` entirely. |
| **No provider credentials in any request body** (BRD §15) | Typed API surface in `src/api/types.ts` exposes only metadata fields. `value` / `plaintext` / `token` are NEVER on response types. |
| **TLS required on non-localhost** (NFR-01) | `src/api/client.ts` throws at module-load if `VITE_API_BASE_URL` is `http://` for a non-localhost host. |
| **No SSR** (FR-13) | Vite SPA build; nginx serves static assets only. |
| **CSP locks origin** | `nginx/nginx.conf` ships strict CSP: `default-src 'self'; frame-ancestors 'none'`. |
| **Initial bundle ≤ 500 KB gzipped** (FR-13) | CI job `bundle-size budget` fails the PR when `dist/assets/*.{js,css}` exceeds the cap. |
| **Fail-closed permission gate** | `useAuth().hasPermission(perm)` returns `false` until `/users/me` resolves. Nav items + gated buttons stay hidden during hydration. |

## Layout

```
src/
  api/
    client.ts            typed fetch + HTTPS guard + ApiError (with stepUp flag)
    queryClient.ts       global TanStack QueryClient + step-up interceptor
    me.ts                useMe — identity + permissions + teams + projects hydration
    oidc.ts              useOidcAvailable — probe + redirectToStepUp helper
    requests.ts / agents.ts / secrets.ts / audit.ts / ...   typed hooks per surface
    types.ts             CP response shapes (metadata-only; no secret values)
  auth/
    AuthContext.tsx      cookie-only AuthProvider + useAuth (no token field)
    RequireAuth.tsx      route guard
  layout/
    Shell.tsx            sidebar + topbar + <Outlet/> + version chip + logout
  pages/
    Login.tsx            local-admin form + conditional "Sign in with SSO" button
    Dashboard.tsx        operator landing — KPIs + recent activity
    Requests.tsx + RequestDetail.tsx     submit / approve / reject / reveal flow
    Agents.tsx           live status + onboarding deploy snippets
    Secrets.tsx          catalog with label search + per-secret detail
    Audit.tsx            append-only event log (filtered to user when not admin)
    Me.tsx               /users/me profile
    SubmitRequestDrawer.tsx              profile-driven request submit
    admin/
      Projects / Teams / Roles / Assignments / Workflows / Policies / Integrations
  ui/
    Button / Card / PageHeader / StatusPill / ConfirmModal / VersionChip / ErrorBoundary
nginx/
  nginx.conf             SPA fallback + CSP + cache strategy + healthz
Dockerfile               multi-stage: node-vite → nginx 1.27 alpine
```

## Configuration

| Env var | Used at | Default | Notes |
|---|---|---|---|
| `VITE_API_BASE_URL` | build time | empty (relative URLs) | Set for cross-origin deployments. Must be `https://` unless host is localhost. |
| `VITE_API_PROXY_TARGET` | dev only | `http://localhost:8080` | Vite dev-server proxy target for `/api`, `/healthz`, `/readyz`. |
| `SB_BUILD_VERSION` | docker build-arg | `package.json` version | Surfaced in the in-SPA version chip (`v0.1.0-dev · abc1234`). |
| `SB_BUILD_GIT_SHA` | docker build-arg | local `git rev-parse` | Surfaced in the in-SPA version chip. CI passes `${{ github.sha }}`. |

Production deployments leave `VITE_*` unset and let the ingress route `/api/v1/*` to the api service. `SB_BUILD_*` are wired by the GHA workflow on every image build.

## Dev loop

The repo doesn't require local node. Build + run via Docker:

```bash
docker build -t sb-ui:dev .
docker run --rm -p 8080:8080 sb-ui:dev
# → http://localhost:8080/login
```

For interactive dev with hot reload, node 20 is required:

```bash
npm ci
npm run dev
# Vite proxies /api to VITE_API_PROXY_TARGET (default localhost:8080)
# The api side needs SB_ENV=dev so its session cookie comes without Secure
```

## Routes

| Path | Page | Gate |
|---|---|---|
| `/login` | Local-admin form + conditional "Sign in with SSO" | public |
| `/` | Dashboard | authenticated |
| `/requests` | Submit + approve queue (per-role views) | `secret.request` ∨ `secret.approve` |
| `/requests/:id` | Detail + reveal (Tier 2 — step-up gated) | depends on row ownership |
| `/agents` | Live agent list + onboarding snippets | `agent.list` |
| `/secrets` | Catalog with label search | `secret.list` |
| `/audit` | Event log (scoped to caller when not admin) | `audit.read` |
| `/me` | Profile — identity, permissions, teams, projects | authenticated |
| `/admin/projects` | Projects + per-project secret bindings | `team.edit` |
| `/admin/teams` | N-level team tree CRUD + members | `team.edit` |
| `/admin/roles` | Role catalog + permission picker | `role.edit` |
| `/admin/assignments` | Grants (user → role + scope) | `user_role.edit` |
| `/admin/workflows` | Workflow CRUD | `workflow.edit` |
| `/admin/policies` | Policy CRUD | `policy.edit` |
| `/admin/integrations` | ArgoCD endpoints + app mappings (when `SB_GITOPS_ENABLED`) | `integration.edit` |

Nav items hide entirely when the user lacks the gating permission — strict fail-closed.

## Pre-v1.0 blockers

- ~~**OIDC PKCE flow**~~ — **LANDED** (api#55 + ui#40). Local-admin login still available as break-glass.
- ~~**Cookie auth + MFA step-up**~~ — **LANDED** (api#54 + api#56 + ui#40 + ui#43).
- ~~**Group-claim → role mapping**~~ — **LANDED** (api#57). Admins still curate team-scoped grants; OIDC handles global role assignment.
- **RBAC route gating** — admin pages currently visible to every authenticated identity at the route level (the nav already hides them via `hasPermission`); api-side enforcement lands with [`api#27`](https://github.com/secrets-bridge/api/issues/27) (P0-2).

## See also

- [`secrets-bridge/skills/ui/SKILL.md`](https://github.com/secrets-bridge/skills/blob/main/ui/SKILL.md) — internal working-instructions skill for this repo (auth model, admin CRUD pattern, dispatchable patterns).
- [`secrets-bridge/skills/PROGRESS.md`](https://github.com/secrets-bridge/skills/blob/main/PROGRESS.md) — slice-by-slice activity log; each PR has an entry with the load-bearing invariants called out.
- [`secrets-bridge/api`](https://github.com/secrets-bridge/api) — Control Plane API + auth surface this SPA consumes.
