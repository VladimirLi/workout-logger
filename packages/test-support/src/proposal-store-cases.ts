import { deepStrictEqual, strictEqual } from 'node:assert/strict';
import type { ProposalStore } from '@workout/application';
import { nextRevision, type Proposal, type Revision } from '@workout/domain';
import { aProposal, aRevision, SYNTHETIC_USER_ID } from './builders.js';
import type { Case } from './local-workout-store-cases.js';

/**
 * The proposal store contract, as a list of cases rather than a test file (ADR-0005).
 *
 * The compare-and-set cases are the important ones. An adapter that implements
 * `commitDecision` as a read followed by a write will pass the round-trip cases and fail
 * these, which is exactly the point: the atomicity requirement is not satisfiable by careful
 * sequencing (D-018).
 *
 * Runner-agnostic, like the device store's cases, so the same list runs under Vitest against
 * the in-memory reference and against a real Supabase project. Assertions come from
 * node:assert for that reason.
 */

export interface ContractHarness {
  readonly store: ProposalStore;
  /** Seeds a proposal and the plan revision, bypassing the contract under test. */
  seed(userId: string, proposal: Proposal, revision: Revision): Promise<void> | void;
  /**
   * The two identities the suite uses, when the store cannot accept any string as a user.
   *
   * The in-memory reference takes the synthetic constants and is unaffected. A real database
   * keys rows by a uuid that exists in `auth.users`, so its harness supplies real ones - a
   * property of the store, not of the contract. Every assertion is the same either way.
   */
  readonly identities?: { readonly user: string; readonly otherUser: string };
}

const who = (harness: ContractHarness) => harness.identities?.user ?? SYNTHETIC_USER_ID;
const other = (harness: ContractHarness) => harness.identities?.otherUser ?? 'some-other-user';

