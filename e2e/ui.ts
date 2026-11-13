import type { Page } from '@playwright/test';

/** Below `md` (768px) the sidebar is an off-canvas sheet, opened from a floating button. */
export const isNarrow = (page: Page): boolean => (page.viewportSize()?.width ?? 1280) < 768;

/**
 * Show the sidebar on the given design step, on any layout: on narrow screens open the sheet
 * first. The step buttons read "1. Room Setup" / "2. Furniture", or "1. Room" / "2. Items" on
 * phones.
 */
export async function openStep(page: Page, step: 'room' | 'furniture'): Promise<void> {
  if (isNarrow(page)) {
    await page.getByRole('button', { name: /^Edit (room settings|furniture)$/ }).click();
  }
  await page
    .getByRole('button', { name: step === 'room' ? /^1\. Room/ : /^2\. (Furniture|Items)$/ })
    .click();
}

/** On narrow screens, close the sidebar sheet to see the floor plan again (no-op otherwise). */
export async function viewPlan(page: Page): Promise<void> {
  const view = page.getByRole('button', { name: 'View floor plan' });
  if (isNarrow(page) && (await view.isVisible())) await view.click();
}

/**
 * Resolve once every finite CSS animation/transition on the page has finished (dialog fade and
 * slide-in, toasts, the mobile sheet), so colors and positions are final. Infinite ones (spinners)
 * are ignored.
 */
export async function animationsSettled(page: Page): Promise<void> {
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((a) => a.effect?.getComputedTiming().endTime !== Infinity)
        .map((a) => a.finished.catch(() => undefined)),
    ),
  );
}
