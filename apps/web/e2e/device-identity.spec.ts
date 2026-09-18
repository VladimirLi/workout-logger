import { readFileSync } from 'node:fs';
import { expect, type Page, test } from '@playwright/test';

/**
 * The device's own identity, and an account claiming what it recorded (tasks 3.6 and 3.7).
 *
 * The identity lives in the same IndexedDB database as the data it keys, so only a real
 * browser can show that it survives a reload and that two tabs opening at once do not end up
 * with two identities and half the workouts under each.
 *
 * Claiming is proved as far as it can be: the rekey moves every record to the account's
 * identity and loses nothing. What is still missing is a sign-in to trigger it (task 3.2,
 * gates G-2 and G-4), so no test here pretends an account signed in.
 */

const MODULES = [
  'packages/adapters-browser/dist/local-workout-store.js',
  'packages/adapters-browser/dist/device-identity.js',
];

function bundle(): string {
  return MODULES.map((path) => {
    const source = readFileSync(path, 'utf8');
    // These two do import each other, which is fine: the import is stripped and both are
    // concatenated here. Anything reaching outside the package would not be.
    return source.replaceAll(/^\s*import\s[^\n]*from\s*'\.\/[^']+'\s*;?\s*$/gm, '');
  }).join('\n');
}

declare global {
  interface Window {
    __identityCall(databaseName: string, method: string, args: unknown[]): Promise<unknown>;
    __rekeyCall(databaseName: string, method: string, args: unknown[]): Promise<unknown>;
    __storeCall(databaseName: string, method: string, args: unknown[]): Promise<unknown>;
  }
}

let databases = 0;
function nextDatabase(): string {
  databases += 1;
  return `identity-${databases}`;
}

async function inject(page: Page): Promise<void> {
  // A module that throws on evaluation would otherwise show up as a timeout waiting for a
  // function that never gets defined, which says nothing about what went wrong.
  const failures: string[] = [];
  page.on('pageerror', (error) => failures.push(error.message));
  await page.goto('/offline');
  await page.addScriptTag({
    type: 'module',
    content: `${bundle()}
const identities = new Map();
const archives = new Map();
const stores = new Map();
const identity = (name) => {
  if (!identities.has(name)) identities.set(name, new IndexedDbDeviceIdentity({ databaseName: name }));
  return identities.get(name);
};
const archive = (name) => {
  if (!archives.has(name)) archives.set(name, new IndexedDbArchive({ databaseName: name }));
  return archives.get(name);
};
const store = (name) => {
  if (!stores.has(name)) stores.set(name, new IndexedDbWorkoutStore({ databaseName: name }));
  return stores.get(name);
};
window.__identityCall = (name, method, args) => identity(name)[method](...args);
window.__rekeyCall = (name, method, args) => archive(name)[method](...args);
window.__storeCall = (name, method, args) => store(name)[method](...args);
`,
  });
  await page
    .waitForFunction(() => typeof window.__identityCall === 'function', undefined, {
      timeout: 5_000,
    })
    .catch((error: unknown) => {
      throw new Error(
        `the injected adapter did not evaluate: ${failures.join('; ') || String(error)}`,
      );
    });
}

const current = (page: Page, databaseName: string) =>
  page.evaluate((name) => window.__identityCall(name, 'current', []), databaseName) as Promise<{
    userId: string;
    createdAt: Date;
    claimedBy: string | undefined;
  }>;

