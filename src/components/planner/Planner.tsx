import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { Home, Sofa } from 'lucide-react';
import { useHistory } from '../../hooks/useHistory';
import { useIsMobile } from '../../hooks/useIsMobile';
import { useKeyboardShortcuts } from '../../hooks/useKeyboardShortcuts';
import { usePanZoom } from '../../hooks/usePanZoom';
import { usePointerDrag } from '../../hooks/usePointerDrag';
import { useProjects } from '../../hooks/useProjects';
import { useRotationDrag } from '../../hooks/useRotationDrag';
import { track } from '../../lib/analytics';
import type { BootState } from '../../lib/boot';
import { downloadFile } from '../../lib/browser';
import { migrateColor, randomPresetColor } from '../../lib/colors';
import { DESIGN_MODES, PIXELS_PER_UNIT, isDesignMode, isUnitSystem } from '../../lib/constants';
import {
  computeItemWarnings,
  constrainOpening,
  isHorizontalWall,
  wallLength,
} from '../../lib/geometry';
import {
  defaultLayout,
  fromShareConfig,
  normalizeLayout,
  toShareConfig,
  type ShareConfig,
} from '../../lib/layout';
import { HELP_PATH } from '../../lib/paths';
import { buildExportFile, exportFileName } from '../../lib/projects';
import { saveDesignMode, saveLayout, saveUnitSystem, type StorageLike } from '../../lib/storage';
import { clamp } from '../../lib/units';
import type {
  DesignMode,
  Door,
  FurnitureItem,
  Id,
  Layout,
  Project,
  RoomDims,
  RoomWindow,
  Selection,
  UnitSystem,
} from '../../types';
import { ColorPicker } from './ColorPicker';
import { FileBrowserModal } from './FileBrowserModal';
import { FurniturePanel } from './FurniturePanel';
import { Header } from './Header';
import { PwaNotices } from './PwaNotices';
import { RoomCanvas } from './RoomCanvas';
import { RoomSetupPanel } from './RoomSetupPanel';
import { ShareModal } from './ShareModal';
import { Sidebar } from './Sidebar';
import { FloatingZoomControls } from './ZoomControls';

interface PlannerProps {
  storage: StorageLike;
  initial: BootState;
}

const patchItem = (l: Layout, id: Id, patch: Partial<FurnitureItem>): Layout => ({
  ...l,
  items: l.items.map((i) => (i.id === id ? { ...i, ...patch } : i)),
});

