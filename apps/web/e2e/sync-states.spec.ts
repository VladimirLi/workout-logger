import { readFileSync } from 'node:fs';
import { expect, type Page, test } from '@playwright/test';

/**
 * The three user-visible sync states on the product routes (offline-sync spec, task 5.7).
 *
 * Delivery does not need a server: the outbox already holds the entry, and `updateDelivery`
 * is how a failed or in-flight attempt is recorded. Seeding those states on the device is
 * the same shape the delivery loop would leave, so the product can prove all three labels
 * without gate G-2.
 */

const ADAPTER = 'packages/adapters-browser/dist/local-workout-store.js';

type SeededDelivery =
  | { readonly state: 'queued' }
  | { readonly state: 'in_flight'; readonly attempts: number }
  | {
      readonly state: 'needs_attention';
      readonly attempts: number;
      readonly lastFailure: 'http_422';
    };

async function seedPlan(page: Page): Promise<void> {
  const adapter = readFileSync(ADAPTER, 'utf8').replaceAll(/^export /gm, '');
  await page.addInitScript((source: string) => {
    const factory = new Function(`${source}\nreturn { IndexedDbPlanStore };`) as () => {
      IndexedDbPlanStore: new () => { save(userId: string, plan: unknown): Promise<void> };
    };
    const { IndexedDbPlanStore } = factory();

    const identity = async (): Promise<string> => {
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('workout', 1);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const record = await new Promise<{ userId: string } | undefined>((resolve, reject) => {
        const transaction = database.transaction('device-identity', 'readonly');
        const get = transaction.objectStore('device-identity').get('current');
        get.onsuccess = () => resolve(get.result as { userId: string } | undefined);
        get.onerror = () => reject(get.error);
      });
      database.close();
      if (record) return record.userId;
      await new Promise((resolve) => setTimeout(resolve, 50));
      return identity();
    };

    (window as unknown as { __seedPlan: () => Promise<void> }).__seedPlan = async () => {
      const userId = await identity();
      await new IndexedDbPlanStore().save(userId, {
        status: 'active',
        id: 'plan-1',
        revision: 1,
        activatedAt: new Date('2026-09-18T08:00:00Z'),
        sessions: [
          {
            id: 'session-mon',
            scheduledFor: '2026-09-18',
            exercises: [
              {
                exerciseId: 'back-squat',
                prescription: {
                  schemaVersion: 1,
                  profile: 'strength',
                  repetitions: 8,
                  load: { unit: 'kg', value: 80 },
                },
              },
            ],
          },
        ],
      });
    };
  }, adapter);
}

async function openWorkoutWithQueuedOutbox(page: Page): Promise<void> {
  await seedPlan(page);
  await page.goto('/today');
  await expect(page.getByRole('heading', { name: 'No plan on this device yet' })).toBeVisible();
  await page.evaluate(() => (window as unknown as { __seedPlan(): Promise<void> }).__seedPlan());
  await page.reload();
  await page.getByRole('button', { name: 'Start workout' }).click();
  await page.waitForURL('**/workout');
  await expect(page.getByText('On device')).toBeVisible();
}

async function setOutboxDelivery(page: Page, delivery: SeededDelivery): Promise<void> {
  const adapter = readFileSync(ADAPTER, 'utf8').replaceAll(/^export /gm, '');
  await page.evaluate(
    async (input: { source: string; delivery: SeededDelivery }) => {
      const factory = new Function(`${input.source}\nreturn { IndexedDbWorkoutStore };`) as () => {
        IndexedDbWorkoutStore: new () => {
          outbox(userId: string): Promise<ReadonlyArray<{ idempotencyKey: string }>>;
          updateDelivery(userId: string, key: string, delivery: SeededDelivery): Promise<void>;
        };
      };
      const { IndexedDbWorkoutStore } = factory();
      const store = new IndexedDbWorkoutStore();

      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('workout', 1);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const record = await new Promise<{ userId: string } | undefined>((resolve, reject) => {
        const transaction = database.transaction('device-identity', 'readonly');
        const get = transaction.objectStore('device-identity').get('current');
        get.onsuccess = () => resolve(get.result as { userId: string } | undefined);
        get.onerror = () => reject(get.error);
      });
      database.close();
      if (!record) throw new Error('device identity missing');

      const entries = await store.outbox(record.userId);
      if (entries.length === 0) throw new Error('outbox empty');
      for (const entry of entries) {
        await store.updateDelivery(record.userId, entry.idempotencyKey, input.delivery);
      }
    },
    { source: adapter, delivery },
  );
}

async function readSyncIndicator(page: Page): Promise<{ icon: string | null; text: string }> {
  const indicator = page.locator('[data-state]').first();
  await expect(indicator).toBeVisible();
  return indicator.evaluate((element) => ({
    icon: element.querySelector('svg')?.getAttribute('data-icon') ?? null,
    text: element.textContent?.trim() ?? '',
  }));
}

test.describe('product sync states (task 5.7)', () => {
  test('the workout route shows on device, syncing, and needs attention from the outbox', async ({
    page,
  }) => {
    await openWorkoutWithQueuedOutbox(page);

    await setOutboxDelivery(page, { state: 'in_flight', attempts: 1 });
    await page.reload();
    await expect(page.getByText('Syncing')).toBeVisible();
    await expect(page.getByText('On device')).toHaveCount(0);

    await setOutboxDelivery(page, {
      state: 'needs_attention',
      attempts: 1,
      lastFailure: 'http_422',
    });
    await page.reload();
    await expect(page.getByText('Needs attention')).toBeVisible();
    await expect(page.getByText('Syncing')).toHaveCount(0);

    await setOutboxDelivery(page, { state: 'queued' });
    await page.reload();
    await expect(page.getByText('On device')).toBeVisible();
  });

  test('the three product sync states stay distinguishable under achromatopsia', async ({
    page,
  }) => {
    await openWorkoutWithQueuedOutbox(page);

    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setEmulatedVisionDeficiency', { type: 'achromatopsia' });

    const seen: Array<{ icon: string | null; text: string }> = [];

    seen.push(await readSyncIndicator(page));

    await setOutboxDelivery(page, { state: 'in_flight', attempts: 1 });
    await page.reload();
    await cdp.send('Emulation.setEmulatedVisionDeficiency', { type: 'achromatopsia' });
    seen.push(await readSyncIndicator(page));

    await setOutboxDelivery(page, {
      state: 'needs_attention',
      attempts: 1,
      lastFailure: 'http_422',
    });
    await page.reload();
    await cdp.send('Emulation.setEmulatedVisionDeficiency', { type: 'achromatopsia' });
    seen.push(await readSyncIndicator(page));

    expect(seen).toHaveLength(3);
    expect(new Set(seen.map((state) => state.icon)).size).toBe(3);
    expect(new Set(seen.map((state) => state.text)).size).toBe(3);
    expect(seen.map((state) => state.text).sort()).toEqual([
      'Needs attention',
      'On device',
      'Syncing',
    ]);
  });

  test('the summary route shows needs attention when delivery permanently failed', async ({
    page,
  }) => {
    await openWorkoutWithQueuedOutbox(page);
    await page.getByRole('button', { name: 'Log set' }).click();
    await page.getByRole('button', { name: 'Skip rest' }).click();
    await page.getByRole('button', { name: 'Done' }).click();
    await page.waitForURL('**/summary/**');

    await setOutboxDelivery(page, {
      state: 'needs_attention',
      attempts: 2,
      lastFailure: 'http_422',
    });
    await page.reload();
    await expect(page.getByText('Needs attention')).toBeVisible();
  });
});
