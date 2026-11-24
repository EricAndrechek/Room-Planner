/**
 * What the MCP tools compute, without the protocol (docs/design/plan-format.md, section 7). Every
 * tool takes or returns a whole plan; the server keeps nothing between calls. Agent input is read
 * with `loadPlan(..., 'strict')`, so a mistake comes back as a tool error that names the field.
 * Plans go back in the unit the agent wrote, and every distance in a message is in the plan's
 * display unit.
 *
 * Pure: no SDK, no Worker APIs. The server (mcp.ts), the unit tests and the e2e tests call it.
 */
import * as z from 'zod/mini';
import { checkLayout, type Issue, type IssueCode } from '../src/core/check';
import { isRectangle, outlineArea, roomBounds } from '../src/core/geometry/walls';
import { formatIssues, loadPlan, type LoadIssue } from '../src/core/load';
import { buildPlanScene } from '../src/core/render/scene';
import { sceneToSvg } from '../src/core/render/svg';
import { PLAN_VERSION, Plan, UNITS, type Unit, type UNIT_SYSTEMS } from '../src/core/schema';
import { readPlanLink } from '../src/core/share/plan';
import {
  FEET_PER_CM,
  FEET_PER_INCH,
  FEET_PER_METER,
  feetToDisplay,
  fromFeet,
  roundNum,
} from '../src/core/units';
import { linkOmissions, planLink } from './link';

type UnitSystem = (typeof UNIT_SYSTEMS)[number];

export { type Issue, type IssueCode };

/** What a tool returns: text for the model and plain clients, data for the rest. */
export interface ToolOutcome {
  /** The text content. A link, when there is one, is its last line, alone. */
  text: string;
  /** `structuredContent`. */
  structured?: Record<string, unknown>;
  isError?: boolean;
  /** What the plan viewer draws (sent in the result's `_meta`, never to the model). */
  view?: ViewData;
}

/** The plan viewer's input (see viewer/viewer.html). */
export interface ViewData {
  title: string;
  summary: string;
  /** The drawing, with `data-id` on every room, opening and piece. */
  svg: string;
  issues: Issue[];
  url: string | null;
  /** Why there is no link, when there is none. */
  noLink?: string;
}

// --- Input schemas -----------------------------------------------------------------------------

let planJsonSchema: Record<string, unknown> | null = null;

/** The plan's JSON Schema as agents see it: fields with defaults are optional. */
export const planSchema = (): Record<string, unknown> => {
  if (!planJsonSchema) {
    const { $schema: _, ...schema } = z.toJSONSchema(Plan, { io: 'input' }) as Record<
      string,
      unknown
    >;
    planJsonSchema = schema;
  }
  return planJsonSchema;
};

// --- Reading a plan from an agent ----------------------------------------------------------------

const FEET_PER_UNIT: Record<Unit, number> = {
  ft: 1,
  in: FEET_PER_INCH,
  m: FEET_PER_METER,
  cm: FEET_PER_CM,
};

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Keys in `value` that the schema does not name, as `path.to.key`. The schema is loose (unknown
 * keys survive a load), which for an agent usually means a typo, so each is reported.
 */
export function unknownFields(
  value: unknown,
  schema: Json = planSchema(),
  path = 'plan',
): string[] {
  if (Array.isArray(value) && isObject(schema.items)) {
    return value.flatMap((v, i) => unknownFields(v, schema.items as Json, `${path}.${i}`));
  }
  if (!isObject(value) || !isObject(schema.properties)) return [];
  const props = schema.properties as Record<string, Json>;
  return Object.entries(value).flatMap(([key, v]) =>
    key in props ? unknownFields(v, props[key], `${path}.${key}`) : [`${path}.${key}`],
  );
}

export type ReadInput =
  | { ok: true; plan: Plan; unit: Unit; unitSystem: UnitSystem; warnings: Issue[] }
  | { ok: false; outcome: ToolOutcome };

const fail = (text: string): { ok: false; outcome: ToolOutcome } => ({
  ok: false,
  outcome: { text, isError: true },
});

const describeInvalid = (issues: LoadIssue[]): string => {
  const lines = formatIssues(
    issues.map((i) => ({ ...i, path: i.path.length ? ['plan', ...i.path] : i.path })),
  );
  const shown = lines.slice(0, 20);
  const more = lines.length > shown.length ? [`... and ${lines.length - shown.length} more.`] : [];
  return [
    'The plan is not valid. Fix these and call again:',
    ...shown.map((l) => `- ${l}`),
    ...more,
  ].join('\n');
};

