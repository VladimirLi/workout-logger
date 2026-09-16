import { describe, expect, it } from 'vitest';
import { evaluateLicenses } from './license-evaluation.mjs';

/**
 * Deterministic coverage of the owner's approval conditions (2026-09-16):
 *
 *   - approval covers the EXACT component@version recorded, never a later version;
 *   - the recorded scope (runtime or dev) must match the tree;
 *   - the ledger must match the tree exactly, so a removed or replaced component is a
 *     material dependency change that needs new review;
 *   - an expired review date or a missing approver blocks.
 *
 * Fixtures stand in for `pnpm licenses list`, so none of this depends on what happens
 * to be installed.
 */

const TODAY = new Date('2026-09-16T00:00:00Z');

const POLICY_BASE = {
  allowed: ['MIT', 'ISC', 'Apache-2.0'],
  rejected: ['AGPL-3.0-only'],
  reviewRequired: ['MPL-2.0'],
};

function exception(component: string, overrides: Record<string, unknown> = {}) {
  return {
    component,
    spdx: 'MPL-2.0',
    scope: 'dev',
    use: 'Accessibility gate.',
    linkage: 'Dev only, never bundled.',
    noAlternative: 'None comparable.',
    obligations: 'Unmodified, not distributed.',
    replacementCost: 'Lose the accessibility gate.',
    approver: 'Vladimir',
    reviewBy: '2027-09-16',
    ...overrides,
  };
}

function listing(entries: [string, string, string][]) {
  const byLicense: Record<string, { name: string; versions: string[] }[]> = {};
  for (const [license, name, version] of entries) {
    byLicense[license] ??= [];
    byLicense[license].push({ name, versions: [version] });
  }
  return byLicense;
}

/** A recorded owner decision covering exactly the given components. */
function decision(components: string[], overrides: Record<string, unknown> = {}) {
  return {
    id: 'LIC-2026-09-16',
    approver: 'Vladimir',
    decidedOn: '2026-09-16',
    reviewBy: '2027-09-16',
    decision: 'Approve with the stated conditions.',
    conditions: ['private-hosting-only'],
    components,
    ...overrides,
  };
}

function evaluate(
  exceptions: ReturnType<typeof exception>[],
  runtime: [string, string, string][],
  dev: [string, string, string][],
  approvals = [decision(exceptions.map((entry) => entry.component))],
) {
  return evaluateLicenses({
    policy: { ...POLICY_BASE, exceptions, approvals },
    runtime: listing(runtime),
    dev: listing(dev),
    today: TODAY,
  });
}

const clean = (result: ReturnType<typeof evaluate>) =>
  Object.values(result.violations).every((list) => list.length === 0) &&
  result.pendingOwner.length === 0;

describe('an approved exception covers exactly what was approved', () => {
  it('passes when component, version and scope all match', () => {
    const result = evaluate(
      [exception('axe-core@4.13.0')],
      [],
      [['MPL-2.0', 'axe-core', '4.13.0']],
    );
    expect(clean(result)).toBe(true);
  });

  it('does not cover a later version of the same component', () => {
    const result = evaluate(
      [exception('axe-core@4.13.0')],
      [],
      [['MPL-2.0', 'axe-core', '4.13.1']],
    );

    expect(clean(result)).toBe(false);
    expect(result.violations.review.map((record) => record.key)).toContain('axe-core@4.13.1');
  });

  it('treats the approved version disappearing as a material change needing review', () => {
    const result = evaluate(
      [exception('axe-core@4.13.0')],
      [],
      [['MPL-2.0', 'axe-core', '4.13.1']],
    );
    expect(result.violations.staleEntry.map((record) => record.key)).toEqual(['axe-core@4.13.0']);
  });

  it('does not cover a different component with the same licence', () => {
    const result = evaluate(
      [exception('axe-core@4.13.0')],
      [],
      [
        ['MPL-2.0', 'axe-core', '4.13.0'],
        ['MPL-2.0', 'some-other-mpl-package', '1.0.0'],
      ],
    );
    expect(result.violations.review.map((record) => record.key)).toEqual([
      'some-other-mpl-package@1.0.0',
    ]);
  });
});

