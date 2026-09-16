import { describe, expect, it } from 'vitest';
import { measurementSchema } from './measurement.js';
import { massSchema, paginationSchema } from './primitives.js';
import { proposalRejectionSchema, proposalSchema } from './proposal.js';

const VALID_PROPOSAL = {
  id: 'prop_01',
  actor: { clientId: 'client_abc', actorId: 'agent_planner' },
  baseRevision: 7,
  diff: {
    op: 'replace_plan',
    sessions: [
      {
        id: 'sess_01',
        scheduledFor: '2026-09-20',
        exercises: [
          {
            exerciseId: 'ex_bench',
            prescription: { profile: 'strength', schemaVersion: 1, repetitions: 5 },
          },
        ],
      },
    ],
  },
  rationale: 'Deload week.',
  inputHash: `sha256:${'a'.repeat(64)}`,
  createdAt: '2026-09-16T10:00:00.000Z',
  expiresAt: '2026-09-16T11:00:00.000Z',
  status: 'pending',
};

describe('schemas are closed', () => {
  it('rejects an unknown field on a proposal instead of dropping it', () => {
    const result = proposalSchema.safeParse({ ...VALID_PROPOSAL, autoApply: true });
    expect(result.success).toBe(false);
  });

  it('rejects an unknown field on a measurement', () => {
    const result = measurementSchema.safeParse({
      profile: 'strength',
      schemaVersion: 1,
      repetitions: 5,
      secretFlag: 1,
    });
    expect(result.success).toBe(false);
  });

  it('rejects an unknown field on a quantity', () => {
    expect(massSchema.safeParse({ unit: 'kg', value: 1, raw: 2 }).success).toBe(false);
  });

  it('rejects a quantity whose unit does not match its field dimension', () => {
    expect(massSchema.safeParse({ unit: 's', value: 1 }).success).toBe(false);
  });
});

describe('proposal contract', () => {
  it('accepts a well-formed proposal', () => {
    expect(proposalSchema.safeParse(VALID_PROPOSAL).success).toBe(true);
  });

  it('requires a base revision', () => {
    const { baseRevision: _omitted, ...withoutBase } = VALID_PROPOSAL;
    expect(proposalSchema.safeParse(withoutBase).success).toBe(false);
  });

  it('requires a non-empty rationale', () => {
    expect(proposalSchema.safeParse({ ...VALID_PROPOSAL, rationale: '' }).success).toBe(false);
  });

  it('requires a sha256 input hash', () => {
    expect(proposalSchema.safeParse({ ...VALID_PROPOSAL, inputHash: 'deadbeef' }).success).toBe(
      false,
    );
  });

  it('exposes stale rejection with both revisions so an agent can regenerate', () => {
    const parsed = proposalRejectionSchema.safeParse({
      kind: 'stale_base_revision',
      baseRevision: 7,
      currentRevision: 8,
    });
    expect(parsed.success).toBe(true);
  });
});

describe('measurement contract', () => {
  it('discriminates on profile', () => {
    const cardio = measurementSchema.safeParse({
      profile: 'cardio',
      schemaVersion: 1,
      duration: { unit: 's', value: 1200 },
    });
    expect(cardio.success).toBe(true);
  });

  it('requires explicit side and load semantics for unilateral work', () => {
    const missing = measurementSchema.safeParse({
      profile: 'unilateral_strength',
      schemaVersion: 1,
      repetitions: 10,
    });
    expect(missing.success).toBe(false);
  });

  it('rejects a Borg value in a strength exertion field', () => {
    const result = measurementSchema.safeParse({
      profile: 'strength',
      schemaVersion: 1,
      repetitions: 5,
      exertion: { profile: 'cardio', borg: 13 },
    });
    expect(result.success).toBe(false);
  });
});

describe('pagination', () => {
  it('defaults the page size and caps it', () => {
    expect(paginationSchema.parse({}).limit).toBe(50);
    expect(paginationSchema.safeParse({ limit: 1_000 }).success).toBe(false);
  });
});
