import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Presentation rules the type system cannot see (ADR-0008, DESIGN_SYSTEM.md § Rules).
 */
const WEB = join(__dirname, '..');

function files(directory: string, pattern: RegExp): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) return files(path, pattern);
    return pattern.test(entry) ? [path] : [];
  });
}

const components = files(join(WEB, 'ui'), /\.tsx$/);
const modules = files(join(WEB, 'ui'), /\.module\.css$/);
const stylesheets = [...modules, join(WEB, 'app', 'global.css')];
const name = (path: string) => relative(WEB, path);

describe('CSS Modules', () => {
  it.each(components.map(name))('%s uses only classes its module defines', (file) => {
    const source = readFileSync(join(WEB, file), 'utf8');
    const imported = /import moduleStyles from '(\.\/[\w]+\.module\.css)'/.exec(source)?.[1];
    if (!imported) return;
    const css = readFileSync(join(dirname(join(WEB, file)), imported), 'utf8');
    const declared = /Record<([^>]+), string>/.exec(source)?.[1] ?? '';
    for (const className of [...declared.matchAll(/'(\w+)'/g)].map((match) => match[1])) {
      expect(css, `${imported} has no .${className}`).toMatch(new RegExp(`\\.${className}\\b`));
    }
  });
});

describe('tokens only', () => {
  it.each(stylesheets.map(name))('%s uses no raw colour, duration, easing, or layer', (file) => {
    const css = readFileSync(join(WEB, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(css).not.toMatch(/\b(rgb|rgba|hsl|hsla|oklch|lab)\(/);
    // The reduced-motion reset's 0.01ms is the standard accessibility pattern, not a design value.
    expect(css.replaceAll('0.01ms', '')).not.toMatch(/\b\d+m?s\b/);
    expect(css).not.toMatch(/cubic-bezier\(/);
    expect(css).not.toMatch(/z-index:\s*-?\d/);
    expect(css).not.toMatch(/box-shadow:[^;]*\d+px/);
  });

  it.each(stylesheets.map(name))('%s sizes nothing in raw pixels outside media queries', (file) => {
    const css = readFileSync(join(WEB, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const offending = css
      .split('\n')
      .filter((line) => /\d+px/.test(line))
      .filter((line) => !line.trim().startsWith('@media'))
      // WCAG's 320 px reflow floor and the 1 px screen-reader-only box are not design values.
      .filter((line) => !/min-inline-size: 320px|(inline|block)-size: 1px/.test(line));
    expect(offending).toEqual([]);
  });
});

describe('logical properties (i18n.rtl.logical-now)', () => {
  it.each(stylesheets.map(name))('%s uses no physical direction', (file) => {
    // Media features such as min-width describe the viewport, not layout direction.
    const css = readFileSync(join(WEB, file), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/@media[^{]*\{/g, '');
    expect(css).not.toMatch(
      /(?<![\w-])((margin|padding|border)-(left|right|top|bottom)|left|right|top|bottom|width|height|min-width|max-width|min-height|max-height):|text-align:\s*(left|right)/,
    );
  });
});

describe('closed component API (tokens.component-api.closed-variants)', () => {
  it.each(files(join(WEB, 'ui', 'primitives'), /\.tsx$/).map(name))(
    '%s accepts no className or style prop',
    (file) => {
      const source = readFileSync(join(WEB, file), 'utf8');
      const props = source.match(/type \w+Props = \{[\s\S]*?\n\};/g) ?? [];
      for (const block of props) expect(block).not.toMatch(/\b(className|style)\??:/);
    },
  );
});

describe('screens compose the design system', () => {
  const screens = files(join(WEB, 'app'), /\.tsx$/);

  it.each(screens.map(name))('%s imports presentation only from ui/', (file) => {
    const source = readFileSync(join(WEB, file), 'utf8');
    const imports = [...source.matchAll(/from '([^']+)'/g)].map((match) => match[1] ?? '');
    const allowed = (specifier: string) =>
      /^(react|next(\/.*)?)$/.test(specifier) ||
      /^(\.\.\/)+ui$/.test(specifier) ||
      /^(\.\.\/)+ui\/tokens\/tokens\.css$/.test(specifier) ||
      /^\.\/[\w-]+(\.css)?$/.test(specifier) ||
      /^\.\.\/(set-focus\/SetFocus|rest\/RestView)$/.test(specifier);
    expect(imports.filter((specifier) => !allowed(specifier))).toEqual([]);
    expect(source, 'screens do not write their own CSS Modules').not.toMatch(/\.module\.css/);
  });
});
