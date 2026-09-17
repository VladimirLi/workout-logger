import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { expect, type Page, test } from '@playwright/test';
import { FIXED_NOW, REST } from '../ui/lab/fixtures';
import { ALL_ROUTES, SCREEN_ROUTES } from './routes';

/**
 * Behaviour the accepted design system promises (DESIGN_SYSTEM.md, ADR-0008). Pixels are
 * test:visual's job; this checks what a screenshot cannot.
 */

const LIGHT_BG = 'rgb(237, 240, 236)';
const DARK_BG = 'rgb(16, 19, 17)';

const background = (page: Page) =>
  page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor);

test.describe('theme (theme.first-visit.light-then-choice)', () => {
  test('a first visit is light even when the OS prefers dark', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('/lab/screens/plan');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    expect(await background(page)).toBe(LIGHT_BG);
  });

  test('a stored dark preference applies before any application script runs', async ({ page }) => {
    // With every Next.js chunk blocked, React never loads. Only the inline bootstrap can set
    // the theme, so a pass here means there is no light flash waiting for hydration.
    await page.route('**/_next/static/**/*.js', (route) => route.abort());
    await page.addInitScript(() => window.localStorage.setItem('wl-theme', 'dark'));
    await page.goto('/lab/screens/plan');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    expect(await background(page)).toBe(DARK_BG);
    await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#101311');
  });

  test('System follows the OS preference, including a change mid-session', async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem('wl-theme', 'system'));
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('/lab/screens/plan');
    expect(await background(page)).toBe(DARK_BG);
    await page.emulateMedia({ colorScheme: 'light' });
    expect(await background(page)).toBe(LIGHT_BG);
    // Browser chrome and native controls follow too, via the bootstrap's change listener.
    await expect
      .poll(() =>
        page.evaluate(() => ({
          scheme: document.documentElement.style.colorScheme,
          meta: document.querySelector('meta[name="theme-color"]')?.getAttribute('content'),
        })),
      )
      .toEqual({ scheme: 'light', meta: '#EDF0EC' });
  });

  test('the Settings choice persists across a reload', async ({ page }) => {
    await page.goto('/lab/screens/settings');
    await page.getByRole('radio', { name: 'Dark' }).check();
    expect(await background(page)).toBe(DARK_BG);
    await page.reload();
    await expect(page.getByRole('radio', { name: 'Dark' })).toBeChecked();
    expect(await background(page)).toBe(DARK_BG);
  });
});

