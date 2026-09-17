import { expect, type Page, type TestInfo, test } from '@playwright/test';
import { FIXED_NOW } from '../../ui/reference/fixtures';
import {
  isReferenceScreen,
  openStory,
  SCREEN,
  SHELL_ROUTES,
  type StoryEntry,
  stories,
} from '../routes';

/**
 * Visual regression (governance.visual-regression.two-viewport, R-007).
 *
 * Captured: the product routes and every reference screen and state matrix in the Storybook lab
 * in all projects, and every foundation, primitive, and pattern story at the small phone in both
 * themes. Pinned: time (FIXED_NOW via page.clock), data (ui/reference/fixtures.ts), browser (the
 * Chromium build pinned by @playwright/test), animations (disabled), the caret (hidden), time
 * zone and locale. Fonts are the platform's own, so baselines are stored per platform.
 *
 * The project name decides theme and text size, so a "dark" baseline cannot render light.
 */

type Target = {
  readonly slug: string;
  readonly open: (page: Page, dark: boolean) => Promise<void>;
  readonly fullPage: boolean;
  readonly everyProject: boolean;
};

function variant(testInfo: TestInfo) {
  const name = testInfo.project.name;
  return { dark: name.includes('dark'), text200: name.includes('text200'), name };
}

async function settle(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForLoadState('networkidle');
}

const routeTargets: Target[] = SHELL_ROUTES.map((route) => ({
  slug: route === '/' ? 'home' : route.slice(1).replaceAll('/', '-'),
  fullPage: true,
  everyProject: true,
  open: async (page, dark) => {
    if (dark) await page.addInitScript(() => window.localStorage.setItem('wl-theme', 'dark'));
    await page.goto(route);
  },
}));

const storyTargets: Target[] = stories().map((story: StoryEntry) => ({
  slug: story.id,
  // Screens have sticky chrome, so they are captured as the viewport a person sees.
  fullPage: !isReferenceScreen(story),
  everyProject: isReferenceScreen(story),
  open: (page, dark) => openStory(page, story.id, dark ? 'dark' : 'light'),
}));

const TARGETS = [...routeTargets, ...storyTargets];
const COMPONENT_PROJECTS = new Set(['visual-phone-small-light', 'visual-phone-small-dark']);

async function prepare(page: Page, testInfo: TestInfo) {
  const { text200 } = variant(testInfo);
  await page.clock.setFixedTime(FIXED_NOW);
  if (text200) {
    // The browser's own text-size setting at 200%: it scales rem text and exposes px text.
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Page.enable');
    await cdp.send('Page.setFontSizes', { fontSizes: { standard: 32, fixed: 26 } });
  }
}

const inProject = (target: Target, testInfo: TestInfo) =>
  target.everyProject || COMPONENT_PROJECTS.has(testInfo.project.name);

for (const target of TARGETS) {
  test(`@visual ${target.slug} matches its baseline`, async ({ page }, testInfo) => {
    test.skip(
      !inProject(target, testInfo),
      'component stories are captured at the small phone only',
    );
    await prepare(page, testInfo);
    await target.open(page, variant(testInfo).dark);
    await settle(page);
    await expect(page).toHaveScreenshot(`${target.slug}.png`, { fullPage: target.fullPage });
  });
}

test('@visual the gate tolerates changes under 0.1 percent and fails above it', async ({
  page,
}, testInfo) => {
  // A lasting proof of governance.visual-regression.two-viewport's threshold, against the real
  // committed baseline. One project is enough: the threshold is shared configuration.
  test.skip(testInfo.project.name !== 'visual-phone-small-light', 'threshold proof runs once');
  // While baselines are being written, a comparison would overwrite the real baseline with the
  // marked page. The proof only means something in the gate, where nothing is written.
  test.skip(testInfo.config.updateSnapshots !== 'none', 'threshold proof runs only in the gate');
  const mark = (size: number) =>
    page.addStyleTag({
      content: `body::after{content:"";position:fixed;inset-block-start:0;inset-inline-start:0;inline-size:${size}px;block-size:${size}px;background:#ff00ff;z-index:99}`,
    });
  const viewport = page.viewportSize();
  const limit = Math.floor((viewport?.width ?? 0) * (viewport?.height ?? 0) * 0.001);
  const baseline = `${SCREEN.setFocus}.png`;

  await prepare(page, testInfo);
  await openStory(page, SCREEN.setFocus);
  await settle(page);
  // 10 x 10 = 100 changed pixels, under the 250-pixel limit at 375 x 667.
  expect(100).toBeLessThan(limit);
  await mark(10);
  await expect(page).toHaveScreenshot(baseline);

  await openStory(page, SCREEN.setFocus);
  await settle(page);
  // 20 x 20 = 400 changed pixels, over the limit: the comparison must fail.
  expect(400).toBeGreaterThan(limit);
  await mark(20);
  await expect(expect(page).toHaveScreenshot(baseline, { timeout: 3_000 })).rejects.toThrow(
    /pixels \(ratio [\d.]+ of all image pixels\) are different/,
  );
});

test('@visual rendering is repeatable: two fresh pages give identical pixels', async ({
  browser,
}, testInfo) => {
  // toHaveScreenshot passes on the first matching shot, so a passing run alone does not
  // prove determinism. This renders each target twice, in separate contexts, and requires
  // byte-identical output.
  test.setTimeout(600_000);
  const project = testInfo.project.use;
  const shoot = async (target: Target) => {
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
    await target.open(page, variant(testInfo).dark);
    await settle(page);
    const png = await page.screenshot({
      animations: 'disabled',
      caret: 'hide',
      scale: 'css',
      fullPage: target.fullPage,
    });
    await context.close();
    return png;
  };
  const differing: string[] = [];
  for (const target of TARGETS.filter((candidate) => inProject(candidate, testInfo))) {
    const [first, second] = [await shoot(target), await shoot(target)];
    if (!first.equals(second)) differing.push(target.slug);
  }
  expect(differing).toEqual([]);
});

test('@visual nothing scrolls horizontally in this project', async ({ page }, testInfo) => {
  test.setTimeout(300_000);
  await prepare(page, testInfo);
  const overflowing: string[] = [];
  for (const target of TARGETS.filter((candidate) => inProject(candidate, testInfo))) {
    await target.open(page, variant(testInfo).dark);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    if (overflow) overflowing.push(target.slug);
  }
  expect(overflowing).toEqual([]);
});
