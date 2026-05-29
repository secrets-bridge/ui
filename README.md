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

Dashboard SPA — React 18 + TypeScript + Vite + Tailwind. Talks only to the Control Plane API.
**No SSR.** Production bundle served by nginx; same-hostname path-based routing co-locates the UI and the api.

## Production posture

```
Browser
  ↓ HTTPS to secrets-bridge.example.com
Ingress / ALB
  ├── /          → ui service (nginx serving the SPA bundle)
  └── /api/v1/*  → api service (Go + Fiber control plane)
```

The UI container ships only the built static bundle. Same-origin requests mean **no CORS**, **same-origin cookies for auth**, and a **single TLS cert**. Cross-origin deployment is supported via the `VITE_API_BASE_URL` build arg, but discouraged.

## Hard rules

| Rule | How enforced |
|---|---|
| **No secret values in `localStorage` / `sessionStorage`** (BRD §15 Frontend boundary) | Auth token lives in `AuthContext` state only; reload signs out. Real OIDC (api P0-1) uses a short-lived in-memory access token + an HttpOnly session cookie. |
| **No provider credentials in any request body** (BRD §15) | Typed API surface in `src/api/types.ts` exposes only metadata fields. `value` / `plaintext` / `token` are NEVER on response types the UI consumes. |
| **TLS required on non-localhost** (NFR-01) | `src/api/client.ts` throws at module-load if `VITE_API_BASE_URL` is `http://` for a non-localhost host. |
| **No SSR** (FR-13) | Vite SPA build; nginx serves static assets only. |
| **CSP locks origin** | `nginx/nginx.conf` ships strict CSP: `default-src 'self'; frame-ancestors 'none'`. |
| **Initial bundle ≤ 500 KB gzipped** (FR-13) | CI job `bundle-size budget` fails the PR when `dist/assets/*.{js,css}` exceeds the cap. |

## Layout

```
src/
  api/
    client.ts        typed fetch wrapper + HTTPS guard + auth header
    types.ts         CP response shapes (metadata-only; no secret values)
  auth/
    AuthContext.tsx  in-memory identity + token (stub until P0-1)
    RequireAuth.tsx  route guard
  layout/
    Shell.tsx        sidebar + topbar + <Outlet/>
  pages/
    LoginStub.tsx    fake login; replaced by OIDC PKCE callback
    Agents.tsx       smoke proof — GET /api/v1/agents
    Placeholder.tsx  stand-in for pages landing in follow-up PRs
  App.tsx            router
  main.tsx           entry
nginx/
  nginx.conf         SPA fallback + CSP + cache strategy + healthz
Dockerfile           multi-stage: node-vite → nginx 1.27 alpine
```

## Configuration

| Env var | Used at | Default | Notes |
|---|---|---|---|
| `VITE_API_BASE_URL` | build time | empty (relative URLs) | Set for cross-origin deployments. Must be `https://` unless host is localhost. |
| `VITE_API_PROXY_TARGET` | dev only | `http://localhost:8080` | Vite dev-server proxy target for `/api`, `/healthz`, `/readyz`. |

Production deployments leave both unset and let the ingress route `/api/v1/*` to the api service.

## Dev loop

The repo doesn't require local node. Build + run via Docker:

```bash
docker build -t sb-ui:dev .
docker run --rm -p 8080:8080 sb-ui:dev
# → http://localhost:8080/login
```

For interactive dev with hot reload, you DO need node 20:

```bash
npm ci
npm run dev
# Vite proxies /api to VITE_API_PROXY_TARGET (default localhost:8080)
```

## Routes (this scaffold PR)

| Path | Page | Status |
|---|---|---|
| `/login` | LoginStub — fake bearer to memory | live |
| `/agents` | List of registered agents (GET /api/v1/agents) | live |
| `/requests` | Placeholder | follow-up |
| `/secrets` | Placeholder | follow-up |
| `/audit` | Placeholder | follow-up |
| `/admin/roles` | Placeholder | follow-up |
| `/admin/workflows` | Placeholder | follow-up |
| `/admin/policies` | Placeholder | follow-up |
| `/admin/integrations` | Placeholder (ArgoCD endpoints + mappings) | follow-up |

## Pre-v1.0 blockers

- **OIDC** — `LoginStub` is a placeholder; real PKCE flow lands with [`api#26`](https://github.com/secrets-bridge/api/issues/26) (P0-1).
- **RBAC** — admin pages currently visible to every authenticated identity; lands with [`api#27`](https://github.com/secrets-bridge/api/issues/27) (P0-2).

Full Step 12 scope: [`ui#1`](https://github.com/secrets-bridge/ui/issues/1).
