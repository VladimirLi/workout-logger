import {
  cryptoIdempotencyKeys,
  cryptoIds,
  FlushTriggers,
  IndexedDbArchive,
  IndexedDbDeletionStore,
  IndexedDbDeviceIdentity,
  IndexedDbPlanStore,
  IndexedDbProposalStore,
  IndexedDbWorkoutStore,
  requestPersistentStorage,
} from '@workout/adapters-browser';
import {
  browserConfig,
  createEmailAuth,
  SupabaseWorkoutTransport,
} from '@workout/adapters-supabase';
import {
  clearLocalDataAfterExport,
  completeWorkout,
  type DeletionPorts,
  deleteRecordedSet,
  deriveSyncState,
  discardWorkout,
  drainOutbox,
  editRecordedSet,
  exportArchive,
  exportHistoryCsv,
  logSet,
  type PendingDeletion,
  purgeExpiredDeletion,
  type ReviewDecision,
  recoverDeletion,
  requestEmailSignInCode,
  restoreRecordedSet,
  reviewAndApplyProposal,
  type SyncState,
  scheduleRecoverableDeletion,
  startWorkout,
  verifyEmailSignInCode,
  type WorkoutPorts,
} from '@workout/application';
import {
  err,
  kilograms,
  type LoadSemantics,
  liveSets,
  type Measurement,
  type Proposal,
  type Result,
  type Side,
  strengthExertion,
  strengthMeasurement,
  unilateralStrengthMeasurement,
} from '@workout/domain';
import { displayName } from '../ui';

/**
 * The browser composition root (ADR-0001): the only place that knows which adapter implements
 * which port.
 *
 * A `.ts` file rather than a component, because screens compose the design system and nothing
 * else. They import from here for data and from `../ui` for everything visible.
 *
 * Everything is created once, lazily, and only in the browser: IndexedDB does not exist while
 * Next.js renders on the server, and a module that reached for it at import time would break
 * the build rather than the page.
 */

/**
 * The name to show for an exercise: the one the plan gave it and the session kept, or - only
 * for data that has no name - its id read as words, or its position where the id is not words.
 */
export const exerciseName = (exerciseId: string, index: number, name?: string): string =>
  name ?? displayName(exerciseId, `Exercise ${index + 1}`);

/** The name to show for a session: the one it kept from the plan, else its id read as words. */
export const sessionName = (session: {
  readonly name?: string | undefined;
  readonly scheduledSessionId: string;
}): string => session.name ?? displayName(session.scheduledSessionId, 'Workout');

/** The rest length used only where the plan carries none, or the revision has moved on. */
export const FALLBACK_REST_SECONDS = 90;

/**
 * The design system names the three sync states differently from the application port
 * (`on-device` against `saved_on_device`). Mapped here, once, rather than in each screen: a
 * screen guessing at the mapping is how a state ends up displayed as another one.
 */
export type DisplaySyncState = 'on-device' | 'syncing' | 'needs-attention';

const DISPLAY: Record<SyncState, DisplaySyncState> = {
  saved_on_device: 'on-device',
  syncing: 'syncing',
  needs_attention: 'needs-attention',
};

export const displaySyncState = (state: SyncState | undefined): DisplaySyncState | undefined =>
  state === undefined ? undefined : DISPLAY[state];

export interface Device {
  readonly ports: WorkoutPorts;
  readonly archive: IndexedDbArchive;
  readonly deletions: IndexedDbDeletionStore;
  readonly proposals: IndexedDbProposalStore;
  readonly identity: IndexedDbDeviceIdentity;
  readonly plans: IndexedDbPlanStore;
  /** Who the device records for until an account claims it (identity spec, task 3.6). */
  userId(): Promise<string>;
}

let device: Device | undefined;

