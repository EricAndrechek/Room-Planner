/**
 * The plan viewer's script (an MCP Apps view, SEP-1865, protocol 2026-01-26). scripts/
 * build-viewer.mjs bundles it into viewer.html, so the view is one self-contained file.
 *
 * The view draws the plan itself, with the same core code as the app's export: the server sends
 * the plan (`structuredContent.plan`), not a drawing, so a tool call costs the server no drawing
 * time (Workers Free allows 10 ms of CPU per request) and the model's context no SVG.
 *
 * It speaks the postMessage JSON-RPC by hand (a few dozen lines) instead of with the ext-apps
 * `App` class, whose browser bundle is 129 KB gzip.
 */
import type { Issue } from '../../src/core/check';
import { buildPlanScene } from '../../src/core/render/scene';
import { sceneToSvg } from '../../src/core/render/svg';
import type { Plan, UNIT_SYSTEMS } from '../../src/core/schema';
import { toFeet } from '../../src/core/units';

type UnitSystem = (typeof UNIT_SYSTEMS)[number];
type Json = Record<string, unknown>;
interface ToolResult {
  content?: { type: string; text?: string }[];
  structuredContent?: {
    plan?: Plan;
    issues?: Issue[];
    summary?: string;
    url?: string | null;
    editable?: boolean;
    notEditable?: string[];
  };
  isError?: boolean;
}
interface HostContext {
  theme?: 'light' | 'dark';
  styles?: { variables?: Record<string, string | undefined> };
  safeAreaInsets?: { top: number; right: number; bottom: number; left: number };
}

const PROTOCOL = '2026-01-26';
const $ = (id: string) => document.getElementById(id)!;
const host = window.parent !== window ? window.parent : null;
let nextId = 1;
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: unknown) => void }>();
let connected = false;
let url: string | null = null;

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

// --- Host context: theme, the host's colours and fonts, safe areas -----------------------------

function applyContext(ctx: HostContext | undefined) {
  if (!ctx) return;
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
}

// --- Size: tell the host how tall the view is ---------------------------------------------------

let lastHeight = 0;
function reportSize() {
  const height = Math.ceil(document.documentElement.scrollHeight);
  if (!connected || height === lastHeight) return;
  lastHeight = height;
  notify('ui/notifications/size-changed', {
    width: Math.ceil(document.documentElement.scrollWidth),
    height,
  });
}
new ResizeObserver(() => requestAnimationFrame(reportSize)).observe(document.body);

// --- Drawing a result ---------------------------------------------------------------------------

const textOf = (result: ToolResult) =>
  (result.content ?? [])
    .filter((c) => c?.type === 'text')
    .map((c) => c.text)
    .join('\n');

/** The plan's drawing, tagged with entity ids, or null when the plan cannot be drawn. */
function drawing(plan: Plan | undefined): SVGSVGElement | null {
  if (!plan || !Array.isArray(plan.rooms) || !plan.rooms.length) return null;
  try {
    const feet = toFeet(plan);
    const unitSystem: UnitSystem =
      feet.settings?.unitSystem ?? (plan.unit === 'ft' ? 'ft-in' : plan.unit);
    const svg = sceneToSvg(buildPlanScene({ plan: feet, unitSystem, ids: true }));
    const root = new DOMParser().parseFromString(svg, 'image/svg+xml').documentElement;
    if (root.nodeName !== 'svg') return null;
    const el = document.importNode(root, true) as unknown as SVGSVGElement;
    el.removeAttribute('width');
    el.removeAttribute('height');
    return el;
  } catch {
    return null;
  }
}

function show(result: ToolResult) {
  const data = result.structuredContent;
  const sheet = $('sheet');
  sheet.replaceChildren();
  $('note').textContent = '';
  if (result.isError || !data) {
    // An error, or a host that passes no structured result: the text is all there is.
    $('title').textContent = 'Room Planner';
    $('summary').textContent = textOf(result) || 'The plan could not be shown.';
    sheet.hidden = true;
    $('issues-section').hidden = true;
    $('open').hidden = true;
    return;
  }
  const name = data.plan?.name ?? 'Plan';
  $('title').textContent = name;
  // The summary starts with the plan's name, which is the heading here.
  $('summary').textContent = (data.summary ?? '').replace(`"${name}": `, '');
  url = data.url ?? null;
  $('open').hidden = !url;
  const svg = drawing(data.plan);
  if (svg) sheet.append(svg);
  sheet.hidden = !svg;
  if (!svg) $('note').textContent = 'The drawing could not be made; open the plan to see it.';
  else if (data.editable === false) {
    const why = data.notEditable?.length ? ` with ${data.notEditable.join(', ')}` : '';
    $('note').textContent =
      `Room Planner's editor can't open plans${why} yet; the drawing shows this one in full.`;
  }
  renderIssues(data.issues ?? [], svg);
}

const entities = (svg: SVGSVGElement | null, ids: string[]) =>
  svg ? ids.flatMap((id) => [...svg.querySelectorAll(`g[data-id="${CSS.escape(id)}"]`)]) : [];

function issueButton(issue: Issue, onPick: (b: HTMLButtonElement, i: Issue) => void) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'issue';
  button.setAttribute('aria-pressed', 'false');
  const badge = document.createElement('span');
  badge.className = `badge ${issue.severity}`;
  badge.textContent = issue.severity;
  const msg = document.createElement('span');
  msg.textContent = issue.message;
  button.append(badge, msg);
  button.addEventListener('click', () => onPick(button, issue));
  return button;
}

function renderIssues(issues: Issue[], svg: SVGSVGElement | null) {
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

  let active: Issue | null = null;
  const pick = (button: HTMLButtonElement, issue: Issue) => {
    active = active === issue ? null : issue;
    for (const b of section.querySelectorAll('button')) b.setAttribute('aria-pressed', 'false');
    if (!svg) return;
    for (const el of svg.querySelectorAll('.focus')) el.classList.remove('focus');
    svg.classList.remove('focusing');
    if (!active) return;
    const found = entities(svg, active.ids ?? []);
    for (const el of found) el.classList.add('focus');
    svg.classList.toggle('focusing', found.length > 0);
    button.setAttribute('aria-pressed', 'true');
  };
  const item = (issue: Issue) => {
    const li = document.createElement('li');
    li.append(issueButton(issue, pick));
    return li;
  };

  const main = issues.filter((i) => i.severity !== 'info');
  main.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'error' ? -1 : 1));
  for (const issue of main) list.append(item(issue));
  if (!main.length) {
    const li = document.createElement('li');
    li.className = 'ok';
    li.textContent = 'No overlaps, blocked doors or pieces outside the room.';
    list.append(li);
  }
  // Tight gaps (info) are many and minor: listed under a closed disclosure.
  const infos = issues.filter((i) => i.severity === 'info');
  if (infos.length) {
    const details = document.createElement('details');
    const summary = document.createElement('summary');
    summary.textContent = infos.length === 1 ? '1 tight gap' : `${infos.length} tight gaps`;
    const ul = document.createElement('ul');
    for (const issue of infos) ul.append(item(issue));
    details.append(summary, ul);
    section.append(details);
  }
}

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
    appCapabilities: {},
  })
    .then((result) => {
      connected = true;
      applyContext((result as { hostContext?: HostContext } | undefined)?.hostContext);
      notify('ui/notifications/initialized', {});
      reportSize();
    })
    .catch(() => {
      $('summary').textContent = 'This client could not start the plan viewer.';
    });
}
