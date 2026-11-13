import { Component, type ErrorInfo, type ReactNode } from 'react';
import { captureError } from '../lib/analytics';
import { downloadFile } from '../lib/browser';
import { KEYS } from '../lib/storage';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/** Everything the app keeps in localStorage, as a downloadable backup. */
const collectBackup = (): string => {
  const data: Record<string, unknown> = {};
  try {
    for (const key of Object.values(KEYS)) {
      const raw = window.localStorage.getItem(key);
      if (raw === null) continue;
      try {
        data[key] = JSON.parse(raw);
      } catch {
        data[key] = raw;
      }
    }
  } catch {
    /* storage unavailable */
  }
  return JSON.stringify({ exportedAt: new Date().toISOString(), localStorage: data }, null, 2);
};

/**
 * Catches render errors anywhere in the planner, reports them through
 * `captureError`, and offers a way out that never loses data: download a
 * backup of everything saved in this browser, or reload.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    captureError(error, { source: 'error_boundary', componentStack: info.componentStack ?? undefined });
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="h-full flex items-center justify-center bg-slate-50 p-6" role="alert">
        <div className="max-w-md w-full bg-white rounded-xl shadow-xl border border-slate-200 p-6 text-center space-y-4">
          <h1 className="text-lg font-bold text-slate-800">Something went wrong</h1>
          <p className="text-sm text-slate-600">
            Room Planner hit an unexpected error. Your floor plans are stored in this browser and have not been
            deleted. You can download a backup of them before reloading.
          </p>
          <div className="flex flex-col sm:flex-row gap-2 justify-center">
            <button
              type="button"
              onClick={() =>
                downloadFile(`room-planner-backup-${new Date().toISOString().split('T')[0]}.json`, collectBackup())
              }
              className="px-4 py-2 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 rounded-lg text-sm font-medium"
            >
              Download backup
            </button>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-medium"
            >
              Reload
            </button>
          </div>
          <details className="text-left text-xs text-slate-400">
            <summary className="cursor-pointer">Error details</summary>
            <pre className="mt-2 whitespace-pre-wrap break-words">{this.state.error.message}</pre>
          </details>
        </div>
      </div>
    );
  }
}
