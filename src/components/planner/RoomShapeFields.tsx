import { useId, useState } from 'react';
import { formatArea, roomConfirmAboveFeet, roomMaxFeet } from '../../core/units';
import {
  lShapeOf,
  wallAngle,
  wallLength,
  type CutCorner,
  type LShape,
} from '../../core/geometry/walls';
import { L_MIN_SIDE, defaultLShape, fitLShape, type ShapeChoice } from '../../lib/edits';
import { roomArea, roomSize } from '../../lib/plans';
import type { Room, RoomDims, UnitSystem } from '../../types';
import { DimensionInput } from './DimensionInput';
import { Segmented } from './Segmented';

const SHAPES: { value: ShapeChoice; label: string }[] = [
  { value: 'rect', label: 'Rectangle' },
  { value: 'l', label: 'L-shape' },
  { value: 'custom', label: 'Custom' },
];

const CUT_CORNERS: { value: CutCorner; label: string }[] = [
  { value: 'tl', label: 'Top left' },
  { value: 'tr', label: 'Top right' },
  { value: 'br', label: 'Bottom right' },
  { value: 'bl', label: 'Bottom left' },
];

interface RoomShapeFieldsProps {
  room: Room;
  shape: ShapeChoice;
  unitSystem: UnitSystem;
  inputClass: string;
  smallInputClass: string;
  onShapeChange: (shape: ShapeChoice) => void;
  onRoomDimsChange: (dims: RoomDims) => void;
  onLShapeChange: (l: LShape) => void;
  /** False if the wall cannot have that length (walls would cross). */
  onWallLengthChange: (wall: number, length: number) => boolean;
  highlightedWall: number | null;
  onHighlightWall: (wall: number | null) => void;
}

/**
 * The room's shape in the Room Setup panel: the Shape control, then the fields for it, Width and
 * Length for a rectangle, the overall size and the cut-out corner for an L, and for a Custom
 * outline the wall list (each wall's length, editable, and its angle), which is the precise and
 * keyboard path next to dragging the corners on the plan. The area is shown for every shape.
 */
