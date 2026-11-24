import { useEffect } from 'react';
import { CircleCheck, Download, Info, RefreshCw, X } from 'lucide-react';
import type { Notice } from '../../hooks/useNotice';
import { usePwa } from '../../hooks/usePwa';
import { applyUpdate, dismissOfflineReady, dismissUpdate, promptInstall } from '../../lib/pwa';

const TOAST =
  'pointer-events-auto w-full max-w-sm bg-slate-900 text-white rounded-xl shadow-xl px-4 py-3 flex items-center gap-3 animate-slide-up';
const TOAST_ACTION =
  'shrink-0 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 rounded-lg text-sm font-medium transition-colors';
const TOAST_DISMISS =
  'shrink-0 p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700 transition-colors';

interface PwaNoticesProps {
  /** An app notice (e.g. "Furniture is locked…"), shown above the PWA toast. */
  notice?: Notice | null;
  onDismissNotice?: () => void;
  /**
   * A first visit: skip "Ready to work offline" (people dismissed it within seconds on their first
   * look at the app). It is shown once only, so on a first visit it is simply never shown; the
   * help page explains offline use. "Update available" is unaffected.
   */
  firstVisit?: boolean;
}

/**
 * Bottom toasts: app notices, "Update available" and the one-time "Ready to work offline" (not on
 * a first visit). On
 * narrow screens they float above the bottom controls so they never cover them.
 */
export function PwaNotices({ notice, onDismissNotice, firstVisit = false }: PwaNoticesProps = {}) {
  const pwa = usePwa();
  const needRefresh = pwa.needRefresh;
  const offlineReady = pwa.offlineReady && !firstVisit;

  useEffect(() => {
    if (!offlineReady) return;
    const id = setTimeout(dismissOfflineReady, 8000);
    return () => clearTimeout(id);
  }, [offlineReady]);

  const visible = needRefresh || offlineReady;
  return (
    // The dock is always mounted and is the polite live region, so a toast appearing inside it is
    // announced (a region inserted together with its text often is not). Toasts never take focus.
    // On phones the dock sits above the sheet and the controls riding on it (see .toast-dock).
    <div
      className="toast-dock fixed inset-x-0 bottom-0 z-[70] flex flex-col items-center gap-2 px-3 pointer-events-none"
      role="status"
      aria-live="polite"
      data-testid="pwa-toast-dock"
    >
      {notice && (
        <div key={notice.key} data-testid="app-notice" data-notice={notice.key} className={TOAST}>
          <Info className="w-4 h-4 shrink-0 text-indigo-300" aria-hidden="true" />
          <p className="text-sm flex-1">{notice.message}</p>
          {notice.action && (
            <button type="button" onClick={notice.action.onClick} className={TOAST_ACTION}>
              {notice.action.label}
            </button>
          )}
          <button
            type="button"
            onClick={onDismissNotice}
            className={TOAST_DISMISS}
            aria-label="Dismiss"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}
      {visible && (
        <div data-testid="pwa-toast" className={TOAST}>
          {needRefresh ? (
            <>
              <RefreshCw className="w-4 h-4 shrink-0 text-indigo-300" aria-hidden="true" />
              <p className="text-sm flex-1">Update available</p>
              <button type="button" onClick={applyUpdate} className={TOAST_ACTION}>
                Reload
              </button>
              <button
                type="button"
                onClick={dismissUpdate}
                className={TOAST_DISMISS}
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
                className={TOAST_DISMISS}
                aria-label="Dismiss"
              >
                <X className="w-4 h-4" />
              </button>
            </>
          )}
        </div>
      )}
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
