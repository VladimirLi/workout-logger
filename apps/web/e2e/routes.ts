import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';

/**
 * What the browser gates cover.
 *
 * Product routes are served by the production Next.js build. Components, patterns, states, and
 * reference screens live only in the Storybook lab (ADR-0010), served from its static build.
 */
export const SHELL_ROUTES = ['/', '/offline', '/today', '/workout'] as const;

/**
 * The heading each route settles on, for the routes that read the device before they can show
 * anything.
 *
 * Without this a screenshot races the skeleton: the store read resolves after the page is
 * otherwise idle, so the capture could catch the delayed skeleton, the content, or the gap
 * between them - three different pictures of a correct page. `openRoute` waits for the
 * settled state, which is also the state worth reviewing.
 */
const SETTLED: Partial<Record<(typeof SHELL_ROUTES)[number], string>> = {
  '/today': 'No plan on this device yet',
  '/workout': 'No workout in progress',
};

/** Opens a product route and waits until it has finished reading the device. */
export async function openRoute(page: Page, route: (typeof SHELL_ROUTES)[number]): Promise<void> {
  await page.goto(route);
  const heading = SETTLED[route];
  if (heading) await page.getByRole('heading', { name: heading }).waitFor({ state: 'visible' });
}

export const STORYBOOK_URL = process.env.STORYBOOK_URL ?? 'http://127.0.0.1:6106';

export interface StoryEntry {
  readonly id: string;
  readonly title: string;
  readonly name: string;
}

export function stories(): readonly StoryEntry[] {
  const index = JSON.parse(
    readFileSync(join(__dirname, '..', 'storybook-static', 'index.json'), 'utf8'),
  ) as { entries: Record<string, StoryEntry & { type: string }> };
  return Object.values(index.entries)
    .filter((entry) => entry.type === 'story')
    .map(({ id, title, name }) => ({ id, title, name }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

export const isReferenceScreen = (story: StoryEntry) =>
  story.title.startsWith('Reference screens/');

/** Reference screens by name, so a test reads as what it checks. */
export const SCREEN = {
  plan: 'reference-screens-plan--default',
  setFocus: 'reference-screens-set-focus--default',
  rirHelp: 'reference-screens-rir-help--default',
  rest: 'reference-screens-rest--default',
  summary: 'reference-screens-workout-summary--default',
  history: 'reference-screens-history--default',
  settings: 'reference-screens-settings--default',
  empty: 'reference-screens-empty-history--default',
  error: 'reference-screens-sync-error--default',
  proposalReview: 'reference-screens-proposal-review--default',
  proposalStale: 'reference-screens-stale-proposal--default',
  stateMatrix: 'reference-screens-state-matrix--default',
} as const;

export function storyUrl(id: string, theme: 'light' | 'dark' = 'light'): string {
  return `${STORYBOOK_URL}/iframe.html?id=${id}&viewMode=story&globals=theme:${theme}`;
}

/** Opens a story and waits until it has rendered, or shown Storybook's error display. */
export async function openStory(page: Page, id: string, theme: 'light' | 'dark' = 'light') {
  await page.goto(storyUrl(id, theme));
  await page.waitForFunction(
    () =>
      !document.body.classList.contains('sb-show-preparing-story') &&
      (document.body.classList.contains('sb-show-errordisplay') ||
        (document.querySelector('#storybook-root')?.childElementCount ?? 0) > 0),
  );
}
