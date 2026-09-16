import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { detectApprovalConditionBreaches } from './distribution.mjs';

/**
 * The licence approval of 2026-09-16 is conditional on the product NOT being
 * distributed and the excepted dependencies remaining UNMODIFIED. Every exception's
 * legal analysis rests on those two facts, so a change to either must fail closed and
 * force new review rather than silently keep the old approval.
 */

const PRIVATE = { path: 'apps/web/package.json', json: { name: '@workout/web', private: true } };
const EXCEPTED = new Set(['axe-core', '@axe-core/playwright', 'caniuse-lite']);

function detect(input: Partial<Parameters<typeof detectApprovalConditionBreaches>[0]>) {
  return detectApprovalConditionBreaches({
    manifests: [PRIVATE],
    workflows: [],
    workspaceYaml: 'packages:\n  - apps/*\n',
    patchFiles: [],
    pnpmfiles: [],
    exceptedNames: EXCEPTED,
    ...input,
  });
}

describe('baseline', () => {
  it('finds nothing in a private, unpatched workspace', () => {
    expect(detect({})).toEqual([]);
  });
});

describe('distribution fails closed', () => {
  it('flags a workspace package that is not marked private', () => {
    const findings = detect({
      manifests: [{ path: 'packages/domain/package.json', json: { name: '@workout/domain' } }],
    });
    expect(findings).toEqual([expect.objectContaining({ condition: 'no-distribution' })]);
  });

  it('flags private: false explicitly', () => {
    const findings = detect({
      manifests: [{ path: 'package.json', json: { name: 'root', private: false } }],
    });
    expect(findings.map((finding) => finding.condition)).toEqual(['no-distribution']);
  });

  it('flags publishConfig even on a private package', () => {
    const findings = detect({
      manifests: [
        {
          path: 'apps/mcp/package.json',
          json: { private: true, publishConfig: { access: 'public' } },
        },
      ],
    });
    expect(findings.map((finding) => finding.condition)).toEqual(['no-distribution']);
  });

  it.each([
    'npm publish',
    'pnpm publish --no-git-checks',
    'pnpm -r publish',
    'yarn npm publish',
    'changeset publish',
    'pnpm changeset publish',
  ])('flags a package script running %s', (command) => {
    const findings = detect({
      manifests: [{ path: 'package.json', json: { private: true, scripts: { release: command } } }],
    });
    expect(findings.map((finding) => finding.condition)).toEqual(['no-distribution']);
  });

  it('flags a workflow step that publishes', () => {
    const findings = detect({
      workflows: [
        { path: '.github/workflows/release.yml', text: 'steps:\n  - run: pnpm publish\n' },
      ],
    });
    expect(findings.map((finding) => finding.condition)).toEqual(['no-distribution']);
  });

  it('flags the changesets action configured to publish', () => {
    const findings = detect({
      workflows: [
        {
          path: '.github/workflows/release.yml',
          text: 'uses: changesets/action@abc\n        with:\n          publish: pnpm release\n',
        },
      ],
    });
    expect(findings.map((finding) => finding.condition)).toEqual(['no-distribution']);
  });

  it('does not flag prose that merely mentions publishing', () => {
    expect(
      detect({
        workflows: [
          {
            path: '.github/workflows/release.yml',
            text: '# it does not publish and does not deploy\n',
          },
        ],
      }),
    ).toEqual([]);
  });

  it.each([
    'electron',
    'electron-builder',
    '@electron-forge/cli',
    '@tauri-apps/cli',
    'pkg',
    '@yao-pkg/pkg',
    'nexe',
    'postject',
  ])('flags the binary or desktop bundler %s', (name) => {
    const findings = detect({
      manifests: [
        {
          path: 'apps/web/package.json',
          json: { private: true, devDependencies: { [name]: '1.0.0' } },
        },
      ],
    });
    expect(findings.map((finding) => finding.condition)).toEqual(['no-distribution']);
  });

  it.each([
    'node --experimental-sea-config sea.json',
    'bun build --compile src/server.ts',
    'deno compile main.ts',
  ])('flags a single-executable build script: %s', (command) => {
    const findings = detect({
      manifests: [
        { path: 'apps/mcp/package.json', json: { private: true, scripts: { bundle: command } } },
      ],
    });
    expect(findings.map((finding) => finding.condition)).toEqual(['no-distribution']);
  });
});

