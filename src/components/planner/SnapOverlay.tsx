import { memo, type CSSProperties } from 'react';
import { Magnet } from 'lucide-react';
import type { AngleSnap, Point } from '../../core/geometry';
import { PIXELS_PER_UNIT } from '../../lib/constants';
import {
  fitMeasurementLabels,
  itemBounds,
  measureClearances,
  snapGuides,
  type Guide,
  type MeasurementLabel,
  type SnapResult,
} from '../../core/snapping';
import type { SnapPiece } from '../../lib/plans';
import type { Id, RoomDims, UnitSystem } from '../../types';

interface SnapOverlayProps {
  /** The placed pieces as boxes (`snapPieces`). */
  items: SnapPiece[];
  room: RoomDims;
  /** A room that is not a rectangle: wall clearances are measured to its outline. */
  outline?: readonly Point[];
  zoom: number;
  unitSystem: UnitSystem;
  /** The selected (or dragged) piece. */
  itemId: Id;
  /** Set while the piece is being dragged; `snap` is null when it moves freely. */
  drag: { snap: SnapResult | null } | null;
  /** Set while the piece is being rotated with its handle. */
  rotation?: AngleSnap | null;
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
  // Dashed center guides use a border (cheap to paint, even across the whole room).
  const stroke: CSSProperties =
    g.kind === 'center'
      ? g.axis === 'x'
        ? { borderLeft: `${width}px dashed ${GUIDE}` }
        : { borderTop: `${width}px dashed ${GUIDE}` }
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
        translate="no"
      >
        {m.text}
      </div>
    </>
  );
}

/**
 * Alignment guides (while dragging) and clearance measurements (while dragging, and more subtly
 * while a piece is selected). Decorative: the same information reaches
 * screen readers through the live region ("Against left wall") and each piece's position.
 */
/**
 * While rotating with the handle: the live angle in a badge under the piece, which turns rose with
 * a magnet when it locks onto an angle, plus a faint axis line through the piece at that angle.
 */
function RotationFeedback({
  item,
  angle,
  zoom,
}: {
  item: SnapPiece;
  angle: AngleSnap;
  zoom: number;
}) {
  const b = itemBounds(item);
  const cx = px((b.left + b.right) / 2);
  const cy = px((b.top + b.bottom) / 2);
  const snapped = angle.snapped !== null;
  const axisLength = px(Math.hypot(item.width, item.height)) + 48 / zoom;
  return (
    <>
      {snapped && (
        <div
          className="absolute"
          style={{
            left: cx,
            top: cy,
            width: axisLength,
            height: 0,
            borderTop: `${1.5 / zoom}px dashed ${GUIDE}`,
            opacity: 0.7,
            transform: `translate(-50%, -50%) rotate(${angle.deg}deg)`,
          }}
          data-testid="rotation-axis"
        />
      )}
      <div
        className={`absolute flex items-center gap-1 whitespace-nowrap rounded-full px-2 text-xs leading-6 font-semibold tabular-nums shadow-md ${
          snapped ? 'bg-rose-600 text-white' : 'bg-white text-slate-800 ring-1 ring-slate-300'
        }`}
        style={{
          left: cx,
          top: px(b.bottom) + 22 / zoom,
          transform: `translate(-50%, -50%) scale(${1 / zoom})`,
        }}
        data-testid="angle-badge"
        data-snapped={snapped ? 'true' : 'false'}
      >
        {snapped && <Magnet className="w-3 h-3" aria-hidden="true" />}
        {Math.round(angle.deg)}°
      </div>
    </>
  );
}

export const SnapOverlay = memo(function SnapOverlay({
  items,
  room,
  outline,
  zoom,
  unitSystem,
  itemId,
  drag,
  rotation = null,
}: SnapOverlayProps) {
  const item = items.find((i) => i.id === itemId && i.visible !== false);
  if (!item) return null;
  const bounds = itemBounds(item);
  const guides = drag?.snap ? snapGuides(drag.snap) : [];
  // While rotating, the angle is what matters: no clearance labels changing under the pointer.
  const labels = rotation
    ? []
    : fitMeasurementLabels(
        measureClearances(bounds, items, room, item.id, outline),
        zoom,
        PIXELS_PER_UNIT,
        unitSystem,
      );
  // Center guides run through the middle of pieces, where their names are: draw them under the
  // furniture (visible in the gaps between pieces). Edge and wall guides and the measurements go
  // on top.
  const under = guides.filter((g) => g.kind === 'center');
  const over = guides.filter((g) => g.kind !== 'center');
  return (
    <>
      {under.length > 0 && (
        <div
          className="absolute inset-0 pointer-events-none"
          style={{ zIndex: 5 }}
          aria-hidden="true"
        >
          {under.map((g) => (
            <GuideLine key={`${g.axis}${g.pos}`} g={g} zoom={zoom} />
          ))}
        </div>
      )}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{ zIndex: 60 }}
        aria-hidden="true"
        data-testid="snap-overlay"
        data-dragging={drag ? 'true' : undefined}
      >
        {/* Guides under the measurements, so a label is never crossed by a line. */}
        {over.map((g) => (
          <GuideLine key={`${g.axis}${g.pos}`} g={g} zoom={zoom} />
        ))}
        {labels.map((m) => (
          <MeasureLine key={m.side} m={m} zoom={zoom} active={!!drag} />
        ))}
        {rotation && <RotationFeedback item={item} angle={rotation} zoom={zoom} />}
      </div>
    </>
  );
});