export function deviceOf(): Device {
  if (typeof indexedDB === 'undefined') {
    throw new Error('the device store is only available in a browser');
  }
  if (device) return device;

  const store = new IndexedDbWorkoutStore();
  const plans = new IndexedDbPlanStore();
  const identity = new IndexedDbDeviceIdentity();
  const archive = new IndexedDbArchive();
  const deletions = new IndexedDbDeletionStore();
  const proposals = new IndexedDbProposalStore();
  const ports: WorkoutPorts = {
    store,
    plans,
    clock: { now: () => new Date() },
    keys: cryptoIdempotencyKeys,
    ids: cryptoIds,
  };

  device = {
    ports,
    archive,
    deletions,
    proposals,
    identity,
    plans,
    userId: async () => {
      const current = await identity.current();
      return current.claimedBy ?? current.userId;
    },
  };
  return device;
}

function deletionPorts(): DeletionPorts & { readonly userId: () => Promise<string> } {
  const { archive, deletions, ports, userId } = deviceOf();
  return {
    source: archive,
    sink: archive,
    eraser: archive,
    deletions,
    clock: ports.clock,
    userId,
  };
}

export async function readPendingDeletion(): Promise<PendingDeletion | undefined> {
  const ports = deletionPorts();
  const user = await ports.userId();
  const pending = await ports.deletions.get(user);
  if (!pending) return undefined;
  if (ports.clock.now().getTime() >= pending.recoverableUntil.getTime()) {
    await purgeExpiredDeletion(ports, user);
    return undefined;
  }
  return pending;
}

export async function deleteAllHistory() {
  const ports = deletionPorts();
  return scheduleRecoverableDeletion(ports, await ports.userId());
}

export async function restoreDeletedHistory() {
  const ports = deletionPorts();
  return recoverDeletion(ports, await ports.userId());
}

/** What the plan screen needs: the plan as last downloaded, and any session in progress. */
export async function readToday() {
  const { ports, userId } = deviceOf();
  const user = await userId();
  const [plan, active] = await Promise.all([
    ports.plans.activePlan(user),
    ports.store.activeSession(user),
  ]);
  // A scheduled session with a finished workout is done: Today stops offering it (spec D-26).
  const completed = plan
    ? new Set(
        (await deviceOf().archive.sessions(user))
          .filter((session) => session.status === 'completed' && session.planId === plan.id)
          .map((session) => session.scheduledSessionId),
      )
    : new Set<string>();
  return { user, plan, active, completed };
}

export async function readSession(sessionId: string) {
  const { ports, userId } = deviceOf();
  const user = await userId();
  const [session, outbox] = await Promise.all([
    ports.store.findSession(user, sessionId),
    ports.store.outbox(user),
  ]);
  const pending = outbox.filter((entry) => entry.entityId === sessionId);
  return { user, session, sync: displaySyncState(deriveSyncState(pending)) };
}

export async function readHistory() {
  const { archive, userId } = deviceOf();
  return (await archive.sessions(await userId()))
    .filter((session) => session.status === 'completed')
    .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());
}

/**
 * Prescriptions for the active session's exercises, in their scheduled order.
 *
 * Read only from the plan revision the session was started on. The device keeps one record
 * per plan, so a downloaded new revision overwrites the old one; taking targets from whatever
 * is active now would silently retarget a workout already in progress. A started workout is a
 * snapshot (session.ts) and the screen must not contradict it, so a revision that no longer
 * matches counts as "the plan this was started from is not on this device" and yields no
 * prescription at all rather than numbers nobody prescribed.
 */