describe('scope is pinned', () => {
  it('fails when a dev-approved component reaches the runtime tree', () => {
    const result = evaluate(
      [exception('axe-core@4.13.0', { scope: 'dev' })],
      [['MPL-2.0', 'axe-core', '4.13.0']],
      [],
    );
    expect(result.violations.scopeMismatch).toEqual([
      expect.objectContaining({ key: 'axe-core@4.13.0', recorded: 'dev', actual: 'runtime' }),
    ]);
  });

  it('treats presence in both trees as runtime, the wider scope', () => {
    const result = evaluate(
      [exception('axe-core@4.13.0', { scope: 'dev' })],
      [['MPL-2.0', 'axe-core', '4.13.0']],
      [['MPL-2.0', 'axe-core', '4.13.0']],
    );
    expect(result.violations.scopeMismatch.map((record) => record.actual)).toEqual(['runtime']);
  });

  it('fails when a runtime-approved component is recorded but only found in dev', () => {
    const result = evaluate(
      [exception('caniuse-lite@1.0.0', { scope: 'runtime', spdx: 'MPL-2.0' })],
      [],
      [['MPL-2.0', 'caniuse-lite', '1.0.0']],
    );
    expect(result.violations.scopeMismatch.map((record) => record.recorded)).toEqual(['runtime']);
  });

  it('passes a runtime approval found in the runtime tree', () => {
    const result = evaluate(
      [exception('caniuse-lite@1.0.0', { scope: 'runtime' })],
      [['MPL-2.0', 'caniuse-lite', '1.0.0']],
      [],
    );
    expect(clean(result)).toBe(true);
  });

  it('rejects an exception whose scope is neither runtime nor dev', () => {
    const result = evaluate(
      [exception('axe-core@4.13.0', { scope: 'everywhere' })],
      [],
      [['MPL-2.0', 'axe-core', '4.13.0']],
    );
    expect(clean(result)).toBe(false);
  });
});

describe('approval state', () => {
  it('blocks on a pending approver', () => {
    const result = evaluate(
      [exception('axe-core@4.13.0', { approver: 'pending-owner-approval' })],
      [],
      [['MPL-2.0', 'axe-core', '4.13.0']],
    );
    expect(result.pendingOwner.map((record) => record.key)).toEqual(['axe-core@4.13.0']);
    expect(Object.values(result.violations).flat()).toEqual([]);
  });

  it('fails an expired review date as a violation, not a pending approval', () => {
    const result = evaluate(
      [exception('axe-core@4.13.0', { reviewBy: '2026-09-15' })],
      [],
      [['MPL-2.0', 'axe-core', '4.13.0']],
    );
    expect(result.violations.badException.map((record) => record.reason)).toEqual(['expired']);
  });

  const onDay = (iso: string) =>
    evaluateLicenses({
      policy: {
        ...POLICY_BASE,
        exceptions: [exception('axe-core@4.13.0')],
        approvals: [decision(['axe-core@4.13.0'])],
      },
      runtime: {},
      dev: listing([['MPL-2.0', 'axe-core', '4.13.0']]),
      today: new Date(iso),
    });

  it('keeps passing through the whole last day of the approval period', () => {
    // "Through 2027-09-16" includes that day, so it must not expire at midnight
    // at the START of it.
    expect(Object.values(onDay('2027-09-16T00:00:00Z').violations).flat()).toEqual([]);
    expect(Object.values(onDay('2027-09-16T23:59:59.999Z').violations).flat()).toEqual([]);
  });

  it('fails from the first instant after the approval period ends', () => {
    expect(
      onDay('2027-09-17T00:00:00Z').violations.badException.map((record) => record.reason),
    ).toEqual(['expired']);
  });
});

