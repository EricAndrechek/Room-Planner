import { describe, expect, test } from 'vitest';
import { checkLayout } from '../core/check';
import { roomBounds } from '../core/geometry/walls';
import { historyReducer, initHistory } from '../hooks/useHistory';
import { blankPlan, starterPlan } from '../lib/plans';
import type { Plan, UnitSystem } from '../types';
import { createTools, type Outcome, type Target, type WebMcpHost } from './tools';

/** A host over the app's own history reducer, recording what is said and shown. */
function fakeHost(plan: Plan = starterPlan(), unitSystem: UnitSystem = 'ft-in') {
  const reducer = historyReducer<Plan>();
  let state = initHistory(plan);
  const said: string[] = [];
  const shown: (Target | null)[] = [];
  const asked: string[] = [];
  let answer = true;
  const host: WebMcpHost = {
    plan: () => state.present,
    name: () => 'My room',
    unitSystem: () => unitSystem,
    apply: (next, text) => {
      state = reducer(state, { type: 'set', update: () => next, commit: true });
      said.push(text);
    },
    show: (t) => void shown.push(t),
    confirm: async (message) => {
      asked.push(message);
      return answer;
    },
  };
  const tools = createTools(host);
  const call = (name: string, input: unknown = {}) =>
    tools.find((t) => t.name === name)!.call(input);
  return {
    host,
    tools,
    call,
    said,
    shown,
    asked,
    answer: (a: boolean) => void (answer = a),
    plan: () => state.present,
    steps: () => state.index,
    undo: () => void (state = reducer(state, { type: 'undo' })),
  };
}

type Data = Record<string, unknown>;
const data = (o: Outcome): Data => {
  if (!o.ok) throw new Error(`expected success, got ${o.kind}: ${o.error}`);
  return o.data;
};
const error = (o: Outcome) => {
  if (o.ok) throw new Error('expected an error');
  return o;
};

describe('the tool list', () => {
  test('names, hints and descriptions', () => {
    const { tools } = fakeHost();
    expect(tools.map((t) => t.name)).toEqual([
      'get_plan',
      'check_layout',
      'add_item',
      'update_item',
      'set_aside_item',
      'place_item',
      'remove_item',
      'add_opening',
      'update_opening',
      'remove_opening',
      'add_room',
      'update_room',
      'remove_room',
      'replace_plan',
    ]);
    const hints = Object.fromEntries(tools.map((t) => [t.name, t.annotations]));
    expect(hints.get_plan).toEqual({ readOnlyHint: true, untrustedContentHint: true });
    expect(hints.check_layout).toEqual({ readOnlyHint: true });
    expect(hints.replace_plan).toEqual({ consequentialHint: true });
    expect(hints.add_item).toBeUndefined();
    for (const t of tools) expect(t.description.length, t.name).toBeLessThan(1500);
  });
});

describe('reading', () => {
  test('get_plan: the plan in the display unit, its summary and issues; no undo step', async () => {
    const h = fakeHost(starterPlan(), 'cm');
    const d = data(await h.call('get_plan'));
    expect(d.unit).toBe('cm');
    const plan = d.plan as Plan;
    expect(plan.unit).toBe('cm');
    expect(plan.name).toBe('My room');
    expect(plan.settings?.unitSystem).toBe('cm');
    // 12 ft = 365.76 cm
    expect(plan.rooms[0]!.outline[2]).toEqual({ x: 365.76, y: 365.76 });
    expect(d.summary).toContain('Room 1 (room-1)');
    expect(d.summary).toContain('6 pieces on the plan');
    expect(d.issues).toEqual(checkLayout(starterPlan(), { unitSystem: 'cm' }));
    expect(h.steps()).toBe(0);
    expect(h.said).toEqual([]);
  });

  test('feet and inches read as feet', async () => {
    const d = data(await fakeHost().call('get_plan'));
    expect(d.unit).toBe('ft');
    expect((d.plan as Plan).rooms[0]!.outline[2]).toEqual({ x: 12, y: 12 });
  });

  test('check_layout: the canvas issues, with minClearance in the display unit', async () => {
    const h = fakeHost(starterPlan(), 'in');
    const d = data(await h.call('check_layout', { minClearance: 36 }));
    expect(d.issues).toEqual(checkLayout(starterPlan(), { unitSystem: 'in', minClearance: 3 }));
    expect(typeof d.ok).toBe('boolean');
  });

  test('arguments as a JSON string (early Chrome builds) are read', async () => {
    const d = data(await fakeHost().call('check_layout', '{"minClearance": 1}'));
    expect(Array.isArray(d.issues)).toBe(true);
  });
});

