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
import { checkLayout, groupIssues, type Issue, type IssueCode } from '../src/core/check';
import { isRectangle, outlineArea, roomBounds } from '../src/core/geometry/walls';
import { formatIssues, loadPlan, type LoadIssue } from '../src/core/load';
import { PLAN_VERSION, Plan, UNITS, type Unit, type UNIT_SYSTEMS } from '../src/core/schema';
import { readPlanLink } from '../src/core/share/plan';
import { readReadableLink } from '../src/core/share/readable';
import {
  FEET_PER_CM,
  FEET_PER_INCH,
  FEET_PER_METER,
  feetToDisplay,
  fromFeet,
  roundNum,
} from '../src/core/units';
import { doorConnections, roomName } from '../src/core/floor';
import { planLink } from './link';

type UnitSystem = (typeof UNIT_SYSTEMS)[number];

export { type Issue, type IssueCode };

/**
 * What a tool returns: text for the model and plain clients, data for the rest. The plan viewer
 * (viewer/app.ts) draws `structured.plan` and marks `structured.issues` itself, so no drawing is
 * made here.
 */
export interface ToolOutcome {
  /**
   * The text content. A link, when there is one, is its last line, alone, as Markdown link text
   * (`[Open <plan> in Room Planner](url)`), the way the model should pass it on.
   */
  text: string;
  /** `structuredContent`. */
  structured?: Record<string, unknown>;
  isError?: boolean;
  /** For an invalid plan: one line per problem, `path: message` (the REST API's `errors`). */
  details?: string[];
  /** Counts for usage analytics (analytics.ts): never names, labels or coordinates. */
  stats: ToolStats;
}

/** Why a call failed, as a fixed vocabulary. */
export type ErrorKind =
  | 'missing_plan'
  | 'invalid_plan'
  | 'newer_version'
  | 'bad_argument'
  | 'missing_url'
  | 'bad_url'
  | 'no_plan_in_link'
  | 'damaged_link'
  // REST API only (api.ts).
  | 'bad_json'
  | 'too_large';

export interface ToolStats {
  errorKind?: ErrorKind;
  /** Whether an edit link was made (always, for a valid plan). */
  editable?: boolean;
  rooms?: number;
  items?: number;
  unit?: string;
  issues?: Issue[];
}

const planStats = (plan: Plan, unit: string, issues: Issue[]): ToolStats => ({
  rooms: plan.rooms.length,
  items: plan.items.length,
  unit,
  issues,
});

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

const failure = (text: string, errorKind: ErrorKind, details?: string[]): ToolOutcome => ({
  text,
  isError: true,
  ...(details ? { details } : {}),
  stats: { errorKind },
});

const fail = (
  text: string,
  errorKind: ErrorKind,
  details?: string[],
): { ok: false; outcome: ToolOutcome } => ({
  ok: false,
  outcome: failure(text, errorKind, details),
});

/** An invalid plan's problems, one `plan.path: message` line each. */
const invalidLines = (issues: LoadIssue[]): string[] =>
  formatIssues(issues.map((i) => ({ ...i, path: i.path.length ? ['plan', ...i.path] : i.path })));

