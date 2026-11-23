import { describe, expect, it } from 'vitest';
import { SHORTCUT_GROUPS, comboText, shortcutKeys, toolbarHint } from './shortcuts';

describe('keyboard shortcuts', () => {
  it('groups every shortcut under Move, Rotate, Edit and View', () => {
    expect(SHORTCUT_GROUPS.map((g) => g.title)).toEqual(['Move', 'Rotate', 'Edit', 'View']);
    expect(SHORTCUT_GROUPS.every((g) => g.shortcuts.length > 0)).toBe(true);
  });

  it('uses Mac glyphs on a Mac and key names elsewhere', () => {
    expect(toolbarHint('undo', 'mac')).toBe('⌘Z');
    expect(toolbarHint('redo', 'mac')).toBe('⇧⌘Z');
    expect(toolbarHint('undo', 'other')).toBe('Ctrl+Z');
    expect(toolbarHint('redo', 'other')).toBe('Ctrl+Shift+Z');
    const fine = SHORTCUT_GROUPS[0]!.shortcuts[2]!;
    expect(shortcutKeys(fine, 'mac')).toEqual([
      ['⌥', 'Arrow keys'],
      ['⌘', 'Arrow keys'],
    ]);
    expect(shortcutKeys(fine, 'generic')).toEqual([
      ['Alt/Option', 'Arrow keys'],
      ['Ctrl/⌘', 'Arrow keys'],
    ]);
    expect(comboText(['Alt', 'Shift', 'R'], 'other')).toBe('Alt+Shift+R');
  });
});
