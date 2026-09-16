import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import { interpretAudit } from './audit-report.mjs';

/**
 * The vulnerability gate treated any JSON on stdout from a non-zero `pnpm audit` as a
 * report. When the advisory registry failed, pnpm printed an ERROR ENVELOPE -
 * `{"error":{"code":"ERR_PNPM_AUDIT_BAD_RESPONSE",...}}` - which has no advisories and
 * no counts, so the gate read it as "zero advisories" and passed. An audit that checked
 * nothing reported a clean bill of health.
 *
 * Both fixtures are pnpm 11.5.2's real output, captured verbatim: one from a completed
 * audit, one from an advisory endpoint answering HTTP 500.
 */

const COMPLETED = readFileSync('scripts/fixtures/audit-completed-clean.json', 'utf8');
const REGISTRY_500 = readFileSync('scripts/fixtures/audit-registry-500.json', 'utf8');

const completed = (overrides: Record<string, unknown> = {}) =>
  JSON.stringify({ ...JSON.parse(COMPLETED), ...overrides });

type Metadata = {
  vulnerabilities: Record<string, unknown>;
  [field: string]: unknown;
};

function withMetadata(mutate: (metadata: Metadata) => void) {
  const report = JSON.parse(COMPLETED);
  mutate(report.metadata);
  return JSON.stringify(report);
}

function advisory(severity: string, id = 1) {
  return {
    id,
    module_name: `pkg-${id}`,
    severity,
    title: `Advisory ${id}`,
    url: `https://example.invalid/${id}`,
    findings: [{ version: '1.0.0', paths: [`pkg-${id}`] }],
  };
}

function withAdvisories(list: ReturnType<typeof advisory>[], counts: Record<string, number>) {
  const report = JSON.parse(COMPLETED);
  report.advisories = Object.fromEntries(list.map((entry) => [String(entry.id), entry]));
  report.metadata.vulnerabilities = {
    info: 0,
    low: 0,
    moderate: 0,
    high: 0,
    critical: 0,
    ...counts,
  };
  return JSON.stringify(report);
}

const run = (status: number | null, stdout: string, signal: string | null = null) =>
  interpretAudit({ status, signal, stdout, stderr: '' });

describe('a completed audit', () => {
  it('passes a real completed report with no advisories', () => {
    const result = run(0, COMPLETED);
    expect(result).toEqual(
      expect.objectContaining({ ok: true, blocking: [], advisoryCount: 0, totalDependencies: 460 }),
    );
  });

  it('reports high and critical advisories as blocking', () => {
    const stdout = withAdvisories(
      [advisory('high', 1), advisory('critical', 2), advisory('moderate', 3)],
      {
        high: 1,
        critical: 1,
        moderate: 1,
      },
    );
    const result = run(1, stdout);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.blocking.map((entry) => entry.severity).sort()).toEqual(['critical', 'high']);
  });

  it('accepts a non-zero exit when the completed report explains it with findings', () => {
    const result = run(1, withAdvisories([advisory('moderate')], { moderate: 1 }));
    expect(result).toEqual(expect.objectContaining({ ok: true, blocking: [], advisoryCount: 1 }));
  });
});

describe('registry failure fails closed', () => {
  it('rejects the real ERR_PNPM_AUDIT_BAD_RESPONSE envelope (the regression)', () => {
    const result = run(1, REGISTRY_500);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('error_envelope');
    expect(result.detail).toContain('ERR_PNPM_AUDIT_BAD_RESPONSE');
  });

  it('rejects an error envelope even with exit 0', () => {
    expect(run(0, REGISTRY_500).ok).toBe(false);
  });

  it('rejects any report carrying an error key, whatever else it contains', () => {
    const stdout = completed({ error: { code: 'ERR_PNPM_SOMETHING', message: 'partial' } });
    const result = run(0, stdout);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('error_envelope');
  });

  it.each([
    ['a null error', completed({ error: null })],
    ['a string error', completed({ error: 'boom' })],
  ])('rejects %s', (_label, stdout) => {
    expect(run(0, stdout).ok).toBe(false);
  });
});

