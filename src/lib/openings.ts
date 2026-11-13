/**
 * Pixel geometry for drawing doors and windows on the canvas. Pure functions
 * returning inline styles, so the components only render.
 */
import type { CSSProperties } from 'react';
import type { Door, RoomDims, RoomWindow, Wall } from '../types';
import { PIXELS_PER_UNIT as P } from './constants';
import { isHorizontalWall, wallLength } from './geometry';
import { clamp } from './units';

const WALL_THICKNESS = 4;
const JAMB_LENGTH = 12;
const JAMB_WIDTH = 2;
const JAMB_COLOR = '#334155';
const DASH = '2px dashed #94a3b8';

export interface OpeningStyles {
  gap: CSSProperties;
  jamb1: CSSProperties;
  jamb2: CSSProperties;
  handle: CSSProperties;
}

export interface DoorStyles extends OpeningStyles {
  sliding: boolean;
  arc: CSSProperties;
  panel: CSSProperties;
  track: CSSProperties;
}

export interface WindowStyles extends OpeningStyles {
  pane: CSSProperties;
}

/** Position along the wall, kept on the wall even if the room shrank since. */
const onWall = (o: { position: number; width: number }, room: RoomDims, wall: Wall) =>
  clamp(o.position, 0, wallLength(room, wall) - o.width);

/** White wall gap where the opening is. */
const gapStyle = (wall: Wall, pos: number, widthPx: number, room: RoomDims): CSSProperties => {
  const base = { position: 'absolute', backgroundColor: 'white', zIndex: 10 } as const;
  switch (wall) {
    case 'bottom':
      return {
        ...base,
        left: pos * P,
        top: room.height * P - WALL_THICKNESS / 2,
        width: widthPx,
        height: WALL_THICKNESS,
      };
    case 'top':
      return {
        ...base,
        left: pos * P,
        top: -WALL_THICKNESS / 2,
        width: widthPx,
        height: WALL_THICKNESS,
      };
    case 'left':
      return {
        ...base,
        left: -WALL_THICKNESS / 2,
        top: pos * P,
        width: WALL_THICKNESS,
        height: widthPx,
      };
    case 'right':
      return {
        ...base,
        left: room.width * P - WALL_THICKNESS / 2,
        top: pos * P,
        width: WALL_THICKNESS,
        height: widthPx,
      };
  }
};

/** Architectural jamb lines at both ends of the opening. */
const jambStyles = (
  wall: Wall,
  pos: number,
  widthPx: number,
  room: RoomDims,
): [CSSProperties, CSSProperties] => {
  const base = { position: 'absolute', backgroundColor: JAMB_COLOR, zIndex: 11 } as const;
  if (isHorizontalWall(wall)) {
    const top = wall === 'top' ? -JAMB_LENGTH / 2 : room.height * P - JAMB_LENGTH / 2;
    const jamb = (x: number): CSSProperties => ({
      ...base,
      left: x - JAMB_WIDTH / 2,
      top,
      width: JAMB_WIDTH,
      height: JAMB_LENGTH,
    });
    return [jamb(pos * P), jamb(pos * P + widthPx)];
  }
  const left = wall === 'left' ? -JAMB_LENGTH / 2 : room.width * P - JAMB_LENGTH / 2;
  const jamb = (y: number): CSSProperties => ({
    ...base,
    left,
    top: y - JAMB_WIDTH / 2,
    width: JAMB_LENGTH,
    height: JAMB_WIDTH,
  });
  return [jamb(pos * P), jamb(pos * P + widthPx)];
};

/** Round drag handle centered on the opening. `inset` nudges window handles 2px into the room. */
const handleStyle = (
  wall: Wall,
  pos: number,
  widthPx: number,
  room: RoomDims,
  size: number,
  inset: number,
): CSSProperties => {
  const along = pos * P + widthPx / 2 - size / 2;
  const base = { position: 'absolute', width: size, height: size, zIndex: 20 } as const;
  switch (wall) {
    case 'bottom':
      return { ...base, left: along, top: room.height * P - size / 2, cursor: 'ew-resize' };
    case 'top':
      return { ...base, left: along, top: -size / 2 + inset, cursor: 'ew-resize' };
    case 'left':
      return { ...base, left: -size / 2 + inset, top: along, cursor: 'ns-resize' };
    case 'right':
      return { ...base, left: room.width * P - size / 2, top: along, cursor: 'ns-resize' };
  }
};