describe('modification of excepted dependencies fails closed', () => {
  it('flags a pnpm patch for an excepted component', () => {
    const findings = detect({
      workspaceYaml:
        'packages:\n  - apps/*\npatchedDependencies:\n  axe-core@4.13.0: patches/axe-core@4.13.0.patch\n',
    });
    expect(findings.map((finding) => finding.condition)).toEqual(['unmodified-dependencies']);
  });

  it('flags a scoped excepted component in patchedDependencies, quoted', () => {
    const findings = detect({
      workspaceYaml: "patchedDependencies:\n  '@axe-core/playwright@4.13.0': patches/x.patch\n",
    });
    expect(findings.map((finding) => finding.condition)).toEqual(['unmodified-dependencies']);
  });

  it('flags an override that replaces an excepted component', () => {
    const findings = detect({
      workspaceYaml: 'overrides:\n  caniuse-lite: npm:some-fork@1.0.0\n',
    });
    expect(findings.map((finding) => finding.condition)).toEqual(['unmodified-dependencies']);
  });

  it('flags a parent>child override targeting an excepted component', () => {
    const findings = detect({ workspaceYaml: 'overrides:\n  next>caniuse-lite: 1.0.0\n' });
    expect(findings.map((finding) => finding.condition)).toEqual(['unmodified-dependencies']);
  });

  it('flags a patch file for an excepted component', () => {
    const findings = detect({ patchFiles: ['patches/caniuse-lite@1.0.30001810.patch'] });
    expect(findings.map((finding) => finding.condition)).toEqual(['unmodified-dependencies']);
  });

  it('flags manifest-level overrides and resolutions for excepted components', () => {
    const findings = detect({
      manifests: [
        {
          path: 'package.json',
          json: {
            private: true,
            overrides: { 'axe-core': '4.0.0' },
            resolutions: { 'caniuse-lite': '1.0.0' },
          },
        },
      ],
    });
    expect(findings.map((finding) => finding.condition)).toEqual([
      'unmodified-dependencies',
      'unmodified-dependencies',
    ]);
  });

  it('flags a pnpmfile, because its hooks can rewrite any dependency manifest', () => {
    const findings = detect({ pnpmfiles: ['.pnpmfile.cjs'] });
    expect(findings.map((finding) => finding.condition)).toEqual(['unmodified-dependencies']);
  });

  it('recognises pnpm patch file naming for scoped packages', () => {
    const findings = detect({ patchFiles: ['patches/@axe-core__playwright@4.13.0.patch'] });
    expect(findings.map((finding) => finding.condition)).toEqual(['unmodified-dependencies']);
  });

  it('ignores overrides and patches for packages that are not excepted', () => {
    expect(
      detect({
        workspaceYaml:
          'overrides:\n  left-pad: 1.3.0\npatchedDependencies:\n  lodash@4.17.21: patches/l.patch\n',
        patchFiles: ['patches/lodash@4.17.21.patch'],
      }),
    ).toEqual([]);
  });

  it('does not mistake a longer package name for an excepted one', () => {
    expect(detect({ workspaceYaml: 'overrides:\n  axe-core-extra: 1.0.0\n' })).toEqual([]);
  });

  it('ignores comments', () => {
    expect(detect({ workspaceYaml: 'overrides:\n  # caniuse-lite: 1.0.0\n' })).toEqual([]);
  });
});

describe('the real repository satisfies the approval conditions', () => {
  it('has no distribution vector and no modified excepted dependency today', async () => {
    const { collectRepositoryInputs } = await import('./distribution.mjs');
    const policy = JSON.parse(readFileSync('scripts/license-policy.json', 'utf8')) as {
      exceptions: { component: string }[];
    };
    const inputs = collectRepositoryInputs(policy.exceptions);
    expect(inputs.workflows.length).toBe(readdirSync('.github/workflows').length);
    expect(detectApprovalConditionBreaches(inputs)).toEqual([]);
  });
});