export async function readActivePrescriptions() {
  const { ports, userId } = deviceOf();
  const user = await userId();
  const session = await ports.store.activeSession(user);
  if (!session) return undefined;
  const plan = await ports.plans.activePlan(user);
  if (plan?.id !== session.planId || plan.revision !== session.planRevision) return undefined;
  const scheduled = plan.sessions.find((item) => item.id === session.scheduledSessionId);
  return scheduled?.exercises.flatMap((exercise, index) => {
    if (
      !session.exerciseIds.includes(exercise.exerciseId) ||
      exercise.prescription.profile === 'cardio'
    ) {
      return [];
    }
    return [
      {
        exerciseId: exercise.exerciseId,
        name: exerciseName(
          exercise.exerciseId,
          index,
          session.exerciseNames?.[exercise.exerciseId] ?? exercise.name,
        ),
        target: {
          loadKg: exercise.prescription.load?.value ?? 0,
          reps: exercise.prescription.repetitions,
        },
        restSeconds: exercise.restSeconds ?? FALLBACK_REST_SECONDS,
        unilateral: exercise.prescription.profile === 'unilateral_strength',
        combinedLoadPermitted: session.combinedLoadExercises.includes(exercise.exerciseId),
      },
    ];
  });
}

/**
 * The active session's exercises with no prescription attached, for logging when the plan
 * revision the session started on is gone. Names and combined-load permission come from the
 * session's own snapshot. Whether an exercise is one-sided is not in the snapshot, so it is
 * read from the current plan when the exercise is still there; that is a kind of exercise,
 * never a target, so no number from a later revision reaches the screen.
 */
export async function readSessionExercises() {
  const { ports, userId } = deviceOf();
  const user = await userId();
  const session = await ports.store.activeSession(user);
  if (!session) return [];
  const plan = await ports.plans.activePlan(user);
  const scheduled = plan?.sessions.find((item) => item.id === session.scheduledSessionId);
  return session.exerciseIds.map((exerciseId, index) => ({
    exerciseId,
    name: exerciseName(exerciseId, index, session.exerciseNames?.[exerciseId]),
    target: undefined,
    restSeconds: FALLBACK_REST_SECONDS,
    unilateral:
      scheduled?.exercises.find((exercise) => exercise.exerciseId === exerciseId)?.prescription
        .profile === 'unilateral_strength',
    combinedLoadPermitted: session.combinedLoadExercises.includes(exerciseId),
  }));
}

export async function readActiveSession() {
  const { ports, userId } = deviceOf();
  const user = await userId();
  const session = await ports.store.activeSession(user);
  if (!session) return { user, session: undefined, sync: undefined };
  const outbox = await ports.store.outbox(user);
  return {
    user,
    session,
    sync: displaySyncState(
      deriveSyncState(outbox.filter((entry) => entry.entityId === session.id)),
    ),
  };
}

export async function startToday(scheduledSessionId: string) {
  const { ports, userId } = deviceOf();
  return startWorkout(ports, { userId: await userId(), scheduledSessionId });
}

type StrengthValues = {
  /** Undefined for a bodyweight set, or a set logged without a prescription and no load. */
  readonly loadKg: number | undefined;
  readonly reps: number;
  readonly rir: number | undefined;
  /** Present for a unilateral exercise; the domain refuses one without a side. */
  readonly side?: Side | undefined;
  /** Only ever 'total' where the plan permitted it; the domain refuses it otherwise. */
  readonly loadSemantics?: LoadSemantics | undefined;
};

function strengthFrom(command: StrengthValues): Result<Measurement, unknown> {
  const load = command.loadKg === undefined ? undefined : kilograms(command.loadKg);
  if (load && !load.ok) return load;
  const exertion = command.rir === undefined ? undefined : strengthExertion(command.rir);
  if (exertion && !exertion.ok) return exertion;

  const shared = {
    repetitions: command.reps,
    ...(load?.ok ? { load: load.value } : {}),
    ...(exertion?.ok ? { exertion: exertion.value } : {}),
  };
  return command.side
    ? unilateralStrengthMeasurement({
        ...shared,
        side: command.side,
        ...(command.loadSemantics ? { loadSemantics: command.loadSemantics } : {}),
      })
    : strengthMeasurement(shared);
}

/**
 * Records one strength set from what the controls said (task 5.4).
 *
 * The screen hands over numbers; the domain decides whether they are a measurement. RIR is
 * what the user entered and RPE is derived from it here, by the domain, so a screen cannot
 * store an RPE that does not follow from the RIR (ADR-0004, task 5.8).
 */
