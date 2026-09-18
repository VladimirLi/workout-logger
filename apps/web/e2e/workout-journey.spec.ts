import { readFileSync } from 'node:fs';
import { expect, type Page, test } from '@playwright/test';

/**
 * The plan, workout, and summary routes (workout-logging spec, tasks 5.1 and 5.2).
 *
 * The plan has to come from somewhere. No server exists (gate G-2), so these tests seed the
 * device store directly, which is the state the application would be in after a sync - not a
 * fixture rendered as if it were product data. Every assertion below is then against the real
 * routes reading the real IndexedDB store.
 */

const ADAPTER = 'packages/adapters-browser/dist/local-workout-store.js';

/** Seeds a downloaded plan before the app boots, so the first render already has one. */
async function seedPlan(page: Page): Promise<void> {
  // `export` is illegal inside a function body, so the keyword is stripped and the classes
  // are returned explicitly. The adapter has no runtime imports, which is what makes this
  // possible; browser-store.spec.ts asserts that and would fail first if it changed.
  const adapter = readFileSync(ADAPTER, 'utf8').replaceAll(/^export /gm, '');
  await page.addInitScript(
    ({ source }) => {
      // The store's own code, running in the page before any route script does.
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
        // No identity yet: let the application create it, then read it back.
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
    },
    { source: adapter },
  );
}

/** Opens today, makes sure the device identity exists, then seeds and reloads. */
async function openTodayWithPlan(page: Page): Promise<void> {
  await seedPlan(page);
  await page.goto('/today');
  await expect(page.getByRole('heading', { name: 'No plan on this device yet' })).toBeVisible();
  await page.evaluate(() => (window as unknown as { __seedPlan(): Promise<void> }).__seedPlan());
  await page.reload();
  await expect(page.getByRole('button', { name: 'Start workout' })).toBeVisible();
}

