import { describe, it } from 'vitest';
import { type ContractHarness, PROPOSAL_STORE_CASES } from './proposal-store-cases.js';

/**
 * The Vitest binding for the proposal store contract. The cases live in
 * proposal-store-cases.ts and know nothing about a runner, so the Supabase adapter runs the
 * identical list against a real database.
 */
export type { ContractHarness };

export function proposalStoreContract(
  name: string,
  createHarness: () => Promise<ContractHarness> | ContractHarness,
): void {
  describe(`ProposalStore contract: ${name}`, () => {
    for (const testCase of PROPOSAL_STORE_CASES) {
      it(testCase.name, async () => {
        await testCase.run(await createHarness());
      });
    }
  });
}
