/**
 * Registers the WebMCP tools with the browser (docs/design/plan-format.md, section 8). Loaded
 * lazily by useWebMcp.ts, only in a browser that has the API, so no other browser downloads it.
 *
 * The current API (https://webmachinelearning.github.io/webmcp/) is `document.modelContext`, with
 * `registerTool(tool, { signal })` returning a promise and the signal's abort unregistering the
 * tool. Earlier Chrome builds had `navigator.modelContext`, whose `registerTool` may return
 * nothing, and `unregisterTool(name)` or `provideContext({ tools })`: those are handled too. A
 * registration the browser refuses (the `tools` permission policy, a duplicate) is ignored.
 */
import { track } from '../lib/analytics';
import { confirmReplace } from './confirm';
import schemas from './schemas.json';
import { createTools, type Outcome, type WebMcpHost } from './tools';

/** `document.modelContext` (or the deprecated `navigator.modelContext`), as far as it is used. */
export interface ModelContextLike {
  registerTool?: (tool: ToolInit, options?: { signal?: AbortSignal }) => unknown;
  unregisterTool?: (name: string) => unknown;
  provideContext?: (context: { tools: ToolInit[] }) => unknown;
  clearContext?: () => unknown;
}

/** The tool dictionary the browser takes. */
export interface ToolInit {
  name: string;
  title: string;
  description: string;
  inputSchema: object;
  annotations?: Record<string, boolean>;
  execute: (input: unknown, options?: { signal?: AbortSignal }) => Promise<unknown>;
}

/** The planner's side; `confirm` defaults to the app's own dialog. */
export type PlannerHost = Omit<WebMcpHost, 'confirm'> & Partial<Pick<WebMcpHost, 'confirm'>>;

const SCHEMAS = schemas as Record<string, object>;

/** What the agent gets back: the result, or `{error}` with a message it can act on. */
const reply = (outcome: Outcome): unknown => (outcome.ok ? outcome.data : { error: outcome.error });

const isThenable = (v: unknown): v is PromiseLike<unknown> =>
  typeof v === 'object' && v !== null && typeof (v as PromiseLike<unknown>).then === 'function';

let announced = false;

/**
 * Register every tool with `mc` until `signal` aborts. Resolves with how many the browser took
 * (never rejects).
 */
export async function registerTools(
  mc: ModelContextLike,
  host: PlannerHost,
  signal: AbortSignal,
  { api = 'document' }: { api?: 'document' | 'navigator' } = {},
): Promise<number> {
  if (signal.aborted) return 0;
  const full: WebMcpHost = {
    ...host,
    confirm: host.confirm ?? ((message, s) => confirmReplace(message, anySignal(signal, s))),
  };
  const tools: ToolInit[] = createTools(full).map((tool) => ({
    name: tool.name,
    title: tool.title,
    description: tool.description,
    inputSchema: SCHEMAS[tool.name]!,
    ...(tool.annotations && { annotations: { ...tool.annotations } }),
    execute: async (input, options) => {
      const outcome = await tool.call(input, anySignal(signal, options?.signal));
      track('webmcp_tool_called', {
        tool: tool.name,
        ok: outcome.ok,
        error_kind: outcome.ok ? null : outcome.kind,
      });
      return reply(outcome);
    },
  }));

  let registered = 0;
  if (typeof mc.registerTool === 'function') {
    const results = await Promise.allSettled(
      tools.map(async (tool) => {
        const handle = mc.registerTool!(tool, { signal });
        const done = isThenable(handle) ? await handle : handle;
        // Builds without the signal: unregister by name, or through a returned handle.
        signal.addEventListener(
          'abort',
          () => {
            try {
              const h = done as { unregister?: () => void } | undefined;
              if (typeof h?.unregister === 'function') h.unregister();
              else mc.unregisterTool?.(tool.name);
            } catch {
              /* already gone */
            }
          },
          { once: true },
        );
      }),
    );
    registered = results.filter((r) => r.status === 'fulfilled').length;
  } else if (typeof mc.provideContext === 'function') {
    try {
      const done = mc.provideContext({ tools });
      if (isThenable(done)) await done;
      registered = tools.length;
      signal.addEventListener(
        'abort',
        () => {
          try {
            if (typeof mc.clearContext === 'function') mc.clearContext();
            else mc.provideContext!({ tools: [] });
          } catch {
            /* already gone */
          }
        },
        { once: true },
      );
    } catch {
      /* refused */
    }
  }
  if (!announced) {
    announced = true;
    track('webmcp_available', { api, tools: registered });
  }
  return registered;
}

/** A signal that aborts when either does. */
function anySignal(a: AbortSignal, b?: AbortSignal): AbortSignal {
  if (!b) return a;
  if (typeof AbortSignal.any === 'function') return AbortSignal.any([a, b]);
  const c = new AbortController();
  const stop = () => c.abort();
  if (a.aborted || b.aborted) stop();
  a.addEventListener('abort', stop, { once: true });
  b.addEventListener('abort', stop, { once: true });
  return c.signal;
}
