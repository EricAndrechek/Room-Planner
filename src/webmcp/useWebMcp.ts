/**
 * WebMCP in the planner (docs/design/plan-format.md, section 8): when the browser has the API,
 * the tools (register.ts, a lazy chunk) are loaded and registered once the planner has mounted,
 * and unregistered when it unmounts. Elsewhere this is the only WebMCP code that loads.
 *
 * The tools act through the planner's own history, live region and selection, so an agent's edit
 * is one undo step, is spoken and shows selected, like the user's own.
 */
import { useEffect, useRef } from 'react';
import { floorBounds } from '../core/floor';
import type { History } from '../hooks/useHistory';
import { captureError } from '../lib/analytics';
import type { Id, Plan, Selection, UnitSystem } from '../types';
import type { ModelContextLike, PlannerHost } from './register';

type Bounds = ReturnType<typeof floorBounds>;

export interface WebMcpBindings {
  history: History<Plan>;
  projectName: string;
  unitSystem: UnitSystem;
  /** useAnnouncements' `announceEdit`. */
  announceEdit: (text: string) => void;
  /** usePanZoom's: keep the plan still on screen while the floor's box changes. */
  keepView: (prev: Bounds, next: Bounds) => void;
  setSelection: (selection: Selection | null) => void;
  /** Edit this room (the room list, the chips). */
  setActiveRoom: (id: Id) => void;
  /** Show the Set aside list with this piece in it. */
  showSetAside: (id: Id) => void;
}

/** `document.modelContext`, else the deprecated `navigator.modelContext`, else null. */
export function findModelContext(): { mc: ModelContextLike; api: 'document' | 'navigator' } | null {
  if (typeof document === 'undefined') return null;
  const fromDocument = (document as { modelContext?: ModelContextLike }).modelContext;
  if (fromDocument) return { mc: fromDocument, api: 'document' };
  const fromNavigator =
    typeof navigator === 'undefined'
      ? undefined
      : (navigator as { modelContext?: ModelContextLike }).modelContext;
  return fromNavigator ? { mc: fromNavigator, api: 'navigator' } : null;
}

export function useWebMcp(bindings: WebMcpBindings): void {
  const ref = useRef(bindings);
  // The plan the next tool call starts from: an edit applied but not rendered yet counts.
  const latest = useRef(bindings.history.present);
  useEffect(() => {
    ref.current = bindings;
    latest.current = bindings.history.present;
  });

  useEffect(() => {
    const found = findModelContext();
    if (!found) return;
    const controller = new AbortController();
    const host: PlannerHost = {
      plan: () => latest.current,
      name: () => ref.current.projectName,
      unitSystem: () => ref.current.unitSystem,
      apply: (next, said, options) => {
        const b = ref.current;
        const prev = latest.current;
        latest.current = next;
        if (options?.keepView !== false) b.keepView(floorBounds(prev), floorBounds(next));
        b.announceEdit(said);
        b.history.apply(() => next);
      },
      show: (target) => {
        const b = ref.current;
        if (!target) b.setSelection(null);
        else if (target.type === 'room') {
          b.setActiveRoom(target.id);
          b.setSelection(null);
        } else if (target.type === 'aside') {
          b.setSelection(null);
          b.showSetAside(target.id);
        } else b.setSelection({ type: target.type, id: target.id });
      },
    };
    import('./register')
      .then(({ registerTools }) =>
        registerTools(found.mc, host, controller.signal, { api: found.api }),
      )
      .catch((err: unknown) => captureError(err, { source: 'webmcp' }));
    return () => controller.abort();
  }, []);
}
