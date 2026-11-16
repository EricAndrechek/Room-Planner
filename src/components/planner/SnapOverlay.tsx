import { memo, type CSSProperties } from 'react';
import { PIXELS_PER_UNIT } from '../../lib/constants';
import {
  fitMeasurementLabels,
  itemBounds,
  measureClearances,
  snapGuides,
  type Guide,
  type MeasurementLabel,
  type SnapResult,
} from '../../lib/snapping';
import type { FurnitureItem, Id, RoomDims, UnitSystem } from '../../types';

interface SnapOverlayProps {
  items: FurnitureItem[];
  room: RoomDims;
  zoom: number;
  unitSystem: UnitSystem;
  /** The selected (or dragged) piece. */
  itemId: Id;
  /** Set while the piece is being dragged; `snap` is null when it moves freely. */
  drag: { snap: SnapResult | null } | null;
}

const GUIDE = '#e11d48'; // rose-600: reads on white, the grid and every pastel fill
const MEASURE = '#4f46e5'; // indigo-600
const MEASURE_IDLE = '#64748b'; // slate-500

const px = (feet: number) => feet * PIXELS_PER_UNIT;

/**
 * Drawn inside the scaled room, so every size is divided by the zoom to stay constant on screen:
 * 1.5px guide lines, 11px labels.
 */
function GuideLine({ g, zoom }: { g: Guide; zoom: number }) {
  const width = (g.kind === 'wall' ? 3 : 1.5) / zoom;
  const overhang = g.kind === 'wall' ? 0 : 10 / zoom;
  const start = px(g.from) - overhang;
  const length = px(g.to - g.from) + 2 * overhang;
  // Wall guides sit just inside the wall; the others are centered on the aligned line.
  const offset = g.kind === 'wall' ? (g.pos === 0 ? 0 : -width) : -width / 2;
  const line: CSSProperties =
    g.axis === 'x'
      ? { left: px(g.pos) + offset, top: start, width, height: length }
      : { top: px(g.pos) + offset, left: start, height: width, width: length };
  const stroke: CSSProperties =
    g.kind === 'center'
      ? {
          backgroundImage: `repeating-linear-gradient(${g.axis === 'x' ? '180deg' : '90deg'}, ${GUIDE} 0 ${4 / zoom}px, transparent ${4 / zoom}px ${7 / zoom}px)`,
        }
      : { backgroundColor: GUIDE };
  return (
    <div
      className="absolute"
      style={{ ...line, ...stroke }}
      data-testid="snap-guide"
      data-axis={g.axis}
      data-kind={g.kind}
    />
  );
}

function MeasureLine({ m, zoom, active }: { m: MeasurementLabel; zoom: number; active: boolean }) {
  const color = active ? MEASURE : MEASURE_IDLE;
  const w = 1 / zoom;
  const tick = 8 / zoom;
  const horizontal = m.side === 'left' || m.side === 'right';
  const x = px(Math.min(m.x1, m.x2));
  const y = px(Math.min(m.y1, m.y2));
  const len = px(horizontal ? Math.abs(m.x2 - m.x1) : Math.abs(m.y2 - m.y1));
  const tickStyle = (at: number): CSSProperties =>
    horizontal
      ? { left: x + at - w / 2, top: y - tick / 2, width: w, height: tick }
      : { left: x - tick / 2, top: y + at - w / 2, width: tick, height: w };
  return (
    <>
      <div
        className="absolute"
        style={{
          backgroundColor: color,
          ...(horizontal
            ? { left: x, top: y - w / 2, width: len, height: w }
            : { left: x - w / 2, top: y, width: w, height: len }),
        }}
      />
      <div className="absolute" style={{ backgroundColor: color, ...tickStyle(0) }} />
      <div className="absolute" style={{ backgroundColor: color, ...tickStyle(len) }} />
      <div
        className={`absolute whitespace-nowrap rounded-full px-1.5 text-[11px] leading-[18px] font-semibold tabular-nums ${
          active
            ? 'bg-indigo-600 text-white shadow-sm'
            : 'bg-white/95 text-slate-700 ring-1 ring-slate-300'
        }`}
        style={{
          left: px((m.x1 + m.x2) / 2),
          top: px((m.y1 + m.y2) / 2),
          transform: `translate(-50%, -50%) scale(${1 / zoom})`,
        }}
        data-testid="measurement"
        data-side={m.side}
      >
        {m.text}
      </div>
    </>
  );
}

/**
 * Alignment guides (while dragging) and clearance measurements (while dragging, and more subtly
 * while a piece is selected), on top of the furniture. Decorative: the same information reaches
 * screen readers through the live region ("Against left wall") and each piece's position.
 */
export const SnapOverlay = memo(function SnapOverlay({
  items,
  room,
  zoom,
  unitSystem,
  itemId,
  drag,
}: SnapOverlayProps) {
  const item = items.find((i) => i.id === itemId && i.visible !== false);
  if (!item) return null;
  const bounds = itemBounds(item);
  const guides = drag?.snap ? snapGuides(drag.snap) : [];
  const labels = fitMeasurementLabels(
    measureClearances(bounds, items, room, item.id),
    zoom,
    PIXELS_PER_UNIT,
    unitSystem,
  );
  return (
    <div
      className="absolute inset-0 pointer-events-none"
      style={{ zIndex: 60 }}
      aria-hidden="true"
      data-testid="snap-overlay"
      data-dragging={drag ? 'true' : undefined}
    >
      {/* Guides under the measurements, so a label is never crossed by a line. */}
      {guides.map((g) => (
        <GuideLine key={`${g.axis}${g.pos}`} g={g} zoom={zoom} />
      ))}
      {labels.map((m) => (
        <MeasureLine key={m.side} m={m} zoom={zoom} active={!!drag} />
      ))}
    </div>
  );
});