describe('incomplete reports fail closed', () => {
  it.each([
    ['an empty object', '{}'],
    ['advisories without metadata', '{"advisories":{}}'],
    ['metadata without advisories', JSON.stringify({ metadata: JSON.parse(COMPLETED).metadata })],
    ['advisories as an array', completed({ advisories: [] })],
    ['advisories as null', completed({ advisories: null })],
    ['metadata as null', completed({ metadata: null })],
  ])('rejects %s', (_label, stdout) => {
    for (const status of [0, 1]) {
      const result = run(status, stdout);
      expect(result.ok, `status ${status}`).toBe(false);
      if (result.ok) continue;
      expect(result.reason).toBe('incomplete_report');
    }
  });

  it.each(['info', 'low', 'moderate', 'high', 'critical'])(
    'rejects vulnerability counts missing %s',
    (severity) => {
      const stdout = withMetadata((metadata) => {
        delete metadata.vulnerabilities[severity];
      });
      expect(run(0, stdout).ok).toBe(false);
    },
  );

  it.each([
    ['a negative count', -1],
    ['a fractional count', 0.5],
    ['a string count', '0'],
    ['a null count', null],
  ])('rejects %s', (_label, value) => {
    const stdout = withMetadata((metadata) => {
      metadata.vulnerabilities.high = value;
    });
    expect(run(0, stdout).ok).toBe(false);
  });

  it.each(['dependencies', 'devDependencies', 'optionalDependencies', 'totalDependencies'])(
    'rejects a report missing metadata.%s',
    (field) => {
      const stdout = withMetadata((metadata) => {
        delete metadata[field];
      });
      expect(run(0, stdout).ok).toBe(false);
    },
  );

  it('rejects an audit that examined zero dependencies, because it checked nothing', () => {
    const stdout = withMetadata((metadata) => {
      metadata.totalDependencies = 0;
    });
    expect(run(0, stdout).ok).toBe(false);
  });

  it('rejects an advisory with a severity it cannot classify', () => {
    const result = run(1, withAdvisories([advisory('severe')], { high: 1 }));
    expect(result.ok).toBe(false);
  });

  it('rejects counts that report findings when no advisories were returned', () => {
    const stdout = withMetadata((metadata) => {
      metadata.vulnerabilities.critical = 2;
    });
    expect(run(1, stdout).ok).toBe(false);
  });

  it('rejects advisories when every count says zero', () => {
    const result = run(1, withAdvisories([advisory('high')], {}));
    expect(result.ok).toBe(false);
  });
});

describe('exit status must be explained by a completed audit', () => {
  it('rejects a non-zero exit with a clean completed report', () => {
    const result = run(1, COMPLETED);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('unexplained_exit');
  });

  it.each([
    ['empty output', ''],
    ['non-JSON output', 'ERR_PNPM_FETCH_ETIMEDOUT request to registry failed'],
    ['truncated JSON', COMPLETED.slice(0, 40)],
    ['a JSON array', '[]'],
    ['JSON null', 'null'],
    ['a JSON string', '"ok"'],
  ])('rejects %s', (_label, stdout) => {
    expect(run(1, stdout).ok).toBe(false);
    expect(run(0, stdout).ok).toBe(false);
  });

  it('rejects a process killed by a signal, even with a clean report on stdout', () => {
    const result = run(null, COMPLETED, 'SIGTERM');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('did_not_complete');
  });
});

describe('end to end: the real gate against a failing advisory registry', () => {
  it('exits non-zero and names the registry failure', async () => {
    const server = createServer((_request, response) => {
      response.writeHead(500, { 'content-type': 'application/json' });
      response.end('{"error":"Internal Server Error"}');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;

    try {
      // Asynchronous on purpose: a synchronous spawn would block the event loop this
      // in-process registry needs in order to answer, and pnpm would just hang.
      const gate = await new Promise<{ status: number | null; output: string }>((resolve) => {
        const child = spawn('node', ['scripts/audit-check.mjs'], {
          env: {
            ...process.env,
            // pnpm 11 reads pnpm_config_*; it ignores npm_config_registry, which would
            // silently send this test to the real registry and prove nothing.
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
      expect(gate.status).not.toBe(0);
      expect(gate.output).toContain('ERR_PNPM_AUDIT_BAD_RESPONSE');
    } finally {
      server.close();
    }
  }, 120_000);
});