test.describe('the workout journey', () => {
  test('says plainly that no plan has reached the device', async ({ page }) => {
    // The honest empty state. Nothing can sync yet, and the screen says so rather than
    // showing an invented plan.
    await page.goto('/today');
    await expect(page.getByRole('heading', { name: 'No plan on this device yet' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Start workout' })).toHaveCount(0);
  });

  test('has no workout in progress until one is started', async ({ page }) => {
    await page.goto('/workout');
    await expect(page.getByRole('heading', { name: 'No workout in progress' })).toBeVisible();
  });

  test('starts a workout from the plan and reaches its own address', async ({ page }) => {
    await openTodayWithPlan(page);
    await page.getByRole('button', { name: 'Start workout' }).click();

    await page.waitForURL('**/workout');
    await expect(page.getByRole('heading', { name: 'In progress' })).toBeVisible();
    // Saved on the device and queued, with no server to deliver to.
    await expect(page.getByText('On device')).toBeVisible();
  });

  test('restores the workout after a refresh', async ({ page }) => {
    await openTodayWithPlan(page);
    await page.getByRole('button', { name: 'Start workout' }).click();
    await page.waitForURL('**/workout');

    await page.reload();
    await expect(page.getByRole('heading', { name: 'In progress' })).toBeVisible();
  });

  test('restores the workout after the page is destroyed and reopened directly', async ({
    page,
    context,
  }) => {
    // Task 5.2's process termination, and task 5.1's "can be reopened directly" in one: the
    // page is closed outright and the address is opened again in a new one.
    await openTodayWithPlan(page);
    await page.getByRole('button', { name: 'Start workout' }).click();
    await page.waitForURL('**/workout');
    await page.close({ runBeforeUnload: false });

    const reopened = await context.newPage();
    await reopened.goto('/workout');
    await expect(reopened.getByRole('heading', { name: 'In progress' })).toBeVisible();
    await reopened.close();
  });

  test('offers to continue the workout from today rather than starting a second', async ({
    page,
  }) => {
    await openTodayWithPlan(page);
    await page.getByRole('button', { name: 'Start workout' }).click();
    await page.waitForURL('**/workout');

    await page.goto('/today');
    await expect(page.getByRole('heading', { name: 'A workout is in progress' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Continue the workout' })).toBeVisible();
    // Task 5.3 turns this into a resume-or-discard choice; there is no second start here.
    await expect(page.getByRole('button', { name: 'Start workout' })).toHaveCount(0);
  });

  test('finishes the workout and leaves a summary at its own address', async ({ page }) => {
    await openTodayWithPlan(page);
    await page.getByRole('button', { name: 'Start workout' }).click();
    await page.waitForURL('**/workout');
    await page.getByRole('button', { name: 'Done' }).click();

    await page.waitForURL('**/summary/**');
    await expect(page.getByRole('heading', { name: 'Finished' })).toBeVisible();

    // Reopened directly, by address, in the same state.
    const address = page.url();
    await page.goto('/today');
    await page.goto(address);
    await expect(page.getByRole('heading', { name: 'Finished' })).toBeVisible();
  });

  test('says a summary is not on this device rather than failing', async ({ page }) => {
    await page.goto('/summary/not-a-session');
    await expect(
      page.getByRole('heading', { name: 'That session is not on this device' }),
    ).toBeVisible();
  });
});

test.describe('logging a set', () => {
  /** Starts a workout from a seeded plan and lands on the set view. */
  async function atTheSetView(page: Page): Promise<void> {
    await openTodayWithPlan(page);
    await page.getByRole('button', { name: 'Start workout' }).click();
    await page.waitForURL('**/workout');
    await expect(page.getByRole('heading', { name: 'back-squat' })).toBeVisible();
  }

  test('records a set performed as prescribed in one action', async ({ page }) => {
    // Task 5.4. The controls open on the prescription, so accepting it is one press.
    await atTheSetView(page);
    await expect(page.getByText('80 kg × 8')).toBeVisible();

    await page.getByRole('button', { name: 'Log set' }).click();

    await expect(page.getByRole('heading', { name: 'Rest' })).toBeVisible();
    // The set reached the device: the table shows it after the screen re-reads. The load cell
    // is spoken with its unit, which is the design system's doing and worth asserting.
    await expect(page.getByRole('cell', { name: '80 kilograms' })).toBeVisible();
    await expect(page.getByRole('cell', { name: '8', exact: true })).toBeVisible();
    await expect(page.getByText('That set was not saved')).toHaveCount(0);
  });

  test('records what the controls say, not the prescription', async ({ page }) => {
    // The second half of task 5.4: modifying before logging is still one press afterwards.
    await atTheSetView(page);
    await page.getByRole('button', { name: 'Increase load' }).click();
    await page.getByRole('button', { name: 'Decrease reps' }).click();

    await page.getByRole('button', { name: 'Log set' }).click();
    await expect(page.getByRole('heading', { name: 'Rest' })).toBeVisible();

    // 80 + 2.5 kg and 8 - 1 reps, as adjusted.
    await expect(page.getByRole('cell', { name: '82.5 kilograms' })).toBeVisible();
    await expect(page.getByRole('cell', { name: '7', exact: true })).toBeVisible();
  });

  test('stores the RIR that was entered and never an editable RPE', async ({ page }) => {
    // Task 5.8. RPE is derived by the domain from the RIR; nothing on the screen accepts one.
    await atTheSetView(page);
    await page.getByRole('radio', { name: '2', exact: true }).check();
    await page.getByRole('button', { name: 'Log set' }).click();
    await expect(page.getByRole('heading', { name: 'Rest' })).toBeVisible();

    // The RIR column carries the entered value; nothing offers to type an RPE.
    await expect(page.getByRole('row', { name: /80 kilograms 8 2/ })).toBeVisible();
    await expect(page.getByLabel(/rpe/i)).toHaveCount(0);
  });

  test('counts rest down from the timestamp, not from ticks', async ({ page }) => {
    // Task 5.6. The clock is moved forward by 60 seconds in one jump, which is what a
    // suspended tab looks like: an interval-accumulating timer would still read 1:30.
    await atTheSetView(page);
    await page.clock.install();
    await page.getByRole('button', { name: 'Log set' }).click();
    await expect(page.getByRole('heading', { name: 'Rest' })).toBeVisible();
    // The spoken remaining time, which is unambiguous; the visible clock has no role.
    await expect(page.getByText(/1 minute 30 seconds left/)).toBeVisible();

    await page.clock.fastForward(60_000);
    await expect(page.getByText(/30 seconds left/)).toBeVisible();
    await expect(page.getByText(/1 minute 30 seconds left/)).toHaveCount(0);
  });

  test('keeps the recorded set after the page is destroyed', async ({ page, context }) => {
    await atTheSetView(page);
    await page.getByRole('button', { name: 'Log set' }).click();
    await expect(page.getByRole('cell', { name: '80 kilograms' })).toBeVisible();
    await page.close({ runBeforeUnload: false });

    const reopened = await context.newPage();
    await reopened.goto('/workout');
    await expect(reopened.getByRole('cell', { name: '80 kilograms' })).toBeVisible();
    await reopened.close();
  });
});
