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

    await page.waitForURL('**/summary?session=**');
    await expect(page.getByRole('heading', { name: 'Finished' })).toBeVisible();

    // Reopened directly, by address, in the same state.
    const address = page.url();
    await page.goto('/today');
    await page.goto(address);
    await expect(page.getByRole('heading', { name: 'Finished' })).toBeVisible();
  });

  test('says a summary is not on this device rather than failing', async ({ page }) => {
    await page.goto('/summary?session=not-a-session');
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

test.describe('diagnostics', () => {
  test('reports the persistent-storage answer, whatever it is', async ({ page }) => {
    // Task 4.10. The spec requires the state to be surfaced rather than swallowed, so the
    // test accepts any of the real answers and requires the page to explain the consequence.
    await page.goto('/diagnostics');
    await expect(page.getByRole('heading', { name: 'Storage' })).toBeVisible();
    await expect(
      page.getByText(/^Persistent storage: (granted|denied|unsupported|error)$/),
    ).toBeVisible();
    await expect(page.getByText(/evicted|will not be evicted/)).toBeVisible();
  });

  test('reports a denial rather than silently continuing', async ({ page }) => {
    // The browser is made to refuse, which is the case the spec names.
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'storage', {
        configurable: true,
        value: {
          persisted: () => Promise.resolve(false),
          persist: () => Promise.resolve(false),
          estimate: () => Promise.resolve({ usage: 0, quota: 0 }),
        },
      });
    });
    await page.goto('/diagnostics');
    await expect(page.getByText('Persistent storage: denied')).toBeVisible();
    await expect(page.getByText(/may be evicted under storage pressure/)).toBeVisible();
  });

  test('says nothing is waiting, and then how much is', async ({ page }) => {
    await page.goto('/diagnostics');
    await expect(page.getByText('Nothing is waiting to be delivered.')).toBeVisible();

    await openTodayWithPlan(page);
    await page.getByRole('button', { name: 'Start workout' }).click();
    await page.waitForURL('**/workout');
    await page.getByRole('button', { name: 'Log set' }).click();
    await expect(page.getByRole('cell', { name: '80 kilograms' })).toBeVisible();

    await page.goto('/diagnostics');
    // Starting the session and logging the set are two queued changes.
    await expect(
      page.getByText('2 changes recorded on this device and not yet delivered.'),
    ).toBeVisible();
  });
});

