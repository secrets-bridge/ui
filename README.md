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

Dashboard SPA: React 18 + TypeScript + Vite + Tailwind. Talks only to the Control Plane API. **No SSR.** Production bundle served by nginx; same-hostname path-based routing co-locates the UI and the api.

## Production posture

```
Browser
  ↓ HTTPS to secrets-bridge.example.com
Ingress / ALB
  ├── /          → ui service (nginx serving the SPA bundle)
  └── /api/v1/*  → api service (Go + Fiber control plane)
```

The UI container ships only the built static bundle. Same-origin requests mean no CORS, same-origin cookies for auth, and a single TLS cert. Cross-origin deployment is supported via the `VITE_API_BASE_URL` build arg but discouraged: it adds CORS pre-flight on every request and requires careful cookie attribute coordination with the api.

## Auth model

Slice C landed the cookie-only swap. The SPA **never holds a token**:

- The api sets an HttpOnly Secure SameSite=Strict cookie on `POST /auth/login` or `GET /auth/oidc/callback`.
- Every fetch carries the cookie automatically. `src/api/client.ts` uses `credentials: 'include'` so cross-origin dev still works.
- `AuthContext` derives identity from `/users/me` exclusively. `login(identity, token)` was replaced with `refresh()`; `logout()` is async + calls `POST /auth/logout`.
- 401 maps to `meStatus === 'idle'` (unauthenticated) rather than `'error'`. First visit to `/login` doesn't show a retry banner.

OIDC sign-in is auto-discovered. `useOidcAvailable()` (`src/api/oidc.ts`) probes `/auth/oidc/start` with `redirect: 'manual'`. The Login page conditionally renders "Sign in with SSO" when the api advertises OIDC.

App-MFA step-up is global (Slices H-I + K-fix-2). Tier 2 ops (approve / reject / reveal-wrap) can return `401 + WWW-Authenticate: step-up`. `routeAuthSignals` inside `src/api/client.ts::request()` routes EVERY API call (TanStack-hooked OR direct `await api.get(...)`) through the same step-up modal singleton. `requestStepUp()` returns a promise the fetch layer awaits, and on `'verified'` the original request auto-retries so the caller's `await` resolves with the success value as if MFA never happened. N concurrent 401s share ONE modal via module-scoped pending-promise dedup. The 412 `mfa_enrollment_required` and 401 `factor_compromised` shapes route to `/me/mfa` and `/login` respectively.

My projects (`/projects`) is the developer's entry point. `useMe()` returns each project's environments inline. The environment page (`/projects/:id/env/:env_id`) lists the secrets bound there by path and key name. It offers Reveal on non-production environments (direct reveal, through `/projects/:id/environments/:env_id/direct-reveal`) and Request access on any environment. A policy refusal shows inline with a pre-filled Request access instead.

Values are revealed only on the request page (`/requests/:id`), behind the second factor, through a reveal session: each value is fetched once with an explicit click and cleared from state when it is hidden, when the session ends, or when the page unmounts. The old reveal route redirects to the request page and never starts a reveal on load.

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

## Design system

The console follows the Secrets Bridge brand book: IBM Plex Sans and Mono, an ultramarine accent, light and dark themes, square corners (4px at most), tables rather than cards, and status as a small square glyph plus the exact status word.

- `src/index.css` holds the tokens as CSS variables for both themes (Tailwind 4 `@theme inline`), the type scale, the focus ring and the reduced-motion rules.
- `public/theme-init.js` sets `data-theme` before first paint (the CSP allows no inline script). `src/theme/theme.ts` and `ThemeToggle` switch it, and the choice is stored under `sb-theme`.
- `src/ui` holds the shared components: `DataTable` (with a stacked phone layout), `Drawer`, `Dialog`, `ConfirmModal`, `Field` / `Input` / `Select` / `Textarea`, `Status` / `ToneStatus`, `EnvTag`, `Keys`, `KeyPicker`, `Banner`, `EmptyState`, `Breadcrumb`, `Tabs`, `Timeline`, `RevealPanel` and the toast. `useModalFocus` traps focus in drawers and dialogs, stacks them, and returns focus to the opener.
- One primary button per view, button labels are verbs in sentence case, and errors show under their field with focus moved to the first one. Times are UTC and say so.

## Layout

