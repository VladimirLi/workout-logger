import { readFileSync } from 'node:fs';
import { expect, type Page, test } from '@playwright/test';

const ADAPTER = 'packages/adapters-browser/dist/local-workout-store.js';

async function seedPlan(page: Page): Promise<void> {
  const adapter = readFileSync(ADAPTER, 'utf8').replaceAll(/^export /gm, '');
  await page.addInitScript((source: string) => {
    const factory = new Function(`${source}\nreturn { IndexedDbPlanStore };`) as () => {
      IndexedDbPlanStore: new () => { save(userId: string, plan: unknown): Promise<void> };
    };
    const { IndexedDbPlanStore } = factory();

    const identity = async (): Promise<string> => {
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('workout');
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

async function openTodayWithPlan(page: Page): Promise<void> {
  await seedPlan(page);
  await page.goto('/today');
  await expect(page.getByRole('heading', { name: 'No plan on this device yet' })).toBeVisible();
  await page.evaluate(() => (window as unknown as { __seedPlan(): Promise<void> }).__seedPlan());
  await page.reload();
  await expect(page.getByRole('button', { name: 'Start workout' })).toBeVisible();
}

test.describe('recoverable deletion (tasks 8.3, 8.4, 8.5)', () => {
  test('explains backup expiry before deleting, recovers within 30 days', async ({ page }) => {
    await openTodayWithPlan(page);
    await page.getByRole('button', { name: 'Start workout' }).click();
    await page.waitForURL('**/workout');
    await page.getByRole('button', { name: 'Log set' }).click();
    await page.getByRole('button', { name: 'Done' }).click();
    await page.waitForURL('**/summary?session=**');

    await page.goto('/settings');
    await expect(page.getByRole('heading', { name: 'Your data' })).toBeVisible();
    await expect(
      page.getByText(/none are scheduled while this stays a private single-user slice/i),
    ).toBeVisible();

    await page.getByRole('button', { name: 'Delete all history' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: 'Delete all history?' })).toBeVisible();
    await expect(dialog.getByText(/recoverable here for 30 days/i)).toBeVisible();
    await expect(dialog.getByText(/pre-migration dump/i)).toBeVisible();
    await expect(dialog.getByText(/retired under the backup runbook/i)).toBeVisible();
    await dialog.getByRole('button', { name: 'Delete history' }).click();

    await expect(page.getByRole('heading', { name: 'Deletion pending' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Restore history' })).toBeVisible();

    await page.goto('/today');
    await expect(page.getByRole('heading', { name: 'No plan on this device yet' })).toBeVisible();

    await page.goto('/settings');
    await page.getByRole('button', { name: 'Restore history' }).click();
    await expect(page.getByText('Your history is back on this device.')).toBeVisible();

    await page.goto('/today');
    await expect(page.getByRole('button', { name: 'Start workout' })).toBeVisible();
  });

  test('is reachable from diagnostics', async ({ page }) => {
    await page.goto('/diagnostics');
    await page.getByRole('link', { name: 'Settings' }).click();
    await page.waitForURL('**/settings');
    await expect(page.getByRole('heading', { name: 'Your data' })).toBeVisible();
  });
});
