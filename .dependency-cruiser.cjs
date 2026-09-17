/**
 * Architecture gate — see docs/adr/0001-modular-monolith-with-provider-neutral-domain.md.
 *
 * GUARDRAIL FILE. An implementing agent may not change this file in the same
 * change as the product code it judges (D-035). See ENGINEERING.md.
 *
 * Enforced direction:
 *   apps -> adapters -> application -> domain
 *                            \-> contracts <-/
 *
 *   - domain depends on nothing in the workspace and no framework/IO package
 *   - contracts depends only on a schema library
 *   - application declares ports; it never imports an adapter
 *   - nothing imports an adapter except an app composition root
 */
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      comment: 'A dependency cycle makes the build order undefined and the layering a fiction.',
      from: {},
      to: { circular: true },
    },
    {
      name: 'no-orphans',
      severity: 'warn',
      comment: 'An unreachable module is either dead code or a missing wiring.',
      from: {
        orphan: true,
        pathNot: [
          '(^|/)[.][^/]+[.](?:js|cjs|mjs|ts|cts|mts|json)$',
          '[.]d[.]ts$',
          '(^|/)tsconfig[.]json$',
          '(^|/)(?:babel|biome|vitest|playwright|next|postcss)[.]config[.](?:js|cjs|mjs|ts)$',
          // Next.js discovers these by file-system convention; nothing imports them.
          '^apps/web/app/.*(?:page|layout|template|loading|error|not-found|route|manifest|sitemap|robots)[.]tsx?$',
          // Registered by the browser, not imported by the bundle.
          '^apps/web/public/sw[.]js$',
        ],
      },
      to: {},
    },
    {
      name: 'domain-is-pure',
      severity: 'error',
      comment:
        'packages/domain must not depend on any other workspace package, framework, or IO. ' +
        'If the domain needs something from the outside, the application layer owns a port for it.',
      from: { path: '^packages/domain/src' },
      to: {
        pathNot: ['^packages/domain/src', 'node_modules/typescript/'],
        dependencyTypesNot: ['core'],
      },
    },
    {
      name: 'domain-no-framework',
      severity: 'error',
      comment: 'The domain must not know about Next.js, React, Supabase, MCP, or OpenTelemetry.',
      from: { path: '^packages/domain/src' },
      to: {
        path: 'node_modules/(next|react|react-dom|@supabase|@modelcontextprotocol|@opentelemetry)/',
      },
    },
    {
      name: 'contracts-schema-only',
      severity: 'error',
      comment: 'packages/contracts may depend only on a schema library, never on workspace code.',
      from: { path: '^packages/contracts/src' },
      to: {
        pathNot: ['^packages/contracts/src', 'node_modules/(zod|typescript)/'],
        dependencyTypesNot: ['core'],
      },
    },
    {
      name: 'application-no-adapters',
      severity: 'error',
      comment:
        'The application layer declares ports. Importing an adapter inverts the dependency ' +
        'and welds the use case to a provider.',
      from: { path: '^packages/application/src' },
      to: { path: '^packages/adapters-' },
    },
    {
      name: 'application-no-framework',
      severity: 'error',
      comment: 'Use cases must not import Next.js, React, Supabase, or the MCP SDK.',
      from: { path: '^packages/application/src' },
      to: {
        path: 'node_modules/(next|react|react-dom|@supabase|@modelcontextprotocol)/',
      },
    },
    {
      name: 'only-apps-import-adapters',
      severity: 'error',
      comment:
        'Adapters are wired at a composition root. Any other importer is a leak of provider ' +
        'detail into shared code.',
      from: { pathNot: ['^apps/', '^packages/adapters-', '^packages/test-support/'] },
      to: { path: '^packages/adapters-' },
    },
    {
      name: 'no-app-to-app',
      severity: 'error',
      comment: 'apps/web and apps/mcp are independently deployable. They share packages, not code.',
      from: { path: '^apps/([^/]+)/' },
      to: {
        path: '^apps/([^/]+)/',
        pathNot: '^apps/$1/',
      },
    },
    {
      name: 'no-cross-package-deep-import',
      severity: 'error',
      comment:
        'Cross-package imports must go through a package entry point (its Node "exports"). ' +
        'A deep import into another package reaches past its public API, so that package can ' +
        'no longer change anything internal without breaking a caller.',
      from: { path: '^(?:apps|packages)/([^/]+)/' },
      to: {
        path: '^packages/[^/]+/src/',
        pathNot: [
          // Within your own package is fine.
          '^packages/$1/src/',
          // index.ts IS the declared entry point.
          '^packages/[^/]+/src/index[.]ts$',
        ],
      },
    },
    {
      name: 'telemetry-through-observability',
      severity: 'error',
      comment:
        'Only packages/observability may call an OpenTelemetry SDK. Everything else uses the ' +
        'approved allowlisting API, or the telemetry allowlist is unenforceable ' +
        '(see OBSERVABILITY.md).',
      from: { pathNot: '^packages/observability/' },
      to: { path: 'node_modules/@opentelemetry/' },
    },
    {
      name: 'no-dev-dep-in-production-code',
      severity: 'error',
      comment: 'A devDependency imported by shipped code will be missing at runtime.',
      from: {
        path: '^(apps|packages)/([^/]+)/src',
        pathNot: '[.](test|spec)[.]tsx?$',
      },
      to: { dependencyTypes: ['npm-dev'] },
    },
    {
      name: 'not-to-unresolvable',
      severity: 'error',
      comment: 'An unresolvable import means the gate is not actually seeing the graph.',
      from: {},
      to: { couldNotResolve: true },
    },
    {
      name: 'no-duplicate-dep-types',
      severity: 'warn',
      from: {},
      to: { moreThanOneDependencyType: true, dependencyTypesNot: ['type-only'] },
    },
  ],
  options: {
    doNotFollow: { path: ['node_modules'] },
    exclude: {
      path: [
        'node_modules',
        '[.]next/',
        // Storybook's static build output, like .next: generated bundles, not source.
        'storybook-static/',
        '/dist/',
        '/dist-types/',
        '/coverage/',
        '[.]test[.]tsx?$',
        '[.]spec[.]tsx?$',
      ],
    },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.json' },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      // 'source' first so a cross-package import resolves to the other package's
      // src/ rather than its built dist/. Without this the layering rules below
      // silently match nothing, because dist/ is excluded from the cruise.
      conditionNames: ['source', 'import', 'require', 'node', 'types', 'default'],
      extensions: ['.js', '.mjs', '.cjs', '.ts', '.mts', '.cts', '.tsx', '.d.ts'],
      mainFields: ['module', 'main', 'types'],
    },
    reporterOptions: {
      text: { highlightFocused: true },
    },
    cache: false,
  },
};
