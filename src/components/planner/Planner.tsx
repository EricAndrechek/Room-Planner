import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react';
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
  type PlaceInput,
  type RotateFrame,
  type SetAsideInput,
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
import { useRoomShape } from '../../hooks/useRoomShape';
import { useRooms } from '../../hooks/useRooms';
import { useRotationDrag } from '../../hooks/useRotationDrag';
import { useSelection } from '../../hooks/useSelection';
import { track } from '../../lib/analytics';
import type { BootState } from '../../lib/boot';
import { migrateColor } from '../../core/colors';
import { DESIGN_MODES, PIXELS_PER_UNIT } from '../../lib/constants';
import { normalizeDegrees } from '../../core/geometry';
import { isRectangle, roomBounds } from '../../core/geometry/walls';
import { floorBounds, roomAt, roomName } from '../../core/floor';
import type { Point } from '../../core/geometry';
import { piecesOutside } from '../../core/placement';
import { movePiecesInside, narrowedOpenings, resizeRoom, type PiecePreset } from '../../lib/edits';
import {
  doorsOf,
  floorArea,
  inventoryPieces,
  itemWarnings,
  openingPlace,
  pieceFrame,
  pieceRoom,
  placedPieces,
  roomById,
  roomOfOpening,
  roomSize,
  snapPieces,
  theWall,
  windowsOf,
  withDoc,
} from '../../lib/plans';
import { HELP_PATH } from '../../lib/paths';
import { sheetSummary } from '../../lib/sheet';
import { feetToDisplay, nudgeStep } from '../../core/units';
import { loadSnapPreference, saveSnapPreference, type PlanStore } from '../../lib/storage';
import type { DesignMode, Id, Item, Plan, RoomDims, UnitSystem } from '../../types';
import { ColorPicker } from './ColorPicker';
import { ExportModal } from './ExportModal';
import { FileBrowserModal } from './FileBrowserModal';
import { PlacementBanner, RoomChips } from './FloorControls';
import { FurniturePanel } from './FurniturePanel';
import { Header } from './Header';
import { pieceName, SelectionToolbar, type PieceAction } from './PieceActions';
import { SetAsideList } from './SetAsideList';
import { PwaNotices } from './PwaNotices';
import { PopoverRootContext } from './PopoverRoot';
import { RoomCanvas } from './RoomCanvas';
import { RoomSetupPanel } from './RoomSetupPanel';
import { ShareModal } from './ShareModal';
import { ShortcutsDialog } from './ShortcutsDialog';
import { useWebMcp } from '../../webmcp/useWebMcp';
import { Sidebar } from './Sidebar';
import { SnapOverlay } from './SnapOverlay';
import { SnapToggle } from './SnapToggle';
import { FloatingZoomControls } from './ZoomControls';

/** Phones: the mode badge covers the top of the plan (px)... */
const BADGE_INSET = 40;
/** ...and, with several rooms, the room chips under it. */
const CHIPS_INSET = 48;
/** A press on the plan that moves less than this (px) while placing a piece is a tap. */
const TAP_SLOP_PX = 8;
/** How long an Undo offer stays (ms). */
const UNDO_MS = 8000;
/** ...and the zoom pill and Snap chip ride this far above the sheet (px, with their gap). */
const FLOATING_ROW_INSET = 60;
const NO_INSETS: ViewInsets = { top: 0, bottom: 0 };

interface PlannerProps {
  store: PlanStore;
  initial: BootState;
}

/**
 * The room planner application (everything inside the island): composes the
 * state hooks and renders the header, sidebar, canvas and modals.
 */
