import { expect, type Page, type TestInfo, test } from '@playwright/test';
import { FIXED_NOW } from '../../ui/lab/fixtures';
import { ALL_ROUTES, SCREEN_ROUTES } from '../routes';

/**
 * Visual regression (governance.visual-regression.two-viewport, R-007).
 *
 * Pinned: time (FIXED_NOW via page.clock), data (ui/lab/fixtures.ts), fonts (the platform's
 * system stack, with baselines per platform, after document.fonts.ready), browser (the
 * Chromium build pinned by @playwright/test), animations (disabled by toHaveScreenshot),
 * the caret (hidden), timezone and locale (playwright.config.ts).
 *
 * The project name decides theme and text size, so a "dark" baseline cannot render light.
 */

function variant(testInfo: TestInfo) {
  const name = testInfo.project.name;
  return { dark: name.includes('dark'), text200: name.includes('text200') };
}

async function prepare(page: Page, testInfo: TestInfo) {
  const { dark, text200 } = variant(testInfo);
  await page.clock.setFixedTime(FIXED_NOW);
  if (dark) {
    await page.addInitScript(() => window.localStorage.setItem('wl-theme', 'dark'));
  }
  if (text200) {
    // The browser's own text-size setting at 200%: it scales rem text, and exposes any text
    // sized in pixels, which is exactly what this check exists to catch.
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Page.enable');
    await cdp.send('Page.setFontSizes', { fontSizes: { standard: 32, fixed: 26 } });
  }
}

async function open(page: Page, route: string) {
  await page.goto(route);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForLoadState('networkidle');
}

/** Screens with sticky chrome are captured as the viewport a person sees. */
const fullPage = (route: string) => !(SCREEN_ROUTES as readonly string[]).includes(route);
const slug = (route: string) => (route === '/' ? 'home' : route.slice(1).replaceAll('/', '-'));

for (const route of ALL_ROUTES) {
  test(`@visual ${route} matches its baseline`, async ({ page }, testInfo) => {
    await prepare(page, testInfo);
    await open(page, route);
    await expect(page).toHaveScreenshot(`${slug(route)}.png`, { fullPage: fullPage(route) });
  });
}

test('@visual rendering is repeatable: two fresh pages give identical pixels', async ({
  browser,
}, testInfo) => {
  // toHaveScreenshot passes on the first matching shot, so a passing run alone does not
  // prove determinism. This renders each route twice, in separate contexts, and requires
  // byte-identical output.
  test.setTimeout(120_000);
  const project = testInfo.project.use;
  const shoot = async (route: string) => {
    const context = await browser.newContext({
      viewport: project.viewport ?? null,
      deviceScaleFactor: project.deviceScaleFactor ?? 1,
      isMobile: project.isMobile ?? false,
      hasTouch: project.hasTouch ?? false,
      colorScheme: project.colorScheme ?? 'light',
      timezoneId: 'UTC',
      locale: 'en-GB',
    });
    const page = await context.newPage();
    await prepare(page, testInfo);
    await open(page, route);
    const png = await page.screenshot({
      animations: 'disabled',
      caret: 'hide',
      scale: 'css',
      fullPage: fullPage(route),
    });
    await context.close();
    return png;
  };
  const differing: string[] = [];
  for (const route of ALL_ROUTES) {
    const [first, second] = [await shoot(route), await shoot(route)];
    if (!first.equals(second)) differing.push(route);
  }
  expect(differing).toEqual([]);
});

test('@visual no page scrolls horizontally in this project', async ({ page }, testInfo) => {
  await prepare(page, testInfo);
  const overflowing: string[] = [];
  for (const route of ALL_ROUTES) {
    await open(page, route);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    if (overflow) overflowing.push(route);
  }
  expect(overflowing).toEqual([]);
});