test.describe('controls', () => {
  test('the load stepper steps by 2.5 kg, reads in words, and accepts a typed decimal comma', async ({
    page,
  }) => {
    await page.goto('/lab/screens/set-focus');
    const load = page.getByRole('spinbutton', { name: 'Load' });
    await expect(load).toHaveAttribute('aria-valuetext', '80 kilograms');
    await page.getByRole('button', { name: 'Increase load' }).click();
    await expect(load).toHaveAttribute('aria-valuenow', '82.5');
    await load.focus();
    await page.keyboard.press('ArrowDown');
    await expect(load).toHaveAttribute('aria-valuenow', '80');
    await load.fill('81,3');
    await load.blur();
    await expect(load).toHaveAttribute('aria-valuenow', '81.25');
    await expect(load).toHaveAttribute('inputmode', 'decimal');
  });

  test('RIR is a radio group operated with arrow keys, with a visible check on the choice', async ({
    page,
  }) => {
    await page.goto('/lab/screens/set-focus');
    const two = page.getByRole('radio', { name: '2' });
    await expect(two).toBeChecked();
    await two.focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('radio', { name: '3' })).toBeChecked();
    const checks = page.locator('fieldset label:has(input:checked) svg[data-icon="check"]');
    await expect(checks).toBeVisible();
  });

  test('the RIR help sheet traps focus, closes on Escape, and returns focus', async ({ page }) => {
    await page.goto('/lab/screens/set-focus');
    const trigger = page.getByRole('button', { name: 'What is RIR?' });
    await trigger.click();
    const sheet = page.getByRole('dialog', { name: 'RIR: reps in reserve' });
    await expect(sheet).toBeVisible();
    for (let index = 0; index < 4; index += 1) {
      await page.keyboard.press('Tab');
      expect(await sheet.evaluate((dialog) => dialog.contains(document.activeElement))).toBe(true);
    }
    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test('the phone back gesture closes the sheet before leaving the screen', async ({ page }) => {
    await page.goto('/lab/screens/set-focus');
    await page.getByRole('button', { name: 'What is RIR?' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.goBack();
    await expect(page.getByRole('dialog')).toBeHidden();
    expect(new URL(page.url()).pathname).toBe('/lab/screens/set-focus');
  });

  test('logging a set crossfades to rest in place, checks the pill, and moves focus', async ({
    page,
  }) => {
    await page.clock.setFixedTime(FIXED_NOW);
    await page.goto('/lab/screens/set-focus');
    const status = page
      .locator('[role="status"]')
      .filter({ hasText: /^$|Set 2 saved/ })
      .last();
    // The live region is on the page, empty, before anything is logged.
    await expect(status).toBeAttached();
    await expect(status).toHaveText('');
    const logSet = page.getByRole('button', { name: 'Log set' });
    await logSet.click();
    const leaving = await page
      .locator('[data-leaving]')
      .evaluate((element) => getComputedStyle(element).animationName)
      .catch(() => 'already gone');
    expect(leaving).toMatch(/leave$|^already gone$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Rest' })).toBeFocused();
    await expect(status).toHaveText('Set 2 saved. Rest 1:30.');
    await expect(page.getByText('Set 2, done')).toBeAttached();
    const entering = await page
      .locator('[data-entering]')
      .evaluate((element) => getComputedStyle(element).animationDuration);
    expect(entering).toBe('0.1s');
    expect(new URL(page.url()).pathname).toBe('/lab/screens/set-focus');
  });

  test('a tap on the scrim closes the sheet', async ({ page }) => {
    await page.goto('/lab/screens/set-focus');
    await page.getByRole('button', { name: 'What is RIR?' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.mouse.click(20, 20);
    await expect(page.getByRole('dialog')).toBeHidden();
  });

  test('settings switches say On or Off in words and persist', async ({ page }) => {
    await page.goto('/lab/screens/settings');
    const sound = page.getByRole('switch', { name: 'Rest end sound' });
    await expect(sound).not.toBeChecked();
    await expect(page.getByRole('switch', { name: 'Vibration' })).toBeChecked();
    await sound.check();
    await page.reload();
    await expect(page.getByRole('switch', { name: 'Rest end sound' })).toBeChecked();
    expect(await page.evaluate(() => window.localStorage.getItem('wl-rest-sound'))).toBe('on');
  });

  test('a permanent action asks first, with a clear way out that returns focus', async ({
    page,
  }) => {
    await page.goto('/lab/screens/settings');
    const trigger = page.getByRole('button', { name: 'Delete history' });
    await trigger.click();
    const dialog = page.getByRole('dialog', { name: 'Delete all history?' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Keep history' }).click();
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test('a busy button stays focusable and says what it is doing', async ({ page }) => {
    await page.goto('/lab/components');
    const busy = page.getByRole('button', { name: 'Saving…' });
    await expect(busy).toHaveAttribute('aria-busy', 'true');
    await expect(busy).toBeEnabled();
  });
});

test.describe('proposal review (agent-proposals spec: the user reviews proposals in the PWA)', () => {
  test('a pending proposal shows its base revision, diff, rationale, and creation time', async ({
    page,
  }) => {
    await page.goto('/lab/screens/proposal-review');
    await expect(page.getByRole('heading', { level: 1, name: 'Plan change' })).toBeVisible();
    await expect(page.getByText('Made against plan revision 12')).toBeVisible();
    await expect(page.getByText('Created Sun 13 Sept, 09:30')).toBeVisible();
    await expect(page.getByText('From agent')).toBeVisible();

    const diff = page.getByRole('list', { name: 'Changes' });
    await expect(diff.getByRole('listitem')).toHaveCount(2);
    await expect(diff).toContainText('Back squat');
    await expect(diff).toContainText('80\u00A0kg × 8');
    await expect(diff).toContainText('82.5\u00A0kg × 8');
    await expect(diff).toContainText('Tue 15 Sept');
    await expect(diff).toContainText('Wed 16 Sept');

    // The rationale is untrusted agent text: shown as plain text, never interpreted as markup.
    const rationale = page.getByRole('region', { name: 'Why' });
    await expect(rationale).toContainText('<b>Squat</b> moved well');
    expect(await rationale.locator('b').count()).toBe(0);

    await expect(page.getByRole('button', { name: 'Accept change' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Reject' })).toBeVisible();
  });

  test('accepting a stale proposal says so, and offers nothing to apply', async ({ page }) => {
    await page.goto('/lab/screens/proposal-stale');
    await expect(
      page.getByText('Out of date. The plan changed after this was made.'),
    ).toBeVisible();
    await expect(
      page.getByText('Nothing was changed. Ask the agent for a new proposal.'),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Accept change' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Done' })).toBeVisible();
  });
});

test.describe('timing', () => {
  test('undo stays for 10 seconds, and pauses while hovered', async ({ page }) => {
    await page.clock.install({ time: FIXED_NOW });
    await page.goto('/lab/states');
    const undo = page.getByRole('button', { name: 'Undo' });
    await page.clock.runFor(9_000);
    await expect(undo).toBeVisible();
    await undo.hover();
    await page.clock.runFor(5_000);
    await expect(undo).toBeVisible();
    await page.mouse.move(0, 0);
    await page.clock.runFor(1_500);
    await expect(undo).toBeHidden();
  });

  test('the rest timer announces start, 10 seconds left, and done, and nothing between', async ({
    page,
  }) => {
    await page.clock.install({ time: REST.startedAt });
    await page.goto('/lab/screens/rest');
    const live = page.locator('[aria-live="polite"]');
    await expect(live).toHaveText('Rest started. 1 minute 30 seconds.');
    await page.clock.runFor(60_000);
    await expect(live).toHaveText('Rest started. 1 minute 30 seconds.');
    await page.clock.runFor(20_000);
    await expect(live).toHaveText('10 seconds left.');
    await page.clock.runFor(10_000);
    await expect(live).toHaveText('Rest done.');
    await expect(page.getByText('0:00')).toBeVisible();
  });
});

test.describe('preferences', () => {
  test('reduced motion makes every transition and animation instant', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    for (const route of ALL_ROUTES) {
      await page.goto(route);
      const slow = await page.evaluate(() =>
        [...document.querySelectorAll('*')]
          .map((element) => {
            const style = getComputedStyle(element);
            const longest = (value: string) =>
              Math.max(...value.split(',').map((part) => Number.parseFloat(part) || 0));
            return {
              tag: element.tagName,
              seconds: Math.max(
                longest(style.transitionDuration),
                longest(style.animationDuration),
              ),
            };
          })
          .filter(({ seconds }) => seconds > 0.0001),
      );
      expect(slow, route).toEqual([]);
    }
  });

  test('forced colours keep a visible focus indicator and real control borders', async ({
    page,
  }) => {
    await page.emulateMedia({ forcedColors: 'active' });
    await page.goto('/lab/components');
    const button = page.getByRole('button', { name: 'Secondary', exact: true });
    await button.focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    const style = await button.evaluate((element) => {
      const computed = getComputedStyle(element);
      return { outline: computed.outlineStyle, border: computed.borderTopStyle };
    });
    expect(style).toEqual({ outline: 'solid', border: 'solid' });
  });

  test('increased contrast turns muted text into full ink', async ({ page }) => {
    await page.emulateMedia({ contrast: 'more' });
    await page.goto('/lab/components');
    const muted = page.getByText('Label text, muted');
    const ink = await page.evaluate(() => getComputedStyle(document.body).color);
    expect(await muted.evaluate((element) => getComputedStyle(element).color)).toBe(ink);
  });
});

test.describe('state distinctions (R-010)', () => {
  test('every sync state has its own icon and its own words', async ({ page }) => {
    await page.goto('/lab/states');
    const states = await page.locator('[data-state]').evaluateAll((elements) =>
      elements.map((element) => ({
        icon: element.querySelector('svg')?.getAttribute('data-icon'),
        text: element.textContent,
      })),
    );
    expect(states).toHaveLength(4);
    expect(new Set(states.map((state) => state.icon)).size).toBe(4);
    expect(new Set(states.map((state) => state.text)).size).toBe(4);
  });
});

test.describe('layout', () => {
  test('a phone held sideways puts target and inputs side by side (layout.landscape.two-pane)', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 667, height: 375 });
    await page.goto('/lab/screens/set-focus');
    const target = await page.getByLabel('Target').boundingBox();
    const actual = await page.getByLabel('Actual').boundingBox();
    expect(target && actual && actual.x > target.x + target.width - 1).toBe(true);
  });

  test('at 667 x 375 the set screen needs no vertical scrolling', async ({ page }) => {
    await page.setViewportSize({ width: 667, height: 375 });
    await page.goto('/lab/screens/set-focus');
    const overflow = await page.evaluate(
      () => document.documentElement.scrollHeight - document.documentElement.clientHeight,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test('the content column is centred and at most 520 px on a wide screen', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/lab/screens/history');
    const list = await page.getByRole('list', { name: 'Workouts' }).boundingBox();
    expect(list?.width).toBeLessThanOrEqual(520);
    expect(Math.abs((list?.x ?? 0) + (list?.width ?? 0) / 2 - 640)).toBeLessThanOrEqual(1);
  });

  test('every screen names itself "Screen · Workout Logger"', async ({ page }) => {
    for (const route of SCREEN_ROUTES) {
      await page.goto(route);
      await expect(page).toHaveTitle(/^.+ · Workout Logger$/);
    }
  });

  test('layout does not shift after first paint (CLS below 0.05)', async ({ page }) => {
    for (const route of ALL_ROUTES) {
      await page.goto(route);
      await page.waitForLoadState('networkidle');
      const shift = await page.evaluate(
        () =>
          new Promise<number>((resolve) => {
            let total = 0;
            new PerformanceObserver((list) => {
              for (const entry of list.getEntries() as (PerformanceEntry & {
                value: number;
                hadRecentInput: boolean;
              })[]) {
                if (!entry.hadRecentInput) total += entry.value;
              }
            }).observe({ type: 'layout-shift', buffered: true });
            setTimeout(() => resolve(total), 500);
          }),
      );
      expect(shift, route).toBeLessThan(0.05);
    }
  });
});

test.describe('responsiveness (performance: INP under 200 ms)', () => {
  test('every set-screen interaction responds within 200 ms at a 4x CPU slowdown', async ({
    page,
  }, testInfo) => {
    // A lab measurement, not field INP: the Event Timing API reports each interaction's full
    // duration (input delay, processing, next paint). INP is the worst of them when there are
    // fewer than 50. Only interactions of 16 ms or more are reported, so none means all were
    // faster. The CPU slowdown approximates a mid-range phone.
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    await page.addInitScript(() => {
      const record: { name: string; duration: number }[] = [];
      (window as unknown as { __events: typeof record }).__events = record;
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as (PerformanceEntry & {
          interactionId?: number;
        })[]) {
          if (entry.interactionId) record.push({ name: entry.name, duration: entry.duration });
        }
      }).observe({
        type: 'event',
        buffered: true,
        durationThreshold: 16,
      } as PerformanceObserverInit);
    });
    await page.clock.setFixedTime(FIXED_NOW);
    await page.goto('/lab/screens/set-focus');
    // Without Event Timing support the measurement would pass vacuously.
    expect(
      await page.evaluate(() => PerformanceObserver.supportedEntryTypes.includes('event')),
    ).toBe(true);
    await page.getByRole('button', { name: 'Increase load' }).click();
    await page.getByRole('button', { name: 'Decrease reps' }).click();
    await page.getByRole('radio', { name: '3' }).check();
    await page.getByRole('spinbutton', { name: 'Load' }).focus();
    await page.keyboard.press('ArrowUp');
    await page.getByRole('button', { name: 'What is RIR?' }).click();
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Log set' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Rest' })).toBeFocused();
    // Let the last interaction's next paint be reported.
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 100))),
    );
    const events = await page.evaluate(
      () => (window as unknown as { __events: { name: string; duration: number }[] }).__events,
    );
    const worst = Math.max(0, ...events.map((event) => event.duration));
    testInfo.annotations.push({
      type: 'INP (lab, 4x CPU)',
      description: `${worst} ms over ${events.length} reported events`,
    });
    expect(worst).toBeLessThan(200);
  });
});

test.describe('budget (performance.budget.moderate)', () => {
  const STATIC = join(__dirname, '..', '.next', 'static');

  function files(directory: string): string[] {
    if (!existsSync(directory)) return [];
    return readdirSync(directory).flatMap((entry) => {
      const path = join(directory, entry);
      return statSync(path).isDirectory() ? files(path) : [path];
    });
  }

  test('all shipped CSS is at most 50 KB compressed', () => {
    const css = files(STATIC).filter((file) => file.endsWith('.css'));
    expect(css.length).toBeGreaterThan(0);
    const total = css.reduce((sum, file) => sum + gzipSync(readFileSync(file)).length, 0);
    expect(total).toBeLessThanOrEqual(50_000);
  });

  test('no font file ships: the system stack needs none', () => {
    expect(files(STATIC).filter((file) => /\.(woff2?|ttf|otf|eot)$/.test(file))).toEqual([]);
  });
});
