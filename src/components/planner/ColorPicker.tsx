import { useLayoutEffect, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { Check, Palette, X } from 'lucide-react';
import { COLOR_PRESETS, DEFAULT_COLOR, isValidHex } from '../../lib/colors';

interface ColorPickerProps {
  currentColor: string;
  onChange: (hex: string) => void;
  onClose: () => void;
  /** Mobile renders a bottom sheet; desktop a popover anchored to `triggerRef`. */
  isMobile?: boolean;
  triggerRef?: RefObject<HTMLElement | null>;
}

const PICKER_WIDTH = 220;
const PICKER_HEIGHT = 280;

/** Preset swatches plus a custom hex / native color input. */
export function ColorPicker({
  currentColor,
  onChange,
  onClose,
  isMobile = false,
  triggerRef,
}: ColorPickerProps) {
  const [showCustom, setShowCustom] = useState(false);
  const [customHex, setCustomHex] = useState(
    currentColor.startsWith('#') ? currentColor : DEFAULT_COLOR,
  );
  const [hexError, setHexError] = useState('');
  const [position, setPosition] = useState({ top: 0, left: 0 });

  // Anchor the desktop popover under the trigger, flipping/clamping to stay on screen.
  useLayoutEffect(() => {
    if (isMobile || !triggerRef?.current) return;
    const trigger = triggerRef.current;
    const update = () => {
      const rect = trigger.getBoundingClientRect();
      let top = rect.bottom + 4;
      let left = rect.left;
      if (left + PICKER_WIDTH > window.innerWidth - 8) left = window.innerWidth - PICKER_WIDTH - 8;
      if (top + PICKER_HEIGHT > window.innerHeight - 8) top = rect.top - PICKER_HEIGHT - 4;
      if (left < 8) left = 8;
      setPosition({ top, left });
    };
    update();
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [isMobile, triggerRef]);

  const handleCustomSubmit = () => {
    if (isValidHex(customHex)) {
      onChange(customHex);
      onClose();
    } else {
      setHexError('Invalid hex code');
      setTimeout(() => setHexError(''), 2000);
    }
  };

  const isCurrentPreset = COLOR_PRESETS.some((p) => p.hex === currentColor);

  const content: ReactNode = (
    <>
      <div className="flex justify-between items-center mb-3">
        <h3 className="font-semibold text-slate-800 text-sm">Choose Color</h3>
        {isMobile && (
          <button
            type="button"
            onClick={onClose}
            className="p-1 hover:bg-slate-100 rounded-full transition-colors"
            aria-label="Close color picker"
          >
            <X className="w-5 h-5 text-slate-500" />
          </button>
        )}
      </div>

      {/* Preset Colors */}
      <div className="grid grid-cols-5 gap-2 mb-3">
        {COLOR_PRESETS.map((preset) => (
          <button
            type="button"
            key={preset.hex}
            onClick={() => {
              onChange(preset.hex);
              onClose();
            }}
            className={`${isMobile ? 'w-10 h-10' : 'w-7 h-7'} rounded-full border-2 transition-all hover:scale-110 active:scale-95`}
            style={{ backgroundColor: preset.hex, borderColor: preset.border }}
            title={preset.name}
            aria-label={`Select ${preset.name}`}
          >
            {currentColor === preset.hex && (
              <Check className={`${isMobile ? 'w-5 h-5' : 'w-4 h-4'} mx-auto text-slate-700`} />
            )}
          </button>
        ))}
      </div>

      {/* Custom Color Section */}
      <div className="border-t border-slate-200 pt-3">
        {!showCustom ? (
          <button
            type="button"
            onClick={() => setShowCustom(true)}
            className="w-full flex items-center justify-center gap-2 py-2 text-xs text-slate-600 hover:text-slate-800 hover:bg-slate-50 rounded-sm transition-colors"
          >
            <Palette className="w-3.5 h-3.5" />
            Custom Color {!isCurrentPreset && currentColor.startsWith('#') && `(${currentColor})`}
          </button>
        ) : (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <label
                className="w-8 h-8 rounded-lg border-2 border-slate-300 shrink-0 cursor-pointer shadow-xs hover:border-slate-400 hover:shadow-sm transition-all relative overflow-hidden"
                style={{ backgroundColor: isValidHex(customHex) ? customHex : '#fff' }}
                title="Click to open color picker"
              >
                <input
                  type="color"
                  value={isValidHex(customHex) ? customHex : DEFAULT_COLOR}
                  onChange={(e) => {
                    setCustomHex(e.target.value);
                    setHexError('');
                  }}
                  className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                  aria-label="Pick a custom color"
                />
              </label>
              <input
                type="text"
                value={customHex}
                onChange={(e) => {
                  let val = e.target.value;
                  if (!val.startsWith('#')) val = '#' + val;
                  setCustomHex(val.slice(0, 7));
                  setHexError('');
                }}
                onKeyDown={(e) => e.key === 'Enter' && handleCustomSubmit()}
                placeholder="#93c5fd"
                aria-label="Hex color"
                className={`flex-1 px-2 py-1 text-xs font-mono border rounded-sm ${hexError ? 'border-red-400' : 'border-slate-200'} focus:outline-hidden focus:ring-1 focus:ring-indigo-500`}
              />
            </div>
            {hexError && <p className="text-[10px] text-red-500">{hexError}</p>}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setShowCustom(false)}
                className="flex-1 py-1.5 text-xs text-slate-600 hover:bg-slate-100 rounded-sm transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleCustomSubmit}
                className="flex-1 py-1.5 text-xs bg-indigo-600 hover:bg-indigo-700 text-white rounded-sm transition-colors"
              >
                Apply
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );

  if (isMobile) {
    return (
      <div
        className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-slate-900/50 backdrop-blur-xs animate-fade-in"
        onClick={onClose}
      >
        <div
          className="bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl w-full sm:w-auto sm:min-w-[280px] p-4 animate-slide-up"
          onClick={(e) => e.stopPropagation()}
          data-color-picker
        >
          {content}
        </div>
      </div>
    );
  }

  // Desktop: portal to <body> to escape the sidebar's overflow clipping.
  return createPortal(
    <div
      className="fixed bg-white rounded-lg shadow-xl border border-slate-200 p-3 z-[9999] min-w-[200px] animate-fade-in"
      style={{ top: position.top, left: position.left }}
      data-color-picker
      onClick={(e) => e.stopPropagation()}
    >
      {content}
    </div>,
    document.body,
  );
}
