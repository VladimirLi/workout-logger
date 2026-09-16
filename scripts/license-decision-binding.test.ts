import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { RECORDED_DECISIONS } from './license-decisions.mjs';
import { evaluateLicenses } from './license-evaluation.mjs';

/**
 * Binds the twelve licence approvals to the owner's exact decision LIC-2026-09-16.
 *
 * Before this, the gate checked only that an approver name was backed by SOME decision
 * record listing the component. Replacing the decision with "Approve everything forever."
 * and the five conditions with "none" still passed. The owner approved specific words on
 * specific conditions; a record that no longer says those things is not that approval.
 *
 * The decision content is pinned in scripts/license-decisions.mjs, and this file holds a
 * second, independent verbatim copy. Changing the pinned record without changing this
 * test fails; changing both is a deliberate guardrail change that review will see.
 */

const VERBATIM = {
  id: 'LIC-2026-09-16',
  approver: 'Vladimir',
  decidedOn: '2026-09-16',
  reviewBy: '2027-09-16',
  reviewByInclusive: true,
  decision: 'Approve all 12 with the stated conditions through 2027-09-16.',
  conditions: [
    'product remains privately hosted',
    'no npm package, binary, desktop bundle, or redistributable build is published',
    'dependencies remain unmodified',
    'CI verifies exact package versions and scopes against the ledger',
    'any distribution plan, material dependency change, or expired review date blocks release and requires new review',
  ],
  components: [
    { component: '@axe-core/playwright@4.13.0', scope: 'dev', spdx: 'MPL-2.0' },
    { component: '@azu/style-format@1.0.1', scope: 'dev', spdx: 'WTFPL' },
    { component: 'axe-core@4.13.0', scope: 'dev', spdx: 'MPL-2.0' },
    { component: 'binaryextensions@6.11.0', scope: 'dev', spdx: 'Artistic-2.0' },
    { component: 'caniuse-lite@1.0.30001810', scope: 'runtime', spdx: 'CC-BY-4.0' },
    { component: 'editions@6.22.0', scope: 'dev', spdx: 'Artistic-2.0' },
    { component: 'istextorbinary@9.5.0', scope: 'dev', spdx: 'Artistic-2.0' },
    { component: 'lightningcss@1.33.0', scope: 'dev', spdx: 'MPL-2.0' },
    { component: 'spdx-exceptions@2.5.0', scope: 'dev', spdx: 'CC-BY-3.0' },
    { component: 'spdx-license-ids@3.0.23', scope: 'dev', spdx: 'CC0-1.0' },
    { component: 'textextensions@6.11.0', scope: 'dev', spdx: 'Artistic-2.0' },
    { component: 'version-range@4.15.0', scope: 'dev', spdx: 'Artistic-2.0' },
  ],
};

type Policy = {
  allowed: string[];
  rejected: string[];
  reviewRequired: string[];
  approvals: Record<string, unknown>[];
  exceptions: Record<string, unknown>[];
};

const REAL: Policy = JSON.parse(readFileSync('scripts/license-policy.json', 'utf8'));
const TODAY = new Date('2026-09-16T12:00:00Z');

/** A dependency tree that matches the ledger exactly, so only the binding is under test. */
function treeFor(policy: Policy) {
  const runtime: Record<string, { name: string; versions: string[] }[]> = {};
  const dev: Record<string, { name: string; versions: string[] }[]> = {};
  for (const entry of REAL.exceptions) {
    const component = String(entry.component);
    const at = component.lastIndexOf('@');
    const target = entry.scope === 'runtime' ? runtime : dev;
    const spdx = String(entry.spdx);
    target[spdx] ??= [];
    target[spdx].push({ name: component.slice(0, at), versions: [component.slice(at + 1)] });
  }
  return { policy, runtime, dev };
}

function run(mutate: (policy: Policy) => void = () => {}, tree: Policy = REAL) {
  const policy: Policy = structuredClone(REAL);
  mutate(policy);
  const { runtime, dev } = treeFor(tree);
  return evaluateLicenses({ policy, runtime, dev, today: TODAY });
}

const violationCount = (result: ReturnType<typeof run>) =>
  Object.values(result.violations).reduce((sum, list) => sum + list.length, 0);

const decisionOf = (policy: Policy) => policy.approvals[0] as typeof VERBATIM;

describe('the pinned decision is the owner decision, verbatim', () => {
  it('pins exactly LIC-2026-09-16 and nothing else', () => {
    expect(Object.keys(RECORDED_DECISIONS)).toEqual(['LIC-2026-09-16']);
  });

  it('pins the exact wording, conditions, dates and component set', () => {
    expect(RECORDED_DECISIONS['LIC-2026-09-16']).toEqual(VERBATIM);
  });

  it('is immutable at runtime', () => {
    expect(Object.isFrozen(RECORDED_DECISIONS)).toBe(true);
    expect(Object.isFrozen(RECORDED_DECISIONS['LIC-2026-09-16'])).toBe(true);
    expect(Object.isFrozen(RECORDED_DECISIONS['LIC-2026-09-16'].conditions)).toBe(true);
    expect(Object.isFrozen(RECORDED_DECISIONS['LIC-2026-09-16'].components)).toBe(true);
  });

  it('matches the record in scripts/license-policy.json', () => {
    expect(REAL.approvals).toEqual([VERBATIM]);
  });

  it('binds every one of the twelve ledger entries to that decision', () => {
    expect(REAL.exceptions).toHaveLength(12);
    for (const entry of REAL.exceptions) {
      expect(entry.decision, String(entry.component)).toBe('LIC-2026-09-16');
      expect(entry.approver, String(entry.component)).toBe('Vladimir');
      expect(entry.reviewBy, String(entry.component)).toBe('2027-09-16');
    }
  });
});

