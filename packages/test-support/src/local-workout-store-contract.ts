import { describe, it } from 'vitest';
import {
  LOCAL_WORKOUT_STORE_CASES,
  type LocalWorkoutStoreHarness,
  PLAN_READER_CASES,
  type PlanReaderHarness,
} from './local-workout-store-cases.js';

/**
 * The Vitest binding for the device store and plan reader contracts.
 *
 * The cases themselves live in local-workout-store-cases.ts and know nothing about a runner,
 * so the IndexedDB adapter can run the identical list under Playwright against a real browser
 * (apps/web/e2e/browser-store.spec.ts). A harness is built per case, so one case's database
 * never leaks into the next.
 */

export type { LocalWorkoutStoreHarness, PlanReaderHarness };

export function localWorkoutStoreContract(
  name: string,
  createHarness: () => Promise<LocalWorkoutStoreHarness> | LocalWorkoutStoreHarness,
): void {
  describe(`LocalWorkoutStore contract: ${name}`, () => {
    for (const testCase of LOCAL_WORKOUT_STORE_CASES) {
      it(testCase.name, async () => {
        await testCase.run(await createHarness());
      });
    }
  });
}

export function planReaderContract(
  name: string,
  createHarness: () => Promise<PlanReaderHarness> | PlanReaderHarness,
): void {
  describe(`PlanReader contract: ${name}`, () => {
    for (const testCase of PLAN_READER_CASES) {
      it(testCase.name, async () => {
        await testCase.run(await createHarness());
      });
    }
  });
}
