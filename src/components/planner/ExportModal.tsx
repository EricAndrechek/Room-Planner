import { useEffect, useRef, useState } from 'react';
import { FileDown, ImageDown, LoaderCircle, Printer } from 'lucide-react';
import { captureError, track } from '../../lib/analytics';
import { defaultPaper, type Paper } from '../../lib/export/paper';
import type { PlanInput } from '../../lib/export/scene';
import type { Layout, UnitSystem } from '../../types';
import { Modal } from './Modal';

type ExportModule = typeof import('../../lib/export/exportPlan');
type Action = 'png' | 'pdf' | 'print';

// The renderer is a separate chunk, fetched on first use (and warmed when the planner is idle,
// so the browser's own Print menu can use it). The service worker precaches it for offline use.
let modulePromise: Promise<ExportModule> | null = null;
let loaded: ExportModule | null = null;
const loadExport = (): Promise<ExportModule> => {
  modulePromise ??= import('../../lib/export/exportPlan').then((m) => (loaded = m));
  // Allow a retry if the chunk failed to load (e.g. a flaky connection before it was cached).
  modulePromise.catch(() => (modulePromise = null));
  return modulePromise;
};

const PAPER_OPTIONS: { value: Paper; label: string }[] = [
  { value: 'a4', label: 'A4' },
  { value: 'letter', label: 'Letter' },
];

interface ExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  layout: Layout;
  unitSystem: UnitSystem;
  projectName: string;
}

/**
 * "Export" dialog: download the plan as PNG or PDF, or print it. Also keeps a
 * clean, printable plan ready for the browser's own Print command.
 */
export function ExportModal({
  isOpen,
  onClose,
  layout,
  unitSystem,
  projectName,
}: ExportModalProps) {
  const [paper, setPaper] = useState<Paper>(() => defaultPaper(navigator.language));
  const [busy, setBusy] = useState<Action | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<PlanInput>({ layout, unitSystem, title: projectName });
  useEffect(() => {
    inputRef.current = { layout, unitSystem, title: projectName };
  }, [layout, unitSystem, projectName]);

  // Browser Print (Ctrl/Cmd+P, menu): swap the editor for the plan while printing.
  useEffect(() => {
    const idle = window.setTimeout(() => void loadExport().catch(() => {}), 3000);
    const before = () => loaded?.preparePrint({ ...inputRef.current, date: new Date() });
    const after = () => loaded?.cleanupPrint();
    window.addEventListener('beforeprint', before);
    window.addEventListener('afterprint', after);
    return () => {
      window.clearTimeout(idle);
      window.removeEventListener('beforeprint', before);
      window.removeEventListener('afterprint', after);
    };
  }, []);

  const run = async (action: Action) => {
    if (busy) return;
    setBusy(action);
    setError(null);
    const input: PlanInput = { ...inputRef.current, date: new Date() };
    const props = {
      units: unitSystem,
      items: layout.items.filter((i) => i.visible !== false).length,
      doors: layout.doors.length,
      windows: layout.windows.length,
    };
    try {
      const m = await loadExport();
      if (action === 'png') {
        await m.downloadPng(input);
        track('export_png', props);
      } else if (action === 'pdf') {
        await m.downloadPdf(input, paper);
        track('export_pdf', { ...props, paper });
      } else {
        track('export_print', props);
        onClose();
        m.printPlan(input);
      }
    } catch (err) {
      captureError(err, { source: `export_${action}` });
      setError('Export failed. Please try again.');
    } finally {
      setBusy(null);
    }
  };

  const button = (action: Action, Icon: typeof ImageDown, label: string, hint: string) => (
    <button
      type="button"
      onClick={() => void run(action)}
      disabled={busy !== null}
      className="w-full flex items-center gap-3 p-3 rounded-lg border border-slate-200 hover:border-indigo-300 hover:bg-indigo-50 text-left transition-colors disabled:opacity-60 disabled:cursor-wait"
    >
      <span className="w-9 h-9 rounded-lg bg-indigo-100 text-indigo-600 flex items-center justify-center shrink-0">
        {busy === action ? (
          <LoaderCircle className="w-5 h-5 animate-spin" aria-hidden="true" />
        ) : (
          <Icon className="w-5 h-5" aria-hidden="true" />
        )}
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-medium text-slate-800">{label}</span>
        <span className="block text-xs text-slate-500">{hint}</span>
      </span>
    </button>
  );

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Export Floor Plan">
      <div className="space-y-3">
        <p className="text-xs text-slate-500">
          A clean, to-scale drawing of your plan with dimensions and a scale bar — without the
          editor controls. Works offline.
        </p>
        {button('png', ImageDown, 'Download PNG', 'High-resolution image')}
        {button('pdf', FileDown, 'Download PDF', 'Printable page, fitted automatically')}
        <div className="flex items-center justify-between gap-2 pl-1">
          <span className="text-xs text-slate-500" id="export-paper-label">
            PDF paper size
          </span>
          <div
            className="flex bg-slate-100 rounded-lg p-0.5"
            role="radiogroup"
            aria-labelledby="export-paper-label"
          >
            {PAPER_OPTIONS.map((o) => (
              <button
                key={o.value}
                type="button"
                role="radio"
                aria-checked={paper === o.value}
                onClick={() => setPaper(o.value)}
                className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                  paper === o.value
                    ? 'bg-white text-slate-800 shadow-xs'
                    : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>
        {button('print', Printer, 'Print', 'Uses your browser’s print dialog')}
        {error && (
          <p className="text-xs text-red-600" role="alert">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}
