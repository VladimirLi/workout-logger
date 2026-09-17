#!/usr/bin/env node
/**
 * DTCG token build (tokens.source.dtcg-json, tokens.tiers.two-tier, tokens.naming.category-role).
 *
 * Source of truth: the four *.tokens.json files beside this script, in the Design Tokens
 * Community Group Format Module 2025.10. Output: CSS custom properties and a typed
 * TypeScript table under apps/web/ui/tokens/. Both outputs are committed and a unit test
 * fails when they drift from the source, so a hand edit to the output is caught.
 *
 * Only semantic tokens are emitted. Core tokens are raw values that semantic tokens
 * reference; no component can reach them because they never become custom properties.
 *
 *   node apps/web/tokens/build-tokens.mjs          write the outputs
 *   node apps/web/tokens/build-tokens.mjs --check  exit 1 when the outputs are stale
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const OUTPUT_CSS = join(HERE, '..', 'ui', 'tokens', 'tokens.css');
export const OUTPUT_TS = join(HERE, '..', 'ui', 'tokens', 'tokens.generated.ts');

const BIOME = join(HERE, '..', '..', '..', 'node_modules', '.bin', 'biome');

/** Formats output exactly as the repository formatter would, so the drift check is stable. */
function formatted(path, text) {
  return execFileSync(BIOME, ['format', `--stdin-file-path=${path}`], {
    input: text,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'inherit'],
  });
}

const TYPES = new Set([
  'color',
  'dimension',
  'duration',
  'cubicBezier',
  'fontFamily',
  'fontWeight',
  'number',
  'shadow',
]);

const read = (name) => JSON.parse(readFileSync(join(HERE, name), 'utf8'));

export function loadSources() {
  return {
    core: read('core.tokens.json'),
    semantic: read('semantic.tokens.json'),
    light: read('semantic.light.tokens.json'),
    dark: read('semantic.dark.tokens.json'),
  };
}

/** Flattens a DTCG tree into path -> {type, value}, inheriting $type from groups. */
export function flatten(tree, prefix = [], inheritedType = undefined, out = new Map()) {
  const type = tree.$type ?? inheritedType;
  if ('$value' in tree) {
    if (!TYPES.has(type)) throw new Error(`${prefix.join('.')}: unsupported or missing $type`);
    out.set(prefix.join('.'), { type, value: tree.$value });
    return out;
  }
  for (const [key, child] of Object.entries(tree)) {
    if (key.startsWith('$')) continue;
    if (child === null || typeof child !== 'object' || Array.isArray(child)) {
      throw new Error(`${[...prefix, key].join('.')}: a group member must be a token or group`);
    }
    flatten(child, [...prefix, key], type, out);
  }
  return out;
}

const REFERENCE = /^\{([^{}]+)\}$/;

function resolve(path, table, trail = []) {
  const token = table.get(path);
  if (!token) throw new Error(`unresolved reference {${path}} from ${trail.join(' -> ')}`);
  if (trail.includes(path)) throw new Error(`reference cycle: ${[...trail, path].join(' -> ')}`);
  if (typeof token.value === 'string' && REFERENCE.test(token.value)) {
    const target = resolve(REFERENCE.exec(token.value)[1], table, [...trail, path]);
    if (target.type !== token.type) {
      throw new Error(`${path}: $type ${token.type} references a ${target.type}`);
    }
    return target;
  }
  return token;
}

const hex2 = (component) =>
  Math.round(component * 255)
    .toString(16)
    .padStart(2, '0')
    .toUpperCase();

function validateColor(path, value) {
  if (value.colorSpace !== 'srgb' || value.components?.length !== 3) {
    throw new Error(`${path}: colours must be sRGB with three components`);
  }
  const fromComponents = `#${value.components.map(hex2).join('')}`;
  if (value.hex !== fromComponents) {
    throw new Error(`${path}: hex ${value.hex} disagrees with components (${fromComponents})`);
  }
  if (value.alpha !== undefined && !(value.alpha >= 0 && value.alpha <= 1)) {
    throw new Error(`${path}: alpha out of range`);
  }
}

const cssColor = (value) => {
  if (value.alpha === undefined || value.alpha === 1) return value.hex;
  const [r, g, b] = value.components.map((c) => Math.round(c * 255));
  return `rgb(${r} ${g} ${b} / ${value.alpha})`;
};

const cssDimension = ({ value, unit }) => (value === 0 ? '0' : `${value}${unit}`);

const quoteFamily = (family) =>
  /^[a-z-]+$/i.test(family) && !family.includes(' ') ? family : `"${family}"`;

