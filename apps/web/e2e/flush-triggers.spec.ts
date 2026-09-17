import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { aStartedSession, SYNTHETIC_USER_ID } from '@workout/test-support';

/**
 * The outbox drains on a real browser event, in a browser with no Background Sync (task 4.7).
 *
 * The trigger policy itself is unit-tested in packages/adapters-browser. What only a browser
 * can show is the whole path: a real `online` event, the real IndexedDB store, the real
 * delivery loop, and an entry that is gone from the queue afterwards - with
 * `ServiceWorkerRegistration.prototype.sync` deleted first, so nothing could have used
 * Background Sync even if it wanted to.
 *
 * The transport is a stub because the server does not exist yet (gate G-2). Everything between
 * the event and the transport is the real thing.
 */

const MODULES = [
  'packages/adapters-browser/dist/local-workout-store.js',
  'packages/adapters-browser/dist/flush-triggers.js',
  'packages/application/dist/delivery.js',
];

function bundle(): string {
  return MODULES.map((path) => {
    const source = readFileSync(path, 'utf8');
    const imports = [...source.matchAll(/^\s*import\s[^\n]*from\s*['"]([^'"]+)['"]/gm)];
    if (imports.length > 0) {
      throw new Error(`${path} gained a runtime import, so it can no longer be injected directly`);
    }
    return source;
  }).join('\n');
}

declare global {
  interface Window {
    __flushHarness(databaseName: string): Promise<{
      backgroundSyncAvailable: boolean;
      queuedBefore: number;
      queuedAfter: number;
      attempts: number;
      reasons: string[];
    }>;
  }
}

test('a real online event drains the queue with Background Sync unavailable', async ({ page }) => {
  await page.goto('/offline');

  // Remove Background Sync before any application code runs, so the drain cannot depend on it.
  await page.addScriptTag({
    content: `
if (window.ServiceWorkerRegistration && 'sync' in ServiceWorkerRegistration.prototype) {
  delete ServiceWorkerRegistration.prototype.sync;
}
window.__backgroundSyncAvailable =
  !!window.ServiceWorkerRegistration && 'sync' in ServiceWorkerRegistration.prototype;
`,
  });

  await page.addScriptTag({
    type: 'module',
    content: `${bundle()}
window.__flushHarness = async (databaseName) => {
  const store = new IndexedDbWorkoutStore({ databaseName });
  const reasons = [];
  let attempts = 0;
  const transport = {
    send: async () => {
      attempts += 1;
      return { kind: 'response', status: 200 };
    },
  };
  const triggers = new FlushTriggers(
    {
      drain: async (reason) => {
        reasons.push(reason);
        await drainOutbox(
          { store, transport, clock: { now: () => new Date() }, random: () => 0.5 },
          ${JSON.stringify(SYNTHETIC_USER_ID)},
        );
      },
    },
    { window, document },
  );
  triggers.start();

  const session = window.__session;
  await store.commit({
    userId: ${JSON.stringify(SYNTHETIC_USER_ID)},
    session,
    mutation: { kind: 'start_session', session },
    idempotencyKey: '00000000-0000-4000-8000-000000000001',
    enqueuedAt: new Date(),
  });
  const queuedBefore = (await store.outbox(${JSON.stringify(SYNTHETIC_USER_ID)})).length;

  // The real event, dispatched on the real window, with no direct call to any flush method.
  window.dispatchEvent(new Event('online'));
  const deadline = Date.now() + 5000;
  let queuedAfter = queuedBefore;
  while (Date.now() < deadline) {
    queuedAfter = (await store.outbox(${JSON.stringify(SYNTHETIC_USER_ID)})).length;
    if (queuedAfter === 0) break;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  triggers.stop();
  return {
    backgroundSyncAvailable: window.__backgroundSyncAvailable,
    queuedBefore,
    queuedAfter,
    attempts,
    reasons,
  };
};
`,
  });

  await page.evaluate((session) => {
    (window as unknown as { __session: unknown }).__session = session;
  }, aStartedSession('workout-1'));

  const result = await page.evaluate(() => window.__flushHarness('flush-triggers-1'));

  expect(result.backgroundSyncAvailable, 'Background Sync was still available').toBe(false);
  expect(result.queuedBefore).toBe(1);
  expect(result.reasons).toEqual(['connectivity']);
  expect(result.attempts).toBe(1);
  expect(result.queuedAfter, 'the queue did not drain on the online event').toBe(0);
});
