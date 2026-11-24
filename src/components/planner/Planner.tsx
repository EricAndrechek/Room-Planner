import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { ArrowRight, Pencil, Plus } from 'lucide-react';
import { useAnnouncements } from '../../hooks/useAnnouncements';
import { useBottomSheet } from '../../hooks/useBottomSheet';
import {
  SHEET_SETTLE_MS,
  latestCard,
  nextCardSeq,
  type CardRef,
} from '../../hooks/useCardHighlight';
import {
  useFurnitureEditing,
  type DragFrame,
  type RotateFrame,
} from '../../hooks/useFurnitureEditing';
import { useHistory } from '../../hooks/useHistory';
import { useIsMobile } from '../../hooks/useIsMobile';
import { useKeyboardShortcuts } from '../../hooks/useKeyboardShortcuts';
import { useNotice } from '../../hooks/useNotice';
import { useOpenings } from '../../hooks/useOpenings';
import { usePanZoom, type ViewInsets } from '../../hooks/usePanZoom';
import { usePointerDrag } from '../../hooks/usePointerDrag';
import { useProjectActions, type NewPlanStart } from '../../hooks/useProjectActions';
import { useProjects } from '../../hooks/useProjects';
import { useRotationDrag } from '../../hooks/useRotationDrag';
import { useSelection } from '../../hooks/useSelection';
import { track } from '../../lib/analytics';
import type { BootState } from '../../lib/boot';
import { migrateColor } from '../../lib/colors';
import { DESIGN_MODES } from '../../lib/constants';
import { normalizeDegrees } from '../../lib/geometry';
import { moveInside, piecesOutside } from '../../lib/placement';
import { computeLayoutWarnings } from '../../lib/openings';
import { toShareConfig } from '../../lib/layout';
import { HELP_PATH } from '../../lib/paths';
import { sheetSummary } from '../../lib/sheet';
import { nudgeStep } from '../../lib/units';
import {
  loadSnapPreference,
  saveDesignMode,
  saveLayout,
  saveSnapPreference,
  saveUnitSystem,
  type StorageLike,
} from '../../lib/storage';
import type {
  DesignMode,
  FurnitureItem,
  Id,
  Layout,
  RoomDims,
  UnitSystem,
  Wall,
} from '../../types';
import { ColorPicker } from './ColorPicker';
import { ExportModal } from './ExportModal';
import { FileBrowserModal } from './FileBrowserModal';
import { FurniturePanel } from './FurniturePanel';
import { Header } from './Header';
import { PwaNotices } from './PwaNotices';
import { PopoverRootContext } from './PopoverRoot';
import { RoomCanvas } from './RoomCanvas';
import { RoomSetupPanel } from './RoomSetupPanel';
import { ShareModal } from './ShareModal';
import { ShortcutsDialog } from './ShortcutsDialog';
import { Sidebar } from './Sidebar';
import { SnapOverlay } from './SnapOverlay';
import { SnapToggle } from './SnapToggle';
import { FloatingZoomControls } from './ZoomControls';

/** A repeat press on a locked piece within this time does not bring the notice back. */
const LOCKED_PROMPT_THROTTLE_MS = 3000;
const LOCKED_PROMPT_MS = 6000;

/** Phones: the mode badge covers the top of the plan (px)... */
const BADGE_INSET = 40;
/** ...and the zoom pill and Snap chip ride this far above the sheet (px, with their gap). */
const FLOATING_ROW_INSET = 60;
const NO_INSETS: ViewInsets = { top: 0, bottom: 0 };

interface PlannerProps {
  storage: StorageLike;
  initial: BootState;
}

/**
 * The room planner application (everything inside the island): composes the
 * state hooks and renders the header, sidebar, canvas and modals.
 */
