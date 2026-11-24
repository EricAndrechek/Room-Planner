import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { planSvg } from '../src/core/render/svg';
import { drawingDifferences } from '../src/core/testing/equivalence';
import {
  createMemoryStorage as v3Memory,
  loadPersistedState as v3Load,
  migrateStorage as v3Migrate,
} from '../src/core/testing/v3/storage';
import { bootFromStorage } from '../src/lib/boot';
import { createMemoryStorage, createPlanStore, LEGACY_KEYS } from '../src/lib/storage';
import { samePlan } from '../src/lib/plans';
import type { Plan } from '../src/types';
import { PLANS_KEY, UI_KEY, WORKING_KEY, storedPlans, workingPlan } from './storage';
import { isNarrow, openStep } from './ui';

// The move to the plan format in storage (docs/design/plan-format.md, section 4, and section 10's
// test strategy for PR 5): every storage fixture opens with the same plans, which also undo,
// export and share as before; the old keys are never written, so a rollback finds them and what
// an old build saves afterwards comes back as "(recovered)"; plans this build cannot open survive
// untouched; a full storage leaves the planner working in memory.

const FIXTURES = ['v2-storage', 'early-v3-storage', 'original-storage', 'doors-storage'] as const;
const fixtureDir = new URL('../src/core/__fixtures__/', import.meta.url);
const readFixture = (name: string): Record<string, string> =>
  JSON.parse(fs.readFileSync(new URL(`${name}.json`, fixtureDir), 'utf8')).localStorage;
const golden = JSON.parse(fs.readFileSync(new URL('golden-main.json', fixtureDir), 'utf8'))
  .cases as Record<string, { svg: string; bytes: number }>;

const v3Reading = (ls: Record<string, string>) => {
  const s = v3Memory(ls);
  v3Migrate(s);
  return v3Load(s);
};

async function ready(page: Page) {
  await page.waitForSelector('html[data-planner-ready]');
  await page.waitForTimeout(700);
}

/** Replace the whole of localStorage before the first page load (not on reloads). */
const seed = (target: Page | BrowserContext, data: Record<string, string>) =>
  target.addInitScript((d) => {
    if (sessionStorage.getItem('seeded')) return;
    sessionStorage.setItem('seeded', '1');
    localStorage.clear();
    for (const [k, v] of Object.entries(d)) localStorage.setItem(k, v);
  }, data);

const dump = (page: Page) =>
  page.evaluate(() =>
    Object.fromEntries(Object.keys(localStorage).map((k) => [k, localStorage.getItem(k)!])),
  );

const legacyPart = (d: Record<string, string>) =>
  Object.fromEntries(
    Object.entries(d).filter(([k]) => !k.startsWith('room-planner-') || k === LEGACY_KEYS.projects),
  );

const DATE = new Date('2026-01-01T12:00:00Z');

/** The exact SVG the export draws (captured as the print view is filled in). */
async function captureExport(page: Page) {
  await page.addInitScript(() => {
    const desc = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML')!;
    Object.defineProperty(Element.prototype, 'innerHTML', {
      ...desc,
      set(this: Element, v: string) {
        if (this.id === 'print-plan') (window as unknown as { __svg: string }).__svg = v;
        desc.set!.call(this, v);
      },
    });
  });
}
const exportedSvg = async (page: Page) => {
  // The export code loads a few seconds after the planner; the browser's Print fills the view.
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          window.dispatchEvent(new Event('beforeprint'));
          window.dispatchEvent(new Event('afterprint'));
          return (window as unknown as { __svg?: string }).__svg ?? null;
        }),
      { timeout: 15_000 },
    )
    .not.toBeNull();
  return page.evaluate(() => (window as unknown as { __svg: string }).__svg);
};
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

