import { afterEach, describe, expect, test, vi } from 'vitest';
import { historyReducer, initHistory } from '../hooks/useHistory';
import { starterPlan } from '../lib/plans';
import type { Plan } from '../types';
import { registerTools, type ModelContextLike, type PlannerHost, type ToolInit } from './register';
import schemas from './schemas.json';
import { findModelContext } from './useWebMcp';

function host(confirm = async () => true) {
  const reducer = historyReducer<Plan>();
  let state = initHistory(starterPlan());
  const h: PlannerHost = {
    plan: () => state.present,
    name: () => 'Plan',
    unitSystem: () => 'ft-in',
    apply: (next) =>
      void (state = reducer(state, { type: 'set', update: () => next, commit: true })),
    show: () => {},
    confirm,
  };
  return {
    h,
    plan: () => state.present,
    undo: () => void (state = reducer(state, { type: 'undo' })),
  };
}

/** `document.modelContext` as the current spec has it: promise, unregistered by the signal. */
function specContext(reject: (name: string) => boolean = () => false) {
  const tools = new Map<string, ToolInit>();
  const mc: ModelContextLike = {
    registerTool: (tool, options) => {
      if (reject(tool.name)) return Promise.reject(new DOMException('no', 'NotAllowedError'));
      tools.set(tool.name, tool);
      options?.signal?.addEventListener('abort', () => tools.delete(tool.name));
      return Promise.resolve(undefined);
    },
  };
  return { mc, tools };
}

const capture = vi.fn();

afterEach(() => {
  vi.unstubAllGlobals();
  capture.mockReset();
});

describe('registerTools', () => {
  test('document.modelContext: every tool with its schema and hints; abort unregisters', async () => {
    vi.stubGlobal('window', { posthog: { capture } });
    const { mc, tools } = specContext();
    const controller = new AbortController();
    const n = await registerTools(mc, host().h, controller.signal, { api: 'document' });
    expect(n).toBe(14);
    expect([...tools.keys()]).toEqual(Object.keys(schemas));
    const get = tools.get('get_plan')!;
    expect(get.inputSchema).toEqual(schemas.get_plan);
    expect(get.annotations).toEqual({ readOnlyHint: true, untrustedContentHint: true });
    expect(tools.get('replace_plan')!.annotations).toEqual({ consequentialHint: true });
    expect(capture).toHaveBeenCalledWith('webmcp_available', { api: 'document', tools: 14 });
    controller.abort();
    expect(tools.size).toBe(0);
  });

  test('execute: the result as JSON-ready data, errors as {error}; tracked without content', async () => {
    vi.stubGlobal('window', { posthog: { capture } });
    const { mc, tools } = specContext();
    const p = host();
    await registerTools(mc, p.h, new AbortController().signal);
    const signal = new AbortController().signal;
    const added = (await tools
      .get('add_item')!
      .execute({ label: 'Secret sofa', width: 7, depth: 3, place: true }, { signal })) as {
      item: { id: string };
      issues: unknown[];
    };
    expect(added.item.id).toBe('item-7');
    expect(JSON.parse(JSON.stringify(added))).toEqual(added);
    expect(p.plan().items).toHaveLength(7);
    // Undo after a call restores the plan.
    p.undo();
    expect(p.plan().items).toHaveLength(6);

    const bad = await tools.get('update_item')!.execute({ id: 'nope' }, { signal });
    expect(bad).toEqual({ error: expect.stringContaining('nope') });

    const calls = capture.mock.calls.filter(([e]) => e === 'webmcp_tool_called');
    expect(calls).toEqual([
      ['webmcp_tool_called', { tool: 'add_item', ok: true, error_kind: null }],
      ['webmcp_tool_called', { tool: 'update_item', ok: false, error_kind: 'not_found' }],
    ]);
    expect(JSON.stringify(capture.mock.calls)).not.toContain('Secret');
  });

  test('replace_plan resolves on the answer: yes replaces, no is an error', async () => {
    let answer = true;
    const { mc, tools } = specContext();
    const p = host(async () => answer);
    await registerTools(mc, p.h, new AbortController().signal);
    const plan = {
      version: 4,
      unit: 'ft',
      rooms: [
        {
          id: 'r',
          outline: [
            { x: 0, y: 0 },
            { x: 9, y: 0 },
            { x: 9, y: 9 },
            { x: 0, y: 9 },
          ],
        },
      ],
    };
    const yes = (await tools.get('replace_plan')!.execute({ plan })) as { changed: boolean };
    expect(yes.changed).toBe(true);
    expect(p.plan().rooms[0]!.id).toBe('r');
    answer = false;
    const no = await tools.get('replace_plan')!.execute({ plan: { ...plan, name: 'x' } });
    expect(no).toEqual({ error: expect.stringContaining('declined') });
  });

  test('a rejected registration is ignored; the others still register', async () => {
    const { mc, tools } = specContext((name) => name === 'replace_plan');
    const n = await registerTools(mc, host().h, new AbortController().signal);
    expect(n).toBe(13);
    expect(tools.has('replace_plan')).toBe(false);
  });

  test('a browser that refuses everything (throwing) gets nothing and no error', async () => {
    const mc: ModelContextLike = {
      registerTool: () => {
        throw new DOMException('Permissions policy', 'NotAllowedError');
      },
    };
    await expect(registerTools(mc, host().h, new AbortController().signal)).resolves.toBe(0);
  });

  test('navigator.modelContext of early builds: sync registerTool, unregisterTool on abort', async () => {
    const registered: string[] = [];
    const unregistered: string[] = [];
    const mc: ModelContextLike = {
      registerTool: (tool) => void registered.push(tool.name),
      unregisterTool: (name) => void unregistered.push(name),
    };
    const controller = new AbortController();
    expect(await registerTools(mc, host().h, controller.signal, { api: 'navigator' })).toBe(14);
    controller.abort();
    expect(unregistered).toEqual(registered);
  });

  test('provideContext of early builds: all at once, cleared on abort', async () => {
    let tools: ToolInit[] = [];
    const clearContext = vi.fn();
    const mc: ModelContextLike = {
      provideContext: (ctx) => void (tools = ctx.tools),
      clearContext,
    };
    const controller = new AbortController();
    expect(await registerTools(mc, host().h, controller.signal)).toBe(14);
    expect(tools).toHaveLength(14);
    controller.abort();
    expect(clearContext).toHaveBeenCalledOnce();
  });

  test('an already aborted signal (the planner unmounted first) registers nothing', async () => {
    const { mc, tools } = specContext();
    const controller = new AbortController();
    controller.abort();
    expect(await registerTools(mc, host().h, controller.signal)).toBe(0);
    expect(tools.size).toBe(0);
  });
});

describe('findModelContext', () => {
  test('document.modelContext first, then the deprecated navigator.modelContext', () => {
    const doc = specContext().mc;
    const nav = specContext().mc;
    vi.stubGlobal('document', { modelContext: doc });
    vi.stubGlobal('navigator', { modelContext: nav });
    expect(findModelContext()).toEqual({ mc: doc, api: 'document' });
    vi.stubGlobal('document', {});
    expect(findModelContext()).toEqual({ mc: nav, api: 'navigator' });
    vi.stubGlobal('navigator', {});
    expect(findModelContext()).toBeNull();
  });
});
