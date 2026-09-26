import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('guardrail list consistency', () => {
  const guardrails = JSON.parse(readFileSync('scripts/guardrails.json', 'utf8')) as {
    guardrailPaths: string[];
    guardrailPathPatterns?: string[];
  };
  const engineering = readFileSync('ENGINEERING.md', 'utf8');

  it('documents every guardrail path in ENGINEERING.md', () => {
    for (const path of guardrails.guardrailPaths) {
      expect(engineering, `ENGINEERING.md does not list guardrail path ${path}`).toContain(path);
    }
  });

  it('documents every guardrail path pattern in ENGINEERING.md', () => {
    // A pattern protects files no literal path names, so an undocumented one is a rule
    // nobody reading this repository would know applies to them.
    for (const pattern of guardrails.guardrailPathPatterns ?? []) {
      expect(engineering, `ENGINEERING.md does not list guardrail pattern ${pattern}`).toContain(
        pattern,
      );
    }
  });

  it('protects the root manifest, which owns every gate command', () => {
    const patterns = (guardrails.guardrailPathPatterns ?? []).map((source) => new RegExp(source));
    expect(
      guardrails.guardrailPaths.includes('package.json') ||
        patterns.some((pattern) => pattern.test('package.json')),
    ).toBe(true);
  });

  describe('the CI separation audit', () => {
    const workflow = readFileSync('.github/workflows/verify.yml', 'utf8');
    /**
     * The job's steps in order. Split on the step marker rather than parsed as YAML, because
     * adding a YAML parser to run one policy test would add a dependency to the licence
     * ledger; the marker is stable and the shape is asserted below.
     */
    const steps = workflow.split(/^ {6}- name: /m).slice(1);
    const auditIndex = steps.findIndex((step) => step.includes('check-guardrails.mjs --range'));

    it('reads the whole history, and does it without going through a pnpm script', () => {
      // pnpm would read the command from package.json, which the audit exists to protect.
      expect(workflow).toContain('node scripts/check-guardrails.mjs --range HEAD');
      expect(workflow).toContain('fetch-depth: 0');
      expect(steps.length).toBeGreaterThanOrEqual(5);
      expect(auditIndex).toBeGreaterThanOrEqual(0);
    });

    it('runs before any dependency is installed or any repository hook can execute', () => {
      // `pnpm install` runs the root `prepare` hook and installed packages' build scripts,
      // all controlled by the commit under test. Auditing after that would let a change
      // that weakens this check run code first.
      expect(auditIndex).toBe(1);
      expect(steps[0], 'the first step is not the checkout').toContain('actions/checkout');

      const before = steps.slice(0, auditIndex).join('\n');
      for (const marker of [
        'pnpm install',
        'pnpm/action-setup',
        'actions/setup-node',
        'corepack',
        'npm ci',
        'run: pnpm',
      ]) {
        expect(before, `${marker} runs before the separation audit`).not.toContain(marker);
      }
    });

    it('can run on a bare checkout, because the script imports only Node built-ins', () => {
      // The ordering above is only possible while this holds. A single package import would
      // make the step need an install, and the install is what it must precede.
      const source = readFileSync('scripts/check-guardrails.mjs', 'utf8');
      const specifiers = [...source.matchAll(/^import\s[^']*'([^']+)'/gm)].map((match) => match[1]);
      expect(specifiers.length).toBeGreaterThan(0);
      for (const specifier of specifiers) {
        expect(specifier, `${specifier} is not a Node built-in`).toMatch(/^node:/);
      }
      expect(source).not.toMatch(/\brequire\(/);
    });
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
  const accepted = /^\*\*Status: Accepted\b/m.test(designSystem);

  it('records exactly one status: NOT DECIDED or Accepted', () => {
    // Acceptance flips the branch below. It cannot happen quietly: the accepted branch
    // demands the owner's verbatim decision payload, a trace for every decision in it,
    // and the superseding ADR.
    const undecided = designSystem.includes('Status: NOT DECIDED');
    expect(Number(undecided) + Number(accepted), 'DESIGN_SYSTEM.md status').toBe(1);
  });

  it('selects no UI framework anywhere in the web app', () => {
    const webManifest = readFileSync('apps/web/package.json', 'utf8');
    for (const forbidden of ['tailwind', 'shadcn', '@mui/', '@chakra-ui/', 'bootstrap', 'antd']) {
      expect(webManifest.toLowerCase(), `apps/web depends on ${forbidden}`).not.toContain(
        forbidden,
      );
    }
  });

  describe.runIf(!accepted)('while NOT DECIDED', () => {
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
  });

  describe.runIf(accepted)('once Accepted', () => {
    const PAYLOAD = 'docs/design-system/decision-payload.txt';
    const MATRIX = 'docs/design-system/decision-matrix.md';

    function payload() {
      const [header, json] = readFileSync(PAYLOAD, 'utf8').split('\n');
      return {
        header,
        body: JSON.parse(json ?? '') as {
          schema: string;
          counts: Record<string, number>;
          selections: Record<string, string>;
          deferred: unknown[];
          unresolved: unknown[];
        },
      };
    }

    it('keeps the owner decision payload verbatim and complete', () => {
      const { header, body } = payload();
      expect(header).toBe('WORKOUT LOGGER DESIGN-SYSTEM DECISIONS');
      expect(body.schema).toBe('wl-ds-workbook/v1');
      expect(Object.keys(body.selections)).toHaveLength(65);
      expect(body.counts).toEqual({ selected: 65, unresolved: 0, deferred: 0, total: 65 });
      expect(body.deferred).toEqual([]);
      expect(body.unresolved).toEqual([]);
      for (const [decision, option] of Object.entries(body.selections)) {
        expect(option.startsWith(`${decision}.`), `${option} does not answer ${decision}`).toBe(
          true,
        );
      }
    });

    it('pins the payload bytes by digest in DESIGN_SYSTEM.md', () => {
      const digest = createHash('sha256').update(readFileSync(PAYLOAD)).digest('hex');
      expect(designSystem, 'DESIGN_SYSTEM.md does not record the payload digest').toContain(digest);
    });

    it('traces every selected option in DESIGN_SYSTEM.md and the decision matrix', () => {
      const matrix = readFileSync(MATRIX, 'utf8');
      for (const option of Object.values(payload().body.selections)) {
        expect(designSystem, `DESIGN_SYSTEM.md does not trace ${option}`).toContain(option);
        const row = matrix.split('\n').find((line) => line.includes(`\`${option}\``));
        expect(row, `${MATRIX} has no row for ${option}`).toBeDefined();
        // Every row names where the decision lives and what proves it.
        expect(row?.split('|').filter((cell) => cell.trim() !== '').length).toBeGreaterThanOrEqual(
          4,
        );
      }
    });

    it('names no option the owner did not select', () => {
      const selected = new Set(Object.values(payload().body.selections));
      const matrix = readFileSync(MATRIX, 'utf8');
      const traced = [...matrix.matchAll(/`([a-z0-9-]+\.[a-z0-9-]+\.[a-z0-9-]+)`/g)].map(
        (match) => match[1],
      );
      expect(traced.filter((option) => !selected.has(option))).toEqual([]);
    });

    it('is recorded by an accepted ADR that supersedes ADR-0007', () => {
      const index = readFileSync('docs/adr/README.md', 'utf8');
      expect(index).toMatch(/\| \[0007\]\([^)]+\) \| [^|]+ \| Superseded by 0008 \|/);
      expect(index).toMatch(/\| \[0008\]\([^)]+\) \| [^|]+ \| Accepted \|/);
    });

    it('pins the payload digest here too, so changing the owner decision needs a guardrail change', () => {
      // The digest in DESIGN_SYSTEM.md lives beside the payload and could be edited with it.
      // This copy can only change in a separately reviewed guardrail change (D-035).
      const digest = createHash('sha256').update(readFileSync(PAYLOAD)).digest('hex');
      expect(digest).toBe('44c665fd0ca1e56d6c61c81badedd06605b5e18f6c4de8a9a8efa12a6183267c');
    });

    it('still records a decision for every design area', () => {
      for (const area of [
        'Tokens',
        'Colour',
        'Typography',
        'Layout',
        'Iconography',
        'Motion',
        'Components',
        'State matrix',
        'Data',
        'Content',
        'Accessibility',
        'Visual regression',
      ]) {
        expect(designSystem, `DESIGN_SYSTEM.md has no "${area}" section`).toMatch(
          new RegExp(`^#{2,3} ${area}\\b`, 'm'),
        );
      }
    });

    it('keeps G-10 open until every validation item carries dated evidence', () => {
      const gates = readFileSync('docs/external-gates.md', 'utf8');
      const g10 = gates.slice(gates.indexOf('## G-10'), gates.indexOf('## G-11'));
      const open = /^\*\*Status: OPEN\.\*\*/m.test(g10);
      const items = [...g10.matchAll(/^(\d+)\. /gm)].length;
      expect(items, 'G-10 lists its validation items').toBeGreaterThanOrEqual(7);
      if (open) return;
      // Closing needs a dated, attributed record for every item - never a status edit alone.
      const evidence = [...g10.matchAll(/^\s*Evidence: \d{4}-\d{2}-\d{2}, [^,]+, .+$/gm)];
      expect(evidence.length, 'G-10 is closed without dated evidence for each item').toBe(items);
      // Proposal review is outside this decision, so its baselines must exist before closure.
      const screenshots = 'apps/web/e2e/__screenshots__/linux';
      expect(existsSync(screenshots), 'G-10 is closed without Linux baselines').toBe(true);
      const list = (dir: string): string[] =>
        readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
          entry.isDirectory() ? list(`${dir}/${entry.name}`) : [entry.name],
        );
      expect(
        list(screenshots).some((file) => file.includes('proposal-review')),
        'G-10 is closed without proposal review baselines',
      ).toBe(true);
    });

    it('runs CI in the pinned Playwright image the Linux baselines come from', () => {
      const workflow = readFileSync('.github/workflows/verify.yml', 'utf8');
      const catalog = readFileSync('pnpm-workspace.yaml', 'utf8');
      const version = /'@playwright\/test': (\d+\.\d+\.\d+)/.exec(catalog)?.[1];
      expect(version).toBeDefined();
      expect(workflow).toMatch(
        new RegExp(
          `image: mcr\\.microsoft\\.com/playwright:v${version?.replaceAll('.', '\\.')}-noble@sha256:[0-9a-f]{64}`,
        ),
      );
      expect(workflow, 'browsers come from the image, not a runner install').not.toMatch(
        /playwright install/,
      );
    });

    it('runs a visual-regression gate over committed baselines', () => {
      const verify = readFileSync('scripts/verify.mjs', 'utf8');
      expect(verify).toContain("['test:visual', ['test:visual']]");
      const scripts = (
        JSON.parse(readFileSync('package.json', 'utf8')) as { scripts: Record<string, string> }
      ).scripts;
      // A missing baseline must fail, never be written silently during the gate.
      expect(scripts['test:visual']).toContain('--update-snapshots=none');
      expect(existsSync('apps/web/e2e/visual')).toBe(true);
    });
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
      'test:visual',
      'storybook:build',
    ]) {
      expect(gates, `verify does not run ${required}`).toContain(required);
    }
  });
});
