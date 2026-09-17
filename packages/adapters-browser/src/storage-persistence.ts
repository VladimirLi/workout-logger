/**
 * Persistent browser storage (offline-sync spec, ADR-0003, task 4.10).
 *
 * Without persistence the browser may evict the device's queued workout facts under storage
 * pressure. The app asks for it and reports the answer in diagnostics, whatever it is.
 */

export type PersistenceState =
  | { readonly state: 'granted' }
  | { readonly state: 'denied' }
  | { readonly state: 'unsupported' }
  | { readonly state: 'error'; readonly message: string };

/** The part of `navigator.storage` this needs, so a test can supply the browser's answer. */
export interface PersistableStorage {
  persisted(): Promise<boolean>;
  persist(): Promise<boolean>;
}

export async function requestPersistentStorage(
  storage: PersistableStorage | undefined,
): Promise<PersistenceState> {
  if (!storage) return { state: 'unsupported' };
  try {
    if (await storage.persisted()) return { state: 'granted' };
    return (await storage.persist()) ? { state: 'granted' } : { state: 'denied' };
  } catch (error) {
    return { state: 'error', message: error instanceof Error ? error.message : String(error) };
  }
}