describe('furniture', () => {
  test('add_item without a placement sets the piece aside: one undo step, said and shown', async () => {
    const h = fakeHost();
    const before = h.plan();
    const d = data(await h.call('add_item', { label: 'Sofa', width: 7, depth: 3 }));
    const item = d.item as Plan['items'][number];
    expect(item).toMatchObject({ id: 'item-7', label: 'Sofa', width: 7, depth: 3, shape: 'rect' });
    expect(item.placement).toBeUndefined();
    expect(d.changed).toBe(true);
    expect(Array.isArray(d.issues)).toBe(true);
    expect(h.steps()).toBe(1);
    expect(h.said).toEqual(['Assistant: Sofa set aside']);
    expect(h.shown).toEqual([{ type: 'aside', id: 'item-7' }]);
    h.undo();
    expect(h.plan()).toBe(before);
  });

  test('add_item with place: true goes to a free spot, selected', async () => {
    const h = fakeHost(blankPlan());
    const d = data(await h.call('add_item', { label: 'Desk', width: 4, depth: 2, place: true }));
    const item = d.item as Plan['items'][number];
    expect(item.placement).toBeDefined();
    expect(d.issues).toEqual([]);
    expect(h.shown).toEqual([{ type: 'item', id: item.id }]);
    expect(h.said[0]).toMatch(/^Assistant: Desk added/);
  });

  test('add_item with a placement, in centimetres, is stored in feet and answered in cm', async () => {
    const h = fakeHost(blankPlan(), 'cm');
    const d = data(
      await h.call('add_item', {
        label: 'Bed',
        width: 152.4,
        depth: 203.2,
        placement: { x: 100, y: 120, rotation: 450 },
      }),
    );
    expect(d.item).toMatchObject({ width: 152.4, depth: 203.2 });
    expect((d.item as Plan['items'][number]).placement).toEqual({ x: 100, y: 120, rotation: 90 });
    const stored = h.plan().items[0]!;
    expect(stored.width).toBeCloseTo(5, 5);
    expect(stored.depth).toBeCloseTo(6.6667, 4);
  });

  test('an L without a cut gets the default one', async () => {
    const h = fakeHost(blankPlan());
    const d = data(
      await h.call('add_item', { label: 'Sectional', width: 9, depth: 7, shape: 'l' }),
    );
    expect((d.item as Plan['items'][number]).cut).toBeDefined();
  });

  test('bad arguments name the field and change nothing', async () => {
    const h = fakeHost();
    const typo = error(
      await h.call('add_item', { label: 'Sofa', width: 7, depth: 3, colour: '#ff0000' }),
    );
    expect(typo.kind).toBe('bad_argument');
    expect(typo.error).toContain('"colour"');
    const size = error(await h.call('add_item', { label: 'Sofa', width: -1, depth: 3 }));
    expect(size.error).toMatch(/^width:/);
    const missing = error(await h.call('add_item', { label: 'Sofa', depth: 3 }));
    expect(missing.error).toMatch(/^width:/);
    const room = error(
      await h.call('add_item', { label: 'Sofa', width: 1, depth: 1, roomId: 'nope' }),
    );
    expect(room.kind).toBe('not_found');
    expect(room.error).toContain('roomId');
    const cut = error(
      await h.call('add_item', {
        label: 'Sofa',
        width: 1,
        depth: 1,
        cut: { corner: 'tl', width: 0.5, depth: 0.5 },
      }),
    );
    expect(cut.error).toMatch(/^cut:/);
    expect(h.steps()).toBe(0);
    expect(h.said).toEqual([]);
  });

  test('update_item moves, turns and resizes about the centre', async () => {
    const h = fakeHost();
    const d = data(
      await h.call('update_item', {
        id: 'item-5',
        label: 'Work desk',
        width: 3,
        placement: { x: 6, rotation: 90 },
      }),
    );
    expect(d.item).toMatchObject({
      label: 'Work desk',
      width: 3,
      placement: { x: 6, y: 8.5, rotation: 90 },
    });
    expect(h.steps()).toBe(1);
    expect(h.said[0]).toMatch(/^Assistant: /);
    expect(h.shown).toEqual([{ type: 'item', id: 'item-5' }]);
  });

  test('update_item: notes, hide and lock; clearing them removes the field', async () => {
    const h = fakeHost();
    await h.call('update_item', { id: 'item-1', notes: 'Queen', hidden: true, locked: true });
    expect(h.plan().items[0]).toMatchObject({ notes: 'Queen', hidden: true, locked: true });
    await h.call('update_item', { id: 'item-1', notes: '', hidden: false });
    expect(h.plan().items[0]!.notes).toBeUndefined();
    expect('hidden' in h.plan().items[0]!).toBe(false);
  });

  test('a locked piece moves only when unlocked in the same call', async () => {
    const h = fakeHost();
    await h.call('update_item', { id: 'item-1', locked: true });
    const refused = error(await h.call('update_item', { id: 'item-1', placement: { x: 6 } }));
    expect(refused.kind).toBe('not_allowed');
    expect(refused.error).toContain('locked');
    // A rename is fine.
    data(await h.call('update_item', { id: 'item-1', label: 'Big bed' }));
    data(await h.call('update_item', { id: 'item-1', locked: false, placement: { x: 6 } }));
    expect(h.plan().items[0]!.placement!.x).toBe(6);
  });

  test('an update that changes nothing is no undo step', async () => {
    const h = fakeHost();
    const d = data(await h.call('update_item', { id: 'item-1', label: 'Bed' }));
    expect(d.changed).toBe(false);
    expect(h.steps()).toBe(0);
  });

  test('unknown ids', async () => {
    const h = fakeHost();
    expect(error(await h.call('update_item', { id: 'sofa' })).kind).toBe('not_found');
    expect(error(await h.call('remove_item', { id: 'sofa' })).kind).toBe('not_found');
    expect(error(await h.call('remove_opening', { id: 'sofa' })).kind).toBe('not_found');
  });

  test('set_aside_item, place_item (free spot and at a point), remove_item', async () => {
    const h = fakeHost();
    data(await h.call('set_aside_item', { id: 'item-6' }));
    expect(h.plan().items[5]!.placement).toBeUndefined();
    expect(h.shown.at(-1)).toEqual({ type: 'aside', id: 'item-6' });

    const out = error(await h.call('place_item', { id: 'item-6', at: { x: 50, y: 50 } }));
    expect(out.kind).toBe('not_allowed');
    const d = data(await h.call('place_item', { id: 'item-6', at: { x: 6, y: 9 } }));
    expect((d.item as Plan['items'][number]).placement).toMatchObject({ x: 6, y: 9 });
    expect(h.shown.at(-1)).toEqual({ type: 'item', id: 'item-6' });
    expect(error(await h.call('place_item', { id: 'item-6' })).kind).toBe('not_allowed');

    data(await h.call('set_aside_item', { id: 'item-6' }));
    data(await h.call('place_item', { id: 'item-6' }));
    expect(h.plan().items[5]!.placement).toBeDefined();

    data(await h.call('remove_item', { id: 'item-6' }));
    expect(h.plan().items.some((i) => i.id === 'item-6')).toBe(false);
    expect(h.said.at(-1)).toBe('Assistant: Chair deleted');
    expect(h.steps()).toBe(5);
  });

  test('update_item puts a set-aside piece on the plan only with x and y', async () => {
    const h = fakeHost();
    await h.call('set_aside_item', { id: 'item-6' });
    expect(error(await h.call('update_item', { id: 'item-6', placement: { x: 3 } })).kind).toBe(
      'bad_argument',
    );
    data(await h.call('update_item', { id: 'item-6', placement: { x: 6, y: 9 } }));
    expect(h.plan().items[5]!.placement).toEqual({ x: 6, y: 9, rotation: 0 });
  });
});

