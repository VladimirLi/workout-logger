import type { Page } from '@playwright/test';

/** Ends the workout the way a person does: Finish workout, then confirm in the dialog. */
export async function finishWorkout(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Finish workout' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Finish workout' }).click();
}
