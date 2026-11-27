/**
 * Plans as assistants write them, shared by the Worker's unit tests and the e2e tests of the plan
 * viewer.
 *
 * DINING is the plan an assistant made in the Claude iOS app ("Thanksgiving Dining – starter
 * layout"), rebuilt: a 12' × 18' room with two doors and a window, a 72 × 36 dining table and a
 * 60 × 30 folding table end to end, twelve chairs and a buffet, written the way agents write
 * plans (inches, its own ids, side chairs turned to face the table and a few inches apart).
 */

const chair = (id: string, x: number, y: number, rotation: number) => ({
  id,
  label: 'Chair',
  width: 18,
  depth: 20,
  color: '#fde68a',
  placement: { x, y, rotation },
});

/** Side chairs, 4" apart, centred on these y. */
const SIDE = [76, 98, 120, 142, 164];

export const DINING = {
  version: 4,
  name: 'Thanksgiving Dining – starter layout',
  unit: 'in',
  rooms: [
    {
      id: 'dining',
      name: 'Dining room',
      outline: [
        { x: 0, y: 0 },
        { x: 144, y: 0 },
        { x: 144, y: 216 },
        { x: 0, y: 216 },
      ],
      openings: [
        { id: 'door-kitchen', kind: 'door', wall: 2, offset: 12, width: 36 },
        { id: 'door-hall', kind: 'door', wall: 3, offset: 150, width: 32 },
        { id: 'window-1', kind: 'window', wall: 1, offset: 60, width: 48 },
      ],
    },
  ],
  items: [
    {
      id: 'table',
      label: 'Dining table',
      width: 72,
      depth: 36,
      color: '#d6b38a',
      placement: { x: 72, y: 90, rotation: 90 },
    },
    {
      id: 'folding-table',
      label: 'Folding table',
      width: 60,
      depth: 30,
      color: '#e7d3b5',
      placement: { x: 72, y: 156, rotation: 90 },
    },
    // Left side, facing the table (east), touching the dining table's edge.
    ...SIDE.map((y, i) => chair(`chair-${i + 1}`, 44, y, 90)),
    // Right side, facing west.
    ...SIDE.map((y, i) => chair(`chair-${i + 6}`, 100, y, 270)),
    // Ends: one 18" off the dining table, one at the folding table.
    chair('chair-11', 72, 26, 180),
    chair('chair-12', 72, 198, 0),
    {
      id: 'buffet',
      label: 'Buffet',
      width: 60,
      depth: 18,
      color: '#a8a29e',
      placement: { x: 135, y: 100, rotation: 90 },
    },
  ],
};
