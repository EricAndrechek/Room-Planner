/**
 * The plan viewer's script (an MCP Apps view, SEP-1865, protocol 2026-01-26). scripts/
 * build-viewer.mjs bundles it into viewer.html, so the view is one self-contained file.
 *
 * The view draws the plan itself, with the same core code as the app's export: the server sends
 * the plan (`structuredContent.plan`), not a drawing, so a tool call costs the server no drawing
 * time (Workers Free allows 10 ms of CPU per request) and the model's context no SVG.
 *
 * It speaks the postMessage JSON-RPC by hand (a few dozen lines) instead of with the ext-apps
 * `App` class, whose browser bundle is 129 KB gzip. Method and field names are the spec's
 * (ext-apps specification/2026-01-26/apps.mdx and src/spec.types.ts).
 */
import { groupIssues, type Issue, type IssueGroup } from '../../src/core/check';
import { buildPlanScene } from '../../src/core/render/scene';
import { sceneToSvg } from '../../src/core/render/svg';
import type { Item, Plan, UNIT_SYSTEMS } from '../../src/core/schema';
import { feetToDisplay, toFeet } from '../../src/core/units';

type UnitSystem = (typeof UNIT_SYSTEMS)[number];
type Json = Record<string, unknown>;
type DisplayMode = 'inline' | 'fullscreen' | 'pip';
interface ToolResult {
  content?: { type: string; text?: string }[];
  structuredContent?: {
    plan?: Plan;
    issues?: Issue[];
    summary?: string;
    url?: string | null;
    editable?: boolean;
  };
  isError?: boolean;
}
interface HostContext {
  theme?: 'light' | 'dark';
  styles?: { variables?: Record<string, string | undefined> };
  safeAreaInsets?: { top: number; right: number; bottom: number; left: number };
  displayMode?: DisplayMode;
  availableDisplayModes?: DisplayMode[];
  containerDimensions?: { height?: number; maxHeight?: number; width?: number; maxWidth?: number };
}

const PROTOCOL = '2026-01-26';
const $ = (id: string) => document.getElementById(id)!;
const host = window.parent !== window ? window.parent : null;
let nextId = 1;
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: unknown) => void }>();
let connected = false;
let url: string | null = null;
/** The host context so far: `host-context-changed` sends only what changed. */
const context: HostContext = {};

// --- JSON-RPC over postMessage to the host ----------------------------------------------------

const post = (msg: Json) => host?.postMessage({ jsonrpc: '2.0', ...msg }, '*');
const request = (method: string, params: Json) =>
  new Promise<unknown>((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    post({ id, method, params });
  });
const notify = (method: string, params: Json) => post({ method, params });

window.addEventListener('message', (event) => {
  if (host && event.source !== host) return;
  const msg = event.data as Json | null;
  if (!msg || msg.jsonrpc !== '2.0') return;
  if ('id' in msg && !('method' in msg)) {
    const p = pending.get(msg.id as number);
    if (!p) return;
    pending.delete(msg.id as number);
    if (msg.error) p.reject(msg.error);
    else p.resolve(msg.result);
    return;
  }
  const params = (msg.params ?? {}) as Json;
  switch (msg.method) {
    case 'ui/notifications/tool-result':
      show(params as ToolResult);
      break;
    case 'ui/notifications/tool-input':
      $('summary').textContent = 'Checking the plan…';
      break;
    case 'ui/notifications/tool-cancelled':
      $('summary').textContent = 'The request was cancelled.';
      break;
    case 'ui/notifications/host-context-changed':
      applyContext(params as HostContext);
      break;
    case 'ui/resource-teardown':
    case 'ping':
      if ('id' in msg) post({ id: msg.id, result: {} });
      break;
    default:
      if ('id' in msg) post({ id: msg.id, error: { code: -32601, message: 'Method not found' } });
  }
});

// --- Host context: theme, the host's colours and fonts, safe areas, display mode ----------------

function applyContext(ctx: HostContext | undefined) {
  if (!ctx) return;
  Object.assign(context, ctx);
  const root = document.documentElement;
  if (ctx.theme === 'dark' || ctx.theme === 'light') root.dataset.theme = ctx.theme;
  for (const [k, v] of Object.entries(ctx.styles?.variables ?? {})) {
    if (k.startsWith('--') && typeof v === 'string') root.style.setProperty(k, v);
  }
  const inset = ctx.safeAreaInsets;
  if (inset) {
    const main = document.querySelector('main')!;
    main.style.padding = [inset.top, inset.right, inset.bottom, inset.left]
      .map((n) => `${12 + (n || 0)}px`)
      .join(' ');
  }
  setMode(context.displayMode ?? 'inline');
}

