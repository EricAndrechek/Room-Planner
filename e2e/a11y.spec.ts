import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { animationsSettled, openStep, setDetent, viewPlan } from './ui';

/** Wait for the island to mount and the initial auto-fit zoom to settle. */
async function ready(page: Page) {
  await page.waitForSelector('html[data-planner-ready]');
  await page.waitForTimeout(700);
}

/** Zero serious/critical axe violations (WCAG 2.x A/AA + best practices). */
async function expectNoSeriousViolations(page: Page) {
  // Contrast is judged on final colors: a scan taken mid fade-in sees blended, washed-out ones.
  await animationsSettled(page);
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'])
    .analyze();
  const serious = results.violations.filter(
    (v) => v.impact === 'serious' || v.impact === 'critical',
  );
  const summary = serious.map(
    (v) =>
      `${v.id} (${v.impact}): ${v.nodes.length} node(s)\n` +
      v.nodes
        .slice(0, 4)
        .map((n) => `   ${n.target.join(' ')}\n   ${n.failureSummary?.split('\n')[1] ?? ''}`)
        .join('\n'),
  );
  expect(summary, summary.join('\n')).toEqual([]);
}

for (const [name, viewport] of [
  ['desktop', { width: 1280, height: 800 }],
  ['mobile 390x844', { width: 390, height: 844 }],
] as const) {
  test.describe(name, () => {
    // Reduced motion makes entrance animations (dialogs, the "Ready to work offline" toast that can
    // pop up at any moment once the service worker is installed) effectively instant, so a scan
    // never samples a half-faded element. The scans judge the settled UI, which is the same.
    test.use({ viewport, reducedMotion: 'reduce' });

    test('planner page has no serious violations', async ({ page }) => {
      await page.goto('/');
      await ready(page);
      await expectNoSeriousViolations(page);
    });

    test('the phone editor sheet at peek, half and full has no serious violations', async ({
      page,
    }) => {
      test.skip(viewport.width >= 768, 'phones get the bottom sheet');
      await page.goto('/');
      await ready(page);
      for (const detent of ['peek', 'half', 'full'] as const) {
        await setDetent(page, detent);
        await expectNoSeriousViolations(page);
      }
      // A piece selected, collapsed: its summary and the Edit action.
      await setDetent(page, 'peek');
      await page.getByRole('button', { name: /^Chair,/ }).click();
      await setDetent(page, 'peek');
      await expect(page.getByTestId('sheet-action')).toHaveText('Edit');
      await expectNoSeriousViolations(page);
    });

    test('planner with a dialog open has no serious violations', async ({ page }) => {
      await page.goto('/');
      await ready(page);
      await page.getByRole('button', { name: 'Share / Save' }).click();
      await expect(page.getByRole('dialog')).toBeVisible();
      // "Open on another device": the QR code on wide screens, Share… / email on phones.
      await expect(page.locator('#share-url')).toHaveValue(/#s=/);
      if (viewport.width >= 768) await expect(page.getByTestId('handoff-qr')).toBeVisible();
      await expectNoSeriousViolations(page);
    });

    test('room setup: locked-piece notice, wall controls and a size error have no serious violations', async ({
      page,
    }) => {
      await page.addInitScript(() => {
        if (sessionStorage.getItem('seeded')) return;
        sessionStorage.setItem('seeded', '1');
        localStorage.setItem('room-sim-v3-mode', 'room-setup');
        localStorage.setItem('room-sim-v3-dims', JSON.stringify({ width: 12, height: 12 }));
      });
      await page.goto('/');
      await ready(page);
      await page.getByRole('button', { name: /^Desk,/ }).click();
      await expect(page.getByTestId('app-notice')).toBeVisible();
      await expectNoSeriousViolations(page);

      await openStep(page, 'room');
      await expect(page.getByRole('radiogroup', { name: 'Door 1 wall' })).toBeVisible();
      const width = page.getByLabel('Room width');
      await width.fill('600');
      await width.press('Enter');
      await expect(width).toHaveAttribute('aria-invalid', 'true');
      await expectNoSeriousViolations(page);

      // An unusually large size: the "did you mean?" prompt.
      await width.fill('117');
      await width.press('Enter');
      await expect(page.getByTestId('dimension-confirm')).toBeVisible();
      await expectNoSeriousViolations(page);
      await page.keyboard.press('Escape');

      // Shrinking strands pieces: the "Move them inside" notice.
      await width.fill('6');
      await width.press('Enter');
      await expect(page.getByTestId('app-notice')).toContainText('outside the room');
      await expectNoSeriousViolations(page);
    });

    test('the New plan menu has no serious violations', async ({ page }) => {
      test.skip(viewport.width < 640, 'phones start new plans from My Floor Plans');
      await page.goto('/');
      await ready(page);
      await page.getByRole('button', { name: 'New plan', exact: true }).click();
      await expect(page.getByTestId('new-plan-menu')).toBeVisible();
      await expectNoSeriousViolations(page);
    });

    test('planner with the Export dialog open has no serious violations', async ({ page }) => {
      await page.goto('/');
      await ready(page);
      await page.getByRole('button', { name: 'Export as image or PDF' }).click();
      // Found by its heading, not getByRole('dialog', { name }): in Playwright's Firefox, resolving a
      // dialog's aria-labelledby name and then running axe's aria-dialog-name rule crashes the page
      // (reproduces on a one-line static page; not an app bug).
      const dialog = page
        .getByRole('dialog')
        .filter({ has: page.getByRole('heading', { name: 'Export Floor Plan' }) });
      await expect(dialog).toBeVisible();
      await expectNoSeriousViolations(page);
    });

    test('planner with the Clear room confirmation has no serious violations', async ({ page }) => {
      await page.goto('/');
      await ready(page);
      await openStep(page, 'furniture');
      await page.getByRole('button', { name: 'Clear room' }).click();
      await expect(page.getByRole('alert').filter({ hasText: /Remove all/ })).toBeVisible();
      await expectNoSeriousViolations(page);
    });

    test('planner mid-drag (guides and measurements showing) has no serious violations', async ({
      page,
      isMobile,
    }) => {
      await page.goto('/');
      await ready(page);
      await openStep(page, 'furniture');
      await viewPlan(page);
      const chair = (await page.getByRole('button', { name: /^Chair,/ }).boundingBox())!;
      const x = chair.x + chair.width / 2;
      const y = chair.y + chair.height / 2;
      if (isMobile) {
        await page.evaluate(
          ({ x, y }) => {
            const o = (cx: number, cy: number) => ({
              bubbles: true,
              pointerId: 5,
              pointerType: 'touch',
              isPrimary: true,
              clientX: cx,
              clientY: cy,
              buttons: 1,
            });
            document
              .querySelector('[aria-label^="Chair,"]')!
              .dispatchEvent(new PointerEvent('pointerdown', o(x, y)));
            window.dispatchEvent(new PointerEvent('pointermove', o(x - 30, y + 5)));
          },
          { x, y },
        );
      } else {
        await page.mouse.move(x, y);
        await page.mouse.down();
        await page.mouse.move(x - 30, y + 5, { steps: 5 });
      }
      await expect(page.getByTestId('snap-overlay')).toHaveAttribute('data-dragging', 'true');
      await expect(page.getByTestId('measurement').first()).toBeVisible();
      await expectNoSeriousViolations(page);
      if (!isMobile) await page.mouse.up();
    });

    test('planner with the keyboard shortcuts panel open has no serious violations', async ({
      page,
    }) => {
      await page.goto('/');
      await ready(page);
      await page.keyboard.press('?');
      // Found by its heading (see the Export dialog test above for why not by name).
      const dialog = page
        .getByRole('dialog')
        .filter({ has: page.getByRole('heading', { name: 'Keyboard shortcuts' }) });
      await expect(dialog).toBeVisible();
      await expectNoSeriousViolations(page);
    });

    test('help page has no serious violations', async ({ page }) => {
      await page.goto('/help/');
      await expectNoSeriousViolations(page);
    });

    for (const path of [
      '/faq/',
      '/agents/',
      '/guides/',
      '/guides/bedroom-layout/',
      '/guides/living-room-layout/',
      '/guides/studio-and-dorm-layout/',
      '/guides/home-office-layout/',
    ]) {
      test(`${path} has no serious violations`, async ({ page }) => {
        await page.goto(path);
        await expectNoSeriousViolations(page);
      });
    }

    test('404 page has no serious violations', async ({ page }) => {
      await page.goto('/404');
      await expectNoSeriousViolations(page);
    });
  });
}

test('furniture can be selected, moved, rotated, undone and removed with the keyboard only', async ({
  page,
}) => {
  await page.goto('/');
  await ready(page);
  const items = () =>
    page.evaluate(() => JSON.parse(localStorage.getItem('room-sim-v3-items') ?? '[]'));
  const itemOf = async () => (await items()).find((i: { label: string }) => i.label === 'New Item');

  // Set up one piece (setup itself is mouse-free: Tab + Enter would work, click is just shorter).
  await openStep(page, 'furniture');
  await page.getByRole('button', { name: 'Add Item' }).click(); // closes the sheet on phones
  const piece = page.getByRole('button', { name: /^New Item,/ });
  await expect(piece).toBeVisible();
  const start = await itemOf();

  // Skip link jumps to the canvas; Tab then reaches the piece.
  await page.getByRole('link', { name: 'Skip to floor plan' }).focus();
  await page.keyboard.press('Enter');
  for (let i = 0; i < 10 && !(await piece.evaluate((el) => el === document.activeElement)); i++) {
    await page.keyboard.press('Tab');
  }
  await expect(piece).toBeFocused();
  await expect(piece).toHaveAttribute('aria-pressed', 'true');
  // Visible focus indicator.
  const outline = await piece.evaluate((el) => getComputedStyle(el).outlineStyle);
  expect(outline).toBe('solid');
  await expect(piece).toHaveAccessibleName(/^New Item, .* by .*, at .*, rotated 0°$/);

  // Arrow = 0.25 ft, Shift+arrow = 1 ft.
  await page.keyboard.press('ArrowRight');
  await expect.poll(async () => (await itemOf()).x).toBeCloseTo(start.x + 0.25, 5);
  await page.keyboard.press('Shift+ArrowDown');
  await expect.poll(async () => (await itemOf()).y).toBeCloseTo(start.y + 1, 5);
  await expect(piece).toBeFocused();
  await expect(piece).toHaveAccessibleName(/at 4 ft 9 in, 6 ft 0 in|rotated 0°/);

  // Rotate both ways.
  await page.keyboard.press('r');
  await expect.poll(async () => (await itemOf()).rotation).toBe(90);
  await expect(piece).toHaveAccessibleName(/rotated 90°$/);
  await page.keyboard.press('Shift+R');
  await expect.poll(async () => (await itemOf()).rotation).toBe(0);
  await page.keyboard.press('r');
  await expect.poll(async () => (await itemOf()).rotation).toBe(90);
  // Alt/Option+R: 1 degree at a time (Shift: the other way).
  await page.keyboard.press('Alt+r');
  await expect.poll(async () => (await itemOf()).rotation).toBe(91);
  await page.keyboard.press('Alt+Shift+R');
  await expect.poll(async () => (await itemOf()).rotation).toBe(90);

  // Undo steps back through the rotation, and the live region announces it (debounced). Record
  // every text the region shows: a later announcement ("Project saved") can replace it quickly.
  await page.evaluate(() => {
    const region = document.querySelector('[role="status"][aria-atomic="true"]')!;
    const said: string[] = ((window as unknown as { __said: string[] }).__said = []);
    new MutationObserver(() => said.push(region.textContent ?? '')).observe(region, {
      childList: true,
      characterData: true,
      subtree: true,
    });
  });
  await page.keyboard.press('ControlOrMeta+z');
  await page.keyboard.press('ControlOrMeta+z');
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(async () => (await itemOf()).rotation).toBe(0);
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __said: string[] }).__said.join(' | ')))
    .toMatch(/Undo/);

  // Escape deselects and moves focus off the piece onto the canvas.
  await page.keyboard.press('Escape');
  await expect(piece).toHaveAttribute('aria-pressed', 'false');
  await expect(piece).not.toBeFocused();

  // Canvas shortcuts do nothing while focus is on a control outside the canvas, even with the
  // piece selected: arrows, R, Delete and Escape belong to the canvas.
  await piece.focus();
  const before = await itemOf();
  const outside = page.getByRole('button', { name: 'Open file browser' });
  await outside.focus();
  for (const key of ['ArrowRight', 'r', 'Delete', 'Escape']) await page.keyboard.press(key);
  await expect(outside).toBeFocused();
  expect(await itemOf()).toEqual(before);
  await expect(piece).toHaveAttribute('aria-pressed', 'true');

  // Delete removes it (and undo brings it back).
  await piece.focus();
  await page.keyboard.press('Delete');
  await expect(piece).toHaveCount(0);
  await page.keyboard.press('ControlOrMeta+z');
  await expect(page.getByRole('button', { name: /^New Item,/ })).toBeVisible();
});

