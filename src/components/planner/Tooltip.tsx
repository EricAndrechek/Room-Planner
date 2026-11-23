import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * Tooltip on hover and on keyboard focus (not on a mouse click's focus), dismissed with Escape
 * (WCAG 1.4.13). Rendered in a portal and kept inside the viewport; purely visual (the controls
 * carry their own accessible names).
 */
export function Tooltip({ children, text }: { children: ReactNode; text: string }) {
  const [show, setShow] = useState(false);
  const [tooltipStyle, setTooltipStyle] = useState<CSSProperties>({});
  const [arrowLeft, setArrowLeft] = useState(0);
  const [position, setPosition] = useState<'top' | 'bottom'>('top');
  const triggerRef = useRef<HTMLDivElement>(null);

  const open = () => {
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

  // Escape hides it without moving focus or triggering anything else.
  useEffect(() => {
    if (!show) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShow(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [show]);

  return (
    <div
      ref={triggerRef}
      className="relative inline-flex"
      onMouseEnter={open}
      onMouseLeave={() => setShow(false)}
      onFocus={(e) => {
        if (e.target.matches(':focus-visible')) open();
      }}
      onBlur={() => setShow(false)}
    >
      {children}
      {show &&
        createPortal(
          <div
            className="px-2 py-1 bg-slate-800 text-white text-xs rounded-sm whitespace-nowrap pointer-events-none animate-fade-in"
            style={tooltipStyle}
            role="tooltip"
            data-testid="tooltip"
          >
            {text}
            <div
              className={`absolute border-4 border-transparent -translate-x-1/2 ${
                position === 'top'
                  ? 'top-full border-t-slate-800'
                  : 'bottom-full border-b-slate-800'
              }`}
              style={{ left: `${arrowLeft}px` }}
            />
          </div>,
          document.body,
        )}
    </div>
  );
}
