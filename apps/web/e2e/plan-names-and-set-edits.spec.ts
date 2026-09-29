import { readFileSync } from 'node:fs';
import { expect, type Page, test } from '@playwright/test';
import { finishWorkout } from './finish';

/**
 * Plan-carried rest, plan names, several sessions on Today, and editing or deleting a recorded
 * set (spec rev 2, deltas D-1, D-21..D-26). The plan is seeded into the device store, the state
 * a sync would leave, and every assertion is against the real routes.
 */

const ADAPTER = 'packages/adapters-browser/dist/local-workout-store.js';

interface SeedExercise {
  exerciseId: string;
  name?: string;
  restSeconds?: number;
  loadKg: number;
  reps: number;
}
interface SeedSession {
  id: string;
  name?: string;
  scheduledFor: string;
  exercises: SeedExercise[];
}
interface SeedPlan {
  name?: string;
  revision?: number;
  sessions: SeedSession[];
}

const SQUAT: SeedExercise = {
  exerciseId: 'ex-7f3a9c',
  name: 'Back squat',
  restSeconds: 120,
  loadKg: 80,
  reps: 8,
};
const BENCH: SeedExercise = { exerciseId: 'ex-1b2c3d', name: 'Bench press', loadKg: 60, reps: 6 };

const PUSH_DAY: SeedSession = {
  id: 'a3f1c2d4-5b6e-47f8-9a0b-1c2d3e4f5a6b',
  name: 'Heavy lower day',
  scheduledFor: '2026-09-18',
  exercises: [SQUAT, BENCH],
};

async function seedPlan(page: Page, plan: SeedPlan): Promise<void> {
  const adapter = readFileSync(ADAPTER, 'utf8').replaceAll(/^export /gm, '');
  await page.addInitScript(
    (input: { source: string; initial: SeedPlan }) => {
      const factory = new Function(`${input.source}\nreturn { IndexedDbPlanStore };`) as () => {
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
          const get = database
            .transaction('device-identity', 'readonly')
            .objectStore('device-identity')
            .get('current');
          get.onsuccess = () => resolve(get.result as { userId: string } | undefined);
          get.onerror = () => reject(get.error);
        });
        database.close();
        if (record) return record.userId;
        await new Promise((resolve) => setTimeout(resolve, 50));
        return identity();
      };
      (window as unknown as { __seedPlan: (plan?: SeedPlan) => Promise<void> }).__seedPlan = async (
        plan = input.initial,
      ) => {
        const userId = await identity();
        await new IndexedDbPlanStore().save(userId, {
          status: 'active',
          id: 'plan-1',
          revision: plan.revision ?? 1,
          activatedAt: new Date('2026-09-18T08:00:00Z'),
          ...(plan.name !== undefined ? { name: plan.name } : {}),
          sessions: plan.sessions.map((session) => ({
            id: session.id,
            ...(session.name !== undefined ? { name: session.name } : {}),
            scheduledFor: session.scheduledFor,
            exercises: session.exercises.map((exercise) => ({
              exerciseId: exercise.exerciseId,
              ...(exercise.name !== undefined ? { name: exercise.name } : {}),
              ...(exercise.restSeconds !== undefined ? { restSeconds: exercise.restSeconds } : {}),
              prescription: {
                schemaVersion: 1,
                profile: 'strength',
                repetitions: exercise.reps,
                load: { unit: 'kg', value: exercise.loadKg },
              },
            })),
          })),
        });
      };
    },
    { source: adapter, initial: plan },
  );
}

async function openToday(page: Page, plan: SeedPlan): Promise<void> {
  await seedPlan(page, plan);
  await page.goto('/today');
  await expect(page.getByRole('heading', { name: 'No plan on this device yet' })).toBeVisible();
  await page.evaluate(() => (window as unknown as { __seedPlan(): Promise<void> }).__seedPlan());
  await page.reload();
}