/** The display unit of a plan in feet (`ft-in` when it names none). */
export const displayUnitOf = (plan: Plan): UnitSystem => plan.settings?.unitSystem ?? 'ft-in';

/** An agent's `plan` argument, checked strictly. The plan comes back in feet. */
export function readPlanInput(raw: unknown): ReadInput {
  if (raw === undefined) return fail('Missing argument "plan": send the whole plan document.');
  const result = loadPlan(raw, 'strict');
  if (!result.ok) {
    if (result.reason === 'newer') {
      return fail(
        `This plan is version ${result.version}; this server reads plan versions up to ${PLAN_VERSION}. Send "version": ${PLAN_VERSION}.`,
      );
    }
    return fail(describeInvalid(result.issues));
  }
  const unit =
    isObject(raw) && UNITS.includes(raw.unit as Unit) ? (raw.unit as Unit) : result.plan.unit;
  const warnings: Issue[] = unknownFields(raw).map((path) => ({
    code: 'unknown_field',
    severity: 'warning',
    message: `${path} is not a field of the plan format; it was kept but has no effect. Check its spelling.`,
    ids: [],
  }));
  return { ok: true, plan: result.plan, unit, unitSystem: displayUnitOf(result.plan), warnings };
}

// --- Describing a plan ---------------------------------------------------------------------------

const isMetric = (u: UnitSystem) => u === 'm' || u === 'cm';

const areaText = (sqft: number, unitSystem: UnitSystem): string =>
  isMetric(unitSystem)
    ? `${roundNum(sqft / (FEET_PER_METER * FEET_PER_METER), 1)} m²`
    : `${roundNum(sqft, 1)} sq ft`;

const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const nameList = (names: string[]): string =>
  names.length <= 5
    ? names.join(', ')
    : `${names.slice(0, 5).join(', ')} and ${names.length - 5} more`;

/** One paragraph: each room's size and area, its openings, and where the pieces are. */
export function summarize(plan: Plan, unitSystem: UnitSystem = displayUnitOf(plan)): string {
  const len = (feet: number) => feetToDisplay(feet, unitSystem);
  const rooms = plan.rooms.map((room) => {
    const name = room.name || room.id;
    const doors = room.openings.filter((o) => o.kind === 'door').length;
    const windows = room.openings.length - doors;
    const openings = `${count(doors, 'door')} and ${count(windows, 'window')}`;
    if (isRectangle(room)) {
      const b = roomBounds(room);
      const w = b.right - b.left;
      const d = b.bottom - b.top;
      return `${name} is ${len(w)} × ${len(d)} (${areaText(w * d, unitSystem)}) with ${openings}.`;
    }
    return `${name} has ${room.outline.length} corners and ${areaText(outlineArea(room), unitSystem)}, with ${openings}.`;
  });
  const placed = plan.items.filter((i) => i.placement && !i.hidden);
  const hidden = plan.items.filter((i) => i.placement && i.hidden);
  const stored = plan.items.filter((i) => !i.placement);
  const pieces = [`${count(placed.length, 'piece')} placed.`];
  if (hidden.length) pieces.push(`Hidden: ${nameList(hidden.map((i) => i.label || i.id))}.`);
  if (stored.length)
    pieces.push(`In the inventory: ${nameList(stored.map((i) => i.label || i.id))}.`);
  const head = plan.rooms.length > 1 ? [`${count(plan.rooms.length, 'room')}.`] : [];
  return [`"${plan.name}":`, ...head, ...rooms, ...pieces].join(' ');
}

const issueLines = (issues: Issue[]): string[] =>
  issues.length === 0
    ? ['No layout issues.']
    : [
        `${count(issues.length, 'issue')}:`,
        ...issues.map(
          (i) =>
            `- ${i.severity}: ${i.message} (${i.code}${i.ids.length ? `: ${i.ids.join(', ')}` : ''})`,
        ),
      ];

/** Distances in the agent's unit converted to feet. */
const toFeet = (value: number, unit: Unit) => value * FEET_PER_UNIT[unit];

/** The drawing the viewer shows, in the display unit. */
export const planDrawing = (plan: Plan, unitSystem: UnitSystem): string =>
  sceneToSvg(buildPlanScene({ plan, unitSystem, ids: true, date: new Date() }));

// --- Tools ---------------------------------------------------------------------------------------

