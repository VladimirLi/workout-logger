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
            'apps/mcp/src/**/*.test.ts',
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