describe('doors and windows', () => {
  test('add_opening finds a free spot; shown and said', async () => {
    const h = fakeHost();
    const d = data(await h.call('add_opening', { kind: 'door' }));
    const o = d.opening as Plan['rooms'][number]['openings'][number];
    expect(o).toMatchObject({ id: 'door-2', kind: 'door', width: 3, type: 'swing-in' });
    expect(h.shown).toEqual([{ type: 'door', id: 'door-2' }]);
    expect(h.said).toEqual(['Assistant: Door 2 added to Room 1']);
    expect(h.steps()).toBe(1);
  });

  test('add_opening on a wall (centred) or at an offset, in inches', async () => {
    const h = fakeHost(blankPlan(), 'in');
    const d = data(await h.call('add_opening', { kind: 'window', wall: 1, width: 36 }));
    expect(d.opening).toMatchObject({ wall: 1, offset: 54, width: 36 });
    const e = data(
      await h.call('add_opening', { kind: 'door', wall: 3, offset: 12, width: 30, hinge: 'end' }),
    );
    expect(e.opening).toMatchObject({ wall: 3, offset: 12, width: 30, hinge: 'end' });
  });

  test('add_opening errors: no such wall, does not fit, door fields on a window', async () => {
    const h = fakeHost(blankPlan(), 'in');
    expect(error(await h.call('add_opening', { kind: 'door', wall: 4 })).error).toMatch(/^wall:/);
    const big = error(
      await h.call('add_opening', { kind: 'door', wall: 0, offset: 120, width: 36 }),
    );
    expect(big.error).toContain('144 in');
    expect(error(await h.call('add_opening', { kind: 'window', hinge: 'end' })).kind).toBe(
      'bad_argument',
    );
    expect(error(await h.call('add_opening', { kind: 'door', offset: 3 })).error).toMatch(
      /^offset:/,
    );
    expect(h.steps()).toBe(0);
  });

  test('update_opening and remove_opening', async () => {
    const h = fakeHost();
    const d = data(
      await h.call('update_opening', {
        id: 'door-1',
        width: 2.5,
        type: 'sliding',
        swingAngle: 180,
      }),
    );
    expect(d.opening).toMatchObject({ id: 'door-1', width: 2.5, type: 'sliding', swingAngle: 180 });
    data(await h.call('update_opening', { id: 'door-1', swingAngle: 90 }));
    expect('swingAngle' in h.plan().rooms[0]!.openings[0]!).toBe(false);
    const moved = data(await h.call('update_opening', { id: 'window-1', wall: 1 }));
    expect(moved.opening).toMatchObject({ wall: 1 });
    expect(error(await h.call('update_opening', { id: 'window-1', hinge: 'end' })).kind).toBe(
      'bad_argument',
    );
    data(await h.call('remove_opening', { id: 'window-1' }));
    expect(h.plan().rooms[0]!.openings.map((o) => o.id)).toEqual(['door-1']);
    expect(h.shown.at(-1)).toEqual({ type: 'room', id: 'room-1' });
    expect(h.steps()).toBe(4);
  });
});

