import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { extname, join, normalize } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

/**
 * The Storybook lab (governance.lab.storybook) must not only build: every story must render
 * without an error and pass axe. `pnpm storybook:build` runs before this in `pnpm verify`;
 * a missing build fails here rather than being skipped.
 */

const STATIC = join(__dirname, '..', 'storybook-static');
const TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
};

let server: Server;
let origin = '';

test.beforeAll(async () => {
  expect(existsSync(join(STATIC, 'index.json')), 'run pnpm storybook:build first').toBe(true);
  server = createServer((request, response) => {
    const path = normalize(decodeURIComponent((request.url ?? '/').split('?')[0] ?? '/'));
    const file = join(STATIC, path === '/' ? 'index.html' : path);
    if (!file.startsWith(STATIC) || !existsSync(file) || statSync(file).isDirectory()) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
    createReadStream(file).pipe(response);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

test.afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

function storyIds(): string[] {
  const index = JSON.parse(readFileSync(join(STATIC, 'index.json'), 'utf8')) as {
    entries: Record<string, { id: string; type: string }>;
  };
  return Object.values(index.entries)
    .filter((entry) => entry.type === 'story')
    .map((entry) => entry.id)
    .sort();
}

test('the Storybook lab has stories for primitives and patterns', () => {
  const ids = storyIds();
  expect(ids.length).toBeGreaterThanOrEqual(15);
  expect(ids.some((id) => id.startsWith('primitives-'))).toBe(true);
  expect(ids.some((id) => id.startsWith('patterns-'))).toBe(true);
});

test('every story renders without an error', async ({ page }) => {
  test.setTimeout(120_000);
  const failures: string[] = [];
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text().split('\n')[0] ?? '');
  });
  for (const id of storyIds()) {
    errors.length = 0;
    await page.goto(`${origin}/iframe.html?id=${id}&viewMode=story`);
    // The body passes through a preparing state; a render error arrives after it.
    await page.waitForFunction(
      () =>
        !document.body.classList.contains('sb-show-preparing-story') &&
        (document.body.classList.contains('sb-show-errordisplay') ||
          (document.querySelector('#storybook-root')?.childElementCount ?? 0) > 0),
    );
    await page.waitForLoadState('networkidle');
    const shown = await page.evaluate(() => document.body.className);
    if (shown.includes('sb-show-errordisplay') || errors.length > 0) {
      failures.push(`${id}: ${shown} ${errors.join('; ')}`);
    }
  }
  expect(failures).toEqual([]);
});

test('@a11y every story has no detectable WCAG 2.2 A/AA violations in either theme', async ({
  page,
}) => {
  test.setTimeout(180_000);
  // Colour transitions would otherwise be measured mid-way after the theme switches.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const violations: string[] = [];
  for (const theme of ['light', 'dark']) {
    for (const id of storyIds()) {
      await page.goto(`${origin}/iframe.html?id=${id}&viewMode=story&globals=theme:${theme}`);
      await page.waitForFunction(() => document.body.classList.contains('sb-show-main'));
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      const results = await new AxeBuilder({ page })
        .include('#storybook-root')
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
        .analyze();
      for (const violation of results.violations)
        violations.push(`${theme} ${id}: ${violation.id}`);
    }
  }
  expect(violations).toEqual([]);
});
