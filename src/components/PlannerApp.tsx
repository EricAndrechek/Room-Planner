import { lazy, Suspense, useEffect, useState } from 'react';
import { captureError, track } from '../lib/analytics';
import {
  boot,
  bootFromStorage,
  storageProblem,
  type BootResult,
  type LinkProblem,
} from '../lib/boot';
import { hasShareLink } from '../core/share/link';
import { createPlanStore, getBrowserStorage } from '../lib/storage';
import { activateWaitingWorker } from '../lib/swStart';
import { ErrorBoundary } from './ErrorBoundary';
import { Planner } from './planner/Planner';

const store = typeof window === 'undefined' ? null : createPlanStore(getBrowserStorage());

/**
 * Started as the module loads: a build that installed last time takes over before the planner
 * mounts, with one reload (lib/swStart.ts). Resolves true when that reload is under way.
 */
const startUpdate: Promise<boolean> =
  typeof window === 'undefined'
    ? Promise.resolve(false)
    : activateWaitingWorker().then((reloading) => {
        if (reloading) track('app_update_applied', { at: 'start' });
        return reloading;
      });

// Only fetched when a link could not be opened.
const LinkProblemDialog = lazy(() => import('./LinkProblemDialog'));

/**
 * Island root (rendered with `client:only="react"`). Resolves the start-up
 * state - synchronously from storage, or asynchronously when the URL carries
 * a share link (decompression is async) - then mounts the planner. A link that cannot be opened
 * (too new for this build, or damaged) leaves the URL as it is and shows why.
 */
function PlannerBoot() {
  const [result, setResult] = useState<BootResult | null>(() => {
    if (!store || hasShareLink(window.location.href)) return null;
    const state = bootFromStorage(store);
    return { state, shared: null, linkProblem: storageProblem(state) };
  });

  const [linkProblem, setLinkProblem] = useState<LinkProblem | null>(
    () => result?.linkProblem ?? null,
  );

  useEffect(() => {
    if (result || !store) return;
    let cancelled = false;
    boot(window.location.href, store)
      .then((r) => {
        if (cancelled) return;
        if (r.linkProblem) setLinkProblem(r.linkProblem);
        if (r.shared) {
          window.history.replaceState(window.history.state, '', r.shared.cleanUrl);
          track('share_link_opened', { legacy: r.shared.legacy });
          if (r.shared.createdProject) track('project_created', { source: 'share_link' });
        }
        setResult(r);
      })
      .catch((err: unknown) => {
        captureError(err, { source: 'boot' });
        if (!cancelled) setResult({ state: bootFromStorage(store), shared: null });
      });
    return () => {
      cancelled = true;
    };
  }, [result]);

  useEffect(() => {
    if (result) document.documentElement.dataset.plannerReady = 'true';
  }, [result]);

  if (!result || !store) return null;
  return (
    <>
      <Planner store={store} initial={result.state} />
      {linkProblem && (
        <Suspense fallback={null}>
          <LinkProblemDialog problem={linkProblem} onClose={() => setLinkProblem(null)} />
        </Suspense>
      )}
    </>
  );
}

export default function PlannerApp() {
  // Nothing reads the link or touches storage until the newest build is known to be running.
  const [started, setStarted] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void startUpdate.then((reloading) => {
      if (!cancelled && !reloading) setStarted(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  if (!started) return null;
  return (
    <ErrorBoundary>
      <PlannerBoot />
    </ErrorBoundary>
  );
}
