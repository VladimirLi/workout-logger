import { ARCHIVE_SCHEMA_VERSION, type ArchivePayload, archiveSchema } from '@workout/contracts';
import {
  type CompletedSession,
  type CorrectionRevision,
  cardioExertion,
  cardioMeasurement,
  type ExertionError,
  err,
  kilograms,
  type Measurement,
  type MeasurementError,
  metres,
  ok,
  type Plan,
  type QuantityError,
  type RecordedSet,
  type Result,
  type Revision,
  seconds,
  strengthExertion,
  strengthMeasurement,
  unilateralStrengthMeasurement,
  type WorkoutSession,
} from '@workout/domain';
import type { Clock } from './ports.js';

/**
 * Getting everything out, and back in (data-portability spec, tasks 8.1, 8.2, 4.9).
 *
 * Export reads through a port rather than a provider, so the same use case exports from the
 * device store and, once one exists, from the server. Import writes through the matching port,
 * which is how "round-trips into a clean compatible instance" is a test rather than a promise.
 *
 * The document is validated on the way in, by the same schema that describes what is written.
 * An unknown field is a refusal, not a silent drop: an import that quietly discarded what it
 * did not understand would lose exactly the data the export exists to protect.
 */

/** Everything an export reads. Separate from the outbox port: reading all history is not logging. */
export interface ArchiveSource {
  plans(userId: string): Promise<readonly Plan[]>;
  sessions(userId: string): Promise<readonly WorkoutSession[]>;
  /** Proposal artifacts, carried through untouched. Empty where no proposal store is wired. */
  proposals?(userId: string): Promise<readonly Record<string, unknown>[]>;
}

/** Everything an import writes. A clean instance is one where all of these are empty. */
export interface ArchiveSink {
  putPlan(userId: string, plan: Plan): Promise<void>;
  putSession(userId: string, session: WorkoutSession): Promise<void>;
  putProposal?(userId: string, proposal: Record<string, unknown>): Promise<void>;
}

const instant = (at: Date): string => at.toISOString();

function planPayload(plan: Plan): ArchivePayload['plans'][number] {
  const base = {
    id: plan.id,
    revision: plan.revision,
    sessions: plan.sessions.map((session) => ({
      id: session.id,
      scheduledFor: session.scheduledFor,
      exercises: session.exercises.map((exercise) => ({
        exerciseId: exercise.exerciseId,
        prescription: exercise.prescription,
      })),
    })),
    activatedAt: instant(plan.activatedAt),
  };
  return plan.status === 'active'
    ? { status: 'active', ...base }
    : { status: 'superseded', ...base, supersededAt: instant(plan.supersededAt) };
}

function sessionPayload(session: WorkoutSession): ArchivePayload['sessions'][number] {
  const base = {
    id: session.id,
    planId: session.planId,
    planRevision: session.planRevision,
    scheduledSessionId: session.scheduledSessionId,
    exerciseIds: [...session.exerciseIds],
    startedAt: instant(session.startedAt),
    sets: session.sets.map((set) => ({
      setId: set.setId,
      exerciseId: set.exerciseId,
      sequence: set.sequence,
      measurement: set.measurement,
      recordedAt: instant(set.recordedAt),
    })),
  };
  if (session.status === 'active') return { status: 'active', ...base };
  return {
    status: 'completed',
    ...base,
    completedAt: instant(session.completedAt),
    // exactOptionalPropertyTypes: the key is absent rather than present-and-undefined, which
    // is also what the strict schema requires of an export made before any sync.
    ...(session.synchronizedAt ? { synchronizedAt: instant(session.synchronizedAt) } : {}),
    factsRevision: session.factsRevision,
    corrections: session.corrections.map((correction) => ({
      revision: correction.revision,
      setId: correction.setId,
      previous: correction.previous,
      corrected: correction.corrected,
      actor: { kind: correction.actor.kind, id: correction.actor.id },
      correctedAt: instant(correction.correctedAt),
    })),
  };
}

