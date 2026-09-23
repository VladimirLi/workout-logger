import type { DeletionStore, PendingDeletion } from '@workout/application';

export class InMemoryDeletionStore implements DeletionStore {
  readonly #pending = new Map<string, PendingDeletion>();

  get(userId: string): Promise<PendingDeletion | undefined> {
    return Promise.resolve(this.#pending.get(userId));
  }

  put(deletion: PendingDeletion): Promise<void> {
    this.#pending.set(deletion.userId, deletion);
    return Promise.resolve();
  }

  remove(userId: string): Promise<void> {
    this.#pending.delete(userId);
    return Promise.resolve();
  }
}
