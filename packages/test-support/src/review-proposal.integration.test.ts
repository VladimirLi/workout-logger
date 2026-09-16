import { reviewProposal } from '@workout/application';
import { describe, expect, it } from 'vitest';
import { aProposal, aRevision, SYNTHETIC_USER_ID } from './builders.js';
import { createTestPorts, InMemoryProposalStore } from './in-memory-ports.js';
import { proposalStoreContract } from './proposal-store-contract.js';

proposalStoreContract('in-memory reference', () => {
  const store = new InMemoryProposalStore();
  return {
    store,
    seed(userId, proposal, revision) {
      store.seed(userId, proposal);
      store.setRevision(userId, revision);
    },
  };
});

describe('reviewProposal use case', () => {
  it('accepts a proposal whose base revision still matches', async () => {
    const ports = createTestPorts();
    const proposal = aProposal({ baseRevision: aRevision(5) });
    ports.proposals.setRevision(SYNTHETIC_USER_ID, aRevision(5));
    ports.proposals.seed(SYNTHETIC_USER_ID, proposal);

    const result = await reviewProposal(ports, {
      userId: SYNTHETIC_USER_ID,
      proposalId: proposal.id,
      decision: 'accept',
    });

    expect(result.ok).toBe(true);
    const stored = await ports.proposals.findById(SYNTHETIC_USER_ID, proposal.id);
    expect(stored?.status).toBe('accepted');
  });

  it('rejects as stale when the plan advanced after the proposal was created', async () => {
    const ports = createTestPorts();
    const proposal = aProposal({ baseRevision: aRevision(5) });
    ports.proposals.setRevision(SYNTHETIC_USER_ID, aRevision(6));
    ports.proposals.seed(SYNTHETIC_USER_ID, proposal);

    const result = await reviewProposal(ports, {
      userId: SYNTHETIC_USER_ID,
      proposalId: proposal.id,
      decision: 'accept',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual({
      kind: 'stale_base_revision',
      baseRevision: 5,
      currentRevision: 6,
    });
  });

  it('persists the stale marker so the agent can observe it and regenerate', async () => {
    const ports = createTestPorts();
    const proposal = aProposal({ baseRevision: aRevision(5) });
    ports.proposals.setRevision(SYNTHETIC_USER_ID, aRevision(6));
    ports.proposals.seed(SYNTHETIC_USER_ID, proposal);

    await reviewProposal(ports, {
      userId: SYNTHETIC_USER_ID,
      proposalId: proposal.id,
      decision: 'accept',
    });

    const stored = await ports.proposals.findById(SYNTHETIC_USER_ID, proposal.id);
    expect(stored?.status).toBe('rejected_stale');
  });

  it('does not write the proposed change when the proposal is stale', async () => {
    const ports = createTestPorts();
    const proposal = aProposal({ baseRevision: aRevision(5) });
    ports.proposals.setRevision(SYNTHETIC_USER_ID, aRevision(6));
    ports.proposals.seed(SYNTHETIC_USER_ID, proposal);

    await reviewProposal(ports, {
      userId: SYNTHETIC_USER_ID,
      proposalId: proposal.id,
      decision: 'accept',
    });

    expect(await ports.proposals.currentRevision(SYNTHETIC_USER_ID)).toBe(6);
  });

  it('reads the authoritative revision at decision time, not at proposal time', async () => {
    const ports = createTestPorts();
    const proposal = aProposal({ baseRevision: aRevision(5) });
    ports.proposals.setRevision(SYNTHETIC_USER_ID, aRevision(5));
    ports.proposals.seed(SYNTHETIC_USER_ID, proposal);

    // The user logs a session between reading the proposal and deciding on it.
    ports.proposals.setRevision(SYNTHETIC_USER_ID, aRevision(7));

    const result = await reviewProposal(ports, {
      userId: SYNTHETIC_USER_ID,
      proposalId: proposal.id,
      decision: 'accept',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('stale_base_revision');
  });

  it('lets the user reject a stale proposal outright', async () => {
    const ports = createTestPorts();
    const proposal = aProposal({ baseRevision: aRevision(5) });
    ports.proposals.setRevision(SYNTHETIC_USER_ID, aRevision(6));
    ports.proposals.seed(SYNTHETIC_USER_ID, proposal);

    const result = await reviewProposal(ports, {
      userId: SYNTHETIC_USER_ID,
      proposalId: proposal.id,
      decision: 'reject',
    });

    expect(result.ok).toBe(true);
    const stored = await ports.proposals.findById(SYNTHETIC_USER_ID, proposal.id);
    expect(stored?.status).toBe('rejected');
  });

  it('reports not_found for an unknown proposal without touching the plan', async () => {
    const ports = createTestPorts();

    const result = await reviewProposal(ports, {
      userId: SYNTHETIC_USER_ID,
      proposalId: 'nope',
      decision: 'accept',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual({ kind: 'not_found', proposalId: 'nope' });
  });

  it('refuses an expired proposal', async () => {
    const ports = createTestPorts(new Date('2026-09-18T10:00:00.000Z'));
    const proposal = aProposal({ baseRevision: aRevision(5) });
    ports.proposals.setRevision(SYNTHETIC_USER_ID, aRevision(5));
    ports.proposals.seed(SYNTHETIC_USER_ID, proposal);

    const result = await reviewProposal(ports, {
      userId: SYNTHETIC_USER_ID,
      proposalId: proposal.id,
      decision: 'accept',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('expired');
  });
});