function cssValue(path, { type, value }) {
  switch (type) {
    case 'color':
      validateColor(path, value);
      return cssColor(value);
    case 'dimension':
      return cssDimension(value);
    case 'duration':
      return `${value.value}${value.unit}`;
    case 'cubicBezier':
      return `cubic-bezier(${value.join(', ')})`;
    case 'fontFamily':
      return (Array.isArray(value) ? value : [value]).map(quoteFamily).join(', ');
    case 'fontWeight':
    case 'number':
      return path.startsWith('font.tracking.') ? `${value}em` : String(value);
    case 'shadow': {
      validateColor(path, value.color);
      const parts = [value.offsetX, value.offsetY, value.blur, value.spread].map(cssDimension);
      return `${parts.join(' ')} ${cssColor(value.color)}`;
    }
    default:
      throw new Error(`${path}: no CSS mapping for ${type}`);
  }
}

/** Category-role naming: color.surface.raised -> color-surface-raised. */
export function cssName(path) {
  return path
    .split('.')
    .filter((segment) => segment !== 'default')
    .join('-')
    .replace(/^motion-duration-/, 'motion-')
    .replace(/^motion-easing-/, 'ease-')
    .replace(/^font-line-height-/, 'line-height-')
    .replace(/^font-tracking-/, 'tracking-')
    .replace(/^font-size-/, 'font-size-');
}

function emitGroup(sourceTree, table) {
  const names = new Map();
  for (const [path] of flatten(sourceTree)) {
    const name = cssName(path);
    if (names.has(name))
      throw new Error(`${path} and ${names.get(name).path} both map to --${name}`);
    names.set(name, { path, css: cssValue(path, resolve(path, table)) });
  }
  return names;
}

/** Display size is a composite: the fluid tier of typography.scale.two-tier. */
function withComposites(shared) {
  const min = shared.get('font-size-display-min');
  const max = shared.get('font-size-display-max');
  shared.set('font-size-display', {
    path: 'composite',
    css: `clamp(${min.css}, 12vw, ${max.css})`,
  });
  return shared;
}

export function buildTokens(sources = loadSources()) {
  const base = new Map([...flatten(sources.core), ...flatten(sources.semantic)]);
  const tableFor = (theme) => {
    const table = new Map(base);
    for (const [path, token] of flatten(theme)) {
      if (table.has(path)) throw new Error(`${path}: a theme token shadows a shared token`);
      table.set(path, token);
    }
    return table;
  };

  const shared = withComposites(emitGroup(sources.semantic, base));
  const light = emitGroup(sources.light, tableFor(sources.light));
  const dark = emitGroup(sources.dark, tableFor(sources.dark));

  const lightNames = [...light.keys()].sort();
  const darkNames = [...dark.keys()].sort();
  if (JSON.stringify(lightNames) !== JSON.stringify(darkNames)) {
    throw new Error('light and dark themes must define exactly the same roles');
  }

  const block = (entries) =>
    [...entries].map(([name, { css }]) => `  --${name}: ${css};`).join('\n');

  const css = `/*
 * GENERATED by apps/web/tokens/build-tokens.mjs from apps/web/tokens/*.tokens.json.
 * Do not edit. A unit test fails when this file drifts from its source.
 *
 * First visit is light (theme.first-visit.light-then-choice). The inline bootstrap in the
 * root layout sets data-theme before first paint; "system" follows the OS.
 */

:root {
${block(shared)}
${block(light)}
  color-scheme: light;
}

:root[data-theme="dark"] {
${block(dark)}
  color-scheme: dark;
}

@media (prefers-color-scheme: dark) {
  :root[data-theme="system"] {
${block(dark).replaceAll('\n  ', '\n    ').replace(/^ {2}/, '    ')}
    color-scheme: dark;
  }
}
`;

  const record = (entries) =>
    `{\n${[...entries].map(([name, { css: value }]) => `    '${name}': ${JSON.stringify(value)},`).join('\n')}\n  }`;

  const ts = `/*
 * GENERATED by apps/web/tokens/build-tokens.mjs. Do not edit.
 */

export const sharedTokens = ${record(shared)
    .replaceAll('\n    ', '\n  ')
    .replace(/\n {2}\}$/, '\n}')} as const;

export const themeTokens = {
  light: ${record(light)},
  dark: ${record(dark)},
} as const;

export type SharedTokenName = keyof typeof sharedTokens;
export type ThemeTokenName = keyof (typeof themeTokens)['light'];
export type TokenName = SharedTokenName | ThemeTokenName;
`;

  return {
    css: formatted(OUTPUT_CSS, css),
    ts: formatted(OUTPUT_TS, ts),
    shared,
    light,
    dark,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { css, ts } = buildTokens();
  if (process.argv.includes('--check')) {
    const stale = [
      [OUTPUT_CSS, css],
      [OUTPUT_TS, ts],
    ].filter(([path, expected]) => {
      try {
        return readFileSync(path, 'utf8') !== expected;
      } catch {
        return true;
      }
    });
    for (const [path] of stale) console.error(`stale: ${path}`);
    process.exit(stale.length === 0 ? 0 : 1);
  }
  writeFileSync(OUTPUT_CSS, css);
  writeFileSync(OUTPUT_TS, ts);
  process.stdout.write(`wrote ${OUTPUT_CSS}\nwrote ${OUTPUT_TS}\n`);
}
