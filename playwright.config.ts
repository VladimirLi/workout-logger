import { defineConfig, devices } from '@playwright/test';

/**
 * Browser gates. Chromium only.
 *
 * `chromium-phone` runs the behavioural (test:e2e) and accessibility (test:a11y) specs.
 *
 * The `visual-*` projects run only apps/web/e2e/visual (test:visual), the matrix R-007
 * and governance.visual-regression.two-viewport require (ADR-0008): a small and a large
 * phone plus the 1280x800 wide screen, light and dark, and 200% text at the small phone.
 * The theme and text size a project stands for are read from its name by the visual
 * fixture, so a project cannot claim dark while rendering light.
 *
 * Baselines are per platform ({platform} in the path) because system fonts rasterise
 * differently per OS. A missing baseline fails the gate (test:visual passes
 * --update-snapshots=none); it is never written during a gate run.
 */
const PORT = 3100;

const PHONE_SMALL = { width: 375, height: 667 };
const PHONE_LARGE = { width: 412, height: 915 };
const WIDE = { width: 1280, height: 800 };

const visual = (name: string, viewport: { width: number; height: number }, phone: boolean) => ({
  name: `visual-${name}`,
  testMatch: /\/visual\/.*\.spec\.ts$/,
  // A screenshot that only matches on a retry is not deterministic; it fails.
  retries: 0,
  use: {
    browserName: 'chromium' as const,
    viewport,
    deviceScaleFactor: 1,
    isMobile: phone,
    hasTouch: phone,
    colorScheme: name.includes('dark') ? ('dark' as const) : ('light' as const),
  },
});

const VISUAL_PROJECTS = [
  visual('phone-small-light', PHONE_SMALL, true),
  visual('phone-small-dark', PHONE_SMALL, true),
  visual('phone-small-light-text200', PHONE_SMALL, true),
  visual('phone-large-light', PHONE_LARGE, true),
  visual('phone-large-dark', PHONE_LARGE, true),
  visual('wide-light', WIDE, false),
  visual('wide-dark', WIDE, false),
];
const BASE_URL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: './apps/web/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  timeout: 30_000,
  // Visual baselines: one directory per platform and project.
  snapshotPathTemplate:
    '{testDir}/__screenshots__/{platform}/{projectName}/{testFilePath}/{arg}{ext}',
  expect: {
    timeout: 10_000,
    toHaveScreenshot: {
      // governance.visual-regression.two-viewport: a 0.1% pixel-difference threshold.
      maxDiffPixelRatio: 0.001,
      animations: 'disabled',
      caret: 'hide',
      scale: 'css',
    },
  },
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
      testIgnore: /\/visual\//,
      use: { ...devices['Pixel 7'], browserName: 'chromium' },
    },
    ...VISUAL_PROJECTS,
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