/** The one action behind "export everything" (data-portability: one-action full JSON export). */
export async function exportArchive(
  ports: { readonly source: ArchiveSource; readonly clock: Clock },
  userId: string,
): Promise<ArchivePayload> {
  const [plans, sessions, proposals] = await Promise.all([
    ports.source.plans(userId),
    ports.source.sessions(userId),
    ports.source.proposals?.(userId) ?? Promise.resolve([]),
  ]);

  const payload: ArchivePayload = {
    schemaVersion: ARCHIVE_SCHEMA_VERSION,
    exportedAt: instant(ports.clock.now()),
    plans: plans.map(planPayload),
    sessions: sessions.map(sessionPayload),
    proposals: proposals.map((proposal) => ({ ...proposal })),
  };
  // Validated on the way out too: an export this application cannot read back is not an
  // export, and finding that out at import time would be finding out too late.
  return archiveSchema.parse(payload);
}

export type ArchiveImportError =
  | { readonly kind: 'not_an_archive'; readonly problems: readonly string[] }
  | { readonly kind: 'unsupported_version'; readonly received: number }
  | { readonly kind: 'instance_not_clean'; readonly plans: number; readonly sessions: number }
  /** The shape was right and a value was not: the domain refused to rebuild it. */
  | { readonly kind: 'invalid_value'; readonly problem: ArchiveValueError };

export interface ArchiveImportReport {
  readonly plans: number;
  readonly sessions: number;
  readonly proposals: number;
}

export type ArchiveValueError = MeasurementError | ExertionError | QuantityError;

type MeasurementPayload = ArchivePayload['sessions'][number]['sets'][number]['measurement'];

/**
 * Rebuilds a measurement through the domain's own factories.
 *
 * The schema checks the document's shape; the domain checks the values, which is where the
 * rules live. Casting the payload into the domain type would import a measurement this
 * application could never have produced - an RPE that does not follow from its RIR, a load of
 * NaN - and it would look like valid history forever after.
 */
type CardioPayload = Extract<MeasurementPayload, { profile: 'cardio' }>;
type StrengthPayload = Exclude<MeasurementPayload, { profile: 'cardio' }>;

function cardioFrom(payload: CardioPayload): Result<Measurement, ArchiveValueError> {
  const duration = seconds(payload.duration.value);
  if (!duration.ok) return duration;
  const distance = payload.distance ? metres(payload.distance.value) : undefined;
  if (distance && !distance.ok) return distance;
  const exertion = payload.exertion ? cardioExertion(payload.exertion.borg) : undefined;
  if (exertion && !exertion.ok) return exertion;

  return cardioMeasurement({
    duration: duration.value,
    ...(distance?.ok ? { distance: distance.value } : {}),
    ...(payload.inclinePercent === undefined ? {} : { inclinePercent: payload.inclinePercent }),
    ...(exertion?.ok ? { exertion: exertion.value } : {}),
    ...(payload.notes === undefined ? {} : { notes: payload.notes }),
  });
}

function strengthFrom(payload: StrengthPayload): Result<Measurement, ArchiveValueError> {
  const load = payload.load ? kilograms(payload.load.value) : undefined;
  if (load && !load.ok) return load;
  // Rebuilt from the RIR, so a document claiming an RPE that does not follow cannot get in.
  const exertion = payload.exertion ? strengthExertion(payload.exertion.rir.value) : undefined;
  if (exertion && !exertion.ok) return exertion;

  const shared = {
    repetitions: payload.repetitions,
    ...(load?.ok ? { load: load.value } : {}),
    ...(exertion?.ok ? { exertion: exertion.value } : {}),
    ...(payload.notes === undefined ? {} : { notes: payload.notes }),
  };
  return payload.profile === 'unilateral_strength'
    ? unilateralStrengthMeasurement({
        ...shared,
        side: payload.side,
        loadSemantics: payload.loadSemantics,
      })
    : strengthMeasurement(shared);
}

/**
 * Rebuilds a measurement through the domain's own factories.
 *
 * The schema checks the document's shape; the domain checks the values, which is where the
 * rules live. Casting the payload into the domain type would import a measurement this
 * application could never have produced - an RPE that does not follow from its RIR, a load of
 * NaN - and it would look like valid history forever after.
 */
function measurementFrom(payload: MeasurementPayload): Result<Measurement, ArchiveValueError> {
  return payload.profile === 'cardio' ? cardioFrom(payload) : strengthFrom(payload);
}

