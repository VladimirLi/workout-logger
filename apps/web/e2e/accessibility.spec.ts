import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';
import { isReferenceScreen, openStory, SCREEN, SHELL_ROUTES, stories } from './routes';

/**
 * Automated accessibility gate (D-037, R-007, accessibility.testing.auto-only).
 *
 * This is the routine CI baseline, and only that. Automated scans CANNOT establish WCAG
 * conformance: manual keyboard, screen-reader, zoom, orientation, contrast, and
 * touch-target checks are still required before any conformance claim (DESIGN_SYSTEM.md,
 * Manual testing matrix). Every story is also scanned by storybook.spec.ts.
 */

for (const theme of ['light', 'dark'] as const) {
  for (const route of SHELL_ROUTES) {
    test(`@a11y ${route} (${theme}) has no detectable accessibility violations`, async ({
      page,
    }) => {
      await page.addInitScript((value) => window.localStorage.setItem('wl-theme', value), theme);
      await page.goto(route);
      // A broken bootstrap would otherwise scan the light theme twice.
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      const results = await new AxeBuilder({ page }).analyze();
      expect(
        results.violations.map(({ id, impact, nodes }) => ({ id, impact, nodes: nodes.length })),
      ).toEqual([]);
    });
  }
}

type Box = { label: string; width: number; height: number; x: number; y: number; inline: boolean };

async function targets(page: Page, selector: string): Promise<Box[]> {
  return page.locator(selector).evaluateAll((elements) =>
    elements
      .map((element) => {
        const box = (element.closest('label') ?? element).getBoundingClientRect();
        const style = getComputedStyle(element);
        const hidden = style.visibility === 'hidden' || box.width === 0;
        return hidden
          ? undefined
          : {
              label:
                element.getAttribute('aria-label') ??
                element.closest('label')?.textContent ??
                element.textContent ??
                element.tagName,
              width: box.width,
              height: box.height,
              x: box.x,
              y: box.y,
              inline: element.tagName === 'A' && style.display === 'inline',
            };
      })
      .filter((box): box is NonNullable<typeof box> => box !== undefined),
  );
}

const CONTROLS =
  'button, [role="spinbutton"], input[type="radio"], [role="switch"], a[href]:not(.skip-link)';

test('@a11y every control on every route and story meets the 44 x 44 px floor', async ({
  page,
}) => {
  // accessibility.targets.tiered: 44 px everywhere, stricter than WCAG 2.2's 24 px. Links
  // inside running text keep WCAG 2.5.8's inline exception; standalone links do not.
  test.setTimeout(300_000);
  await page.setViewportSize({ width: 375, height: 667 });
  const undersized: (Box & { where: string })[] = [];
  const check = async (where: string) => {
    for (const box of await targets(page, CONTROLS)) {
      if (!box.inline && (box.width < 44 || box.height < 44)) undersized.push({ ...box, where });
    }
  };
  for (const route of SHELL_ROUTES) {
    await page.goto(route);
    await check(route);
  }
  for (const story of stories()) {
    await openStory(page, story.id);
    await check(story.id);
  }
  expect(undersized).toEqual([]);
});

test('@a11y in-workout controls meet 48 px with 8 px between them', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await openStory(page, SCREEN.setFocus);
  const workout = await targets(
    page,
    'button[aria-label^="Decrease"], button[aria-label^="Increase"], input[name="rir"], main button:has-text("Log set")',
  );
  expect(workout.length).toBeGreaterThanOrEqual(8);
  for (const box of workout) {
    expect(box.height, box.label).toBeGreaterThanOrEqual(48);
    expect(box.width, box.label).toBeGreaterThanOrEqual(48);
  }
  // controls.rir.segmented: each RIR segment is 56 px tall.
  for (const box of workout.filter((item) => /^[0-4]\+?$/.test(item.label.trim()))) {
    expect(box.height, `RIR ${box.label}`).toBeGreaterThanOrEqual(56);
  }
  const steppers = workout.filter((box) => /crease/.test(box.label));
  const rows = new Map<number, Box[]>();
  for (const box of steppers)
    rows.set(Math.round(box.y), [...(rows.get(Math.round(box.y)) ?? []), box]);
  for (const row of rows.values()) {
    const [minus, plus] = row.sort((a, b) => a.x - b.x);
    expect(minus && plus && plus.x - (minus.x + minus.width)).toBeGreaterThanOrEqual(8);
  }
});

test('@a11y focus is visible on every focusable element of the set screen', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await openStory(page, SCREEN.setFocus);
  const invisible: string[] = [];
  for (let index = 0; index < 20; index += 1) {
    await page.keyboard.press('Tab');
    const focus = await page.evaluate(() => {
      const element = document.activeElement as HTMLElement | null;
      if (!element || element === document.body) return undefined;
      const ring = (node: Element) => {
        const style = getComputedStyle(node);
        return style.outlineStyle !== 'none' && Number.parseFloat(style.outlineWidth) >= 2;
      };
      const holder = [element, element.parentElement, element.closest('label')].find(
        (node) => node && ring(node),
      );
      return {
        name: element.getAttribute('aria-label') ?? element.textContent ?? element.tagName,
        visible: Boolean(holder),
      };
    });
    if (focus && !focus.visible) invisible.push(focus.name);
  }
  expect(invisible).toEqual([]);
});

test('@a11y focus is not hidden behind the sticky action bar (WCAG 2.4.11)', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await openStory(page, SCREEN.setFocus);
  const help = page.getByRole('button', { name: 'What is RIR?' });
  await help.focus();
  const [helpBox, barBox] = await Promise.all([
    help.boundingBox(),
    page.getByRole('button', { name: 'Log set' }).boundingBox(),
  ]);
  expect(helpBox && barBox && helpBox.y + helpBox.height <= barBox.y).toBe(true);
});

test('@a11y at 200% text and 320 px nothing scrolls sideways (reflow)', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 320, height: 640 });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Page.enable');
  await cdp.send('Page.setFontSizes', { fontSizes: { standard: 32, fixed: 26 } });
  const overflowing: string[] = [];
  const overflow = () =>
    page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
  for (const route of SHELL_ROUTES) {
    await page.goto(route);
    if (await overflow()) overflowing.push(route);
  }
  for (const story of stories().filter(isReferenceScreen)) {
    await openStory(page, story.id);
    if (await overflow()) overflowing.push(story.id);
  }
  expect(overflowing).toEqual([]);
});

test('@a11y the skip link is the first focusable element', async ({ page }) => {
  await page.goto('/');
  await page.keyboard.press('Tab');
  await expect(page.locator(':focus')).toHaveText('Skip to main content');
});

test('@a11y every route and reference screen has one h1, one main, and a page header', async ({
  page,
}) => {
  const check = async (where: string) => {
    // By role, so Storybook's hidden error-display markup is not counted.
    expect(await page.getByRole('heading', { level: 1 }).count(), `${where} h1`).toBe(1);
    expect(await page.getByRole('main').count(), `${where} main`).toBe(1);
    expect(await page.getByRole('banner').count(), `${where} header`).toBe(1);
  };
  for (const route of SHELL_ROUTES) {
    await page.goto(route);
    await check(route);
  }
  for (const story of stories().filter(isReferenceScreen)) {
    await openStory(page, story.id);
    await check(story.id);
  }
});