/** The full-screen button, offered only when the host can show the view full screen. */
function setMode(mode: DisplayMode) {
  const full = mode === 'fullscreen';
  document.documentElement.dataset.mode = mode;
  const button = $('fullscreen');
  button.hidden = !connected || !context.availableDisplayModes?.includes('fullscreen');
  button.querySelector('span')!.textContent = full ? 'Exit full screen' : 'Full screen';
  capDrawing();
  if (!full) {
    // Back inline: the host needs the content's height again, even if it has not changed.
    lastHeight = 0;
    queueSize();
  }
}

$('fullscreen').addEventListener('click', async () => {
  const want: DisplayMode = context.displayMode === 'fullscreen' ? 'inline' : 'fullscreen';
  try {
    const result = (await request('ui/request-display-mode', { mode: want })) as
      { mode?: DisplayMode } | undefined;
    // The host answers with the mode it set, which may not be the one asked for.
    context.displayMode = result?.mode ?? context.displayMode;
    setMode(context.displayMode ?? 'inline');
  } catch {
    // The host keeps the mode it has.
  }
});

// --- Size: tell the host how tall the view is ---------------------------------------------------

const main = document.querySelector('main')!;
let lastHeight = 0;
let lastWidth = 0;
let sizeQueued = false;
/**
 * Reports main's own height, not the document's: once the host has made the frame taller (a
 * longer list, then closed), the document is as tall as the frame, and a view that reports that
 * keeps the blank space below its content.
 */
function reportSize() {
  sizeQueued = false;
  // Full screen is the host's size, not the content's: nothing to report.
  if (!connected || context.displayMode === 'fullscreen') return;
  const height = Math.ceil(main.getBoundingClientRect().height);
  const width = Math.ceil(window.innerWidth);
  if (height === lastHeight && width === lastWidth) return;
  lastHeight = height;
  lastWidth = width;
  notify('ui/notifications/size-changed', { width, height });
}
const queueSize = () => {
  if (sizeQueued) return;
  sizeQueued = true;
  requestAnimationFrame(reportSize);
};
new ResizeObserver(queueSize).observe(main);
void document.fonts?.ready.then(() => {
  fitLabels();
  queueSize();
});

/**
 * The drawing's size. Its tallest is the room the host gives (`containerDimensions`) less the
 * rest of the view, or the window's height in full screen, and 560 px inline when the host gives
 * no limit. A tall plan on a wide card goes on the left with the issues beside it, so the card is
 * not a narrow drawing in a wide frame with the list under it.
 */
function capDrawing() {
  const sheet = $('sheet');
  const svg = sheet.querySelector('svg');
  if (sheet.hidden || !svg) {
    main.classList.remove('side');
    return;
  }
  const box = svg.viewBox.baseVal;
  const style = getComputedStyle(main);
  const inner = main.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
  const tall = box.height / box.width;
  const side = inner >= 600 && tall >= 1.15;
  main.classList.toggle('side', side);
  const full = context.displayMode === 'fullscreen';
  const dims = context.containerDimensions;
  const room = full ? window.innerHeight : (dims?.height ?? dims?.maxHeight);
  const mainBox = main.getBoundingClientRect();
  const figure = $('figure').getBoundingClientRect();
  let rest = figure.top - mainBox.top + parseFloat(style.paddingBottom);
  if (!side && !full) {
    // Everything else in the view under the drawing too, with the tight gaps closed.
    const openList = main.querySelector('details[open] > ul');
    rest = mainBox.height - figure.height - (openList?.getBoundingClientRect().height ?? 0);
  }
  let cap = full ? Infinity : 560;
  if (room) cap = Math.min(cap, room - rest);
  cap = Math.max(220, Math.floor(cap));
  sheet.style.setProperty('--sheet-max', `${cap}px`);
  if (side)
    sheet.style.setProperty('--sheet-w', `${Math.floor(Math.min(cap / tall, inner * 0.6))}px`);
}
window.addEventListener('resize', () => {
  capDrawing();
  fitLabels();
});

// --- Drawing a result ---------------------------------------------------------------------------

