#!/usr/bin/env node
/**
 * App icon build (brand.app-icon.bars, brand.def.favicon-set).
 *
 * Original project artwork: three rounded bars rising in height, white on the accent green.
 * The SVG sources are written here and rasterised with the repository's pinned Chromium, so
 * no image dependency is added. Outputs are committed under public/icons and checked by
 * e2e/identity.spec.ts.
 *
 *   node apps/web/tools/build-icons.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');
const ACCENT = '#275F3C';
const ON_ACCENT = '#FFFFFF';

/** Bars on a 512 grid: 88 wide, 40 apart, heights 160/248/336 on a shared baseline. */
function bars(fill, scale = 1) {
  const heights = [160, 248, 336];
  const width = 88;
  const gap = 40;
  const baseline = 424;
  const rects = heights
    .map((height, index) => {
      const x = 84 + index * (width + gap);
      return `<rect x="${x}" y="${baseline - height}" width="${width}" height="${height}" rx="24" fill="${fill}"/>`;
    })
    .join('');
  if (scale === 1) return rects;
  const offset = 256 * (1 - scale);
  return `<g transform="translate(${offset} ${offset}) scale(${scale})">${rects}</g>`;
}

const svg = (body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" role="img"><title>Workout Logger</title>${body}</svg>\n`;

/** Rounded tile for favicons and "any" icons. */
const standard = svg(
  `<rect width="512" height="512" rx="112" fill="${ACCENT}"/>${bars(ON_ACCENT)}`,
);
/** Full-bleed with the bars inside the central 80% safe zone (maskable). */
const maskable = svg(`<rect width="512" height="512" fill="${ACCENT}"/>${bars(ON_ACCENT, 0.72)}`);
/** Shape only; the platform supplies the colour (purpose: monochrome). */
const monochrome = svg(bars('#000000'));

mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, 'icon.svg'), standard);
writeFileSync(join(OUT, 'icon-maskable.svg'), maskable);
writeFileSync(join(OUT, 'icon-monochrome.svg'), monochrome);

const RASTERS = [
  ['icon-32.png', standard, 32],
  ['apple-touch-icon.png', maskable, 180],
  ['icon-192.png', standard, 192],
  ['icon-512.png', standard, 512],
  ['icon-maskable-512.png', maskable, 512],
];

const browser = await chromium.launch();
try {
  for (const [file, source, size] of RASTERS) {
    const page = await browser.newPage({ viewport: { width: size, height: size } });
    await page.setContent(
      `<html><body style="margin:0;background:transparent">${source.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`,
    );
    await page.screenshot({ path: join(OUT, file), omitBackground: true });
    await page.close();
    process.stdout.write(`wrote ${file}\n`);
  }
} finally {
  await browser.close();
}