async function startWorkout(page: Page, plan: SeedPlan): Promise<void> {
  await openToday(page, plan);
  await page.getByRole('button', { name: 'Start workout' }).click();
  await page.waitForURL('**/workout');
}

const ONE_SESSION: SeedPlan = { name: 'Autumn strength block', sessions: [PUSH_DAY] };

/** Logs a set with the prescribed values, then goes back to the set view. */
async function logSet(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Log set' }).click();
  await page.getByRole('button', { name: 'Next set' }).click();
}

/** Rewrites the active session's first set in the device store, as an import or an agent could have left it. */
async function rewriteFirstSet(page: Page, patch: Record<string, unknown>): Promise<void> {
  await page.evaluate(async (fields) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('workout');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction('sessions', 'readwrite');
      const cursor = transaction.objectStore('sessions').openCursor();
      cursor.onsuccess = () => {
        const at = cursor.result;
        if (!at) return;
        const { session } = at.value as {
          session: { status: string; sets: { measurement: object }[] };
        };
        if (session.status === 'active' && session.sets[0]) {
          Object.assign(session.sets[0].measurement, fields);
          at.update(at.value);
        }
        at.continue();
      };
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    database.close();
  }, patch);
}

/** A strength exertion as the domain stores it, for a set an import left with this RIR. */
const exertionOf = (rir: number) => ({
  exertion: {
    profile: 'strength',
    rir: { kind: 'rir', value: rir },
    rpe: { kind: 'rpe_derived', value: Math.max(1, 10 - rir) },
  },
});

/** How many mutations are queued to sync: an edit that wrote something adds one. */
async function queuedMutations(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('workout');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const count = await new Promise<number>((resolve, reject) => {
      const request = database.transaction('outbox', 'readonly').objectStore('outbox').count();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    database.close();
    return count;
  });
}

const primaries = (page: Page) => page.locator('button[data-variant="primary"]:visible');

test.describe('plan-carried rest (D-21)', () => {
  test('rest starts at the plan rest for the exercise just logged', async ({ page }) => {
    await startWorkout(page, ONE_SESSION);
    await page.getByRole('button', { name: 'Log set' }).click();
    await expect(page.getByText('Set 1 saved. Rest 2:00.').first()).toBeVisible();
    await expect(page.getByText(/prescribed|default/i)).toHaveCount(0);
  });

  test('falls back to 90 seconds where the plan carries none', async ({ page }) => {
    await startWorkout(page, ONE_SESSION);
    await page.getByRole('button', { name: 'Bench press' }).click();
    await page.getByRole('button', { name: 'Log set' }).click();
    await expect(page.getByText('Set 1 saved. Rest 1:30.').first()).toBeVisible();
  });
});

