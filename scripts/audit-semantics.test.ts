import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import { AUDIT_ARGS, auditConfigProblem, interpretAudit } from './audit-report.mjs';

/**
 * pnpm audit exit semantics and exact per-severity agreement.
 *
 * Accepted semantics, read from pnpm 11.5.2's own audit handler and confirmed by running
 * it (see fixtures):
 *
 *   - metadata.vulnerabilities[s] is incremented exactly once per advisory of severity s;
 *     one advisory with five dependency paths still counts once.
 *   - With --json, `advisories` keeps only entries at or above --audit-level, and ignored
 *     GHSAs are removed, but `metadata` is copied through UNCHANGED. So advisories and
 *     counts agree exactly only when nothing is filtered: the gate pins
 *     `--audit-level info` and treats any ignore list as a failure.
 *   - With --json, the exit code is 1 when any advisory remains, otherwise 0. A registry
 *     failure also exits 1, with an error envelope instead of a report.
 *
 * So exactly two statuses are meaningful - 0 with no advisories, 1 with at least one -
 * and a completed report's per-severity counts must equal its advisory entries. Anything
 * else is an unexplained status or a contradictory report, and fails closed.
 *
 * Fixtures are pnpm's real output. audit-completed-findings.json came from a local
 * advisory registry serving four synthetic advisories (info, moderate, high, critical)
 * against packages that really are installed; audit-default-level-filters-info.json is
 * the same run without --audit-level info, showing the info advisory counted in metadata
 * but filtered out of advisories.
 */

const CLEAN = readFileSync('scripts/fixtures/audit-completed-clean.json', 'utf8');
const FINDINGS = readFileSync('scripts/fixtures/audit-completed-findings.json', 'utf8');
const DEFAULT_LEVEL = readFileSync(
  'scripts/fixtures/audit-default-level-filters-info.json',
  'utf8',
);

const run = (status: number | null, stdout: string) =>
  interpretAudit({ status, signal: null, stdout, stderr: '' });

type Report = {
  advisories: Record<string, { severity: string; module_name: string; title: string }>;
  metadata: { vulnerabilities: Record<string, number> };
};

function mutate(source: string, change: (report: Report) => void): string {
  const report = JSON.parse(source) as Report;
  change(report);
  return JSON.stringify(report);
}

/** A single consistent moderate advisory: counts and entries agree. */
const ONE_MODERATE = mutate(CLEAN, (report) => {
  report.advisories = {
    1: {
      ...(Object.values(JSON.parse(FINDINGS).advisories)[0] as object),
      severity: 'moderate',
    } as never,
  };
  report.metadata.vulnerabilities.moderate = 1;
});

describe('the invocation is pinned so the report is never filtered', () => {
  it('runs pnpm audit with JSON output at the info audit level', () => {
    expect([...AUDIT_ARGS]).toEqual(['audit', '--json', '--audit-level', 'info']);
  });

  it('rejects the real default-level report, whose metadata counts an advisory it omits', () => {
    const result = run(1, DEFAULT_LEVEL);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('contradictory_report');
    expect(result.detail).toContain('info');
  });
});

describe('real completed reports', () => {
  it('accepts the real clean report with exit 0', () => {
    expect(run(0, CLEAN).ok).toBe(true);
  });

  it('accepts the real findings report with exit 1 and blocks exactly high and critical', () => {
    const result = run(1, FINDINGS);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.advisoryCount).toBe(4);
    expect(result.counts).toEqual({ info: 1, low: 0, moderate: 1, high: 1, critical: 1 });
    expect(result.blocking.map((entry) => entry.severity).sort()).toEqual(['critical', 'high']);
  });
});

describe('abnormal or undocumented statuses fail closed, whatever the report says', () => {
  it('rejects exit 255 with one moderate advisory (the reported regression)', () => {
    const result = run(255, ONE_MODERATE);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('undocumented_exit');
  });

  it.each([2, 3, 127, 130, 137, 255, -1])(
    'rejects exit %i with the real findings report',
    (status) => {
      const result = run(status, FINDINGS);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toBe('undocumented_exit');
    },
  );

  it.each([2, 255])('rejects exit %i with the real clean report', (status) => {
    expect(run(status, CLEAN).ok).toBe(false);
  });

  it('rejects exit 0 when advisories are present, which pnpm never produces', () => {
    const result = run(0, FINDINGS);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('unexplained_exit');
  });

  it('rejects exit 1 when no advisories are present', () => {
    const result = run(1, CLEAN);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('unexplained_exit');
  });
});

