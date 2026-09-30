import type { CorrectionActor } from './correction-revision.js';
import type { Measurement, MeasurementProfile } from './measurement.js';
import { err, ok, type Result } from './result.js';
import { nextRevision } from './revision.js';
import { type CompletedSession, isMeasurement } from './session.js';

/**
 * Completed-session immutability and audited corrections (workout-logging spec, D-012).
 *
 * Once a completed session is synchronized its recorded facts are never rewritten. A
 * correction appends a revision that names the set, the value it replaces, the corrected
 * value, who made it, and when. The original recorded measurement stays in the session, so it
 * is always retrievable, and so is every intermediate value.
 *
 * An agent never corrects data directly: its correction arrives through an accepted proposal
 * (ADR-0002), and the actor then names that proposal.
 */

export type CorrectionError =
  | { readonly kind: 'already_synchronized'; readonly sessionId: string }
  | { readonly kind: 'not_synchronized'; readonly sessionId: string }
  | { readonly kind: 'set_not_found'; readonly setId: string }
  | { readonly kind: 'not_a_measurement'; readonly setId: string }
  | {
      readonly kind: 'profile_changed';
      readonly setId: string;
      readonly from: MeasurementProfile;
      readonly to: MeasurementProfile;
    }
  | { readonly kind: 'correction_unchanged'; readonly setId: string }
  | { readonly kind: 'corrected_before_synchronization'; readonly setId: string };

export function markSynchronized(
  session: CompletedSession,
  synchronizedAt: Date,
): Result<CompletedSession, CorrectionError> {
  if (session.synchronizedAt) return err({ kind: 'already_synchronized', sessionId: session.id });
  return ok({ ...session, synchronizedAt });
}

export function originalMeasurement(
  session: CompletedSession,
  setId: string,
): Measurement | undefined {
  return session.sets.find((set) => set.setId === setId && set.deletedAt === undefined)
    ?.measurement;
}

/** The original value followed by every corrected value, oldest first. */
export function measurementHistory(
  session: CompletedSession,
  setId: string,
): readonly Measurement[] {
  const original = originalMeasurement(session, setId);
  if (!original) return [];
  return [
    original,
    ...session.corrections.filter((entry) => entry.setId === setId).map((entry) => entry.corrected),
  ];
}

export function currentMeasurement(
  session: CompletedSession,
  setId: string,
): Measurement | undefined {
  return measurementHistory(session, setId).at(-1);
}

export interface CorrectSetInput {
  readonly setId: string;
  readonly measurement: Measurement;
  readonly actor: CorrectionActor;
  readonly correctedAt: Date;
}

/** Values are plain data built from JSON-safe fields, so structural equality is exact here. */
function sameMeasurement(a: Measurement, b: Measurement): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function correctSet(
  session: CompletedSession,
  input: CorrectSetInput,
): Result<CompletedSession, CorrectionError> {
  const { setId, measurement, actor, correctedAt } = input;
  if (!session.synchronizedAt) return err({ kind: 'not_synchronized', sessionId: session.id });
  const previous = currentMeasurement(session, setId);
  if (!previous) return err({ kind: 'set_not_found', setId });
  if (!isMeasurement(measurement)) return err({ kind: 'not_a_measurement', setId });
  if (measurement.profile !== previous.profile) {
    return err({ kind: 'profile_changed', setId, from: previous.profile, to: measurement.profile });
  }
  if (sameMeasurement(previous, measurement)) return err({ kind: 'correction_unchanged', setId });
  if (correctedAt.getTime() < session.synchronizedAt.getTime()) {
    return err({ kind: 'corrected_before_synchronization', setId });
  }
  const revision = nextRevision(session.factsRevision);
  return ok({
    ...session,
    factsRevision: revision,
    corrections: [
      ...session.corrections,
      { revision, setId, previous, corrected: measurement, actor, correctedAt },
    ],
  });
}
