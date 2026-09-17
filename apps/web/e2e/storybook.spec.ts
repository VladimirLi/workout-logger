import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';
import { openStory, stories } from './routes';

/**
 * The Storybook lab (governance.lab.storybook, ADR-0010) is the only design-system lab. Every
 * story must be filed in the agreed hierarchy, render without an error, pass every axe rule in
 * both themes at a phone and a wide viewport, and its interactive patterns must work from the
 * keyboard. `pnpm storybook:build` runs before this in `pnpm verify`.
 */

const CATEGORY =
  /^(Foundations\/[A-Z][A-Za-z]+|Primitives\/[A-Z][A-Za-z]+|Patterns\/(Navigation|Workout|Feedback|Data|Settings|Proposals|Layout)\/[A-Z][A-Za-z]+|Reference screens\/[A-Z][A-Za-z ]+)$/;

test('every story is filed under the agreed component-level hierarchy', () => {
  const all = stories();
  expect(all.length).toBeGreaterThanOrEqual(80);
  expect(all.filter((story) => !CATEGORY.test(story.title)).map((story) => story.title)).toEqual(
    [],
  );
  const titles = new Set(all.map((story) => story.title));
  for (const required of [
    'Foundations/Colour',
    'Foundations/Icons',
    'Primitives/Button',
    'Primitives/Stepper',
    'Primitives/Segmented',
    'Primitives/Sheet',
    'Patterns/Navigation/WorkoutBar',
    'Patterns/Workout/RestTimer',
    'Patterns/Feedback/SyncIndicator',
    'Patterns/Feedback/StatusMessage',
    'Patterns/Data/SetTable',
    'Patterns/Settings/ThemeSetting',
    'Patterns/Proposals/ProposalReview',
    'Reference screens/Set focus',
    'Reference screens/Rest',
    'Reference screens/History',
    'Reference screens/Settings',
    'Reference screens/Empty history',
    'Reference screens/Sync error',
    'Reference screens/Proposal review',
    'Reference screens/Stale proposal',
    'Reference screens/State matrix',
  ]) {
    expect(titles.has(required), required).toBe(true);
  }
});

test('every story renders without an error', async ({ page }) => {
  test.setTimeout(180_000);
  const failures: string[] = [];
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text().split('\n')[0] ?? '');
  });
  for (const { id } of stories()) {
    errors.length = 0;
    await openStory(page, id);
    await page.waitForLoadState('networkidle');
    const shown = await page.evaluate(() => document.body.className);
    if (shown.includes('sb-show-errordisplay') || errors.length > 0) {
      failures.push(`${id}: ${shown} ${errors.join('; ')}`);
    }
  }
  expect(failures).toEqual([]);
});

/**
 * Storybook's accessibility addon runs axe in the story frame by itself. Waiting until that run is
 * idle before starting ours avoids "Axe is already running" on a slow machine.
 */
async function analyzeWhenIdle(page: Page) {
  await page.waitForFunction(() => !(window as { axe?: { _running?: boolean } }).axe?._running);
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await new AxeBuilder({ page }).analyze();
    } catch (error) {
      if (attempt >= 5 || !String(error).includes('Axe is already running')) throw error;
      await page.waitForFunction(() => !(window as { axe?: { _running?: boolean } }).axe?._running);
    }
  }
}

// One test per story, so a slow machine cannot time out the whole scan and a failure names it.
for (const { id } of stories()) {
  test(`@a11y ${id} passes every axe rule in both themes at 375 and 1280 px`, async ({ page }) => {
    // Colour transitions would otherwise be measured part-way through a theme change.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const violations: string[] = [];
    for (const [width, height] of [
      [375, 667],
      [1280, 800],
    ] as const) {
      await page.setViewportSize({ width, height });
      for (const theme of ['light', 'dark'] as const) {
        await openStory(page, id, theme);
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
        const results = await analyzeWhenIdle(page);
        for (const violation of results.violations) {
          violations.push(`${width} ${theme}: ${violation.id} (${violation.nodes.length})`);
        }
      }
    }
    expect(violations).toEqual([]);
  });
}

