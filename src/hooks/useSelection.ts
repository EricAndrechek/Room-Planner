import { useCallback, useEffect, useState } from 'react';
import type { Id, Selection } from '../types';

/**
 * What is selected on the canvas (a furniture piece, door or window) and which
 * piece's color picker is open. The desktop color popover closes on any press
 * outside it.
 */
export function useSelection() {
  const [selection, setSelection] = useState<Selection | null>(null);
  const [colorPickerItemId, setColorPickerItemId] = useState<Id | null>(null);

  const selectItem = useCallback((id: Id) => setSelection({ id, type: 'item' }), []);

  /** Drop the selection and color picker if they point at this (removed) piece. */
  const forgetItem = useCallback((id: Id) => {
    setSelection((s) => (s?.type === 'item' && s.id === id ? null : s));
    setColorPickerItemId((c) => (c === id ? null : c));
  }, []);

  /** Deselect everything and close the color picker. */
  const clearSelection = useCallback(() => {
    setSelection(null);
    setColorPickerItemId(null);
  }, []);

  const toggleColorPicker = useCallback(
    (id: Id) => setColorPickerItemId((c) => (c === id ? null : id)),
    [],
  );
  const closeColorPicker = useCallback(() => setColorPickerItemId(null), []);

  // Close the desktop color popover on any outside press.
  useEffect(() => {
    if (colorPickerItemId === null) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target instanceof Element ? e.target : null;
      if (!target?.closest('[data-color-picker]') && !target?.closest('[data-color-button]')) {
        setColorPickerItemId(null);
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [colorPickerItemId]);

  return {
    selection,
    setSelection,
    selectItem,
    forgetItem,
    clearSelection,
    colorPickerItemId,
    toggleColorPicker,
    closeColorPicker,
  };
}
