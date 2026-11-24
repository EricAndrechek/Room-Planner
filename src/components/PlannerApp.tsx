import { lazy, Suspense, useEffect, useState } from 'react';
import { captureError, track } from '../lib/analytics';
import { boot, bootFromStorage, type BootResult, type LinkProblem } from '../lib/boot';
import { hasShareLink } from '../core/share/link';
import { getBrowserStorage } from '../lib/storage';
import { ErrorBoundary } from './ErrorBoundary';
import { Planner } from './planner/Planner';

const storage = typeof window === 'undefined' ? null : getBrowserStorage();

// Only fetched when a link could not be opened.
const LinkProblemDialog = lazy(() => import('./LinkProblemDialog'));

/**
 * Island root (rendered with `client:only="react"`). Resolves the start-up
 * state - synchronously from storage, or asynchronously when the URL carries
 * a share link (decompression is async) - then mounts the planner. A link that cannot be opened
 * (too new for this build, or damaged) leaves the URL as it is and shows why.
 */
function PlannerBoot() {
  const [result, setResult] = useState<BootResult | null>(() =>
    storage && !hasShareLink(window.location.href)
      ? { state: bootFromStorage(storage), shared: null }
      : null,
  );

  const [linkProblem, setLinkProblem] = useState<LinkProblem | null>(null);

  useEffect(() => {
    if (result || !storage) return;
    let cancelled = false;
    boot(window.location.href, storage)
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
        if (!cancelled) setResult({ state: bootFromStorage(storage), shared: null });
      });
    return () => {
      cancelled = true;
    };
  }, [result]);

  useEffect(() => {
    if (result) document.documentElement.dataset.plannerReady = 'true';
  }, [result]);

  if (!result || !storage) return null;
  return (
    <>
      <Planner storage={storage} initial={result.state} />
      {linkProblem && (
        <Suspense fallback={null}>
          <LinkProblemDialog problem={linkProblem} onClose={() => setLinkProblem(null)} />
        </Suspense>
      )}
    </>
  );
}

export default function PlannerApp() {
  return (
    <ErrorBoundary>
      <PlannerBoot />
    </ErrorBoundary>
  );
}