describe('rooms', () => {
  test('add_room beside a room, named; update_room renames and moves; overlap refused', async () => {
    const h = fakeHost();
    const d = data(await h.call('add_room', { name: 'Kitchen', width: 8, depth: 12 }));
    const room = d.room as Plan['rooms'][number];
    expect(room.name).toBe('Kitchen');
    expect(h.shown).toEqual([{ type: 'room', id: room.id }]);
    expect(h.said[0]).toBe('Assistant: Kitchen added beside Room 1');
    expect(h.steps()).toBe(1);

    data(await h.call('update_room', { id: room.id, name: 'Galley' }));
    expect(h.plan().rooms[1]!.name).toBe('Galley');
    const b = roomBounds(h.plan().rooms[1]!);
    const overlap = error(await h.call('update_room', { id: room.id, x: b.left - 4 }));
    expect(overlap.kind).toBe('not_allowed');
    data(await h.call('update_room', { id: room.id, y: b.top + 20 }));
    expect(roomBounds(h.plan().rooms[1]!).top).toBe(b.top + 20);
    expect(h.steps()).toBe(3);
  });

  test('remove_room sets its furniture aside; the last room stays', async () => {
    const h = fakeHost();
    expect(error(await h.call('remove_room', { id: 'room-1' })).kind).toBe('not_allowed');
    const added = data(await h.call('add_room', {})).room as Plan['rooms'][number];
    const b = roomBounds(added);
    await h.call('add_item', {
      label: 'Table',
      width: 2,
      depth: 2,
      placement: { x: (b.left + b.right) / 2, y: (b.top + b.bottom) / 2 },
    });
    const d = data(await h.call('remove_room', { id: added.id }));
    expect(d.setAside).toEqual(['item-7']);
    expect(h.plan().rooms).toHaveLength(1);
    expect(h.said.at(-1)).toMatch(/deleted\. 1 piece set aside$/);
  });
});