describe('advisory entries and metadata must agree exactly, per severity', () => {
  it('rejects metadata high=1 with only a moderate-labelled advisory (the reported regression)', () => {
    const stdout = mutate(CLEAN, (report) => {
      report.advisories = JSON.parse(ONE_MODERATE).advisories;
      report.metadata.vulnerabilities.high = 1;
    });
    const result = run(1, stdout);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('contradictory_report');
  });

  it('rejects the same contradiction even when the moderate count also matches', () => {
    const stdout = mutate(ONE_MODERATE, (report) => {
      report.metadata.vulnerabilities.high = 1;
    });
    expect(run(1, stdout).ok).toBe(false);
  });

  it('rejects relabelling the real critical advisory as moderate to hide a blocker', () => {
    const stdout = mutate(FINDINGS, (report) => {
      for (const entry of Object.values(report.advisories)) {
        if (entry.severity === 'critical') entry.severity = 'moderate';
      }
    });
    const result = run(1, stdout);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('contradictory_report');
  });

  it('rejects dropping the real high advisory while its count remains', () => {
    const stdout = mutate(FINDINGS, (report) => {
      for (const [id, entry] of Object.entries(report.advisories)) {
        if (entry.severity === 'high') delete report.advisories[id];
      }
    });
    expect(run(1, stdout).ok).toBe(false);
  });

  it.each(['info', 'low', 'moderate', 'high', 'critical'])(
    'rejects an extra %s count with no matching advisory',
    (severity) => {
      const stdout = mutate(FINDINGS, (report) => {
        report.metadata.vulnerabilities[severity] += 1;
      });
      expect(run(1, stdout).ok).toBe(false);
    },
  );

  it.each(['info', 'moderate', 'high', 'critical'])(
    'rejects a %s count lowered below its advisory entries',
    (severity) => {
      const stdout = mutate(FINDINGS, (report) => {
        report.metadata.vulnerabilities[severity] -= 1;
      });
      expect(run(1, stdout).ok).toBe(false);
    },
  );

  it('rejects counts that agree in total but disagree per severity', () => {
    const stdout = mutate(FINDINGS, (report) => {
      report.metadata.vulnerabilities.critical = 0;
      report.metadata.vulnerabilities.low = 1;
    });
    expect(run(1, stdout).ok).toBe(false);
  });
});

describe('ignore lists fail closed', () => {
  it.each([
    [undefined, undefined],
    [{}, undefined],
    [{ ignoreGhsas: [] }, undefined],
  ])('accepts an audit configuration with no ignores: %j', (config, expected) => {
    expect(auditConfigProblem(config)).toBe(expected);
  });

  it('rejects any ignored GHSA, because pnpm removes it from advisories but not from counts', () => {
    expect(auditConfigProblem({ ignoreGhsas: ['GHSA-aaaa-aaaa-aaaa'] })).toContain(
      'GHSA-aaaa-aaaa-aaaa',
    );
  });

  it('rejects an ignore list it cannot read', () => {
    expect(auditConfigProblem({ ignoreGhsas: 'GHSA-aaaa-aaaa-aaaa' })).toBeDefined();
  });
});

describe('end to end: the real gate against a local advisory registry', () => {
  async function gateAgainst(advisories: Record<string, object[]>) {
    const server = createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify(advisories));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    try {
      // Asynchronous: a synchronous spawn would block the event loop this registry needs.
      return await new Promise<{ status: number | null; output: string }>((resolve) => {
        const child = spawn('node', ['scripts/audit-check.mjs'], {
          env: {
            ...process.env,
            pnpm_config_registry: `http://127.0.0.1:${port}/`,
            pnpm_config_fetch_retries: '0',
          },
        });
        let output = '';
        child.stdout.on('data', (chunk) => {
          output += chunk;
        });
        child.stderr.on('data', (chunk) => {
          output += chunk;
        });
        child.on('close', (status) => resolve({ status, output }));
      });
    } finally {
      server.close();
    }
  }

  const advisory = (id: number, severity: string, vulnerableVersions = '*') => ({
    id,
    url: `https://example.invalid/${id}`,
    title: `Synthetic ${severity} advisory`,
    severity,
    // Default to any version: a hard-coded range stops matching after a routine dependency bump.
    vulnerable_versions: vulnerableVersions,
    cwe: [],
    cvss: { score: 0 },
    github_advisory_id: `GHSA-synt-hetc-${String(id).padStart(4, '0')}`,
  });

  it('blocks a real high advisory on an installed package', async () => {
    const gate = await gateAgainst({ zod: [advisory(9101, 'high')] });
    expect(gate.status).toBe(1);
    expect(gate.output).toContain('1 high/critical advisories');
    expect(gate.output).toContain('Synthetic high advisory');
  }, 120_000);

  it('honors vulnerable_versions ranges: matches the installed version, skips a range that excludes it', async () => {
    const lockfile = readFileSync('pnpm-lock.yaml', 'utf8');
    const installed = /^ {2}zod@(\d+\.\d+\.\d+):$/m.exec(lockfile)?.[1];
    expect(installed).toBeDefined();
    const hit = await gateAgainst({ zod: [advisory(9105, 'high', `<=${installed}`)] });
    expect(hit.status).toBe(1);
    expect(hit.output).toContain('1 high/critical advisories');
    const miss = await gateAgainst({ zod: [advisory(9106, 'high', '<0.0.1')] });
    expect(miss.status).toBe(0);
    expect(miss.output).not.toContain('Synthetic high advisory');
  }, 120_000);

  it('blocks a real critical advisory on an installed package', async () => {
    const gate = await gateAgainst({ react: [advisory(9102, 'critical')] });
    expect(gate.status).toBe(1);
    expect(gate.output).toContain('Synthetic critical advisory');
  }, 120_000);

  it('passes a completed audit whose only finding is moderate, which is not blocking', async () => {
    const gate = await gateAgainst({ next: [advisory(9103, 'moderate')] });
    expect(gate.status).toBe(0);
    expect(gate.output).toContain('moderate=1');
  }, 120_000);

  it('passes a completed audit whose only finding is info, which the default level would hide', async () => {
    const gate = await gateAgainst({ 'caniuse-lite': [advisory(9104, 'info')] });
    expect(gate.status).toBe(0);
    expect(gate.output).toContain('info=1');
  }, 120_000);
});