/** The room planner application (everything inside the island). */
export function Planner({ storage, initial }: PlannerProps) {
  const history = useHistory<Layout>(initial.layout);
  const { present: layout, set: setLayout, apply: applyLayout, commit } = history;
  const [unitSystem, setUnitSystem] = useState<UnitSystem>(initial.unitSystem);
  const [designMode, setDesignMode] = useState<DesignMode>(initial.designMode);

  const isMobile = useIsMobile();
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const sidebarOpen = !isMobile || mobileSidebarOpen;

  const [selection, setSelection] = useState<Selection | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [filesOpen, setFilesOpen] = useState(false);
  const [colorPickerItemId, setColorPickerItemId] = useState<Id | null>(null);
  const [roomSetupExpanded, setRoomSetupExpanded] = useState(false);
  const [furnitureExpanded, setFurnitureExpanded] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const { zoom, zoomRef, pan, zoomIn, zoomOut, fitToView } = usePanZoom(
    containerRef,
    layout.roomDims,
    isMobile,
  );
  const startDrag = usePointerDrag();
  const startRotation = useRotationDrag();

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
    () => computeItemWarnings(layout.items, layout.roomDims),
    [layout.items, layout.roomDims],
  );
  const shareConfig = useMemo(
    () => toShareConfig(layout, projectName, unitSystem),
    [layout, projectName, unitSystem],
  );

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
    history.undo();
    track('undo');
  }, [history]);

  const redo = useCallback(() => {
    if (!history.canRedo) return;
    history.redo();
    track('redo');
  }, [history]);

  // --- Furniture -------------------------------------------------------------------
  const selectItem = useCallback((id: Id) => setSelection({ id, type: 'item' }), []);

  const addItem = () => {
    const { width, height } = layout.roomDims;
    const newItem: FurnitureItem = {
      id: Date.now(),
      label: 'New Item',
      width: 3,
      height: 2,
      x: width / 2 - 1.5,
      y: height / 2 - 1,
      rotation: 0,
      color: randomPresetColor(),
      visible: true,
    };
    applyLayout((l) => ({ ...l, items: [...l.items, newItem] }));
    track('furniture_added', { count: layout.items.length + 1 });
    if (isMobile) setMobileSidebarOpen(false);
  };

  const deleteItem = useCallback(
    (id: Id) => {
      applyLayout((l) => ({ ...l, items: l.items.filter((i) => i.id !== id) }));
      setSelection((s) => (s?.type === 'item' && s.id === id ? null : s));
      setColorPickerItemId((c) => (c === id ? null : c));
      track('furniture_removed');
    },
    [applyLayout],
  );

  const changeItem = useCallback(
    (id: Id, patch: Partial<FurnitureItem>, shouldCommit = true) =>
      (shouldCommit ? applyLayout : setLayout)((l) => patchItem(l, id, patch)),
    [applyLayout, setLayout],
  );

  const toggleLock = useCallback(
    (id: Id) =>
      applyLayout((l) => ({
        ...l,
        items: l.items.map((i) => (i.id === id ? { ...i, locked: !i.locked } : i)),
      })),
    [applyLayout],
  );

  const toggleVisibility = useCallback(
    (id: Id) =>
      applyLayout((l) => ({
        ...l,
        items: l.items.map((i) => (i.id === id ? { ...i, visible: !(i.visible !== false) } : i)),
      })),
    [applyLayout],
  );

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

  // --- Room, doors, windows ----------------------------------------------------------
  const updateRoomDims = (dims: RoomDims) =>
    applyLayout((l) => ({
      ...l,
      roomDims: { width: Math.max(1, dims.width || 1), height: Math.max(1, dims.height || 1) },
    }));

  const addDoor = () => {
    const door: Door = {
      id: Date.now(),
      width: 3,
      position: 2,
      wall: 'bottom',
      hinge: 'left',
      type: 'swing-in',
    };
    applyLayout((l) => ({ ...l, doors: [...l.doors, door] }));
    track('door_added', { count: layout.doors.length + 1 });
  };
  const updateDoor = (id: Id, updates: Partial<Door>) =>
    applyLayout((l) => ({
      ...l,
      doors: l.doors.map((d) => (d.id === id ? constrainOpening(d, updates, l.roomDims, 1) : d)),
    }));
  const deleteDoor = (id: Id) =>
    applyLayout((l) => ({ ...l, doors: l.doors.filter((d) => d.id !== id) }));

  const addWindow = () => {
    const win: RoomWindow = { id: Date.now(), width: 3, position: 2, wall: 'top' };
    applyLayout((l) => ({ ...l, windows: [...l.windows, win] }));
    track('window_added', { count: layout.windows.length + 1 });
  };
  const updateWindow = (id: Id, updates: Partial<RoomWindow>) =>
    applyLayout((l) => ({
      ...l,
      windows: l.windows.map((w) =>
        w.id === id ? constrainOpening(w, updates, l.roomDims, 0.5) : w,
      ),
    }));
  const deleteWindow = (id: Id) =>
    applyLayout((l) => ({ ...l, windows: l.windows.filter((w) => w.id !== id) }));

  // --- Canvas interactions -----------------------------------------------------------
  const onItemPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>, item: FurnitureItem) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      setSelection({ id: item.id, type: 'item' });
      // Locked (by mode or individually): selectable, but not movable.
      if (isRoomSetup || item.locked) return;
      e.stopPropagation();
      e.preventDefault();
      let last = { x: e.clientX, y: e.clientY };
      startDrag(e, {
        onMove: (ev) => {
          const scale = PIXELS_PER_UNIT * zoomRef.current;
          const dx = (ev.clientX - last.x) / scale;
          const dy = (ev.clientY - last.y) / scale;
          last = { x: ev.clientX, y: ev.clientY };
          setLayout((l) => ({
            ...l,
            items: l.items.map((i) => (i.id === item.id ? { ...i, x: i.x + dx, y: i.y + dy } : i)),
          }));
        },
        onEnd: () => commit(),
      });
    },
    [isRoomSetup, startDrag, zoomRef, setLayout, commit],
  );

  const onRotatePointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>, item: FurnitureItem) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      e.stopPropagation();
      e.preventDefault();
      const piece = e.currentTarget.parentElement;
      if (!piece) return;
      // The rotated element's bounding box shares its center with the item.
      const rect = piece.getBoundingClientRect();
      startRotation(e, {
        center: { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 },
        startRotation: item.rotation,
        onRotate: (deg) => setLayout((l) => patchItem(l, item.id, { rotation: deg })),
        onEnd: (deg) => applyLayout((l) => patchItem(l, item.id, { rotation: deg })),
      });
    },
    [startRotation, setLayout, applyLayout],
  );

  const startOpeningDrag = (
    e: ReactPointerEvent<HTMLDivElement>,
    id: Id,
    kind: 'doors' | 'windows',
  ) => {
    if (!isRoomSetup || (e.pointerType === 'mouse' && e.button !== 0)) return;
    e.stopPropagation();
    e.preventDefault();
    setSelection({ id, type: kind === 'doors' ? 'door' : 'window' });
    let last = { x: e.clientX, y: e.clientY };
    startDrag(e, {
      onMove: (ev) => {
        const scale = PIXELS_PER_UNIT * zoomRef.current;
        const dx = (ev.clientX - last.x) / scale;
        const dy = (ev.clientY - last.y) / scale;
        last = { x: ev.clientX, y: ev.clientY };
        setLayout((l) => {
          const list = l[kind] as (Door | RoomWindow)[];
          const next = list.map((o) => {
            if (o.id !== id) return o;
            const horizontal = isHorizontalWall(o.wall);
            const len = wallLength(l.roomDims, o.wall);
            return { ...o, position: clamp(o.position + (horizontal ? dx : dy), 0, len - o.width) };
          });
          return { ...l, [kind]: next };
        });
      },
      onEnd: () => commit(),
    });
  };

  // --- Keyboard ----------------------------------------------------------------------
  const selectedItem =
    selection?.type === 'item' ? layout.items.find((i) => i.id === selection.id) : undefined;
  const canEditSelected = !!selectedItem && !isRoomSetup && !selectedItem.locked;

  useKeyboardShortcuts(
    {
      undo,
      redo,
      deleteSelected: () => {
        if (!selectedItem || isRoomSetup) return false;
        deleteItem(selectedItem.id);
        return true;
      },
      deselect: () => {
        setSelection(null);
        setColorPickerItemId(null);
      },
      nudge: (dx, dy) => {
        if (!canEditSelected) return false;
        applyLayout((l) => ({
          ...l,
          items: l.items.map((i) =>
            i.id === selectedItem.id ? { ...i, x: i.x + dx, y: i.y + dy } : i,
          ),
        }));
        return true;
      },
      rotateSelected: () => {
        if (!canEditSelected) return false;
        changeItem(selectedItem.id, { rotation: (selectedItem.rotation + 90) % 360 });
        return true;
      },
    },
    !shareOpen && !filesOpen,
  );

  // --- Projects --------------------------------------------------------------------------
  const openProject = (project: Project) => {
    const next = normalizeLayout(project.data);
    const mode = isDesignMode(project.data.designMode) ? project.data.designMode : designMode;
    const units = isUnitSystem(project.data.unitSystem) ? project.data.unitSystem : unitSystem;
    history.reset(next);
    setDesignMode(mode);
    setUnitSystem(units);
    projects.select(project, { layout: next, designMode: mode, unitSystem: units });
    setSelection(null);
    setFilesOpen(false);
    track('project_opened');
  };

  const newProject = () => {
    history.reset(defaultLayout());
    setDesignMode(DESIGN_MODES.ROOM_SETUP);
    projects.startNew();
    setSelection(null);
    setFilesOpen(false);
  };

  const renameCurrent = (name: string) => {
    if (projects.currentProjectId) projects.rename(projects.currentProjectId, name);
    else projects.createNamed(name, 'rename');
  };

  const importConfig = (config: ShareConfig) => {
    const next = fromShareConfig(config);
    applyLayout(() => next);
    setSelection(null);
    if (typeof config.name === 'string' && config.name) {
      projects.createNamed(config.name, 'import', { layout: next, designMode, unitSystem }, next);
    }
    track('import_json', { kind: 'layout' });
  };

  const exportProjects = (ids: string[]) => {
    const list = projects.projects.filter((p) => ids.includes(p.id));
    if (!list.length) return;
    downloadFile(exportFileName(list), JSON.stringify(buildExportFile(list), null, 2));
    track('export_json', { kind: 'projects', count: list.length });
  };

  // --- Render --------------------------------------------------------------------------------
  const colorPickerItem =
    isMobile && colorPickerItemId !== null
      ? layout.items.find((i) => i.id === colorPickerItemId)
      : undefined;

  return (
    <div className="flex flex-col h-full bg-slate-50 text-slate-800 font-sans overflow-hidden relative">
      <Header
        projectName={projectName}
        roomDims={layout.roomDims}
        unitSystem={unitSystem}
        saveStatus={projects.saveStatus}
        lastSavedAt={projects.lastSavedAt}
        canUndo={history.canUndo}
        canRedo={history.canRedo}
        zoom={zoom}
        helpHref={HELP_PATH}
        onOpenFiles={() => setFilesOpen(true)}
        onRename={renameCurrent}
        onUndo={undo}
        onRedo={redo}
        onZoomIn={zoomIn}
        onZoomOut={zoomOut}
        onFit={fitToView}
        onShare={() => setShareOpen(true)}
      />

      <div className="flex flex-1 overflow-hidden relative">
        {isMobile && mobileSidebarOpen && (
          <div
            className="fixed top-12 sm:top-16 bottom-0 left-0 right-0 bg-slate-900/50 z-40 md:hidden animate-fade-in"
            onClick={() => setMobileSidebarOpen(false)}
            aria-hidden="true"
          />
        )}

        <Sidebar
          open={sidebarOpen}
          designMode={designMode}
          unitSystem={unitSystem}
          helpHref={HELP_PATH}
          onUnitSystemChange={changeUnitSystem}
          onDesignModeChange={changeDesignMode}
          onClose={() => setMobileSidebarOpen(false)}
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
            onRoomDimsChange={updateRoomDims}
            onAddDoor={addDoor}
            onUpdateDoor={updateDoor}
            onDeleteDoor={deleteDoor}
            onAddWindow={addWindow}
            onUpdateWindow={updateWindow}
            onDeleteWindow={deleteWindow}
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
            onSelectItem={selectItem}
            onChangeItem={changeItem}
            onCommit={commit}
            onToggleLock={toggleLock}
            onToggleVisibility={toggleVisibility}
            onDeleteItem={deleteItem}
            onToggleColorPicker={toggleColorPicker}
            onCloseColorPicker={closeColorPicker}
          />
        </Sidebar>

        {/* Mobile: floating button to open the editor */}
        {isMobile && !mobileSidebarOpen && (
          <button
            type="button"
            onClick={() => {
              setMobileSidebarOpen(true);
              setSelection(null);
            }}
            className={`fixed bottom-6 right-6 z-40 text-white rounded-full pl-4 pr-5 py-3 shadow-lg flex items-center gap-2 transition-all active:scale-95 animate-fade-in ${
              isRoomSetup
                ? 'bg-indigo-600 hover:bg-indigo-700'
                : 'bg-emerald-600 hover:bg-emerald-700'
            }`}
            aria-label={isRoomSetup ? 'Edit room settings' : 'Edit furniture'}
          >
            {isRoomSetup ? (
              <>
                <Home className="w-5 h-5" />
                <span className="text-sm font-medium">Edit Room</span>
              </>
            ) : (
              <>
                <Sofa className="w-5 h-5" />
                <span className="text-sm font-medium">Edit Furniture</span>
              </>
            )}
          </button>
        )}

        {!sidebarOpen && (
          <FloatingZoomControls
            zoom={zoom}
            onZoomIn={zoomIn}
            onZoomOut={zoomOut}
            onFit={fitToView}
          />
        )}

        <RoomCanvas
          containerRef={containerRef}
          layout={layout}
          warnings={warnings}
          selection={selection}
          designMode={designMode}
          unitSystem={unitSystem}
          zoom={zoom}
          pan={pan}
          showModeBadge={!(isMobile && sidebarOpen)}
          onItemPointerDown={onItemPointerDown}
          onRotatePointerDown={onRotatePointerDown}
          onSelectItem={(item) => selectItem(item.id)}
          onDoorPointerDown={(e, door) => startOpeningDrag(e, door.id, 'doors')}
          onWindowPointerDown={(e, win) => startOpeningDrag(e, win.id, 'windows')}
        />
      </div>

      <ShareModal
        isOpen={shareOpen}
        onClose={() => setShareOpen(false)}
        config={shareConfig}
        onImport={importConfig}
      />

      <FileBrowserModal
        isOpen={filesOpen}
        onClose={() => setFilesOpen(false)}
        projects={projects.projects}
        currentProjectId={projects.currentProjectId}
        unitSystem={unitSystem}
        onNew={newProject}
        onOpen={openProject}
        onRename={projects.rename}
        onDuplicate={projects.duplicate}
        onDelete={projects.remove}
        onExport={exportProjects}
        onImport={projects.importFile}
        onSaveCurrent={() => {
          projects.saveNow();
          setFilesOpen(false);
        }}
      />

      <PwaNotices />

      {colorPickerItem && (
        <ColorPicker
          currentColor={migrateColor(colorPickerItem.color)}
          onChange={(color) => changeItem(colorPickerItem.id, { color })}
          onClose={closeColorPicker}
          isMobile
        />
      )}
    </div>
  );
}