test.describe('names (D-1)', () => {
  test('shows the schema names on Today, workout, summary and history, never an id', async ({
    page,
  }) => {
    await openToday(page, ONE_SESSION);
    await expect(page.getByRole('heading', { name: 'Autumn strength block' })).toBeVisible();
    await expect(page.getByText('Heavy lower day, Fri 18 Sept')).toBeVisible();

    await page.getByRole('button', { name: 'Start workout' }).click();
    await page.waitForURL('**/workout');
    await expect(page.getByRole('heading', { level: 1, name: 'Back squat' })).toBeVisible();
    await page.getByRole('button', { name: 'Log set' }).click();
    await finishWorkout(page);
    await page.waitForURL('**/summary?session=**');
    await expect(page.getByRole('heading', { name: 'Back squat' })).toBeVisible();

    const body = await page.locator('body').innerText();
    expect(body).not.toMatch(/ex-7f3a9c|a3f1c2d4|[0-9a-f]{8}-[0-9a-f]{4}/i);

    await page.goto('/history');
    await expect(page.getByRole('link', { name: /Heavy lower day/ })).toBeVisible();
    expect(await page.locator('body').innerText()).not.toMatch(/a3f1c2d4|Session a3f1/i);
  });

  test('a long name wraps on /workout and is not truncated', async ({ page }) => {
    const long = 'Paused Romanian deadlift, slow lowering, hold at the bottom of the rep';
    await page.setViewportSize({ width: 375, height: 667 });
    await startWorkout(page, {
      sessions: [{ ...PUSH_DAY, exercises: [{ ...SQUAT, name: long.slice(0, 60) }] }],
    });
    const heading = page.getByRole('heading', { level: 1, name: long.slice(0, 60) });
    await expect(heading).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test('a session keeps the name it started with when the plan revision changes', async ({
    page,
  }) => {
    await startWorkout(page, ONE_SESSION);
    await page.getByRole('button', { name: 'Log set' }).click();
    await page.evaluate(() =>
      (window as unknown as { __seedPlan(plan: unknown): Promise<void> }).__seedPlan({
        revision: 2,
        name: 'Winter block',
        sessions: [
          {
            id: 'a3f1c2d4-5b6e-47f8-9a0b-1c2d3e4f5a6b',
            name: 'Renamed later',
            scheduledFor: '2026-09-18',
            exercises: [
              {
                exerciseId: 'ex-7f3a9c',
                name: 'Renamed squat',
                loadKg: 100,
                reps: 5,
              },
            ],
          },
        ],
      }),
    );
    await page.reload();
    await expect(page.getByRole('button', { name: 'Back squat', exact: true })).toBeVisible();
    await finishWorkout(page);
    await page.waitForURL('**/summary?session=**');
    await expect(page.getByRole('heading', { name: 'Back squat' })).toBeVisible();
    await page.goto('/history');
    await expect(page.getByRole('link', { name: /Heavy lower day/ })).toBeVisible();
    await expect(page.getByText('Renamed later')).toHaveCount(0);
  });
});

test.describe('several sessions on Today (D-22, D-26)', () => {
  const TWO: SeedPlan = {
    name: 'Autumn strength block',
    sessions: [
      PUSH_DAY,
      {
        id: 'b4e2d3c5-6c7f-48a9-8b1c-2d3e4f5a6b7c',
        name: 'Upper day',
        scheduledFor: '2026-09-18',
        exercises: [BENCH],
      },
    ],
  };

  test('offers one Start button per session, the first primary and the rest secondary', async ({
    page,
  }) => {
    await openToday(page, TWO);
    await expect(page.getByRole('button', { name: 'Start Heavy lower day' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Start Upper day' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Start workout' })).toHaveCount(0);
    await expect(primaries(page)).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Start Heavy lower day' })).toHaveAttribute(
      'data-variant',
      'primary',
    );
    await expect(page.getByRole('button', { name: 'Start Upper day' })).toHaveAttribute(
      'data-variant',
      'secondary',
    );
  });

  test('a completed session drops off, and Today says the day is done when none are left', async ({
    page,
  }) => {
    await openToday(page, TWO);
    await page.getByRole('button', { name: 'Start Heavy lower day' }).click();
    await page.waitForURL('**/workout');
    await page.getByRole('button', { name: 'Log set' }).click();
    await finishWorkout(page);
    await page.waitForURL('**/summary?session=**');

    await page.goto('/today');
    await expect(page.getByRole('button', { name: 'Start workout' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Start Heavy lower day/ })).toHaveCount(0);
    await page.getByRole('button', { name: 'Start workout' }).click();
    await page.waitForURL('**/workout');
    await page.getByRole('button', { name: 'Log set' }).click();
    await finishWorkout(page);
    await page.waitForURL('**/summary?session=**');

    await page.goto('/today');
    await expect(page.getByRole('heading', { name: "Today's workout is done" })).toBeVisible();
    await expect(page.getByText('Your summary is saved on this device.')).toBeVisible();
    await expect(page.getByRole('button', { name: /Start/ })).toHaveCount(0);
    await page.getByRole('button', { name: 'See your history' }).click();
    await page.waitForURL('**/history');
  });
  test('offers only what is scheduled for today or earlier, and an old completion does not count for a moved session', async ({
    page,
  }) => {
    await page.clock.setFixedTime(new Date('2026-09-29T10:00:00Z'));
    const plan: SeedPlan = {
      name: 'Autumn strength block',
      sessions: [
        { ...PUSH_DAY, scheduledFor: '2026-09-29' },
        {
          id: 'c5f3e4d6-7d80-49ba-9c2d-3e4f5a6b7c8d',
          name: 'Later this week',
          scheduledFor: '2026-09-30',
          exercises: [BENCH],
        },
      ],
    };
    await openToday(page, plan);
    await expect(page.getByRole('button', { name: 'Start workout' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Later this week/ })).toHaveCount(0);

    await page.getByRole('button', { name: 'Start workout' }).click();
    await page.waitForURL('**/workout');
    await page.getByRole('button', { name: 'Log set' }).click();
    await finishWorkout(page);
    await page.waitForURL('**/summary?session=**');

    await page.goto('/today');
    await expect(page.getByRole('heading', { name: "Today's workout is done" })).toBeVisible();

    // The same session, moved to tomorrow: the workout done today is not tomorrow's.
    await page.evaluate(
      (moved) =>
        (window as unknown as { __seedPlan(plan: unknown): Promise<void> }).__seedPlan(moved),
      {
        revision: 2,
        name: 'Autumn strength block',
        sessions: [{ ...PUSH_DAY, scheduledFor: '2026-09-30' }],
      },
    );
    await page.clock.setFixedTime(new Date('2026-09-30T10:00:00Z'));
    await page.reload();
    await expect(page.getByRole('button', { name: 'Start workout' })).toBeVisible();
  });

  test('says when nothing is scheduled yet', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-09-29T10:00:00Z'));
    await openToday(page, {
      name: 'Autumn strength block',
      sessions: [{ ...PUSH_DAY, scheduledFor: '2026-10-02' }],
    });
    await expect(page.getByRole('heading', { name: 'Nothing scheduled for today' })).toBeVisible();
    await expect(page.getByText(/Your next workout is on/)).toBeVisible();
    await expect(page.getByRole('button', { name: /Start/ })).toHaveCount(0);
  });
});

