import Ajv2020 from 'ajv/dist/2020';
import { describe, expect, it } from 'vitest';
import before from './__fixtures__/plan-schema-v4.json';
import { API_EXAMPLE_PLAN } from '../src/lib/openapi';
import { DINING } from './fixtures';
import { planSchema } from './tools';

/**
 * The plan's JSON Schema (the MCP tools' input, /plan.schema.json, the OpenAPI document) may change
 * its descriptions but not what it accepts: the format is version 4. The fixture is the schema as
 * it was before the descriptions were rewritten (Room Planner MCP server 1.1.0).
 */
type Json = Record<string, unknown>;
const withoutDescriptions = (v: unknown): unknown =>
  Array.isArray(v)
    ? v.map(withoutDescriptions)
    : typeof v === 'object' && v !== null
      ? Object.fromEntries(
          Object.entries(v)
            .filter(([k]) => k !== 'description')
            .map(([k, x]) => [k, withoutDescriptions(x)]),
        )
      : v;

const now = planSchema();
const { $schema: _, ...old } = before as Json;

const rect = (id: string, x: number, y: number, w: number, d: number) => ({
  id,
  outline: [
    { x, y },
    { x: x + w, y },
    { x: x + w, y: y + d },
    { x, y: y + d },
  ],
});

const VALID: [string, Json][] = [
  ['the dining plan', DINING],
  ['the API example', API_EXAMPLE_PLAN],
  [
    'every optional field',
    {
      version: 4,
      name: 'Flat',
      unit: 'cm',
      settings: { unitSystem: 'm' },
      rooms: [
        {
          ...rect('living', 0, 0, 400, 300),
          name: 'Living room',
          openings: [
            { id: 'd1', kind: 'door', wall: 1, offset: 20, width: 90, from: 'bottom' },
            { id: 'd2', kind: 'door', wall: 2, offset: 0, width: 160, type: 'double-out' },
            {
              id: 'd3',
              kind: 'door',
              wall: 3,
              offset: 10,
              width: 80,
              hinge: 'end',
              swingAngle: 180,
            },
            { id: 'w1', kind: 'window', wall: 0, offset: 100, width: 120, from: 'end' },
          ],
        },
        rect('hall', 400, 0, 120, 300),
      ],
      items: [
        {
          id: 'sofa',
          label: 'Sofa',
          shape: 'l',
          width: 270,
          depth: 210,
          cut: { corner: 'tr', width: 180, depth: 120 },
          color: '#A1b2C3',
          placement: { x: 150, y: 120, rotation: 359.5 },
          locked: true,
          hidden: false,
          notes: 'Ours',
        },
        { id: 'table', label: 'Table', shape: 'ellipse', width: 110, depth: 110 },
      ],
      extra: 'unknown keys are kept (reported as unknown_field)',
    },
  ],
];

/** Each makes a valid plan invalid in one way. */
const BREAK: [string, (p: Json & { rooms: Json[]; items: Json[] }) => void][] = [
  ['no unit', (p) => delete p.unit],
  ['version 3', (p) => (p.version = 3)],
  ['unit "yd"', (p) => (p.unit = 'yd')],
  ['no rooms', (p) => (p.rooms = [])],
  ['an id with a space', (p) => (p.rooms[0]!.id = 'a b')],
  ['two corners', (p) => ((p.rooms[0]!.outline as unknown[]).length = 2)],
  ['a corner without y', (p) => delete (p.rooms[0]!.outline as Json[])[0]!.y],
  ['a corner far away', (p) => ((p.rooms[0]!.outline as Json[])[0]!.x = 200000)],
  [
    'a window of kind "arch"',
    (p) => (p.rooms[0]!.openings = [{ id: 'o', kind: 'arch', wall: 0, offset: 0, width: 1 }]),
  ],
  [
    'wall 1.5',
    (p) => (p.rooms[0]!.openings = [{ id: 'o', kind: 'door', wall: 1.5, offset: 0, width: 1 }]),
  ],
  [
    'a negative offset',
    (p) => (p.rooms[0]!.openings = [{ id: 'o', kind: 'door', wall: 0, offset: -1, width: 1 }]),
  ],
  [
    'from "middle"',
    (p) =>
      (p.rooms[0]!.openings = [
        { id: 'o', kind: 'door', wall: 0, offset: 0, width: 1, from: 'middle' },
      ]),
  ],
  [
    'swingAngle 45',
    (p) =>
      (p.rooms[0]!.openings = [
        { id: 'o', kind: 'door', wall: 0, offset: 0, width: 1, swingAngle: 45 },
      ]),
  ],
  [
    'door type "revolving"',
    (p) =>
      (p.rooms[0]!.openings = [
        { id: 'o', kind: 'door', wall: 0, offset: 0, width: 1, type: 'revolving' },
      ]),
  ],
  ['a piece of width 0', (p) => (p.items = [{ id: 'i', label: 'X', width: 0, depth: 1 }])],
  ['a piece without a label', (p) => (p.items = [{ id: 'i', width: 1, depth: 1 }])],
  [
    'rotation 360',
    (p) =>
      (p.items = [
        { id: 'i', label: 'X', width: 1, depth: 1, placement: { x: 0, y: 0, rotation: 360 } },
      ]),
  ],
  [
    'a shape "triangle"',
    (p) => (p.items = [{ id: 'i', label: 'X', width: 1, depth: 1, shape: 'triangle' }]),
  ],
  [
    'a cut corner "top"',
    (p) =>
      (p.items = [
        {
          id: 'i',
          label: 'X',
          width: 2,
          depth: 2,
          shape: 'l',
          cut: { corner: 'top', width: 1, depth: 1 },
        },
      ]),
  ],
  ['colour "red"', (p) => (p.items = [{ id: 'i', label: 'X', width: 1, depth: 1, color: 'red' }])],
  ['a 101-character name', (p) => (p.name = 'x'.repeat(101))],
  ['unitSystem "yd"', (p) => (p.settings = { unitSystem: 'yd' })],
];

describe('the plan JSON Schema', () => {
  it('has the same structure as before, with only its descriptions changed', () => {
    expect(withoutDescriptions(now)).toEqual(withoutDescriptions(old));
  });

  it('accepts and rejects the same plans as before', () => {
    const ajv = new Ajv2020({ strict: false });
    const [a, b] = [ajv.compile(old), ajv.compile(now)];
    const plans: [string, unknown, boolean][] = [
      ...VALID.map(([n, p]): [string, unknown, boolean] => [n, p, true]),
      ...VALID.flatMap(([n, p]) =>
        BREAK.map(([what, change]): [string, unknown, boolean] => {
          const copy = structuredClone(p) as Json & { rooms: Json[]; items: Json[] };
          change(copy);
          return [`${n} with ${what}`, copy, false];
        }),
      ),
    ];
    for (const [name, plan, valid] of plans) {
      expect(a(plan), name).toBe(valid);
      expect(b(plan), name).toBe(valid);
    }
  });
});