export function Planner({ store, initial }: PlannerProps) {
  const storage = store.storage;
  const history = useHistory<Plan>(initial.plan);
  const { present: plan, commit } = history;
  // The room being edited (several rooms): picked in the list or the chips, or the room of what is
  // selected. Falls back to the first room when it is gone (deleted, undone, another plan).
  const [activeRoomState, setActiveRoomState] = useState<Id | null>(null);
  const room = roomById(plan, activeRoomState);
  const activeRoomId = room.id;
  const several = plan.rooms.length > 1;
  const roomDims = roomSize(room);
  const floor = useMemo(() => floorBounds({ rooms: plan.rooms }), [plan.rooms]);
  const floorDims = useMemo(
    () => ({ width: floor.right - floor.left, height: floor.bottom - floor.top }),
    [floor],
  );
  const doors = doorsOf(room);
  const windows = windowsOf(room);
  const [unitSystem, setUnitSystem] = useState<UnitSystem>(initial.unitSystem);
  const [designMode, setDesignMode] = useState<DesignMode>(initial.designMode);

  // Phones (below md): the editor is a bottom sheet over the plan, at peek, half or full height.
  const isMobile = useIsMobile();
  const sheet = useBottomSheet(isMobile);
  const { detent, expand: expandSheet, lower: lowerSheet } = sheet;
  const canvasCovered = isMobile && detent === 'full';

  const sel = useSelection();
  const { setSelection, selectItem, colorPickerItemId } = sel;
  // A piece in the inventory is not on the plan, so it is never selected (undoing "Place" puts a
  // selected piece back there): nothing acts on it until it is placed again.
  const selection =
    sel.selection?.type === 'item' &&
    !plan.items.some((i) => i.id === sel.selection!.id && i.placement)
      ? null
      : sel.selection;
  // Selecting something in another room makes that room the one being edited.
  const selectedRoomId = (() => {
    if (!selection || !several) return null;
    if (selection.type === 'item') {
      const it = plan.items.find((i) => i.id === selection.id);
      return it ? (pieceRoom(plan, it)?.id ?? null) : null;
    }
    return roomOfOpening(plan, selection.id)?.id ?? null;
  })();
  const [followedRoom, setFollowedRoom] = useState<Id | null>(null);
  if (selectedRoomId !== followedRoom) {
    setFollowedRoom(selectedRoomId);
    if (selectedRoomId && selectedRoomId !== activeRoomId) setActiveRoomState(selectedRoomId);
  }
  const [shareOpen, setShareOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [filesOpen, setFilesOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [roomSetupExpanded, setRoomSetupExpanded] = useState(false);
  const [furnitureExpanded, setFurnitureExpanded] = useState(false);
  /** Which list the Items step shows: the pieces on the plan, or the ones set aside. */
  const [furnitureView, setFurnitureView] = useState<'room' | 'aside'>('room');
  /** The piece last set aside: its row glows when the list shows. */
  const [asideHighlight, setAsideHighlight] = useState<CardRef | null>(null);
  const asideTabRef = useRef<HTMLButtonElement>(null);
  /** Tap-to-place: the set-aside piece waiting for a tap on the plan, and its outline there. */
  const [placingId, setPlacingId] = useState<Id | null>(null);
  const [ghostAt, setGhostAt] = useState<Point | null>(null);
  /** Dragging a set-aside piece from the list: where the pointer is (screen), off the plan. */
  const [dragChip, setDragChip] = useState<{ x: number; y: number; id: Id } | null>(null);
  /** The set-aside piece being dragged from the list onto the plan. */
  const [draggingId, setDraggingId] = useState<Id | null>(null);
  /** The room the chips zoomed to (null: the whole floor). */
  const [focusedRoom, setFocusedRoom] = useState<Id | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  // The part of the plan that shows (fitting, revealing a piece): not under the badge or the sheet.
  const sheetInset = isMobile && detent !== 'full' ? sheet.heights[detent] + FLOATING_ROW_INSET : 0;
  const topInset = BADGE_INSET + (several ? CHIPS_INSET : 0);
  const viewInsets = useMemo(
    () => (isMobile ? { top: topInset, bottom: sheetInset } : NO_INSETS),
    [isMobile, sheetInset, topInset],
  );
  const {
    zoom,
    zoomRef,
    pan,
    zoomIn,
    zoomOut,
    fitToView: fitFloor,
    reveal,
    keepView,
    zoomToArea,
  } = usePanZoom(containerRef, floorDims, isMobile, viewInsets);
  const fitToView = useCallback(() => {
    setFocusedRoom(null);
    fitFloor();
  }, [fitFloor]);
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
    store,
    initialProjects: initial.projects,
    initialLocked: initial.locked,
    initialProjectId: initial.currentProjectId,
    initialSaved: initial.saveStatus === 'saved',
    initialSavedAt: initial.lastSavedAt,
    doc: { plan, designMode, unitSystem },
  });
  const projectName = projects.currentProject?.plan.name ?? 'Untitled';
  /** The plan as it is stored, shared and exported: with its name and display units. */
  const doc = useMemo(
    () => withDoc(plan, projectName, unitSystem),
    [plan, projectName, unitSystem],
  );

  // --- Notices (bottom toasts) -----------------------------------------------------
  const notices = useNotice();
  const { show: showNotice, dismiss: dismissNotice } = notices;

  // --- Persistence of the working state ---------------------------------------------
  useEffect(() => void store.saveWorking(doc), [store, doc]);
  useEffect(
    () => void store.saveUi({ currentPlanId: projects.currentProjectId, designMode }),
    [store, projects.currentProjectId, designMode],
  );
  // Storage full or blocked: the plan stays in this tab only. Said once.
  const [storageFailed, setStorageFailed] = useState(() => store.hasFailed());
  useEffect(() => store.onFailure(() => setStorageFailed(true)), [store]);
  useEffect(() => {
    if (!storageFailed) return;
    showNotice({
      key: 'storage-failed',
      message:
        "This browser isn't saving your changes (its storage is full or blocked). They stay in this tab: export your plans to keep a copy.",
      action: { label: 'My Floor Plans', onClick: () => setFilesOpen(true) },
    });
  }, [storageFailed, showNotice]);

  const isRoomSetup = designMode === DESIGN_MODES.ROOM_SETUP;
  const warnings = useMemo(() => itemWarnings(plan), [plan]);
  const live = useAnnouncements(plan, warnings, unitSystem, projects.saveStatus);
  const pieces = useMemo(() => snapPieces({ items: plan.items }), [plan.items]);

  // --- Modes & units ----------------------------------------------------------
  const changeDesignMode = useCallback(
    (mode: DesignMode) => {
      if (mode === designMode) return;
      setDesignMode(mode);
      track('mode_changed', { to: mode });
    },
    [designMode],
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
    (item: Item) => {
      revealCard('item', item.id);
      expandSheet();
    },
    [revealCard, expandSheet],
  );
  /**
   * Phones: a door or window was changed in the sheet (its type, size, place). Show it: pan it out
   * from under the sheet and light it up briefly, so the change is seen (taps on the door type
   * looked dead when the door was hidden under the sheet).
   */
  const [flashOpening, setFlashOpening] = useState<Id | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(flashTimer.current), []);
  const showOpening = useCallback(
    (id: Id) => {
      if (!isMobile) return;
      requestAnimationFrame(() => {
        const el = containerRef.current?.querySelector(`[data-opening-id="${id}"]`);
        if (el) reveal(el);
      });
      setFlashOpening(id);
      clearTimeout(flashTimer.current);
      flashTimer.current = setTimeout(() => setFlashOpening(null), 1200);
    },
    [isMobile, reveal],
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
    startDrag,
    startRotation,
    zoomRef,
    snapEnabled: snapOn,
    onDragFrame: setDragFrame,
    onRotateFrame: setRotateFrame,
    announce: live.announce,
    onTap: isMobile ? onPieceTap : undefined,
    roomId: activeRoomId,
  });
  const openings = useOpenings({
    history,
    selection,
    setSelection,
    announce: live.announce,
    isRoomSetup,
    startDrag,
    zoomRef,
    roomId: activeRoomId,
  });
  const roomShape = useRoomShape({
    history,
    unitSystem,
    isRoomSetup,
    snapEnabled: snapOn,
    announce: live.announce,
    startDrag,
    zoomRef,
    containerRef,
    keepView,
    onWallsChanged: (before, after) => {
      if (!offerMoveInside(before, after)) noteNarrowed(before, after);
    },
    onSelectCorner: () => setSelection(null),
    roomId: activeRoomId,
  });
  // Selecting anything else deselects the corner; another plan starts from its own shape.
  const { clearCorner, resetShape } = roomShape;
  useEffect(() => {
    if (selection) clearCorner();
  }, [selection, clearCorner]);
  useEffect(() => resetShape(), [projects.currentProjectId, activeRoomId, resetShape]);

  // --- Undo offers (a toast with Undo after a delete or a set aside) ---------------------------
  // The offer stands while the plan is the one the action left; any other change withdraws it.
  const undoOffer = useRef<{ key: string; plan: Plan | null } | null>(null);
  useEffect(() => {
    const o = undoOffer.current;
    if (!o) return;
    if (o.plan === null) o.plan = plan;
    else if (o.plan !== plan) {
      undoOffer.current = null;
      dismissNotice(o.key);
    }
  }, [plan, dismissNotice]);
  const undoRef = useRef(undo);
  useEffect(() => {
    undoRef.current = undo;
  });
  const offerUndo = (key: string, message: string) => {
    undoOffer.current = { key, plan: null };
    showNotice({
      key,
      message,
      timeoutMs: UNDO_MS,
      action: {
        label: 'Undo',
        onClick: () => {
          const o = undoOffer.current;
          undoOffer.current = null;
          dismissNotice(key);
          // The latest undo (the one this toast was made with may predate the edit).
          if (o?.plan && o.plan === planRef.current) undoRef.current();
        },
      },
    });
  };

  // --- Rooms ------------------------------------------------------------------------------------
  const rooms = useRooms({
    history,
    activeRoomId,
    setActiveRoomId: setActiveRoomState,
    unitSystem,
    snapEnabled: snapOn,
    announce: live.announce,
    startDrag,
    zoomRef,
    keepView,
    onDeleted: (name, n) =>
      offerUndo(
        'room-deleted',
        `${name} deleted.${n ? ` ${n === 1 ? '1 piece was' : `${n} pieces were`} set aside.` : ''}`,
      ),
  });
  /** Edit another room (the list, the chips, a tap on the plan): what was selected is not any more. */
  const selectRoom = (id: Id) => {
    if (id === activeRoomId) return;
    setActiveRoomState(id);
    if (selection && selection.type !== 'item') setSelection(null);
  };
  /** The chips: zoom to a room (and edit it), or back to the whole floor. */
  const zoomToRoom = (id: Id) => {
    const r = plan.rooms.find((x) => x.id === id);
    if (!r) return;
    selectRoom(id);
    setFocusedRoom(id);
    zoomToArea(roomBounds(r), floor);
  };
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

  // --- WebMCP: a browser agent edits through the same history, live region and selection ------
  useWebMcp({
    history,
    projectName,
    unitSystem,
    announceEdit: live.announceEdit,
    keepView,
    setSelection,
    setActiveRoom: setActiveRoomState,
    showSetAside: (id) => {
      setFurnitureView('aside');
      setAsideHighlight({ type: 'item', id, seq: nextCardSeq() });
    },
  });

  // --- Room size: offer to bring pieces back inside a room that shrank -----------------------
  const planRef = useRef(plan);
  useEffect(() => {
    planRef.current = plan;
  });
  const outsideCount = useMemo(
    () => piecesOutside({ items: plan.items, rooms: plan.rooms }).length,
    [plan.items, plan.rooms],
  );
  /** The walls changed: if that left more pieces outside, offer to bring them back in. */
  const offerMoveInside = (before: Plan, after: Plan): boolean => {
    const outside = piecesOutside(after).length;
    if (outside === 0 || outside <= piecesOutside(before).length) return false;
    const one = outside === 1;
    showNotice({
      key: 'outside-room',
      message: `${one ? '1 piece is' : `${outside} pieces are`} outside ${after.rooms.length > 1 ? 'the rooms' : 'the room'}.`,
      action: {
        label: one ? 'Move it inside' : 'Move them inside',
        onClick: () => {
          const count = piecesOutside(planRef.current).length;
          history.apply(movePiecesInside);
          dismissNotice('outside-room');
          live.announce(`${count === 1 ? '1 piece' : `${count} pieces`} moved inside the room`);
          track('pieces_moved_inside', { count });
        },
      },
    });
    return true;
  };
  /** A door or window too wide for its wall after the walls changed was narrowed: say so. */
  const noteNarrowed = (before: Plan, after: Plan) => {
    const narrowed = narrowedOpenings(before, after);
    if (!narrowed.length) return;
    const name = (o: (typeof narrowed)[number]) => {
      const r = roomOfOpening(after, o.id) ?? room;
      const list = o.kind === 'door' ? doorsOf(r) : windowsOf(r);
      return `${o.kind === 'door' ? 'Door' : 'Window'} ${list.findIndex((x) => x.id === o.id) + 1}`;
    };
    const first = narrowed[0]!;
    const r = roomOfOpening(after, first.id) ?? room;
    showNotice({
      key: 'wall-full',
      message:
        narrowed.length === 1
          ? `${name(first)} is wider than ${theWall(r, first.wall)} now, so it was made ${feetToDisplay(first.width, unitSystem)} wide.`
          : `${narrowed.length} doors and windows were made narrower to fit their walls.`,
      timeoutMs: 6000,
    });
  };
  const changeRoomDims = (dims: RoomDims) => {
    const prev = roomDims;
    const next = openings.updateRoomDims(dims);
    if (!next || (next.width >= prev.width && next.height >= prev.height)) return;
    offerMoveInside(plan, resizeRoom(plan, next, room.id));
  };
  // The offer goes away once nothing is outside any more (moved by hand, resize undone...).
  useEffect(() => {
    if (outsideCount === 0) dismissNotice('outside-room');
  }, [outsideCount, dismissNotice]);

  // --- Doors & windows: moving one to another wall ----------------------------------------
  const changeOpeningWall = (type: 'door' | 'window', id: Id, wall: number) => {
    if (openings.moveOpeningToWall(type, id, wall)) {
      dismissNotice('wall-full');
      return;
    }
    const list = type === 'door' ? doors : windows;
    const index = list.findIndex((o) => o.id === id);
    const name = `${type === 'door' ? 'Door' : 'Window'} ${index + 1}`;
    const current = list[index] ? openingPlace(room, list[index]).wall : wall;
    showNotice({
      key: 'wall-full',
      message: `${name} doesn't fit on ${theWall(room, wall)}, so it stays on ${theWall(room, current)}.`,
      timeoutMs: 6000,
    });
  };

  // --- New plan (the current one is kept) -------------------------------------------------
  const startNewPlan = (start: NewPlanStart) => {
    const previous = projects.currentProject?.plan.name;
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
    selection?.type === 'item' ? plan.items.find((i) => i.id === selection.id) : undefined;
  // Furniture moves in both steps (Room Setup only puts the room's handles first).
  const canEditSelected = !!selectedItem && !selectedItem.locked;

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
        if (placingId) return false;
        if (isRoomSetup && roomShape.selectedCorner !== null) {
          roomShape.removeCorner();
          requestAnimationFrame(focusCanvas);
          return true;
        }
        if (openings.deleteSelectedOpening()) {
          requestAnimationFrame(focusCanvas);
          return true;
        }
        if (!selectedItem) return false;
        deleteWithUndo(selectedItem.id);
        requestAnimationFrame(focusCanvas);
        return true;
      },
      deselect: () => {
        sel.clearSelection();
        roomShape.clearCorner();
        focusCanvas();
      },
      nudge: (dirX, dirY, size) => {
        const step = nudgeStep(size, unitSystem);
        const handle = (document.activeElement as HTMLElement | null)?.closest<HTMLElement>(
          '[data-room-handle]',
        );
        if (isRoomSetup && handle?.dataset.roomHandle) {
          rooms.nudgeRoom(handle.dataset.roomHandle, dirX * step, dirY * step);
          return true;
        }
        if (isRoomSetup && roomShape.nudgeCorner(dirX * step, dirY * step)) return true;
        if (!canEditSelected) return openings.nudgeOpening(dirX * step, dirY * step);
        // Fine steps place exactly, without snapping (like Alt-dragging).
        furniture.moveItem(selectedItem.id, dirX * step, dirY * step, size !== 'fine');
        return true;
      },
      toInventory: () => {
        if (!selectedItem) return false;
        setAsideWithUndo(selectedItem.id, 'keyboard');
        return true;
      },
      showShortcuts: () => setShortcutsOpen(true),
      rotateSelected: (degrees) => {
        if (!canEditSelected) return false;
        furniture.changeItem(selectedItem.id, {
          rotation: normalizeDegrees((selectedItem.placement?.rotation ?? 0) + degrees),
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

  // --- Set aside, and back on the plan ----------------------------------------------------------
  /** Set a piece aside (one undo step), with an Undo offer; the focus stays on the plan. */
  const setAsideWithUndo = (id: Id, input: SetAsideInput) => {
    const item = plan.items.find((i) => i.id === id);
    if (!item || !furniture.takeOutItem(id, input)) return;
    setAsideHighlight({ type: 'item', id, seq: nextCardSeq() });
    offerUndo('set-aside', `${pieceName(item)} set aside.`);
    if (input !== 'menu') requestAnimationFrame(focusCanvas);
  };
  /** Delete a piece (one undo step), with an Undo offer instead of a confirmation. */
  const deleteWithUndo = (id: Id) => {
    const item = plan.items.find((i) => i.id === id);
    if (!item) return;
    furniture.deleteItem(id);
    offerUndo('piece-deleted', `${pieceName(item)} deleted.`);
  };
  /** The selection bar's and the sheet row's actions. */
  const runPieceAction = (id: Id, action: PieceAction, input: SetAsideInput) => {
    if (action === 'rotate') furniture.rotateItem(id, 90);
    else if (action === 'duplicate') furniture.duplicateItem(id);
    else if (action === 'aside') setAsideWithUndo(id, input);
    else {
      deleteWithUndo(id);
      requestAnimationFrame(focusCanvas);
    }
  };

  /** Where a point on the screen is on the floor (feet), or null off the plan. */
  const floorPointAt = (clientX: number, clientY: number, insideOnly = true): Point | null => {
    const el = containerRef.current;
    const origin = el?.querySelector('[data-floor-origin]');
    if (!el || !origin) return null;
    if (insideOnly) {
      const c = el.getBoundingClientRect();
      if (clientX < c.left || clientX > c.right || clientY < c.top || clientY > c.bottom) {
        return null;
      }
    }
    const r = origin.getBoundingClientRect();
    const scale = PIXELS_PER_UNIT * zoomRef.current;
    return { x: (clientX - r.left) / scale, y: (clientY - r.top) / scale };
  };
  /** A placed piece: on a phone, keep it in sight above the sheet. */
  const afterPlaced = (id: Id) => {
    if (isMobile) requestAnimationFrame(() => revealPiece(id));
  };
  /** Put a set-aside piece where `at` is; says why not if that is outside every room. */
  const placeAt = (id: Id, at: Point, input: PlaceInput): boolean => {
    if (furniture.placeItemAt(id, at, input)) {
      afterPlaced(id);
      return true;
    }
    const item = plan.items.find((i) => i.id === id);
    live.announce(`${item ? pieceName(item) : 'The piece'} goes inside a room: drop it on a room.`);
    return false;
  };
  /** The free-spot finder, in the room being edited (the keyboard's way to place). */
  const placeInFreeSpot = (id: Id) => {
    setPlacingId(null);
    setGhostAt(null);
    if (furniture.placeItem(id, 'keyboard')) afterPlaced(id);
  };
  const cancelPlacing = () => {
    setPlacingId(null);
    setGhostAt(null);
    live.announce('Placing cancelled');
  };
  /** "Place": with the keyboard into a free spot; otherwise wait for a tap on the plan. */
  const startPlacing = (id: Id, keyboard: boolean) => {
    if (keyboard) {
      placeInFreeSpot(id);
      return;
    }
    if (placingId === id) {
      cancelPlacing();
      return;
    }
    const item = plan.items.find((i) => i.id === id);
    setPlacingId(id);
    setGhostAt(null);
    sel.clearSelection();
    if (isMobile) sheet.setDetent('peek');
    live.announce(
      `${isMobile ? 'Tap' : 'Click'} the plan where ${item ? pieceName(item) : 'the piece'} should go. Escape cancels; Find a spot puts it in a free spot.`,
    );
  };
  const placingItem = placingId
    ? plan.items.find((i) => i.id === placingId && !i.placement)
    : undefined;
  // The piece was placed some other way, deleted or undone: stop waiting for it.
  if (placingId && !placingItem) setPlacingId(null);

  // While placing: the outline follows the pointer over the plan, and a tap (a press that does not
  // move, so a pan still pans) puts the piece there. Pieces under the tap are not selected.
  const placeRef = useRef(placeAt);
  useEffect(() => {
    placeRef.current = placeAt;
  });
  useEffect(() => {
    const el = containerRef.current;
    if (!el || !placingId) return;
    let down: { x: number; y: number; id: number } | null = null;
    const point = (e: PointerEvent) => floorPointAt(e.clientX, e.clientY, false);
    const onMove = (e: PointerEvent) => {
      if (e.pointerType === 'mouse' || down) setGhostAt(point(e));
    };
    const onDown = (e: PointerEvent) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      e.stopPropagation();
      down = { x: e.clientX, y: e.clientY, id: e.pointerId };
      setGhostAt(point(e));
    };
    const onUp = (e: PointerEvent) => {
      if (!down || e.pointerId !== down.id) return;
      const tap = Math.hypot(e.clientX - down.x, e.clientY - down.y) < TAP_SLOP_PX;
      down = null;
      if (e.pointerType !== 'mouse') setGhostAt(null);
      const at = point(e);
      if (tap && at && placeRef.current(placingId, at, 'tap')) {
        setPlacingId(null);
        setGhostAt(null);
      }
    };
    const onLeave = (e: PointerEvent) => {
      if (e.pointerType === 'mouse') setGhostAt(null);
    };
    el.addEventListener('pointermove', onMove, true);
    el.addEventListener('pointerdown', onDown, true);
    el.addEventListener('pointerup', onUp, true);
    el.addEventListener('pointerleave', onLeave);
    return () => {
      el.removeEventListener('pointermove', onMove, true);
      el.removeEventListener('pointerdown', onDown, true);
      el.removeEventListener('pointerup', onUp, true);
      el.removeEventListener('pointerleave', onLeave);
    };
    // floorPointAt reads refs only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placingId]);
  // Enter (not on a control) puts the waiting piece in a free spot.
  useEffect(() => {
    if (!placingId) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.key === 'Escape' && !t?.closest('input, select, textarea, [role="menu"], dialog')) {
        e.preventDefault();
        cancelPlacing();
        return;
      }
      if (e.key !== 'Enter' || e.defaultPrevented) return;
      if (t?.closest('button, input, select, textarea, a, [role="button"]')) return;
      e.preventDefault();
      placeInFreeSpot(placingId);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  /** Drag a piece from the Set aside list and drop it on the plan, exactly there. */
  const dragFromList = (e: ReactPointerEvent<HTMLElement>, item: Item) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    const start = { x: e.clientX, y: e.clientY };
    let dragging = false;
    let over: Point | null = null;
    startDrag(e, {
      onMove: (ev) => {
        if (!dragging && Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < TAP_SLOP_PX) {
          return;
        }
        if (!dragging) {
          dragging = true;
          setPlacingId(null);
          setDraggingId(item.id);
          if (isMobile && sheet.detent === 'full') sheet.setDetent('half');
        }
        over = floorPointAt(ev.clientX, ev.clientY);
        const hit = document.elementFromPoint(ev.clientX, ev.clientY);
        if (over && hit && !containerRef.current?.contains(hit)) over = null;
        setGhostAt(over);
        setDragChip(over ? null : { x: ev.clientX, y: ev.clientY, id: item.id });
      },
      onEnd: (end) => {
        setDragChip(null);
        setGhostAt(null);
        setDraggingId(null);
        if (!dragging || !end || !over) return;
        placeAt(item.id, over, 'drag');
      },
    });
  };

  const inventory = useMemo(() => inventoryPieces(plan), [plan]);
  const placed = useMemo(() => placedPieces(plan), [plan]);
  const selectionActions =
    selectedItem && !dragFrame && !rotateFrame && !placingId ? selectedItem : undefined;
  const roomNames = useMemo(() => plan.rooms.map((r) => roomName(plan, r)), [plan]);
  const dragItem = draggingId ? plan.items.find((i) => i.id === draggingId) : undefined;
  const ghostItem = placingItem ?? dragItem;
  // The room labels on the plan follow the pieces once they settle, not on every drag frame.
  const [labelItems, setLabelItems] = useState(plan.items);
  if (!dragFrame && !rotateFrame && labelItems !== plan.items) setLabelItems(plan.items);
  const overlayPiece = overlayItemId ? plan.items.find((i) => i.id === overlayItemId) : undefined;
  const overlayRoom = (overlayPiece && pieceRoom(plan, overlayPiece)) || room;

  // --- Render --------------------------------------------------------------------------------
  const colorPickerItem =
    isMobile && colorPickerItemId !== null
      ? plan.items.find((i) => i.id === colorPickerItemId)
      : undefined;

  // Adding something while the sheet covers the plan lowers it to half, so the new thing shows.
  const addItem = (preset?: PiecePreset) => {
    furniture.addItem(preset);
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
  const summary = placingItem
    ? `Placing ${pieceName(placingItem)}`
    : sheetSummary(plan, designMode, selection, unitSystem, activeRoomId);
  const sheetAction = placingItem
    ? undefined
    : selection
      ? {
          label: 'Edit',
          icon: <Pencil className="w-4 h-4" aria-hidden="true" />,
          tone:
            isRoomSetup && selection.type !== 'item' ? ('room' as const) : ('furniture' as const),
          onClick: () => {
            // A piece's card is in the Items step: go there for it.
            if (selection.type === 'item') changeDesignMode(DESIGN_MODES.FURNITURE);
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
            onClick: () => addItem(),
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
          roomDims={several ? floorDims : roomDims}
          floor={several ? { rooms: plan.rooms.length, area: floorArea(plan) } : undefined}
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
                    actions: selectionActions && (
                      <SelectionToolbar
                        variant="sheet"
                        item={selectionActions}
                        onAction={(a) => runPieceAction(selectionActions.id, a, 'sheet')}
                      />
                    ),
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
              plan={plan}
              rooms={{
                activeRoomId,
                onSelect: (id) => {
                  selectRoom(id);
                  if (several) zoomToRoom(id);
                },
                onAdd: () => {
                  rooms.addRoom();
                  lowerSheet();
                },
                onDuplicate: (id) => {
                  rooms.duplicateRoom(id);
                  lowerSheet();
                },
                onDelete: rooms.deleteRoom,
                onRename: rooms.renameRoom,
                onPosition: rooms.setPosition,
              }}
              room={room}
              doors={doors}
              windows={windows}
              unitSystem={unitSystem}
              onRoomDimsChange={changeRoomDims}
              shape={roomShape.shape}
              onShapeChange={roomShape.changeShape}
              onLShapeChange={roomShape.changeLShape}
              onWallLengthChange={roomShape.setWallLength}
              highlightedWall={roomShape.highlightedWall}
              onHighlightWall={roomShape.highlightWall}
              onAddDoor={addDoor}
              onUpdateDoor={(id, patch) => {
                openings.updateDoor(id, patch);
                showOpening(id);
              }}
              onDeleteDoor={openings.deleteDoor}
              onAddWindow={addWindow}
              onUpdateWindow={(id, patch) => {
                openings.updateWindow(id, patch);
                showOpening(id);
              }}
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
              items={placed}
              warnings={warnings}
              selection={selection}
              isMobile={isMobile}
              colorPickerItemId={colorPickerItemId}
              frameOf={(item) => pieceFrame(plan, item)}
              roomOf={
                several
                  ? (item) => {
                      const r = pieceRoom(plan, item);
                      return r ? roomName(plan, r) : null;
                    }
                  : undefined
              }
              roomNames={roomNames}
              roomLabel={several ? 'In the rooms' : 'In the room'}
              unitSystem={unitSystem}
              onAddItem={addItem}
              onClearRoom={furniture.clearRoom}
              onSelectItem={selectCard}
              onChangeItem={furniture.changeItem}
              onCommit={commit}
              onToggleLock={furniture.toggleLock}
              onToggleVisibility={furniture.toggleVisibility}
              onSetAside={(id) => setAsideWithUndo(id, 'menu')}
              onDeleteItem={deleteWithUndo}
              onRotateItem={(id) => furniture.rotateItem(id, 90)}
              onDuplicateItem={(id) => {
                furniture.duplicateItem(id);
              }}
              onToggleColorPicker={sel.toggleColorPicker}
              onCloseColorPicker={sel.closeColorPicker}
              highlight={latestCard(
                furniture.lastAdded,
                revealedCard?.type === 'item' ? revealedCard : null,
              )}
              view={furnitureView}
              onViewChange={setFurnitureView}
              setAsideCount={inventory.length}
              setAsideTabRef={asideTabRef}
              setAside={
                <SetAsideList
                  items={inventory}
                  unitSystem={unitSystem}
                  onPlace={startPlacing}
                  onDragStart={dragFromList}
                  onDelete={deleteWithUndo}
                  placingId={placingId ?? draggingId}
                  fallbackFocus={asideTabRef}
                  highlight={asideHighlight}
                />
              }
            />
          </Sidebar>
          <div ref={setPopoverRoot} className="contents" data-popover-root />

          <div className="relative flex flex-1 min-w-0">
            <RoomCanvas
              containerRef={containerRef}
              plan={plan}
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
              onDoorPointerDown={(e, door) => openings.startOpeningDrag(e, door.id, 'doors')}
              onWindowPointerDown={(e, win) => openings.startOpeningDrag(e, win.id, 'windows')}
              highlightDoorIds={highlightDoorIds}
              flashOpeningId={flashOpening}
              activeRoomId={activeRoomId}
              labelItems={labelItems}
              rooms={
                isRoomSetup && several
                  ? { onSelect: selectRoom, onPointerDown: rooms.startRoomDrag, drag: rooms.drag }
                  : null
              }
              selectionBar={
                selectionActions &&
                !isMobile && (
                  <SelectionToolbar
                    variant="canvas"
                    item={selectionActions}
                    onAction={(a) => runPieceAction(selectionActions.id, a, 'toolbar')}
                  />
                )
              }
              ghost={
                ghostItem && ghostAt
                  ? { item: ghostItem, at: ghostAt, ok: !!roomAt(plan, ghostAt) }
                  : null
              }
              corners={
                roomShape.editingCorners
                  ? {
                      selected: roomShape.selectedCorner,
                      highlightedWall: roomShape.highlightedWall,
                      drag: roomShape.drag,
                      onPointerDown: roomShape.startCornerDrag,
                      onSelect: (i) => roomShape.selectCorner(i),
                      onAddCorner: roomShape.addCorner,
                      onRemoveCorner: (i) => {
                        roomShape.removeCorner(i);
                        requestAnimationFrame(focusCanvas);
                      },
                    }
                  : null
              }
              overlay={
                overlayItemId !== undefined && (
                  <SnapOverlay
                    items={pieces}
                    room={roomSize(overlayRoom)}
                    outline={!several && isRectangle(overlayRoom) ? undefined : overlayRoom.outline}
                    zoom={zoom}
                    unitSystem={unitSystem}
                    itemId={overlayItemId}
                    drag={dragFrame}
                    rotation={rotateFrame?.id === overlayItemId ? rotateFrame.angle : null}
                  />
                )
              }
            />
            {several && !canvasCovered && (
              <RoomChips
                plan={plan}
                activeRoomId={activeRoomId}
                focused={focusedRoom}
                onRoom={zoomToRoom}
                onFloor={fitToView}
                placement={isMobile ? 'top' : 'bottom'}
              />
            )}
            {placingItem && (
              <PlacementBanner
                name={pieceName(placingItem)}
                touch={isMobile}
                onFreeSpot={() => placeInFreeSpot(placingItem.id)}
                onCancel={cancelPlacing}
              />
            )}
          </div>
        </div>

        <ShortcutsDialog isOpen={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />

        <ShareModal
          isOpen={shareOpen}
          onClose={() => setShareOpen(false)}
          plan={doc}
          onImport={projectActions.importConfig}
          showQr={!isMobile}
        />

        <ExportModal
          isOpen={exportOpen}
          onClose={() => setExportOpen(false)}
          plan={plan}
          unitSystem={unitSystem}
          projectName={projectName}
        />

        <FileBrowserModal
          isOpen={filesOpen}
          onClose={() => setFilesOpen(false)}
          projects={projects.projects}
          locked={projects.locked}
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

        {dragChip && dragItem && (
          // A set-aside piece dragged from the list, until it is over the plan.
          <div
            className="fixed z-[200] pointer-events-none -translate-x-1/2 -translate-y-[130%] flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-slate-900/90 text-white text-xs font-medium shadow-xl"
            style={{ left: dragChip.x, top: dragChip.y }}
            data-testid="drag-chip"
          >
            <span
              className="w-3 h-3 rounded-sm"
              style={{ backgroundColor: migrateColor(dragItem.color) }}
              aria-hidden="true"
            />
            {pieceName(dragItem)}
          </div>
        )}

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
