import { useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/** Hover tooltip rendered in a portal and kept inside the viewport. */
export function Tooltip({ children, text }: { children: ReactNode; text: string }) {
  const [show, setShow] = useState(false);
  const [tooltipStyle, setTooltipStyle] = useState<CSSProperties>({});
  const [arrowLeft, setArrowLeft] = useState(0);
  const [position, setPosition] = useState<'top' | 'bottom'>('top');
  const triggerRef = useRef<HTMLDivElement>(null);

  const handleMouseEnter = () => {
    if (triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      const tooltipHeight = 32;
      const tooltipWidth = text.length * 7 + 16; // rough estimate
      const padding = 8;
      const vertPos = rect.top < tooltipHeight + padding ? 'bottom' : 'top';
      setPosition(vertPos);
      const top = vertPos === 'top' ? rect.top - tooltipHeight - padding : rect.bottom + padding;
      let left = rect.left + rect.width / 2 - tooltipWidth / 2;
      left = Math.max(padding, Math.min(window.innerWidth - tooltipWidth - padding, left));
      setTooltipStyle({ position: 'fixed', top: `${top}px`, left: `${left}px`, zIndex: 999999 });
      setArrowLeft(rect.left + rect.width / 2 - left);
    }
    setShow(true);
  };

  return (
    <div
      ref={triggerRef}
      className="relative inline-flex"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={() => setShow(false)}
    >
      {children}
      {show &&
        createPortal(
          <div
            className="px-2 py-1 bg-slate-800 text-white text-xs rounded-sm whitespace-nowrap pointer-events-none"
            style={tooltipStyle}
            role="tooltip"
          >
            {text}
            <div
              className={`absolute border-4 border-transparent -translate-x-1/2 ${
                position === 'top' ? 'top-full border-t-slate-800' : 'bottom-full border-b-slate-800'
              }`}
              style={{ left: `${arrowLeft}px` }}
            />
          </div>,
          document.body,
        )}
    </div>
  );
}