export async function logStrengthSet(
  command: StrengthValues & {
    readonly sessionId: string;
    readonly exerciseId: string;
  },
): Promise<Result<unknown, unknown>> {
  const measurement = strengthFrom(command);
  if (!measurement.ok) return measurement;

  const { ports, userId } = deviceOf();
  return logSet(ports, {
    userId: await userId(),
    sessionId: command.sessionId,
    exerciseId: command.exerciseId,
    measurement: measurement.value,
  });
}

/** Changes a recorded set's result in place (spec D-23). Where it was, and when, is kept. */
export async function editStrengthSet(
  command: StrengthValues & { readonly sessionId: string; readonly setId: string },
): Promise<Result<unknown, unknown>> {
  const measurement = strengthFrom(command);
  if (!measurement.ok) return measurement;
  const { ports, userId } = deviceOf();
  return editRecordedSet(ports, {
    userId: await userId(),
    sessionId: command.sessionId,
    setId: command.setId,
    measurement: measurement.value,
  });
}

/** Deletes a set at once; it stays recoverable, so this is undo-first (spec D-24). */
export async function deleteSet(sessionId: string, setId: string) {
  const { ports, userId } = deviceOf();
  return deleteRecordedSet(ports, { userId: await userId(), sessionId, setId });
}

export async function restoreSet(sessionId: string, setId: string) {
  const { ports, userId } = deviceOf();
  return restoreRecordedSet(ports, { userId: await userId(), sessionId, setId });
}

/** Discards the session in progress. Destructive, so the confirmation is explicit (task 5.3). */
export async function discardActiveWorkout(sessionId: string) {
  const { ports, userId } = deviceOf();
  return discardWorkout(ports, { userId: await userId(), sessionId, confirmed: true });
}

export async function finishWorkout(sessionId: string) {
  const { ports, userId } = deviceOf();
  return completeWorkout(ports, { userId: await userId(), sessionId });
}

/** Diagnostics: how many changes are recorded here and not yet delivered (task 4.10). */
export async function readQueueDepth(): Promise<number> {
  const { ports, userId } = deviceOf();
  return (await ports.store.outbox(await userId())).length;
}

/** Diagnostics: whether the browser will keep this data under storage pressure (task 4.10). */
export function persistenceState() {
  return requestPersistentStorage(typeof navigator === 'undefined' ? undefined : navigator.storage);
}

/**
 * Hands the whole archive to the user as files (tasks 4.8 and 8.1).
 *
 * The recovery action for a full device: the data is already on the device and cannot be
 * delivered, so the way out is to get it off. Two files, because they answer different
 * questions - the JSON round-trips into a clean instance, the CSV opens in a spreadsheet.
 */
export async function downloadEverything(): Promise<void> {
  const { archive, historyCsv } = await exportEverything();
  const stamp = new Date().toISOString().slice(0, 10);
  const save = (name: string, type: string, body: string) => {
    const url = URL.createObjectURL(new Blob([body], { type }));
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    document.body.append(link);
    link.click();
    link.remove();
    // Revoked on the next turn: revoking synchronously can cancel the download.
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  };
  save(`workout-export-${stamp}.json`, 'application/json', JSON.stringify(archive, null, 2));
  save(`workout-history-${stamp}.csv`, 'text/csv', historyCsv);
}

export async function exportEverything() {
  const { archive, ports, userId } = deviceOf();
  const user = await userId();
  return {
    archive: await exportArchive({ source: archive, clock: ports.clock }, user),
    historyCsv: await exportHistoryCsv({ source: archive }, user),
  };
}

export async function clearEverything() {
  const { archive, ports, userId } = deviceOf();
  return clearLocalDataAfterExport(
    { source: archive, outbox: ports.store, eraser: archive, clock: ports.clock },
    await userId(),
  );
}