const describeInvalid = (issues: LoadIssue[]): string => {
  const lines = invalidLines(issues);
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
  if (raw === undefined) {
    return fail('Missing argument "plan": send the whole plan document.', 'missing_plan');
  }
  const result = loadPlan(raw, 'strict');
  if (!result.ok) {
    if (result.reason === 'newer') {
      return fail(
        `This plan is version ${result.version}; this server reads plan versions up to ${PLAN_VERSION}. Send "version": ${PLAN_VERSION}.`,
        'newer_version',
      );
    }
    return fail(describeInvalid(result.issues), 'invalid_plan', invalidLines(result.issues));
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

/**
 * One paragraph: each room's size and area, its openings, the doors between rooms, and where the
 * pieces are.
 */
export function summarize(
  plan: Plan,
  unitSystem: UnitSystem = displayUnitOf(plan),
  { name = true }: { name?: boolean } = {},
): string {
  const len = (feet: number) => feetToDisplay(feet, unitSystem);
  const rooms = plan.rooms.map((room) => {
    const name = roomName(plan, room);
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
  const between = doorConnections(plan).map(
    ({ room, other }) => `${roomName(plan, room)} to ${roomName(plan, other)}`,
  );
  const placed = plan.items.filter((i) => i.placement && !i.hidden);
  const hidden = plan.items.filter((i) => i.placement && i.hidden);
  const aside = plan.items.filter((i) => !i.placement);
  const pieces = [`${count(placed.length, 'piece')} placed.`];
  if (hidden.length) pieces.push(`Hidden: ${nameList(hidden.map((i) => i.label || i.id))}.`);
  if (aside.length) pieces.push(`Set aside: ${nameList(aside.map((i) => i.label || i.id))}.`);
  const head = plan.rooms.length > 1 ? [`${count(plan.rooms.length, 'room')}.`] : [];
  const doors = between.length ? [`Doors between rooms: ${nameList(between)}.`] : [];
  return [...(name ? [`"${plan.name}":`] : []), ...head, ...rooms, ...doors, ...pieces].join(' ');
}

/** Entity ids listed for a group of issues, at most this many issues' worth. */
const IDS_SHOWN = 4;

/**
 * The issues for the model, grouped (the same message ten times is one line, `×10`), errors
 * first, each with its code and the ids it names.
 */
export const issueLines = (issues: Issue[]): string[] => {
  if (issues.length === 0) return ['No layout issues.'];
  const by = (sev: Issue['severity']) => issues.filter((i) => i.severity === sev).length;
  const counts = [
    count(by('error'), 'error'),
    count(by('warning'), 'warning'),
    `${by('info')} info`,
  ].filter((c) => !c.startsWith('0 '));
  return [
    `${count(issues.length, 'issue')} (${counts.join(', ')}):`,
    ...groupIssues(issues).map((g) => {
      const ids = g.ids
        .slice(0, IDS_SHOWN)
        .map((l) => l.join(', '))
        .filter(Boolean);
      const more = g.ids.length > IDS_SHOWN ? '; …' : '';
      const refs = ids.length ? `: ${ids.join('; ')}${more}` : '';
      return `- ${g.severity}${g.count > 1 ? ` ×${g.count}` : ''}: ${g.message} (${g.code}${refs})`;
    }),
  ];
};

/** Distances in the agent's unit converted to feet. */
const toFeet = (value: number, unit: Unit) => value * FEET_PER_UNIT[unit];

// --- Tools ---------------------------------------------------------------------------------------

/** `create_plan`: check a plan and make its edit link. */
export async function createPlan(args: { plan?: unknown }, origin: string): Promise<ToolOutcome> {
  const input = readPlanInput(args.plan);
  if (!input.ok) return input.outcome;
  const { plan, unit, unitSystem, warnings } = input;
  const issues = [...warnings, ...checkLayout(plan, { unitSystem })];
  const summary = summarize(plan, unitSystem);
  const url = await planLink(plan, origin);
  return {
    text: [summary, ...issueLines(issues), ...linkLines(plan.name, url)].join('\n'),
    structured: { plan: fromFeet(plan, unit), issues, summary, url, editable: true },
    stats: { ...planStats(plan, unit, issues), editable: true },
  };
}

/** Text for a Markdown link: brackets and backslashes escaped, on one line. */
const linkText = (text: string) => text.replace(/\s+/g, ' ').replace(/([\\[\]])/g, '\\$1');

/** The link as Markdown link text, `[Open <plan name> in Room Planner](url)`. */
export const markdownLink = (name: string, url: string): string =>
  `[${linkText(`Open ${name.trim() || 'the plan'} in Room Planner`)}](${url})`;

/**
 * The link as text: last, alone on its line, as Markdown link text, so a model passes it on as a
 * link rather than pasting a long URL, and a client that shows only text shows it whole.
 */
const linkLines = (name: string, url: string): string[] => [
  'Give the user this link as Markdown link text, like this, never as a bare URL; it holds the whole plan, so keep the URL whole:',
  markdownLink(name, url),
];

/** `check_layout`: every layout problem, no link and no drawing. */
export function checkPlan(args: { plan?: unknown; minClearance?: unknown }): ToolOutcome {
  const input = readPlanInput(args.plan);
  if (!input.ok) return input.outcome;
  const { plan, unit, unitSystem, warnings } = input;
  const mc = args.minClearance;
  if (mc !== undefined && (typeof mc !== 'number' || !Number.isFinite(mc) || mc < 0)) {
    return failure(
      "minClearance must be a number of 0 or more, in the plan's unit.",
      'bad_argument',
    );
  }
  const minClearance = typeof mc === 'number' ? toFeet(mc, unit) : undefined;
  const issues = [...warnings, ...checkLayout(plan, { unitSystem, minClearance })];
  const ok = !issues.some((i) => i.severity !== 'info');
  const summary = summarize(plan, unitSystem);
  return {
    text: [summary, ...issueLines(issues)].join('\n'),
    structured: { ok, issues, summary },
    stats: planStats(plan, unit, issues),
  };
}

/** The unit a plan read from a link goes back in: the one it displays in. */
const unitOfDisplay = (u: UnitSystem): Unit => (u === 'ft-in' ? 'ft' : u);

/** `read_plan`: the plan in a Room Planner link of any format. */
export async function readPlan(args: { url?: unknown }, origin: string): Promise<ToolOutcome> {
  const url = args.url;
  if (typeof url !== 'string' || !url.trim()) {
    return failure('Missing argument "url": the whole Room Planner link.', 'missing_url');
  }
  let href: string;
  try {
    href = new URL(url.trim()).toString();
  } catch {
    return failure(
      'This is not a URL. Send the whole Room Planner link, starting with https://.',
      'bad_url',
    );
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
    const kind: ErrorKind =
      result.reason === 'none'
        ? 'no_plan_in_link'
        : result.reason === 'damaged'
          ? 'damaged_link'
          : result.reason === 'newer'
            ? 'newer_version'
            : 'invalid_plan';
    return failure(text, kind, 'issues' in result ? invalidLines(result.issues) : undefined);
  }
  const plan = result.plan;
  const unitSystem = displayUnitOf(plan);
  const issues = checkLayout(plan, { unitSystem });
  const summary = summarize(plan, unitSystem);
  // What the link said that the planner could not use: a readable link's statements it skipped,
  // and what loading changed (a door clamped onto its wall, a piece without a size dropped).
  const readable = readReadableLink(href);
  const notes = [
    ...(readable.status === 'ok' ? readable.notes : []),
    // Ids are filled in for every link that has none (readable links never do): not news.
    ...result.repairs.filter((r) => !/: given the id "/.test(r)),
  ];
  // A fresh link on this site, never whatever host the link named.
  const link = await planLink(plan, origin);
  const noteLines = notes.length
    ? [
        'Not understood or changed when the link was read (fix these in your link):',
        ...notes.map((n) => `- ${n}`),
      ]
    : [];
  return {
    text: [summary, ...noteLines, ...issueLines(issues), ...linkLines(plan.name, link)].join('\n'),
    structured: {
      plan: fromFeet(plan, unitOfDisplay(unitSystem)),
      issues,
      summary,
      url: link,
      editable: true,
      ...(notes.length ? { notes } : {}),
    },
    stats: { ...planStats(plan, unitOfDisplay(unitSystem), issues), editable: true },
  };
}

// --- The plan as Markdown, for assistants that browse ------------------------------------------

const SECTIONS: { severity: Issue['severity']; title: string }[] = [
  { severity: 'error', title: 'Errors: fix these' },
  { severity: 'warning', title: 'Warnings: fix these too' },
  { severity: 'info', title: 'Tight gaps (6 in to 2 ft: too narrow to walk through)' },
];

/**
 * `GET /api/plan` for an assistant that opens web pages (ChatGPT, Claude, Perplexity browsing):
 * the plan in a link checked, as Markdown. Its summary, the issues grouped by severity, what to do
 * next, and the link to give the user. `check` is the address that checks a readable link.
 */
export function planMarkdown(outcome: ToolOutcome, origin: string): string {
  const checkUrl = `${new URL('/api/plan', origin).toString()}?p=<the text after #p= in your link>`;
  if (outcome.isError) {
    return [
      '# Room Planner could not read this plan',
      '',
      outcome.text,
      '',
      `Fix the link and check it again: ${checkUrl} (or ?url=<the whole link, URL-encoded>).`,
      '',
    ].join('\n');
  }
  const s = outcome.structured as {
    plan: Plan;
    issues: Issue[];
    summary: string;
    url: string;
    notes?: string[];
  };
  const name = s.plan.name?.trim() || 'Plan';
  const out = [`# ${name}`, '', s.summary.replace(`"${s.plan.name}": `, ''), ''];
  if (s.notes?.length) {
    out.push('## Not understood in the link', '', ...s.notes.map((n) => `- ${n}`), '');
  }
  const groups = groupIssues(s.issues);
  const blocking = s.issues.filter((i) => i.severity !== 'info').length + (s.notes?.length ?? 0);
  if (blocking === 0) {
    out.push(
      `No overlaps, blocked doors or pieces outside ${s.plan.rooms.length > 1 ? 'the rooms' : 'the room'}.`,
      '',
    );
  }
  for (const { severity, title } of SECTIONS) {
    const list = groups.filter((g) => g.severity === severity);
    if (!list.length) continue;
    out.push(`## ${title}`, '');
    for (const g of list) out.push(`- ${g.count > 1 ? `×${g.count} ` : ''}${g.message}`);
    out.push('');
  }
  out.push('## Next', '');
  if (blocking > 0) {
    out.push(
      `Move the pieces named above (positions are centres, x to the right and y down, in the plan's unit) until nothing overlaps and no door's swing or doorway is blocked, then check the new link again: ${checkUrl}. Do not give the user a plan with errors or warnings.`,
      '',
    );
  } else {
    out.push(
      'The layout checks out. Give the user this link as Markdown link text, never as a bare URL:',
      '',
      markdownLink(name, s.url),
      '',
    );
  }
  return out.join('\n');
}