const textOf = (result: ToolResult) =>
  (result.content ?? [])
    .filter((c) => c?.type === 'text')
    .map((c) => c.text)
    .join('\n');

/** The plan in feet and its display units, for the drawing and the pieces' sizes. */
let shown: { items: Map<string, Item>; unitSystem: UnitSystem } | null = null;

/**
 * The plan's drawing, tagged with entity ids, or null when the plan cannot be drawn: the plan
 * alone (`chrome: 'none'`), since the view shows its name and size above it. A floor of several
 * rooms comes with each room's name and area, and pieces set aside are listed under it.
 */
function drawing(plan: Plan | undefined): SVGSVGElement | null {
  shown = null;
  if (!plan || !Array.isArray(plan.rooms) || !plan.rooms.length) return null;
  try {
    const feet = toFeet(plan);
    const unitSystem: UnitSystem =
      feet.settings?.unitSystem ?? (plan.unit === 'ft' ? 'ft-in' : plan.unit);
    const svg = sceneToSvg(buildPlanScene({ plan: feet, unitSystem, ids: true, chrome: 'none' }));
    const root = new DOMParser().parseFromString(svg, 'image/svg+xml').documentElement;
    if (root.nodeName !== 'svg') return null;
    const el = document.importNode(root, true) as unknown as SVGSVGElement;
    el.removeAttribute('width');
    el.removeAttribute('height');
    shown = { items: new Map(feet.items.map((i) => [i.id, i])), unitSystem };
    for (const g of el.querySelectorAll('g[data-role="item"]')) {
      const size = sizeOf(g.getAttribute('data-id'));
      if (!size) continue;
      // Hover shows a piece's name and size where its label has no room for the size.
      const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
      title.textContent = size;
      g.append(title);
    }
    return el;
  } catch {
    return null;
  }
}

/** "Chair · 18 in × 20 in" for a piece in the drawing. */
function sizeOf(id: string | null): string | null {
  const item = id ? shown?.items.get(id) : undefined;
  if (!item || !shown) return null;
  const { unitSystem } = shown;
  const name = item.label.trim() || 'Piece';
  return `${name} · ${feetToDisplay(item.width, unitSystem)} × ${feetToDisplay(item.depth, unitSystem)}`;
}

/** On-screen sizes (CSS px) below which a piece's size line is left out, and its name grows to. */
const SIZE_LINE_MIN_PX = 7.5;
const NAME_PX = 10.5;
const DIMENSION_PX = 10;
const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Labels for the drawing's size on screen. The export writes each piece's name and, where there
 * is room, its size under it, at sizes for a page; a phone shows the drawing at half that, where
 * a size line is too small to read and crowds the plan. So when it would be smaller than
 * SIZE_LINE_MIN_PX, the size line is hidden (hover, or a tap, shows it) and the name is centred,
 * and grown towards NAME_PX as far as the piece has room.
 */
function fitLabels() {
  const svg = document.querySelector<SVGSVGElement>('#sheet svg');
  if (!svg) return;
  const box = svg.viewBox.baseVal;
  const rect = svg.getBoundingClientRect();
  // The drawing keeps its proportions inside the element (a max-height letterboxes it).
  const scale = box?.width ? Math.min(rect.width / box.width, rect.height / box.height) : 0;
  if (!scale) return;
  // The room's dimensions, as large as their space above and left of the walls allows.
  for (const text of svg.querySelectorAll<SVGTextElement>('g[data-role="dimension"] > text')) {
    text.dataset.size ??= text.getAttribute('font-size') ?? '12';
    const s0 = Number(text.dataset.size);
    const size = Math.max(s0, Math.min(DIMENSION_PX / scale, s0 * 1.45));
    text.setAttribute('font-size', String(Math.round(size * 100) / 100));
  }
  for (const g of svg.querySelectorAll('g[data-role="item"]')) {
    const shape = [...g.children].find((c) => c.namespaceURI === SVG_NS && c.tagName !== 'title');
    const [name, dims] = [...g.querySelectorAll<SVGTextElement>(':scope > text')];
    if (!name || !shape) continue;
    name.dataset.y ??= name.getAttribute('y') ?? '0';
    name.dataset.size ??= name.getAttribute('font-size') ?? '13';
    const y0 = Number(name.dataset.y);
    const s0 = Number(name.dataset.size);
    const d = dims ? Number(dims.getAttribute('font-size')) : 0;
    // The centre of the label area: the name sits above it when the size line is under it.
    const centre = d ? y0 + 0.62 * d - 0.35 * s0 : y0 - 0.35 * s0;
    const compact = !d || d * scale < SIZE_LINE_MIN_PX;
    if (dims) dims.style.display = compact ? 'none' : '';
    let size = s0;
    if (compact && s0 * scale < NAME_PX && shape.tagName === 'rect') {
      // A rectangle's label runs along its longer side: room for the name at a larger size.
      const w = Number(shape.getAttribute('width'));
      const h = Number(shape.getAttribute('height'));
      const length = Math.max(w, h) - 8;
      const thickness = Math.min(w, h) - 4;
      name.setAttribute('font-size', String(s0));
      const natural = name.getComputedTextLength();
      if (natural > 0) {
        size = Math.max(s0, Math.min(NAME_PX / scale, (s0 * length) / natural, thickness / 1.15));
      }
    }
    name.setAttribute('font-size', String(Math.round(size * 100) / 100));
    const y = compact ? centre + 0.35 * size : y0;
    name.setAttribute('y', String(Math.round(y * 100) / 100));
  }
}
new ResizeObserver(() => fitLabels()).observe($('sheet'));