test.describe('the device identity', () => {
  test('is a generated identifier, recorded once', async ({ page }) => {
    await inject(page);
    const databaseName = nextDatabase();
    const first = await current(page, databaseName);

    expect(first.userId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(first.claimedBy).toBeUndefined();

    // Asked again in the same page: the same identity, not a second one.
    expect((await current(page, databaseName)).userId).toBe(first.userId);
  });

  test('is the same identity after a reload', async ({ page }) => {
    await inject(page);
    const databaseName = nextDatabase();
    const before = await current(page, databaseName);

    await page.reload();
    await inject(page);
    expect((await current(page, databaseName)).userId).toBe(before.userId);
  });

  test('is one identity even when two tabs open at the same moment', async ({ page, context }) => {
    // Two tabs racing on first use is the case that would otherwise file half the workouts
    // under one identity and half under another, with neither looking wrong.
    const second = await context.newPage();
    await Promise.all([inject(page), inject(second)]);
    const databaseName = nextDatabase();

    const [left, right] = await Promise.all([
      current(page, databaseName),
      current(second, databaseName),
    ]);
    expect(left.userId).toBe(right.userId);
    await second.close();
  });

  test('moves every record to an account without losing a queued mutation', async ({ page }) => {
    // The device half of task 3.7. There is no sign-in to trigger this yet, so the rekey is
    // called directly; what it has to guarantee is that nothing is lost on the way.
    await inject(page);
    const databaseName = nextDatabase();
    const device = await current(page, databaseName);
    const account = 'account-1111-4111-8111-111111111111';

    const before = await page.evaluate(
      async (input) => {
        const session = {
          status: 'active',
          id: 'workout-1',
          planId: 'plan-1',
          planRevision: 1,
          scheduledSessionId: 'session-mon',
          exerciseIds: ['back-squat'],
          startedAt: new Date('2026-09-18T10:00:00Z'),
          sets: [],
        };
        for (let n = 1; n <= 3; n += 1) {
          await window.__storeCall(input.databaseName, 'commit', [
            {
              userId: input.device,
              session: { ...session, id: `workout-${n}` },
              mutation: { kind: 'start_session', session: { ...session, id: `workout-${n}` } },
              idempotencyKey: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
              enqueuedAt: new Date('2026-09-18T10:00:00Z'),
            },
          ]);
        }
        return {
          entries: (await window.__storeCall(input.databaseName, 'outbox', [
            input.device,
          ])) as unknown[],
          sessions: (await window.__rekeyCall(input.databaseName, 'sessions', [
            input.device,
          ])) as unknown[],
        };
      },
      { databaseName, device: device.userId },
    );
    expect(before.entries).toHaveLength(3);
    expect(before.sessions).toHaveLength(3);

    await page.evaluate(
      (input) => window.__rekeyCall(input.databaseName, 'rekey', [input.device, input.account]),
      { databaseName, device: device.userId, account },
    );

    const after = await page.evaluate(
      async (input) => ({
        accountEntries: (await window.__storeCall(input.databaseName, 'outbox', [
          input.account,
        ])) as { entityId: string; sequence: number }[],
        accountSessions: (await window.__rekeyCall(input.databaseName, 'sessions', [
          input.account,
        ])) as unknown[],
        deviceEntries: (await window.__storeCall(input.databaseName, 'outbox', [
          input.device,
        ])) as unknown[],
        deviceSessions: (await window.__rekeyCall(input.databaseName, 'sessions', [
          input.device,
        ])) as unknown[],
      }),
      { databaseName, device: device.userId, account },
    );

    // Everything is the account's, nothing is left behind, and nothing was duplicated.
    expect(after.accountEntries).toHaveLength(3);
    expect(after.accountSessions).toHaveLength(3);
    expect(after.deviceEntries).toEqual([]);
    expect(after.deviceSessions).toEqual([]);
    // Commit order survived the move.
    expect(after.accountEntries.map((entry) => entry.entityId)).toEqual([
      'workout-1',
      'workout-2',
      'workout-3',
    ]);
  });

  test('records who claimed it, and refuses a second claim', async ({ page }) => {
    await inject(page);
    const databaseName = nextDatabase();
    await current(page, databaseName);

    await page.evaluate(
      (input) =>
        window.__identityCall(input.databaseName, 'markClaimed', [
          input.account,
          new Date('2026-09-18T12:00:00Z'),
        ]),
      { databaseName, account: 'account-one' },
    );
    expect((await current(page, databaseName)).claimedBy).toBe('account-one');

    await page.evaluate(
      (input) =>
        window.__identityCall(input.databaseName, 'markClaimed', [
          input.account,
          new Date('2026-09-18T13:00:00Z'),
        ]),
      { databaseName, account: 'account-two' },
    );
    // The data stays with the account that claimed it (identity spec).
    expect((await current(page, databaseName)).claimedBy).toBe('account-one');
  });
});
