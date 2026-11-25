import { expect, test, type Page } from '@playwright/test';
import { workingPlan } from './storage';
import { announcements, recordAnnouncements } from './ui';

// WebMCP (docs/design/plan-format.md, section 8): a browser agent edits the open plan through the
// app's own undoable edits. No browser here has the API, so a fake `document.modelContext` stands
// in for Chrome's: it keeps what the app registers, and the test calls the tools as an agent would.

interface FakeTool {
  name: string;
  execute: (input: unknown, options: { signal: AbortSignal }) => Promise<unknown>;
}

async function withFakeModelContext(page: Page) {
  await page.addInitScript(() => {
    const tools = new Map<string, FakeTool>();
    (window as unknown as { __tools: Map<string, FakeTool> }).__tools = tools;
    Object.defineProperty(document, 'modelContext', {
      configurable: true,
      value: {
        registerTool(tool: FakeTool, options?: { signal?: AbortSignal }) {
          tools.set(tool.name, tool);
          options?.signal?.addEventListener('abort', () => tools.delete(tool.name));
          return Promise.resolve();
        },
      },
    });
  });
}

/** Call a registered tool as an agent would; resolves with its (JSON) result. */
const callTool = (page: Page, name: string, input: unknown) =>
  page.evaluate(
    ([n, i]) =>
      (window as unknown as { __tools: Map<string, FakeTool> }).__tools
        .get(n as string)!
        .execute(i, { signal: new AbortController().signal }),
    [name, input] as const,
  );

async function ready(page: Page) {
  await withFakeModelContext(page);
  await page.goto('/');
  await page.waitForSelector('html[data-planner-ready]');
  await page.waitForFunction(
    () => (window as unknown as { __tools: Map<string, unknown> }).__tools.size === 14,
  );
}

test('add_item: the piece appears selected, is announced, and Undo removes it', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await ready(page);
  await recordAnnouncements(page);

  const result = (await callTool(page, 'add_item', {
    label: 'Reading chair',
    width: 2.5,
    depth: 2.5,
    place: true,
  })) as { item: { id: string }; changed: boolean };
  expect(result.changed).toBe(true);

  const piece = page.getByRole('button', { name: /^Reading chair,/ });
  await expect(piece).toBeVisible();
  await expect(piece).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => announcements(page)).toContain('Assistant: Reading chair added');
  await expect
    .poll(async () => (await workingPlan(page)).items.some((i) => i.label === 'Reading chair'))
    .toBe(true);

  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(piece).toHaveCount(0);
  await expect
    .poll(async () => (await workingPlan(page)).items.some((i) => i.label === 'Reading chair'))
    .toBe(false);
  expect(errors).toEqual([]);
});

test('replace_plan asks first: Replace swaps the plan in one undo step', async ({ page }) => {
  await ready(page);
  const plan = {
    version: 4,
    unit: 'ft',
    rooms: [
      {
        id: 'study',
        name: 'Study',
        outline: [
          { x: 0, y: 0 },
          { x: 9, y: 0 },
          { x: 9, y: 8 },
          { x: 0, y: 8 },
        ],
      },
    ],
    items: [{ id: 'desk', label: 'Writing desk', width: 4, depth: 2, placement: { x: 4.5, y: 1 } }],
  };
  const pending = callTool(page, 'replace_plan', { plan });

  const dialog = page.getByRole('dialog', {
    name: "Replace this plan with the assistant's version?",
  });
  await expect(dialog).toBeVisible();
  // Nothing changes until the user answers.
  await expect(page.getByRole('button', { name: /^Bed,/ })).toBeVisible();
  await dialog.getByRole('button', { name: 'Replace' }).click();
  await expect(dialog).toHaveCount(0);
  expect(await pending).toMatchObject({ changed: true });

  await expect(page.getByRole('button', { name: /^Writing desk,/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Bed,/ })).toHaveCount(0);

  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByRole('button', { name: /^Bed,/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Writing desk,/ })).toHaveCount(0);
});

test('replace_plan declined: the plan stays and the agent gets an error', async ({ page }) => {
  await ready(page);
  const pending = callTool(page, 'replace_plan', {
    plan: {
      version: 4,
      unit: 'ft',
      rooms: [
        {
          id: 'r',
          outline: [
            { x: 0, y: 0 },
            { x: 5, y: 0 },
            { x: 5, y: 5 },
            { x: 0, y: 5 },
          ],
        },
      ],
    },
  });
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Keep my plan' }).click();
  expect(await pending).toEqual({ error: expect.stringContaining('declined') });
  await expect(page.getByRole('button', { name: /^Bed,/ })).toBeVisible();
});
