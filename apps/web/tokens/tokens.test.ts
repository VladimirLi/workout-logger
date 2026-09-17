import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildTokens, flatten, loadSources, OUTPUT_CSS, OUTPUT_TS } from './build-tokens.mjs';

/**
 * The token source is the design system's single source of truth (ADR-0008). These tests
 * hold the generated output to it, and hold the values to the accepted contrast target
 * (color.contrast-target.aa-plus) in both themes.
 */

type Entry = { path: string; css: string };
const built = buildTokens() as ReturnType<typeof buildTokens> & {
  light: Map<string, Entry>;
  dark: Map<string, Entry>;
  shared: Map<string, Entry>;
};

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((index) => Number.parseInt(hex.slice(index, index + 2), 16) / 255);
  const [r, g, b] = channels.map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0);
}

export function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((light ?? 0) + 0.05) / ((dark ?? 0) + 0.05);
}

function lightnessL(hex: string): number {
  const y = luminance(hex);
  return y > 216 / 24389 ? 116 * Math.cbrt(y) - 16 : (24389 / 27) * y;
}

describe('generated token output', () => {
  it('matches the committed CSS custom properties', () => {
    expect(readFileSync(OUTPUT_CSS, 'utf8')).toBe(built.css);
  });

  it('matches the committed TypeScript token table', () => {
    expect(readFileSync(OUTPUT_TS, 'utf8')).toBe(built.ts);
  });

  it('emits no core token as a custom property', () => {
    expect(built.css).not.toMatch(/--(neutral|green|blue|amber|red|white|black)\b/);
    expect(built.css).not.toMatch(/--color-(neutral|green|blue|amber|red)-/);
  });

  it('defines the same roles in light and dark', () => {
    expect([...built.dark.keys()]).toEqual([...built.light.keys()]);
  });

  it('declares the accepted semantic colour roles', () => {
    for (const role of [
      'bg',
      'surface',
      'surface-raised',
      'surface-sunken',
      'ink',
      'ink-muted',
      'border',
      'border-strong',
      'accent',
      'accent-hover',
      'accent-pressed',
      'on-accent',
      'focus',
      'success',
      'warning',
      'danger',
      'info',
      'offline',
    ]) {
      expect(built.light.has(`color-${role}`), role).toBe(true);
    }
  });

  it('resolves to the accepted Quiet Performance values', () => {
    const pick = (theme: Map<string, Entry>, name: string) => theme.get(name)?.css;
    expect(pick(built.light, 'color-bg')).toBe('#EDF0EC');
    expect(pick(built.dark, 'color-bg')).toBe('#101311');
    expect(pick(built.light, 'color-accent')).toBe('#275F3C');
    expect(pick(built.light, 'color-focus')).toBe('#0B57D0');
    expect(pick(built.dark, 'color-focus')).toBe('#8AB4F8');
    expect(pick(built.dark, 'color-surface')).toBe('#181C19');
    expect(pick(built.dark, 'color-surface-raised')).toBe('#212622');
    expect(built.shared.get('radius-control')?.css).toBe('10px');
    expect(built.shared.get('radius-card')?.css).toBe('14px');
    expect(built.shared.get('radius-sheet')?.css).toBe('20px');
    expect(built.shared.get('motion-base')?.css).toBe('200ms');
    expect(built.shared.get('ease-standard')?.css).toBe('cubic-bezier(0.2, 0, 0, 1)');
    expect(built.shared.get('target-min')?.css).toBe('44px');
    expect(built.shared.get('target-workout')?.css).toBe('48px');
  });

  it('keeps the 4 px spacing scale', () => {
    const scale = [...built.shared.entries()]
      .filter(([name]) => /^space-\d$/.test(name))
      .map(([, { css }]) => (css === '0' ? 0 : Number.parseInt(css, 10)));
    expect(scale).toEqual([0, 4, 8, 12, 16, 24, 32, 48, 64]);
  });

  it('sizes the fixed type tier in rem so user text scaling applies', () => {
    for (const name of ['label', 'body', 'title', 'heading']) {
      expect(built.shared.get(`font-size-${name}`)?.css).toMatch(/rem$/);
    }
    expect(built.shared.get('font-size-display')?.css).toBe('clamp(2.5rem, 12vw, 4rem)');
  });
});