test('modal traps focus, closes on Escape and returns focus to its trigger', async ({ page }) => {
  await page.goto('/');
  await ready(page);
  const trigger = page.getByRole('button', { name: 'Share / Save' });
  await trigger.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Share & Save Layout' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute('aria-modal', 'true');
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press('Tab');
    expect(await dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true);
  }
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test('door handles are keyboard operable in room setup', async ({ page }) => {
  await page.goto('/');
  await ready(page);
  await openStep(page, 'room');
  await page.getByRole('button', { name: 'Add Door' }).click();
  await viewPlan(page);
  const handle = page.getByRole('button', { name: /^Door handle/ }).first();
  await handle.focus();
  const before = await handle.getAttribute('aria-label');
  await page.keyboard.press('Shift+ArrowRight');
  await expect(handle).not.toHaveAttribute('aria-label', before!);

  // Delete removes the focused door, announced, and undo brings it back.
  const doors = page.getByRole('button', { name: /^Door handle/ });
  const count = await doors.count();
  // Record everything the live region says: an autosave's "Project saved" can follow quickly.
  await page.evaluate(() => {
    const region = document.querySelector('[role="status"][aria-atomic="true"]')!;
    const said: string[] = [];
    (window as unknown as { __said: string[] }).__said = said;
    new MutationObserver(() => said.push(region.textContent ?? '')).observe(region, {
      childList: true,
      characterData: true,
      subtree: true,
    });
  });
  await page.keyboard.press('Delete');
  await expect(doors).toHaveCount(count - 1);
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __said: string[] }).__said.join(' | ')))
    .toMatch(/Door \d+ removed/);
  await page.keyboard.press('ControlOrMeta+z');
  await expect(doors).toHaveCount(count);
});

