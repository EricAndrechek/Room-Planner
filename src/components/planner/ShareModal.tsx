import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Copy, Download, Mail, MonitorSmartphone, Share, Upload } from 'lucide-react';
import { captureError, track } from '../../lib/analytics';
import { copyText } from '../../lib/browser';
import { readSharedPlan } from '../../lib/boot';
import { NEWER_PLAN_MESSAGE, UNSUPPORTED_PLAN_MESSAGE } from '../../lib/planVersion';
import { unitFor } from '../../lib/plans';
import { makeQr, qrPath, type QrMatrix } from '../../lib/qr';
import { buildPlanUrl } from '../../core/share/plan';
import { fromFeet } from '../../core/units';
import type { ImportedPlan } from '../../hooks/useProjectActions';
import type { Plan } from '../../types';
import { Modal } from './Modal';

interface ShareModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** The current plan, with its name and display units. */
  plan: Plan;
  /** Load a pasted plan (it replaces the working one). */
  onImport: (plan: ImportedPlan) => void;
  /** Wide screen (not the phone layout): offer a QR code a phone can scan off the screen. */
  showQr: boolean;
}

/** Whether this browser can open the system share sheet for a link. */
const canShareLink = (url: string): boolean => {
  try {
    if (typeof navigator.share !== 'function') return false;
    return typeof navigator.canShare === 'function' ? navigator.canShare({ url }) : true;
  } catch {
    return false;
  }
};

/** Target size of the QR code; each module is a whole number of CSS pixels for a crisp code. */
const QR_TARGET_PX = 248;
const QR_QUIET = 4;

function QrCode({ code }: { code: QrMatrix }) {
  const modules = code.size + 2 * QR_QUIET;
  const px = Math.max(2, Math.floor(QR_TARGET_PX / modules)) * modules;
  return (
    <svg
      width={px}
      height={px}
      viewBox={`${-QR_QUIET} ${-QR_QUIET} ${modules} ${modules}`}
      shapeRendering="crispEdges"
      role="img"
      aria-label="QR code of the link to this plan"
      data-testid="handoff-qr"
      className="bg-white"
    >
      <rect x={-QR_QUIET} y={-QR_QUIET} width={modules} height={modules} fill="#fff" />
      <path d={qrPath(code)} fill="#0f172a" />
    </svg>
  );
}

