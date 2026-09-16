import { defineConfig, devices } from '@playwright/test';

/**
 * Browser gate. Chromium only, at a phone viewport.
 *
 * One browser and one viewport is the minimum-sufficient shape for the foundation
 * (D-037). The broader visual-regression matrix in R-007 - two phone sizes, light
 * and dark, 200% text - belongs with the accepted design system (ADR-0007), not
 * with an unstyled shell whose baselines would be thrown away.
 */
const PORT = 3100;
const BASE_URL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: './apps/web/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  timeout: 30_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    // Pinned so a screenshot or a date-dependent assertion cannot drift with the
    // machine running it (R-007 fixture pinning).
    timezoneId: 'UTC',
    locale: 'en-GB',
  },
  projects: [
    {
      name: 'chromium-phone',
      use: { ...devices['Pixel 7'], browserName: 'chromium' },
    },
  ],
  webServer: {
    // Production build, because a dev-server-only pass proves less than nothing
    // about what ships.
    command: 'pnpm --filter @workout/web exec next start --port 3100',
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