export function RoomShapeFields(props: RoomShapeFieldsProps) {
  const { room, shape, unitSystem, inputClass, smallInputClass } = props;
  const dims = roomSize(room);
  const uid = useId();
  const fid = (...parts: (string | number)[]) => [uid, ...parts].join('-');
  // Full-width row under paired fields for their errors and "did you mean?" prompts.
  const [messages, setMessages] = useState<HTMLDivElement | null>(null);
  const [wallError, setWallError] = useState('');
  const max = roomMaxFeet(unitSystem);
  const confirmAbove = roomConfirmAboveFeet(unitSystem);
  const l = lShapeOf(room) ?? defaultLShape(dims);
  const setL = (patch: Partial<LShape>) => props.onLShapeChange(fitLShape({ ...l, ...patch }));

  const sizeField = (
    key: 'width' | 'height',
    label: string,
    value: number,
    onChange: (v: number) => void,
    min: number,
  ) => (
    <div>
      <label htmlFor={fid('room', key)} className="block text-xs font-medium mb-1">
        {label}
      </label>
      <DimensionInput
        id={fid('room', key)}
        value={value}
        onChange={onChange}
        className={inputClass}
        placeholder="e.g. 12"
        min={min}
        max={max}
        confirmAbove={confirmAbove}
        messageSlot={messages}
        messageLabel={label}
        label={`Room ${label.toLowerCase()}`}
        unitSystem={unitSystem}
      />
    </div>
  );

  const area = shape === 'rect' ? dims.width * dims.height : roomArea(room);

  return (
    <section data-testid="room-shape">
      <h2 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">
        Room Dimensions
      </h2>
      <div className="mb-3">
        <span className="block text-xs font-medium mb-1" aria-hidden="true">
          Shape
        </span>
        <Segmented
          label="Room shape"
          options={SHAPES}
          value={shape}
          onChange={props.onShapeChange}
        />
      </div>

      {shape === 'rect' && (
        <div className="grid grid-cols-2 gap-3">
          {sizeField(
            'width',
            'Width',
            dims.width,
            (v) => props.onRoomDimsChange({ ...dims, width: v }),
            1,
          )}
          {sizeField(
            'height',
            'Length',
            dims.height,
            (v) => props.onRoomDimsChange({ ...dims, height: v }),
            1,
          )}
        </div>
      )}

      {shape === 'l' && (
        <div className="space-y-3" data-testid="l-shape-fields">
          <div className="grid grid-cols-2 gap-3">
            {sizeField('width', 'Width', l.width, (v) => setL({ width: v }), 2 * L_MIN_SIDE + 0.5)}
            {sizeField(
              'height',
              'Length',
              l.height,
              (v) => setL({ height: v }),
              2 * L_MIN_SIDE + 0.5,
            )}
          </div>
          <div>
            <span className="block text-xs font-medium mb-1" aria-hidden="true">
              Cut-out corner
            </span>
            <Segmented
              label="Cut-out corner"
              options={CUT_CORNERS}
              value={l.corner}
              onChange={(corner) => setL({ corner })}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor={fid('cut-width')} className="block text-xs font-medium mb-1">
                Cut width
              </label>
              <DimensionInput
                id={fid('cut-width')}
                value={l.cutWidth}
                onChange={(v) => setL({ cutWidth: v })}
                className={inputClass}
                min={L_MIN_SIDE}
                max={Math.max(L_MIN_SIDE, l.width - L_MIN_SIDE)}
                messageSlot={messages}
                messageLabel="Cut width"
                label="Cut-out width"
                unitSystem={unitSystem}
              />
            </div>
            <div>
              <label htmlFor={fid('cut-length')} className="block text-xs font-medium mb-1">
                Cut length
              </label>
              <DimensionInput
                id={fid('cut-length')}
                value={l.cutHeight}
                onChange={(v) => setL({ cutHeight: v })}
                className={inputClass}
                min={L_MIN_SIDE}
                max={Math.max(L_MIN_SIDE, l.height - L_MIN_SIDE)}
                messageSlot={messages}
                messageLabel="Cut length"
                label="Cut-out length"
                unitSystem={unitSystem}
              />
            </div>
          </div>
        </div>
      )}

      {shape === 'custom' && (
        <div data-testid="wall-list">
          <p className="text-[11px] leading-snug text-slate-500 mb-2">
            Drag the corners on the plan, or type a wall&apos;s length. Tap + on a wall to add a
            corner; select a corner and press Delete to remove it.
          </p>
          <ol className="space-y-1.5" aria-label="Walls">
            {room.outline.map((_, w) => {
              const lit = props.highlightedWall === w;
              return (
                <li
                  key={w}
                  className={`flex items-center gap-2 rounded-md border px-2 py-1 ${
                    lit ? 'border-indigo-400 bg-indigo-50' : 'border-slate-200 bg-white'
                  }`}
                  onPointerEnter={() => props.onHighlightWall(w)}
                  onPointerLeave={() => props.onHighlightWall(null)}
                  onFocus={() => props.onHighlightWall(w)}
                  onBlur={() => props.onHighlightWall(null)}
                  data-testid="wall-row"
                >
                  <label
                    htmlFor={fid('wall', w)}
                    className="w-12 shrink-0 text-[11px] font-medium text-slate-700"
                  >
                    Wall {w + 1}
                  </label>
                  <div className="flex-1">
                    <DimensionInput
                      id={fid('wall', w)}
                      value={wallLength(room, w)}
                      onChange={(v) => {
                        const ok = props.onWallLengthChange(w, v);
                        setWallError(
                          ok ? '' : `Wall ${w + 1} can't be that long: walls would cross.`,
                        );
                      }}
                      className={smallInputClass}
                      min={0.25}
                      max={max}
                      label={`Wall ${w + 1} length`}
                      unitSystem={unitSystem}
                    />
                  </div>
                  <span
                    className="w-10 shrink-0 text-right text-[11px] tabular-nums text-slate-600"
                    title="Direction, clockwise from pointing right"
                  >
                    <span className="sr-only">Direction </span>
                    {Math.round(wallAngle(room, w))}°
                  </span>
                </li>
              );
            })}
          </ol>
          {wallError && (
            <p className="mt-1 text-[10px] leading-tight text-red-700" role="alert">
              {wallError}
            </p>
          )}
        </div>
      )}

      <div ref={setMessages} data-testid="room-dims-messages" />
      <div className="mt-2 text-xs text-slate-500">
        Total area: <strong data-testid="room-area">{formatArea(area, 1)}</strong>
        {shape !== 'rect' && <span> · {room.outline.length} walls</span>}
      </div>
    </section>
  );
}