test('tooltips show on keyboard focus and close on Escape', async ({ page }) => {
  await page.goto('/');
  await ready(page);
  // Keyboard focus (WebKit does not Tab to buttons by default, so focus it after a key press:
  // script focus that follows keyboard use counts as keyboard focus, i.e. :focus-visible).
  await page.keyboard.press('Shift');
  await page.getByRole('button', { name: 'Open file browser' }).focus();
  await expect(page.getByRole('button', { name: 'Open file browser' })).toBeFocused();
  const tip = page.getByRole('tooltip');
  await expect(tip).toHaveText('My Floor Plans');
  await page.keyboard.press('Escape');
  await expect(tip).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Open file browser' })).toBeFocused();
});

test('page structure: the plan name heading is not inside a button; labels name their fields', async ({
  page,
}) => {
  await page.goto('/');
  await ready(page);
  const heading = page.getByRole('heading', { level: 1 });
  await expect(heading).toBeVisible();
  expect(await heading.evaluate((h) => h.closest('button, [role="button"]'))).toBeNull();
  // Renaming still works from its own button.
  await page.getByRole('button', { name: 'Rename floor plan' }).click();
  await expect(page.getByLabel('Floor plan name')).toBeFocused();
  await page.getByLabel('Floor plan name').press('Escape');

  // Visible labels are associated with their inputs (clicking one focuses its field).
  await openStep(page, 'furniture');
  const card = page.getByTestId('furniture-card').first();
  const label = card.locator('label', { hasText: /^Depth$/ });
  const id = await label.getAttribute('for');
  expect(id).toBeTruthy();
  const field = card.locator(`[id="${id}"]`);
  await expect(field).toHaveAccessibleName(/^Depth of /);
  await label.click();
  await expect(field).toBeFocused();
  // Ids are unique across cards.
  const ids = await page
    .locator('[data-testid="furniture-card"] label[for]')
    .evaluateAll((ls) => ls.map((l) => l.getAttribute('for')));
  expect(new Set(ids).size).toBe(ids.length);
});

