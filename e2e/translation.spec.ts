import { expect, test, type Page } from '@playwright/test';
import { openStep, showEditor, viewPlan } from './ui';

// Browser page translation (Chrome, Edge, Google Translate) swaps the text React rendered for
// <font> wrappers. Before the guard (src/lib/translationGuard.ts) the next update that removed or
// inserted next to such text threw "removeChild/insertBefore: not a child" and the planner fell
// over: 10 of 38 non-English sessions in the first days after launch, none in English. This drives
// the planner through ordinary edits under a simulated translator and expects nothing to break.

/**
 * Translate the page the way Chrome does: mark <html>, then replace every visible text node in the
 * planner with <font><font>translated text</font></font> (the original node leaves the DOM), and
 * keep doing that to text React adds later. `moveOriginal` keeps the original node inside the
 * wrapper instead, as some translators do.
 */
async function translatePage(page: Page, moveOriginal = false) {
  await page.evaluate((move) => {
    const html = document.documentElement;
    html.classList.add('translated-ltr');
    html.lang = 'es';
    const skip = (n: Node) =>
      !n.parentElement ||
      !n.nodeValue?.trim() ||
      !!n.parentElement.closest('script, style, textarea, input, font, [translate="no"]');
    const wrap = (text: Text) => {
      const outer = document.createElement('font');
      const inner = document.createElement('font');
      outer.appendChild(inner);
      text.parentNode!.insertBefore(outer, text);
      if (move) inner.appendChild(text);
      else {
        // New nodes with the "translated" text (the same words, so the test can still find
        // controls by name); the original node leaves the DOM.
        inner.textContent = text.nodeValue;
        text.remove();
      }
    };
    const translateUnder = (root: Node) => {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      const found: Text[] = [];
      for (let n = walker.nextNode(); n; n = walker.nextNode()) if (!skip(n)) found.push(n as Text);
      found.forEach(wrap);
    };
    const app = document.getElementById('app')!;
    translateUnder(app);
    // A translator keeps translating what appears later (it watches the page), a moment later.
    new MutationObserver((records) => {
      setTimeout(() => {
        for (const r of records) {
          if (r.type === 'characterData' && r.target.isConnected && !skip(r.target)) {
            wrap(r.target as Text);
          }
          r.addedNodes.forEach((n) => n.isConnected && translateUnder(n));
        }
      }, 0);
    }).observe(app, { childList: true, subtree: true, characterData: true });
  }, moveOriginal);
}

/** Record captures (the PostHog SDK stays off under automation) and every page error. */
async function watch(page: Page) {
  await page.addInitScript(() => {
    const events: [string, Record<string, unknown> | undefined][] = [];
    (window as unknown as { __events: typeof events }).__events = events;
    (window as unknown as { posthog: unknown }).posthog = {
      __SV: 1,
      capture: (name: string, props?: Record<string, unknown>) => events.push([name, props]),
      captureException: (e: unknown) => events.push(['$exception', { message: String(e) }]),
    };
  });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && /not a child|NotFoundError/.test(m.text())) errors.push(m.text());
  });
  return errors;
}

const events = (page: Page) =>
  page.evaluate(
    () =>
      (window as unknown as { __events: [string, Record<string, unknown> | undefined][] }).__events,
  );

/** Edits that add, remove and re-order translated text: modes, doors, pieces, units, undo. */
async function exercise(page: Page) {
  await openStep(page, 'room');
  await page.getByRole('button', { name: 'Add Door' }).click();
  const types = page.getByRole('combobox', { name: /^Door \d+ type$/ });
  await types.last().selectOption('pocket');
  await types.last().selectOption('double-in');
  await page.getByRole('button', { name: 'Delete door' }).last().click();
  await openStep(page, 'furniture');
  await page.getByRole('button', { name: 'Add Item' }).click();
  await page.getByRole('button', { name: 'Add Item' }).click();
  await viewPlan(page);
  await page.getByRole('button', { name: /^Bed,/ }).click();
  await page.getByRole('button', { name: /^Desk,/ }).click();
  await page.keyboard.press('Escape');
  await showEditor(page);
  await page.getByRole('button', { name: 'Undo' }).click();
  await page.getByRole('button', { name: 'Undo' }).click();
  await page.getByRole('button', { name: 'Redo' }).click();
  await page.locator('#unit-system').selectOption('m');
  await page.locator('#unit-system').selectOption('ft-in');
  await openStep(page, 'room');
  await openStep(page, 'furniture');
}

for (const moveOriginal of [false, true]) {
  test(`edits under page translation never throw (${moveOriginal ? 'original moved into the wrapper' : 'original replaced'})`, async ({
    page,
  }) => {
    const errors = await watch(page);
    await page.goto('/');
    await page.waitForSelector('html[data-planner-ready]');
    await translatePage(page, moveOriginal);
    await exercise(page);

    expect(errors).toEqual([]);
    await expect(page.getByText('Something went wrong')).toHaveCount(0);
    const got = await events(page);
    expect(got.filter(([e]) => e === '$exception')).toEqual([]);
    // Still a working planner: the item added (and redone) is on the plan.
    await expect(page.getByRole('button', { name: /^New Item,/ })).toHaveCount(1);
    // Translation is noted once, with its language only.
    const detected = got.filter(([e]) => e === 'translation_detected');
    expect(detected).toHaveLength(1);
    expect(detected[0]![1]).toEqual({ lang: 'es', via: expect.stringMatching(/^(class|dom)$/) });
  });
}

test('translation stays on for the UI; only measurements are marked translate="no"', async ({
  page,
}) => {
  await page.goto('/');
  await page.waitForSelector('html[data-planner-ready]');
  // The page as a whole is translatable.
  expect(await page.locator('html').getAttribute('translate')).toBeNull();
  await expect(page.locator('meta[name="google"][content="notranslate"]')).toHaveCount(0);
  await expect(page.locator('#app [translate="no"]').first()).toBeAttached();
  // What is marked is short (sizes and units), never whole panels.
  const marked = await page
    .locator('#app [translate="no"]')
    .evaluateAll((els) => els.map((e) => (e.textContent ?? '').trim().length));
  expect(Math.max(...marked)).toBeLessThan(40);
});
