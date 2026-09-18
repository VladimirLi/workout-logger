import {
  type ActiveSession,
  type CompletedSession,
  completeSession,
  err,
  type Measurement,
  ok,
  type Result,
  recordSet,
  type SessionError,
  startSession,
  type WorkoutSession,
} from '@workout/domain';
import type {
  IdempotencyKeys,
  Ids,
  LocalWorkoutStore,
  OutboxEntry,
  PlanReader,
  WorkoutMutation,
} from './offline-ports.js';
import type { Clock } from './ports.js';

/**
 * Start, log, and complete a workout on the device (workout-logging and offline-sync specs,
 * ADR-0003).
 *
 * Each use case applies the domain rule, then commits the resulting session together with an
 * outbox entry under a fresh idempotency key in one atomic store operation. None of them waits
 * for the network: delivery is the outbox's job.
 */

export interface WorkoutPorts {
  readonly store: LocalWorkoutStore;
  readonly plans: PlanReader;
  readonly clock: Clock;
  readonly keys: IdempotencyKeys;
  readonly ids: Ids;
}

export type WorkoutCommitFailure =
  | { readonly kind: 'storage_full' }
  | { readonly kind: 'idempotency_key_reused' }
  | { readonly kind: 'already_delivered' };

export interface WorkoutChange<S extends WorkoutSession> {
  readonly session: S;
  readonly entry: OutboxEntry;
}

async function commit<S extends WorkoutSession>(
  ports: WorkoutPorts,
  userId: string,
  session: S,
  mutation: WorkoutMutation,
): Promise<Result<WorkoutChange<S>, WorkoutCommitFailure>> {
  const outcome = await ports.store.commit({
    userId,
    session,
    mutation,
    idempotencyKey: ports.keys.next(),
    enqueuedAt: ports.clock.now(),
  });
  switch (outcome.kind) {
    case 'committed':
      return ok({ session, entry: outcome.entry });
    case 'storage_full':
    case 'idempotency_key_reused':
    case 'already_delivered':
      return err({ kind: outcome.kind });
  }
}

export type StartWorkoutFailure =
  | { readonly kind: 'no_active_plan' }
  /** One active session per device: the caller offers resume or discard (task 5.3). */
  | { readonly kind: 'session_already_active'; readonly session: ActiveSession }
  | SessionError
  | WorkoutCommitFailure;

export async function startWorkout(
  ports: WorkoutPorts,
  command: { readonly userId: string; readonly scheduledSessionId: string },
): Promise<Result<WorkoutChange<ActiveSession>, StartWorkoutFailure>> {
  const existing = await ports.store.activeSession(command.userId);
  if (existing) return err({ kind: 'session_already_active', session: existing });

  const plan = await ports.plans.activePlan(command.userId);
  if (!plan) return err({ kind: 'no_active_plan' });

  const started = startSession(plan, {
    id: ports.ids.next(),
    scheduledSessionId: command.scheduledSessionId,
    startedAt: ports.clock.now(),
  });
  if (!started.ok) return started;

  return commit(ports, command.userId, started.value, {
    kind: 'start_session',
    session: started.value,
  });
}

export type LogSetFailure =
  | { readonly kind: 'session_not_found'; readonly sessionId: string }
  | SessionError
  | WorkoutCommitFailure;

export async function logSet(
  ports: WorkoutPorts,
  command: {
    readonly userId: string;
    readonly sessionId: string;
    readonly exerciseId: string;
    readonly measurement: Measurement;
  },
): Promise<Result<WorkoutChange<ActiveSession>, LogSetFailure>> {
  const session = await ports.store.findSession(command.userId, command.sessionId);
  if (!session) return err({ kind: 'session_not_found', sessionId: command.sessionId });

  const recorded = recordSet(session, {
    setId: ports.ids.next(),
    exerciseId: command.exerciseId,
    measurement: command.measurement,
    recordedAt: ports.clock.now(),
  });
  if (!recorded.ok) return recorded;

  const set = recorded.value.sets.at(-1);
  if (!set) throw new Error('recordSet returned a session without the recorded set');
  return commit(ports, command.userId, recorded.value, {
    kind: 'record_set',
    sessionId: session.id,
    set,
  });
}

export type CompleteWorkoutFailure =
  | { readonly kind: 'session_not_found'; readonly sessionId: string }
  | SessionError
  | WorkoutCommitFailure;

export async function completeWorkout(
  ports: WorkoutPorts,
  command: { readonly userId: string; readonly sessionId: string },
): Promise<Result<WorkoutChange<CompletedSession>, CompleteWorkoutFailure>> {
  const session = await ports.store.findSession(command.userId, command.sessionId);
  if (!session) return err({ kind: 'session_not_found', sessionId: command.sessionId });

  const completed = completeSession(session, ports.clock.now());
  if (!completed.ok) return completed;

  return commit(ports, command.userId, completed.value, {
    kind: 'complete_session',
    sessionId: session.id,
    completedAt: completed.value.completedAt,
  });
}

export type DiscardWorkoutFailure =
  | { readonly kind: 'not_confirmed' }
  | { readonly kind: 'session_not_found'; readonly sessionId: string }
  | { readonly kind: 'session_not_active'; readonly sessionId: string };

/**
 * Discards an active session and everything queued for it (task 5.3).
 *
 * Destructive by design: the workout-logging spec says discarding loses recorded results, and
 * asks for a confirmation before it happens. The confirmation is a parameter rather than
 * something the caller is trusted to have done, so a screen cannot reach this by accident and
 * a reviewer can see where the decision was made.
 *
 * Only an active session can be discarded. A completed one is a fact that has been recorded,
 * and it goes through export and deletion (section 8) rather than through this.
 */
export async function discardWorkout(
  ports: WorkoutPorts,
  command: {
    readonly userId: string;
    readonly sessionId: string;
    /** True only when the user has confirmed, having been told what is lost. */
    readonly confirmed: boolean;
  },
): Promise<Result<{ readonly discarded: ActiveSession }, DiscardWorkoutFailure>> {
  if (!command.confirmed) return err({ kind: 'not_confirmed' });

  const session = await ports.store.findSession(command.userId, command.sessionId);
  if (!session) return err({ kind: 'session_not_found', sessionId: command.sessionId });
  if (session.status !== 'active') {
    return err({ kind: 'session_not_active', sessionId: command.sessionId });
  }

  await ports.store.discardSession(command.userId, command.sessionId);
  return ok({ discarded: session });
}