export const doorStyles = (door: Door, room: RoomDims): DoorStyles => {
  const wall = door.wall || 'bottom';
  const pos = onWall(door, room, wall);
  const widthPx = door.width * P;
  const r = door.width * P; // swing radius
  const isLeft = door.hinge === 'left';
  const type = door.type || 'swing-in';
  const swingIn = type === 'swing-in';
  const sliding = type === 'sliding';
  const [jamb1, jamb2] = jambStyles(wall, pos, widthPx, room);

  let arc: CSSProperties = {};
  let panel: CSSProperties = {};
  let track: CSSProperties = {};
  const arcBase = {
    position: 'absolute',
    width: r,
    height: r,
    border: DASH,
    opacity: 0.5,
    pointerEvents: 'none',
  } as const;
  const panelBase = {
    position: 'absolute',
    backgroundColor: '#cbd5e1',
    border: '1px solid #64748b',
  } as const;
  const trackBase = {
    position: 'absolute',
    backgroundColor: '#94a3b8',
    borderRadius: 2,
    opacity: 0.6,
  } as const;
  const startX = isLeft ? pos * P : (pos + door.width) * P - r;
  const panelX = isLeft ? pos * P : (pos + door.width) * P - 4;

  switch (wall) {
    case 'bottom': {
      const top = swingIn ? (room.height - door.width) * P : room.height * P;
      arc = {
        ...arcBase,
        borderRadius: !isLeft
          ? swingIn
            ? '100% 0 0 0'
            : '0 0 0 100%'
          : swingIn
            ? '0 100% 0 0'
            : '0 0 100% 0',
        borderBottom: swingIn ? DASH : 'none',
        borderTop: !swingIn ? DASH : 'none',
        borderLeft: !isLeft ? DASH : 'none',
        borderRight: isLeft ? DASH : 'none',
        left: startX,
        top,
      };
      panel = { ...panelBase, width: 4, height: r, top, left: panelX };
      track = { ...trackBase, left: pos * P, top: room.height * P - 8, width: widthPx, height: 6 };
      break;
    }
    case 'top': {
      const top = swingIn ? 0 : -r;
      arc = {
        ...arcBase,
        borderRadius: isLeft
          ? swingIn
            ? '0 0 100% 0'
            : '0 0 0 100%'
          : swingIn
            ? '0 0 0 100%'
            : '0 0 100% 0',
        borderTop: !swingIn ? DASH : 'none',
        borderBottom: swingIn ? DASH : 'none',
        borderLeft: isLeft ? DASH : 'none',
        borderRight: !isLeft ? DASH : 'none',
        left: startX,
        top,
      };
      panel = { ...panelBase, width: 4, height: r, top, left: panelX };
      track = { ...trackBase, left: pos * P, top: 2, width: widthPx, height: 6 };
      break;
    }
    case 'left': {
      const left = swingIn ? 0 : -r;
      const arcTop = isLeft ? pos * P : (pos + door.width) * P - r;
      arc = {
        ...arcBase,
        borderRadius: isLeft
          ? swingIn
            ? '0 100% 0 0'
            : '0 0 0 100%'
          : swingIn
            ? '0 0 100% 0'
            : '100% 0 0 0',
        borderLeft: !swingIn ? DASH : 'none',
        borderRight: swingIn ? DASH : 'none',
        borderTop: isLeft ? DASH : 'none',
        borderBottom: !isLeft ? DASH : 'none',
        left,
        top: arcTop,
      };
      panel = {
        ...panelBase,
        width: r,
        height: 4,
        left,
        top: isLeft ? pos * P : (pos + door.width) * P - 4,
      };
      track = { ...trackBase, left: 2, top: pos * P, width: 6, height: widthPx };
      break;
    }
    case 'right': {
      const left = swingIn ? (room.width - door.width) * P : room.width * P;
      const arcTop = isLeft ? pos * P : (pos + door.width) * P - r;
      arc = {
        ...arcBase,
        borderRadius: !isLeft
          ? swingIn
            ? '100% 0 0 0'
            : '0 0 100% 0'
          : swingIn
            ? '0 0 0 100%'
            : '0 100% 0 0',
        borderLeft: swingIn ? DASH : 'none',
        borderRight: !swingIn ? DASH : 'none',
        borderTop: !isLeft ? DASH : 'none',
        borderBottom: isLeft ? DASH : 'none',
        left,
        top: arcTop,
      };
      panel = {
        ...panelBase,
        width: r,
        height: 4,
        left,
        top: isLeft ? pos * P : (pos + door.width) * P - 4,
      };
      track = { ...trackBase, left: room.width * P - 8, top: pos * P, width: 6, height: widthPx };
      break;
    }
  }

  return {
    sliding,
    gap: gapStyle(wall, pos, widthPx, room),
    jamb1,
    jamb2,
    arc,
    panel,
    track,
    handle: handleStyle(wall, pos, widthPx, room, 20, 0),
  };
};

export const windowStyles = (win: RoomWindow, room: RoomDims): WindowStyles => {
  const wall = win.wall || 'top';
  const pos = onWall(win, room, wall);
  const widthPx = win.width * P;
  const [jamb1, jamb2] = jambStyles(wall, pos, widthPx, room);
  const paneBase = {
    position: 'absolute',
    backgroundColor: '#93c5fd',
    border: '2px solid #3b82f6',
    borderRadius: 2,
    zIndex: 11,
  } as const;
  let pane: CSSProperties;
  switch (wall) {
    case 'top':
      pane = {
        ...paneBase,
        left: pos * P,
        top: -2,
        width: widthPx,
        height: 8,
        cursor: 'ew-resize',
      };
      break;
    case 'bottom':
      pane = {
        ...paneBase,
        left: pos * P,
        top: room.height * P - 6,
        width: widthPx,
        height: 8,
        cursor: 'ew-resize',
      };
      break;
    case 'left':
      pane = {
        ...paneBase,
        left: -2,
        top: pos * P,
        width: 8,
        height: widthPx,
        cursor: 'ns-resize',
      };
      break;
    case 'right':
      pane = {
        ...paneBase,
        left: room.width * P - 6,
        top: pos * P,
        width: 8,
        height: widthPx,
        cursor: 'ns-resize',
      };
      break;
  }
  return {
    gap: gapStyle(wall, pos, widthPx, room),
    jamb1,
    jamb2,
    pane,
    handle: handleStyle(wall, pos, widthPx, room, 16, 2),
  };
};
