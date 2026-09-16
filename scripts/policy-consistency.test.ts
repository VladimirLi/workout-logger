import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * The machine-readable policy and the human-readable policy must agree.
 *
 * Without this, docs/license-policy.md drifts from scripts/license-policy.json and
 * the document stops describing what actually runs - which is how a policy becomes
 * decorative.
 */

const policy = JSON.parse(readFileSync('scripts/license-policy.json', 'utf8')) as {
  allowed: string[];
  rejected: string[];
  reviewRequired: string[];
  exceptions: { component: string; reviewBy: string }[];
};
const document = readFileSync('docs/license-policy.md', 'utf8');

describe('license policy consistency', () => {
  it('documents every allowed license', () => {
    for (const license of policy.allowed) {
      expect(document, `docs/license-policy.md does not mention ${license}`).toContain(license);
    }
  });

  it('lists exactly the ten unconditionally allowed licenses from R-029', () => {
    expect(policy.allowed).toEqual([
      'MIT',
      'ISC',
      'BSD-2-Clause',
      'BSD-3-Clause',
      'Apache-2.0',
      '0BSD',
      'Zlib',
      'BlueOak-1.0.0',
      'Python-2.0',
      'Unlicense',
    ]);
  });

  it('rejects the copyleft and source-available families named in R-029', () => {
    for (const family of ['AGPL', 'SSPL', 'BUSL', 'Elastic-2.0', 'JSON']) {
      expect(policy.rejected.some((license) => license.startsWith(family))).toBe(true);
    }
  });

  it('never lists a license as both allowed and rejected', () => {
    const allowed = new Set(policy.allowed);
    expect(policy.rejected.filter((license) => allowed.has(license))).toEqual([]);
    expect(policy.reviewRequired.filter((license) => allowed.has(license))).toEqual([]);
  });

  it('requires every exception to carry an unexpired review date within 12 months', () => {
    const now = Date.now();
    const twelveMonths = now + 366 * 24 * 60 * 60 * 1000;
    for (const exception of policy.exceptions) {
      const reviewBy = new Date(exception.reviewBy).getTime();
      expect(Number.isNaN(reviewBy), `${exception.component} has no valid reviewBy`).toBe(false);
      expect(reviewBy, `${exception.component} review date has expired`).toBeGreaterThan(now);
      expect(reviewBy, `${exception.component} review date is over 12 months out`).toBeLessThan(
        twelveMonths,
      );
    }
  });
});

describe('guardrail list consistency', () => {
  const guardrails = JSON.parse(readFileSync('scripts/guardrails.json', 'utf8')) as {
    guardrailPaths: string[];
  };
  const engineering = readFileSync('ENGINEERING.md', 'utf8');

  it('documents every guardrail path in ENGINEERING.md', () => {
    for (const path of guardrails.guardrailPaths) {
      expect(engineering, `ENGINEERING.md does not list guardrail path ${path}`).toContain(path);
    }
  });

  it('protects the whole observability package, not just the allowlist', () => {
    // The allowlist is the control; the rest of the package is what enforces it.
    // Guarding one without the other guards neither.
    expect(guardrails.guardrailPaths).toContain('packages/observability/');
  });

  it('excludes the observability package from the product path patterns', () => {
    const patterns = (
      JSON.parse(readFileSync('scripts/guardrails.json', 'utf8')) as {
        productPathPatterns: string[];
      }
    ).productPathPatterns.map((source) => new RegExp(source));

    for (const file of [
      'packages/observability/src/allowlist.ts',
      'packages/observability/src/telemetry.ts',
      'packages/observability/package.json',
    ]) {
      expect(
        patterns.some((pattern) => pattern.test(file)),
        `${file} is classified as product code`,
      ).toBe(false);
    }
    expect(patterns.some((pattern) => pattern.test('packages/domain/src/units.ts'))).toBe(true);
  });
});

describe('design system gate', () => {
  const designSystem = readFileSync('DESIGN_SYSTEM.md', 'utf8');

  it('is still marked NOT DECIDED, which blocks substantive UI work', () => {
    // When the design system is accepted, this test is updated in the same change
    // that records the decision - deliberately, so acceptance is never silent.
    expect(designSystem).toContain('Status: NOT DECIDED');
  });

  it('marks every design area as pending', () => {
    for (const area of [
      'Design tokens',
      'Color',
      'Typography',
      'Spacing',
      'Iconography',
      'Motion',
      'Component inventory',
      'Interaction states',
      'Charts and data display',
      'Content voice',
      'Responsive behavior',
      'Visual-regression baselines',
    ]) {
      expect(designSystem, `DESIGN_SYSTEM.md does not mark "${area}"`).toContain(area);
    }
  });

  it('selects no UI framework anywhere in the web app', () => {
    const webManifest = readFileSync('apps/web/package.json', 'utf8');
    for (const forbidden of ['tailwind', 'shadcn', '@mui/', '@chakra-ui/', 'bootstrap', 'antd']) {
      expect(webManifest.toLowerCase(), `apps/web depends on ${forbidden}`).not.toContain(
        forbidden,
      );
    }
  });
});

describe('gate documentation consistency', () => {
  const verifySource = readFileSync('scripts/verify.mjs', 'utf8');
  const engineering = readFileSync('ENGINEERING.md', 'utf8');
  const gates = [...verifySource.matchAll(/\['([a-z0-9:]+)', \[/g)].map((match) => match[1]);

  it('runs a non-trivial number of gates', () => {
    // Guards against a refactor that empties the list while `pnpm verify` still
    // exits 0 - the same vacuous-success failure the architecture gate had.
    expect(gates.length).toBeGreaterThanOrEqual(14);
  });

  it('documents every gate that verify runs', () => {
    for (const gate of gates) {
      expect(engineering, `ENGINEERING.md does not document \`pnpm ${gate}\``).toContain(
        `pnpm ${gate}`,
      );
    }
  });

  it('includes the checks D-037 requires', () => {
    for (const required of [
      'format:check',
      'lint',
      'typecheck',
      'test',
      'test:integration',
      'build',
      'test:architecture',
      'test:licenses',
      'test:deps',
      'test:secrets',
      'test:migrations',
      'test:e2e',
      'test:a11y',
    ]) {
      expect(gates, `verify does not run ${required}`).toContain(required);
    }
  });
});
