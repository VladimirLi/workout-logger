import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The Storybook lab's inventory and hierarchy (governance.lab.storybook, ADR-0010).
 *
 * Every exported component has a component-level story file, filed under its category; there
 * are no omnibus story files mixing components; and every reference screen has a story.
 */

const UI = __dirname;

function files(directory: string, pattern: RegExp): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) return files(path, pattern);
    return pattern.test(entry) ? [path] : [];
  });
}

const storyFiles = files(UI, /\.stories\.tsx$/);
const META_TITLE = /title: '((?:Foundations|Primitives|Patterns|Reference screens)\/[^']+)'/g;
const titleOf = (file: string) => [...readFileSync(file, 'utf8').matchAll(META_TITLE)][0]?.[1];
const componentOf = (file: string) => /component: (\w+),/.exec(readFileSync(file, 'utf8'))?.[1];

/** Exported components that are deliberately not their own story, and why. */
const COVERED_ELSEWHERE: Record<string, string> = {
  Heading: 'Primitives/Typography',
  Value: 'Primitives/Typography',
  VisuallyHidden: '',
  RestView: 'Reference screens/Rest',
  SignInForm: 'product route /sign-in; pattern story deferred pending owner visual-change PR',
};

const PATTERN_CATEGORIES = [
  'Navigation',
  'Workout',
  'Feedback',
  'Data',
  'Settings',
  'Proposals',
  'Layout',
];

function exportedComponents(directory: string): { name: string; file: string }[] {
  return files(join(UI, directory), /^[A-Z]\w+\.tsx$/)
    .filter((file) => !file.endsWith('.stories.tsx'))
    .flatMap((file) =>
      [...readFileSync(file, 'utf8').matchAll(/^export function ([A-Z]\w+)\(/gm)].map((match) => ({
        name: match[1] ?? '',
        file,
      })),
    );
}

describe('story files', () => {
  it('each declares exactly one title and one component', () => {
    for (const file of storyFiles) {
      const source = readFileSync(file, 'utf8');
      expect([...source.matchAll(META_TITLE)].length, relative(UI, file)).toBe(1);
      expect(componentOf(file), relative(UI, file)).toBeDefined();
    }
  });

  it('have unique titles', () => {
    const titles = storyFiles.map(titleOf);
    expect(titles.length).toBe(new Set(titles).size);
  });

  it('are named after the component they document (no omnibus files)', () => {
    for (const file of storyFiles) {
      const component = componentOf(file);
      const stem = basename(file, '.stories.tsx');
      if (dirname(file).endsWith('foundations')) continue;
      expect(stem, relative(UI, file)).toBe(stem === 'Text' ? 'Text' : component);
    }
  });
});

describe('the hierarchy', () => {
  it('files primitives under Primitives/<Component>', () => {
    for (const file of storyFiles.filter((path) => path.includes('/primitives/'))) {
      const component = componentOf(file) ?? '';
      expect(titleOf(file), relative(UI, file)).toBe(
        component === 'Text' ? 'Primitives/Typography' : `Primitives/${component}`,
      );
    }
  });

  it('files patterns under Patterns/<Category>/<Component>', () => {
    for (const file of storyFiles.filter((path) => path.includes('/patterns/'))) {
      const [root, category, leaf, ...rest] = (titleOf(file) ?? '').split('/');
      expect(
        { root, known: PATTERN_CATEGORIES.includes(category ?? ''), leaf, rest },
        relative(UI, file),
      ).toEqual({
        root: 'Patterns',
        known: true,
        leaf: componentOf(file),
        rest: [],
      });
    }
  });

  it('files reference screens and foundations in their own sections', () => {
    for (const file of storyFiles.filter((path) => path.includes('/reference/'))) {
      expect(titleOf(file), relative(UI, file)).toMatch(/^Reference screens\/[A-Z][A-Za-z ]+$/);
    }
    for (const file of storyFiles.filter((path) => path.includes('/foundations/'))) {
      expect(titleOf(file), relative(UI, file)).toMatch(/^Foundations\/[A-Z][A-Za-z]+$/);
    }
  });
});

describe('inventory coverage', () => {
  const documented = new Set(storyFiles.map(componentOf));

  it.each(['primitives', 'patterns', 'reference/screens'])(
    'every component in ui/%s has a story',
    (directory) => {
      const missing = exportedComponents(directory)
        .map(({ name }) => name)
        .filter((name) => !documented.has(name) && !(name in COVERED_ELSEWHERE));
      expect(missing).toEqual([]);
    },
  );

  it('components covered elsewhere really appear where the list says', () => {
    const typography = readFileSync(join(UI, 'primitives/Text.stories.tsx'), 'utf8');
    expect(typography).toContain('<Heading');
    expect(typography).toContain('<Value');
    expect(readFileSync(join(UI, 'reference/screens/RestScreen.tsx'), 'utf8')).toContain(
      '<RestView',
    );
    expect(storyFiles.some((file) => titleOf(file) === 'Reference screens/Rest')).toBe(true);
  });
});