test('desktop color popover is a modal dialog that follows the sidebar in reading order', async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, 'phones get a bottom sheet');
  await page.goto('/');
  await ready(page);
  await openStep(page, 'furniture');
  await page.locator('[data-color-button]').first().click();
  const dialog = page.getByRole('dialog', { name: 'Choose color' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute('aria-modal', 'true');
  expect(await dialog.evaluate((d) => !!d.closest('[data-popover-root]'))).toBe(true);
  // Positioned under its trigger, on screen.
  const trigger = (await page.locator('[data-color-button]').first().boundingBox())!;
  const box = (await dialog.boundingBox())!;
  const below = Math.abs(box.y - (trigger.y + trigger.height + 4));
  const above = Math.abs(box.y + 280 - (trigger.y - 4)); // flipped above when there is no room
  expect(Math.min(below, above)).toBeLessThan(2);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
});

test('toasts live in a polite region that is always present (so they are announced)', async ({
  page,
}) => {
  await page.goto('/');
  await ready(page);
  const dock = page.getByTestId('pwa-toast-dock');
  await expect(dock).toHaveAttribute('role', 'status');
  await expect(dock).toHaveAttribute('aria-live', 'polite');
});

test("? opens the keyboard shortcuts, grouped, with this keyboard's keys; Escape closes it", async ({
  page,
  isMobile,
}) => {
  await page.goto('/');
  await ready(page);
  await openStep(page, 'furniture');
  await viewPlan(page);
  const piece = page.getByRole('button', { name: /^Bed,/ });
  await piece.focus();
  await page.keyboard.press('?');
  const dialog = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
  await expect(dialog).toBeVisible();
  for (const group of ['Move', 'Rotate', 'Edit', 'View']) {
    await expect(dialog.getByRole('heading', { name: group })).toBeVisible();
  }
  // The same detection as the app (the emulated device's userAgentData wins over navigator.platform).
  const mac = await page.evaluate(() => {
    const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
    return /mac|iphone|ipad|ipod/i.test(nav.userAgentData?.platform || nav.platform || '');
  });
  const undo = dialog
    .locator('div')
    .filter({ has: page.getByText('Undo', { exact: true }) })
    .last();
  await expect(undo.locator('kbd').first()).toHaveText(mac ? '⌘' : 'Ctrl');
  // Canvas keys do nothing while the panel is open.
  await page.keyboard.press('Delete');
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(piece).toBeFocused();
  await expect(piece).toHaveCount(1);

  if (!isMobile) {
    // Also from the top bar, whose Undo/Redo tooltips show their keys.
    await page.getByRole('button', { name: 'Keyboard shortcuts' }).click();
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    // Something to undo, so the button is enabled (a disabled one gets no hover in Chromium).
    await piece.focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('button', { name: 'Undo' })).toBeEnabled();
    await page.getByRole('button', { name: 'Undo' }).hover();
    await expect(page.getByRole('tooltip').filter({ hasText: /^Undo/ })).toHaveText(
      mac ? 'Undo (⌘Z)' : 'Undo (Ctrl+Z)',
    );
  }
});