/** `create_plan`: check a plan and make its edit link. */
export async function createPlan(args: { plan?: unknown }, origin: string): Promise<ToolOutcome> {
  const input = readPlanInput(args.plan);
  if (!input.ok) return input.outcome;
  const { plan, unit, unitSystem, warnings } = input;
  const issues = [...warnings, ...checkLayout(plan, { unitSystem })];
  const summary = summarize(plan, unitSystem);
  const link = await planLink(plan, origin);
  if (link.url === null) {
    return {
      isError: true,
      text: [
        `Room Planner cannot open this plan yet: ${link.blockers.join('; ')}.`,
        'The app currently edits one rectangular room with doors, windows and rectangular pieces that have a placement. Change the plan to fit and call create_plan again, or use check_layout to check it as it is.',
      ].join('\n'),
    };
  }
  const omitted = linkOmissions(plan);
  const text = [
    summary,
    ...issueLines(issues),
    ...(omitted.length ? [`The link does not carry ${omitted.join(' or ')} yet.`] : []),
    'Open and edit the plan in Room Planner (the whole plan is in the link; give it to the user exactly as it is):',
    link.url,
  ].join('\n');
  return {
    text,
    structured: { plan: fromFeet(plan, unit), issues, summary, url: link.url },
    view: { title: plan.name, summary, svg: planDrawing(plan, unitSystem), issues, url: link.url },
  };
}

/** `check_layout`: every layout problem, no link and no drawing. */
export function checkPlan(args: { plan?: unknown; minClearance?: unknown }): ToolOutcome {
  const input = readPlanInput(args.plan);
  if (!input.ok) return input.outcome;
  const { plan, unit, unitSystem, warnings } = input;
  const mc = args.minClearance;
  if (mc !== undefined && (typeof mc !== 'number' || !Number.isFinite(mc) || mc < 0)) {
    return {
      isError: true,
      text: "minClearance must be a number of 0 or more, in the plan's unit.",
    };
  }
  const minClearance = typeof mc === 'number' ? toFeet(mc, unit) : undefined;
  const issues = [...warnings, ...checkLayout(plan, { unitSystem, minClearance })];
  const ok = !issues.some((i) => i.severity !== 'info');
  const summary = summarize(plan, unitSystem);
  return { text: [summary, ...issueLines(issues)].join('\n'), structured: { ok, issues, summary } };
}

/** The unit a plan read from a link goes back in: the one it displays in. */
const unitOfDisplay = (u: UnitSystem): Unit => (u === 'ft-in' ? 'ft' : u);

/** `read_plan`: the plan in a Room Planner link of any format. */
export async function readPlan(args: { url?: unknown }, origin: string): Promise<ToolOutcome> {
  const url = args.url;
  if (typeof url !== 'string' || !url.trim()) {
    return { isError: true, text: 'Missing argument "url": the whole Room Planner link.' };
  }
  let href: string;
  try {
    href = new URL(url.trim()).toString();
  } catch {
    return {
      isError: true,
      text: 'This is not a URL. Send the whole Room Planner link, starting with https://.',
    };
  }
  const result = await readPlanLink(href);
  if (!result.ok) {
    const text =
      result.reason === 'none'
        ? 'This link has no plan in it. A Room Planner plan link contains #s=, #j= or ?config=.'
        : result.reason === 'damaged'
          ? 'The plan in this link is damaged, most likely cut off or changed when it was copied. Ask the user for the whole link.'
          : result.reason === 'newer'
            ? `This link holds a plan of version ${result.version}; this server reads versions up to ${PLAN_VERSION}.`
            : 'issues' in result
              ? describeInvalid(result.issues)
              : 'This link has no plan in it.';
    return { isError: true, text };
  }
  const plan = result.plan;
  const unitSystem = displayUnitOf(plan);
  const issues = checkLayout(plan, { unitSystem });
  const summary = summarize(plan, unitSystem);
  // The same payload on this site, so the button never leads to whatever host the link named.
  const parsed = new URL(href);
  const own = new URL(`/${parsed.search}${parsed.hash}`, origin).toString();
  return {
    text: [summary, ...issueLines(issues)].join('\n'),
    structured: { plan: fromFeet(plan, unitOfDisplay(unitSystem)), issues, summary },
    view: {
      title: plan.name,
      summary,
      svg: planDrawing(plan, unitSystem),
      issues,
      url: own,
    },
  };
}