test.describe('editing a recorded set (D-23, D-25)', () => {
  test('edits in place, returns focus to the row Edit button, and announces it', async ({
    page,
  }) => {
    await startWorkout(page, ONE_SESSION);
    await logSet(page);
    await expect(primaries(page)).toHaveCount(1);
    await expect(
      page.locator('[data-testid="bottom-tabs"], nav[aria-label*="Primary"]'),
    ).toHaveCount(0);

    await page.getByRole('button', { name: 'Edit set 1, Back squat' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Back squat' })).toBeFocused();
    await expect(page.getByText('Editing set 1')).toBeVisible();
    await expect(page.locator('form:visible').getByLabel('Target')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Finish workout' })).toHaveCount(0);
    await expect(primaries(page)).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Save changes' })).toHaveAttribute(
      'data-variant',
      'primary',
    );
    await expect(page.getByRole('spinbutton', { name: 'Reps' })).toHaveValue('8');

    await page.getByRole('spinbutton', { name: 'Reps' }).fill('6');
    await page.getByRole('button', { name: 'Save changes' }).click();

    const edit = page.getByRole('button', { name: 'Edit set 1, Back squat' });
    await expect(edit).toBeFocused();
    await expect(page.getByRole('status').filter({ hasText: 'Set 1 updated' })).toBeVisible();
    await expect(page.getByRole('cell', { name: '6', exact: true })).toBeVisible();
  });

  test('saving nothing changed writes nothing, and Cancel leaves the set as it was', async ({
    page,
  }) => {
    await startWorkout(page, ONE_SESSION);
    await logSet(page);
    await page.getByRole('button', { name: 'Edit set 1, Back squat' }).click();
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByRole('button', { name: 'Edit set 1, Back squat' })).toBeFocused();

    await page.getByRole('button', { name: 'Edit set 1, Back squat' }).click();
    await page.getByRole('spinbutton', { name: 'Reps' }).fill('3');
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('button', { name: 'Edit set 1, Back squat' })).toBeFocused();
    await expect(page.getByRole('cell', { name: '8', exact: true })).toBeVisible();
    await expect(page.getByRole('cell', { name: '3', exact: true })).toHaveCount(0);
  });

  test('has no Edit column on the summary', async ({ page }) => {
    await startWorkout(page, ONE_SESSION);
    await page.getByRole('button', { name: 'Log set' }).click();
    await finishWorkout(page);
    await page.waitForURL('**/summary?session=**');
    await expect(page.getByRole('button', { name: /Edit set/ })).toHaveCount(0);
    await expect(page.getByRole('columnheader', { name: 'Actions' })).toHaveCount(0);
  });

  for (const viewport of [
    { width: 375, height: 667 },
    { width: 667, height: 375 },
  ]) {
    test(`editing fits ${viewport.width}x${viewport.height} with no horizontal scroll`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      await startWorkout(page, ONE_SESSION);
      await logSet(page);
      await page.getByRole('button', { name: 'Edit set 1, Back squat' }).click();
      await expect(page.getByRole('button', { name: 'Save changes' })).toBeVisible();
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
    });
  }
});