```
src/
  api/
    client.ts            typed fetch + HTTPS guard + ApiError (with stepUp flag)
    queryClient.ts       global TanStack QueryClient + step-up interceptor
    sensitiveMutation.ts useSensitiveMutation: mutations that carry a value, token or code
    me.ts                useMe: identity + permissions + teams + projects hydration
    requests.ts / revealSessions.ts / agents.ts / secrets.ts / audit.ts / crossTeam.ts / ...
    types.ts             CP response shapes (metadata-only; no secret values)
  auth/
    AuthContext.tsx      cookie-only AuthProvider + useAuth (no token field)
    StepUpModal.tsx      MFA step-up dialog for 401 + WWW-Authenticate: step-up
  layout/
    Shell.tsx            sidebar + mobile menu + skip link + focus on route change
  lib/                   time (UTC), decodeSecret / encodeSecret (UTF-8), secretClipboard, providers, ...
  requests/              request scope, reveal state, timeline and description helpers
  pages/
    Login.tsx            sign-in, SSO first when the api offers it
    Overview.tsx         what needs you, your requests, activity, agents
    Requests.tsx + RequestDetail.tsx + request/   list, detail, decisions, inline reveal
    RequestAccessDrawer.tsx                       read and change requests
    MyProjects.tsx + ProjectEnv.tsx + project/    environments, direct reveal, provider connections
    Secrets.tsx          catalog with filters and a details drawer
    Agents.tsx + agents/ agent table, details, revoke, enrollment (token shown once)
    Audit.tsx            append-only event log in pages of 50 (own events only when not admin)
    Inbox.tsx + InboxFill.tsx + CrossTeamSubmitDrawer.tsx   cross-team requests
    Me.tsx + MFASettings.tsx                      profile and second factor
    admin/               projects, teams, roles, assignments, workflows, policies, connections, gateways, settings
  ui/                    shared components (see Design system)
nginx/
  nginx.conf             SPA fallback + CSP + cache strategy + healthz
Dockerfile               multi-stage: node 24 + vite → nginx 1.30 alpine (digest-pinned)
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

For interactive dev with hot reload, node 24 (LTS) is required:

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
| `/` | Overview: what needs you, your requests, activity | authenticated |
| `/requests` | Your requests, and the approval queue for approvers | `secret.request` ∨ `secret.approve` |
| `/requests/:id` | Detail, decisions and the inline reveal (step-up gated) | depends on row ownership |
| `/projects` | Your projects and environments | authenticated |
| `/projects/:id/env/:env_id` | Secrets bound to an environment, direct reveal, request access | project access |
| `/inbox` + `/inbox/:id` | Cross-team requests waiting for your values; fill or refuse | `secret.value.provide` |
| `/agents` | Agents, their status and heartbeats; enrollment and revoke | `agent.list` (enroll: `agent.mint`) |
| `/secrets` | Catalog with filters | `secret.list` |
| `/audit` | Event log in pages of 50 (own events when not admin) | `audit.read` |
| `/me` + `/me/mfa` | Profile, and second-factor settings | authenticated |
| `/admin/projects` | Projects + per-project secret bindings | `team.edit` |
| `/admin/teams` | N-level team tree CRUD + members | `team.edit` |
| `/admin/roles` | Role catalog + permission picker | `role.edit` |
| `/admin/assignments` | Grants (user → role + scope) | `user_role.edit` |
| `/admin/workflows` | Workflow CRUD | `workflow.edit` |
| `/admin/policies` | Policy CRUD | `policy.edit` |
| `/admin/gateways` | Gateways, their connectors, bindings and observation tasks; Argo CD is observed only through a Gateway | `gateway.list` (writes: `gateway.mint`, `gateway.bind`, `gateway.revoke`) |

Nav items hide entirely when the user lacks the gating permission, a strict fail-closed default.

## Pre-v1.0 blockers

- ~~**OIDC PKCE flow**~~: **LANDED** (api#55 + ui#40). Local-admin login still available as break-glass.
- ~~**Cookie auth + MFA step-up**~~: **LANDED** (api#54 + api#56 + ui#40 + ui#43).
- ~~**Group-claim → role mapping**~~: **LANDED** (api#57). Admins still curate team-scoped grants; OIDC handles global role assignment.
- **RBAC route gating**: admin pages currently visible to every authenticated identity at the route level (the nav already hides them via `hasPermission`); api-side enforcement lands with [`api#27`](https://github.com/secrets-bridge/api/issues/27) (P0-2).

## See also

- [`secrets-bridge/skills/ui/SKILL.md`](https://github.com/secrets-bridge/skills/blob/main/ui/SKILL.md): internal working-instructions skill for this repo (auth model, admin CRUD pattern, dispatchable patterns).
- [`secrets-bridge/skills/PROGRESS.md`](https://github.com/secrets-bridge/skills/blob/main/PROGRESS.md): slice-by-slice activity log; each PR has an entry with the load-bearing invariants called out.
- [`secrets-bridge/api`](https://github.com/secrets-bridge/api): Control Plane API + auth surface this SPA consumes.
