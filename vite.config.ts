import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

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
  return {
    plugins: [react()],
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
