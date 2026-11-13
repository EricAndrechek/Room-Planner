import { useEffect, useState } from 'react';
import { captureError, track } from '../lib/analytics';
import { boot, bootFromStorage, type BootResult } from '../lib/boot';
import { hasShareLink } from '../lib/share';
import { getBrowserStorage } from '../lib/storage';
import { ErrorBoundary } from './ErrorBoundary';
import { Planner } from './planner/Planner';

const storage = typeof window === 'undefined' ? null : getBrowserStorage();

/**
 * Island root (rendered with `client:only="react"`). Resolves the start-up
 * state - synchronously from storage, or asynchronously when the URL carries
 * a share link (decompression is async) - then mounts the planner.
 */
function PlannerBoot() {
  const [result, setResult] = useState<BootResult | null>(() =>
    storage && !hasShareLink(window.location.href)
      ? { state: bootFromStorage(storage), shared: null }
      : null,
  );

  useEffect(() => {
    if (result || !storage) return;
    let cancelled = false;
    boot(window.location.href, storage)
      .then((r) => {
        if (cancelled) return;
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
  return <Planner storage={storage} initial={result.state} />;
}

export default function PlannerApp() {
  return (
    <ErrorBoundary>
      <PlannerBoot />
    </ErrorBoundary>
  );
}
