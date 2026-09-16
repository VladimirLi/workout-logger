import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  EXIT_BLOCKED_ON_OWNER,
  EXIT_POLICY_VIOLATION,
  evaluateException,
} from './license-exceptions.mjs';

/**
 * An exception with no named approver is an unreviewed legal conclusion. The gate
 * used to honour those so the build was not blocked on a signature, and printed
 * them as a reminder. A reminder is not a gate: it turns "nobody has approved these"
 * into a line of output that scrolls past.
 *
 * R-029 requires a named approver. So the gate fails closed, with a distinct exit
 * code that says WHY, and prints the decision ledger the owner needs.
 */

const TODAY = new Date('2026-09-16T00:00:00Z');

const COMPLETE = {
  component: 'example@1.0.0',
  spdx: 'MPL-2.0',
  scope: 'dev',
  use: 'Test tooling.',
  linkage: 'Dev only, never bundled.',
  noAlternative: 'None with comparable coverage.',
  obligations: 'Unmodified, not distributed.',
  replacementCost: 'Lose the accessibility gate.',
  approver: 'Vladimir Li',
  reviewBy: '2027-09-16',
};

describe('exception completeness', () => {
  it('accepts a complete, approved, unexpired exception', () => {
    expect(evaluateException(COMPLETE, TODAY)).toEqual({ status: 'approved' });
  });

  it.each([
    'spdx',
    'scope',
    'use',
    'linkage',
    'noAlternative',
    'obligations',
    'replacementCost',
    'approver',
    'reviewBy',
  ])('rejects an exception missing %s', (field) => {
    const { [field]: _omitted, ...incomplete } = COMPLETE as Record<string, unknown>;
    expect(evaluateException(incomplete, TODAY).status).toBe('incomplete');
  });

  it('treats a date-only review date as valid through the end of that day', () => {
    const lastDay = { ...COMPLETE, reviewBy: '2026-09-16' };
    expect(evaluateException(lastDay, new Date('2026-09-16T23:59:59.999Z')).status).toBe(
      'approved',
    );
    expect(evaluateException(lastDay, new Date('2026-09-17T00:00:00Z')).status).toBe('expired');
  });

  it('rejects a review date that is not a plain calendar date', () => {
    expect(evaluateException({ ...COMPLETE, reviewBy: '2027-09-16T12:00:00Z' }, TODAY).status).toBe(
      'incomplete',
    );
  });

  it('rejects an expired review date', () => {
    expect(evaluateException({ ...COMPLETE, reviewBy: '2020-01-01' }, TODAY).status).toBe(
      'expired',
    );
  });

  it('rejects a review date more than twelve months out', () => {
    expect(evaluateException({ ...COMPLETE, reviewBy: '2099-01-01' }, TODAY).status).toBe(
      'review_too_far',
    );
  });

  it('blocks on a pending approver rather than honouring it', () => {
    expect(evaluateException({ ...COMPLETE, approver: 'pending-owner-approval' }, TODAY)).toEqual({
      status: 'pending_owner',
    });
  });

  it('blocks on an empty or placeholder approver', () => {
    for (const approver of ['', '   ', 'TBD', 'tbd', 'unknown', 'agent']) {
      expect(evaluateException({ ...COMPLETE, approver }, TODAY).status).not.toBe('approved');
    }
  });
});

describe('the gate fails closed on unapproved exceptions', () => {
  function runGate() {
    try {
      const stdout = execFileSync('node', ['scripts/license-check.mjs'], { encoding: 'utf8' });
      return { code: 0, output: stdout };
    } catch (error) {
      const err = error as { status?: number; stdout?: string; stderr?: string };
      return { code: err.status ?? 1, output: `${err.stdout ?? ''}${err.stderr ?? ''}` };
    }
  }

  it('exits with the owner-approval code while any exception is unapproved', () => {
    const policy = JSON.parse(readFileSync('scripts/license-policy.json', 'utf8')) as {
      exceptions: { approver: string }[];
    };
    const pending = policy.exceptions.filter(
      (exception) => exception.approver === 'pending-owner-approval',
    );

    const { code, output } = runGate();

    if (pending.length === 0) {
      expect(code).toBe(0);
      return;
    }

    expect(code).toBe(EXIT_BLOCKED_ON_OWNER);
    expect(code).not.toBe(EXIT_POLICY_VIOLATION);
    expect(output).toContain('BLOCKED: owner approval required');
    expect(output).toContain('docs/license-policy.md');
  });

  it('names every unapproved component so the owner can decide from the output', () => {
    const policy = JSON.parse(readFileSync('scripts/license-policy.json', 'utf8')) as {
      exceptions: { component: string; approver: string }[];
    };
    const pending = policy.exceptions.filter(
      (exception) => exception.approver === 'pending-owner-approval',
    );
    if (pending.length === 0) return;

    const { output } = runGate();
    for (const exception of pending) {
      expect(output).toContain(exception.component);
    }
  });

  it('uses distinct exit codes for a policy violation and an owner block', () => {
    expect(EXIT_POLICY_VIOLATION).not.toBe(EXIT_BLOCKED_ON_OWNER);
  });
});
