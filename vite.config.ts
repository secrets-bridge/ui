import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// Minimal local shims so we don't have to pull `@types/node` into
// devDependencies just for a few env-var reads. The vite-config
// runtime IS node — Vite itself only imports this file from a node
// process — so these are safe at runtime.
declare const process: { env: Record<string, string | undefined> };
declare function require(name: string): unknown;

// Build-time version stamping. The values land on
// `import.meta.env.VITE_APP_VERSION` + `VITE_APP_GIT_SHA` +
// `VITE_APP_BUILD_TIME` and the SPA surfaces them in the sidebar
// + Dashboard so operators can see exactly which build is in
// production without `kubectl exec`.
//
// Precedence: explicit `SB_BUILD_VERSION` / `SB_BUILD_GIT_SHA` env
// vars (set by CI / docker build-args) → fall back to package.json
// + a local `git rev-parse`. The docker build runs outside the git
// checkout, so the build-arg path is the production-reliable one.
function readPackageVersion(): string {
  try {
    // dynamic require so we don't need @types/node + node-style import.
    const pkg = (require('./package.json') as { version?: string });
    return typeof pkg.version === 'string' ? pkg.version : 'unknown';
  } catch {
    return 'unknown';
  }
}

function readGitSha(): string {
  if (process.env.SB_BUILD_GIT_SHA) return process.env.SB_BUILD_GIT_SHA.trim().slice(0, 7);
  try {
    const cp = require('node:child_process') as { execSync: (cmd: string, opts?: object) => { toString(): string } };
    return cp
      .execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    return '';
  }
}

// In production the UI is served behind the same hostname as the api
// (path-based routing: `/` → UI, `/api/v1/*` → CP API). Same-origin
// cookies for auth, no CORS, single TLS cert. The dev server's proxy
// emulates that posture by forwarding /api to the local api on :8080
// when running `npm run dev`.
//
// Env var override: VITE_API_BASE_URL lets a dev hit a different
// backend (e.g. a staging endpoint) without forking config.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  const proxyTarget = env.VITE_API_PROXY_TARGET || 'http://localhost:8080';
  const appVersion = process.env.SB_BUILD_VERSION || readPackageVersion();
  const gitSha = readGitSha();
  const buildTime = new Date().toISOString();
  return {
    plugins: [react()],
    define: {
      'import.meta.env.VITE_APP_VERSION': JSON.stringify(appVersion),
      'import.meta.env.VITE_APP_GIT_SHA': JSON.stringify(gitSha),
      'import.meta.env.VITE_APP_BUILD_TIME': JSON.stringify(buildTime),
    },
    server: {
      port: 5173,
      proxy: {
        '/api': { target: proxyTarget, changeOrigin: false },
        '/healthz': { target: proxyTarget },
        '/readyz': { target: proxyTarget },
      },
    },
    build: {
      sourcemap: true,
      target: 'es2022',
    },
  };
});
