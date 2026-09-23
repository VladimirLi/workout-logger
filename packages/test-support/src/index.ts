/**
 * The public surface of the test-support package.
 *
 * Deliberately runner-agnostic: `local-workout-store-contract.ts` and
 * `proposal-store-contract.ts` import `vitest` and are therefore NOT exported. They are used
 * only by this package's own Vitest files, while the cases they wrap are exported so another
 * runner can execute the identical list - Playwright runs the store cases against the
 * IndexedDB adapter in a real browser. Exporting a module that imports `vitest` would make
 * this package unimportable from a Playwright spec.
 */
export * from './builders.js';
export * from './in-memory-deletion.js';
export * from './in-memory-ports.js';
export * from './in-memory-workout.js';
export * from './local-workout-store-cases.js';
export * from './plan-diff-agreement.js';
export * from './proposal-store-cases.js';
