import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * What a gate actually runs (D-035, D-037, ADR-0006).
 *
 * `pnpm verify` runs `pnpm <gate>` for each gate, so the root manifest decides what every
 * gate does. That made package.json a guardrail file in everything but name: an implementing
 * agent could set `"test:visual": "true"` and ship the product change it hides in the same
 * commit, and the separation gate would report zero guardrail files touched. It is a guardrail
 * path now, and this file holds the two things a path classification cannot.
 *
 * First, the gates verify.mjs runs must exist as scripts. A gate whose script was renamed
 * away would make `pnpm verify` fail loudly, but one pointing at a script that no longer
 * does the work would not.
 *
 * Second, the root `build` and `storybook:build` gates delegate through pnpm --filter to the
 * WORKSPACE manifests, which are product files - deliberately, because a package's manifest
 * arrives with the package and lists its dependencies, and classifying it as a guardrail
 * would mean no package could ever be added alongside its own source. So the delegated
 * commands are pinned here instead, in a guardrail file: turning one into a no-op fails this
 * test, and changing what it is pinned to is a guardrail change reviewed on its own.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

type Manifest = { name?: string; scripts?: Record<string, string> };

function manifest(path: string): Manifest {
  return JSON.parse(readFileSync(join(ROOT, path), 'utf8')) as Manifest;
}

const root = manifest('package.json');
const rootScripts = root.scripts ?? {};

/** The gate list, read from verify.mjs rather than restated, so the two cannot drift. */
const verifySource = readFileSync(join(ROOT, 'scripts/verify.mjs'), 'utf8');
const gates = [...verifySource.matchAll(/\['([a-z0-9:]+)', \[/g)]
  .map((match) => match[1])
  .filter((gate): gate is string => gate !== undefined);

/**
 * Every workspace package, discovered rather than listed, so a package added tomorrow is
 * covered the day it appears instead of when someone remembers to extend a list here.
 */
const workspacePackages = ['apps', 'packages'].flatMap((group) =>
  readdirSync(join(ROOT, group), { withFileTypes: true })
    .filter(
      (entry) => entry.isDirectory() && existsSync(join(ROOT, group, entry.name, 'package.json')),
    )
    .map((entry) => `${group}/${entry.name}`),
);

/** The build command a package gets unless this file says otherwise. */
const DEFAULT_BUILD = 'tsc --build';

/** Packages whose gate command is legitimately not the default, pinned exactly. */
const PINNED: Record<string, Record<string, string>> = {
  'apps/web': {
    build: 'next build',
    'storybook:build': 'storybook build --quiet --output-dir storybook-static',
  },
};

/** A command that exits 0 without doing the work. A gate wired to one of these is not a gate. */
const NO_OPS = [/^true$/, /^:$/, /^exit\s+0$/, /^echo\b/, /^#/];

describe('gate commands', () => {
  it('runs a non-trivial number of gates', () => {
    expect(gates.length).toBeGreaterThanOrEqual(14);
  });

  it('defines a root script for every gate verify runs', () => {
    for (const gate of gates) {
      expect(rootScripts[gate], `package.json has no "${gate}" script`).toBeTypeOf('string');
    }
  });

  it('wires no gate to a command that exits without doing the work', () => {
    for (const gate of gates) {
      const command = (rootScripts[gate] ?? '').trim();
      for (const pattern of NO_OPS) {
        expect(pattern.test(command), `gate ${gate} is a no-op: ${command}`).toBe(false);
      }
    }
  });

  it('finds the workspace packages the build gate delegates to', () => {
    // A sanity floor: if discovery broke, every delegated check below would pass vacuously.
    expect(workspacePackages.length).toBeGreaterThanOrEqual(9);
    expect(workspacePackages).toContain('apps/web');
  });

  it('pins the build command of every workspace package the build gate runs', () => {
    // `pnpm build` filters ./packages/** and ./apps/**, so each package's own build script is
    // part of a gate. The manifests are product files; these expectations are the guardrail.
    for (const path of workspacePackages) {
      const scripts = manifest(`${path}/package.json`).scripts ?? {};
      const expected = PINNED[path]?.['build'] ?? DEFAULT_BUILD;
      expect(scripts['build'], `${path} does not build with "${expected}"`).toBe(expected);
    }
  });

  it('pins every other delegated gate command', () => {
    for (const [path, commands] of Object.entries(PINNED)) {
      const scripts = manifest(`${path}/package.json`).scripts ?? {};
      for (const [name, expected] of Object.entries(commands)) {
        expect(scripts[name], `${path} does not run "${name}" as "${expected}"`).toBe(expected);
      }
    }
    // storybook:build is delegated to apps/web and must therefore be pinned there.
    expect(rootScripts['storybook:build']).toContain('--filter @workout/web storybook:build');
    expect(PINNED['apps/web']?.['storybook:build']).toBeTypeOf('string');
  });

  it('rejects a no-op wherever a delegated command is pinned', () => {
    // The pins are only worth something if a no-op fails them. This checks the detector
    // against the exact bypass it exists for, rather than trusting it by inspection.
    for (const command of ['true', ':', 'exit 0', 'echo skipped', '# nothing']) {
      expect(
        NO_OPS.some((pattern) => pattern.test(command)),
        `${command} is not recognised as a no-op`,
      ).toBe(true);
    }
    for (const command of [DEFAULT_BUILD, 'next build', 'node scripts/verify.mjs']) {
      expect(
        NO_OPS.some((pattern) => pattern.test(command)),
        `${command} is wrongly treated as a no-op`,
      ).toBe(false);
    }
  });

  it('treats the root manifest as a guardrail, because it owns every gate command', () => {
    const config = JSON.parse(readFileSync(join(ROOT, 'scripts/guardrails.json'), 'utf8')) as {
      guardrailPaths: string[];
      guardrailPathPatterns?: string[];
      productPathPatterns: string[];
    };
    const patterns = (config.guardrailPathPatterns ?? []).map((source) => new RegExp(source));
    const literal = config.guardrailPaths.some((path) =>
      path.endsWith('/') ? 'package.json'.startsWith(path) : path === 'package.json',
    );
    expect(
      literal || patterns.some((pattern) => pattern.test('package.json')),
      'package.json is not classified as a guardrail, so a gate can be no-oped in a product commit',
    ).toBe(true);
  });
});
