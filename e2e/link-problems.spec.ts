import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { storedDims, storedPlans } from './storage';
import { isNarrow } from './ui';

// Links this build cannot open (docs/design/plan-format.md, section 4): a plan from a newer Room
// Planner, and a damaged link. Neither is loaded or written; the URL stays as it is.

const b64url = (text: string) =>
  Buffer.from(text, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
const NEWER = `/#j=${b64url(JSON.stringify([5, 'From the future', 'ft', 0, [[[0, 0, 9, 0, 9, 9, 0, 9]]]]))}`;

async function open(page: Page, path: string) {
  await page.goto(path);
  await page.waitForSelector('html[data-planner-ready]');
}

/** Names of the saved plans (a first visit may autosave the starter plan; nothing else). */
const savedNames = async (page: Page) => (await storedPlans(page)).map((p) => p.plan.name);
const expectNothingFromTheLink = async (page: Page) => {
  const names = await savedNames(page);
  expect(names).not.toContain('From the future');
  expect(names).not.toContain('Shared Floor Plan');
  expect(await storedDims(page)).not.toEqual({ width: 9, height: 9 });
};

test('a plan from a newer Room Planner asks for an update and changes nothing', async ({
  page,
}) => {
  await open(page, NEWER);
  const dialog = page.getByRole('dialog', { name: 'This plan needs a newer Room Planner' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Update' })).toBeVisible();
  expect(new URL(page.url()).hash).toBe(NEWER.slice(1));
  await expectNothingFromTheLink(page);
  await dialog.getByRole('button', { name: 'Not now' }).click();
  await expect(dialog).toBeHidden();
  // The user's own (starter) plan is open behind it.
  await expect(page.getByTestId('room')).toBeVisible();
  expect(new URL(page.url()).hash).toBe(NEWER.slice(1));
});

test('Update reloads, and the link is still there to open', async ({ page }) => {
  await open(page, NEWER);
  const dialog = page.getByRole('dialog', { name: 'This plan needs a newer Room Planner' });
  await expect(dialog).toBeVisible();
  await Promise.all([
    page.waitForEvent('load'),
    dialog.getByRole('button', { name: 'Update' }).click(),
  ]);
  await page.waitForSelector('html[data-planner-ready]');
  expect(new URL(page.url()).hash).toBe(NEWER.slice(1));
  // This build is still too old for it, so it asks again.
  await expect(
    page.getByRole('dialog', { name: 'This plan needs a newer Room Planner' }),
  ).toBeVisible();
});

test('a damaged link says so and opens the plan the user already has', async ({ page }) => {
  await open(page, '/#s=AAAA');
  const dialog = page.getByRole('dialog', { name: 'This link is damaged' });
  await expect(dialog).toBeVisible();
  await expectNothingFromTheLink(page);
  await dialog.getByRole('button', { name: 'OK' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId('room')).toBeVisible();
});

test('the link dialogs have no serious axe violations', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const path of [NEWER, '/?config=']) {
    await open(page, path);
    await expect(page.getByTestId('link-problem')).toBeVisible();
    const r = await new AxeBuilder({ page })
      .include('[data-testid="link-problem"]')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();
    const serious = r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(serious.map((v) => v.id)).toEqual([]);
  }
});

test('the JSON box refuses a newer plan with the reason', async ({ page }) => {
  test.skip(isNarrow(page), 'the Share dialog is reached the same way; one viewport is enough');
  await open(page, '/');
  await page.getByRole('button', { name: 'Share / Save' }).click();
  const dialog = page.getByRole('dialog', { name: 'Share & Save Layout' });
  await dialog
    .getByPlaceholder('Paste your JSON config here...')
    .fill(JSON.stringify({ version: 5, unit: 'ft', rooms: [] }));
  await dialog.getByRole('button', { name: 'Load Configuration' }).click();
  await expect(
    dialog.getByText('This plan was made with a newer version of Room Planner.'),
  ).toBeVisible();
});
