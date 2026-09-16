import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';

/**
 * Guards the coupling between an installability CLAIM and the evidence for it.
 *
 * The manifest and the service worker are plumbing. A browser will not offer to
 * install a PWA without icons, and icons are visual assets owned by the undecided
 * design system (DESIGN_SYSTEM.md, ADR-0007, gate G-10). So the app is not
 * installable, and nothing may say otherwise until it is.
 *
 * The failure mode this prevents is quiet: someone adds placeholder icons to make a
 * Lighthouse score go green, which is both an accidental visual decision and a claim
 * nobody verified. Either direction of that coupling breaking fails this test.
 */

const ROOT = join(__dirname, '..', '..', '..');
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8');

function designSystemAccepted(): boolean {
  return !read('DESIGN_SYSTEM.md').includes('Status: NOT DECIDED');
}

test('the design system is the gate on installability', async ({ request }) => {
  const manifest = (await (await request.get('/manifest.webmanifest')).json()) as {
    icons?: unknown[];
  };
  const hasIcons = Array.isArray(manifest.icons) && manifest.icons.length > 0;

  if (!designSystemAccepted()) {
    expect(
      hasIcons,
      'The manifest declares icons while DESIGN_SYSTEM.md is NOT DECIDED. Icons are ' +
        'visual assets; adding them decides part of the design system by accident ' +
        '(ADR-0007, gate G-10).',
    ).toBe(false);
    return;
  }

  // Once the design system is accepted, icons become required rather than forbidden,
  // so this guard flips instead of quietly disappearing.
  expect(
    hasIcons,
    'DESIGN_SYSTEM.md is accepted, so the manifest must now declare installability icons.',
  ).toBe(true);
});

test('no shipped description claims the app is installable today', () => {
  if (designSystemAccepted()) return;

  const claims: { file: string; text: string }[] = [
    { file: 'apps/web/package.json', text: read('apps/web/package.json') },
    { file: 'apps/web/app/manifest.ts', text: read('apps/web/app/manifest.ts') },
    { file: 'apps/web/public/sw.js', text: read('apps/web/public/sw.js') },
  ];

  // "installable PWA" as a present-tense description of what exists. Statements of
  // intent elsewhere (VISION.md, the roadmap) are goals and are left alone.
  const presentTenseClaim = /\b(is|are)\s+installable\b|\binstallable\s+PWA\b/i;

  for (const { file, text } of claims) {
    expect(presentTenseClaim.test(text), `${file} claims the app is installable`).toBe(false);
  }
});

test('the offline page does not promise durable offline logging', () => {
  const text = read('apps/web/app/offline/page.tsx');
  expect(text).toContain('not implemented');
});

/**
 * Rendered-document guard.
 *
 * The manifest was guarded, but the page itself still declared the app installable:
 * `appleWebApp.capable` in the root layout renders `mobile-web-app-capable`, plus an
 * Apple title and status-bar style. Those tags tell a phone to launch the site as a
 * standalone app, which is an installability claim, and the status-bar style is a
 * visual decision. Neither belongs in the shell while the design system is undecided.
 *
 * The check reads what is actually rendered - the server HTML and the live DOM - not the
 * source, so any route or metadata API that reintroduces these tags fails it.
 */
const INSTALLABILITY_SELECTORS = [
  'meta[name="mobile-web-app-capable"]',
  'meta[name="apple-mobile-web-app-capable"]',
  'meta[name="apple-mobile-web-app-title"]',
  'meta[name="apple-mobile-web-app-status-bar-style"]',
  'meta[name="theme-color"]',
  'link[rel="apple-touch-icon"]',
  'link[rel="apple-touch-icon-precomposed"]',
  'link[rel="apple-touch-startup-image"]',
  'link[rel~="icon"]',
];

const SHELL_ROUTES = ['/', '/offline'];

for (const route of SHELL_ROUTES) {
  test(`${route} renders no installability or visual-identity metadata`, async ({
    page,
    request,
  }) => {
    if (designSystemAccepted()) return;

    const html = await (await request.get(route)).text();
    const inServerHtml = INSTALLABILITY_SELECTORS.filter((selector) => {
      const [, tag, attribute, value] = /^(\w+)\[(\w+)~?="([^"]+)"\]$/.exec(selector) ?? [];
      const pattern = new RegExp(`<${tag}\\b[^>]*\\b${attribute}="[^"]*\\b${value}\\b[^"]*"`, 'i');
      return pattern.test(html);
    });

    await page.goto(route);
    const inLiveDom = await page.evaluate(
      (selectors) => selectors.filter((selector) => document.head.querySelector(selector) !== null),
      INSTALLABILITY_SELECTORS,
    );

    expect(
      { inServerHtml, inLiveDom },
      'Installability or visual-identity metadata is rendered while DESIGN_SYSTEM.md is NOT ' +
        'DECIDED (ADR-0007, gate G-10).',
    ).toEqual({ inServerHtml: [], inLiveDom: [] });
  });
}

test('the manifest link is still rendered, because it is plumbing', async ({ page }) => {
  await page.goto('/');
  expect(await page.locator('head link[rel="manifest"]').count()).toBe(1);
});
