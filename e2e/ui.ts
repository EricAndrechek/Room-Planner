import { expect, type Page } from '@playwright/test';

/** Below `md` (768px) the sidebar is a bottom sheet over the plan (peek, half or full height). */
export const isNarrow = (page: Page): boolean => (page.viewportSize()?.width ?? 1280) < 768;

export type Detent = 'peek' | 'half' | 'full';

/** The phone sheet's current detent (`data-detent` on the sheet). */
export const sheetDetent = async (page: Page): Promise<Detent> =>
  (await page.getByTestId('sidebar').getAttribute('data-detent')) as Detent;

/** Phones: tap the sheet's handle (it cycles peek -> half -> full) until it is at `detent`. */
export async function setDetent(page: Page, detent: Detent): Promise<void> {
  for (let i = 0; i < 3 && (await sheetDetent(page)) !== detent; i++) {
    await page.getByRole('button', { name: 'Resize editor' }).click();
  }
  await expect(page.getByTestId('sidebar')).toHaveAttribute('data-detent', detent);
  // The sheet animates to its new height and the plan re-fits above it: wait for both.
  await animationsSettled(page);
}

/** Phones: make sure the sheet's controls are showing (half or full; a collapsed sheet opens). */
export async function showEditor(page: Page): Promise<void> {
  if (isNarrow(page) && (await sheetDetent(page)) === 'peek') await setDetent(page, 'half');
}

/**
 * Show the sidebar on the given design step, on any layout. The step buttons read
 * "1. Room Setup" / "2. Furniture", or "1. Room" / "2. Items" on phones.
 */
export async function openStep(page: Page, step: 'room' | 'furniture'): Promise<void> {
  await showEditor(page);
  await page
    .getByRole('button', { name: step === 'room' ? /^1\. Room/ : /^2\. (Furniture|Items)$/ })
    .click();
}

/** On narrow screens, collapse the sheet to see as much of the floor plan as possible. */
export async function viewPlan(page: Page): Promise<void> {
  if (isNarrow(page)) await setDetent(page, 'peek');
}

/**
 * Resolve once every finite CSS animation/transition on the page has finished (dialog fade and
 * slide-in, toasts, the mobile sheet), so colors and positions are final. Infinite ones (spinners)
 * are ignored.
 */
export async function animationsSettled(page: Page): Promise<void> {
  await page.evaluate(async () => {
    // Two frames first: a transition triggered by the last click (a step button's colors) only
    // exists once styles are recalculated; collected too early it would be missed.
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    await Promise.all(
      document
        .getAnimations()
        .filter((a) => a.effect?.getComputedTiming().endTime !== Infinity)
        .map((a) => a.finished.catch(() => undefined)),
    );
  });
}
