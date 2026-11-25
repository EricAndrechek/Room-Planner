/**
 * What the planner stored, read back in the terms its fields show (docs/design/plan-format.md,
 * section 4): the working plan in `room-planner-working` (a v4 plan in feet), its pieces by the
 * top-left corner of their box, doors and windows on named walls with their position from the
 * left (or top) end and the hinge side as drawn. Tests seed storage with the v3 keys, which the
 * first boot moves into the new ones.
 */
import type { Page } from '@playwright/test';

export const WORKING_KEY = 'room-planner-working';
export const PLANS_KEY = 'room-planner-plans';
export const UI_KEY = 'room-planner-ui';

interface Point {
  x: number;
  y: number;
}
interface StoredOpening {
  id: string;
  kind: 'door' | 'window';
  wall: number;
  offset: number;
  width: number;
  type: string;
  hinge: 'start' | 'end';
  swingAngle?: 90 | 180;
}
interface StoredItem {
  id: string;
  label: string;
  color: string;
  width: number;
  depth: number;
  shape?: string;
  placement?: { x: number; y: number; rotation: number };
  locked?: boolean;
  hidden?: boolean;
}
export interface StoredPlan {
  version: number;
  name: string;
  rooms: { id: string; name?: string; outline: Point[]; openings: StoredOpening[] }[];
  items: StoredItem[];
  settings?: { unitSystem?: string };
}

/** A piece as the furniture card shows it. */
export interface Piece {
  id: string;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  color: string;
  visible: boolean;
  locked: boolean;
}

/** A door or window as its card shows it. */
export interface Place {
  id: string;
  wall: 'top' | 'right' | 'bottom' | 'left';
  position: number;
  width: number;
  hinge: 'left' | 'right';
  type: string;
  swingAngle?: number;
}

const WALLS = ['top', 'right', 'bottom', 'left'] as const;

export const workingPlan = (page: Page): Promise<StoredPlan> =>
  page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? 'null') as StoredPlan, WORKING_KEY);

export const toPiece = (i: StoredItem): Piece => ({
  id: i.id,
  label: i.label,
  x: (i.placement?.x ?? 0) - i.width / 2,
  y: (i.placement?.y ?? 0) - i.depth / 2,
  width: i.width,
  height: i.depth,
  rotation: i.placement?.rotation ?? 0,
  color: i.color,
  visible: !i.hidden,
  locked: !!i.locked,
});

export const roomDims = (plan: StoredPlan) => {
  const [a, , c] = plan.rooms[0]!.outline;
  return { width: c!.x - a!.x, height: c!.y - a!.y };
};

export const toPlace = (plan: StoredPlan, o: StoredOpening): Place => {
  const { width: w, height: h } = roomDims(plan);
  const len = o.wall % 2 === 0 ? w : h;
  // Bottom and left run backwards along the clockwise outline.
  const reversed = o.wall >= 2;
  return {
    id: o.id,
    wall: WALLS[o.wall]!,
    position: reversed ? len - o.offset - o.width : o.offset,
    width: o.width,
    hinge: (o.hinge === 'end') !== reversed ? 'right' : 'left',
    type: o.type,
    ...(o.swingAngle ? { swingAngle: o.swingAngle } : {}),
  };
};

/** The working plan's pieces (box corner, size, rotation, flags). */
export const storedPieces = async (page: Page): Promise<Piece[]> =>
  ((await workingPlan(page))?.items ?? []).map(toPiece);

export const storedOpenings = async (page: Page, kind: 'door' | 'window'): Promise<Place[]> => {
  const plan = await workingPlan(page);
  return plan.rooms[0]!.openings.filter((o) => o.kind === kind).map((o) => toPlace(plan, o));
};

export const storedDims = async (page: Page) => roomDims(await workingPlan(page));

/** The editor state: the current plan and the mode. */
export const storedUi = (page: Page) =>
  page.evaluate(
    (k) =>
      JSON.parse(localStorage.getItem(k) ?? '{}') as {
        currentPlanId?: string | null;
        designMode?: string;
      },
    UI_KEY,
  );

/** The saved plans (My Floor Plans), in storage order. */
export const storedPlans = (page: Page) =>
  page.evaluate(
    (k) =>
      JSON.parse(localStorage.getItem(k) ?? '[]') as {
        id: string;
        updatedAt: string;
        plan: StoredPlan;
      }[],
    PLANS_KEY,
  );