describe('replace_plan', () => {
  const next = {
    version: 4,
    unit: 'in',
    rooms: [
      {
        id: 'r',
        outline: [
          { x: 0, y: 0 },
          { x: 120, y: 0 },
          { x: 120, y: 96 },
          { x: 0, y: 96 },
        ],
      },
    ],
    items: [{ id: 'bed', label: 'Bed', width: 60, depth: 80, placement: { x: 60, y: 40 } }],
  };

  test('asks the user; yes replaces it in one undo step, keeping the name', async () => {
    const h = fakeHost();
    const before = h.plan();
    const d = data(await h.call('replace_plan', { plan: next }));
    expect(h.asked).toEqual(["Replace this plan with the assistant's version?"]);
    expect(h.plan().rooms[0]!.outline[2]).toEqual({ x: 10, y: 8 });
    expect(h.plan().name).toBe(before.name);
    expect(d.summary).toContain('Room 1 (r)');
    expect(h.said).toEqual(['Assistant: plan replaced']);
    expect(h.steps()).toBe(1);
    h.undo();
    expect(h.plan()).toBe(before);
  });

  test('no is a tool error and changes nothing', async () => {
    const h = fakeHost();
    h.answer(false);
    const e = error(await h.call('replace_plan', { plan: next }));
    expect(e.kind).toBe('declined');
    expect(h.steps()).toBe(0);
  });

  test('an invalid plan is refused before asking, naming the field', async () => {
    const h = fakeHost();
    const bad = {
      ...next,
      items: [{ ...next.items[0], cut: { corner: 'tl', width: 1, depth: 1 } }],
    };
    const e = error(await h.call('replace_plan', { plan: bad }));
    expect(e.kind).toBe('invalid_plan');
    expect(e.error).toContain('plan.items.0.cut');
    const schema = error(await h.call('replace_plan', { plan: { ...next, unit: 'yd' } }));
    expect(schema.error).toContain('plan.unit');
    expect(h.asked).toEqual([]);
  });
});