test.describe('the first boot of this build, from every storage fixture', () => {
  test.use({ locale: 'en-US', timezoneId: 'UTC' });

  for (const name of FIXTURES) {
    test(`${name}: same plans, the old keys untouched, the export byte for byte`, async ({
      page,
    }) => {
      const ls = readFixture(name);
      const v3 = v3Reading(ls);
      // What this build makes of it, computed here, and the golden export for it.
      const expected = bootFromStorage(createPlanStore(createMemoryStorage(ls)));
      const current = expected.projects.find((p) => p.id === expected.currentProjectId);
      // Golden while the title and units are the saved plan's (without one, autosave renames it;
      // a plan saved without units shows in this device's).
      const goldenCase =
        current &&
        expected.saveStatus === 'saved' &&
        (current.plan.settings?.unitSystem ?? 'ft-in') === expected.unitSystem
          ? `${name} project ${expected.projects.indexOf(current)}`
          : null;

      await page.clock.setFixedTime(DATE);
      await captureExport(page);
      await seed(page, ls);
      await page.goto('/');
      await ready(page);

      // Without a current plan the working plan is autosaved as a new one, as it always was.
      await expect(
        page.getByRole('heading', { level: 1, name: current?.plan.name ?? /^Floor Plan - / }),
      ).toBeVisible();
      await expect(page.getByTestId('save-status')).toContainText(
        expected.saveStatus === 'saved' ? 'Saved' : /Saved|Unsaved|Saving/,
      );
      const after = await dump(page);
      // The old keys are the backup: byte for byte as the v3 build left them.
      for (const [k, v] of Object.entries(ls)) {
        if (k !== 'room-planner-schema') expect(after[k], k).toBe(v);
      }
      // The working plan draws what the v3 build showed, and is what this build reads from it.
      const working = (await workingPlan(page)) as unknown as Plan;
      expect(drawingDifferences(v3.layout, working)).toEqual([]);
      expect(samePlan(working, expected.plan)).toBe(true);
      // Every saved plan came across, with its id, name and dates.
      const plans = await storedPlans(page);
      expect(plans.slice(0, v3.projects.length).map((p) => [p.id, p.plan.name])).toEqual(
        v3.projects.map((p) => [p.id, p.name]),
      );
      expect(JSON.parse(after[UI_KEY]!).legacy.fingerprint).toBeTruthy();

      const svg = await exportedSvg(page);
      if (goldenCase) {
        // What main exported for this plan, byte for byte.
        expect({ bytes: svg.length, sha: sha(svg) }).toEqual({
          bytes: golden[goldenCase]!.bytes,
          sha: golden[goldenCase]!.svg,
        });
      } else {
        // Autosaved under a new name: the golden title no longer applies. The browser draws
        // what the scene code draws here (golden.test.ts ties that to main for this plan).
        const title = await page.getByRole('heading', { level: 1 }).innerText();
        expect(svg).toBe(
          planSvg({
            plan: working,
            unitSystem: expected.unitSystem,
            title,
            date: DATE,
            locale: 'en-US',
          }),
        );
      }

      // A reload reads the new keys: the same plan.
      await page.reload();
      await ready(page);
      expect(samePlan((await workingPlan(page)) as unknown as Plan, working)).toBe(true);
    });
  }
});

test('a rollback finds the old keys; what the old build saves comes back as "(recovered)"', async ({
  page,
}) => {
  const ls = readFixture('original-storage');
  await seed(page, ls);
  await page.goto('/');
  await ready(page);
  // Edit here: only the new keys change.
  await openStep(page, 'room');
  const width = page.getByLabel('Room width');
  await width.fill('15');
  await width.press('Enter');
  await expect.poll(async () => (await workingPlan(page)).rooms[0]!.outline[2]!.x).toBe(15);
  await expect(page.getByTestId('save-status')).toContainText('Saved');
  const now = await dump(page);
  for (const [k, v] of Object.entries(ls)) expect(now[k], k).toBe(v);

  // An old build runs and saves its plan (as the v3 app writes it).
  await page.evaluate((key) => {
    const projects = JSON.parse(localStorage.getItem(key)!);
    projects[0].name = 'Saved by the old build';
    projects[0].data.roomDims = { width: 9, height: 9 };
    projects[0].updatedAt = new Date(Date.now() + 1000).toISOString();
    localStorage.setItem(key, JSON.stringify(projects));
  }, LEGACY_KEYS.projects);
  await page.reload();
  await ready(page);

  // Both edits are kept: this build's, and the old build's as a new plan.
  expect((await workingPlan(page)).rooms[0]!.outline[2]!.x).toBe(15);
  const names = (await storedPlans(page)).map((p) => p.plan.name);
  expect(names).toEqual(['Café Plan', 'Saved by the old build (recovered)']);
  if (!isNarrow(page)) {
    await page.getByRole('button', { name: 'Open file browser' }).click();
    await expect(page.getByTestId('project-row')).toHaveCount(2);
    await expect(page.getByText('Saved by the old build (recovered)')).toBeVisible();
  }
  // And only once.
  await page.reload();
  await ready(page);
  expect((await storedPlans(page)).map((p) => p.plan.name)).toEqual(names);
});

