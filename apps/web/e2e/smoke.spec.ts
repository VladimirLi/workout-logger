import { expect, test } from '@playwright/test';

/**
 * One minimal browser path (D-037). It proves the app builds, boots, serves, and
 * registers a service worker - not that any product feature works.
 */

test('the shell renders with a main landmark and a heading', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { level: 1, name: 'Foundation shell' })).toBeVisible();
  await expect(page.locator('main#main')).toBeVisible();
});

test('the shell fits a 375x667 phone viewport with no horizontal scrolling', async ({ page }) => {
  // R-004: the in-workout surface must be usable at this size. The shell is held
  // to the same rule so a regression is caught before features arrive.
  await page.setViewportSize({ width: 375, height: 667 });
  await page.goto('/');

  const overflows = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflows).toBe(false);
});

test('the web app manifest route is served and well formed', async ({ request }) => {
  // Served and well formed. Identity and icons are checked in installability-claims.spec.ts;
  // whether a phone offers installation is verified only on a device (G-10).
  const response = await request.get('/manifest.webmanifest');
  expect(response.ok()).toBe(true);

  const manifest = (await response.json()) as Record<string, unknown>;
  expect(manifest.name).toBe('Workout Logger');
  expect(manifest.display).toBe('standalone');
  expect(manifest.start_url).toBe('/');
});

test('the service worker registers', async ({ page }) => {
  await page.goto('/');

  const registered = await page.waitForFunction(
    async () => (await navigator.serviceWorker.getRegistrations()).length > 0,
    undefined,
    { timeout: 15_000 },
  );
  expect(await registered.jsonValue()).toBe(true);
});

test('the offline fallback route is reachable', async ({ page }) => {
  await page.goto('/offline');
  await expect(page.getByRole('heading', { level: 1, name: 'Offline' })).toBeVisible();
});
