/**
 * Plan links that any assistant can write by hand: `#plan=<JSON>` (or `?plan=<JSON>`), the JSON a
 * plan in the format the MCP tools take, raw or percent-encoded. No tools, no compression: a chat
 * model writes the link as text and the user taps it.
 *
 * Chat apps and models do things to URLs, so this is tolerant: percent-encoding or not (a bad `%`
 * sequence is read raw), typographic quotes around keys and strings, trailing text after the JSON
 * (`).`, a closing Markdown bracket), a missing `version` (taken as 4), and a room given as
 * `width` and `depth` instead of an outline. Everything else (no unit, missing ids, a
 * counter-clockwise outline, a door off its wall) is `repair`'s job in `loadPlan(..., 'lenient')`.
 *
 * The JSON is data only: it goes through `loadPlan` like any other link, and labels are shown as
 * text. It is capped at PLAN_PARAM_MAX_CHARS once decoded.
 */
import { PLAN_VERSION } from '../schema';

export const PLAN_PARAM_KEY = 'plan';
/** The most JSON a plan link may carry, in characters once percent-decoded (16 KB). */
export const PLAN_PARAM_MAX_CHARS = 16 * 1024;

export type PlanParam =
  { status: 'none' } | { status: 'damaged' } | { status: 'ok'; data: Record<string, unknown> };

const PREFIX = `${PLAN_PARAM_KEY}=`;

/**
 * The raw text after `plan=` in the fragment, else in the query (with the fragment after it);
 * null when neither has it.
 */
function rawParam(url: URL): string | null {
  const hash = url.hash.replace(/^#/, '');
  if (hash.startsWith(PREFIX)) return hash.slice(PREFIX.length);
  const search = url.search.replace(/^\?/, '');
  const at = search.startsWith(PREFIX) ? 0 : search.indexOf(`&${PREFIX}`);
  if (at < 0) return null;
  // A `#` in the JSON (a colour) ends the query: the rest of the plan is in the fragment.
  return search.slice(at === 0 ? PREFIX.length : at + 1 + PREFIX.length) + url.hash;
}

/** Whether `href` carries a plan link. */
export const hasPlanParam = (href: string): boolean => rawParam(new URL(href)) !== null;

const decode = (raw: string): string => {
  try {
    return decodeURIComponent(raw);
  } catch {
    // A stray `%` (or one a chat app half-decoded): decode what can be decoded.
    return raw.replace(/%[0-9A-Fa-f]{2}/g, (m) => {
      try {
        return decodeURIComponent(m);
      } catch {
        return m;
      }
    });
  }
};

const SMART_QUOTES = /[“”„‟″«»]/g;

/** The JSON object in `text`, trying the tolerances in turn; null when none reads. */
function parseObject(text: string): Record<string, unknown> | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end < start) return null;
  const core = text.slice(start, end + 1);
  for (const candidate of [core, core.replace(SMART_QUOTES, '"')]) {
    try {
      const v: unknown = JSON.parse(candidate);
      if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
        return v as Record<string, unknown>;
      }
    } catch {
      /* the next tolerance */
    }
  }
  return null;
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** A room written as `{width, depth}` (and optional `x`, `y`): its rectangle as an outline. */
function roomFromSize(room: unknown): unknown {
  if (typeof room !== 'object' || room === null || Array.isArray(room)) return room;
  const r = room as Record<string, unknown>;
  if (r.outline !== undefined) return room;
  const width = r.width ?? r.w;
  const depth = r.depth ?? r.length ?? r.height ?? r.d;
  if (!finite(width) || !finite(depth)) return room;
  const x = finite(r.x) ? r.x : 0;
  const y = finite(r.y) ? r.y : 0;
  const { width: _w, depth: _d, length: _l, height: _h, w: _w2, d: _d2, x: _x, y: _y, ...rest } = r;
  return {
    ...rest,
    outline: [
      { x, y },
      { x: x + width, y },
      { x: x + width, y: y + depth },
      { x, y: y + depth },
    ],
  };
}

/** The plan in `href`'s `#plan=` (or `?plan=`), read as tolerantly as is safe. */
export function readPlanParam(href: string): PlanParam {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return { status: 'none' };
  }
  const raw = rawParam(url);
  if (raw === null) return { status: 'none' };
  // Encoded text is at most three times the decoded; anything longer is over the cap anyway.
  if (raw.length > PLAN_PARAM_MAX_CHARS * 3) return { status: 'damaged' };
  const text = decode(raw);
  if (text.length > PLAN_PARAM_MAX_CHARS) return { status: 'damaged' };
  const data = parseObject(text);
  if (!data) return { status: 'damaged' };
  const doc: Record<string, unknown> = { ...data };
  if (doc.version === undefined) doc.version = PLAN_VERSION;
  if (Array.isArray(doc.rooms)) doc.rooms = doc.rooms.map(roomFromSize);
  return { status: 'ok', data: doc };
}

/** `href` without its plan link. */
export function stripPlanParam(href: string): string {
  const url = new URL(href);
  if (url.hash.replace(/^#/, '').startsWith(PREFIX)) url.hash = '';
  const search = url.search.replace(/^\?/, '');
  const at = search.startsWith(PREFIX) ? 0 : search.indexOf(`&${PREFIX}`);
  // Everything from `plan=` on is the plan (its JSON may hold `&`).
  if (at >= 0) {
    url.search = at === 0 ? '' : search.slice(0, at);
    url.hash = '';
  }
  return url.toString();
}