function planFrom(payload: ArchivePayload['plans'][number]): Result<Plan, ArchiveValueError> {
  const sessions = [];
  for (const scheduled of payload.sessions) {
    const exercises = [];
    for (const exercise of scheduled.exercises) {
      const prescription = measurementFrom(exercise.prescription);
      if (!prescription.ok) return prescription;
      exercises.push({ exerciseId: exercise.exerciseId, prescription: prescription.value });
    }
    sessions.push({ id: scheduled.id, scheduledFor: scheduled.scheduledFor, exercises });
  }
  const base = {
    id: payload.id,
    revision: payload.revision as Revision,
    sessions,
    activatedAt: new Date(payload.activatedAt),
  };
  return ok(
    payload.status === 'active'
      ? { status: 'active', ...base }
      : { status: 'superseded', ...base, supersededAt: new Date(payload.supersededAt) },
  );
}

function sessionFrom(
  payload: ArchivePayload['sessions'][number],
): Result<WorkoutSession, ArchiveValueError> {
  const sets: RecordedSet[] = [];
  for (const set of payload.sets) {
    const measurement = measurementFrom(set.measurement);
    if (!measurement.ok) return measurement;
    sets.push({
      setId: set.setId,
      exerciseId: set.exerciseId,
      sequence: set.sequence,
      measurement: measurement.value,
      recordedAt: new Date(set.recordedAt),
    });
  }

  const base = {
    id: payload.id,
    planId: payload.planId,
    planRevision: payload.planRevision as Revision,
    scheduledSessionId: payload.scheduledSessionId,
    exerciseIds: payload.exerciseIds,
    startedAt: new Date(payload.startedAt),
    sets,
  };
  if (payload.status === 'active') return ok({ status: 'active', ...base });

  const corrections: CorrectionRevision[] = [];
  for (const correction of payload.corrections) {
    const previous = measurementFrom(correction.previous);
    if (!previous.ok) return previous;
    const corrected = measurementFrom(correction.corrected);
    if (!corrected.ok) return corrected;
    corrections.push({
      revision: correction.revision as Revision,
      setId: correction.setId,
      previous: previous.value,
      corrected: corrected.value,
      actor: { kind: correction.actor.kind, id: correction.actor.id },
      correctedAt: new Date(correction.correctedAt),
    });
  }

  const completed: CompletedSession = {
    status: 'completed',
    ...base,
    completedAt: new Date(payload.completedAt),
    ...(payload.synchronizedAt ? { synchronizedAt: new Date(payload.synchronizedAt) } : {}),
    factsRevision: payload.factsRevision as Revision,
    corrections,
  };
  return ok(completed);
}

/**
 * Imports an export into a clean instance. Refuses a non-empty one rather than merging: a
 * merge has questions an import cannot answer on the user's behalf, such as which of two
 * sessions with the same id is the real one.
 */
export async function importArchive(
  ports: { readonly sink: ArchiveSink; readonly source: ArchiveSource },
  userId: string,
  document: unknown,
): Promise<Result<ArchiveImportReport, ArchiveImportError>> {
  const version = (document as { schemaVersion?: unknown } | null)?.schemaVersion;
  if (typeof version === 'number' && version !== ARCHIVE_SCHEMA_VERSION) {
    return err({ kind: 'unsupported_version', received: version });
  }

  const parsed = archiveSchema.safeParse(document);
  if (!parsed.success) {
    return err({
      kind: 'not_an_archive',
      problems: parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
    });
  }

  const [existingPlans, existingSessions] = await Promise.all([
    ports.source.plans(userId),
    ports.source.sessions(userId),
  ]);
  if (existingPlans.length > 0 || existingSessions.length > 0) {
    return err({
      kind: 'instance_not_clean',
      plans: existingPlans.length,
      sessions: existingSessions.length,
    });
  }

  for (const payload of parsed.data.plans) {
    const rebuilt = planFrom(payload);
    if (!rebuilt.ok) return err({ kind: 'invalid_value', problem: rebuilt.error });
    await ports.sink.putPlan(userId, rebuilt.value);
  }
  for (const payload of parsed.data.sessions) {
    const rebuilt = sessionFrom(payload);
    if (!rebuilt.ok) return err({ kind: 'invalid_value', problem: rebuilt.error });
    await ports.sink.putSession(userId, rebuilt.value);
  }
  let proposals = 0;
  for (const payload of parsed.data.proposals) {
    if (!ports.sink.putProposal) break;
    await ports.sink.putProposal(userId, payload);
    proposals += 1;
  }

  return ok({
    plans: parsed.data.plans.length,
    sessions: parsed.data.sessions.length,
    proposals,
  });
}
