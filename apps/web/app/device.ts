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
  clearLocalDataAfterExport,
  completeWorkout,
  type DeletionPorts,
  deriveSyncState,
  discardWorkout,
  drainOutbox,
  exportArchive,
  exportHistoryCsv,
  logSet,
  type PendingDeletion,
  purgeExpiredDeletion,
  type ReviewDecision,
  recoverDeletion,
  reviewProposal,
  type SyncState,
  scheduleRecoverableDeletion,
  startWorkout,
  type WorkoutPorts,
} from '@workout/application';
import {
  applyPlanDiff,
  kilograms,
  type LoadSemantics,
  type Proposal,
  type Result,
  type Side,
  strengthExertion,
  strengthMeasurement,
  unilateralStrengthMeasurement,
} from '@workout/domain';

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
    userId: async () => (await identity.current()).userId,
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
  return { user, plan, active };
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

/**
 * The prescription the active session is working through, from the plan it was started from.
 *
 * The first exercise of the scheduled session: moving between exercises is product behaviour
 * the workout-logging spec does not describe yet, so nothing here invents an order.
 */
export async function readActivePrescription() {
  const { ports, userId } = deviceOf();
  const user = await userId();
  const session = await ports.store.activeSession(user);
  if (!session) return undefined;
  const plan = await ports.plans.activePlan(user);
  const scheduled = plan?.sessions.find((item) => item.id === session.scheduledSessionId);
  const exercise = scheduled?.exercises[0];
  if (!exercise || exercise.prescription.profile === 'cardio') return undefined;
  return {
    exerciseId: exercise.exerciseId,
    name: exercise.exerciseId,
    loadKg: exercise.prescription.load?.value ?? 0,
    reps: exercise.prescription.repetitions,
    // The rest length is a design-system default (feedback defaults); the plan does not carry
    // one, and inventing a per-exercise rest would be inventing product behaviour.
    restSeconds: 90,
    unilateral: exercise.prescription.profile === 'unilateral_strength',
    // Offered only where the plan says so, and the session's own snapshot is what the domain
    // will check against (owner decision 2026-09-18).
    combinedLoadPermitted: session.combinedLoadExercises.includes(exercise.exerciseId),
  };
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

/**
 * Records one strength set from what the controls said (task 5.4).
 *
 * The screen hands over numbers; the domain decides whether they are a measurement. RIR is
 * what the user entered and RPE is derived from it here, by the domain, so a screen cannot
 * store an RPE that does not follow from the RIR (ADR-0004, task 5.8).
 */
export async function logStrengthSet(command: {
  readonly sessionId: string;
  readonly exerciseId: string;
  readonly loadKg: number;
  readonly reps: number;
  readonly rir: number | undefined;
  /** Present for a unilateral exercise; the domain refuses one without a side. */
  readonly side?: Side | undefined;
  /** Only ever 'total' where the plan permitted it; the domain refuses it otherwise. */
  readonly loadSemantics?: LoadSemantics | undefined;
}): Promise<Result<unknown, unknown>> {
  const load = kilograms(command.loadKg);
  if (!load.ok) return load;
  const exertion = command.rir === undefined ? undefined : strengthExertion(command.rir);
  if (exertion && !exertion.ok) return exertion;

  const shared = {
    repetitions: command.reps,
    load: load.value,
    ...(exertion?.ok ? { exertion: exertion.value } : {}),
  };
  const measurement = command.side
    ? unilateralStrengthMeasurement({
        ...shared,
        side: command.side,
        ...(command.loadSemantics ? { loadSemantics: command.loadSemantics } : {}),
      })
    : strengthMeasurement(shared);
  if (!measurement.ok) return measurement;

  const { ports, userId } = deviceOf();
  return logSet(ports, {
    userId: await userId(),
    sessionId: command.sessionId,
    exerciseId: command.exerciseId,
    measurement: measurement.value,
  });
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
  const result = await reviewProposal(
    { proposals, clock: ports.clock },
    { userId: user, proposalId, decision },
  );
  if (result.ok && decision === 'accept') {
    const plan = await plans.activePlan(user);
    const revision = await proposals.currentRevision(user);
    if (plan?.status === 'active') {
      const applied = applyPlanDiff(plan, result.value.diff);
      await plans.save(user, applied.ok ? { ...applied.value, revision } : { ...plan, revision });
    }
  }
  return result;
}

export { drainOutbox, FlushTriggers };