export const PROPOSAL_STORE_CASES: readonly Case<ContractHarness>[] = [
  {
    name: 'returns undefined for an unknown proposal',
    async run(harness) {
      const { store } = harness;
      strictEqual(await store.findById(who(harness), 'missing'), undefined);
    },
  },
  {
    name: 'round-trips a seeded proposal',
    async run(harness) {
      const proposal = aProposal();
      await harness.seed(who(harness), proposal, aRevision(1));

      const found = await harness.store.findById(who(harness), proposal.id);
      strictEqual(found?.id, proposal.id);
      strictEqual(found?.baseRevision, proposal.baseRevision);
      strictEqual(found?.status, 'pending');
    },
  },
  {
    name: 'isolates proposals by user, so a wrong-user read finds nothing',
    async run(harness) {
      const proposal = aProposal();
      await harness.seed(who(harness), proposal, aRevision(1));

      strictEqual(await harness.store.findById(other(harness), proposal.id), undefined);
    },
  },
  {
    name: 'commits a decision when the expected revision and status both match',
    async run(harness) {
      const proposal = aProposal({ baseRevision: aRevision(5) });
      await harness.seed(who(harness), proposal, aRevision(5));

      const outcome = await harness.store.commitDecision({
        userId: who(harness),
        proposal: { ...proposal, status: 'accepted' },
        expectedRevision: aRevision(5),
        expectedStatus: 'pending',
        advanceRevision: true,
      });

      strictEqual(outcome.kind, 'committed');
      strictEqual(await harness.store.currentRevision(who(harness)), 6);
      strictEqual((await harness.store.findById(who(harness), proposal.id))?.status, 'accepted');
    },
  },
  {
    name: 'refuses the commit when the revision has moved',
    async run(harness) {
      const proposal = aProposal({ baseRevision: aRevision(5) });
      await harness.seed(who(harness), proposal, aRevision(6));

      const outcome = await harness.store.commitDecision({
        userId: who(harness),
        proposal: { ...proposal, status: 'accepted' },
        expectedRevision: aRevision(5),
        expectedStatus: 'pending',
        advanceRevision: true,
      });

      deepStrictEqual(outcome, { kind: 'revision_changed', currentRevision: 6 });
    },
  },
  {
    name: 'leaves the proposal and the revision untouched when a commit is refused',
    async run(harness) {
      const proposal = aProposal({ baseRevision: aRevision(5) });
      await harness.seed(who(harness), proposal, aRevision(6));

      await harness.store.commitDecision({
        userId: who(harness),
        proposal: { ...proposal, status: 'accepted' },
        expectedRevision: aRevision(5),
        expectedStatus: 'pending',
        advanceRevision: true,
      });

      strictEqual((await harness.store.findById(who(harness), proposal.id))?.status, 'pending');
      strictEqual(await harness.store.currentRevision(who(harness)), 6);
    },
  },
  {
    name: 'refuses the commit when the proposal was already decided',
    async run(harness) {
      const proposal = aProposal({ baseRevision: aRevision(5), status: 'accepted' });
      await harness.seed(who(harness), proposal, aRevision(5));

      const outcome = await harness.store.commitDecision({
        userId: who(harness),
        proposal: { ...proposal, status: 'rejected' },
        expectedRevision: aRevision(5),
        expectedStatus: 'pending',
        advanceRevision: false,
      });

      deepStrictEqual(outcome, { kind: 'status_changed', currentStatus: 'accepted' });
    },
  },
  {
    name: 'reports not_found rather than creating a proposal on commit',
    async run(harness) {
      const outcome = await harness.store.commitDecision({
        userId: who(harness),
        proposal: aProposal({ id: 'never_seeded' }),
        expectedRevision: aRevision(1),
        expectedStatus: 'pending',
        advanceRevision: false,
      });

      deepStrictEqual(outcome, { kind: 'not_found' });
    },
  },
  {
    name: 'does not advance the revision when advanceRevision is false',
    async run(harness) {
      const proposal = aProposal({ baseRevision: aRevision(5) });
      await harness.seed(who(harness), proposal, aRevision(5));

      await harness.store.commitDecision({
        userId: who(harness),
        proposal: { ...proposal, status: 'rejected' },
        expectedRevision: aRevision(5),
        expectedStatus: 'pending',
        advanceRevision: false,
      });

      strictEqual(await harness.store.currentRevision(who(harness)), 5);
    },
  },
  {
    name: 'marks a pending proposal stale without reference to the revision',
    async run(harness) {
      const proposal = aProposal({ baseRevision: aRevision(5) });
      // The revision is deliberately somewhere else entirely.
      await harness.seed(who(harness), proposal, aRevision(99));

      strictEqual(await harness.store.markStaleIfPending(who(harness), proposal.id), 'marked');
      strictEqual(
        (await harness.store.findById(who(harness), proposal.id))?.status,
        'rejected_stale',
      );
      strictEqual(await harness.store.currentRevision(who(harness)), 99);
    },
  },
  {
    name: 'refuses to mark a proposal that was already decided',
    async run(harness) {
      const proposal = aProposal({ baseRevision: aRevision(5), status: 'accepted' });
      await harness.seed(who(harness), proposal, aRevision(5));

      strictEqual(await harness.store.markStaleIfPending(who(harness), proposal.id), 'not_pending');
      strictEqual((await harness.store.findById(who(harness), proposal.id))?.status, 'accepted');
    },
  },
  {
    name: 'is idempotent when marking stale',
    async run(harness) {
      const proposal = aProposal({ baseRevision: aRevision(5) });
      await harness.seed(who(harness), proposal, aRevision(5));

      strictEqual(await harness.store.markStaleIfPending(who(harness), proposal.id), 'marked');
      strictEqual(await harness.store.markStaleIfPending(who(harness), proposal.id), 'not_pending');
    },
  },
  {
    name: 'reports not_found when marking an unknown proposal',
    async run(harness) {
      strictEqual(await harness.store.markStaleIfPending(who(harness), 'missing'), 'not_found');
    },
  },
  {
    name: 'isolates the stale transition by user',
    async run(harness) {
      const proposal = aProposal();
      await harness.seed(who(harness), proposal, aRevision(1));

      strictEqual(await harness.store.markStaleIfPending(other(harness), proposal.id), 'not_found');
      strictEqual((await harness.store.findById(who(harness), proposal.id))?.status, 'pending');
    },
  },
  {
    name: 'rejects a pending proposal without reference to the revision',
    async run(harness) {
      const proposal = aProposal({ baseRevision: aRevision(5) });
      await harness.seed(who(harness), proposal, aRevision(42));

      const outcome = await harness.store.rejectIfPending(who(harness), proposal.id);

      strictEqual(outcome.kind, 'rejected');
      if (outcome.kind !== 'rejected') return;
      strictEqual(outcome.proposal.status, 'rejected');
      strictEqual((await harness.store.findById(who(harness), proposal.id))?.status, 'rejected');
      strictEqual(await harness.store.currentRevision(who(harness)), 42);
    },
  },
  {
    name: 'reports not_found when rejecting an unknown proposal',
    async run(harness) {
      deepStrictEqual(await harness.store.rejectIfPending(who(harness), 'missing'), {
        kind: 'not_found',
      });
    },
  },
  {
    name: 'isolates rejection by user',
    async run(harness) {
      const proposal = aProposal();
      await harness.seed(who(harness), proposal, aRevision(1));

      deepStrictEqual(await harness.store.rejectIfPending(other(harness), proposal.id), {
        kind: 'not_found',
      });
      strictEqual((await harness.store.findById(who(harness), proposal.id))?.status, 'pending');
    },
  },
  {
    name: 'lists only pending proposals for the named user, newest first',
    async run(harness) {
      const older = aProposal({
        id: 'prop_old',
        createdAt: new Date('2026-09-16T09:00:00.000Z'),
      });
      const newer = aProposal({
        id: 'prop_new',
        createdAt: new Date('2026-09-16T11:00:00.000Z'),
      });
      const decided = aProposal({ id: 'prop_done', status: 'accepted' });
      await harness.seed(who(harness), older, aRevision(1));
      await harness.seed(who(harness), newer, aRevision(1));
      await harness.seed(who(harness), decided, aRevision(1));
      await harness.seed(other(harness), aProposal({ id: 'prop_other' }), aRevision(1));

      const listed = await harness.store.listPending(who(harness));
      deepStrictEqual(
        listed.map((proposal) => proposal.id),
        ['prop_new', 'prop_old'],
      );
    },
  },
  {
    name: 'lets exactly one of a rejection and a stale marking win',
    async run(harness) {
      const proposal = aProposal({ baseRevision: aRevision(5) });
      await harness.seed(who(harness), proposal, aRevision(6));

      const [rejection, stale] = await Promise.all([
        harness.store.rejectIfPending(who(harness), proposal.id),
        harness.store.markStaleIfPending(who(harness), proposal.id),
      ]);

      const status = (await harness.store.findById(who(harness), proposal.id))?.status;
      strictEqual([rejection.kind === 'rejected', stale === 'marked'].filter(Boolean).length, 1);
      strictEqual(status, rejection.kind === 'rejected' ? 'rejected' : 'rejected_stale');
    },
  },
  {
    name: 'permits only one of two commits racing on the same expected revision',
    async run(harness) {
      const first = aProposal({ id: 'prop_a', baseRevision: aRevision(5) });
      const second = aProposal({ id: 'prop_b', baseRevision: aRevision(5) });
      await harness.seed(who(harness), first, aRevision(5));
      await harness.seed(who(harness), second, aRevision(5));

      const outcomes = await Promise.all(
        [first, second].map((proposal) =>
          harness.store.commitDecision({
            userId: who(harness),
            proposal: { ...proposal, status: 'accepted' },
            expectedRevision: aRevision(5),
            expectedStatus: 'pending',
            advanceRevision: true,
          }),
        ),
      );

      strictEqual(outcomes.filter((outcome) => outcome.kind === 'committed').length, 1);
      strictEqual(outcomes.filter((outcome) => outcome.kind === 'revision_changed').length, 1);
      strictEqual(await harness.store.currentRevision(who(harness)), nextRevision(aRevision(5)));
    },
  },
];