/** Share link + JSON export/import. */
export function ShareModal({ isOpen, onClose, plan, onImport, showQr }: ShareModalProps) {
  const [shareUrl, setShareUrl] = useState<{ for: Plan; url: string } | null>(null);
  const [copyFeedback, setCopyFeedback] = useState<'url' | 'json' | null>(null);
  const [importText, setImportText] = useState('');
  const [importError, setImportError] = useState<string | null>(null);
  // The plan in the unit it is shown in, as an agent or a person would write it.
  const json = useMemo(
    () => JSON.stringify(fromFeet(plan, unitFor(plan.settings?.unitSystem ?? 'ft-in')), null, 2),
    [plan],
  );
  const trackedThisOpen = useRef(false);

  // Encoding is async (CompressionStream), so build the link when the dialog opens.
  useEffect(() => {
    if (!isOpen) {
      trackedThisOpen.current = false;
      return;
    }
    let cancelled = false;
    buildPlanUrl(window.location.href, plan)
      .then((url) => {
        if (cancelled) return;
        setShareUrl({ for: plan, url });
        if (!trackedThisOpen.current) {
          trackedThisOpen.current = true;
          track('share_link_created', { compressed: url.includes('#s=') });
        }
      })
      .catch((err: unknown) => captureError(err, { source: 'share_link' }));
    return () => {
      cancelled = true;
    };
  }, [isOpen, plan]);

  const url = shareUrl?.for === plan ? shareUrl.url : '';
  const shareable = !!url && canShareLink(url);

  // The QR code (wide screens only), generated lazily once the link is ready; null: too long.
  const [qr, setQr] = useState<{ for: string; code: QrMatrix | null } | null>(null);
  const qrTracked = useRef(false);
  useEffect(() => {
    if (!isOpen || !showQr || !url) return;
    let cancelled = false;
    makeQr(url)
      .then((code) => {
        if (cancelled) return;
        setQr({ for: url, code });
        if (code && !qrTracked.current) {
          qrTracked.current = true;
          track('handoff_qr_shown');
        }
      })
      .catch((err: unknown) => captureError(err, { source: 'share_qr' }));
    return () => {
      cancelled = true;
    };
  }, [isOpen, showQr, url]);
  useEffect(() => {
    if (!isOpen) qrTracked.current = false;
  }, [isOpen]);
  const qrCode = qr?.for === url ? qr.code : undefined;

  const planName = plan.name || 'Floor plan';
  const mailto = url
    ? `mailto:?subject=${encodeURIComponent(`Room Planner: ${planName}`)}&body=${encodeURIComponent(
        `Open this link to continue the plan on this device:\n\n${url}\n`,
      )}`
    : undefined;

  const shareLink = async () => {
    track('handoff_share');
    try {
      await navigator.share({ title: `Room Planner: ${planName}`, url });
    } catch (err) {
      // Closing the share sheet is not an error.
      if (!(err instanceof DOMException && err.name === 'AbortError')) {
        captureError(err, { source: 'share_sheet' });
      }
    }
  };

  const handleCopy = async (text: string, type: 'url' | 'json') => {
    try {
      await copyText(text);
      setCopyFeedback(type);
      setTimeout(() => setCopyFeedback(null), 2000);
      if (type === 'json') track('export_json', { kind: 'layout' });
      else track('handoff_copy');
    } catch (err) {
      console.error('Failed to copy:', err);
      alert('Failed to copy to clipboard');
    }
  };

  const handleImport = () => {
    try {
      const read = readSharedPlan(JSON.parse(importText) as unknown);
      if (!read.ok && read.problem !== 'invalid') {
        setImportError(read.problem === 'newer' ? NEWER_PLAN_MESSAGE : UNSUPPORTED_PLAN_MESSAGE);
        return;
      }
      if (!read.ok) throw new Error('Invalid Config');
      onImport(read);
      setImportText('');
      setImportError(null);
      onClose();
    } catch {
      setImportError('Invalid JSON format. Please check your input.');
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Share & Save Layout">
      <div className="space-y-6">
        <section aria-labelledby="handoff-heading" data-testid="handoff">
          <h4
            id="handoff-heading"
            className="text-sm font-medium text-slate-700 mb-1 flex items-center gap-2"
          >
            <MonitorSmartphone className="w-4 h-4" aria-hidden="true" /> Open on another device
          </h4>
          <p className="text-[11px] text-slate-500 mb-3">
            This link holds the whole plan. Open it on your phone or another computer (or send it to
            someone) and it is saved there as its own plan. It&apos;s a snapshot: changes made later
            aren&apos;t synced.
          </p>
          <label htmlFor="share-url" className="sr-only">
            Link to this plan
          </label>
          <div className="flex gap-2">
            <input
              id="share-url"
              readOnly
              value={url}
              placeholder="Generating link…"
              className="flex-1 min-w-0 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs text-slate-600 font-mono truncate select-all"
              onFocus={(e) => e.currentTarget.select()}
            />
            <button
              type="button"
              onClick={() => url && handleCopy(url, 'url')}
              disabled={!url}
              className="shrink-0 flex items-center gap-1.5 px-3 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-medium transition-colors disabled:opacity-50"
            >
              {copyFeedback === 'url' ? (
                <Check className="w-4 h-4" aria-hidden="true" />
              ) : (
                <Copy className="w-4 h-4" aria-hidden="true" />
              )}
              {copyFeedback === 'url' ? 'Copied' : 'Copy link'}
            </button>
          </div>
          <div className="flex flex-wrap gap-2 mt-2">
            {shareable && (
              <button
                type="button"
                onClick={() => void shareLink()}
                className="flex items-center gap-1.5 px-3 py-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-lg text-xs font-medium transition-colors"
              >
                <Share className="w-4 h-4" aria-hidden="true" /> Share…
              </button>
            )}
            <a
              href={mailto}
              aria-disabled={!url || undefined}
              onClick={() => url && track('handoff_email')}
              className="flex items-center gap-1.5 px-3 py-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-lg text-xs font-medium transition-colors"
            >
              <Mail className="w-4 h-4" aria-hidden="true" /> Email it to me
            </a>
          </div>
          {showQr && url && qrCode !== undefined && (
            <div className="mt-4 flex items-center gap-4" data-testid="handoff-qr-block">
              {qrCode ? (
                <>
                  <div className="shrink-0 rounded-lg border border-slate-200 p-1 bg-white">
                    <QrCode code={qrCode} />
                  </div>
                  <p className="text-xs text-slate-600">
                    Scan with your phone&apos;s camera to open this plan there.
                  </p>
                </>
              ) : (
                <p className="text-[11px] text-slate-500">
                  This plan is too big for a QR code: copy, share or email the link instead.
                </p>
              )}
            </div>
          )}
        </section>

        <div className="border-t border-slate-100 my-4"></div>

        <div>
          <div className="flex justify-between items-end mb-2">
            <label
              className="text-sm font-medium text-slate-700 flex items-center gap-2"
              htmlFor="layout-json"
            >
              <Download className="w-4 h-4" /> Layout Config (JSON)
            </label>
            <button
              type="button"
              onClick={() => handleCopy(json, 'json')}
              className="text-xs text-indigo-600 hover:text-indigo-800 font-medium flex items-center gap-1"
            >
              {copyFeedback === 'json' ? (
                <span className="text-green-600 flex items-center gap-1">
                  <Check className="w-3 h-3" /> Copied
                </span>
              ) : (
                'Copy JSON'
              )}
            </button>
          </div>
          <textarea
            id="layout-json"
            readOnly
            value={json}
            className="w-full h-24 bg-slate-50 border border-slate-200 rounded-lg p-2 text-[10px] text-slate-600 font-mono mb-4"
          />

          <label
            className="text-sm font-medium text-slate-700 mb-2 flex items-center gap-2"
            htmlFor="import-json"
          >
            <Upload className="w-4 h-4" /> Import Config
          </label>
          <textarea
            id="import-json"
            placeholder="Paste your JSON config here..."
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
            className="w-full h-24 bg-white border border-slate-300 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500 rounded-lg p-2 text-xs font-mono mb-2 outline-hidden"
          />
          {importError && <p className="text-xs text-red-500 mb-2">{importError}</p>}
          <button
            type="button"
            onClick={handleImport}
            disabled={!importText}
            className="w-full py-2 bg-slate-800 hover:bg-slate-900 text-white rounded-lg text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            Load Configuration
          </button>
        </div>
      </div>
    </Modal>
  );
}