test.describe('opening a recorded set never rewrites it', () => {
  for (const rir of [5, 3.5]) {
    test(`saving an RIR of ${rir} untouched writes nothing`, async ({ page }) => {
      await startWorkout(page, ONE_SESSION);
      await logSet(page);
      await rewriteFirstSet(page, { ...exertionOf(rir), notes: 'Belt on, felt heavy' });
      await page.reload();
      const before = await queuedMutations(page);

      await page.getByRole('button', { name: 'Edit set 1, Back squat' }).click();
      await page.getByRole('button', { name: 'Save changes' }).click();
      await expect(page.getByRole('button', { name: 'Edit set 1, Back squat' })).toBeFocused();
      expect(await queuedMutations(page)).toBe(before);
    });
  }

  test('changing the reps keeps the recorded RIR and the note', async ({ page }) => {
    await startWorkout(page, ONE_SESSION);
    await logSet(page);
    await rewriteFirstSet(page, { ...exertionOf(3.5), notes: 'Belt on, felt heavy' });
    await page.reload();

    await page.getByRole('button', { name: 'Edit set 1, Back squat' }).click();
    await page.getByRole('spinbutton', { name: 'Reps' }).fill('6');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByRole('cell', { name: '6', exact: true })).toBeVisible();

    const stored = await page.evaluate(async () => {
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('workout');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const records = await new Promise<
        { session: { sets: { measurement: unknown; deletedAt?: Date }[] } }[]
      >((resolve, reject) => {
        const request = database
          .transaction('sessions', 'readonly')
          .objectStore('sessions')
          .getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      database.close();
      return records.flatMap((record) => record.session.sets).map((set) => set.measurement);
    });
    expect(stored[0]).toMatchObject({
      repetitions: 6,
      notes: 'Belt on, felt heavy',
      exertion: { rir: { value: 3.5 } },
    });
  });

  test('a picked RIR replaces the recorded one', async ({ page }) => {
    await startWorkout(page, ONE_SESSION);
    await logSet(page);
    await rewriteFirstSet(page, exertionOf(5));
    await page.reload();
    const before = await queuedMutations(page);

    await page.getByRole('button', { name: 'Edit set 1, Back squat' }).click();
    await page.getByRole('radio', { name: '2', exact: true }).check();
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByRole('button', { name: 'Edit set 1, Back squat' })).toBeFocused();
    expect(await queuedMutations(page)).toBe(before + 1);
  });
});

