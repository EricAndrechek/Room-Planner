import { expect, test, type Page } from '@playwright/test';
import { animationsSettled, openStep, viewPlan } from './ui';
import { storedOpenings } from './storage';
import { seriousViolations } from './axe';

// Door types, opening angles, and furniture blocking doors (#27 follow-up).

const DOOR = { id: 1, width: 3, position: 4, wall: 'bottom', hinge: 'left', type: 'swing-in' };
const CHAIR = {
  id: 2,
  label: 'Chair',
  width: 1,
  height: 1,
  x: 5,
  y: 8.6, // in the 3 ft swing (up to 2.4 ft from the wall), not in the 1.5 ft doorway
  rotation: 0,
  color: '#fdba74',
  visible: true,
};

async function seed(page: Page, doors: object[], items: object[], mode = 'furniture') {
  await page.addInitScript(
    ({ doors, items, mode }) => {
      if (sessionStorage.getItem('seeded')) return;
      localStorage.clear();
      localStorage.setItem('room-sim-v3-dims', JSON.stringify({ width: 12, height: 12 }));
      localStorage.setItem('room-sim-v3-doors', JSON.stringify(doors));
      localStorage.setItem('room-sim-v3-windows', '[]');
      localStorage.setItem('room-sim-v3-items', JSON.stringify(items));
      localStorage.setItem('room-sim-v3-mode', mode);
      sessionStorage.setItem('seeded', '1');
    },
    { doors, items, mode },
  );
  await page.goto('/');
  await page.waitForSelector('html[data-planner-ready]');
  await page.waitForTimeout(700);
}

const badge = (page: Page) => page.getByTestId('door-block-badge');

test('furniture in a door swing is flagged "Blocks door", softer than an overlap', async ({
  page,
}) => {
  await seed(page, [DOOR], [CHAIR]);
  await expect(badge(page)).toHaveText('Blocks door');
  const chair = page.getByRole('button', { name: /^Chair,/ });
  await expect(chair).toHaveAccessibleDescription(/In a door's way/);
  // Amber and dashed, not the red overlap border.
  expect(await chair.evaluate((el) => getComputedStyle(el).borderTopStyle)).toBe('dashed');
  await openStep(page, 'furniture');
  await expect(page.getByTestId('card-door-block')).toHaveText('Blocks door');
});

test('an outward swing flags only its doorway, not its (outside) swing', async ({ page }) => {
  const inDoorway = { ...CHAIR, y: 11 };
  await seed(
    page,
    [{ ...DOOR, type: 'swing-out' }],
    [CHAIR, { ...inDoorway, id: 3, label: 'Stool' }],
  );
  await expect(badge(page)).toHaveCount(1);
  await expect(badge(page)).toHaveText('Blocks doorway');
  await expect(page.getByRole('button', { name: /^Stool,/ })).toHaveAccessibleDescription(
    /In a doorway/,
  );
  await expect(page.getByRole('button', { name: /^Chair,/ })).not.toHaveAccessibleDescription(
    /door/,
  );
});

test("a door's clearance lights up while a piece is dragged into it", async ({
  page,
  isMobile,
}) => {
  await seed(page, [DOOR], [{ ...CHAIR, y: 5 }]);
  await expect(badge(page)).toHaveCount(0);
  const room = (await page.getByTestId('room').boundingBox())!;
  const ppf = (room.width / (12 * 40 + 8)) * 40;
  const box = (await page.getByRole('button', { name: /^Chair,/ }).boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  // Move it 3.6 ft down, into the swing, and hold it there.
  await page.evaluate(
    async ({ x, y, dy, type }) => {
      const o = (cy: number, b: number) => ({
        bubbles: true,
        cancelable: true,
        pointerId: 4,
        pointerType: type,
        isPrimary: true,
        clientX: x,
        clientY: cy,
        button: 0,
        buttons: b,
      });
      document
        .querySelector('[aria-label^="Chair,"]')!
        .dispatchEvent(new PointerEvent('pointerdown', o(y, 1)));
      for (let i = 1; i <= 10; i++) {
        window.dispatchEvent(new PointerEvent('pointermove', o(y + (dy * i) / 10, 1)));
        await new Promise((r) => setTimeout(r, 16));
      }
      (window as unknown as { __up: () => void }).__up = () =>
        window.dispatchEvent(new PointerEvent('pointerup', o(y + dy, 0)));
    },
    { x, y, dy: 3.6 * ppf, type: isMobile ? 'touch' : 'mouse' },
  );
  await expect(page.locator('[data-door-swing][data-blocked="true"]')).toHaveCount(1);
  await expect(badge(page)).toHaveText('Blocks door');
  await page.evaluate(() => (window as unknown as { __up: () => void }).__up());
  await expect(page.locator('[data-door-swing][data-blocked="true"]')).toHaveCount(0);
  await expect(badge(page)).toHaveText('Blocks door'); // the warning stays after the drop
});

test('the door card offers every type, and the 90/180 angle only for swing doors', async ({
  page,
}) => {
  await seed(page, [DOOR], [], 'room-setup');
  await openStep(page, 'room');
  const card = page.getByTestId('door-card').first();
  const type = card.getByLabel('Door 1 type');
  await expect(type.locator('option')).toHaveText([
    'Swing in',
    'Swing out',
    'Double (French), in',
    'Double (French), out',
    'Sliding (bypass / barn)',
    'Pocket (slides into wall)',
    'Bi-fold',
    'Opening (no door)',
  ]);
  const angle = card.getByRole('radiogroup', { name: 'Door 1 opens' });
  await expect(angle).toBeVisible();
  await angle.getByRole('radio', { name: '180°' }).click();
  await expect(angle.getByRole('radio', { name: '180°' })).toHaveAttribute('aria-checked', 'true');
  const stored = async () => (await storedOpenings(page, 'door'))[0]!;
  await expect.poll(async () => (await stored()).swingAngle).toBe(180);

  for (const [value, hasAngle, hingeText] of [
    ['double-in', true, null],
    ['sliding', false, null],
    ['pocket', false, 'Pocket: Left'],
    ['bifold', false, 'Folds to: Left'],
    ['opening', false, null],
    ['swing-out', true, 'Hinge: Left'],
  ] as const) {
    await type.selectOption(value);
    await expect.poll(async () => (await stored()).type).toBe(value);
    await expect(angle).toHaveCount(hasAngle ? 1 : 0);
    if (hingeText) await expect(card.getByRole('button', { name: hingeText })).toBeVisible();
    await viewPlan(page);
    await expect(page.locator(`[data-door-swing][data-door-type="${value}"]`)).toHaveCount(1);
    await openStep(page, 'room');
  }
});

test('blocked-door warnings and the door card have no serious axe violations', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await seed(page, [{ ...DOOR, type: 'double-in' }], [{ ...CHAIR, y: 10.6 }]);
  await openStep(page, 'furniture');
  await expect(page.getByTestId('card-door-block')).toBeVisible();
  const scan = async () => {
    await animationsSettled(page);
    // Pieces are drawn to scale: left out of target-size only (e2e/axe.ts).
    const serious = await seriousViolations(page);
    expect(serious, serious.join('\n')).toEqual([]);
  };
  await scan();
  await page.getByRole('button', { name: /^1\. Room/ }).click();
  await expect(page.getByRole('radiogroup', { name: 'Door 1 opens' })).toBeVisible();
  await scan();
});