export async function listPendingProposals(): Promise<readonly Proposal[]> {
  const { proposals, userId } = deviceOf();
  return proposals.listPending(await userId());
}

export async function readProposal(proposalId: string): Promise<{
  readonly proposal: Proposal | undefined;
  readonly plan: Awaited<ReturnType<IndexedDbPlanStore['activePlan']>>;
  readonly revision: number;
}> {
  const { proposals, plans, userId } = deviceOf();
  const user = await userId();
  const [proposal, plan, revision] = await Promise.all([
    proposals.findById(user, proposalId),
    plans.activePlan(user),
    proposals.currentRevision(user),
  ]);
  return { proposal, plan, revision };
}

export async function decideOnProposal(proposalId: string, decision: ReviewDecision) {
  const { proposals, plans, ports, userId } = deviceOf();
  const user = await userId();
  return reviewAndApplyProposal(
    { proposals, plans, clock: ports.clock },
    { userId: user, proposalId, decision },
  );
}

export { drainOutbox, FlushTriggers, liveSets };

const ACCOUNT_SESSION_KEY = 'workout.account.session';

export type AccountSession = {
  readonly userId: string;
  readonly accessToken: string;
};

let flushTriggers: FlushTriggers | undefined;

function flushTriggersOf(): FlushTriggers {
  if (!flushTriggers) {
    flushTriggers = new FlushTriggers(
      {
        drain: async () => {
          const session = readAccountSession();
          if (!session) return;
          const url = process.env['NEXT_PUBLIC_SUPABASE_URL'];
          const publishableKey = process.env['NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'];
          const config = browserConfig({ url, publishableKey });
          if (!config.ok) return;
          const { ports } = deviceOf();
          await drainOutbox(
            {
              store: ports.store,
              transport: new SupabaseWorkoutTransport(config.value, session.accessToken),
              clock: ports.clock,
              random: () => Math.random(),
            },
            session.userId,
          );
        },
      },
      { window, document },
    );
  }
  return flushTriggers;
}

export function readAccountSession(): AccountSession | undefined {
  if (typeof sessionStorage === 'undefined') return undefined;
  try {
    const raw = sessionStorage.getItem(ACCOUNT_SESSION_KEY);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as AccountSession;
    if (!parsed.userId || !parsed.accessToken) return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}

export function storeAccountSession(session: AccountSession): void {
  sessionStorage.setItem(ACCOUNT_SESSION_KEY, JSON.stringify(session));
}

export function clearAccountSession(): void {
  sessionStorage.removeItem(ACCOUNT_SESSION_KEY);
}

function emailAuthOrUndefined() {
  const url = process.env['NEXT_PUBLIC_SUPABASE_URL'];
  const publishableKey = process.env['NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'];
  const config = browserConfig({ url, publishableKey });
  if (!config.ok) return undefined;
  return createEmailAuth(config.value);
}

export async function requestSignInCode(email: string) {
  const auth = emailAuthOrUndefined();
  if (!auth) return err({ kind: 'missing_config' as const });
  return requestEmailSignInCode(auth, email);
}

export async function verifySignInCode(email: string, code: string) {
  const auth = emailAuthOrUndefined();
  if (!auth) return err({ kind: 'missing_config' as const });
  const result = await verifyEmailSignInCode(auth, email, code);
  if (result.ok) {
    storeAccountSession({
      userId: result.value.userId,
      accessToken: result.value.accessToken,
    });
    await claimDeviceDataForAccount(result.value.userId);
    await flushTriggersOf().authenticationRefreshed();
  }
  return result;
}

async function claimDeviceDataForAccount(accountId: string): Promise<void> {
  const { identity, archive } = deviceOf();
  const current = await identity.current();
  if (current.claimedBy) return;
  if (current.userId === accountId) {
    await identity.markClaimed(accountId, new Date());
    return;
  }
  await archive.rekey(current.userId, accountId);
  await identity.markClaimed(accountId, new Date());
}
