import { readFileSync } from 'node:fs';
import { expect, type Page, test } from '@playwright/test';
import type {
  Delivery,
  IdempotencyKey,
  LocalCommitRequest,
  LocalWorkoutStore,
  OutboxEntry,
  PlanReader,
} from '@workout/application';
import type { ActiveSession, Plan, WorkoutSession } from '@workout/domain';
import {
  aStartedSession,
  LOCAL_WORKOUT_STORE_CASES,
  PLAN_READER_CASES,
  SYNTHETIC_USER_ID,
} from '@workout/test-support';

/**
 * The IndexedDB device store in a real browser (ADR-0003, tasks 1.6 and 4.1).
 *
 * Node has no IndexedDB, so the adapter cannot be proved by a unit test. These run the SAME
 * contract cases the in-memory reference runs under Vitest, against a store living inside a
 * Chromium page: only the port calls cross the boundary, so every transaction begins and ends
 * inside the browser where the atomicity guarantee actually has to hold.
 *
 * The compiled adapter is injected as a module. It imports only types from the application and
 * domain packages, so its compiled form has no runtime imports and needs no bundler - asserted
 * below, because a single value import would silently turn this file into a no-op.
 */

const ADAPTER = 'packages/adapters-browser/dist/local-workout-store.js';

function adapterSource(): string {
  let source: string;
  try {
    source = readFileSync(ADAPTER, 'utf8');
  } catch {
    throw new Error(`${ADAPTER} is missing. Run \`pnpm build\` before the browser gates.`);
  }
  return source;
}

declare global {
  interface Window {
    __storeCall(databaseName: string, method: string, args: unknown[]): Promise<unknown>;
    __planCall(databaseName: string, method: string, args: unknown[]): Promise<unknown>;
    __failNextWrite(databaseName: string): void;
  }
}

let databases = 0;

/** A fresh database name per case, so one case's data never reaches the next. */
function nextDatabase(): string {
  databases += 1;
  return `workout-contract-${databases}`;
}

async function injectAdapter(page: Page): Promise<void> {
  await page.goto('/offline');
  await page.addScriptTag({
    type: 'module',
    content: `${adapterSource()}
// A factory that lets one write fail as a full device does. Everything else is the browser's
// own IndexedDB: only the single put under test is intercepted, and only when asked.
const failing = new Set();
const forward = (target, prop) => {
  const value = Reflect.get(target, prop, target);
  return typeof value === 'function' ? value.bind(target) : value;
};
const wrapStore = (store, name) =>
  new Proxy(store, {
    get(target, prop) {
      if (prop === 'put' && failing.has(name)) {
        failing.delete(name);
        return () => {
          throw new DOMException('the device is full', 'QuotaExceededError');
        };
      }
      return forward(target, prop);
    },
  });
const wrapTransaction = (transaction, name) =>
  new Proxy(transaction, {
    get: (target, prop) =>
      prop === 'objectStore'
        ? (store) => wrapStore(target.objectStore(store), name)
        : forward(target, prop),
    set(target, prop, value) {
      Reflect.set(target, prop, value, target);
      return true;
    },
  });
const wrapDatabase = (database, name) =>
  new Proxy(database, {
    get: (target, prop) =>
      prop === 'transaction'
        ? (...args) => wrapTransaction(target.transaction(...args), name)
        : forward(target, prop),
  });
const factoryFor = (name) => ({
  open(databaseName, version) {
    const request = indexedDB.open(databaseName, version);
    return new Proxy(request, {
      get: (target, prop) =>
        prop === 'result' ? wrapDatabase(target.result, name) : forward(target, prop),
      set(target, prop, value) {
        Reflect.set(target, prop, value, target);
        return true;
      },
    });
  },
});

const stores = new Map();
const plans = new Map();
const store = (name) => {
  if (!stores.has(name))
    stores.set(name, new IndexedDbWorkoutStore({ databaseName: name, factory: factoryFor(name) }));
  return stores.get(name);
};
const plan = (name) => {
  if (!plans.has(name)) plans.set(name, new IndexedDbPlanStore({ databaseName: name }));
  return plans.get(name);
};
window.__storeCall = (name, method, args) => store(name)[method](...args);
window.__planCall = (name, method, args) => plan(name)[method](...args);
window.__failNextWrite = (name) => {
  failing.add(name);
};
`,
  });
  await page.waitForFunction(() => typeof window.__storeCall === 'function');
}

/** A LocalWorkoutStore whose every method executes in the page, against real IndexedDB. */
function pageStore(page: Page, databaseName: string): LocalWorkoutStore {
  const call = <T>(method: string, args: unknown[]): Promise<T> =>
    page.evaluate((input) => window.__storeCall(input.databaseName, input.method, input.args), {
      databaseName,
      method,
      args,
    }) as Promise<T>;

  return {
    commit: (request: LocalCommitRequest) => call('commit', [request]),
    activeSession: (userId: string) => call<ActiveSession | undefined>('activeSession', [userId]),
    findSession: (userId: string, sessionId: string) =>
      call<WorkoutSession | undefined>('findSession', [userId, sessionId]),
    outbox: (userId: string) => call<readonly OutboxEntry[]>('outbox', [userId]),
    updateDelivery: (userId: string, key: IdempotencyKey, delivery: Delivery) =>
      call<void>('updateDelivery', [userId, key, delivery]),
    acknowledge: (userId: string, key: IdempotencyKey) => call<void>('acknowledge', [userId, key]),
  };
}

