/**
 * Keeps React working when the browser translates the page (Chrome's and Edge's built-in page
 * translation, Google Translate).
 *
 * Translation swaps the text nodes React rendered for `<font>` elements holding the translated
 * text. React still holds the original nodes, so the next update that removes or inserts next to
 * one asks the DOM for a node that is no longer where React put it, and `removeChild` /
 * `insertBefore` throw "The node … is not a child of this node", which takes the planner down
 * (facebook/react#11538). Turning translation off (`translate="no"`) would avoid that but leave
 * people who read another language with an English-only app, so instead those two calls are made
 * forgiving, the widely used fix from that issue:
 *
 * - `removeChild` of a node that has moved (into a `<font>` wrapper) removes it from where it is now,
 *   and one that is already detached is left alone;
 * - `insertBefore` with a reference node that has moved inserts before the child of this node that
 *   now holds it (the wrapper), or at the end when there is none.
 *
 * Calls that would have worked anyway go straight to the browser's own methods, so nothing changes
 * for anyone else. Installed once, before React mounts (PlannerApp imports this module first).
 */

interface GuardedNode {
  parentNode: GuardedNode | null;
  removeChild<T>(child: T): T;
  insertBefore<T>(node: T, child: GuardedNode | null): T;
}

/** Called when a guarded call would have thrown (once a node has been moved by a translator). */
export type MismatchListener = (call: 'removeChild' | 'insertBefore') => void;

const INSTALLED = Symbol.for('room-planner.translation-guard');

/**
 * Patch `proto` (`Node.prototype` in the browser) so React's DOM calls survive a translator moving
 * its text nodes. Returns false if it was already installed. `onMismatch` hears about each call
 * that needed the guard.
 */
export function installTranslationGuard(
  proto: GuardedNode,
  onMismatch: MismatchListener = () => {},
): boolean {
  const flagged = proto as GuardedNode & { [INSTALLED]?: true };
  if (flagged[INSTALLED]) return false;
  flagged[INSTALLED] = true;

  /* eslint-disable @typescript-eslint/no-unsafe-function-type -- the DOM's own signatures */
  const removeChild = proto.removeChild as Function;
  const insertBefore = proto.insertBefore as Function;
  /* eslint-enable @typescript-eslint/no-unsafe-function-type */

  proto.removeChild = function <T>(this: GuardedNode, child: T): T {
    const node = child as unknown as GuardedNode | null;
    if (node && node.parentNode !== this) {
      onMismatch('removeChild');
      // Moved into a translator's wrapper: take it out of there, so it does not stay on screen.
      if (node.parentNode) removeChild.call(node.parentNode, node);
      return child;
    }
    return removeChild.call(this, child) as T;
  };

  proto.insertBefore = function <T>(this: GuardedNode, node: T, ref: GuardedNode | null): T {
    if (ref && ref.parentNode !== this) {
      onMismatch('insertBefore');
      // The child of this node that now holds `ref` (a wrapper around it), if any.
      let holder: GuardedNode | null = ref;
      while (holder && holder.parentNode !== this) holder = holder.parentNode;
      return insertBefore.call(this, node, holder) as T;
    }
    return insertBefore.call(this, node, ref) as T;
  };
  return true;
}
