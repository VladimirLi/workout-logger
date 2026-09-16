import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

/**
 * Automated accessibility gate (D-037, R-007).
 *
 * Automated scans CANNOT establish WCAG conformance. R-007 requires manual
 * keyboard, screen-reader, zoom, orientation, contrast, and touch-target checks as
 * well. This catches the mechanical subset, which is worth catching every commit.
 */

const ROUTES = ['/', '/offline'];

for (const route of ROUTES) {
  test(`@a11y ${route} has no detectable WCAG 2.2 A/AA violations`, async ({ page }) => {
    await page.goto(route);

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();

    expect(results.violations).toEqual([]);
  });
}

test('@a11y primary interactive targets meet the 44x44 CSS-pixel floor', async ({ page }) => {
  // R-007 holds in-workout controls to 44x44, stricter than WCAG 2.2's 24x24,
  // because gym use is one-handed and motion-prone.
  await page.setViewportSize({ width: 375, height: 667 });
  await page.goto('/');

  const undersized = await page.evaluate(() => {
    const MIN = 44;
    const selector = 'button, a[role="button"], input[type="button"], input[type="submit"]';
    return [...document.querySelectorAll(selector)]
      .map((element) => {
        const { width, height } = element.getBoundingClientRect();
        return { tag: element.tagName, width, height };
      })
      .filter(({ width, height }) => width > 0 && (width < MIN || height < MIN));
  });

  expect(undersized).toEqual([]);
});

test('@a11y the skip link is the first focusable element', async ({ page }) => {
  await page.goto('/');
  await page.keyboard.press('Tab');

  await expect(page.locator(':focus')).toHaveText('Skip to main content');
});
