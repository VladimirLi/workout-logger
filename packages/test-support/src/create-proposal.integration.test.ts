import { createHash, randomUUID } from 'node:crypto';
import { createProposal } from '@workout/application';
import { aRevision, createTestPorts, SYNTHETIC_USER_ID } from '@workout/test-support';
import { describe, expect, it } from 'vitest';

const REPLACE_DIFF = {
  op: 'replace_plan' as const,
  name: 'Synthetic plan',
  sessions: [
    {
      id: 'sess_1',
      name: 'Synthetic session',
      scheduledFor: '2026-09-20',
      exercises: [
        {
          exerciseId: 'ex_squat',
          name: 'Synthetic exercise',
          prescription: { profile: 'strength' as const, schemaVersion: 1 as const, repetitions: 5 },
        },
      ],
    },
  ],
};

function identity(rationale: string, baseRevision: number) {
  const digest = createHash('sha256')
    .update(JSON.stringify({ rationale, baseRevision, diff: REPLACE_DIFF }))
    .digest('hex');
  return { id: `prop_${randomUUID()}`, inputHash: `sha256:${digest}` };
}

describe('createProposal (tasks 6.8 and 6.9)', () => {
  it('records a pending proposal and leaves the plan revision unchanged', async () => {
    const ports = createTestPorts();
    ports.proposals.setRevision(SYNTHETIC_USER_ID, aRevision(3));
    const ids = identity('Swap volume for intensity.', 3);

    const result = await createProposal(ports, {
      userId: SYNTHETIC_USER_ID,
      actor: { clientId: 'client_1', actorId: 'agent_1' },
      baseRevision: 3,
      rationale: 'Swap volume for intensity.',
      diff: REPLACE_DIFF,
      ...ids,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe('pending');
    expect(result.value.baseRevision).toBe(aRevision(3));
    expect(await ports.proposals.currentRevision(SYNTHETIC_USER_ID)).toBe(aRevision(3));
    expect(await ports.proposals.listPending(SYNTHETIC_USER_ID)).toHaveLength(1);
  });

  it('refuses a proposal against a non-current base revision', async () => {
    const ports = createTestPorts();
    ports.proposals.setRevision(SYNTHETIC_USER_ID, aRevision(4));
    const ids = identity('Regenerate me.', 3);

    const result = await createProposal(ports, {
      userId: SYNTHETIC_USER_ID,
      actor: { clientId: 'client_1', actorId: 'agent_1' },
      baseRevision: 3,
      rationale: 'Regenerate me.',
      diff: REPLACE_DIFF,
      ...ids,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual({
      kind: 'stale_base_revision',
      baseRevision: aRevision(3),
      currentRevision: aRevision(4),
    });
    expect(await ports.proposals.listPending(SYNTHETIC_USER_ID)).toHaveLength(0);
    expect(await ports.proposals.currentRevision(SYNTHETIC_USER_ID)).toBe(aRevision(4));
  });

  it('refuses a proposal with an empty rationale', async () => {
    const ports = createTestPorts();
    ports.proposals.setRevision(SYNTHETIC_USER_ID, aRevision(1));
    const ids = identity('   ', 1);

    const result = await createProposal(ports, {
      userId: SYNTHETIC_USER_ID,
      actor: { clientId: 'client_1', actorId: 'agent_1' },
      baseRevision: 1,
      rationale: '   ',
      diff: REPLACE_DIFF,
      ...ids,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('invalid_rationale');
  });
});