/** The link in a text result: the Markdown link the tools end with, or a bare one. */
function linkIn(text: string): { url: string; text: string } | null {
  const md = /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/.exec(text);
  if (md) return { url: md[2]!, text: text.replace(md[0], md[1]!) };
  const bare = /https?:\/\/\S+#s=[\w-]+/.exec(text);
  return bare ? { url: bare[0], text } : null;
}

function show(result: ToolResult) {
  const data = result.structuredContent;
  const sheet = $('sheet');
  const summary = $('summary');
  sheet.replaceChildren();
  $('note').textContent = '';
  $('picked').hidden = true;
  summary.classList.remove('text');
  if (result.isError || !data) {
    // An error, or a host that passes no structured result: the text is all there is.
    $('title').textContent = 'Room Planner';
    const text = textOf(result) || 'The plan could not be shown.';
    const link = result.isError ? null : linkIn(text);
    summary.textContent = link?.text ?? text;
    summary.classList.add('text');
    url = link?.url ?? null;
    $('open').hidden = !url;
    sheet.hidden = true;
    $('figure').hidden = true;
    $('issues-section').hidden = true;
    return;
  }
  const name = data.plan?.name ?? 'Plan';
  $('title').textContent = name;
  // The summary starts with the plan's name, which is the heading here.
  summary.textContent = (data.summary ?? '').replace(`"${name}": `, '');
  url = data.url ?? null;
  $('open').hidden = !url;
  const svg = drawing(data.plan);
  if (svg) sheet.append(svg);
  sheet.hidden = !svg;
  $('figure').hidden = !svg;
  if (!svg) $('note').textContent = 'The drawing could not be made; open the plan to see it.';
  renderIssues(data.issues ?? [], svg, (data.plan?.rooms?.length ?? 1) > 1);
  requestAnimationFrame(() => {
    capDrawing();
    fitLabels();
  });
}

const entities = (svg: SVGSVGElement | null, ids: string[]) =>
  svg ? ids.flatMap((id) => [...svg.querySelectorAll(`g[data-id="${CSS.escape(id)}"]`)]) : [];

/** Points at the entities given (the pieces of an issue, or one piece tapped); none clears. */
function focusOn(svg: SVGSVGElement | null, ids: string[]) {
  if (!svg) return;
  for (const el of svg.querySelectorAll('.focus')) el.classList.remove('focus');
  const found = entities(svg, ids);
  for (const el of found) el.classList.add('focus');
  svg.classList.toggle('focusing', found.length > 0);
}

function groupButton(group: IssueGroup, onPick: (b: HTMLButtonElement) => void) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'issue';
  button.setAttribute('aria-pressed', 'false');
  const badge = document.createElement('span');
  badge.className = `badge ${group.severity}`;
  badge.textContent = group.severity;
  const msg = document.createElement('span');
  msg.className = 'msg';
  msg.textContent = group.message;
  button.append(badge, msg);
  if (group.count > 1) {
    const count = document.createElement('span');
    count.className = 'count';
    count.textContent = `×${group.count}`;
    count.title = `${group.count} places`;
    button.append(count);
  }
  button.addEventListener('click', () => onPick(button));
  return button;
}

