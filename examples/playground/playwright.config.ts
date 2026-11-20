import { defineConfig, devices } from '@playwright/test';

/**
 * Browser interaction tests against the BUILT playground (run `npm run build`
 * first). Chromium only. The server always starts fresh on a fixed port so a
 * stale server from another checkout is never reused.
 */
const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const port = Number(env.LQ_E2E_PORT ?? 4791);
const ci = Boolean(env.CI);

export default defineConfig({
  testDir: './e2e',
  outputDir: './test-results',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: true,
  forbidOnly: ci,
  retries: 0,
  workers: ci ? 2 : undefined,
  reporter: [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]],
  use: {
    ...devices['Desktop Chrome'],
    baseURL: `http://127.0.0.1:${port}`,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `npm run preview -- --port ${port} --strictPort`,
    url: `http://127.0.0.1:${port}/`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