describe('an approver name counts only with a recorded decision behind it', () => {
  /**
   * Typing an owner's name onto an entry must not be enough to approve it. Each named
   * approver must be backed by a recorded decision that lists the exact component.
   * Otherwise a thirteenth entry could be "approved" by copying the name from the
   * other twelve, which is precisely the fabrication the owner's sign-off rules out.
   */
  const tree: [string, string, string][] = [['MPL-2.0', 'axe-core', '4.13.0']];

  it('fails a named approver with no recorded decision at all', () => {
    const result = evaluate([exception('axe-core@4.13.0')], [], tree, []);
    expect(result.violations.badException.map((record) => record.reason)).toEqual([
      'no_recorded_decision',
    ]);
  });

  it('fails when the recorded decision does not list this exact component', () => {
    const result = evaluate([exception('axe-core@4.13.0')], [], tree, [
      decision(['axe-core@4.12.0']),
    ]);
    expect(result.violations.badException.map((record) => record.reason)).toEqual([
      'no_recorded_decision',
    ]);
  });

  it('fails when the decision was made by someone else', () => {
    const result = evaluate([exception('axe-core@4.13.0')], [], tree, [
      decision(['axe-core@4.13.0'], { approver: 'Someone Else' }),
    ]);
    expect(result.violations.badException.map((record) => record.reason)).toEqual([
      'no_recorded_decision',
    ]);
  });

  it('fails an entry whose review date outlasts the decision that approved it', () => {
    const result = evaluate([exception('axe-core@4.13.0', { reviewBy: '2027-09-16' })], [], tree, [
      decision(['axe-core@4.13.0'], { reviewBy: '2027-03-01' }),
    ]);
    expect(result.violations.badException.map((record) => record.reason)).toEqual([
      'outlasts_decision',
    ]);
  });

  it('fails a decision with no conditions recorded', () => {
    const result = evaluate([exception('axe-core@4.13.0')], [], tree, [
      decision(['axe-core@4.13.0'], { conditions: [] }),
    ]);
    expect(result.violations.badException.map((record) => record.reason)).toEqual([
      'no_recorded_decision',
    ]);
  });
});

describe('approval conditions', () => {
  it('turns a reported condition breach into a violation', () => {
    const result = evaluateLicenses({
      policy: {
        ...POLICY_BASE,
        exceptions: [exception('axe-core@4.13.0')],
        approvals: [decision(['axe-core@4.13.0'])],
      },
      runtime: {},
      dev: listing([['MPL-2.0', 'axe-core', '4.13.0']]),
      today: TODAY,
      conditionBreaches: [
        { condition: 'no-distribution', path: 'package.json', detail: 'not private' },
      ],
    });
    expect(result.violations.conditionBreach).toHaveLength(1);
  });
});

describe('the ledger must match the tree exactly', () => {
  it('fails on an approved component that is no longer present', () => {
    const result = evaluate([exception('axe-core@4.13.0')], [], []);
    expect(result.violations.staleEntry.map((record) => record.key)).toEqual(['axe-core@4.13.0']);
  });

  it('fails on a duplicate ledger entry', () => {
    const result = evaluate(
      [exception('axe-core@4.13.0'), exception('axe-core@4.13.0')],
      [],
      [['MPL-2.0', 'axe-core', '4.13.0']],
    );
    expect(result.violations.duplicateEntry.map((record) => record.key)).toEqual([
      'axe-core@4.13.0',
    ]);
  });

  it('fails when the recorded SPDX expression no longer matches the installed package', () => {
    const result = evaluate(
      [exception('axe-core@4.13.0', { spdx: 'MPL-2.0' })],
      [],
      [['MPL-2.0 OR MIT', 'axe-core', '4.13.0']],
    );
    // MPL-2.0 OR MIT is allowed on its own, so the exception is now unnecessary and
    // the ledger no longer describes the tree.
    expect(result.violations.staleEntry.map((record) => record.key)).toEqual(['axe-core@4.13.0']);
  });

  it('fails when an excepted package changes to a different non-allowed licence', () => {
    const result = evaluate(
      [exception('axe-core@4.13.0', { spdx: 'MPL-2.0' })],
      [],
      [['AGPL-3.0-only', 'axe-core', '4.13.0']],
    );
    expect(result.violations.licenseChanged).toEqual([
      expect.objectContaining({
        key: 'axe-core@4.13.0',
        recorded: 'MPL-2.0',
        actual: 'AGPL-3.0-only',
      }),
    ]);
  });
});

describe('ordinary policy behaviour is unchanged', () => {
  it('passes allowed licences without any exception', () => {
    expect(clean(evaluate([], [['MIT', 'left-pad', '1.0.0']], []))).toBe(true);
  });

  it('rejects a prohibited licence with no exception', () => {
    const result = evaluate([], [['AGPL-3.0-only', 'bad', '1.0.0']], []);
    expect(result.violations.rejected.map((record) => record.key)).toEqual(['bad@1.0.0']);
  });

  it('treats an unknown licence as a violation', () => {
    const result = evaluate([], [['CC-BY-4.0', 'data', '1.0.0']], []);
    expect(result.violations.unknown.map((record) => record.key)).toEqual(['data@1.0.0']);
  });
});
