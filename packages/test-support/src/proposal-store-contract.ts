import type { ProposalStore } from '@workout/application';
import { nextRevision, type Proposal, type Revision } from '@workout/domain';
import { describe, expect, it } from 'vitest';
import { aProposal, aRevision, SYNTHETIC_USER_ID } from './builders.js';

/**
 * Adapter contract suite (ADR-0005).
 *
 * Written against the PORT, not against a provider. The in-memory reference
 * implementation and any future Supabase adapter run the identical suite, so
 * "does the new adapter behave the same?" is a command you can run.
 *
 * The compare-and-set cases are the important ones. An adapter that implements
 * `commitDecision` as a read followed by a write will pass the round-trip cases and
 * fail these, which is exactly the point: the atomicity requirement is not
 * satisfiable by careful sequencing (D-018).
 */
export interface ContractHarness {
  readonly store: ProposalStore;
  /** Seeds a proposal and the plan revision, bypassing the contract under test. */
  seed(userId: string, proposal: Proposal, revision: Revision): Promise<void> | void;
}

export function proposalStoreContract(
  name: string,
  createHarness: () => Promise<ContractHarness> | ContractHarness,
): void {
  describe(`ProposalStore contract: ${name}`, () => {
    it('returns undefined for an unknown proposal', async () => {
      const { store } = await createHarness();
      expect(await store.findById(SYNTHETIC_USER_ID, 'missing')).toBeUndefined();
    });

    it('round-trips a seeded proposal', async () => {
      const harness = await createHarness();
      const proposal = aProposal();
      await harness.seed(SYNTHETIC_USER_ID, proposal, aRevision(1));

      const found = await harness.store.findById(SYNTHETIC_USER_ID, proposal.id);
      expect(found?.id).toBe(proposal.id);
      expect(found?.baseRevision).toBe(proposal.baseRevision);
      expect(found?.status).toBe('pending');
    });

    it('isolates proposals by user, so a wrong-user read finds nothing', async () => {
      const harness = await createHarness();
      const proposal = aProposal();
      await harness.seed(SYNTHETIC_USER_ID, proposal, aRevision(1));

      expect(await harness.store.findById('some-other-user', proposal.id)).toBeUndefined();
    });

    it('commits a decision when the expected revision and status both match', async () => {
      const harness = await createHarness();
      const proposal = aProposal({ baseRevision: aRevision(5) });
      await harness.seed(SYNTHETIC_USER_ID, proposal, aRevision(5));

      const outcome = await harness.store.commitDecision({
        userId: SYNTHETIC_USER_ID,
        proposal: { ...proposal, status: 'accepted' },
        expectedRevision: aRevision(5),
        expectedStatus: 'pending',
        advanceRevision: true,
      });

      expect(outcome.kind).toBe('committed');
      expect(await harness.store.currentRevision(SYNTHETIC_USER_ID)).toBe(6);
      expect((await harness.store.findById(SYNTHETIC_USER_ID, proposal.id))?.status).toBe(
        'accepted',
      );
    });

    it('refuses the commit when the revision has moved', async () => {
      const harness = await createHarness();
      const proposal = aProposal({ baseRevision: aRevision(5) });
      await harness.seed(SYNTHETIC_USER_ID, proposal, aRevision(6));

      const outcome = await harness.store.commitDecision({
        userId: SYNTHETIC_USER_ID,
        proposal: { ...proposal, status: 'accepted' },
        expectedRevision: aRevision(5),
        expectedStatus: 'pending',
        advanceRevision: true,
      });

      expect(outcome).toEqual({ kind: 'revision_changed', currentRevision: 6 });
    });

    it('leaves the proposal and the revision untouched when a commit is refused', async () => {
      const harness = await createHarness();
      const proposal = aProposal({ baseRevision: aRevision(5) });
      await harness.seed(SYNTHETIC_USER_ID, proposal, aRevision(6));

      await harness.store.commitDecision({
        userId: SYNTHETIC_USER_ID,
        proposal: { ...proposal, status: 'accepted' },
        expectedRevision: aRevision(5),
        expectedStatus: 'pending',
        advanceRevision: true,
      });

      expect((await harness.store.findById(SYNTHETIC_USER_ID, proposal.id))?.status).toBe(
        'pending',
      );
      expect(await harness.store.currentRevision(SYNTHETIC_USER_ID)).toBe(6);
    });

    it('refuses the commit when the proposal was already decided', async () => {
      const harness = await createHarness();
      const proposal = aProposal({ baseRevision: aRevision(5), status: 'accepted' });
      await harness.seed(SYNTHETIC_USER_ID, proposal, aRevision(5));

      const outcome = await harness.store.commitDecision({
        userId: SYNTHETIC_USER_ID,
        proposal: { ...proposal, status: 'rejected' },
        expectedRevision: aRevision(5),
        expectedStatus: 'pending',
        advanceRevision: false,
      });

      expect(outcome).toEqual({ kind: 'status_changed', currentStatus: 'accepted' });
    });

    it('reports not_found rather than creating a proposal on commit', async () => {
      const harness = await createHarness();
      const outcome = await harness.store.commitDecision({
        userId: SYNTHETIC_USER_ID,
        proposal: aProposal({ id: 'never_seeded' }),
        expectedRevision: aRevision(1),
        expectedStatus: 'pending',
        advanceRevision: false,
      });

      expect(outcome).toEqual({ kind: 'not_found' });
    });

    it('does not advance the revision when advanceRevision is false', async () => {
      const harness = await createHarness();
      const proposal = aProposal({ baseRevision: aRevision(5) });
      await harness.seed(SYNTHETIC_USER_ID, proposal, aRevision(5));

      await harness.store.commitDecision({
        userId: SYNTHETIC_USER_ID,
        proposal: { ...proposal, status: 'rejected' },
        expectedRevision: aRevision(5),
        expectedStatus: 'pending',
        advanceRevision: false,
      });

      expect(await harness.store.currentRevision(SYNTHETIC_USER_ID)).toBe(5);
    });

    it('marks a pending proposal stale without reference to the revision', async () => {
      const harness = await createHarness();
      const proposal = aProposal({ baseRevision: aRevision(5) });
      // The revision is deliberately somewhere else entirely.
      await harness.seed(SYNTHETIC_USER_ID, proposal, aRevision(99));

      expect(await harness.store.markStaleIfPending(SYNTHETIC_USER_ID, proposal.id)).toBe('marked');
      expect((await harness.store.findById(SYNTHETIC_USER_ID, proposal.id))?.status).toBe(
        'rejected_stale',
      );
      expect(await harness.store.currentRevision(SYNTHETIC_USER_ID)).toBe(99);
    });

    it('refuses to mark a proposal that was already decided', async () => {
      const harness = await createHarness();
      const proposal = aProposal({ baseRevision: aRevision(5), status: 'accepted' });
      await harness.seed(SYNTHETIC_USER_ID, proposal, aRevision(5));

      expect(await harness.store.markStaleIfPending(SYNTHETIC_USER_ID, proposal.id)).toBe(
        'not_pending',
      );
      expect((await harness.store.findById(SYNTHETIC_USER_ID, proposal.id))?.status).toBe(
        'accepted',
      );
    });

    it('is idempotent when marking stale', async () => {
      const harness = await createHarness();
      const proposal = aProposal({ baseRevision: aRevision(5) });
      await harness.seed(SYNTHETIC_USER_ID, proposal, aRevision(5));

      expect(await harness.store.markStaleIfPending(SYNTHETIC_USER_ID, proposal.id)).toBe('marked');
      expect(await harness.store.markStaleIfPending(SYNTHETIC_USER_ID, proposal.id)).toBe(
        'not_pending',
      );
    });

    it('reports not_found when marking an unknown proposal', async () => {
      const harness = await createHarness();
      expect(await harness.store.markStaleIfPending(SYNTHETIC_USER_ID, 'missing')).toBe(
        'not_found',
      );
    });

    it('isolates the stale transition by user', async () => {
      const harness = await createHarness();
      const proposal = aProposal();
      await harness.seed(SYNTHETIC_USER_ID, proposal, aRevision(1));

      expect(await harness.store.markStaleIfPending('some-other-user', proposal.id)).toBe(
        'not_found',
      );
      expect((await harness.store.findById(SYNTHETIC_USER_ID, proposal.id))?.status).toBe(
        'pending',
      );
    });

    it('permits only one of two commits racing on the same expected revision', async () => {
      const harness = await createHarness();
      const first = aProposal({ id: 'prop_a', baseRevision: aRevision(5) });
      const second = aProposal({ id: 'prop_b', baseRevision: aRevision(5) });
      await harness.seed(SYNTHETIC_USER_ID, first, aRevision(5));
      await harness.seed(SYNTHETIC_USER_ID, second, aRevision(5));

      const outcomes = await Promise.all(
        [first, second].map((proposal) =>
          harness.store.commitDecision({
            userId: SYNTHETIC_USER_ID,
            proposal: { ...proposal, status: 'accepted' },
            expectedRevision: aRevision(5),
            expectedStatus: 'pending',
            advanceRevision: true,
          }),
        ),
      );

      expect(outcomes.filter((outcome) => outcome.kind === 'committed')).toHaveLength(1);
      expect(outcomes.filter((outcome) => outcome.kind === 'revision_changed')).toHaveLength(1);
      expect(await harness.store.currentRevision(SYNTHETIC_USER_ID)).toBe(
        nextRevision(aRevision(5)),
      );
    });
  });
}