test('two tabs across the upgrade (the old keys and the new) never write over each other', async ({
  context,
}) => {
  const ls = readFixture('original-storage');
  await seed(context, ls);
  const a = await context.newPage();
  await a.goto('/');
  await ready(a);
  // A second tab of this build, opened while the first is still open.
  const b = await context.newPage();
  await b.goto('/');
  await ready(b);
  const before = await storedPlans(b);
  // Meanwhile an old build's tab saves its working layout.
  await b.evaluate(
    (k) => localStorage.setItem(k, JSON.stringify({ width: 7, height: 7 })),
    LEGACY_KEYS.dims,
  );
  // Each tab saves an edit.
  for (const tab of [a, b]) {
    await openStep(tab, 'furniture');
    await tab.getByRole('button', { name: 'Add Item' }).click();
    await expect(tab.getByTestId('save-status')).toContainText('Saved');
  }
  // Nothing either tab saved is lost: every plan the other had is still in the list.
  const after = await storedPlans(a);
  for (const p of before) expect(after.map((q) => q.id)).toContain(p.id);
  expect(after.length).toBeGreaterThanOrEqual(before.length);
  // The old build's keys are as it wrote them.
  expect(await a.evaluate((k) => localStorage.getItem(k), LEGACY_KEYS.dims)).toBe(
    JSON.stringify({ width: 7, height: 7 }),
  );
  expect(await a.evaluate((k) => localStorage.getItem(k), LEGACY_KEYS.projects)).toBe(
    ls[LEGACY_KEYS.projects],
  );
});

const NEWER_RECORD =
  '{"id":"project-v5", "createdAt":"2027-01-01T00:00:00.000Z","updatedAt":"2027-01-02T00:00:00.000Z","plan":{"version":5,"name":"From the future","floors":[{"x":1.50}]}}';

test('a saved plan from a newer Room Planner is listed, not opened, and survives a save untouched', async ({
  page,
}) => {
  test.skip(isNarrow(page), 'the list is the same on phones');
  await seed(page, {
    [PLANS_KEY]: `[${NEWER_RECORD}]`,
    [UI_KEY]: '{"currentPlanId":null,"designMode":"furniture"}',
  });
  await page.goto('/');
  await ready(page);
  // An edit autosaves a new plan next to it.
  await page.getByRole('button', { name: 'Add Item' }).click();
  await expect(page.getByTestId('save-status')).toContainText('Saved');
  const raw = await page.evaluate((k) => localStorage.getItem(k)!, PLANS_KEY);
  expect(raw.startsWith(`[${NEWER_RECORD},`)).toBe(true);
  await page.getByRole('button', { name: 'Open file browser' }).click();
  await expect(page.getByTestId('locked-project-row')).toContainText('From the future');
  await expect(page.getByTestId('locked-project-row')).toContainText('Needs update');
});

