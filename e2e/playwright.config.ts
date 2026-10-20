import { defineConfig, devices } from '@playwright/test';

// Same shim as vite.config.ts: the config runs in node, but the repo
// doesn't pull @types/node in for a few env reads.
declare const process: { env: Record<string, string | undefined> };

// Artifact rules (ui#152): no trace, video or screenshot, on success or
// failure, and no page snapshot attached to a failure. Only e2e/.out is
// written, the CI leak scan greps all of it for every generated secret,
// and only the JSON summary is uploaded.
process.env.PLAYWRIGHT_NO_COPY_PROMPT = '1';

const port = process.env.E2E_UI_PORT ?? '4173';

export default defineConfig({
  testDir: './tests',
  outputDir: './.out/results',
  // One stack, shared accounts: run serially so tests don't race on the
  // same user's session or factors.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['json', { outputFile: './.out/summary.json' }]],
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: 'off',
    video: 'off',
    screenshot: 'off',
  },
  // The production build served by vite preview, whose proxy forwards
  // /api to the stack's api (VITE_API_PROXY_TARGET), so the browser sees
  // one origin like it does behind the ingress.
  webServer: {
    command: `npx vite preview --host 127.0.0.1 --port ${port} --strictPort`,
    cwd: '..',
    url: `http://127.0.0.1:${port}/`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