describe('DTCG source integrity', () => {
  const sources = loadSources();

  it('rejects an unresolved reference', () => {
    const broken = structuredClone(sources);
    broken.light.color.bg.default.$value = '{color.neutral.12345}';
    expect(() => buildTokens(broken)).toThrow(/unresolved reference/);
  });

  it('rejects a hex value that disagrees with its components', () => {
    const broken = structuredClone(sources);
    broken.core.color.green['700'].$value.hex = '#275F3D';
    expect(() => buildTokens(broken)).toThrow(/disagrees with components/);
  });

  it('rejects a token without a type', () => {
    expect(() => flatten({ orphan: { $value: 1 } })).toThrow(/missing \$type/);
  });

  it('rejects a theme that omits a role the other theme defines', () => {
    const broken = structuredClone(sources);
    delete broken.dark.color.offline.soft;
    expect(() => buildTokens(broken)).toThrow(/same roles/);
  });

  it('orders every core colour family so a larger step is strictly darker', () => {
    // Step labels are names, not measurements; this keeps them honest.
    for (const [family, steps] of Object.entries(sources.core.color)) {
      if (family.startsWith('$') || '$value' in (steps as object)) continue;
      const ordered = Object.entries(steps as Record<string, { $value: { hex: string } }>)
        .filter(([step]) => !step.startsWith('$'))
        .map(([step, token]) => ({ step: Number(step), l: lightnessL(token.$value.hex) }))
        .sort((a, b) => a.step - b.step);
      for (let index = 1; index < ordered.length; index += 1) {
        const previous = ordered[index - 1];
        const current = ordered[index];
        expect(
          current?.l,
          `${family}.${current?.step} is not darker than ${previous?.step}`,
        ).toBeLessThan(previous?.l ?? 0);
      }
    }
  });

  it('pins green-700 to the accent from the accepted token decision', () => {
    expect(sources.core.color.green['700'].$value.hex).toBe('#275F3C');
  });
});

/**
 * color.contrast-target.aa-plus: 7:1 for workout values, loads, reps, the timer, and
 * primary labels; 4.5:1 for other text; 3:1 for borders, focus rings, and icons.
 */
const TEXT_SURFACES = ['bg', 'surface', 'surface-raised', 'surface-sunken'];
const PAIRS: [foreground: string, background: string, minimum: number][] = [
  ...TEXT_SURFACES.map((bg) => ['ink', bg, 7] as [string, string, number]),
  ...TEXT_SURFACES.map((bg) => ['ink-muted', bg, 4.5] as [string, string, number]),
  ['on-accent', 'accent', 7],
  ['on-accent', 'accent-hover', 7],
  ['on-accent', 'accent-pressed', 7],
  ['accent-soft-ink', 'accent-soft', 4.5],
  ['ink', 'accent-soft', 7],
  ...['bg', 'surface', 'surface-raised'].map(
    (bg) => ['accent', bg, 4.5] as [string, string, number],
  ),
  // Light border-strong on surface-sunken is 2.93:1, so an outlined control is never drawn
  // straight onto a sunken panel: it carries the raised fill, and its boundary is measured
  // against that (DESIGN_SYSTEM.md, Contrast). The restriction is asserted below.
  ...['bg', 'surface', 'surface-raised'].map(
    (bg) => ['border-strong', bg, 3] as [string, string, number],
  ),
  ...TEXT_SURFACES.map((bg) => ['focus', bg, 3] as [string, string, number]),
  ['focus', 'accent-soft', 3],
  ...['success', 'warning', 'danger', 'info', 'offline'].flatMap((status) => [
    ...['bg', 'surface', 'surface-raised'].map(
      (bg) => [status, bg, 4.5] as [string, string, number],
    ),
    [status, `${status}-soft`, 4.5] as [string, string, number],
    ['ink', `${status}-soft`, 7] as [string, string, number],
  ]),
];

describe.each(['light', 'dark'] as const)('%s theme contrast', (theme) => {
  const colors = theme === 'light' ? built.light : built.dark;
  const hex = (role: string) => {
    const value = colors.get(`color-${role}`)?.css;
    if (!value?.startsWith('#')) throw new Error(`color-${role} is not an opaque hex colour`);
    return value;
  };

  it.each(PAIRS)('%s on %s meets %s:1', (foreground, background, minimum) => {
    expect(contrast(hex(foreground), hex(background))).toBeGreaterThanOrEqual(minimum);
  });
});

it('records why an outlined control on a sunken panel needs the raised fill', () => {
  const light = built.light;
  const value = (role: string) => light.get(`color-${role}`)?.css ?? '';
  expect(contrast(value('border-strong'), value('surface-sunken'))).toBeLessThan(3);
});
