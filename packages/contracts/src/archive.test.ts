import { describe, expect, it } from 'vitest';
import { archiveSchema } from './archive.js';

/**
 * The archive contract's own timestamps and dates.
 *
 * An archive is a file a person can hold, edit and re-import, so it is the least trusted input the
 * product has. Its instants were validated as "any string `Date.parse` accepts", which is not the
 * ISO-8601 instant with an offset the comment beside it promised: `Date.parse` takes a bare date,
 * a space-separated timestamp, and `Sep 18 2026`, and interprets a time without a zone in
 * whatever zone the machine happens to be in. A session then moves by hours between the device
 * that exported it and the one that imported it.
 *
 * `packages/contracts/src/primitives.ts` already states both rules for the rest of the product, so
 * these cases pin the archive to them rather than to a second, weaker copy.
 */

const A_MEASUREMENT = { schemaVersion: 1, profile: 'strength', repetitions: 8 } as const;

function anArchive(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    exportedAt: '2026-09-19T10:00:00.000Z',
    plans: [
      {
        status: 'active',
        id: 'plan-1',
        revision: 1,
        activatedAt: '2026-09-18T00:00:00.000Z',
        sessions: [
          {
            id: 'session-mon',
            scheduledFor: '2026-09-21',
            exercises: [{ exerciseId: 'split-squat', prescription: A_MEASUREMENT }],
          },
        ],
      },
    ],
    sessions: [
      {
        status: 'completed',
        id: 'workout-1',
        planId: 'plan-1',
        planRevision: 1,
        scheduledSessionId: 'session-mon',
        exerciseIds: ['split-squat'],
        combinedLoadExercises: [],
        startedAt: '2026-09-19T09:00:00.000Z',
        completedAt: '2026-09-19T09:45:00.000Z',
        factsRevision: 1,
        corrections: [],
        sets: [
          {
            setId: 'set-1',
            exerciseId: 'split-squat',
            sequence: 1,
            measurement: A_MEASUREMENT,
            recordedAt: '2026-09-19T09:10:00.000Z',
          },
        ],
      },
    ],
    proposals: [],
    ...overrides,
  };
}

/** Replaces one instant deep in the document, leaving everything else valid. */
function withExportedAt(value: unknown): Record<string, unknown> {
  return anArchive({ exportedAt: value });
}

describe('the archive contract', () => {
  it('accepts an archive the product itself writes', () => {
    const result = archiveSchema.safeParse(anArchive());
    expect(result.success, JSON.stringify(result.error?.issues.slice(0, 3))).toBe(true);
  });

  it.each([
    ['a date with no time', '2026-09-19'],
    ['a space-separated timestamp', '2026-09-19 10:00:00+00'],
    ['a time with no offset, which means whatever zone the reader is in', '2026-09-19T10:00:00'],
    ['a written-out date', 'Sep 19 2026'],
    ['a number of milliseconds', 1_758_268_800_000],
    ['an empty string', ''],
  ])('refuses %s as an instant', (_label, value) => {
    expect(archiveSchema.safeParse(withExportedAt(value)).success).toBe(false);
  });

  it('refuses a loose instant wherever one appears, not only at the top', () => {
    const cases = [
      anArchive({
        plans: [{ ...(anArchive().plans as never[])[0], activatedAt: '2026-09-18' }],
      }),
      anArchive({
        sessions: [{ ...(anArchive().sessions as never[])[0], startedAt: '2026-09-19 09:00:00' }],
      }),
      anArchive({
        sessions: [
          {
            ...(anArchive().sessions as never[])[0],
            completedAt: '2026-09-19T09:45:00',
          },
        ],
      }),
    ];
    for (const archive of cases) {
      expect(archiveSchema.safeParse(archive).success).toBe(false);
    }
  });

  it('accepts the offsets a real export carries', () => {
    // Both the `Z` the product writes and the `+00:00` a database returns, at any precision.
    for (const value of [
      '2026-09-19T10:00:00Z',
      '2026-09-19T10:00:00.872+00:00',
      '2026-09-19T10:00:00.932021+00:00',
      '2026-09-19T12:00:00+02:00',
    ]) {
      expect(archiveSchema.safeParse(withExportedAt(value)).success, value).toBe(true);
    }
  });

  it('refuses a scheduled date that is not a real day', () => {
    // The bare `YYYY-MM-DD` shape accepts 2026-02-30, which becomes 2 March when a reader
    // constructs a date from it: the session silently moves rather than being refused.
    const plan = (anArchive().plans as Record<string, unknown>[])[0] as Record<string, unknown>;
    const sessions = (plan['sessions'] as Record<string, unknown>[]).map((session) => ({
      ...session,
      scheduledFor: '2026-02-30',
    }));
    expect(archiveSchema.safeParse(anArchive({ plans: [{ ...plan, sessions }] })).success).toBe(
      false,
    );
  });
});
