import { defineConfig } from 'vitest/config';

/**
 * Unit, domain, and integration suites.
 *
 * Coverage thresholds are deliberately per-package and high only where behaviour
 * lives (D-038). One blunt global percentage is explicitly not the quality
 * definition, so the domain is held to a hard bar and skeletons are not.
 */
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'domain',
          include: ['packages/domain/src/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        test: {
          name: 'unit',
          include: [
            'packages/contracts/src/**/*.test.ts',
            'packages/observability/src/**/*.test.ts',
            'packages/adapters-supabase/src/**/*.test.ts',
            // Pure parts of the browser adapter. Its IndexedDB behaviour is proved in a real
            // browser by apps/web/e2e/browser-store.spec.ts, because Node has no IndexedDB.
            'packages/adapters-browser/src/**/*.test.ts',
            'apps/mcp/src/**/*.test.ts',
            // Design tokens, presentation primitives, and formatters (ADR-0008).
            'apps/web/tokens/**/*.test.ts',
            'apps/web/ui/**/*.test.ts',
            'scripts/**/*.test.ts',
          ],
          environment: 'node',
        },
      },
      {
        test: {
          name: 'integration',
          include: ['packages/test-support/src/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        test: {
          // Adapter contract suites against a real provider. NOT part of `pnpm verify`: they
          // need a network and a credential, and the aggregate gate stays hermetic and
          // secret-free. `pnpm test:provider` runs them with .env.local loaded.
          name: 'provider',
          include: ['packages/adapters-supabase/src/**/*.provider.ts'],
          environment: 'node',
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'json-summary'],
      include: ['packages/domain/src/**/*.ts', 'packages/observability/src/**/*.ts'],
      exclude: [
        '**/*.test.ts',
        '**/index.ts',
        // Transient fixtures written and removed by scripts/architecture-gate.test.ts.
        // Without this, whether they exist at report time depends on test scheduling,
        // which would make the coverage numbers flaky.
        '**/__arch_probe.ts',
      ],
      thresholds: {
        // High bar where the behaviour is, per D-038.
        'packages/domain/src/**': { statements: 95, branches: 90, functions: 95, lines: 95 },
        'packages/observability/src/**': { statements: 95, branches: 90, functions: 90, lines: 95 },
      },
    },
  },
});
