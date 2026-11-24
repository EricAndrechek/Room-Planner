/**
 * Drawing primitives of the exported plan ("scene") and the palette its parts share. The scene is
 * built in scene.ts (page layout and annotations), scene/rooms.ts (walls, doors, windows) and
 * scene/items.ts (furniture); svg.ts and the PDF writer render it.
 */

/** Clockwise rotation (SVG/CSS convention) about (cx, cy). */
export interface Rotation {
  deg: number;
  cx: number;
  cy: number;
}

interface Paint {
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  dash?: number[];
  rotate?: Rotation;
}

export interface RectNode extends Paint {
  kind: 'rect';
  x: number;
  y: number;
  w: number;
  h: number;
  rx?: number;
}

export type PathCommand =
  | ['M', number, number]
  | ['L', number, number]
  | ['C', number, number, number, number, number, number]
  | ['Z'];

export interface PathNode extends Paint {
  kind: 'path';
  d: PathCommand[];
}

export interface TextNode {
  kind: 'text';
  /** Anchor point on the baseline. */
  x: number;
  y: number;
  text: string;
  size: number;
  bold?: boolean;
  anchor: 'start' | 'middle' | 'end';
  fill: string;
  rotate?: Rotation;
}

export interface GroupNode {
  kind: 'group';
  /** Semantic role, emitted as data attributes in the SVG (used by tests and print CSS). */
  role: string;
  attrs?: Record<string, string>;
  children: SceneNode[];
}

export type SceneNode = RectNode | PathNode | TextNode | GroupNode;

export interface Scene {
  width: number;
  height: number;
  title: string;
  background: string;
  nodes: SceneNode[];
}

// --- Style -------------------------------------------------------------------------

export const WALL = '#334155'; // slate-700, the editor's wall color
export const INK = '#0f172a'; // slate-900
export const TEXT = '#334155';
export const MUTED = '#64748b'; // slate-500
export const RULE = '#cbd5e1'; // slate-300
export const GRID = '#edf1f6';
export const DOOR_FILL = '#cbd5e1';
export const DOOR_STROKE = '#64748b';
export const SWING = '#94a3b8';
export const GLASS_FILL = '#e0f2fe';
export const GLASS = '#3b82f6';

export const FONT_LABEL_MAX = 13;
export const FONT_LABEL_MIN = 7;

export const r2 = (n: number) => Math.round(n * 100) / 100;