test.describe('keyboard operation of interactive stories', () => {
  test('Stepper: arrow keys and Page keys step the value, typing a comma decimal works', async ({
    page,
  }) => {
    await openStory(page, 'primitives-stepper--load');
    const load = page.getByRole('spinbutton', { name: 'Load' });
    await load.focus();
    await page.keyboard.press('ArrowUp');
    await expect(load).toHaveAttribute('aria-valuenow', '82.5');
    await page.keyboard.press('PageDown');
    await expect(load).toHaveAttribute('aria-valuenow', '70');
    await load.fill('81,3');
    await page.keyboard.press('Enter');
    await expect(load).toHaveAttribute('aria-valuenow', '81.25');
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Increase load' })).toBeFocused();
  });

  test('Segmented: arrow keys move the choice and its check', async ({ page }) => {
    await openStory(page, 'primitives-segmented--with-selection');
    await page.getByRole('radio', { name: '2' }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('radio', { name: '3' })).toBeChecked();
    await expect(page.locator('label:has(input:checked) svg[data-icon="check"]')).toBeVisible();
  });

  test('Sheet: Enter opens it, Tab stays inside, Escape closes it and returns focus', async ({
    page,
  }) => {
    await openStory(page, 'primitives-sheet--closed');
    const trigger = page.getByRole('button', { name: 'What is RIR?' });
    await trigger.focus();
    await page.keyboard.press('Enter');
    const sheet = page.getByRole('dialog', { name: 'RIR: reps in reserve' });
    await expect(sheet).toBeVisible();
    for (let index = 0; index < 3; index += 1) {
      await page.keyboard.press('Tab');
      expect(await sheet.evaluate((dialog) => dialog.contains(document.activeElement))).toBe(true);
    }
    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test('ConfirmDialog: Enter opens it, Escape keeps the data and returns focus', async ({
    page,
  }) => {
    await openStory(page, 'primitives-confirmdialog--permanent-action');
    const trigger = page.getByRole('button', { name: 'Delete history' });
    await trigger.focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: 'Delete all history?' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Keep history' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test('Switch: Space toggles it and the words change with it', async ({ page }) => {
    await openStory(page, 'primitives-switch--off');
    const toggle = page.getByRole('switch', { name: 'Rest end sound' });
    await toggle.focus();
    await expect(page.getByText('Off', { exact: true })).toBeVisible();
    await page.keyboard.press('Space');
    await expect(toggle).toBeChecked();
    await expect(page.getByText('On', { exact: true })).toBeVisible();
  });

  test('ThemeSetting: arrow keys choose a theme and it applies', async ({ page }) => {
    await openStory(page, 'patterns-settings-themesetting--light-dark-system');
    await page.getByRole('radio', { name: 'Light' }).focus();
    await page.keyboard.press('ArrowDown');
    await expect(page.getByRole('radio', { name: 'Dark' })).toBeChecked();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  });

  test('RirPicker: the help button opens the RPE sheet from the keyboard', async ({ page }) => {
    await openStory(page, 'patterns-workout-rirpicker--with-helper');
    await page.getByRole('button', { name: 'What is RIR?' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog', { name: 'RIR: reps in reserve' })).toBeVisible();
  });

  test('UndoToast: Undo is reachable with Tab and Enter dismisses the toast', async ({ page }) => {
    await openStory(page, 'patterns-feedback-undotoast--set-deleted');
    await page.keyboard.press('Tab');
    const undo = page.getByRole('button', { name: 'Undo' });
    await expect(undo).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(undo).toHaveCount(0);
  });

  test('LogToRest: Enter on Log set moves focus to the rest heading', async ({ page }) => {
    await openStory(page, 'patterns-workout-logtorest--before-logging');
    await page.getByRole('button', { name: 'Log set' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: 'Rest', exact: true })).toBeFocused();
  });
});
