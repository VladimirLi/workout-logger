import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { openRoute, SHELL_ROUTES } from './routes';

/**
 * Guards the coupling between identity, installability declarations, and CLAIMS.
 *
 * Before the design system was accepted this file forbade icons and identity metadata. It
 * now REQUIRES exactly the accepted identity (brand.name.plain-text, brand.app-icon.bars,
 * brand.launch.manifest-plain, platform.display-mode.standalone) - the guard flipped rather
 * than disappearing.
 *
 * What it still forbids is a claim nobody verified: declaring the manifest a browser needs
 * is not the same as a phone offering installation. That is recorded only from a real
 * device (docs/external-gates.md, G-10), so no shipped text may say the app is installable.
 */

const ROOT = join(__dirname, '..', '..', '..');
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8');

type ManifestIcon = { src: string; sizes: string; type: string; purpose?: string };
type Manifest = Record<string, unknown> & { icons?: ManifestIcon[] };

test('the design system this identity comes from is accepted', () => {
  expect(read('DESIGN_SYSTEM.md')).toMatch(/^\*\*Status: Accepted\b/m);
});

test('the manifest declares the accepted identity and nothing more', async ({ request }) => {
  const manifest = (await (await request.get('/manifest.webmanifest')).json()) as Manifest;

  expect(manifest).toMatchObject({
    name: 'Workout Logger',
    display: 'standalone',
    start_url: '/',
    background_color: '#EDF0EC',
    theme_color: '#EDF0EC',
  });
  // Both orientations are supported (WCAG 1.3.4, layout.landscape.two-pane).
  expect(manifest.orientation).toBeUndefined();
  // A plain manifest launch: no custom splash screens or screenshots.
  expect(manifest.screenshots).toBeUndefined();

  const icons = manifest.icons ?? [];
  const has = (sizes: string, purpose: string) =>
    icons.some((icon) => icon.sizes === sizes && (icon.purpose ?? 'any') === purpose);
  expect(has('192x192', 'any')).toBe(true);
  expect(has('512x512', 'any')).toBe(true);
  expect(has('512x512', 'maskable')).toBe(true);
  expect(has('any', 'monochrome')).toBe(true);
});

test('every declared icon is served with its declared type and pixel size', async ({ request }) => {
  const manifest = (await (await request.get('/manifest.webmanifest')).json()) as Manifest;
  const declared = [
    ...(manifest.icons ?? []),
    { src: '/icons/icon-32.png', sizes: '32x32', type: 'image/png' },
    { src: '/icons/apple-touch-icon.png', sizes: '180x180', type: 'image/png' },
  ];
  for (const icon of declared) {
    const response = await request.get(icon.src);
    expect(response.ok(), icon.src).toBe(true);
    expect(response.headers()['content-type'], icon.src).toContain(icon.type);
    if (icon.type === 'image/png') {
      const png = await response.body();
      const size = `${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`;
      expect(size, icon.src).toBe(icon.sizes);
    }
  }
});

test('no shipped description claims the app is installable', () => {
  const files = [
    'apps/web/package.json',
    'apps/web/app/manifest.ts',
    'apps/web/app/layout.tsx',
    'apps/web/public/sw.js',
  ];
  // "installable PWA" as a present-tense description of what exists. Statements of intent
  // elsewhere (VISION.md, the roadmap) are goals and are left alone.
  const presentTenseClaim = /\b(is|are)\s+installable\b|\binstallable\s+PWA\b/i;
  for (const file of files) {
    expect(presentTenseClaim.test(read(file)), `${file} claims the app is installable`).toBe(false);
  }
});

test('the offline page does not promise durable offline logging', () => {
  const text = read('apps/web/app/offline/page.tsx');
  expect(text).toContain('not implemented');
});

/**
 * Rendered-document guard. It reads what is actually rendered - the server HTML and the
 * live DOM - so any route or metadata API that drops or adds identity tags is caught.
 */
const REQUIRED = [
  'meta[name="application-name"][content="Workout Logger"]',
  'meta[name="theme-color"]',
  'link[rel="icon"][type="image/svg+xml"]',
  'link[rel="icon"][sizes="32x32"]',
  'link[rel="apple-touch-icon"][sizes="180x180"]',
  'link[rel="manifest"]',
];

/** brand.launch.manifest-plain: the launch screen comes from the manifest alone. */
const FORBIDDEN = [
  'link[rel="apple-touch-startup-image"]',
  'link[rel="apple-touch-icon-precomposed"]',
];

for (const route of SHELL_ROUTES) {
  test(`${route} renders the accepted identity metadata and no custom launch images`, async ({
    page,
  }) => {
    await openRoute(page, route);
    const found = await page.evaluate(
      ([required, forbidden]) => ({
        missing: required.filter((selector) => document.head.querySelector(selector) === null),
        present: forbidden.filter((selector) => document.head.querySelector(selector) !== null),
        themeColors: document.head.querySelectorAll('meta[name="theme-color"]').length,
      }),
      [REQUIRED, FORBIDDEN] as const,
    );
    expect(found).toEqual({ missing: [], present: [], themeColors: 1 });
  });
}
