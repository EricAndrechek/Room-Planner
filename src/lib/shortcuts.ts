/**
 * Every keyboard shortcut, grouped, in one place: the in-app shortcuts panel (`?`), toolbar
 * tooltips and the /help/ page all render from this list, so they never drift apart.
 */

export type Platform = 'mac' | 'other' | 'generic';

/** Whether this device's keyboard has ⌘/⌥ (Mac, iPhone, iPad). Browser only. */
export const detectPlatform = (): Platform => {
  if (typeof navigator === 'undefined') return 'generic';
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  const name = nav.userAgentData?.platform || nav.platform || nav.userAgent || '';
  return /mac|iphone|ipad|ipod/i.test(name) ? 'mac' : 'other';
};

/** Key names: Mac glyphs, PC names, or both (the static /help/ page, which cannot detect). */
export const KEY_NAMES: Record<Platform, { mod: string; alt: string; shift: string }> = {
  mac: { mod: '⌘', alt: '⌥', shift: '⇧' },
  other: { mod: 'Ctrl', alt: 'Alt', shift: 'Shift' },
  generic: { mod: 'Ctrl/⌘', alt: 'Alt/Option', shift: 'Shift' },
};

type Keys = ReturnType<typeof keyNames>;
const keyNames = (p: Platform) => KEY_NAMES[p];

export interface Shortcut {
  /** Alternative key combinations, each a list of keys pressed together. */
  keys: (k: Keys) => string[][];
  action: string;
}

export interface ShortcutGroup {
  title: 'Move' | 'Rotate' | 'Edit' | 'View';
  shortcuts: Shortcut[];
}

export const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    title: 'Move',
    shortcuts: [
      {
        keys: () => [['Arrow keys']],
        action:
          'Move the selected piece (or door, window or corner) 3 in (5 cm); a piece snaps to a nearby wall or edge',
      },
      { keys: (k) => [[k.shift, 'Arrow keys']], action: 'Move 1 ft (25 cm)' },
      {
        keys: (k) => [
          [k.alt, 'Arrow keys'],
          [k.mod, 'Arrow keys'],
        ],
        action: 'Move 1 in (1 cm), exactly, without snapping',
      },
      {
        keys: (k) => [[k.alt, 'drag']],
        action: 'Move or rotate a piece, or drag a corner, without snapping',
      },
    ],
  },
  {
    title: 'Rotate',
    shortcuts: [
      { keys: () => [['R']], action: 'Rotate the selected piece 90° clockwise' },
      { keys: (k) => [[k.shift, 'R']], action: 'Rotate 90° counter-clockwise' },
      { keys: (k) => [[k.alt, 'R']], action: 'Rotate 1° clockwise' },
      { keys: (k) => [[k.alt, k.shift, 'R']], action: 'Rotate 1° counter-clockwise' },
      { keys: (k) => [[k.shift, 'rotate handle']], action: 'Rotate in 15° steps' },
    ],
  },
  {
    title: 'Edit',
    shortcuts: [
      { keys: (k) => [[k.mod, 'Z']], action: 'Undo' },
      // Apple orders modifiers ⇧ before ⌘; elsewhere Ctrl comes first.
      {
        keys: (k) => [k.mod === '⌘' ? [k.shift, k.mod, 'Z'] : [k.mod, k.shift, 'Z']],
        action: 'Redo',
      },
      {
        keys: () => [['Delete'], ['Backspace']],
        action: 'Delete the selected piece (or, in Room Setup, door, window or corner)',
      },
      { keys: () => [['I']], action: 'Move the selected piece to the inventory' },
      { keys: () => [['Escape']], action: 'Deselect' },
    ],
  },
  {
    title: 'View',
    shortcuts: [
      {
        keys: () => [['Tab']],
        action:
          'Move between pieces (or door, window and corner handles in Room Setup); focusing one selects it',
      },
      { keys: () => [['?']], action: 'Show these keyboard shortcuts' },
    ],
  },
];

/** The combinations of a shortcut for a platform, e.g. [['⌘', 'Z']]. */
export const shortcutKeys = (s: Shortcut, platform: Platform): string[][] =>
  s.keys(keyNames(platform));

/** A key combination as tooltip text: "⌘Z" on a Mac, "Ctrl+Z" elsewhere. */
export const comboText = (combo: string[], platform: Platform): string =>
  platform === 'mac' ? combo.join('') : combo.join('+');

/** Tooltip hints for the toolbar buttons. */
export const toolbarHint = (action: 'undo' | 'redo', platform: Platform): string => {
  const group = SHORTCUT_GROUPS.find((g) => g.title === 'Edit')!;
  const s = group.shortcuts.find((x) => x.action === (action === 'undo' ? 'Undo' : 'Redo'))!;
  return comboText(shortcutKeys(s, platform)[0]!, platform);
};