function pagePlanReader(
  page: Page,
  databaseName: string,
): PlanReader & {
  save(userId: string, plan: Plan): Promise<void>;
} {
  const call = <T>(method: string, args: unknown[]): Promise<T> =>
    page.evaluate((input) => window.__planCall(input.databaseName, input.method, input.args), {
      databaseName,
      method,
      args,
    }) as Promise<T>;
  return {
    activePlan: (userId: string) => call<Plan | undefined>('activePlan', [userId]),
    save: (userId: string, plan: Plan) => call<void>('save', [userId, plan]),
  };
}

/**
 * Makes the device full.
 *
 * Chromium's `Storage.overrideQuotaForOrigin` was tried first and does not serve here: with the
 * quota dropped to one byte, and even with megabytes already written, a small IndexedDB write
 * still succeeded, so the case would have passed without exercising the path at all. Instead the
 * store is built on a factory that raises the browser's own QuotaExceededError from the next
 * `put`. That is the error a full device produces, and what the adapter has to do with it - map
 * it to `storage_full` and leave nothing behind - is exactly what the case then checks.
 */
async function exhaustStorage(page: Page, databaseName: string): Promise<void> {
  await page.evaluate((name) => window.__failNextWrite(name), databaseName);
}

test.describe('the IndexedDB device store', () => {
  test('the compiled adapter has no runtime imports, so injecting it is enough', () => {
    const source = adapterSource();
    const imports = [...source.matchAll(/^\s*import\s[^\n]*from\s*['"]([^'"]+)['"]/gm)].map(
      (match) => match[1],
    );
    expect(
      imports,
      'the adapter gained a runtime import; this spec can no longer inject it',
    ).toEqual([]);
    expect(source).toContain('IndexedDbWorkoutStore');
    expect(source).toContain('IndexedDbPlanStore');
  });

  for (const testCase of LOCAL_WORKOUT_STORE_CASES) {
    test(`LocalWorkoutStore contract: ${testCase.name}`, async ({ page }) => {
      await injectAdapter(page);
      const databaseName = nextDatabase();
      await testCase.run({
        store: pageStore(page, databaseName),
        exhaustStorage: () => exhaustStorage(page, databaseName),
      });
    });
  }

  for (const testCase of PLAN_READER_CASES) {
    test(`PlanReader contract: ${testCase.name}`, async ({ page }) => {
      await injectAdapter(page);
      const databaseName = nextDatabase();
      const reader = pagePlanReader(page, databaseName);
      await testCase.run({ reader, seed: (userId, plan) => reader.save(userId, plan) });
    });
  }

  test('a session and its outbox entry never exist without each other, even if the page dies mid-commit', async ({
    page,
    context,
  }) => {
    // The guarantee task 4.1 is about. The page is destroyed while commits are in flight, then
    // the database is reopened in a fresh page and every session is required to have its entry
    // and every entry its session. A two-step write would leave one without the other.
    await injectAdapter(page);
    const databaseName = nextDatabase();
    const COMMITS = 24;
    const requests = Array.from({ length: COMMITS }, (_, index) => {
      const n = index + 1;
      const session = aStartedSession(`workout-${n}`);
      return {
        userId: SYNTHETIC_USER_ID,
        session,
        mutation: { kind: 'start_session', session },
        idempotencyKey: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
        enqueuedAt: new Date('2026-09-14T10:00:00Z'),
      };
    });

    // Every commit is fired at once and only the first is awaited, so the page is destroyed
    // with the rest still in flight while at least one has certainly landed - without that the
    // pairing check below could pass on an empty database.
    await page.evaluate(
      async (input) => {
        const started = input.requests.map((request) =>
          window.__storeCall(input.databaseName, 'commit', [request]),
        );
        started.slice(1).forEach((pending) => void pending.catch(() => undefined));
        await started[0];
      },
      { databaseName, requests },
    );

    await page.close({ runBeforeUnload: false });

    const reopened = await context.newPage();
    await injectAdapter(reopened);
    const store = pageStore(reopened, databaseName);

    const entries = await store.outbox(SYNTHETIC_USER_ID);
    const sessions = await Promise.all(
      requests.map((request) => store.findSession(SYNTHETIC_USER_ID, request.session.id)),
    );
    const storedIds = new Set(
      sessions.filter((session) => session !== undefined).map((session) => session.id),
    );
    const queuedIds = new Set(entries.map((entry) => entry.entityId));

    // Something must have survived, or the test proves nothing about pairing.
    expect(storedIds.size, 'no commit survived, so the pairing check is vacuous').toBeGreaterThan(
      0,
    );
    expect(
      [...queuedIds].filter((id) => !storedIds.has(id)),
      'entries without a session',
    ).toEqual([]);
    expect(
      [...storedIds].filter((id) => !queuedIds.has(id)),
      'sessions without an entry',
    ).toEqual([]);
  });
});
