import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Dependency lifecycle-script permissions, checked against what pnpm actually applies.
 *
 * package.json pins pnpm 11.5.2, whose build-permission reader recognises only
 * `allowBuilds` and `dangerouslyAllowAllBuilds`. The workspace still declared the
 * pnpm 10 setting `onlyBuiltDependencies`, which pnpm 11 does not apply to builds at all:
 * the file described an allowlist that did not exist. Reading the file back would have
 * agreed with it, so these checks ask pnpm for the EFFECTIVE configuration instead.
 *
 * Minimum necessary permission is established from the installed tree, not assumed:
 * every package in the lockfile's installed set is scanned for install lifecycle scripts,
 * and the allowBuilds map must decide exactly those packages - no undecided build, and no
 * standing grant for a package that is not there. Today that set is empty.
 */

const REMOVED_OR_UNSAFE_KEYS = [
  'onlyBuiltDependencies',
  'onlyBuiltDependenciesFile',
  'neverBuiltDependencies',
  'ignoredBuiltDependencies',
  'dangerouslyAllowAllBuilds',
];

const LIFECYCLE_HOOKS = ['preinstall', 'install', 'postinstall'];

function pnpmConfig(key: string): unknown {
  const raw = execFileSync('pnpm', ['config', 'get', '--json', key], { encoding: 'utf8' }).trim();
  return raw === '' || raw === 'undefined' ? undefined : JSON.parse(raw);
}

function topLevelKeys(yaml: string): string[] {
  return yaml
    .split('\n')
    .map((line) => /^([A-Za-z][\w-]*):/.exec(line)?.[1])
    .filter((key): key is string => key !== undefined);
}

/** Every installed package in the lockfile's resolved set, with its on-disk path. */
function installedPackages(): { key: string; name: string; path: string }[] {
  const packages = new Map<string, { key: string; name: string; path: string }>();
  for (const scope of ['--prod', '--dev']) {
    let raw: string;
    try {
      raw = execFileSync('pnpm', ['licenses', 'list', '--json', '--long', scope], {
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
      });
    } catch (error) {
      raw = String((error as { stdout?: string }).stdout ?? '');
    }
    const listing = JSON.parse(raw) as Record<
      string,
      { name: string; versions: string[]; paths: string[] }[]
    >;
    for (const entries of Object.values(listing)) {
      for (const entry of entries) {
        entry.versions.forEach((version, index) => {
          const path = entry.paths[index];
          if (path)
            packages.set(`${entry.name}@${version}`, {
              key: `${entry.name}@${version}`,
              name: entry.name,
              path,
            });
        });
      }
    }
  }
  return [...packages.values()];
}

describe('the workspace declares build permissions in the form pnpm 11 applies', () => {
  const yaml = readFileSync('pnpm-workspace.yaml', 'utf8');
  const keys = topLevelKeys(yaml);

  it('pins a pnpm major that uses allowBuilds', () => {
    const { packageManager } = JSON.parse(readFileSync('package.json', 'utf8')) as {
      packageManager: string;
    };
    expect(packageManager).toMatch(/^pnpm@11\./);
  });

  it.each(REMOVED_OR_UNSAFE_KEYS)('does not declare %s', (key) => {
    expect(keys).not.toContain(key);
  });

  it('declares allowBuilds and strictDepBuilds explicitly rather than relying on defaults', () => {
    expect(keys).toContain('allowBuilds');
    expect(keys).toContain('strictDepBuilds');
  });
});

describe('the effective configuration, as pnpm itself resolves it', () => {
  it('fails installs on any build script that has not been decided', () => {
    expect(pnpmConfig('strictDepBuilds')).toBe(true);
  });

  it('never allows all builds wholesale', () => {
    expect(pnpmConfig('dangerouslyAllowAllBuilds')).not.toBe(true);
  });

  it('resolves allowBuilds to an explicit map of booleans', () => {
    const allowBuilds = pnpmConfig('allowBuilds');
    expect(allowBuilds).toBeTypeOf('object');
    expect(allowBuilds).not.toBeNull();
    expect(Array.isArray(allowBuilds)).toBe(false);
    for (const [name, decision] of Object.entries(allowBuilds as object)) {
      expect(typeof decision, `allowBuilds.${name}`).toBe('boolean');
    }
  });
});

describe('permissions are exactly the minimum the installed tree needs', () => {
  const allowBuilds = (pnpmConfig('allowBuilds') ?? {}) as Record<string, boolean>;
  const packages = installedPackages();

  const withLifecycleScripts = packages
    .filter(({ path }) => {
      const manifest = JSON.parse(readFileSync(join(path, 'package.json'), 'utf8')) as {
        scripts?: Record<string, string>;
      };
      return LIFECYCLE_HOOKS.some((hook) => manifest.scripts?.[hook]);
    })
    .map(({ name }) => name)
    .sort();

  it('scans a real, non-trivial installed tree', () => {
    expect(packages.length).toBeGreaterThan(100);
  });

  it('decides every installed package that has a lifecycle script', () => {
    for (const name of withLifecycleScripts) {
      expect(
        Object.hasOwn(allowBuilds, name),
        `${name} runs install scripts but is undecided`,
      ).toBe(true);
    }
  });

  it('holds no standing grant for a package that is not installed with a lifecycle script', () => {
    const granted = Object.entries(allowBuilds)
      .filter(([, allowed]) => allowed)
      .map(([name]) => name);
    for (const name of granted) {
      expect(
        withLifecycleScripts,
        `allowBuilds grants ${name}, which needs no build here`,
      ).toContain(name);
    }
  });

  it('matches the recorded expectation for this tree: no dependency needs to build', () => {
    // Recorded rather than derived, so a new build-script dependency is a visible change
    // to this test and to pnpm-workspace.yaml, both guardrail files.
    expect(withLifecycleScripts).toEqual([]);
    expect(allowBuilds).toEqual({});
  });
});