function renderIssues(issues: Issue[], svg: SVGSVGElement | null, several: boolean) {
  // Errors and warnings are marked on the drawing; info (tight gaps) only when chosen.
  for (const issue of issues) {
    if (issue.severity === 'info') continue;
    for (const el of entities(svg, issue.ids ?? [])) {
      el.classList.add(issue.severity === 'error' ? 'hl-error' : 'hl-warning');
    }
  }
  const section = $('issues-section');
  const list = $('issues');
  list.replaceChildren();
  for (const d of section.querySelectorAll('details')) d.remove();
  section.hidden = false;

  const groups = groupIssues(issues);
  let active: HTMLButtonElement | null = null;
  const pick = (group: IssueGroup) => (button: HTMLButtonElement) => {
    active = active === button ? null : button;
    for (const b of section.querySelectorAll('button')) b.setAttribute('aria-pressed', 'false');
    $('picked').hidden = true;
    focusOn(svg, active ? group.ids.flat() : []);
    if (active) button.setAttribute('aria-pressed', 'true');
  };
  const item = (group: IssueGroup) => {
    const li = document.createElement('li');
    li.append(groupButton(group, pick(group)));
    return li;
  };

  const main = groups.filter((g) => g.severity !== 'info');
  for (const group of main) list.append(item(group));
  // "No overlaps, ..." needs no heading over it.
  $('issues-title').hidden = !main.length;
  if (!main.length) {
    const li = document.createElement('li');
    li.className = 'ok';
    li.textContent = `No overlaps, blocked doors or pieces outside ${several ? 'the rooms' : 'the room'}.`;
    list.append(li);
  }
  // Tight gaps (info) are many and minor: listed under a closed disclosure.
  const infos = groups.filter((g) => g.severity === 'info');
  if (infos.length) {
    const total = infos.reduce((n, g) => n + g.count, 0);
    const gaps = infos.every((g) => g.code === 'tight_clearance');
    const details = document.createElement('details');
    const summary = document.createElement('summary');
    summary.textContent = gaps
      ? total === 1
        ? '1 tight gap'
        : `${total} tight gaps`
      : total === 1
        ? '1 note'
        : `${total} notes`;
    const ul = document.createElement('ul');
    for (const group of infos) ul.append(item(group));
    details.append(summary, ul);
    // Toggling changes the height: ResizeObserver reports it, this makes sure.
    details.addEventListener('toggle', queueSize);
    section.append(details);
  }
}

// A tap on a piece names it and gives its size (which a small drawing leaves out).
$('sheet').addEventListener('click', (event) => {
  const svg = document.querySelector<SVGSVGElement>('#sheet svg');
  const g = (event.target as Element).closest?.('g[data-role="item"]');
  const picked = $('picked');
  for (const b of $('issues-section').querySelectorAll('button[aria-pressed="true"]')) {
    b.setAttribute('aria-pressed', 'false');
  }
  const size = g ? sizeOf(g.getAttribute('data-id')) : null;
  const again = g?.classList.contains('focus') && !picked.hidden;
  if (!g || !size || again) {
    picked.hidden = true;
    focusOn(svg, []);
    return;
  }
  picked.textContent = size;
  picked.hidden = false;
  focusOn(svg, [g.getAttribute('data-id')!]);
});

// --- Open in Room Planner -----------------------------------------------------------------------

$('open').addEventListener('click', async () => {
  if (!url) return;
  if (!connected) {
    window.open(url, '_blank', 'noopener');
    return;
  }
  try {
    const result = (await request('ui/open-link', { url })) as { isError?: boolean } | undefined;
    if (result?.isError) throw new Error('refused');
  } catch {
    $('note').textContent = `Could not open the link here. Copy it: ${url}`;
  }
});

// --- Handshake ----------------------------------------------------------------------------------

if (!host) {
  $('summary').textContent = 'Open this view from an MCP client to see a plan.';
} else {
  request('ui/initialize', {
    protocolVersion: PROTOCOL,
    appInfo: { name: 'room-planner-plan-viewer', version: '1.0.0' },
    appCapabilities: { availableDisplayModes: ['inline', 'fullscreen'] },
  })
    .then((result) => {
      connected = true;
      applyContext((result as { hostContext?: HostContext } | undefined)?.hostContext);
      notify('ui/notifications/initialized', {});
      queueSize();
    })
    .catch(() => {
      $('summary').textContent = 'This client could not start the plan viewer.';
    });
}
