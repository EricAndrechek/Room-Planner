import { useEffect } from 'react';
import { CircleCheck, Download, RefreshCw, X } from 'lucide-react';
import { usePwa } from '../../hooks/usePwa';
import { applyUpdate, dismissOfflineReady, dismissUpdate, promptInstall } from '../../lib/pwa';

/** Bottom toasts: "Update available" and the one-time "Ready to work offline". */
export function PwaNotices() {
  const { needRefresh, offlineReady } = usePwa();

  useEffect(() => {
    if (!offlineReady) return;
    const id = setTimeout(dismissOfflineReady, 8000);
    return () => clearTimeout(id);
  }, [offlineReady]);

  if (!needRefresh && !offlineReady) return null;
  return (
    <div
      className="fixed inset-x-0 bottom-0 z-[70] flex justify-center px-3 pointer-events-none"
      style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
    >
      <div
        role="status"
        aria-live="polite"
        data-testid="pwa-toast"
        className="pointer-events-auto w-full max-w-sm bg-slate-900 text-white rounded-xl shadow-xl px-4 py-3 flex items-center gap-3 animate-slide-up"
      >
        {needRefresh ? (
          <>
            <RefreshCw className="w-4 h-4 shrink-0 text-indigo-300" aria-hidden="true" />
            <p className="text-sm flex-1">Update available</p>
            <button
              type="button"
              onClick={applyUpdate}
              className="px-3 py-1.5 bg-indigo-500 hover:bg-indigo-400 rounded-lg text-sm font-medium transition-colors"
            >
              Reload
            </button>
            <button
              type="button"
              onClick={dismissUpdate}
              className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700 transition-colors"
              aria-label="Dismiss"
            >
              <X className="w-4 h-4" />
            </button>
          </>
        ) : (
          <>
            <CircleCheck className="w-4 h-4 shrink-0 text-green-400" aria-hidden="true" />
            <p className="text-sm flex-1">Ready to work offline</p>
            <button
              type="button"
              onClick={dismissOfflineReady}
              className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700 transition-colors"
              aria-label="Dismiss"
            >
              <X className="w-4 h-4" />
            </button>
          </>
        )}
      </div>
    </div>
  );
}

/** "Install app" - only rendered when the browser offered installation and we are not installed. */
export function InstallButton({ variant }: { variant: 'header' | 'sidebar' }) {
  const { canInstall, standalone } = usePwa();
  if (!canInstall || standalone) return null;
  if (variant === 'header') {
    return (
      <button
        type="button"
        onClick={() => void promptInstall()}
        className="hidden md:flex items-center gap-1.5 p-2 hover:bg-slate-100 rounded-lg text-slate-500 hover:text-indigo-600 text-sm transition-colors"
        aria-label="Install app"
        title="Install Room Planner as an app"
      >
        <Download className="w-4 h-4" />
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={() => void promptInstall()}
      className="mb-2 w-full md:hidden flex items-center justify-center gap-1.5 text-xs font-medium text-indigo-600 hover:text-indigo-800 py-2 rounded-lg hover:bg-indigo-50 transition-colors"
    >
      <Download className="w-3.5 h-3.5" />
      Install app
    </button>
  );
}