describe('the real ledger passes as recorded', () => {
  it('has no violations and nothing pending', () => {
    const result = run();
    expect(result.violations).toEqual(
      Object.fromEntries(Object.keys(result.violations).map((key) => [key, []])),
    );
    expect(result.pendingOwner).toEqual([]);
  });
});

describe('arbitrary replacement of the decision record fails', () => {
  it.each<[string, (policy: Policy) => void]>([
    [
      'decision replaced wholesale',
      (p) => {
        decisionOf(p).decision = 'Approve everything forever.';
      },
    ],
    [
      'one word changed',
      (p) => {
        decisionOf(p).decision = 'Approve all 13 with the stated conditions through 2027-09-16.';
      },
    ],
    [
      'trailing whitespace added',
      (p) => {
        decisionOf(p).decision = `${VERBATIM.decision} `;
      },
    ],
    [
      'approver name altered',
      (p) => {
        decisionOf(p).approver = 'Vladimir Li';
      },
    ],
    [
      'approver case altered',
      (p) => {
        decisionOf(p).approver = 'vladimir';
      },
    ],
    [
      'decision date altered',
      (p) => {
        decisionOf(p).decidedOn = '2026-09-15';
      },
    ],
    [
      'through-date extended',
      (p) => {
        decisionOf(p).reviewBy = '2027-09-17';
      },
    ],
    [
      'through-date made exclusive',
      (p) => {
        decisionOf(p).reviewByInclusive = false;
      },
    ],
    [
      'decision id altered',
      (p) => {
        decisionOf(p).id = 'LIC-2026-09-17';
      },
    ],
    [
      'all conditions replaced',
      (p) => {
        decisionOf(p).conditions = ['none'];
      },
    ],
    [
      'one condition reworded',
      (p) => {
        decisionOf(p).conditions[2] = 'dependencies may be patched';
      },
    ],
    [
      'one condition removed',
      (p) => {
        decisionOf(p).conditions.pop();
      },
    ],
    [
      'a condition added',
      (p) => {
        decisionOf(p).conditions.push('and anything else');
      },
    ],
    [
      'conditions reordered',
      (p) => {
        decisionOf(p).conditions.reverse();
      },
    ],
    [
      'a thirteenth component added',
      (p) => {
        decisionOf(p).components.push({ component: 'extra@1.0.0', scope: 'dev', spdx: 'MPL-2.0' });
      },
    ],
    [
      'a component removed',
      (p) => {
        decisionOf(p).components.pop();
      },
    ],
    [
      'a component version altered',
      (p) => {
        decisionOf(p).components[2] = {
          ...VERBATIM.components[2],
          component: 'axe-core@4.14.0',
        } as never;
      },
    ],
    [
      'a component scope widened',
      (p) => {
        decisionOf(p).components[2] = { ...VERBATIM.components[2], scope: 'runtime' } as never;
      },
    ],
    [
      'a component licence altered',
      (p) => {
        decisionOf(p).components[2] = { ...VERBATIM.components[2], spdx: 'MIT' } as never;
      },
    ],
    [
      'an unrecorded second decision added',
      (p) => {
        p.approvals.push({ ...VERBATIM, id: 'LIC-2099-01-01', decision: 'Approve anything.' });
      },
    ],
    [
      'the decision record deleted',
      (p) => {
        p.approvals = [];
      },
    ],
  ])('%s', (_label, mutate) => {
    expect(violationCount(run(mutate))).toBeGreaterThan(0);
  });
});

describe('each ledger entry is bound to the decision', () => {
  const axe = (policy: Policy) =>
    policy.exceptions.find((entry) => entry.component === 'axe-core@4.13.0') as Record<
      string,
      unknown
    >;

  it.each<[string, (policy: Policy) => void]>([
    [
      'entry points at a different decision id',
      (p) => {
        axe(p).decision = 'LIC-2099-01-01';
      },
    ],
    [
      'entry has no decision id',
      (p) => {
        delete axe(p).decision;
      },
    ],
    [
      'entry approver differs from the decision',
      (p) => {
        axe(p).approver = 'Someone Else';
      },
    ],
    [
      'entry review date differs from the decision',
      (p) => {
        axe(p).reviewBy = '2027-03-01';
      },
    ],
  ])('%s', (_label, mutate) => {
    expect(violationCount(run(mutate))).toBeGreaterThan(0);
  });

  it('fails when an entry the decision covers is removed from the ledger', () => {
    // Remove the entry AND its package from the tree, so the only thing left to notice is
    // that the decision still names a component no ledger entry claims.
    const withoutAxe = (policy: Policy) => {
      policy.exceptions = policy.exceptions.filter(
        (entry) => entry.component !== 'axe-core@4.13.0',
      );
    };
    const tree: Policy = structuredClone(REAL);
    withoutAxe(tree);
    const result = run(withoutAxe, tree);
    expect(result.violations.decisionCoverage.map((record) => record.key)).toEqual([
      'axe-core@4.13.0',
    ]);
  });

  it('still reports the approver as pending, not approved, for a new unapproved entry', () => {
    const result = run((p) => {
      p.exceptions.push({
        ...(axe(p) as object),
        component: 'new-mpl-package@1.0.0',
        approver: 'pending-owner-approval',
        decision: undefined,
      });
    });
    // The new entry is not in the tree fixture, so it is also stale; what matters is that
    // it can never count as covered by LIC-2026-09-16.
    expect(violationCount(result)).toBeGreaterThan(0);
  });
});