export function Planner({ storage, initial }: PlannerProps) {
  const history = useHistory<Layout>(initial.layout);
  const { present: layout, commit } = history;
  const [unitSystem, setUnitSystem] = useState<UnitSystem>(initial.unitSystem);
  const [designMode, setDesignMode] = useState<DesignMode>(initial.designMode);

  // Phones (below md): the editor is a bottom sheet over the plan, at peek, half or full height.
  const isMobile = useIsMobile();
  const sheet = useBottomSheet(isMobile);
  const { detent, expand: expandSheet, lower: lowerSheet } = sheet;
  const canvasCovered = isMobile && detent === 'full';

  const sel = useSelection();
  const { selection, setSelection, selectItem, colorPickerItemId } = sel;
  const [shareOpen, setShareOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [filesOpen, setFilesOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [roomSetupExpanded, setRoomSetupExpanded] = useState(false);
  const [furnitureExpanded, setFurnitureExpanded] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  // The part of the plan that shows (fitting, revealing a piece): not under the badge or the sheet.
  const sheetInset = isMobile && detent !== 'full' ? sheet.heights[detent] + FLOATING_ROW_INSET : 0;
  const viewInsets = useMemo(
    () => (isMobile ? { top: BADGE_INSET, bottom: sheetInset } : NO_INSETS),
    [isMobile, sheetInset],
  );
  const { zoom, zoomRef, pan, zoomIn, zoomOut, fitToView, reveal } = usePanZoom(
    containerRef,
    layout.roomDims,
    isMobile,
    viewInsets,
  );
  const startDrag = usePointerDrag();
  const startRotation = useRotationDrag();

  // Snapping: a per-device preference (not part of the plan), and the live drag for the overlay.
  const [snapOn, setSnapOn] = useState(() => loadSnapPreference(storage));
  const toggleSnap = useCallback(() => {
    const next = !snapOn;
    setSnapOn(next);
    saveSnapPreference(storage, next);
    track('snap_toggled', { on: next });
  }, [snapOn, storage]);
  const [dragFrame, setDragFrame] = useState<DragFrame | null>(null);
  const [rotateFrame, setRotateFrame] = useState<RotateFrame | null>(null);
  // The desktop color popover renders here: in reading order after the sidebar, outside its
  // scroll/transform (which would clip and offset a fixed-position popover).
  const [popoverRoot, setPopoverRoot] = useState<HTMLDivElement | null>(null);

  const projects = useProjects({
    storage,
    initialProjects: initial.projects,
    initialProjectId: initial.currentProjectId,
    initialSaved: initial.saveStatus === 'saved',
    initialSavedAt: initial.lastSavedAt,
    doc: { layout, designMode, unitSystem },
  });
  const projectName = projects.currentProject?.name ?? 'Untitled';

  // --- Persistence of the working state (same keys/format as before) ---------
  useEffect(() => saveLayout(storage, layout), [storage, layout]);
  useEffect(() => saveUnitSystem(storage, unitSystem), [storage, unitSystem]);
  useEffect(() => saveDesignMode(storage, designMode), [storage, designMode]);

  const isRoomSetup = designMode === DESIGN_MODES.ROOM_SETUP;
  const warnings = useMemo(
    () =>
      computeLayoutWarnings({
        items: layout.items,
        doors: layout.doors,
        roomDims: layout.roomDims,
      }),
    [layout.items, layout.doors, layout.roomDims],
  );
  const live = useAnnouncements(layout, warnings, unitSystem, projects.saveStatus);
  const shareConfig = useMemo(
    () => toShareConfig(layout, projectName, unitSystem),
    [layout, projectName, unitSystem],
  );

  // --- Notices (bottom toasts) -----------------------------------------------------
  const notices = useNotice();
  const { show: showNotice, dismiss: dismissNotice } = notices;

  // --- Modes & units ----------------------------------------------------------
  const changeDesignMode = useCallback(
    (mode: DesignMode) => {
      if (mode === designMode) return;
      setDesignMode(mode);
      if (mode === DESIGN_MODES.FURNITURE) dismissNotice('locked-piece');
      track('mode_changed', { to: mode });
    },
    [designMode, dismissNotice],
  );

  /**
   * A piece was pressed (or Enter/arrows/R used on it) while room setup locks furniture: say why
   * nothing moves, with a one-tap way into Furniture mode that keeps the piece selected.
   */
  const lastLockedPrompt = useRef(0);
  const promptLockedPiece = useCallback(
    (item: FurnitureItem, input: 'pointer' | 'keyboard') => {
      const now = Date.now();
      if (now - lastLockedPrompt.current < LOCKED_PROMPT_THROTTLE_MS) return;
      lastLockedPrompt.current = now;
      track('locked_piece_pressed', { mode: DESIGN_MODES.ROOM_SETUP, input });
      showNotice({
        key: 'locked-piece',
        message: 'Furniture is locked while you edit the room.',
        action: {
          label: 'Move furniture',
          onClick: () => {
            changeDesignMode(DESIGN_MODES.FURNITURE);
            setSelection({ id: item.id, type: 'item' });
            dismissNotice('locked-piece');
          },
        },
        timeoutMs: LOCKED_PROMPT_MS,
      });
    },
    [changeDesignMode, dismissNotice, setSelection, showNotice],
  );
  const onLockedPointerPress = useCallback(
    (item: FurnitureItem) => promptLockedPiece(item, 'pointer'),
    [promptLockedPiece],
  );
  const onLockedKeyPress = useCallback(
    (item: FurnitureItem) => promptLockedPiece(item, 'keyboard'),
    [promptLockedPiece],
  );

  const changeUnitSystem = useCallback(
    (units: UnitSystem) => {
      if (units === unitSystem) return;
      setUnitSystem(units);
      track('units_changed', { to: units });
    },
    [unitSystem],
  );

  // --- Undo / redo -----------------------------------------------------------------
  const undo = useCallback(() => {
    if (!history.canUndo) return;
    live.noteAction('Undo');
    history.undo();
    track('undo');
  }, [history, live]);

  const redo = useCallback(() => {
    if (!history.canRedo) return;
    live.noteAction('Redo');
    history.redo();
    track('redo');
  }, [history, live]);

  // --- Phone sheet: cards and pieces follow each other --------------------------------------
  // A card to bring to the top of the sheet (a piece tapped on the plan, or Edit).
  const [revealedCard, setRevealedCard] = useState<CardRef | null>(null);
  const revealCard = useCallback(
    (type: CardRef['type'], id: Id) =>
      setRevealedCard({ type, id, seq: nextCardSeq(), align: 'start' }),
    [],
  );
  /** Tapping a piece on a phone opens a collapsed sheet to half and shows its card. */
  const onPieceTap = useCallback(
    (item: FurnitureItem) => {
      revealCard('item', item.id);
      expandSheet();
    },
    [revealCard, expandSheet],
  );
  /** Pan just enough that a piece is not under the sheet (or off the edge). */
  const revealPiece = useCallback(
    (id: Id) => {
      const el = containerRef.current?.querySelector(`[data-item-id="${id}"]`);
      if (el) reveal(el);
    },
    [reveal],
  );
  const selectedItemId = selection?.type === 'item' ? selection.id : null;
  const selectedItemRef = useRef(selectedItemId);
  useEffect(() => {
    selectedItemRef.current = selectedItemId;
  });
  // The sheet settled at another height: keep the selected piece in sight above it.
  useEffect(() => {
    if (!isMobile || detent === 'full') return;
    const timer = setTimeout(() => {
      if (selectedItemRef.current !== null) revealPiece(selectedItemRef.current);
    }, SHEET_SETTLE_MS);
    return () => clearTimeout(timer);
  }, [isMobile, detent, revealPiece]);
  /** A card was picked in the list: select its piece and keep it in sight on the plan. */
  const selectCard = useCallback(
    (id: Id) => {
      selectItem(id);
      if (isMobile && detent !== 'full') requestAnimationFrame(() => revealPiece(id));
    },
    [selectItem, isMobile, detent, revealPiece],
  );

  // --- Editing ------------------------------------------------------------------------
  const furniture = useFurnitureEditing({
    history,
    selection: sel,
    isRoomSetup,
    startDrag,
    startRotation,
    zoomRef,
    snapEnabled: snapOn,
    onDragFrame: setDragFrame,
    onRotateFrame: setRotateFrame,
    announce: live.announce,
    onLockedPress: onLockedPointerPress,
    onTap: isMobile ? onPieceTap : undefined,
  });
  const openings = useOpenings({
    history,
    selection,
    setSelection,
    announce: live.announce,
    isRoomSetup,
    startDrag,
    zoomRef,
  });
  const projectActions = useProjectActions({
    history,
    projects,
    designMode,
    unitSystem,
    setDesignMode,
    setUnitSystem,
    setSelection,
    closeFiles: () => setFilesOpen(false),
  });

  // --- Room size: offer to bring pieces back inside a room that shrank -----------------------
  const layoutRef = useRef(layout);
  useEffect(() => {
    layoutRef.current = layout;
  });
  const outsideCount = useMemo(
    () => piecesOutside(layout.items, layout.roomDims).length,
    [layout.items, layout.roomDims],
  );
  const changeRoomDims = (dims: RoomDims) => {
    const prev = layout.roomDims;
    const next = openings.updateRoomDims(dims);
    if (!next || (next.width >= prev.width && next.height >= prev.height)) return;
    const outside = piecesOutside(layout.items, next).length;
    if (outside === 0) return;
    const one = outside === 1;
    showNotice({
      key: 'outside-room',
      message: `${one ? '1 piece is' : `${outside} pieces are`} outside the room.`,
      action: {
        label: one ? 'Move it inside' : 'Move them inside',
        onClick: () => {
          const cur = layoutRef.current;
          const count = piecesOutside(cur.items, cur.roomDims).length;
          history.apply((l) => ({
            ...l,
            items: l.items.map((i) => (i.visible === false ? i : moveInside(i, l.roomDims))),
          }));
          dismissNotice('outside-room');
          live.announce(`${count === 1 ? '1 piece' : `${count} pieces`} moved inside the room`);
          track('pieces_moved_inside', { count });
        },
      },
    });
  };
  // The offer goes away once nothing is outside any more (moved by hand, resize undone...).
  useEffect(() => {
    if (outsideCount === 0) dismissNotice('outside-room');
  }, [outsideCount, dismissNotice]);

  // --- Doors & windows: moving one to another wall ----------------------------------------
  const changeOpeningWall = (type: 'door' | 'window', id: Id, wall: Wall) => {
    if (openings.moveOpeningToWall(type, id, wall)) {
      dismissNotice('wall-full');
      return;
    }
    const list: { id: Id; wall: Wall }[] = type === 'door' ? layout.doors : layout.windows;
    const index = list.findIndex((o) => o.id === id);
    const name = `${type === 'door' ? 'Door' : 'Window'} ${index + 1}`;
    showNotice({
      key: 'wall-full',
      message: `${name} doesn't fit on the ${wall} wall, so it stays on the ${list[index]?.wall} wall.`,
      timeoutMs: 6000,
    });
  };

  // --- New plan (the current one is kept) -------------------------------------------------
  const startNewPlan = (start: NewPlanStart) => {
    const previous = projects.currentProject?.name;
    projectActions.newProject(start);
    const kept = previous ? `"${previous}" is` : 'Your previous plan is';
    // The notice is in the polite toast region, so it is announced too.
    showNotice({
      key: 'new-plan',
      message: `New plan started. ${kept} still in My Floor Plans.`,
      timeoutMs: 5000,
    });
  };

  // --- Keyboard ----------------------------------------------------------------------
  const selectedItem =
    selection?.type === 'item' ? layout.items.find((i) => i.id === selection.id) : undefined;
  const canEditSelected = !!selectedItem && !isRoomSetup && !selectedItem.locked;

  // The sheet now covers the plan: focus there would be out of sight, so it moves to the handle.
  useEffect(() => {
    if (canvasCovered && containerRef.current?.contains(document.activeElement)) {
      sheet.handleRef.current?.focus({ preventScroll: true });
    }
  }, [canvasCovered, sheet.handleRef]);

  /** Return keyboard focus to the canvas (e.g. after the focused piece is deselected or removed). */
  const focusCanvas = useCallback(() => {
    const canvas = containerRef.current;
    if (
      canvas &&
      (document.activeElement === document.body || canvas.contains(document.activeElement))
    ) {
      canvas.focus({ preventScroll: true });
    }
  }, []);

  useKeyboardShortcuts(
    {
      undo,
      redo,
      deleteSelected: () => {
        if (openings.deleteSelectedOpening()) {
          requestAnimationFrame(focusCanvas);
          return true;
        }
        if (!selectedItem || isRoomSetup) return false;
        furniture.deleteItem(selectedItem.id);
        requestAnimationFrame(focusCanvas);
        return true;
      },
      deselect: () => {
        sel.clearSelection();
        focusCanvas();
      },
      nudge: (dirX, dirY, size) => {
        if (isRoomSetup && selectedItem) {
          promptLockedPiece(selectedItem, 'keyboard');
          return true;
        }
        const step = nudgeStep(size, unitSystem);
        if (!canEditSelected) return openings.nudgeOpening(dirX * step, dirY * step);
        // Fine steps place exactly, without snapping (like Alt-dragging).
        furniture.moveItem(selectedItem.id, dirX * step, dirY * step, size !== 'fine');
        return true;
      },
      showShortcuts: () => setShortcutsOpen(true),
      rotateSelected: (degrees) => {
        if (isRoomSetup && selectedItem) {
          promptLockedPiece(selectedItem, 'keyboard');
          return true;
        }
        if (!canEditSelected) return false;
        furniture.changeItem(selectedItem.id, {
          rotation: normalizeDegrees(selectedItem.rotation + degrees),
        });
        return true;
      },
    },
    containerRef,
    !shareOpen && !filesOpen && !exportOpen && !shortcutsOpen,
  );

  // Guides + measurements for the dragged piece, or (subtler) the selected one, in furniture mode.
  const overlayItemId = dragFrame?.id ?? (!isRoomSetup ? selectedItem?.id : undefined);
  // While a piece is moved or turned into a door's way, that door's clearance lights up.
  const movingId = dragFrame?.id ?? rotateFrame?.id;
  const highlightDoorIds = movingId !== undefined ? warnings.get(movingId)?.doorIds : undefined;

  // --- Render --------------------------------------------------------------------------------
  const colorPickerItem =
    isMobile && colorPickerItemId !== null
      ? layout.items.find((i) => i.id === colorPickerItemId)
      : undefined;

  // Adding something while the sheet covers the plan lowers it to half, so the new thing shows.
  const addItem = () => {
    furniture.addItem();
    lowerSheet();
  };
  const addDoor = () => {
    openings.addDoor();
    lowerSheet();
  };
  const addWindow = () => {
    openings.addWindow();
    lowerSheet();
  };
  const summary = sheetSummary(layout, designMode, selection, unitSystem);
  const sheetAction = selection
    ? {
        label: 'Edit',
        icon: <Pencil className="w-4 h-4" aria-hidden="true" />,
        tone: isRoomSetup ? ('room' as const) : ('furniture' as const),
        onClick: () => {
          revealCard(selection.type, selection.id);
          expandSheet('tap');
        },
      }
    : isRoomSetup
      ? {
          label: 'Next: Items',
          icon: <ArrowRight className="w-4 h-4" aria-hidden="true" />,
          tone: 'furniture' as const,
          onClick: () => changeDesignMode(DESIGN_MODES.FURNITURE),
        }
      : {
          label: 'Add item',
          icon: <Plus className="w-4 h-4" aria-hidden="true" />,
          tone: 'furniture' as const,
          onClick: addItem,
        };
  // Toasts stack above the sheet and the controls riding on it (over the sheet when it is full).
  const toastBottom = isMobile
    ? sheet.keyboard + (detent === 'full' ? 12 : sheet.visibleHeight + FLOATING_ROW_INSET + 4)
    : null;
  const rootStyle =
    toastBottom === null ? undefined : ({ '--toast-bottom': `${toastBottom}px` } as CSSProperties);

  return (
    <PopoverRootContext value={popoverRoot}>
      <div
        className="flex flex-col h-full bg-slate-50 text-slate-800 font-sans overflow-hidden relative"
        style={rootStyle}
      >
        <a
          href="#floor-plan"
          onClick={(e) => {
            e.preventDefault();
            if (canvasCovered) {
              // Uncover the plan first (it is inert under a full sheet), then focus it.
              sheet.setDetent('half');
              requestAnimationFrame(() => containerRef.current?.focus());
            } else {
              containerRef.current?.focus();
            }
          }}
          className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-[200] focus:px-3 focus:py-2 focus:bg-white focus:text-indigo-700 focus:rounded-lg focus:shadow-lg focus:font-medium"
        >
          Skip to floor plan
        </a>
        <Header
          projectName={projectName}
          roomDims={layout.roomDims}
          unitSystem={unitSystem}
          saveStatus={projects.saveStatus}
          lastSavedAt={projects.lastSavedAt}
          canUndo={history.canUndo}
          canRedo={history.canRedo}
          zoom={zoom}
          snapOn={snapOn}
          onToggleSnap={toggleSnap}
          helpHref={HELP_PATH}
          onOpenFiles={() => setFilesOpen(true)}
          onNewPlan={startNewPlan}
          onRename={projectActions.renameCurrent}
          onUndo={undo}
          onRedo={redo}
          onZoomIn={zoomIn}
          onZoomOut={zoomOut}
          onFit={fitToView}
          onShare={() => setShareOpen(true)}
          onShowShortcuts={() => setShortcutsOpen(true)}
          onExport={() => setExportOpen(true)}
        />

        <div className="flex flex-1 overflow-hidden relative">
          <Sidebar
            designMode={designMode}
            unitSystem={unitSystem}
            helpHref={HELP_PATH}
            onUnitSystemChange={changeUnitSystem}
            onDesignModeChange={changeDesignMode}
            sheet={
              isMobile
                ? {
                    sheet,
                    summary,
                    action: sheetAction,
                    floating: (
                      <>
                        <FloatingZoomControls
                          zoom={zoom}
                          onZoomIn={zoomIn}
                          onZoomOut={zoomOut}
                          onFit={fitToView}
                        />
                        <SnapToggle variant="floating" on={snapOn} onToggle={toggleSnap} />
                      </>
                    ),
                  }
                : undefined
            }
          >
            <RoomSetupPanel
              isActiveMode={isRoomSetup}
              expanded={roomSetupExpanded}
              onToggleExpanded={() => setRoomSetupExpanded((v) => !v)}
              onActivate={() => changeDesignMode(DESIGN_MODES.ROOM_SETUP)}
              onContinue={() => changeDesignMode(DESIGN_MODES.FURNITURE)}
              roomDims={layout.roomDims}
              doors={layout.doors}
              windows={layout.windows}
              unitSystem={unitSystem}
              onRoomDimsChange={changeRoomDims}
              onAddDoor={addDoor}
              onUpdateDoor={openings.updateDoor}
              onDeleteDoor={openings.deleteDoor}
              onAddWindow={addWindow}
              onUpdateWindow={openings.updateWindow}
              onDeleteWindow={openings.deleteWindow}
              onChangeWall={changeOpeningWall}
              highlight={latestCard(
                openings.lastAdded,
                revealedCard?.type === 'door' || revealedCard?.type === 'window'
                  ? { ...revealedCard, type: revealedCard.type }
                  : null,
              )}
            />
            <FurniturePanel
              isActiveMode={!isRoomSetup}
              expanded={furnitureExpanded}
              onToggleExpanded={() => setFurnitureExpanded((v) => !v)}
              onActivate={() => changeDesignMode(DESIGN_MODES.FURNITURE)}
              items={layout.items}
              warnings={warnings}
              selection={selection}
              isMobile={isMobile}
              colorPickerItemId={colorPickerItemId}
              roomDims={layout.roomDims}
              unitSystem={unitSystem}
              onAddItem={addItem}
              onClearRoom={furniture.clearRoom}
              onSelectItem={selectCard}
              onChangeItem={furniture.changeItem}
              onCommit={commit}
              onToggleLock={furniture.toggleLock}
              onToggleVisibility={furniture.toggleVisibility}
              onDeleteItem={furniture.deleteItem}
              onToggleColorPicker={sel.toggleColorPicker}
              onCloseColorPicker={sel.closeColorPicker}
              highlight={latestCard(
                furniture.lastAdded,
                revealedCard?.type === 'item' ? revealedCard : null,
              )}
            />
          </Sidebar>
          <div ref={setPopoverRoot} className="contents" data-popover-root />

          <RoomCanvas
            containerRef={containerRef}
            layout={layout}
            warnings={warnings}
            selection={selection}
            designMode={designMode}
            unitSystem={unitSystem}
            zoom={zoom}
            pan={pan}
            onSelectOpening={(type, id) => setSelection({ id, type })}
            showModeBadge={!canvasCovered}
            covered={canvasCovered}
            onItemPointerDown={furniture.onItemPointerDown}
            onRotatePointerDown={furniture.onRotatePointerDown}
            onSelectItem={(item) => selectItem(item.id)}
            onLockedItemPress={onLockedKeyPress}
            onDoorPointerDown={(e, door) => openings.startOpeningDrag(e, door.id, 'doors')}
            onWindowPointerDown={(e, win) => openings.startOpeningDrag(e, win.id, 'windows')}
            highlightDoorIds={highlightDoorIds}
            overlay={
              overlayItemId !== undefined && (
                <SnapOverlay
                  items={layout.items}
                  room={layout.roomDims}
                  zoom={zoom}
                  unitSystem={unitSystem}
                  itemId={overlayItemId}
                  drag={dragFrame}
                  rotation={rotateFrame?.id === overlayItemId ? rotateFrame.angle : null}
                />
              )
            }
          />
        </div>

        <ShortcutsDialog isOpen={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />

        <ShareModal
          isOpen={shareOpen}
          onClose={() => setShareOpen(false)}
          config={shareConfig}
          onImport={projectActions.importConfig}
          showQr={!isMobile}
        />

        <ExportModal
          isOpen={exportOpen}
          onClose={() => setExportOpen(false)}
          layout={layout}
          unitSystem={unitSystem}
          projectName={projectName}
        />

        <FileBrowserModal
          isOpen={filesOpen}
          onClose={() => setFilesOpen(false)}
          projects={projects.projects}
          currentProjectId={projects.currentProjectId}
          unitSystem={unitSystem}
          onNew={startNewPlan}
          onOpen={projectActions.openProject}
          onRename={projects.rename}
          onDuplicate={projects.duplicate}
          onDelete={projects.remove}
          onExport={projectActions.exportProjects}
          onImport={projects.importFile}
          onSaveCurrent={() => {
            projects.saveNow();
            live.announce('Project saved');
            setFilesOpen(false);
          }}
        />

        {/* Screen-reader announcements: moves, rotations, new overlaps, undo/redo, saves. */}
        <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
          {live.message}
        </div>

        <PwaNotices
          notice={notices.notice}
          onDismissNotice={() => dismissNotice()}
          firstVisit={initial.firstVisit}
        />

        {colorPickerItem && (
          <ColorPicker
            currentColor={migrateColor(colorPickerItem.color)}
            onChange={(color) => furniture.changeItem(colorPickerItem.id, { color })}
            onClose={sel.closeColorPicker}
            isMobile
          />
        )}
      </div>
    </PopoverRootContext>
  );
}
