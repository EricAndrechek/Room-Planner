import { useEffect, useId, useRef, useState } from 'react';
import type { LinkProblem } from '../lib/boot';

/**
 * Look for a new version now; when one installs, activate it and reload into it. With none (or no
 * service worker, or offline), just reload, which also picks up a build the server already has.
 * Kept here rather than in lib/pwa.ts so it loads only with this dialog.
 */
async function updateAndReload(): Promise<void> {
  try {
    const registration = await navigator.serviceWorker?.getRegistration();
    if (registration) {
      await registration.update();
      const installing = registration.installing;
      if (installing) {
        await new Promise<void>((resolve) => {
          const done = setTimeout(resolve, 10_000);
          installing.addEventListener('statechange', () => {
            if (installing.state !== 'installing') {
              clearTimeout(done);
              resolve();
            }
          });
        });
      }
      const waiting = registration.waiting;
      if (waiting) {
        // The generated service worker activates on this message (registerType: 'prompt').
        navigator.serviceWorker.addEventListener(
          'controllerchange',
          () => window.location.reload(),
          {
            once: true,
          },
        );
        waiting.postMessage({ type: 'SKIP_WAITING' });
        return;
      }
    }
  } catch {
    /* offline, or no service worker: a reload is all there is */
  }
  window.location.reload();
}

const PRIMARY =
  'px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-60';
const SECONDARY =
  'px-4 py-2 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 rounded-lg text-sm font-medium transition-colors';

/**
 * A share link that was not opened: a plan from a newer Room Planner, with an Update button, or a
 * damaged link. The user's own plan is open behind it. Loaded lazily, only when one is met, and
 * built on the native modal `<dialog>` (focus, Escape and the backdrop come with it), so this
 * chunk shares nothing with the planner's and the planner chunk stays as small as it was.
 */
export default function LinkProblemDialog({
  problem,
  onClose,
}: {
  problem: LinkProblem;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [updating, setUpdating] = useState(false);
  // Both are fixed by updating: a newer build reads the plan.
  const newer = problem.kind !== 'damaged';
  const stored = problem.kind !== 'damaged' && problem.where === 'storage';
  const title =
    problem.kind === 'damaged'
      ? 'This link is damaged'
      : stored
        ? 'Your plan needs a newer Room Planner'
        : 'This plan needs a newer Room Planner';
  const text =
    problem.kind === 'damaged'
      ? 'The plan in this link could not be read. Links are sometimes cut short or changed when they are copied or sent: ask for the link again, or copy all of it. Your own plan is open, unchanged.'
      : stored
        ? 'The plan you were working on was last saved by a newer version of Room Planner than this one. Update to keep working on it. It has not been changed, and this version will not write over it.'
        : problem.kind === 'newer'
          ? 'The link holds a plan made with a newer version of Room Planner than this one. Update to open it; the link stays in the address bar. Your own plans are not changed.'
          : 'The link holds a plan with something this version of Room Planner cannot show yet (several rooms, a room that is not a rectangle, or pieces that are not placed in the room). Update to open it; the link stays in the address bar. Your own plans are not changed.';

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      data-testid="link-problem"
      data-kind={problem.kind}
      data-where={problem.kind === 'damaged' ? undefined : (problem.where ?? 'link')}
      onClose={onClose}
      className="m-auto w-[calc(100%-2rem)] max-w-md rounded-xl bg-white p-6 shadow-2xl backdrop:bg-slate-900/50"
    >
      <h2 id={titleId} className="font-bold text-slate-800 mb-3">
        {title}
      </h2>
      <p className="text-sm text-slate-600 mb-5">{text}</p>
      <form method="dialog" className="flex justify-end gap-2">
        {newer ? (
          <>
            <button type="submit" className={SECONDARY}>
              Not now
            </button>
            <button
              type="button"
              disabled={updating}
              onClick={() => {
                setUpdating(true);
                void updateAndReload();
              }}
              className={PRIMARY}
            >
              {updating ? 'Updating…' : 'Update'}
            </button>
          </>
        ) : (
          <button type="submit" autoFocus className={PRIMARY}>
            OK
          </button>
        )}
      </form>
    </dialog>
  );
}