test('@a11y the live set view fits a 375 by 667 phone with no sideways scrolling', async ({
  page,
}) => {
  // Task 5.5, against the real route rather than the lab: the current exercise, the target
  // against the actual, the sync state, and the primary action all have to be reachable at
  // the smallest phone this project supports.
  await page.setViewportSize({ width: 375, height: 667 });
  await openTodayWithPlan(page);
  await page.getByRole('button', { name: 'Start workout' }).click();
  await page.waitForURL('**/workout');
  await expect(page.getByRole('heading', { name: 'back-squat' })).toBeVisible();

  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(overflow.scrollWidth, 'the page scrolls sideways').toBeLessThanOrEqual(
    overflow.clientWidth,
  );

  // All four things the spec names are on the page.
  await expect(page.getByText('80 kg × 8')).toBeVisible();
  await expect(page.getByText('On device')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Log set' })).toBeVisible();
  await expect(page.getByRole('spinbutton', { name: 'Load' })).toBeVisible();
});

test.describe('the offline journey', () => {
  test('logs a whole session with the network off, and keeps every set', async ({
    page,
    context,
  }) => {
    // Task 9.1, against the production build the webServer runs. Offline is the condition the
    // product exists for: the device is the first place a fact is saved (ADR-0003), so nothing
    // here should behave differently from the online path - and nothing should be lost.
    await openTodayWithPlan(page);
    // The app has been used before: visiting the workout route once online is what puts its
    // assets in the service worker's cache, exactly as an ordinary first session would.
    await page.goto('/workout');
    await expect(page.getByRole('heading', { name: 'No workout in progress' })).toBeVisible();
    await page.goto('/summary');
    await expect(
      page.getByRole('heading', { name: 'That session is not on this device' }),
    ).toBeVisible();
    await page.goto('/today');
    await expect(page.getByRole('button', { name: 'Start workout' })).toBeVisible();

    await context.setOffline(true);

    await page.getByRole('button', { name: 'Start workout' }).click();
    await page.waitForURL('**/workout');
    await expect(page.getByRole('heading', { name: 'back-squat' })).toBeVisible();

    await page.getByRole('button', { name: 'Log set' }).click();
    await expect(page.getByRole('cell', { name: '80 kilograms' })).toBeVisible();

    // A reload with the network still off: served by the service worker, read from IndexedDB.
    await page.reload();
    await expect(page.getByRole('cell', { name: '80 kilograms' })).toBeVisible();

    await page.getByRole('button', { name: 'Increase load' }).click();
    await page.getByRole('button', { name: 'Log set' }).click();
    await expect(page.getByRole('cell', { name: '82.5 kilograms' })).toBeVisible();

    await page.getByRole('button', { name: 'Done' }).click();
    await page.waitForURL('**/summary?session=**');
    await expect(page.getByRole('heading', { name: 'Finished' })).toBeVisible();

    // Both sets, the start, and the completion are queued, and none of them was lost. Read
    // from the database in the page rather than by navigating: moving to another route with
    // the network off is covered where it is reliable (the reload above and the summary), and
    // a navigation this test does not need should not be what makes it fail.
    const queued = await page.evaluate(
      () =>
        new Promise<number>((resolve, reject) => {
          const request = indexedDB.open('workout', 1);
          request.onsuccess = () => {
            const count = request.result
              .transaction('outbox', 'readonly')
              .objectStore('outbox')
              .count();
            count.onsuccess = () => resolve(count.result);
            count.onerror = () => reject(count.error);
          };
          request.onerror = () => reject(request.error);
        }),
    );
    expect(queued, 'a change recorded offline was lost').toBe(4);

    await context.setOffline(false);
  });
});

test.describe('discarding a workout (task 5.3)', () => {
  test('asks before discarding, and says what is lost', async ({ page }) => {
    await openTodayWithPlan(page);
    await page.getByRole('button', { name: 'Start workout' }).click();
    await page.waitForURL('**/workout');
    await page.getByRole('button', { name: 'Log set' }).click();
    await expect(page.getByRole('cell', { name: '80 kilograms' })).toBeVisible();

    await page.goto('/today');
    await page.getByRole('button', { name: 'Discard the workout' }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    // The count is the point: the spec asks for a confirmation because results are lost.
    await expect(dialog).toContainText('1 set');
    await expect(dialog.getByRole('button', { name: 'Keep the workout' })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Discard it' })).toBeVisible();
  });

  test('keeps the workout when the confirmation is declined', async ({ page }) => {
    await openTodayWithPlan(page);
    await page.getByRole('button', { name: 'Start workout' }).click();
    await page.waitForURL('**/workout');

    await page.goto('/today');
    await page.getByRole('button', { name: 'Discard the workout' }).click();
    await page.getByRole('button', { name: 'Keep the workout' }).click();

    await expect(page.getByRole('dialog')).toBeHidden();
    await expect(page.getByRole('heading', { name: 'A workout is in progress' })).toBeVisible();
    await page.goto('/workout');
    await expect(page.getByRole('heading', { name: 'In progress' })).toBeVisible();
  });

  test('discards the workout and its queue once confirmed, and lets the next one start', async ({
    page,
  }) => {
    await openTodayWithPlan(page);
    await page.getByRole('button', { name: 'Start workout' }).click();
    await page.waitForURL('**/workout');
    await page.getByRole('button', { name: 'Log set' }).click();
    await expect(page.getByRole('cell', { name: '80 kilograms' })).toBeVisible();

    await page.goto('/today');
    await page.getByRole('button', { name: 'Discard the workout' }).click();
    await page.getByRole('button', { name: 'Discard it' }).click();

    // The plan is offered again, because nothing is active any more.
    await expect(page.getByRole('button', { name: 'Start workout' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'A workout is in progress' })).toHaveCount(0);

    // Nothing of it is left on the device, queue included.
    const queued = await page.evaluate(
      () =>
        new Promise<number>((resolve, reject) => {
          const request = indexedDB.open('workout', 1);
          request.onsuccess = () => {
            const count = request.result
              .transaction('outbox', 'readonly')
              .objectStore('outbox')
              .count();
            count.onsuccess = () => resolve(count.result);
            count.onerror = () => reject(count.error);
          };
          request.onerror = () => reject(request.error);
        }),
    );
    expect(queued).toBe(0);

    await page.getByRole('button', { name: 'Start workout' }).click();
    await page.waitForURL('**/workout');
    await expect(page.getByRole('heading', { name: 'In progress' })).toBeVisible();
  });

  test('@a11y the confirmation is a dialog that keyboard and screen readers can use', async ({
    page,
  }) => {
    await openTodayWithPlan(page);
    await page.getByRole('button', { name: 'Start workout' }).click();
    await page.waitForURL('**/workout');
    await page.goto('/today');

    await page.getByRole('button', { name: 'Discard the workout' }).press('Enter');
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    // Named by its own title, so a screen reader announces what is being asked.
    await expect(dialog).toHaveAccessibleName(/discard/i);

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('heading', { name: 'A workout is in progress' })).toBeVisible();
  });
});

test.describe('a full device (task 4.8)', () => {
  /**
   * Makes the next write meet a full device, using the browser's own error.
   *
   * Chromium's quota override does not reject a small IndexedDB write even with the quota at
   * one byte (see browser-store.spec.ts), so the store is given a factory that raises the real
   * QuotaExceededError from the next put. Nothing in the application is modified for the test.
   */
  async function failTheNextWrite(page: Page): Promise<void> {
    await page.addInitScript(() => {
      const forward = (target: object, prop: string | symbol) => {
        const value = Reflect.get(target, prop, target);
        return typeof value === 'function' ? (value as () => unknown).bind(target) : value;
      };
      const setOnTarget = (target: object, prop: string | symbol, value: unknown) => {
        Reflect.set(target, prop, value, target);
        return true;
      };
      let armed = false;
      (window as unknown as { __failNextWrite(): void }).__failNextWrite = () => {
        armed = true;
      };

      const wrapStore = (store: IDBObjectStore) =>
        new Proxy(store, {
          set: setOnTarget,
          get(target, prop) {
            if (prop === 'put' && armed) {
              armed = false;
              return () => {
                throw new DOMException('the device is full', 'QuotaExceededError');
              };
            }
            return forward(target, prop);
          },
        });
      const wrapTransaction = (transaction: IDBTransaction) =>
        new Proxy(transaction, {
          set: setOnTarget,
          get: (target, prop) =>
            prop === 'objectStore'
              ? (name: string) => wrapStore(target.objectStore(name))
              : forward(target, prop),
        });
      const wrapDatabase = (database: IDBDatabase) =>
        new Proxy(database, {
          set: setOnTarget,
          get: (target, prop) =>
            prop === 'transaction'
              ? (...args: unknown[]) =>
                  wrapTransaction(
                    (target.transaction as (...a: unknown[]) => IDBTransaction)(...args),
                  )
              : forward(target, prop),
        });

      const open = indexedDB.open.bind(indexedDB);
      Object.defineProperty(indexedDB, 'open', {
        configurable: true,
        value: (name: string, version?: number) => {
          const request = open(name, version);
          return new Proxy(request, {
            set: setOnTarget,
            get: (target, prop) =>
              prop === 'result' ? wrapDatabase(target.result) : forward(target, prop),
          });
        },
      });
    });
  }

  test('refuses the set, says the device is full, and offers the export', async ({ page }) => {
    await failTheNextWrite(page);
    await openTodayWithPlan(page);
    await page.getByRole('button', { name: 'Start workout' }).click();
    await page.waitForURL('**/workout');
    await expect(page.getByRole('heading', { name: 'back-squat' })).toBeVisible();

    await page.evaluate(() => (window as unknown as { __failNextWrite(): void }).__failNextWrite());
    await page.getByRole('button', { name: 'Log set' }).click();

    // The write stopped, and the screen says so rather than looking as though it saved.
    await expect(page.getByText('There is no room left on this device')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Export everything' })).toBeVisible();
    // Nothing was recorded, and what was already queued is untouched.
    await expect(page.getByRole('cell', { name: '80 kilograms' })).toHaveCount(0);
  });

  test('the export the offer produces is the whole archive', async ({ page }) => {
    await failTheNextWrite(page);
    await openTodayWithPlan(page);
    await page.getByRole('button', { name: 'Start workout' }).click();
    await page.waitForURL('**/workout');
    await page.evaluate(() => (window as unknown as { __failNextWrite(): void }).__failNextWrite());
    await page.getByRole('button', { name: 'Log set' }).click();
    await expect(page.getByRole('button', { name: 'Export everything' })).toBeVisible();

    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export everything' }).click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/\.json$/);

    const stream = await file.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    const archive = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
      schemaVersion: number;
      sessions: unknown[];
    };
    expect(archive.schemaVersion).toBe(1);
    // The session that was already on the device is in it: the export is a way out, not a
    // gesture.
    expect(archive.sessions).toHaveLength(1);
  });
});