test('a working plan from a newer Room Planner asks for an update and is never written', async ({
  page,
}) => {
  const working = '{"version":5,"name":"Future","floors":[]}';
  await seed(page, { [WORKING_KEY]: working, [PLANS_KEY]: '[]', [UI_KEY]: '{}' });
  await page.goto('/');
  await ready(page);
  const dialog = page.getByRole('dialog', { name: 'Your plan needs a newer Room Planner' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Not now' }).click();
  await openStep(page, 'furniture');
  await page.getByRole('button', { name: 'Add Item' }).click();
  await expect(page.getByTestId('save-status')).toContainText('Saved');
  expect(await page.evaluate((k) => localStorage.getItem(k), WORKING_KEY)).toBe(working);
});

test('every kind of edit undoes and redoes, one step each', async ({ page }) => {
  test.skip(isNarrow(page), 'the same history on phones; the controls are reached differently');
  test.setTimeout(90_000);
  await page.goto('/');
  await ready(page);
  const snapshots: string[] = [];
  const snap = async () => {
    await page.waitForTimeout(150);
    snapshots.push(JSON.stringify(await workingPlan(page)));
  };
  await snap();

  // Furniture.
  await openStep(page, 'furniture');
  await page.getByRole('button', { name: 'Add Item' }).click();
  await snap();
  const piece = page.getByRole('button', { name: /^New Item,/ });
  await piece.focus();
  await page.keyboard.press('ArrowRight');
  await snap();
  await page.keyboard.press('r');
  await snap();
  const widthOf = page.getByLabel('Width of New Item');
  await widthOf.fill('4');
  await widthOf.press('Enter');
  await snap();
  await page.getByRole('button', { name: 'Lock New Item' }).click();
  await snap();
  await page
    .getByTestId('furniture-card')
    .getByRole('button', { name: 'Move New Item to inventory' })
    .click();
  await snap();
  await page.getByRole('button', { name: 'Place New Item in the room' }).click();
  await snap();
  await page.getByRole('button', { name: 'Delete New Item' }).click();
  await snap();
  await page.getByRole('button', { name: /Clear room/ }).click();
  await page.getByRole('button', { name: 'Clear all' }).click();
  await snap();

  // The room, doors and windows.
  await openStep(page, 'room');
  const roomWidth = page.getByLabel('Room width');
  await roomWidth.fill('14');
  await roomWidth.press('Enter');
  await snap();
  await page.getByRole('button', { name: 'Add Door' }).click();
  await snap();
  await page.getByLabel('Door 2 type').selectOption('bifold');
  await snap();
  await page
    .getByTestId('door-card')
    .nth(1)
    .getByRole('button', { name: /^Folds to/ })
    .click();
  await snap();
  await page
    .getByRole('radiogroup', { name: 'Door 1 opens' })
    .getByRole('radio', { name: '180°' })
    .click();
  await snap();
  await page
    .getByRole('radiogroup', { name: 'Door 1 wall' })
    .getByRole('radio', { name: 'Right' })
    .click();
  await snap();
  await page.getByRole('button', { name: 'Add Window' }).click();
  await snap();
  await page
    .getByRole('button', { name: /^Window handle/ })
    .last()
    .focus();
  await page.keyboard.press('ArrowRight');
  await snap();
  await page.getByRole('button', { name: 'Delete door' }).first().click();
  await snap();

  // Every step is distinct, and undo walks back through each, then redo forward again.
  const repeats = snapshots.flatMap((x, i) => (i > 0 && x === snapshots[i - 1] ? [i] : []));
  expect(repeats, 'edits that changed nothing').toEqual([]);
  const undo = page.getByRole('button', { name: 'Undo' });
  const redo = page.getByRole('button', { name: 'Redo' });
  for (let i = snapshots.length - 2; i >= 0; i--) {
    await undo.click();
    await expect
      .poll(async () => JSON.stringify(await workingPlan(page)), { message: `undo to ${i}` })
      .toBe(snapshots[i]);
  }
  await expect(undo).toBeDisabled();
  for (let i = 1; i < snapshots.length; i++) {
    await redo.click();
    await expect
      .poll(async () => JSON.stringify(await workingPlan(page)), { message: `redo to ${i}` })
      .toBe(snapshots[i]);
  }
});

test('the JSON box and the plans file round-trip a plan', async ({ page }) => {
  test.skip(isNarrow(page), 'the same dialogs on phones');
  await seed(page, readFixture('doors-storage'));
  await page.goto('/');
  await ready(page);
  const original = (await workingPlan(page)) as unknown as Plan;

  // The Share dialog's JSON: v4, in the shown units; pasted back, the same plan.
  await page.getByRole('button', { name: 'Share / Save' }).click();
  const dialog = page.getByRole('dialog', { name: 'Share & Save Layout' });
  const json = await dialog.locator('#layout-json').inputValue();
  expect(JSON.parse(json)).toMatchObject({ version: 4 });
  await dialog.getByPlaceholder('Paste your JSON config here...').fill(json);
  await dialog.getByRole('button', { name: 'Load Configuration' }).click();
  await expect(dialog).toBeHidden();
  expect(samePlan((await workingPlan(page)) as unknown as Plan, original)).toBe(true);

  // My Floor Plans: export the current plan, import the file, get the same plan again.
  await page.getByRole('button', { name: 'Open file browser' }).click();
  const files = page.getByRole('dialog', { name: 'My Floor Plans' });
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    files.getByRole('button', { name: /^Export/ }).click(),
  ]);
  const text = fs.readFileSync((await download.path())!, 'utf8');
  const file = JSON.parse(text);
  expect(file.projects[0].data.version).toBe(4);
  const count = (await storedPlans(page)).length;
  await files.getByLabel(/Import Floor Plan/).fill(text);
  await files.getByRole('button', { name: 'Import', exact: true }).click();
  await expect.poll(async () => (await storedPlans(page)).length).toBe(count + 1);
  const imported = (await storedPlans(page)).at(-1)!;
  expect(samePlan(imported.plan as unknown as Plan, file.projects[0].data)).toBe(true);
});

