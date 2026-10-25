import { defineConfig, devices } from '@playwright/test';

const externalBaseUrl = process.env.E2E_BASE_URL;

/**
 * Smoke tests against a Clara frontend: the local dev server by default, or any running site
 * (preview build, deployed CloudFront URL) via E2E_BASE_URL. See docs/testing.md for the
 * environment variables.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: externalBaseUrl ?? 'http://localhost:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    acceptDownloads: true,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  // Without E2E_BASE_URL, start (or reuse) the Vite dev server, as CI does.
  webServer: externalBaseUrl
    ? undefined
    : {
        command: 'npm run dev -- --strictPort',
        url: 'http://localhost:5173',
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
});
