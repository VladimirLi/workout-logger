import {
  type Proposal,
  type ProposalStatus,
  type Revision,
  revision,
  unwrap,
} from '@workout/domain';

/**
 * Synthetic builders. Every field has a boring default so a test names only the
 * one thing it is actually about.
 */

export const SYNTHETIC_USER_ID = 'synthetic-user-0000';

export function aRevision(value = 1): Revision {
  return unwrap(revision(value));
}

export interface ProposalOverrides {
  readonly id?: string;
  readonly baseRevision?: Revision;
  readonly rationale?: string;
  readonly createdAt?: Date;
  readonly expiresAt?: Date;
  readonly status?: ProposalStatus;
}

export function aProposal(overrides: ProposalOverrides = {}): Proposal {
  return {
    id: overrides.id ?? 'prop_synthetic_01',
    actor: { clientId: 'client_synthetic', actorId: 'agent_synthetic' },
    baseRevision: overrides.baseRevision ?? aRevision(1),
    diff: {
      op: 'replace_plan',
      name: 'Synthetic plan',
      sessions: [
        {
          id: 'sess_synthetic_01',
          name: 'Synthetic session',
          scheduledFor: '2026-09-20',
          exercises: [
            {
              exerciseId: 'ex_synthetic',
              name: 'Synthetic exercise',
              prescription: { profile: 'strength', schemaVersion: 1, repetitions: 5 },
            },
          ],
        },
      ],
    },
    rationale: overrides.rationale ?? 'Synthetic rationale.',
    inputHash: `sha256:${'0'.repeat(64)}`,
    createdAt: overrides.createdAt ?? new Date('2026-09-16T10:00:00.000Z'),
    expiresAt: overrides.expiresAt ?? new Date('2026-09-17T10:00:00.000Z'),
    status: overrides.status ?? 'pending',
  };
}
