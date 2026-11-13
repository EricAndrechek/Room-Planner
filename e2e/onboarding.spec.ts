import { expect, test, type Page } from '@playwright/test';
import { openStep } from './ui';

/** Wait for the island to mount and for the initial auto-fit zoom (500ms) to settle. */
async function ready(page: Page) {
  await page.waitForSelector('html[data-planner-ready]');
  await page.waitForTimeout(700);
}

test('a fresh visitor sees a clean sample room, and can clear it and undo', async ({ page }) => {
  await page.goto('/');
  await ready(page);

  // No collision / out-of-bounds warnings on the default layout.
  await expect(page.getByText(/Overlapping|Outside room/)).toHaveCount(0);

  await openStep(page, 'furniture');
  await expect(page.getByRole('button', { name: /^Bed,/ })).toBeVisible();

  await page.getByRole('button', { name: 'Clear room' }).click();
  await expect(page.getByText(/Remove all \d+ items\?/)).toBeVisible();
  // Cancel keeps everything.
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('button', { name: /^Bed,/ })).toBeVisible();

  await page.getByRole('button', { name: 'Clear room' }).click();
  await page.getByRole('button', { name: 'Clear all' }).click();
  await expect(page.getByRole('button', { name: /^Bed,/ })).toHaveCount(0);
  await expect(page.getByText('No furniture added.')).toBeVisible();

  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByRole('button', { name: /^Bed,/ })).toBeVisible();
});

test('existing users keep their stored furniture', async ({ page }) => {
  await page.goto('/');
  await ready(page);
  await page.evaluate(() =>
    localStorage.setItem(
      'room-sim-v3-items',
      JSON.stringify([
        { id: 9, label: 'Sofa', width: 6, height: 3, x: 1, y: 1, rotation: 0, color: '#93c5fd' },
      ]),
    ),
  );
  await page.reload();
  await ready(page);
  await expect(page.getByRole('button', { name: /^Sofa,/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Bed,/ })).toHaveCount(0);
});