test.describe('deleting a recorded set (D-24)', () => {
  test('deletes at once, closes the numbers up, and undo puts the set back where it was', async ({
    page,
  }) => {
    await startWorkout(page, ONE_SESSION);
    await logSet(page);
    await page.getByRole('spinbutton', { name: 'Reps' }).fill('7');
    await logSet(page);
    await page.getByRole('spinbutton', { name: 'Reps' }).fill('6');
    await logSet(page);

    await page.getByRole('button', { name: 'Edit set 2, Back squat' }).click();
    await page.getByRole('button', { name: 'Delete set' }).click();

    // No dialog: the delete has already happened.
    await expect(page.getByRole('dialog')).toHaveCount(0);
    const toast = page.getByRole('status').filter({ hasText: 'Set 2 deleted' });
    await expect(toast).toBeVisible();
    await expect(page.getByRole('button', { name: 'Edit set 3, Back squat' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Edit set 2, Back squat' })).toBeVisible();
    await expect(page.getByRole('cell', { name: '7', exact: true })).toHaveCount(0);

    // The toast sits above the action bar, never over it.
    const toastBox = await toast.boundingBox();
    const bar = await page.getByRole('button', { name: 'Log set' }).boundingBox();
    expect(toastBox && bar && toastBox.y + toastBox.height <= bar.y).toBe(true);

    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(page.getByRole('button', { name: 'Edit set 3, Back squat' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Edit set 2, Back squat' })).toBeFocused();
    await expect(page.getByRole('status').filter({ hasText: 'Set 2 restored' })).toBeVisible();
    await expect(page.getByRole('cell', { name: '7', exact: true })).toBeVisible();
  });

  test('logging a set keeps the toast, and a second delete replaces it', async ({ page }) => {
    await startWorkout(page, ONE_SESSION);
    await logSet(page);
    await logSet(page);
    await page.getByRole('button', { name: 'Edit set 1, Back squat' }).click();
    await page.getByRole('button', { name: 'Delete set' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Set 1 deleted' })).toBeVisible();

    await page.getByRole('button', { name: 'Log set' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Set 1 deleted' })).toBeVisible();
    await page.getByRole('button', { name: 'Next set' }).click();

    await page.getByRole('button', { name: 'Edit set 1, Back squat' }).click();
    await page.getByRole('button', { name: 'Delete set' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Set 1 deleted' })).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Undo' })).toHaveCount(1);
  });

  test('an undo tapped while a set is being logged waits its turn and still restores the set', async ({
    page,
  }) => {
    await startWorkout(page, ONE_SESSION);
    await logSet(page);
    await logSet(page);
    await page.getByRole('button', { name: 'Edit set 1, Back squat' }).click();
    await page.getByRole('button', { name: 'Delete set' }).click();
    await expect(page.getByRole('button', { name: 'Undo' })).toBeVisible();

    // Both taps land in one task, so the log is still being written when Undo is pressed.
    await page.evaluate(() => {
      const press = (label: string) =>
        [...document.querySelectorAll('button')]
          .find((button) => button.textContent?.trim().endsWith(label))
          ?.click();
      press('Log set');
      press('Undo');
    });

    await expect(page.getByRole('button', { name: 'Edit set 3, Back squat' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Undo' })).toHaveCount(0);
  });

  test('a delete is final once the toast expires', async ({ page }) => {
    await page.clock.install();
    await startWorkout(page, ONE_SESSION);
    await logSet(page);
    await page.getByRole('button', { name: 'Edit set 1, Back squat' }).click();
    await page.getByRole('button', { name: 'Delete set' }).click();
    await expect(page.getByRole('button', { name: 'Undo' })).toBeVisible();
    await page.clock.fastForward(10_500);
    await expect(page.getByRole('button', { name: 'Undo' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Edit set/ })).toHaveCount(0);
  });
});
