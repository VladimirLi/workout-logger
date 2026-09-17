import { describe, expect, it } from 'vitest';
import { requestPersistentStorage } from './storage-persistence.js';

/** Persistent storage is requested and its state surfaced (offline-sync spec, task 4.10). */

function manager(options: { persisted: boolean; grant?: boolean; throws?: boolean }) {
  const calls: string[] = [];
  return {
    calls,
    storage: {
      persisted: () => {
        calls.push('persisted');
        return Promise.resolve(options.persisted);
      },
      persist: () => {
        calls.push('persist');
        if (options.throws) return Promise.reject(new Error('blocked'));
        return Promise.resolve(options.grant ?? false);
      },
    },
  };
}

describe('requestPersistentStorage', () => {
  it('reports granted when the browser grants the request', async () => {
    const { storage, calls } = manager({ persisted: false, grant: true });
    expect(await requestPersistentStorage(storage)).toEqual({ state: 'granted' });
    expect(calls).toEqual(['persisted', 'persist']);
  });

  it('reports denied rather than silently continuing', async () => {
    const { storage } = manager({ persisted: false, grant: false });
    expect(await requestPersistentStorage(storage)).toEqual({ state: 'denied' });
  });

  it('does not ask again when storage is already persistent', async () => {
    const { storage, calls } = manager({ persisted: true });
    expect(await requestPersistentStorage(storage)).toEqual({ state: 'granted' });
    expect(calls).toEqual(['persisted']);
  });

  it('reports unsupported when the browser has no storage manager', async () => {
    expect(await requestPersistentStorage(undefined)).toEqual({ state: 'unsupported' });
  });

  it('reports the failure when the request throws', async () => {
    const { storage } = manager({ persisted: false, throws: true });
    expect(await requestPersistentStorage(storage)).toEqual({ state: 'error', message: 'blocked' });
  });
});
