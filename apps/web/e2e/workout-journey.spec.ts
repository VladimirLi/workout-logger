import { readFileSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import { expect, type Locator, type Page, test } from '@playwright/test';
import { finishWorkout } from './finish';

/**
 * The plan, workout, and summary routes (workout-logging spec, tasks 5.1 and 5.2).
 *
 * The plan has to come from somewhere. No server exists (gate G-2), so these tests seed the
 * device store directly, which is the state the application would be in after a sync - not a
 * fixture rendered as if it were product data. Every assertion below is then against the real
 * routes reading the real IndexedDB store.
 */

const ADAPTER = 'packages/adapters-browser/dist/local-workout-store.js';

type SeedOptions = {
  unilateral?: boolean;
  combinedLoad?: boolean;
  multiple?: boolean;
  /** Five exercises, three of them with long names. */
  many?: boolean;
  /** The first exercise prescribes reps and no load. */
  bodyweight?: boolean;
};

/** Seeds a downloaded plan before the app boots, so the first render already has one. */
async function seedPlan(page: Page, options: SeedOptions = {}): Promise<void> {
  // `export` is illegal inside a function body, so the keyword is stripped and the classes
  // are returned explicitly. The adapter has no runtime imports, which is what makes this
  // possible; browser-store.spec.ts asserts that and would fail first if it changed.
  const adapter = readFileSync(ADAPTER, 'utf8').replaceAll(/^export /gm, '');
  await page.addInitScript(
    (input: {
      source: string;
      unilateral: boolean;
      combinedLoad: boolean;
      multiple: boolean;
      many: boolean;
      bodyweight: boolean;
    }) => {
      const { source } = input;
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

      type Exercise = { exerciseId: string; prescription: Record<string, unknown> };
      type Override = {
        revision?: number;
        loadKg?: number;
        reps?: number;
        /** The first exercise is re-profiled in the new revision. */
        profile?: 'strength' | 'unilateral_strength';
        /** The new revision no longer has the exercises the workout started with. */
        swap?: boolean;
      };
      const loadOf = (value: number) => (input.bodyweight ? {} : { load: { unit: 'kg', value } });
      const reshape = <T extends { sessions: { exercises: Exercise[] }[] }>(
        plan: T,
        override: Override | undefined,
      ): T => {
        const [session] = plan.sessions;
        const [first] = session?.exercises ?? [];
        if (!session || !first || !override) return plan;
        if (override.swap) {
          session.exercises = [
            {
              exerciseId: 'overhead-press',
              prescription: {
                schemaVersion: 1,
                profile: 'strength',
                repetitions: 5,
                load: { unit: 'kg', value: 40 },
              },
            },
          ];
        } else if (override.profile === 'unilateral_strength') {
          first.prescription = {
            ...first.prescription,
            profile: 'unilateral_strength',
            side: 'left',
            loadSemantics: 'per_side',
          };
        } else if (override.profile === 'strength') {
          const { side: _side, loadSemantics: _semantics, ...rest } = first.prescription;
          first.prescription = { ...rest, profile: 'strength' };
        }
        return plan;
      };

      const moreNames = input.many
        ? [
            'bench-press',
            'incline-dumbbell-bench-press-with-a-pause',
            'romanian-deadlift',
            'seated-cable-row-with-a-wide-neutral-grip',
          ]
        : input.multiple
          ? ['bench-press']
          : [];
      const exercisesOf = (override: Override | undefined): Exercise[] => [
        input.unilateral
          ? {
              exerciseId: 'split-squat',
              prescription: {
                schemaVersion: 1,
                profile: 'unilateral_strength',
                side: 'left',
                loadSemantics: 'per_side',
                repetitions: 10,
                load: { unit: 'kg', value: 22.5 },
              },
              ...(input.combinedLoad ? { combinedLoadPermitted: true } : {}),
            }
          : {
              exerciseId: 'back-squat',
              prescription: {
                schemaVersion: 1,
                profile: 'strength',
                repetitions: override?.reps ?? 8,
                ...loadOf(override?.loadKg ?? 80),
              },
            },
        ...moreNames.map((exerciseId) => ({
          exerciseId,
          prescription: {
            schemaVersion: 1,
            profile: 'strength',
            repetitions: 6,
            load: { unit: 'kg', value: 60 },
          },
        })),
      ];

      // The override is how a test moves the downloaded plan on to a later revision, which is
      // what the device would hold after a sync. Saving the same plan id overwrites the
      // record, exactly as the adapter does for a real download.
      (
        window as unknown as {
          __seedPlan: (override?: Override) => Promise<void>;
        }
      ).__seedPlan = async (override) => {
        const userId = await identity();
        await new IndexedDbPlanStore().save(
          userId,
          reshape(
            {
              status: 'active',
              id: 'plan-1',
              revision: override?.revision ?? 1,
              activatedAt: new Date('2026-09-18T08:00:00Z'),
              sessions: [
                {
                  id: 'session-mon',
                  scheduledFor: '2026-09-18',
                  exercises: exercisesOf(override),
                },
              ],
            },
            override,
          ),
        );
      };
    },
    {
      source: adapter,
      unilateral: options.unilateral === true,
      combinedLoad: options.combinedLoad === true,
      multiple: options.multiple === true,
      many: options.many === true,
      bodyweight: options.bodyweight === true,
    },
  );
}

/** Opens today, makes sure the device identity exists, then seeds and reloads. */
async function openTodayWithPlan(page: Page, options: SeedOptions = {}): Promise<void> {
  await seedPlan(page, options);
  await page.goto('/today');
  await expect(page.getByRole('heading', { name: 'No plan on this device yet' })).toBeVisible();
  await page.evaluate(() => (window as unknown as { __seedPlan(): Promise<void> }).__seedPlan());
  await page.reload();
  await expect(page.getByRole('button', { name: 'Start workout' })).toBeVisible();
}

test.describe('the workout journey', () => {
  test('opens on today rather than the old foundation page', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/today$/);
  });

  test('revisits a finished session from history', async ({ page }) => {
    await openTodayWithPlan(page);
    await page.getByRole('button', { name: 'Start workout' }).click();
    await page.waitForURL('**/workout');
    await page.getByRole('button', { name: 'Log set' }).click();
    await expect(page.getByRole('cell', { name: '80 kilograms' })).toBeVisible();
    await finishWorkout(page);
    await page.waitForURL('**/summary?session=**');
    await page.getByRole('link', { name: 'Workout history' }).click();
    await expect(page.getByRole('link', { name: /session mon/i })).toBeVisible();
    await page.getByRole('link', { name: /session mon/i }).click();
    await expect(page.getByRole('heading', { name: 'Finished' })).toBeVisible();
    await expect(page.getByRole('cell', { name: '80 kilograms' })).toBeVisible();
  });

  test('logs sets for both exercises in the scheduled session', async ({ page }) => {
    await openTodayWithPlan(page, { multiple: true });
    await page.getByRole('button', { name: 'Start workout' }).click();
    await page.waitForURL('**/workout');
    await page.getByRole('button', { name: 'Log set' }).click();
    await expect(page.getByRole('cell', { name: '80 kilograms' })).toBeVisible();
    // Which exercise is current must reach assistive tech, not only the button's colour.
    await expect(page.getByRole('button', { name: 'Back squat', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(page.getByRole('button', { name: 'Bench press', exact: true })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    await page.getByRole('button', { name: 'Bench press' }).click();
    await expect(page.getByRole('button', { name: 'Bench press', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(page.getByText('60 kg × 6')).toBeVisible();
    await page.getByRole('button', { name: 'Log set' }).click();
    await expect(page.getByRole('cell', { name: '60 kilograms' })).toBeVisible();
    await finishWorkout(page);
    await page.waitForURL('**/summary?session=**');
    await expect(page.getByRole('cell', { name: '80 kilograms' })).toBeVisible();
    await expect(page.getByRole('cell', { name: '60 kilograms' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Back squat' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Bench press' })).toBeVisible();
  });

  test('never retargets a workout already in progress when the plan revision moves on', async ({
    page,
  }) => {
    // A started workout is a snapshot of one plan revision (session.ts). If a sync downloads a
    // later revision mid-workout the screen must not quietly show the new numbers as this
    // workout's targets, because the device keeps only the newest revision of a plan.
    await openTodayWithPlan(page);
    await page.getByRole('button', { name: 'Start workout' }).click();
    await page.waitForURL('**/workout');
    await expect(page.getByText('80 kg × 8')).toBeVisible();
    await page.getByRole('button', { name: 'Log set' }).click();
    await expect(page.getByRole('cell', { name: '80 kilograms' })).toBeVisible();

    await page.evaluate(() =>
      (
        window as unknown as {
          __seedPlan(override: { revision: number; loadKg: number; reps: number }): Promise<void>;
        }
      ).__seedPlan({ revision: 2, loadKg: 100, reps: 3 }),
    );
    await page.reload();

    await expect(page.getByRole('heading', { name: 'In progress' })).toBeVisible();
    await expect(page.getByText('100 kg × 3')).toHaveCount(0);
    await expect(page.getByText('The plan changed after this workout started')).toBeVisible();
    // Recorded facts and the way out of the workout both survive.
    await expect(page.getByRole('cell', { name: '80 kilograms' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Finish workout' })).toBeVisible();
  });

  test('keeps each recorded set under its own exercise when the plan revision moves on', async ({
    page,
  }) => {
    await openTodayWithPlan(page, { multiple: true });
    await page.getByRole('button', { name: 'Start workout' }).click();
    await page.waitForURL('**/workout');
    await page.getByRole('button', { name: 'Log set' }).click();
    await expect(page.getByRole('cell', { name: '80 kilograms' })).toBeVisible();
    await page.getByRole('button', { name: 'Bench press' }).click();
    await page.getByRole('button', { name: 'Log set' }).click();
    await expect(page.getByRole('cell', { name: '60 kilograms' })).toBeVisible();

    await page.evaluate(() =>
      (
        window as unknown as {
          __seedPlan(override: { revision: number; loadKg: number; reps: number }): Promise<void>;
        }
      ).__seedPlan({ revision: 2, loadKg: 100, reps: 3 }),
    );
    await page.reload();

    await expect(page.getByText('The plan changed after this workout started')).toBeVisible();
    // The chips still filter the table; each exercise keeps only its own sets.
    const table = page.getByRole('table', { name: 'Sets recorded' });
    await expect(table.getByRole('cell', { name: '80 kilograms' })).toBeVisible();
    await expect(table.getByRole('cell', { name: '60 kilograms' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Bench press' }).click();
    await expect(table.getByRole('cell', { name: '60 kilograms' })).toBeVisible();
    await expect(table.getByRole('cell', { name: '80 kilograms' })).toHaveCount(0);
    await expect(page.getByRole('cell', { name: '100 kilograms' })).toHaveCount(0);

    await finishWorkout(page);
    await page.waitForURL('**/summary?session=**');
    await expect(page.getByRole('heading', { name: 'Back squat' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Bench press' })).toBeVisible();
  });

  test('ignores Finish workout while a set is still being saved', async ({ page }) => {
    await openTodayWithPlan(page);
    await page.getByRole('button', { name: 'Start workout' }).click();
    await page.waitForURL('**/workout');
    await expect(page.getByRole('button', { name: 'Log set' })).toBeVisible();
    // Finish is confirmed one task after Log set, while the set's write is still in flight. The
    // write and the completion each put a whole session snapshot, so an overlap would lose one.
    await page.evaluate(async () => {
      const press = (label: string, within = 'body') =>
        [...document.querySelectorAll(`${within} button`)]
          .find((b) => b.textContent?.trim() === label)
          ?.click();
      press('Log set');
      await new Promise((resolve) => setTimeout(resolve, 0));
      press('Finish workout');
      press('Finish workout', 'dialog');
    });
    await expect(
      page
        .getByRole('button', { name: 'Next set' })
        .or(page.getByRole('cell', { name: '80 kilograms' })),
    ).toBeVisible();
    if (!page.url().includes('/summary')) await finishWorkout(page);
    await page.waitForURL('**/summary?session=**');
    await expect(page.getByRole('cell', { name: '80 kilograms' })).toBeVisible();
  });

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
    await finishWorkout(page);

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

type Box = { x: number; y: number; width: number; height: number };

const boxOf = async (locator: Locator): Promise<Box> => {
  const box = await locator.boundingBox();
  if (!box) throw new Error('an element has no box');
  return box;
};

const overlaps = (a: Box, b: Box): boolean =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/** True when the element at the control's centre is the control itself, not something over it. */
const isPainted = (control: Locator): Promise<boolean> =>
  control.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
    return hit !== null && (hit === element || element.contains(hit) || hit.contains(element));
  });

/** Focuses a control the way a keyboard does, so the browser shows its focus ring. */
const focusByKeyboard = async (page: Page, control: Locator) => {
  await control.focus();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Shift+Tab');
  await expect(control).toBeFocused();
};

type LandscapePlan = {
  unilateral?: boolean;
  combinedLoad?: boolean;
  multiple?: boolean;
  many?: boolean;
};

test.describe('a phone held sideways (layout.landscape.two-pane)', () => {
  const PROFILES: readonly { name: string; plan: LandscapePlan; scrolls: boolean }[] = [
    { name: 'one exercise', plan: {}, scrolls: false },
    { name: 'two exercises', plan: { multiple: true }, scrolls: false },
    { name: 'five exercises with long names', plan: { many: true }, scrolls: false },
    {
      name: 'two exercises, one of them one-sided',
      plan: { multiple: true, unilateral: true },
      scrolls: true,
    },
    { name: 'a unilateral exercise', plan: { unilateral: true }, scrolls: true },
    {
      name: 'a unilateral exercise with combined load',
      plan: { unilateral: true, combinedLoad: true },
      scrolls: true,
    },
  ];

  const openSetView = async (page: Page, plan: LandscapePlan) => {
    await page.setViewportSize({ width: 667, height: 375 });
    await openTodayWithPlan(page, plan);
    await page.getByRole('button', { name: 'Start workout' }).click();
    await page.waitForURL('**/workout');
    await expect(page.getByRole('button', { name: 'Log set' })).toBeVisible();
  };

  /** The row blocks in reading order: a stepper stands for its row, a group for itself. */
  const rowsOf = (page: Page, plan: LandscapePlan): Locator[] => [
    ...(plan.unilateral ? [page.getByRole('group', { name: 'Side' })] : []),
    page.getByRole('button', { name: 'Decrease load' }),
    page.getByRole('button', { name: 'Decrease reps' }),
    ...(plan.combinedLoad ? [page.getByRole('group', { name: 'Load counts' })] : []),
    page.getByRole('group', { name: 'RIR' }),
  ];

  const controlsOf = (page: Page, plan: LandscapePlan): Locator[] => [
    ...rowsOf(page, plan).slice(0, plan.unilateral ? 1 : 0),
    page.getByRole('button', { name: 'Decrease load' }),
    page.getByRole('spinbutton', { name: 'Load' }),
    page.getByRole('button', { name: 'Increase load' }),
    page.getByRole('button', { name: 'Decrease reps' }),
    page.getByRole('spinbutton', { name: 'Reps' }),
    page.getByRole('button', { name: 'Increase reps' }),
    ...(plan.combinedLoad ? [page.getByRole('group', { name: 'Load counts' })] : []),
    page.getByRole('group', { name: 'RIR' }),
    page.getByRole('button', { name: 'What is RIR?' }),
  ];

  /** Scrolls only the controls pane, never the page. */
  const scrollWithinPane = (control: Locator) =>
    control.evaluate((element) => element.scrollIntoView({ block: 'nearest' }));

  for (const profile of PROFILES) {
    test.describe(profile.name, () => {
      test('shows the bar, the set, the target and Log set without scrolling', async ({ page }) => {
        await openSetView(page, profile.plan);
        const viewport = page.viewportSize();
        if (!viewport) throw new Error('no viewport');

        const fixed = [
          page.getByRole('banner'),
          page.getByRole('heading', { level: 1 }),
          page.getByText(/^Set 1$/),
          page.getByLabel('Target', { exact: true }),
          page.getByRole('button', { name: 'Log set' }),
          page.getByText('On device'),
        ];
        for (const locator of fixed) {
          await expect(locator).toBeVisible();
          const box = await boxOf(locator);
          expect(box.y).toBeGreaterThanOrEqual(0);
          expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
          expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
        }
        // One indicator, in the bar; the session card no longer repeats it.
        await expect(page.getByText('On device')).toHaveCount(1);
        expect(await page.evaluate(() => window.scrollY)).toBe(0);
      });

      test('fits an ordinary set outright and scrolls a taller one inside the pane', async ({
        page,
      }) => {
        await openSetView(page, profile.plan);
        const region = page.getByRole('region', { name: 'Set controls' });
        const measure = await region.evaluate((element) => ({
          overflow: element.scrollHeight - element.clientHeight,
          overflowX: element.scrollWidth - element.clientWidth,
        }));
        expect(measure.overflowX).toBeLessThanOrEqual(0);
        if (profile.scrolls) expect(measure.overflow).toBeGreaterThan(0);
        else expect(measure.overflow).toBeLessThanOrEqual(0);

        // The pane ends above the action row, so nothing can scroll under it.
        const pane = await boxOf(region);
        const logSet = await boxOf(page.getByRole('button', { name: 'Log set' }));
        expect(pane.y + pane.height).toBeLessThanOrEqual(logSet.y);
      });

      test('never covers a control with Log set at any scroll position of the pane', async ({
        page,
      }) => {
        await openSetView(page, profile.plan);
        const region = page.getByRole('region', { name: 'Set controls' });
        const logSet = page.getByRole('button', { name: 'Log set' });
        const logSetAtRest = await boxOf(logSet);

        for (const control of controlsOf(page, profile.plan)) {
          await scrollWithinPane(control);
          const box = await boxOf(control);
          const pane = await boxOf(region);
          expect(box.y, 'above the pane').toBeGreaterThanOrEqual(pane.y);
          expect(box.y + box.height, 'below the pane').toBeLessThanOrEqual(pane.y + pane.height);
          expect(overlaps(box, await boxOf(logSet))).toBe(false);
          expect(await isPainted(control), 'covered by something else').toBe(true);
        }

        // Log set stays put and the page never had to move.
        expect(await boxOf(logSet)).toEqual(logSetAtRest);
        expect(await page.evaluate(() => window.scrollY)).toBe(0);
      });

      test('keeps 48 px targets and 8 px gaps', async ({ page }) => {
        await openSetView(page, profile.plan);
        for (const name of ['Decrease load', 'Increase load', 'Decrease reps', 'Increase reps']) {
          const box = await boxOf(page.getByRole('button', { name }));
          expect(box.width, name).toBeGreaterThanOrEqual(48);
          expect(box.height, name).toBeGreaterThanOrEqual(48);
        }
        expect(
          (await boxOf(page.getByRole('button', { name: 'Log set' }))).height,
        ).toBeGreaterThanOrEqual(48);

        for (const [field, quantity] of [
          ['Load', 'load'],
          ['Reps', 'reps'],
        ] as const) {
          const cell = await boxOf(page.getByRole('spinbutton', { name: field }).locator('..'));
          const decrease = await boxOf(page.getByRole('button', { name: `Decrease ${quantity}` }));
          const increase = await boxOf(page.getByRole('button', { name: `Increase ${quantity}` }));
          expect(cell.x - (decrease.x + decrease.width), `${field} gap`).toBeGreaterThanOrEqual(
            7.5,
          );
          expect(increase.x - (cell.x + cell.width), `${field} gap`).toBeGreaterThanOrEqual(7.5);
        }

        const rows = rowsOf(page, profile.plan);
        for (let index = 1; index < rows.length; index += 1) {
          const above = await boxOf(rows[index - 1] as Locator);
          const below = await boxOf(rows[index] as Locator);
          expect(
            below.y - (above.y + above.height),
            `gap before row ${index}`,
          ).toBeGreaterThanOrEqual(7.5);
        }
      });

      test('has no sideways scrolling', async ({ page }) => {
        await openSetView(page, profile.plan);
        const overflow = await page.evaluate(() => ({
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth,
        }));
        expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);
      });

      test('brings a focused control fully into view, clear of the action row', async ({
        page,
      }) => {
        await openSetView(page, profile.plan);
        const region = page.getByRole('region', { name: 'Set controls' });
        await (profile.plan.unilateral
          ? page.getByRole('radio', { name: 'Left' })
          : page.getByRole('button', { name: 'Decrease load' })
        ).focus();

        // Tab until Log set takes focus; every stop on the way is visible and not covered.
        for (let stop = 0; stop < 20; stop += 1) {
          const active = page.locator(':focus');
          if (
            (await active.getAttribute('aria-label')) === null &&
            (await active.innerText()) === 'Log set'
          )
            break;
          const pane = await boxOf(region);
          const box = await boxOf(active);
          expect(await isPainted(active), `stop ${stop} is covered`).toBe(true);
          expect(box.y, `stop ${stop} clear of the top`).toBeGreaterThanOrEqual(pane.y);
          expect(box.y + box.height, `stop ${stop} clear of the action row`).toBeLessThanOrEqual(
            pane.y + pane.height,
          );
          await page.keyboard.press('Tab');
        }
        await expect(page.getByRole('button', { name: 'Log set' })).toBeFocused();
      });
    });
  }

  test.describe('the exercise strip (VLA-199)', () => {
    const LONG = 'Seated cable row with a wide neutral grip';
    /** The strip is the scroller around the Exercises section. */
    const stripOf = (page: Page): Locator =>
      page
        .getByRole('region', { name: 'Exercises' })
        .locator('xpath=ancestor::div[contains(@class, "lead")]');

    for (const [count, plan] of [
      [2, { multiple: true }],
      [5, { many: true }],
      [2, { multiple: true, unilateral: true }],
    ] as const) {
      test(`is one 54 px row in the left pane for ${count} exercises${plan.unilateral ? ' (one-sided)' : ''}`, async ({
        page,
      }) => {
        await openSetView(page, plan);
        const strip = await boxOf(stripOf(page));
        const name = await boxOf(page.getByRole('heading', { level: 1 }));
        const controls = await boxOf(page.getByRole('region', { name: 'Set controls' }));

        expect(strip.height).toBeCloseTo(54, 0);
        expect(strip.x + strip.width).toBeLessThanOrEqual(controls.x);
        expect(name.y).toBeCloseTo(strip.y + strip.height + 8, 0);
        expect(name.y + name.height).toBeLessThanOrEqual(375);

        // The section keeps its accessible name; only the visible heading is gone.
        const heading = await boxOf(page.getByRole('heading', { name: 'Exercises' }));
        expect(heading.width).toBeLessThanOrEqual(1);

        // Log set is where it is with one exercise: 315 to 371 in a 375 px viewport.
        const logSet = await boxOf(page.getByRole('button', { name: 'Log set' }));
        expect(logSet.y + logSet.height).toBeLessThanOrEqual(375);
        expect(await page.evaluate(() => window.scrollY)).toBe(0);
      });
    }

    test('scrolls sideways only, with chips of at least 44 px and 8 px between them', async ({
      page,
    }) => {
      await openSetView(page, { many: true });
      const strip = stripOf(page);
      const measure = await strip.evaluate((element) => ({
        overflowY: element.scrollHeight - element.clientHeight,
        overflowX: element.scrollWidth - element.clientWidth,
      }));
      expect(measure.overflowY).toBeLessThanOrEqual(0);
      expect(measure.overflowX).toBeGreaterThan(0);
      const page$ = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      expect(page$.scrollWidth).toBeLessThanOrEqual(page$.clientWidth);

      const chips = page.getByRole('region', { name: 'Exercises' }).getByRole('button');
      const first = await boxOf(chips.nth(0));
      const second = await boxOf(chips.nth(1));
      expect(first.height).toBeGreaterThanOrEqual(44);
      expect(second.height).toBeGreaterThanOrEqual(44);
      expect(second.x - (first.x + first.width)).toBeCloseTo(8, 0);
    });

    test('cuts a long name short on screen and keeps it whole for assistive technology', async ({
      page,
    }) => {
      await openSetView(page, { many: true });
      const strip = await boxOf(stripOf(page));
      const chip = page.getByRole('button', { name: LONG });
      const box = await boxOf(chip);
      expect(box.width).toBeLessThanOrEqual(strip.width * 0.8 + 1);
      expect(await chip.locator('span').evaluate((s) => s.scrollWidth > s.clientWidth)).toBe(true);
    });

    test('brings the chosen chip into view without moving the page or Log set', async ({
      page,
    }) => {
      await openSetView(page, { many: true });
      const before = await boxOf(page.getByRole('button', { name: 'Log set' }));
      const strip = stripOf(page);

      // Tab to the last chip: the strip must follow focus, not the page.
      await page.getByRole('button', { name: LONG }).focus();
      await page.keyboard.press('Enter');
      await expect(page.getByRole('heading', { level: 1, name: LONG })).toBeVisible();

      const stripBox = await boxOf(strip);
      const chipBox = await boxOf(page.getByRole('button', { name: LONG }));
      expect(chipBox.x).toBeGreaterThanOrEqual(stripBox.x - 0.5);
      expect(chipBox.x + chipBox.width).toBeLessThanOrEqual(stripBox.x + stripBox.width + 0.5);
      await expect(page.getByRole('button', { name: LONG })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      await expect(page.getByRole('button', { name: LONG })).toBeFocused();
      expect(await boxOf(page.getByRole('button', { name: 'Log set' }))).toEqual(before);
      expect(await page.evaluate(() => window.scrollY)).toBe(0);
    });

    /** The room a focus ring needs outside its chip, read from the ring itself. */
    const ringRoom = (chip: Locator) =>
      chip.evaluate((element) => {
        const style = getComputedStyle(element);
        return Number.parseFloat(style.outlineWidth) + Number.parseFloat(style.outlineOffset);
      });

    /** True when focusing the chip paints something in the band just outside `side` of it. */
    const ringShowsOn = async (page: Page, chip: Locator, side: 'left' | 'right' | 'top') => {
      const room = await ringRoom(chip);
      expect(await chip.evaluate((element) => element.matches(':focus-visible'))).toBe(true);
      const box = await boxOf(chip);
      const clip =
        side === 'left'
          ? { x: box.x - room, y: box.y, width: room, height: box.height }
          : side === 'right'
            ? { x: box.x + box.width, y: box.y, width: room, height: box.height }
            : { x: box.x, y: box.y - room, width: box.width, height: room };
      const focused = await page.screenshot({ clip });
      await chip.blur();
      const blurred = await page.screenshot({ clip });
      await focusByKeyboard(page, chip);
      return !focused.equals(blurred);
    };

    test('shows the whole focus ring on the first and the last chip', async ({ page }) => {
      await openSetView(page, { many: true });
      const chips = page.getByRole('region', { name: 'Exercises' }).getByRole('button');
      const first = chips.first();
      const last = chips.last();

      await focusByKeyboard(page, first);
      expect(await ringShowsOn(page, first, 'left'), 'left of the first chip is clipped').toBe(
        true,
      );
      expect(await ringShowsOn(page, first, 'top'), 'top of the first chip is clipped').toBe(true);

      await focusByKeyboard(page, last);
      expect(await ringShowsOn(page, last, 'right'), 'right of the last chip is clipped').toBe(
        true,
      );
      expect(await ringShowsOn(page, last, 'top'), 'top of the last chip is clipped').toBe(true);
    });

    test('stays where it was while resting, and is offered again while editing a set', async ({
      page,
    }) => {
      await openSetView(page, { multiple: true });
      const strip = stripOf(page);
      // Rest moves focus to its heading, which may scroll the page; compare on the page, not the screen.
      const onPage = async () => {
        const box = await boxOf(strip);
        return { ...box, y: box.y + (await page.evaluate(() => window.scrollY)) };
      };
      const at = await onPage();

      await page.getByRole('button', { name: 'Log set' }).click();
      await expect(page.getByRole('heading', { name: 'Rest' })).toBeVisible();
      await expect(page.getByRole('region', { name: 'Exercises' })).toHaveCount(1);
      expect(await onPage()).toEqual(at);

      await page.getByRole('button', { name: 'Next set' }).click();
      await page.getByRole('button', { name: /^Edit set 1/ }).click();
      await expect(page.getByRole('button', { name: 'Save changes' })).toBeVisible();
      await expect(page.getByRole('region', { name: 'Exercises' })).toHaveCount(1);
    });
  });

  for (const plan of [{ multiple: true }, { many: true }] satisfies LandscapePlan[]) {
    test(`keeps the page still through log, rest and next set with ${plan.many ? 'five' : 'two'} exercises`, async ({
      page,
    }) => {
      await openSetView(page, plan);
      const scrollY = () => page.evaluate(() => window.scrollY);

      await page.getByRole('button', { name: 'Log set' }).click();
      await expect(page.getByRole('heading', { name: 'Rest' })).toBeVisible();
      expect(await scrollY(), 'rest view scrolled the page').toBe(0);

      await page.getByRole('button', { name: 'Next set' }).click();
      await expect(page.getByRole('button', { name: 'Log set' })).toBeVisible();
      expect(await scrollY(), 'Next set scrolled the page').toBe(0);
      const logSet = await boxOf(page.getByRole('button', { name: 'Log set' }));
      expect(logSet.y).toBeGreaterThanOrEqual(0);
      expect(logSet.y + logSet.height).toBeLessThanOrEqual(375);
    });

    test(`keeps Save changes in view when editing a set with ${plan.many ? 'five' : 'two'} exercises`, async ({
      page,
    }) => {
      await openSetView(page, plan);
      await page.getByRole('button', { name: 'Log set' }).click();
      await page.getByRole('button', { name: 'Next set' }).click();
      await page.getByRole('button', { name: /^Edit set 1/ }).click();
      const save = page.getByRole('button', { name: 'Save changes' });
      await expect(save).toBeVisible();
      await expect(save).toBeInViewport({ ratio: 1 });
    });
  }

  test('reserves room for the tabs only where tabs are shown', async ({ page }) => {
    const reserved = () =>
      page.evaluate(() => getComputedStyle(document.documentElement).scrollPaddingBottom);
    await openSetView(page, {});
    expect(await reserved(), 'the workout has no tabs').toBe('0px');
    await page.goto('/today');
    await expect(page.getByRole('navigation')).toBeVisible();
    expect(await reserved(), 'the tabs can cover focus').not.toBe('0px');
  });

  for (const size of [
    { name: 'landscape', width: 667, height: 375 },
    { name: 'portrait', width: 375, height: 667 },
  ]) {
    test.describe(`choosing an exercise from the keyboard in ${size.name}`, () => {
      const open = async (page: Page) => {
        await page.setViewportSize({ width: size.width, height: size.height });
        await openTodayWithPlan(page, { multiple: true });
        await page.getByRole('button', { name: 'Start workout' }).click();
        await page.waitForURL('**/workout');
        await expect(page.getByRole('button', { name: 'Log set' })).toBeVisible();
      };
      const chips = (page: Page) =>
        page.getByRole('region', { name: 'Exercises' }).getByRole('button');

      /** Chooses the other exercise by keyboard, then expects its chip to hold focus. */
      const chooseOther = async (page: Page) => {
        const other = chips(page).and(page.locator('[aria-pressed="false"]'));
        const name = (await other.innerText()).trim();
        await other.focus();
        await page.keyboard.press('Enter');
        const chosen = page.getByRole('button', { name, exact: true });
        await expect(chosen).toHaveAttribute('aria-pressed', 'true');
        await expect(chosen, 'focus is lost when the view changes').toBeFocused();
        expect(await page.evaluate(() => document.activeElement?.tagName)).toBe('BUTTON');
      };

      test('keeps focus on the chosen chip from the set view', async ({ page }) => {
        await open(page);
        await chooseOther(page);
        await expect(page.getByRole('button', { name: 'Log set' })).toBeVisible();
      });

      test('keeps focus on the chosen chip from the rest view', async ({ page }) => {
        await open(page);
        await page.getByRole('button', { name: 'Log set' }).click();
        await expect(page.getByRole('heading', { name: 'Rest' })).toBeVisible();
        await chooseOther(page);
        await expect(page.getByRole('button', { name: 'Log set' })).toBeVisible();
      });

      test('keeps focus on the chosen chip from the edit view', async ({ page }) => {
        await open(page);
        await page.getByRole('button', { name: 'Log set' }).click();
        await page.getByRole('button', { name: 'Next set' }).click();
        await page.getByRole('button', { name: /^Edit set 1/ }).click();
        await expect(page.getByRole('button', { name: 'Save changes' })).toBeVisible();
        await chooseOther(page);
        await expect(page.getByRole('button', { name: 'Save changes' })).toBeHidden();
      });
    });
  }

  test('lays the chips out as a wrapping row, not a strip, in portrait', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await openTodayWithPlan(page, { many: true });
    await page.getByRole('button', { name: 'Start workout' }).click();
    await page.waitForURL('**/workout');
    const region = page.getByRole('region', { name: 'Exercises' });
    const chips = region.getByRole('button');
    await expect(chips).toHaveCount(5);

    const boxes = await Promise.all([0, 1, 2, 3, 4].map((n) => boxOf(chips.nth(n))));
    for (const box of boxes) {
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(375);
      expect(box.height).toBeGreaterThanOrEqual(44);
    }
    expect(
      new Set(boxes.map((box) => Math.round(box.y))).size,
      'chips wrap onto rows',
    ).toBeGreaterThan(1);
    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);
    await expect(page.getByRole('button', { name: 'Log set' })).toBeVisible();

    await focusByKeyboard(page, chips.first());
    expect(await chips.first().evaluate((element) => element.matches(':focus-visible'))).toBe(true);
    const first = await boxOf(chips.first());
    expect(first.x).toBeGreaterThanOrEqual(5);
  });

  test('shows every Load value whole', async ({ page }) => {
    await openSetView(page, {});
    const load = page.getByRole('spinbutton', { name: 'Load' });
    for (const value of ['22.5', '102.5', '142.5', '497.5']) {
      await load.fill(value);
      const clipped = await load.evaluate((input) => input.scrollWidth - input.clientWidth);
      expect(clipped, `${value} is clipped`).toBeLessThanOrEqual(0);
    }
  });

  for (const size of [
    { width: 568, height: 320 },
    { width: 667, height: 375 },
    { width: 812, height: 375 },
  ]) {
    test(`keeps the Load and Reps labels readable beside their controls at ${size.width}x${size.height}`, async ({
      page,
    }) => {
      await page.setViewportSize(size);
      await openTodayWithPlan(page);
      await page.getByRole('button', { name: 'Start workout' }).click();
      await page.waitForURL('**/workout');
      await expect(page.getByRole('button', { name: 'Log set' })).toBeVisible();

      for (const name of ['Load', 'Reps']) {
        const label = page.locator('label').filter({ hasText: new RegExp(`^${name}$`) });
        await scrollWithinPane(label);
        const text = await label.evaluate((element) => {
          const range = document.createRange();
          range.selectNodeContents(element);
          const rect = range.getBoundingClientRect();
          return { width: rect.width, x: rect.x, y: rect.y, height: rect.height };
        });
        // The words themselves, not the label box, must be whole and clear of every button.
        expect(text.width, `${name} label is squeezed`).toBeGreaterThan(20);
        for (const action of ['Decrease', 'Increase']) {
          const button = await boxOf(
            page.getByRole('button', { name: `${action} ${name.toLowerCase()}` }),
          );
          expect(overlaps(text, button), `${name} label sits under ${action}`).toBe(false);
        }
        expect(await isPainted(label), `${name} label is covered`).toBe(true);
      }
    });
  }

  test('still shows rest after logging', async ({ page }) => {
    await openSetView(page, {});
    await page.getByRole('button', { name: 'Log set' }).click();
    await expect(page.getByRole('heading', { name: 'Rest' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Next set' })).toBeVisible();
  });
});

test.describe('the workout bar', () => {
  test('makes no persistence claim and keeps a heading when the device store cannot be read', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      Object.defineProperty(window, 'indexedDB', { value: undefined, configurable: true });
    });
    await page.goto('/workout');
    await expect(page.getByRole('status').or(page.getByRole('alert')).first()).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
    await expect(page.getByText('On device')).toHaveCount(0);
  });

  test('makes no persistence claim when there is no workout to be on the device', async ({
    page,
  }) => {
    await page.goto('/workout');
    await expect(
      page.getByRole('heading', { level: 1, name: 'No workout in progress' }),
    ).toBeVisible();
    await expect(page.getByText('On device')).toHaveCount(0);
  });

  test('carries sync in a portrait phone and closes to today', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await openTodayWithPlan(page);
    await page.getByRole('button', { name: 'Start workout' }).click();
    await page.waitForURL('**/workout');

    const sync = page.getByText('On device');
    await expect(sync).toHaveCount(1);
    const box = await boxOf(sync);
    expect(box.y + box.height).toBeLessThanOrEqual(667);
    expect(box.x + box.width).toBeLessThanOrEqual(375);

    await page.getByRole('button', { name: 'Close' }).click();
    await page.waitForURL('**/today');
  });
});

test.describe('logging a set', () => {
  /** Starts a workout from a seeded plan and lands on the set view. */
  async function atTheSetView(page: Page): Promise<void> {
    await openTodayWithPlan(page);
    await page.getByRole('button', { name: 'Start workout' }).click();
    await page.waitForURL('**/workout');
    await expect(page.getByRole('heading', { name: 'Back squat' })).toBeVisible();
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
  await expect(page.getByRole('heading', { name: 'Back squat' })).toBeVisible();

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
    await page.goto('/history');
    await expect(page.getByRole('heading', { name: 'No finished workouts yet' })).toBeVisible();
    await page.goto('/today');
    await expect(page.getByRole('button', { name: 'Start workout' })).toBeVisible();

    await context.setOffline(true);

    await page.getByRole('button', { name: 'Start workout' }).click();
    await page.waitForURL('**/workout');
    await expect(page.getByRole('heading', { name: 'Back squat' })).toBeVisible();

    await page.getByRole('button', { name: 'Log set' }).click();
    await expect(page.getByRole('cell', { name: '80 kilograms' })).toBeVisible();

    // A reload with the network still off: served by the service worker, read from IndexedDB.
    await page.reload();
    await expect(page.getByRole('cell', { name: '80 kilograms' })).toBeVisible();

    await page.getByRole('button', { name: 'Increase load' }).click();
    await page.getByRole('button', { name: 'Log set' }).click();
    await expect(page.getByRole('cell', { name: '82.5 kilograms' })).toBeVisible();

    await finishWorkout(page);
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

    // History is a primary tab, so it has to survive the network being off like the rest of the
    // journey: the shell comes from the service worker and the finished session from IndexedDB.
    // Without /history in the precache list this lands on /offline instead.
    await page.goto('/history');
    await expect(page.getByRole('list', { name: 'Workouts' })).toBeVisible();

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
    let armed: string | undefined;
    (window as unknown as { __failNextWrite(name?: string): void }).__failNextWrite = (
      name = 'QuotaExceededError',
    ) => {
      armed = name;
    };

    const wrapStore = (store: IDBObjectStore) =>
      new Proxy(store, {
        set: setOnTarget,
        get(target, prop) {
          if (prop === 'put' && armed) {
            const name = armed;
            armed = undefined;
            return () => {
              throw new DOMException('the write failed', name);
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

test.describe('a full device (task 4.8)', () => {
  test('refuses the set, says the device is full, and offers the export', async ({ page }) => {
    await failTheNextWrite(page);
    await openTodayWithPlan(page);
    await page.getByRole('button', { name: 'Start workout' }).click();
    await page.waitForURL('**/workout');
    await expect(page.getByRole('heading', { name: 'Back squat' })).toBeVisible();

    await page.evaluate(() => (window as unknown as { __failNextWrite(): void }).__failNextWrite());
    await page.getByRole('button', { name: 'Log set' }).click();

    // The write stopped, and the screen says so rather than looking as though it saved.
    await expect(page.getByText('There is no room left on this device')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Export everything' })).toBeVisible();
    // Nothing was recorded, and what was already queued is untouched.
    await expect(page.getByRole('cell', { name: '80 kilograms' })).toHaveCount(0);
  });

  test('a failed finish says so, offers the export, and the next finish completes', async ({
    page,
  }) => {
    await failTheNextWrite(page);
    await openTodayWithPlan(page);
    await page.getByRole('button', { name: 'Start workout' }).click();
    await page.waitForURL('**/workout');
    await expect(page.getByRole('heading', { name: 'Back squat' })).toBeVisible();

    await page.evaluate(() => (window as unknown as { __failNextWrite(): void }).__failNextWrite());
    await finishWorkout(page);

    await expect(page.getByText('the workout was not finished')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Export everything' })).toBeVisible();
    expect(page.url()).toContain('/workout');

    await finishWorkout(page);
    await page.waitForURL('**/summary?session=**');
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

test.describe('unilateral entry (tasks 5.9 and 5.9a)', () => {
  test('logs each side as its own result, per side by default', async ({ page }) => {
    await openTodayWithPlan(page, { unilateral: true });
    await page.getByRole('button', { name: 'Start workout' }).click();
    await page.waitForURL('**/workout');
    await expect(page.getByRole('heading', { name: 'Split squat' })).toBeVisible();

    // The side is asked for, and left is where it starts.
    const side = page.getByRole('group', { name: 'Side' });
    await expect(side).toBeVisible();
    await expect(side.getByRole('radio', { name: 'Left' })).toBeChecked();
    // Combined load is not offered: this exercise is not configured for it.
    await expect(page.getByRole('group', { name: 'Load counts' })).toHaveCount(0);

    await page.getByRole('button', { name: 'Log set' }).click();
    await expect(page.getByRole('cell', { name: '22.5 kilograms' })).toBeVisible();

    // The right side is a separate result, recorded after the rest.
    await page.getByRole('button', { name: 'Next set' }).click();
    await page.getByRole('radio', { name: 'Right' }).check();
    await page.getByRole('button', { name: 'Log set' }).click();
    // Both rows are in the table before the device is read, so the read cannot race the write.
    await expect(page.getByRole('row', { name: /22.5 kilograms/ })).toHaveCount(2);

    const stored = await page.evaluate(
      () =>
        new Promise<{ side: string; loadSemantics: string }[]>((resolve, reject) => {
          const request = indexedDB.open('workout', 1);
          request.onsuccess = () => {
            const all = request.result
              .transaction('sessions', 'readonly')
              .objectStore('sessions')
              .getAll();
            all.onsuccess = () =>
              resolve(
                (all.result as { session: { sets: { measurement: Record<string, string> }[] } }[])
                  .flatMap((record) => record.session.sets)
                  .map((set) => ({
                    side: set.measurement.side ?? '',
                    loadSemantics: set.measurement.loadSemantics ?? '',
                  })),
              );
            all.onerror = () => reject(all.error);
          };
          request.onerror = () => reject(request.error);
        }),
    );
    expect(stored).toEqual([
      { side: 'left', loadSemantics: 'per_side' },
      { side: 'right', loadSemantics: 'per_side' },
    ]);
  });

  test('offers combined load only where the plan permits it, and records the choice', async ({
    page,
  }) => {
    await openTodayWithPlan(page, { unilateral: true, combinedLoad: true });
    await page.getByRole('button', { name: 'Start workout' }).click();
    await page.waitForURL('**/workout');

    const semantics = page.getByRole('group', { name: 'Load counts' });
    await expect(semantics).toBeVisible();
    await expect(semantics.getByRole('radio', { name: 'Per side' })).toBeChecked();

    await semantics.getByRole('radio', { name: 'In total' }).check();
    await page.getByRole('button', { name: 'Log set' }).click();
    await expect(page.getByRole('cell', { name: '22.5 kilograms' })).toBeVisible();

    const stored = await page.evaluate(
      () =>
        new Promise<string>((resolve, reject) => {
          const request = indexedDB.open('workout', 1);
          request.onsuccess = () => {
            const all = request.result
              .transaction('sessions', 'readonly')
              .objectStore('sessions')
              .getAll();
            all.onsuccess = () => {
              const sets = (
                all.result as { session: { sets: { measurement: Record<string, string> }[] } }[]
              ).flatMap((record) => record.session.sets);
              resolve(sets[0]?.measurement.loadSemantics ?? '');
            };
            all.onerror = () => reject(all.error);
          };
          request.onerror = () => reject(request.error);
        }),
    );
    expect(stored).toBe('total');
  });

  test('@a11y the side and load-semantics controls are grouped and keyboard-operable', async ({
    page,
  }) => {
    await openTodayWithPlan(page, { unilateral: true, combinedLoad: true });
    await page.getByRole('button', { name: 'Start workout' }).click();
    await page.waitForURL('**/workout');

    // Native radio groups, so arrow keys and screen-reader semantics come from the platform.
    const side = page.getByRole('group', { name: 'Side' });
    await side.getByRole('radio', { name: 'Left' }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(side.getByRole('radio', { name: 'Right' })).toBeChecked();

    const semantics = page.getByRole('group', { name: 'Load counts' });
    await semantics.getByRole('radio', { name: 'Per side' }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(semantics.getByRole('radio', { name: 'In total' })).toBeChecked();
  });
});

/**
 * Makes every read from the device fail once the next write has committed, until restored:
 * the write succeeded and the screen cannot read it back. Nothing in the application changes.
 */
async function failReadsAfterNextWrite(page: Page): Promise<void> {
  await page.addInitScript(() => {
    let armed = false;
    let failing = false;
    const control = window as unknown as Record<string, () => void>;
    control.__failReadsAfterNextWrite = () => {
      armed = true;
    };
    control.__restoreReads = () => {
      armed = false;
      failing = false;
    };
    const open = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function (
      this: IDBDatabase,
      ...args: Parameters<IDBDatabase['transaction']>
    ) {
      const transaction = open.apply(this, args);
      if (armed && args[1] === 'readwrite' && [args[0]].flat().includes('outbox')) {
        armed = false;
        transaction.addEventListener('complete', () => {
          failing = true;
        });
      }
      return transaction;
    };
    for (const prototype of [IDBObjectStore.prototype, IDBIndex.prototype]) {
      for (const method of ['get', 'getAll'] as const) {
        const original = prototype[method] as (this: unknown, ...args: unknown[]) => unknown;
        (prototype as unknown as Record<string, unknown>)[method] = function (
          this: unknown,
          ...args: unknown[]
        ) {
          if (failing) throw new DOMException('the read failed', 'UnknownError');
          return original.apply(this, args);
        };
      }
    }
  });
}

test.describe('plan-to-workout design conformance (VLA-14, P1 deltas)', () => {
  const noRawIds = async (page: Page): Promise<void> => {
    const text = await page.locator('body').innerText();
    expect(text).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:/);
    expect(text).not.toMatch(/\b(back|bench|split)-(squat|press)\b/);
    expect(text).not.toContain('{"');
  };

  async function startWorkout(
    page: Page,
    multiple = true,
    options: SeedOptions = {},
  ): Promise<void> {
    await openTodayWithPlan(page, { multiple, ...options });
    await page.getByRole('button', { name: 'Start workout' }).click();
    await page.waitForURL('**/workout');
    await expect(page.getByRole('heading', { name: 'Back squat', level: 1 })).toBeVisible();
  }

  type PlanMove = {
    revision: number;
    loadKg?: number;
    reps?: number;
    profile?: 'strength' | 'unilateral_strength';
    swap?: boolean;
  };
  const moveThePlanOn = (page: Page, move: PlanMove = { revision: 2, loadKg: 100, reps: 3 }) =>
    page.evaluate(
      (override) =>
        (window as unknown as { __seedPlan(override: PlanMove): Promise<void> }).__seedPlan(
          override,
        ),
      move,
    );

  test('D-3: with no plan, Today is a heading, one sentence and one secondary button', async ({
    page,
  }) => {
    await page.goto('/today');
    await expect(page.getByRole('heading', { name: 'No plan on this device yet' })).toBeVisible();
    await expect(
      page.getByText('A plan arrives when this device syncs. There is no server to sync with yet.'),
    ).toBeVisible();
    await expect(page.getByText(/saved on the device first/)).toHaveCount(0);
    await page.getByRole('button', { name: 'See your history' }).click();
    await page.waitForURL('**/history');

    await page.goto('/settings');
    await expect(page.getByText(/saved on the device first/)).toBeVisible();
  });

  test('D-1, D-2: Today, History and Summary show names and dates, never ids or ISO times', async ({
    page,
  }) => {
    await openTodayWithPlan(page);
    await expect(page.getByText(/Session mon, Fri 18 Sept/)).toBeVisible();
    await noRawIds(page);
    await page.getByRole('button', { name: 'Start workout' }).click();
    await page.waitForURL('**/workout');
    await expect(page.getByText(/^Started \w{3} \d{1,2} \w{3}/)).toBeVisible();
    await noRawIds(page);
    await finishWorkout(page);
    await page.waitForURL('**/summary?session=**');
    await expect(page.getByRole('heading', { name: 'Back squat', level: 2 })).toBeVisible();
    await noRawIds(page);
    await page.goto('/history');
    await expect(page.getByText('1 exercise · 0 sets')).toBeVisible();
    await noRawIds(page);
  });

  test('D-4, D-5: the workout bar shows position and sync, and Close leaves without ending', async ({
    page,
  }) => {
    await startWorkout(page);
    await expect(page.getByText('Exercise 1 of 2')).toBeVisible();
    await expect(page.getByText('On device')).toBeVisible();
    await expect(page.getByText('Nothing waiting to sync')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Workout', level: 1 })).toHaveCount(0);

    await page.getByRole('button', { name: 'Bench press' }).click();
    await expect(page.getByText('Exercise 2 of 2')).toBeVisible();

    await page.getByRole('button', { name: 'Close' }).click();
    await page.waitForURL('**/today');
    await expect(page.getByRole('heading', { name: 'A workout is in progress' })).toBeVisible();
  });

  test('D-7: the selected chip carries a check as well as aria-pressed; a single exercise has no chips', async ({
    page,
  }) => {
    await startWorkout(page);
    const selected = page.getByRole('button', { name: 'Back squat' });
    const other = page.getByRole('button', { name: 'Bench press' });
    await expect(selected).toHaveAttribute('aria-pressed', 'true');
    await expect(selected.locator('svg')).toHaveCount(1);
    await expect(other).toHaveAttribute('aria-pressed', 'false');
    await expect(other.locator('svg')).toHaveCount(0);

    await other.click();
    await expect(other.locator('svg')).toHaveCount(1);
    await expect(selected.locator('svg')).toHaveCount(0);
  });

  test('D-7: no chip row for a single-exercise session', async ({ page }) => {
    await startWorkout(page, false);
    await expect(page.getByRole('button', { name: 'Back squat' })).toHaveCount(0);
    await expect(page.getByText('Exercise 1 of 1')).toBeVisible();
  });

  test('D-12: Log set is the one primary button and Finish workout is secondary', async ({
    page,
  }) => {
    await startWorkout(page);
    const primaries = page.locator('button[data-variant="primary"]:visible');
    await expect(primaries).toHaveCount(1);
    await expect(primaries).toHaveText('Log set');
    await expect(page.getByRole('button', { name: 'Finish workout' })).toHaveAttribute(
      'data-variant',
      'secondary',
    );
  });

  test('D-13: Finish workout asks first, Keep going loses nothing, confirming replaces history', async ({
    page,
  }) => {
    await startWorkout(page);
    await page.getByRole('button', { name: 'Log set' }).click();
    await expect(page.getByRole('cell', { name: '80 kilograms' })).toBeVisible();

    await page.getByRole('button', { name: 'Finish workout' }).click();
    const dialog = page.getByRole('dialog', { name: 'Finish this workout?' });
    await expect(dialog).toContainText('You have recorded 1 set.');
    await dialog.getByRole('button', { name: 'Keep going' }).click();
    await expect(dialog).toBeHidden();
    expect(page.url()).toContain('/workout');
    await expect(page.getByRole('cell', { name: '80 kilograms' })).toBeVisible();

    await finishWorkout(page);
    await page.waitForURL('**/summary?session=**');
    await page.goBack();
    expect(page.url()).not.toContain('/workout');
  });

  test('D-14: a set that did not save says so in words and Retry resubmits it', async ({
    page,
  }) => {
    await failTheNextWrite(page);
    await startWorkout(page, false);
    await page.evaluate(() =>
      (window as unknown as { __failNextWrite(name: string): void }).__failNextWrite('DataError'),
    );
    await page.getByRole('button', { name: 'Log set' }).click();

    await expect(
      page.getByText('That set was not saved. Nothing already recorded has been lost.'),
    ).toBeVisible();
    await noRawIds(page);
    await page.getByRole('button', { name: 'Retry' }).click();
    await expect(page.getByRole('heading', { name: 'Rest' })).toBeVisible();
    await expect(page.getByRole('cell', { name: '80 kilograms' })).toBeVisible();
    await expect(page.getByText('That set was not saved')).toHaveCount(0);
  });

  test('D-16: with no prescription there is a stale message, no Target, and an empty control', async ({
    page,
  }) => {
    await startWorkout(page);
    await page.getByRole('button', { name: 'Log set' }).click();
    await expect(page.getByRole('cell', { name: '80 kilograms' })).toBeVisible();
    await moveThePlanOn(page);
    await page.reload();

    await expect(
      page.getByText(
        'The plan changed after this workout started, so there are no targets to show. Everything you have recorded is safe.',
      ),
    ).toBeVisible();
    await expect(page.getByText('100 kg × 3')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Back squat', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Bench press', exact: true })).toBeVisible();
    await expect(page.getByText('Exercise 1 of 2')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Finish workout' })).toBeVisible();

    await page.getByRole('button', { name: 'Bench press', exact: true }).click();
    await page.getByRole('button', { name: 'Log a set anyway' }).click();
    await expect(page.getByLabel('Target')).toHaveCount(0);
    await expect(page.getByRole('spinbutton', { name: 'Reps' })).toHaveValue('');
    await expect(page.getByRole('spinbutton', { name: 'Load' })).toHaveValue('');

    await page.getByRole('button', { name: 'Log set' }).click();
    await expect(page.getByText('Enter how many reps you did')).toBeVisible();
    await page.getByRole('spinbutton', { name: 'Reps' }).fill('5');
    await page.getByRole('spinbutton', { name: 'Reps' }).blur();
    await page.getByRole('button', { name: 'Log set' }).click();
    await expect(page.getByRole('heading', { name: 'Rest' })).toBeVisible();
    await expect(page.getByRole('cell', { name: '5', exact: true })).toBeVisible();
    await expect(page.getByRole('cell', { name: '100 kilograms' })).toHaveCount(0);
  });

  const openUnprescribed = async (page: Page, move: PlanMove, heading: string) => {
    await openTodayWithPlan(page, { unilateral: true });
    await page.getByRole('button', { name: 'Start workout' }).click();
    await page.waitForURL('**/workout');
    await expect(page.getByRole('heading', { name: heading })).toBeVisible();
    await moveThePlanOn(page, move);
    await page.reload();
    await page.getByRole('button', { name: 'Log a set anyway' }).click();
    await expect(page.getByLabel('Target')).toHaveCount(0);
    await expect(page.getByRole('spinbutton', { name: 'Load' })).toHaveValue('');
  };

  const logFiveReps = async (page: Page) => {
    await page.getByRole('spinbutton', { name: 'Reps' }).fill('5');
    await page.getByRole('spinbutton', { name: 'Reps' }).blur();
    await page.getByRole('button', { name: 'Log set' }).click();
    await expect(page.getByRole('heading', { name: 'Rest' })).toBeVisible();
  };

  const sideGroup = (page: Page) => page.getByRole('group', { name: 'Side' });

  test('D-16: a one-sided exercise stays one-sided when the plan moves on to two-sided', async ({
    page,
  }) => {
    await openUnprescribed(page, { revision: 2, profile: 'strength' }, 'Split squat');
    await expect(sideGroup(page).getByRole('radio', { name: 'Left' })).toBeChecked();
    await sideGroup(page).getByRole('radio', { name: 'Right' }).check({ force: true });
    await logFiveReps(page);
    await page.getByRole('button', { name: /^Edit set 1/ }).click();
    await expect(sideGroup(page).getByRole('radio', { name: 'Right' })).toBeChecked();
  });

  test('D-16: a two-sided exercise stays two-sided when the plan moves on to one-sided', async ({
    page,
  }) => {
    await startWorkout(page, false);
    await moveThePlanOn(page, { revision: 2, profile: 'unilateral_strength' });
    await page.reload();
    await page.getByRole('button', { name: 'Log a set anyway' }).click();
    await expect(sideGroup(page)).toHaveCount(0);
    await logFiveReps(page);
    await page.getByRole('button', { name: /^Edit set 1/ }).click();
    await expect(sideGroup(page)).toHaveCount(0);
  });

  test('D-16: a one-sided exercise stays one-sided when the plan no longer has it', async ({
    page,
  }) => {
    await openUnprescribed(page, { revision: 2, swap: true }, 'Split squat');
    await expect(sideGroup(page).getByRole('radio', { name: 'Left' })).toBeChecked();
    await expect(page.getByRole('heading', { name: 'Split squat' })).toBeVisible();
    await expect(page.getByText('Overhead press')).toHaveCount(0);
    await logFiveReps(page);
  });

  test('a prescription with reps and no load shows the reps and leaves Load empty', async ({
    page,
  }) => {
    await startWorkout(page, false, { bodyweight: true });
    await expect(page.getByLabel('Target')).toContainText('8 reps');
    await expect(page.getByLabel('Target')).not.toContainText('kg');
    await expect(page.getByRole('spinbutton', { name: 'Load' })).toHaveValue('');
    await page.getByRole('button', { name: 'Log set' }).click();
    await expect(page.getByRole('heading', { name: 'Rest' })).toBeVisible();
    await expect(page.getByRole('cell', { name: '8', exact: true })).toBeVisible();
    await expect(page.getByRole('cell', { name: /kilogram/ })).toHaveCount(0);
  });

  test('a set that saved but could not be read back keeps the workout and Retry only reads', async ({
    page,
  }) => {
    await failReadsAfterNextWrite(page);
    let failedReads = 0;
    page.on('console', (message) => {
      if (message.text().startsWith('workout not read')) failedReads += 1;
    });
    await startWorkout(page, false);
    await page.evaluate(() =>
      (window as unknown as { __failReadsAfterNextWrite(): void }).__failReadsAfterNextWrite(),
    );
    await page.getByRole('button', { name: 'Log set' }).click();

    await expect(page.getByRole('heading', { name: 'Rest' })).toBeVisible();
    await expect(page.getByText('This screen could not be refreshed')).toBeVisible();
    await expect(page.getByText('That set was not saved')).toHaveCount(0);

    expect(failedReads).toBe(1);
    await page.getByRole('button', { name: 'Retry' }).click();
    await expect.poll(() => failedReads).toBe(2);
    await expect(page.getByText('This screen could not be refreshed')).toBeVisible();

    // The table is stale: it must not number the next set as the one already saved, nor
    // tell Finish that nothing was recorded.
    await page.getByRole('button', { name: 'Next set' }).click();
    await expect.poll(() => failedReads).toBe(3);
    await expect(page.getByRole('heading', { name: 'Rest' })).toBeVisible();
    await expect(page.getByText('Set 1', { exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Finish workout' }).click();
    const dialog = page.getByRole('dialog', { name: 'Finish this workout?' });
    await expect(dialog).toBeVisible();
    await expect(dialog).not.toContainText(/recorded \d+ sets?/);
    await expect(dialog).not.toContainText('0 sets');
    await dialog.getByRole('button', { name: 'Keep going' }).click();

    await page.evaluate(() => (window as unknown as { __restoreReads(): void }).__restoreReads());
    await page.getByRole('button', { name: 'Next set' }).click();
    await expect(page.getByText('This screen could not be refreshed')).toHaveCount(0);
    await expect(page.getByText('Set 2', { exact: true })).toBeVisible();
    await expect(page.getByRole('cell', { name: '80 kilograms' })).toHaveCount(1);
    await page.getByRole('button', { name: 'Finish workout' }).click();
    await expect(page.getByRole('dialog', { name: 'Finish this workout?' })).toContainText(
      'You have recorded 1 set.',
    );
  });

  test('switching exercises waits for a read that works, so a saved set is never renumbered', async ({
    page,
  }) => {
    await failReadsAfterNextWrite(page);
    await startWorkout(page, true);
    await page.evaluate(() =>
      (window as unknown as { __failReadsAfterNextWrite(): void }).__failReadsAfterNextWrite(),
    );
    await page.getByRole('button', { name: 'Log set' }).click();
    await expect(page.getByRole('heading', { name: 'Rest' })).toBeVisible();
    await expect(page.getByText('This screen could not be refreshed')).toBeVisible();

    // The table is stale, so the exercise chips must not remount the set view on it.
    await page.getByRole('button', { name: 'Bench press' }).click();
    await expect(page.getByRole('button', { name: 'Back squat', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(page.getByRole('heading', { name: 'Rest' })).toBeVisible();
    await expect(page.getByText('Set 1', { exact: true })).toHaveCount(0);

    await page.evaluate(() => (window as unknown as { __restoreReads(): void }).__restoreReads());
    await page.getByRole('button', { name: 'Bench press' }).click();
    await expect(page.getByRole('button', { name: 'Bench press', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(page.getByText('This screen could not be refreshed')).toHaveCount(0);
    await page.getByRole('button', { name: 'Back squat' }).click();
    await expect(page.getByText('Set 2', { exact: true })).toBeVisible();
    await expect(page.getByRole('cell', { name: '80 kilograms' })).toHaveCount(1);
  });
});

test.describe('the edit view keeps Cancel, Save changes and Delete set reachable (VLA-243)', () => {
  /** Logs a set, starts the next one, then opens the first set from the table. */
  const openEditView = async (page: Page, plan: SeedOptions, how: 'tap' | 'key' = 'tap') => {
    await openTodayWithPlan(page, plan);
    await page.getByRole('button', { name: 'Start workout' }).click();
    await page.waitForURL('**/workout');
    await page.getByRole('button', { name: 'Log set' }).click();
    await page.getByRole('button', { name: 'Next set' }).click();
    const edit = page.getByRole('button', { name: /^Edit set 1/ });
    if (how === 'key') {
      await edit.focus();
      await page.keyboard.press('Enter');
    } else {
      await edit.click();
    }
    await expect(page.getByRole('button', { name: 'Save changes' })).toBeVisible();
  };

  const cancel = (page: Page) => page.getByRole('button', { name: 'Cancel', exact: true });
  const save = (page: Page) => page.getByRole('button', { name: 'Save changes' });
  const remove = (page: Page) => page.getByRole('button', { name: 'Delete set' });

  /** True when the centre and the four corners of the control hit the control, not something over it. */
  const paintsEverywhere = (control: Locator): Promise<boolean> =>
    control.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      // Inset past the rounded corners.
      const inset = 10;
      const points = [
        [rect.x + rect.width / 2, rect.y + rect.height / 2],
        [rect.x + inset, rect.y + inset],
        [rect.right - inset, rect.y + inset],
        [rect.x + inset, rect.bottom - inset],
        [rect.right - inset, rect.bottom - inset],
      ] as const;
      return points.every(([x, y]) => {
        const hit = document.elementFromPoint(x, y);
        return hit !== null && (hit === element || element.contains(hit));
      });
    });

  test('@a11y at 375x667 with one exercise nothing sits under the bar and target-size passes', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await openEditView(page, {});
    expect(await page.evaluate(() => window.scrollY), 'the edit view opens at the top').toBe(0);

    for (const control of [cancel(page), save(page), remove(page)]) {
      await expect(control).toBeInViewport({ ratio: 1 });
      expect(await paintsEverywhere(control), `${await control.innerText()} is covered`).toBe(true);
      expect((await boxOf(control)).height).toBeGreaterThanOrEqual(44);
    }
    const [cancelBox, saveBox, deleteBox] = await Promise.all(
      [cancel(page), save(page), remove(page)].map(boxOf),
    );
    expect(cancelBox.y, 'Cancel and Save changes share one row').toBe(saveBox.y);
    expect(cancelBox.x, 'Cancel comes first').toBeLessThan(saveBox.x);
    expect(overlaps(deleteBox, saveBox)).toBe(false);
    expect(deleteBox.y, 'Delete set is on the first screen, above the bar').toBeLessThan(saveBox.y);

    const results = await new AxeBuilder({ page }).withRules(['target-size']).analyze();
    expect(results.violations.map(({ id, nodes }) => ({ id, nodes: nodes.length }))).toEqual([]);
  });

  test('keeps the tab order in reading order: Delete set, the controls, Cancel, Save changes', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await openEditView(page, {});
    const order = await page
      .locator('button')
      .evaluateAll((elements) => elements.map((element) => element.textContent?.trim() ?? ''));
    const names = order.filter((name) => ['Delete set', 'Cancel', 'Save changes'].includes(name));
    expect(names).toEqual(['Delete set', 'Cancel', 'Save changes']);
    const heading = await boxOf(page.getByRole('heading', { level: 1, name: 'Back squat' }));
    expect((await boxOf(remove(page))).y - heading.y).toBeLessThan(80);
  });

  test('at 320 px and 200% text the bar stacks Save changes over Cancel and focus stays clear of the bar', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Page.enable');
    await cdp.send('Page.setFontSizes', { fontSizes: { standard: 32, fixed: 26 } });
    await openEditView(page, {}, 'key');

    const [cancelBox, saveBox] = await Promise.all([cancel(page), save(page)].map(boxOf));
    expect(saveBox.y + saveBox.height, 'Save changes is above Cancel').toBeLessThanOrEqual(
      cancelBox.y,
    );
    for (const control of [cancel(page), save(page)]) {
      await expect(control).toBeInViewport({ ratio: 1 });
      expect(await paintsEverywhere(control)).toBe(true);
    }
    // The sets table below the form is wider than 320 px at this size and scrolls inside its own
    // wrapper; the edit view's own controls must still fit.
    for (const control of [cancel(page), save(page), remove(page)]) {
      const box = await boxOf(control);
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(320);
    }

    // Tab through every control: none outside the bar may end up under it. Measured in the
    // page's own coordinates: the sets table is wider than 320 px here, so the browser fits the page.
    await page.keyboard.press('Tab');
    for (let step = 0; step < 40; step += 1) {
      const { inBar, covered } = await page.evaluate(() => {
        const element = document.activeElement;
        const bar = document.querySelector('section[aria-label]');
        if (element === document.body) return { inBar: true, covered: false };
        // A radio is a hidden input inside the label that is the target.
        const box = (element?.closest('label') ?? element)?.getBoundingClientRect();
        const barBox = bar?.getBoundingClientRect();
        return {
          inBar: bar?.contains(element ?? null) ?? false,
          covered:
            box && barBox ? box.bottom > barBox.top + 1 && box.top < barBox.bottom - 1 : false,
        };
      });
      if (!inBar) expect(covered, 'focus is under the bar').toBe(false);
      await page.keyboard.press('Tab');
    }
  });

  test('in landscape Cancel and Save changes share the action row', async ({ page }) => {
    await page.setViewportSize({ width: 667, height: 375 });
    await openEditView(page, { multiple: true });
    const [cancelBox, saveBox] = await Promise.all([cancel(page), save(page)].map(boxOf));
    expect(cancelBox.y).toBe(saveBox.y);
    expect(cancelBox.x).toBeLessThan(saveBox.x);
    for (const control of [cancel(page), save(page), remove(page)]) {
      await expect(control).toBeInViewport({ ratio: 1 });
      expect(await paintsEverywhere(control)).toBe(true);
    }
  });

  for (const plan of [{ multiple: true }, { many: true }] satisfies SeedOptions[]) {
    test(`in landscape with ${plan.many ? 'five' : 'two'} exercises, opening Edit from the sets table lands at the top`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: 667, height: 375 });
      await openTodayWithPlan(page, plan);
      await page.getByRole('button', { name: 'Start workout' }).click();
      await page.waitForURL('**/workout');
      await page.getByRole('button', { name: 'Log set' }).click();
      await page.getByRole('button', { name: 'Next set' }).click();
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      expect(await page.evaluate(() => window.scrollY), 'the sets table is below').toBeGreaterThan(
        0,
      );
      await page.getByRole('button', { name: /^Edit set 1/ }).click();
      await expect(save(page)).toBeVisible();

      expect(await page.evaluate(() => window.scrollY)).toBe(0);
      expect((await boxOf(page.getByRole('button', { name: 'Close' }))).y).toBeGreaterThanOrEqual(
        0,
      );
    });
  }

  test('two exercises in portrait: Cancel, Save changes and Delete set are all reachable', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await openEditView(page, { multiple: true });
    for (const control of [cancel(page), save(page)]) {
      await expect(control).toBeInViewport({ ratio: 1 });
      expect(await paintsEverywhere(control)).toBe(true);
    }
    await remove(page).scrollIntoViewIfNeeded();
    expect(await paintsEverywhere(remove(page))).toBe(true);
  });
});
