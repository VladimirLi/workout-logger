/**
 * Owner licence decisions, pinned.
 *
 * GUARDRAIL FILE. These are records of what the owner actually decided, word for word.
 * scripts/license-policy.json carries a copy for readers, and the licence gate requires
 * that copy to equal the record here exactly. An approval whose wording, conditions,
 * dates, or component set differ from this is not the approval the owner gave, and the
 * gate fails rather than honouring it.
 *
 * Only the owner creates a decision. An agent adds one here only when relaying a decision
 * the owner made, verbatim, and scripts/license-decision-binding.test.ts holds an
 * independent copy so the two cannot drift silently.
 */

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

export const RECORDED_DECISIONS = deepFreeze({
  'LIC-2026-09-16': {
    id: 'LIC-2026-09-16',
    approver: 'Vladimir',
    decidedOn: '2026-09-16',
    reviewBy: '2027-09-16',
    // "through 2027-09-16": the whole of that day, in UTC.
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
  },
});
