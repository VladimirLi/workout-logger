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

export async function logOneSet(command: {
  readonly sessionId: string;
  readonly exerciseId: string;
  readonly measurement: Parameters<typeof logSet>[1]['measurement'];
}) {
  const { ports, userId } = deviceOf();
  return logSet(ports, { userId: await userId(), ...command });
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
