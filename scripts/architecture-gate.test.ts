import { spawnSync } from 'node:child_process';
import { rmSync, writeFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';

/**
 * Tests the architecture GATE, not the architecture.
 *
 * A dependency rule that matches nothing passes silently and looks identical to a
 * rule that is being obeyed. This happened during setup: cross-package imports
 * resolved to each package's built `dist/`, which the cruise excludes, so every
 * layering rule was inert while reporting success.
 *
 * These cases write a deliberate violation, assert the gate rejects it, and then
 * assert a legal import still passes - so the gate cannot go blind unnoticed.
 */

const probes: string[] = [];

function runGate() {
  const result = spawnSync('pnpm', ['test:architecture'], { encoding: 'utf8', shell: false });
  return { code: result.status ?? 1, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

function withProbe(path: string, source: string) {
  writeFileSync(path, source);
  probes.push(path);
  return runGate();
}

afterEach(() => {
  while (probes.length > 0) {
    rmSync(probes.pop() as string, { force: true });
  }
});

/**
 * Each case runs the real gate in a subprocess, which takes seconds natively and far longer in
 * the amd64-emulated CI container, so the budget is stated rather than left at Vitest's 5 s.
 */
const GATE_TIMEOUT_MS = 120_000;

describe('architecture gate rejects violations', () => {
  it(
    'rejects the domain depending on an external library',
    () => {
      const { code, output } = withProbe(
        'packages/domain/src/__arch_probe.ts',
        "import { z } from 'zod';\nexport const probe = z;\n",
      );
      expect(code).not.toBe(0);
      expect(output).toContain('domain-is-pure');
    },
    GATE_TIMEOUT_MS,
  );

  it(
    'rejects contracts depending on another workspace package',
    () => {
      const { code, output } = withProbe(
        'packages/contracts/src/__arch_probe.ts',
        "import { sanitizeAttributes } from '@workout/observability';\nexport const probe = sanitizeAttributes;\n",
      );
      expect(code).not.toBe(0);
      expect(output).toContain('contracts-schema-only');
    },
    GATE_TIMEOUT_MS,
  );

  it(
    'rejects one app importing from the other',
    () => {
      const { code, output } = withProbe(
        'apps/mcp/src/__arch_probe.ts',
        "import page from '../../web/app/page';\nexport const probe = page;\n",
      );
      expect(code).not.toBe(0);
      expect(output).toContain('no-app-to-app');
    },
    GATE_TIMEOUT_MS,
  );

  it(
    'accepts a legal import within a package, so the gate is not simply failing everything',
    () => {
      const { code } = withProbe(
        'packages/domain/src/__arch_probe.ts',
        "import { kilograms } from './units.js';\nexport const probe = kilograms;\n",
      );
      expect(code).toBe(0);
    },
    GATE_TIMEOUT_MS,
  );

  it(
    'sees a non-trivial module graph, so no rule can pass vacuously',
    () => {
      const { output } = runGate();
      const match = /(\d+) modules, (\d+) dependencies cruised/.exec(output);
      expect(match, `could not parse module count from:\n${output}`).not.toBeNull();
      expect(Number(match?.[1])).toBeGreaterThan(25);
      expect(Number(match?.[2])).toBeGreaterThan(25);
    },
    GATE_TIMEOUT_MS,
  );
});
