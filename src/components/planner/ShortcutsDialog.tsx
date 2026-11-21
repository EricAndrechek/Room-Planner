import { useState } from 'react';
import { SHORTCUT_GROUPS, detectPlatform, shortcutKeys } from '../../lib/shortcuts';
import { Modal } from './Modal';

interface ShortcutsDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

/** Every keyboard shortcut, grouped, with ⌘/⌥ on a Mac and Ctrl/Alt elsewhere. Opened with `?`. */
export function ShortcutsDialog({ isOpen, onClose }: ShortcutsDialogProps) {
  const [platform] = useState(detectPlatform);
  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Keyboard shortcuts">
      {/* Focusable so keyboard users can scroll the list (it has no controls of its own). */}
      <div
        className="space-y-5 rounded-sm outline-hidden focus-visible:ring-2 focus-visible:ring-indigo-500"
        data-testid="shortcuts"
        tabIndex={0}
        role="group"
        aria-label="Shortcuts"
      >
        {SHORTCUT_GROUPS.map((group) => (
          <section key={group.title} aria-labelledby={`shortcuts-${group.title}`}>
            <h4
              id={`shortcuts-${group.title}`}
              className="text-xs font-bold text-slate-600 uppercase tracking-wider mb-2"
            >
              {group.title}
            </h4>
            <dl className="divide-y divide-slate-100">
              {group.shortcuts.map((s) => (
                <div key={s.action} className="flex items-start justify-between gap-3 py-1.5">
                  <dt className="flex flex-wrap items-center gap-1 shrink-0 text-xs">
                    {shortcutKeys(s, platform).map((combo, i) => (
                      <span key={i} className="flex items-center gap-1">
                        {i > 0 && <span className="text-slate-600">or</span>}
                        {combo.map((key) => (
                          <kbd
                            key={key}
                            className="min-w-[1.5rem] px-1.5 py-0.5 bg-slate-100 border border-slate-300 rounded-sm font-mono text-[11px] text-slate-800 text-center"
                          >
                            {key}
                          </kbd>
                        ))}
                      </span>
                    ))}
                  </dt>
                  <dd className="text-xs text-slate-700 text-right">{s.action}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </Modal>
  );
}
