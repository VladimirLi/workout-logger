import {
  IDENTITY_STORE,
  type IndexedDbOptions,
  openWorkoutDatabase,
} from './local-workout-store.js';

/**
 * Who the device records for before anyone signs in (identity spec, tasks 3.6 and 3.7).
 *
 * One identity, generated once and kept, because a workout cannot wait for a provisioned
 * authentication service (gates G-2 and G-4) and the device is already the first place a fact
 * is saved (ADR-0003). Every local fact is recorded under this id until an account claims it.
 *
 * It lives in the same database as the data it keys, so there is no way to still have the
 * workouts while having lost the name they were filed under. That rules out localStorage,
 * which a browser can clear separately from IndexedDB.
 */

const CURRENT = 'current';

interface IdentityRecord {
  readonly key: string;
  readonly userId: string;
  readonly createdAt: Date;
  /** Set when an account claimed this device's data, so a second account cannot re-claim it. */
  readonly claimedBy?: string;
  readonly claimedAt?: Date;
}

export interface DeviceIdentity {
  readonly userId: string;
  readonly createdAt: Date;
  readonly claimedBy: string | undefined;
}

export class IndexedDbDeviceIdentity {
  readonly #options: IndexedDbOptions;
  readonly #newId: () => string;

  constructor(options: IndexedDbOptions & { readonly newId?: () => string } = {}) {
    this.#options = options;
    this.#newId = options.newId ?? (() => globalThis.crypto.randomUUID());
  }

  /**
   * The device's identity, generated on first use.
   *
   * Generation happens inside one readwrite transaction that re-reads first, so two tabs
   * opening at the same moment cannot end up with two identities and half the data under each.
   */
  async current(): Promise<DeviceIdentity> {
    const { transaction } = await openWorkoutDatabase(this.#options);
    const record = await transaction([IDENTITY_STORE], 'readwrite', async (tx, request) => {
      const store = tx.objectStore(IDENTITY_STORE);
      const existing = await request<IdentityRecord | undefined>(store.get(CURRENT));
      if (existing) return existing;
      const created: IdentityRecord = {
        key: CURRENT,
        userId: this.#newId(),
        createdAt: new Date(),
      };
      store.put(created);
      return created;
    });
    return {
      userId: record.userId,
      createdAt: record.createdAt,
      claimedBy: record.claimedBy,
    };
  }

  /** Records that an account has claimed this device's data. */
  async markClaimed(accountId: string, at: Date): Promise<void> {
    const { transaction } = await openWorkoutDatabase(this.#options);
    await transaction([IDENTITY_STORE], 'readwrite', async (tx, request) => {
      const store = tx.objectStore(IDENTITY_STORE);
      const existing = await request<IdentityRecord | undefined>(store.get(CURRENT));
      if (!existing) throw new Error('there is no device identity to claim');
      // Already claimed: the data stays with the account that claimed it (identity spec).
      if (existing.claimedBy) return;
      store.put({ ...existing, claimedBy: accountId, claimedAt: at } satisfies IdentityRecord);
    });
  }
}
