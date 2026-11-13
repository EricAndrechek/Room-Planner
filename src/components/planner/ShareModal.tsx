import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Copy, Download, Share2, Upload } from 'lucide-react';
import { captureError, track } from '../../lib/analytics';
import { copyText } from '../../lib/browser';
import { isShareConfig, type ShareConfig } from '../../lib/layout';
import { buildShareUrl } from '../../lib/share';
import { Modal } from './Modal';

interface ShareModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** The current layout in the portable format (current unit system). */
  config: ShareConfig;
  /** Load a pasted config; return an error message or null on success. */
  onImport: (config: ShareConfig) => void;
}

/** Share link + JSON export/import. */
export function ShareModal({ isOpen, onClose, config, onImport }: ShareModalProps) {
  const [shareUrl, setShareUrl] = useState<{ for: ShareConfig; url: string } | null>(null);
  const [copyFeedback, setCopyFeedback] = useState<'url' | 'json' | null>(null);
  const [importText, setImportText] = useState('');
  const [importError, setImportError] = useState<string | null>(null);
  const json = useMemo(() => JSON.stringify(config, null, 2), [config]);
  const trackedThisOpen = useRef(false);

  // Encoding is async (CompressionStream), so build the link when the dialog opens.
  useEffect(() => {
    if (!isOpen) {
      trackedThisOpen.current = false;
      return;
    }
    let cancelled = false;
    buildShareUrl(window.location.href, config)
      .then((url) => {
        if (cancelled) return;
        setShareUrl({ for: config, url });
        if (!trackedThisOpen.current) {
          trackedThisOpen.current = true;
          track('share_link_created', { compressed: url.includes('#s=') });
        }
      })
      .catch((err: unknown) => captureError(err, { source: 'share_link' }));
    return () => {
      cancelled = true;
    };
  }, [isOpen, config]);

  const url = shareUrl?.for === config ? shareUrl.url : '';

  const handleCopy = async (text: string, type: 'url' | 'json') => {
    try {
      await copyText(text);
      setCopyFeedback(type);
      setTimeout(() => setCopyFeedback(null), 2000);
      if (type === 'json') track('export_json', { kind: 'layout' });
    } catch (err) {
      console.error('Failed to copy:', err);
      alert('Failed to copy to clipboard');
    }
  };

  const handleImport = () => {
    try {
      const parsed: unknown = JSON.parse(importText);
      if (!isShareConfig(parsed)) throw new Error('Invalid Config');
      onImport(parsed);
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
        <div>
          <label className="text-sm font-medium text-slate-700 mb-2 flex items-center gap-2" htmlFor="share-url">
            <Share2 className="w-4 h-4" /> Direct Link (Snapshot)
          </label>
          <p className="text-[10px] text-slate-500 mb-2">
            This link captures your current layout. Any changes you make after sharing won&apos;t be reflected —
            it&apos;s a snapshot, not a live link.
          </p>
          <div className="flex gap-2">
            <input
              id="share-url"
              readOnly
              value={url}
              placeholder="Generating link…"
              className="flex-1 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs text-slate-600 font-mono truncate select-all"
              onFocus={(e) => e.currentTarget.select()}
            />
            <button
              type="button"
              onClick={() => url && handleCopy(url, 'url')}
              disabled={!url}
              className="px-3 py-2 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg text-slate-600 transition-colors"
              aria-label="Copy share link"
            >
              {copyFeedback === 'url' ? <Check className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4" />}
            </button>
          </div>
        </div>

        <div className="border-t border-slate-100 my-4"></div>

        <div>
          <div className="flex justify-between items-end mb-2">
            <label className="text-sm font-medium text-slate-700 flex items-center gap-2" htmlFor="layout-json">
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

          <label className="text-sm font-medium text-slate-700 mb-2 flex items-center gap-2" htmlFor="import-json">
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
