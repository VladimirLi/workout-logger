import {
  cryptoIdempotencyKeys,
  cryptoIds,
  FlushTriggers,
  IndexedDbArchive,
  IndexedDbDeviceIdentity,
  IndexedDbPlanStore,
  IndexedDbWorkoutStore,
  requestPersistentStorage,
} from '@workout/adapters-browser';
import {
  clearLocalDataAfterExport,
  completeWorkout,
  deriveSyncState,
  drainOutbox,
  exportArchive,
  exportHistoryCsv,
  logSet,
  type SyncState,
  startWorkout,
  type WorkoutPorts,
} from '@workout/application';
import { kilograms, type Result, strengthExertion, strengthMeasurement } from '@workout/domain';

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
  const ports: WorkoutPorts = {
    store,
    plans,
    clock: { now: () => new Date() },
    keys: cryptoIdempotencyKeys,
    ids: cryptoIds,
  };

  device = {
    ports,
    archive: new IndexedDbArchive(),
    identity,
    plans,
    userId: async () => (await identity.current()).userId,
  };
  return device;
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
}): Promise<Result<unknown, unknown>> {
  const load = kilograms(command.loadKg);
  if (!load.ok) return load;
  const exertion = command.rir === undefined ? undefined : strengthExertion(command.rir);
  if (exertion && !exertion.ok) return exertion;

  const measurement = strengthMeasurement({
    repetitions: command.reps,
    load: load.value,
    ...(exertion?.ok ? { exertion: exertion.value } : {}),
  });
  if (!measurement.ok) return measurement;

  const { ports, userId } = deviceOf();
  return logSet(ports, {
    userId: await userId(),
    sessionId: command.sessionId,
    exerciseId: command.exerciseId,
    measurement: measurement.value,
  });
}

export async function finishWorkout(sessionId: string) {
  const { ports, userId } = deviceOf();
  return completeWorkout(ports, { userId: await userId(), sessionId });
}

/** Diagnostics: whether the browser will keep this data under storage pressure (task 4.10). */
export function persistenceState() {
  return requestPersistentStorage(typeof navigator === 'undefined' ? undefined : navigator.storage);
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

export { drainOutbox, FlushTriggers };