test('a full storage: the planner keeps working in memory and says so', async ({ page }) => {
  const ls = readFixture('original-storage');
  await seed(page, ls);
  await page.addInitScript(() => {
    const set = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k: string, v: string) {
      if (
        k.startsWith('room-planner-') &&
        sessionStorage.getItem('seeded') &&
        k !== 'room-planner-pref-snap'
      ) {
        throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
      }
      return set.call(this, k, v);
    };
  });
  await page.goto('/');
  await ready(page);
  await expect(page.getByTestId('app-notice')).toContainText("isn't saving your changes");
  await expect(page.getByRole('heading', { name: 'Café Plan' })).toBeVisible();
  // Edits still work (and undo), in this tab.
  await openStep(page, 'furniture');
  await page.getByRole('button', { name: 'Add Item' }).click();
  await expect(page.getByRole('button', { name: /^New Item,/ })).toBeVisible();
  const after = await dump(page);
  expect(legacyPart(after)).toEqual(legacyPart(ls));
  expect(after[WORKING_KEY]).toBeUndefined();
});

// The real old build, served on this origin for one tab: run with E2E_OLD_BUILD_DIR set to the
// `dist/` of a build from before the plan format (e.g. `git worktree add /tmp/old 84d68a7`, build).
const OLD = process.env.E2E_OLD_BUILD_DIR;
test.describe('with the old build', () => {
  test.skip(!OLD, 'set E2E_OLD_BUILD_DIR to a build from before the plan format');
  test.use({ serviceWorkers: 'block' });

  const serveOld = async (page: Page) =>
    page.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      let file = path.join(OLD!, decodeURIComponent(url.pathname));
      if (fs.existsSync(file) && fs.statSync(file).isDirectory())
        file = path.join(file, 'index.html');
      if (!fs.existsSync(file)) return route.fallback();
      const type = file.endsWith('.html')
        ? 'text/html'
        : file.endsWith('.js')
          ? 'text/javascript'
          : file.endsWith('.css')
            ? 'text/css'
            : file.endsWith('.json') || file.endsWith('.webmanifest')
              ? 'application/json'
              : file.endsWith('.svg')
                ? 'image/svg+xml'
                : 'application/octet-stream';
      return route.fulfill({ body: fs.readFileSync(file), contentType: type });
    });

  test('old tab and new tab side by side, then a rollback and back', async ({ context }) => {
    const ls = readFixture('original-storage');
    await seed(context, ls);
    const oldTab = await context.newPage();
    await serveOld(oldTab);
    await oldTab.goto('/');
    await ready(oldTab);
    const newTab = await context.newPage();
    await newTab.goto('/');
    await ready(newTab);
    await expect(newTab.getByRole('heading', { name: 'Café Plan' })).toBeVisible();

    // Each tab edits and autosaves.
    for (const tab of [oldTab, newTab]) {
      await openStep(tab, 'furniture');
      await tab.getByRole('button', { name: 'Add Item' }).click();
      await expect(tab.getByTestId('save-status')).toContainText('Saved');
    }
    // The old tab's keys hold its edit, the new tab's keys hold its own.
    const oldProjects = JSON.parse(
      (await oldTab.evaluate((k) => localStorage.getItem(k), LEGACY_KEYS.projects))!,
    );
    expect(oldProjects[0].data.items.map((i: { label: string }) => i.label)).toContain('New Item');
    const newPlans = await storedPlans(newTab);
    expect(newPlans[0]!.plan.items.map((i) => i.label)).toContain('New Item');

    // A rollback: the old build reloads and shows its own plans as it left them.
    await oldTab.reload();
    await ready(oldTab);
    await expect(oldTab.getByRole('heading', { name: 'Café Plan' })).toBeVisible();
    await expect(oldTab.getByRole('button', { name: /^New Item,/ })).toBeVisible();

    // Back on this build: the old build's save comes back as "(recovered)", nothing lost.
    await newTab.reload();
    await ready(newTab);
    const names = (await storedPlans(newTab)).map((p) => p.plan.name);
    expect(names).toEqual(['Café Plan', 'Café Plan (recovered)']);
  });
});
