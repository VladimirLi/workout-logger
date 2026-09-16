/**
 * Conventional commits (D-010).
 *
 * The scope list mirrors the workspace, so a commit message says which boundary
 * moved. `spec` and `guardrail` exist because those changes are governed
 * differently (D-035, D-036) and should be greppable.
 */
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'type-enum': [
      2,
      'always',
      ['feat', 'fix', 'docs', 'refactor', 'perf', 'test', 'build', 'ci', 'chore', 'revert'],
    ],
    'scope-enum': [
      2,
      'always',
      [
        'domain',
        'application',
        'contracts',
        'observability',
        'adapters-supabase',
        'test-support',
        'web',
        'mcp',
        'spec',
        'guardrail',
        'deps',
        'release',
        'repo',
      ],
    ],
    'scope-empty': [2, 'never'],
    'subject-case': [2, 'always', 'lower-case'],
    'header-max-length': [2, 'always', 100],
    'body-max-line-length': [2, 'always', 100],
  },
};
