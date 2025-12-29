import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Move, RotateCw, Lock, Unlock, Settings, RotateCcw, Info, ArrowLeftRight, ArrowUpDown, ChevronLeft, ChevronRight, Share2, X, Copy, Check, Download, Upload, Plus, Trash2, Eye, EyeOff, Undo2, Redo2, Maximize2, Palette, ZoomIn, ZoomOut } from 'lucide-react';
import Knob from './Knob';

// Constants
const PIXELS_PER_UNIT = 40;
const STORAGE_PREFIX = 'room-sim-v2-'; 

const INITIAL_ROOM = { width: 12, height: 12 };
const INITIAL_DOOR = { width: 3, position: 6, wall: 'bottom', hinge: 'left', open: 'in' };
const INITIAL_ITEMS = [
  { id: 1, label: 'Bed', width: 6, height: 4, x: 2, y: 2, rotation: 0, color: 'bg-blue-200 border-blue-400', visible: true },
  { id: 2, label: 'Desk', width: 4, height: 2, x: 9, y: 2, rotation: 0, color: 'bg-emerald-200 border-emerald-400', visible: true },
  { id: 3, label: 'Wardrobe', width: 3, height: 2, x: 2, y: 8, rotation: 0, color: 'bg-amber-200 border-amber-400', visible: true },
  { id: 4, label: 'Rug', width: 5, height: 8, x: 6, y: 5, rotation: 0, color: 'bg-rose-100 border-rose-300', visible: true },
];

const COLORS = [
    'bg-blue-200 border-blue-400', 
    'bg-emerald-200 border-emerald-400',
    'bg-amber-200 border-amber-400', 
    'bg-rose-200 border-rose-400',
    'bg-indigo-200 border-indigo-400',
    'bg-cyan-200 border-cyan-400',
    'bg-purple-200 border-purple-400',
    'bg-orange-200 border-orange-400',
    'bg-lime-200 border-lime-400',
    'bg-fuchsia-200 border-fuchsia-400'
];

const MAX_HISTORY = 50;

// --- Helpers ---

const parseToFeet = (input) => {
  if (!input && input !== 0) return 0;
  const str = String(input).trim().toLowerCase();
  if (str.includes("'") || (str.includes('ft') && !str.endsWith('ft'))) {
    const parts = str.split(/['|ft]/);
    const feet = parseFloat(parts[0]) || 0;
    let inches = 0;
    if (parts.length > 1 && parts[1]) {
      const inchStr = parts[1].replace(/["|in|inch\s]/g, '');
      inches = parseFloat(inchStr) || 0;
    }
    return feet + (inches / 12);
  }
  if (str.includes('"') || str.endsWith('in') || str.endsWith('inch')) {
    return parseFloat(str.replace(/["|in|inch\s]/g, '')) / 12;
  }
  return parseFloat(str) || 0;
};

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const formatDimension = (feet) => {
  if (!feet && feet !== 0) return '0';
  const totalInches = feet * 12;
  const wholeFeet = Math.floor(feet);
  const inches = Math.round((feet - wholeFeet) * 12);
  
  if (inches === 0) return `${wholeFeet}'`;
  if (wholeFeet === 0) return `${inches}"`;
  return `${wholeFeet}'${inches}"`;
};

const checkItemsCollision = (item1, item2) => {
  // Simple AABB collision (ignoring rotation for simplicity)
  return !(item1.x + item1.width < item2.x ||
           item2.x + item2.width < item1.x ||
           item1.y + item1.height < item2.y ||
           item2.y + item2.height < item1.y);
};

const isItemInBounds = (item, roomDims) => {
  return item.x >= 0 && 
         item.y >= 0 && 
         item.x + item.width <= roomDims.width && 
         item.y + item.height <= roomDims.height;
};

// Encoding helpers for URL
const encodeConfig = (config) => {
    try {
        return btoa(JSON.stringify(config));
    } catch (e) { return ''; }
};

const decodeConfig = (str) => {
    try {
        return JSON.parse(atob(str));
    } catch (e) { return null; }
};

// --- Components ---

const DimensionInput = ({ value, onChange, className, placeholder, min = 0, max = 1000, label }) => {
  const [localVal, setLocalVal] = useState('');
  const [isFocused, setIsFocused] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isFocused && typeof value === 'number') {
      const currentParsed = parseToFeet(localVal);
      if (Math.abs(currentParsed - value) > 0.01 || localVal === '') {
         setLocalVal(Number.isInteger(value) ? value.toString() : value.toFixed(2));
      }
    }
  }, [value, isFocused]);

  const commitValue = () => {
    setIsFocused(false);
    const feet = parseToFeet(localVal);
    
    if (feet < min) {
      setError(`Minimum value is ${min}'`);
      setLocalVal(min.toString());
      onChange(min);
      setTimeout(() => setError(''), 3000);
      return;
    }
    
    if (feet > max) {
      setError(`Maximum value is ${max}'`);
      setLocalVal(max.toString());
      onChange(max);
      setTimeout(() => setError(''), 3000);
      return;
    }
    
    setError('');
    onChange(feet);
  };

  return (
    <div className="relative w-full">
        <input
        type="text"
        value={localVal}
        onChange={(e) => setLocalVal(e.target.value)}
        onFocus={() => setIsFocused(true)}
        onBlur={commitValue}
        onKeyDown={(e) => e.key === 'Enter' && e.target.blur()}
        className={`${className} ${error ? 'border-red-400 focus:ring-red-500' : ''}`}
        placeholder={placeholder}
        aria-label={label || placeholder}
        />
        {error && <p className="absolute -bottom-5 left-0 text-[10px] text-red-500">{error}</p>}
    </div>
  );
};

const Modal = ({ isOpen, onClose, title, children }) => {
    useEffect(() => {
      if (!isOpen) return;
      
      const handleEscape = (e) => {
        if (e.key === 'Escape') onClose();
      };
      
      document.addEventListener('keydown', handleEscape);
      document.body.style.overflow = 'hidden';
      
      return () => {
        document.removeEventListener('keydown', handleEscape);
        document.body.style.overflow = 'unset';
      };
    }, [isOpen, onClose]);
    
    if (!isOpen) return null;
    
    return (
        <div 
          className="absolute inset-0 z-[100] flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4 animate-fade-in"
          onClick={onClose}
          role="dialog"
          aria-modal="true"
          aria-labelledby="modal-title"
        >
            <div 
              className="bg-white rounded-xl shadow-2xl w-full max-w-md flex flex-col max-h-[90vh] animate-slide-up"
              onClick={(e) => e.stopPropagation()}
            >
                <div className="flex justify-between items-center p-4 border-b border-slate-100">
                    <h3 id="modal-title" className="font-bold text-slate-800">{title}</h3>
                    <button 
                      onClick={onClose} 
                      className="p-2 hover:bg-slate-100 rounded-full transition-colors"
                      aria-label="Close modal"
                    >
                      <X className="w-5 h-5 text-slate-500" />
                    </button>
                </div>
                <div className="p-6 overflow-y-auto">
                    {children}
                </div>
            </div>
        </div>
    );
};

const ColorPicker = ({ currentColor, onChange, onClose, isMobile = false }) => {
  if (isMobile) {
    return (
      <div 
        className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-slate-900/50 backdrop-blur-sm animate-fade-in"
        onClick={onClose}
      >
        <div 
          className="bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl w-full sm:w-auto sm:min-w-[280px] p-6 animate-slide-up"
          onClick={(e) => e.stopPropagation()}
          data-color-picker
        >
          <div className="flex justify-between items-center mb-4">
            <h3 className="font-semibold text-slate-800">Choose Color</h3>
            <button 
              onClick={onClose}
              className="p-1 hover:bg-slate-100 rounded-full transition-colors"
              aria-label="Close color picker"
            >
              <X className="w-5 h-5 text-slate-500" />
            </button>
          </div>
          <div className="grid grid-cols-5 gap-3">
            {COLORS.map((color) => (
              <button
                key={color}
                onClick={() => {
                  onChange(color);
                  onClose();
                }}
                className={`w-12 h-12 rounded-full border-2 transition-all active:scale-95 ${color.split(' ')[0]} ${
                  currentColor === color ? 'ring-2 ring-indigo-500 ring-offset-2 scale-110' : 'border-slate-300'
                }`}
                aria-label={`Select color ${color}`}
              />
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div 
      className="absolute top-full left-0 mt-1 bg-white rounded-lg shadow-xl border border-slate-200 p-3 z-50 grid grid-cols-5 gap-2"
      data-color-picker
    >
      {COLORS.map((color) => (
        <button
          key={color}
          onClick={() => {
            onChange(color);
            onClose();
          }}
          className={`w-8 h-8 rounded-full border-2 transition-all hover:scale-110 active:scale-95 ${color.split(' ')[0]} ${
            currentColor === color ? 'ring-2 ring-indigo-500 ring-offset-2' : 'border-slate-300'
          }`}
          aria-label={`Select color ${color}`}
        />
      ))}
    </div>
  );
};

const Tooltip = ({ children, text, position = 'auto' }) => {
  const [show, setShow] = useState(false);
  const [actualPosition, setActualPosition] = useState('bottom');
  const [tooltipStyle, setTooltipStyle] = useState({});
  const [arrowStyle, setArrowStyle] = useState({});
  const tooltipRef = useRef(null);
  const containerRef = useRef(null);
  
  useEffect(() => {
    if (show && containerRef.current) {
      const containerRect = containerRef.current.getBoundingClientRect();
      
      // Calculate initial tooltip position
      const updatePosition = () => {
        if (!tooltipRef.current) return;
        
        const tooltipRect = tooltipRef.current.getBoundingClientRect();
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;
        const padding = 8;
        const arrowSize = 8;
        
        // Determine vertical position
        let vertical = 'bottom';
        if (position === 'auto') {
          const spaceAbove = containerRect.top;
          const spaceBelow = viewportHeight - containerRect.bottom;
          const tooltipHeight = tooltipRect.height + arrowSize + 8;
          
          if (spaceBelow >= tooltipHeight) {
            vertical = 'bottom';
          } else if (spaceAbove >= tooltipHeight) {
            vertical = 'top';
          } else {
            vertical = spaceBelow > spaceAbove ? 'bottom' : 'top';
          }
        } else {
          vertical = position;
        }
        setActualPosition(vertical);
        
        // Calculate horizontal position
        const containerCenterX = containerRect.left + containerRect.width / 2;
        let tooltipLeft = containerCenterX - tooltipRect.width / 2;
        
        // Adjust for horizontal overflow
        if (tooltipLeft < padding) {
          tooltipLeft = padding;
        } else if (tooltipLeft + tooltipRect.width > viewportWidth - padding) {
          tooltipLeft = viewportWidth - padding - tooltipRect.width;
        }
        
        // Calculate vertical position
        let tooltipTop;
        if (vertical === 'bottom') {
          tooltipTop = containerRect.bottom + arrowSize;
        } else {
          tooltipTop = containerRect.top - tooltipRect.height - arrowSize;
        }
        
        setTooltipStyle({
          position: 'fixed',
          left: `${tooltipLeft}px`,
          top: `${tooltipTop}px`,
        });
        
        // Position arrow to point at container center
        const arrowLeft = containerCenterX - tooltipLeft;
        setArrowStyle({
          left: `${arrowLeft}px`,
        });
      };
      
      // Initial position calculation
      requestAnimationFrame(updatePosition);
    }
  }, [show, position, text]);
  
  const isBottom = actualPosition === 'bottom';
  
  return (
    <div 
      ref={containerRef}
      className="relative" 
      onMouseEnter={() => setShow(true)} 
      onMouseLeave={() => setShow(false)}
    >
      {children}
      {show && (
        <div 
          ref={tooltipRef}
          className="px-2 py-1 bg-slate-800 text-white text-xs rounded whitespace-nowrap z-[9999] pointer-events-none"
          style={tooltipStyle}
        >
          {text}
          <div 
            className={`absolute border-4 border-transparent ${
              isBottom 
                ? 'bottom-full -mb-px border-b-slate-800' 
                : 'top-full -mt-px border-t-slate-800'
            }`}
            style={{
              ...arrowStyle,
              transform: 'translateX(-50%)'
            }}
          />
        </div>
      )}
    </div>
  );
};

export default function RoomSimulator() {
  const [sidebarOpen, setSidebarOpen] = useState(false); // Start closed on mobile for better UX
  const [modalOpen, setModalOpen] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState(null);
  const [importError, setImportError] = useState(null);
  const [importText, setImportText] = useState('');
  const [showColorPicker, setShowColorPicker] = useState(null);
  const [isMobile, setIsMobile] = useState(false);
  const [zoom, setZoom] = useState(1);

  // Detect mobile screen size and set initial sidebar state
  useEffect(() => {
    const checkMobile = () => {
      const wasMobile = isMobile;
      const mobile = window.innerWidth < 768;
      setIsMobile(mobile);
      
      // Clear active item when switching to mobile and sidebar is open
      if (mobile && !wasMobile && sidebarOpen) {
        setActiveId(null);
      }
      
      // On desktop, open sidebar by default
      if (!mobile && window.innerWidth >= 768) {
        setSidebarOpen(true);
      }
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, [isMobile, sidebarOpen]);

  // Prevent body scroll when sidebar is open on mobile and clear active items
  useEffect(() => {
    if (isMobile && sidebarOpen) {
      document.body.style.overflow = 'hidden';
      // Clear any active item when sidebar opens on mobile
      setActiveId(null);
    } else {
      document.body.style.overflow = 'unset';
    }
    
    return () => {
      document.body.style.overflow = 'unset';
    };
  }, [isMobile, sidebarOpen]);

  // --- Initialization Logic (URL -> LocalStorage -> Default) ---
  const getInitialState = (key, defaultVal) => {
      try {
        const saved = localStorage.getItem(STORAGE_PREFIX + key);
        return saved ? JSON.parse(saved) : defaultVal;
      } catch (e) { return defaultVal; }
  };

  const [roomDims, setRoomDims] = useState(() => getInitialState('dims', INITIAL_ROOM));
  const [door, setDoor] = useState(() => getInitialState('door', INITIAL_DOOR));
  const [items, setItems] = useState(() => getInitialState('items', INITIAL_ITEMS));
  
  // History for undo/redo
  const [history, setHistory] = useState([]);
  const [historyIndex, setHistoryIndex] = useState(-1);

  // --- Persistence Effects ---
  
  // Save state to history for undo/redo
  const saveToHistory = useCallback(() => {
    const newState = { roomDims, door, items };
    const newHistory = history.slice(0, historyIndex + 1);
    newHistory.push(newState);
    
    if (newHistory.length > MAX_HISTORY) {
      newHistory.shift();
    } else {
      setHistoryIndex(historyIndex + 1);
    }
    
    setHistory(newHistory);
  }, [roomDims, door, items, history, historyIndex]);
  
  const undo = useCallback(() => {
    if (historyIndex > 0) {
      const prevState = history[historyIndex - 1];
      setRoomDims(prevState.roomDims);
      setDoor(prevState.door);
      setItems(prevState.items);
      setHistoryIndex(historyIndex - 1);
    }
  }, [history, historyIndex]);
  
  const redo = useCallback(() => {
    if (historyIndex < history.length - 1) {
      const nextState = history[historyIndex + 1];
      setRoomDims(nextState.roomDims);
      setDoor(nextState.door);
      setItems(nextState.items);
      setHistoryIndex(historyIndex + 1);
    }
  }, [history, historyIndex]);
  
  // 1. Load from URL on mount
  useEffect(() => {
      const params = new URLSearchParams(window.location.search);
      const configStr = params.get('config');
      if (configStr) {
          const parsed = decodeConfig(configStr);
          if (parsed) {
              if (parsed.roomDims) setRoomDims(parsed.roomDims);
              if (parsed.door) setDoor(parsed.door);
              if (parsed.items) setItems(parsed.items);
          }
      }
  }, []);

  // 2. Save to LocalStorage ONLY (Removed automatic URL replacement to avoid SecurityError)
  useEffect(() => {
      localStorage.setItem(STORAGE_PREFIX + 'dims', JSON.stringify(roomDims));
      localStorage.setItem(STORAGE_PREFIX + 'door', JSON.stringify(door));
      localStorage.setItem(STORAGE_PREFIX + 'items', JSON.stringify(items));
  }, [roomDims, door, items]);

  // --- Interaction State ---
  const [activeId, setActiveId] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isRotating, setIsRotating] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [isSnapped, setIsSnapped] = useState(false);
  const knobInstanceRef = useRef(null);
  const containerRef = useRef(null);
  const itemsRef = useRef(items);

  // Keep itemsRef in sync with items state
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Ignore if typing in input
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      
      // Undo/Redo
      if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if ((e.metaKey || e.ctrlKey) && (e.key === 'Z' || (e.key === 'z' && e.shiftKey))) {
        e.preventDefault();
        redo();
      }
      
      // Delete active item
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (activeId) {
          e.preventDefault();
          deleteItem(activeId);
        }
      }
      
      // Escape to deselect
      if (e.key === 'Escape') {
        setActiveId(null);
        setShowColorPicker(null);
      }
      
      // Arrow keys to move selected item
      if (activeId && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        e.preventDefault();
        const step = e.shiftKey ? 1 : 0.25; // Shift for larger steps
        const itemIndex = items.findIndex(i => i.id === activeId);
        if (itemIndex === -1) return;
        
        const item = items[itemIndex];
        let newX = item.x;
        let newY = item.y;
        
        if (e.key === 'ArrowLeft') newX -= step;
        if (e.key === 'ArrowRight') newX += step;
        if (e.key === 'ArrowUp') newY -= step;
        if (e.key === 'ArrowDown') newY += step;
        
        // Constrain to room bounds
        newX = clamp(newX, 0, roomDims.width - item.width);
        newY = clamp(newY, 0, roomDims.height - item.height);
        
        const newItems = [...items];
        newItems[itemIndex] = { ...item, x: newX, y: newY };
        setItems(newItems);
      }
      
      // R to rotate selected item
      if (e.key === 'r' && activeId) {
        e.preventDefault();
        const itemIndex = items.findIndex(i => i.id === activeId);
        if (itemIndex === -1) return;
        
        const item = items[itemIndex];
        const newItems = [...items];
        newItems[itemIndex] = { ...item, rotation: (item.rotation + 90) % 360 };
        setItems(newItems);
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeId, items, roomDims, undo, redo]);

  // Close color picker when clicking outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (showColorPicker !== null) {
        // Check if click is outside color picker
        const colorPicker = e.target.closest('[data-color-picker]');
        const colorButton = e.target.closest('[data-color-button]');
        if (!colorPicker && !colorButton) {
          setShowColorPicker(null);
        }
      }
    };
    
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showColorPicker]);

  // --- Handlers ---

  const addItem = () => {
      const newItem = {
          id: Date.now(),
          label: 'New Item',
          width: 3,
          height: 2,
          x: roomDims.width / 2 - 1.5,
          y: roomDims.height / 2 - 1,
          rotation: 0,
          color: COLORS[Math.floor(Math.random() * COLORS.length)],
          visible: true
      };
      setItems([...items, newItem]);
      saveToHistory();
      // Close sidebar on mobile after adding item
      if (isMobile) {
        setSidebarOpen(false);
      }
  };

  const deleteItem = (id) => {
      setItems(items.filter(i => i.id !== id));
      if (activeId === id) setActiveId(null);
      saveToHistory();
  };

  const toggleVisibility = (id) => {
      setItems(items.map(i => i.id === id ? { ...i, visible: !i.visible } : i));
  };
  
  const updateRoomDims = (newDims) => {
    const validWidth = Math.max(1, newDims.width || 1);
    const validHeight = Math.max(1, newDims.height || 1);
    setRoomDims({ width: validWidth, height: validHeight });
    saveToHistory();
  };
  
  const updateDoor = (newDoor) => {
    const validDoor = {
      ...newDoor,
      width: clamp(newDoor.width, 1, roomDims.width),
      position: clamp(newDoor.position, 0, Math.max(0, roomDims.width - newDoor.width))
    };
    setDoor(validDoor);
    saveToHistory();
  };

  const getShareUrl = () => {
    try {
      const config = { roomDims, door, items };
      const encoded = encodeConfig(config);
      const url = new URL(window.location.href);
      url.searchParams.set('config', encoded);
      return url.toString();
    } catch (e) {
      return "URL generation unavailable";
    }
  };

  const handleCopy = (text, type) => {
      navigator.clipboard.writeText(text);
      setCopyFeedback(type);
      setTimeout(() => setCopyFeedback(null), 2000);
  };

  const handleImport = () => {
      try {
          const parsed = JSON.parse(importText);
          if (!parsed.roomDims || !parsed.items) throw new Error("Invalid Config");
          
          setRoomDims(parsed.roomDims);
          setDoor(parsed.door || INITIAL_DOOR);
          setItems(parsed.items);
          setModalOpen(false);
          setImportText('');
          setImportError(null);
      } catch (e) {
          setImportError("Invalid JSON format. Please check your input.");
      }
  };

  const handleMouseDown = (e, id, type) => {
    e.stopPropagation();
    e.preventDefault();

    setActiveId(id);

    const clientX = e.type.startsWith('touch') ? e.touches[0].clientX : e.clientX;
    const clientY = e.type.startsWith('touch') ? e.touches[0].clientY : e.clientY;

    if (type === 'drag') {
      setIsDragging(true);
      setDragOffset({ x: clientX, y: clientY });
    } else if (type === 'rotate') {
      const item = items.find(i => i.id === id);
      if (!item) return;
      
      // Get the bounding rect of the furniture element that triggered the event
      // The event target's parent is the furniture div
      const furnitureEl = e.currentTarget.parentElement;
      if (!furnitureEl) return;
      
      const furnitureRect = furnitureEl.getBoundingClientRect();
      // The center of the furniture in screen coordinates
      const centerX = furnitureRect.left + furnitureRect.width / 2;
      const centerY = furnitureRect.top + furnitureRect.height / 2;
      
      // Create a virtual input element for Knob.js
      // Configure it for direct angle control (angle = value, 1:1 ratio)
      const virtualInput = document.createElement('input');
      virtualInput.type = 'range';
      virtualInput.min = '0';
      virtualInput.max = '360';
      virtualInput.value = String(item.rotation % 360);
      // Set angleValueRatio to 1 so angle directly maps to value
      virtualInput.setAttribute('data-angle-value-ratio', '1');
      // Increase slide sensitivity for smoother rotation
      virtualInput.setAttribute('data-angle-slide-ratio', '1.5');
      
      // Create knob instance
      const knob = new Knob(virtualInput, (knobInstance) => {
        // Negate the angle because Knob.js uses math convention (CCW positive)
        // but CSS rotation uses clockwise as positive
        const newRotation = -knobInstance.angle();
        const itemIndex = itemsRef.current.findIndex(i => i.id === id);
        if (itemIndex !== -1) {
          const newItems = [...itemsRef.current];
          newItems[itemIndex] = { ...itemsRef.current[itemIndex], rotation: newRotation };
          setItems(newItems);
          
          // Visual feedback for snap zones
          const normRot = ((newRotation % 360) + 360) % 360;
          const nearest = Math.round(normRot / 15) * 15;
          setIsSnapped(Math.abs(normRot - nearest) < 5);
        }
      });
      
      // Set up the knob's center position
      // The knob calculates center as: clientLeft + clientWidth/2
      // With clientWidth = 0, clientLeft = centerX
      knob.setDimensions(0, 0);
      knob.setPosition(centerX, centerY);
      
      // Initialize with current angle (negated to match our convention)
      knob.angle(-item.rotation);
      
      knobInstanceRef.current = knob;
      setIsRotating(true);
      
      // Start touch on the knob
      knob.doTouchStart([{ pageX: clientX, pageY: clientY }], e.timeStamp || Date.now());
    }
  };

  const handleMouseMove = useCallback((e) => {
    if (!activeId) return;
    const currentItems = itemsRef.current;
    const itemIndex = currentItems.findIndex(i => i.id === activeId);
    if (itemIndex === -1) return;
    const item = currentItems[itemIndex];
    const newItems = [...currentItems];

    const clientX = e.type.startsWith('touch') ? e.touches[0].clientX : e.clientX;
    const clientY = e.type.startsWith('touch') ? e.touches[0].clientY : e.clientY;

    if (isDragging) {
      const deltaX = (clientX - dragOffset.x) / PIXELS_PER_UNIT;
      const deltaY = (clientY - dragOffset.y) / PIXELS_PER_UNIT;
      newItems[itemIndex] = { ...item, x: item.x + deltaX, y: item.y + deltaY };
      setItems(newItems);
      setDragOffset({ x: clientX, y: clientY });
    } 
    else if (isRotating && knobInstanceRef.current) {
      // Pass the touch move event to the knob
      knobInstanceRef.current.doTouchMove([{ pageX: clientX, pageY: clientY }], e.timeStamp || Date.now());
    }
  }, [activeId, isDragging, isRotating, dragOffset]);

  const handleMouseUp = useCallback(() => {
    if (isDragging || isRotating) {
      if (isRotating && knobInstanceRef.current) {
        // End the touch on the knob
        knobInstanceRef.current.doTouchEnd(Date.now());
        
        // Snap to nearest 15 degrees on release if close
        const currentItems = itemsRef.current;
        const itemIndex = currentItems.findIndex(i => i.id === activeId);
        if (itemIndex !== -1) {
          const item = currentItems[itemIndex];
          const normRot = ((item.rotation % 360) + 360) % 360;
          const nearest = Math.round(normRot / 15) * 15;
          
          // Snap if within 5 degrees of a 15-degree increment
          if (Math.abs(normRot - nearest) < 5) {
            const fullRotations = Math.floor(item.rotation / 360);
            const snappedRotation = fullRotations * 360 + nearest;
            const newItems = [...currentItems];
            newItems[itemIndex] = { ...item, rotation: snappedRotation };
            setItems(newItems);
          }
        }
        
        knobInstanceRef.current = null;
      }
      
      // Save to history
      const config = { roomDims, door, items: itemsRef.current };
      const newHistory = history.slice(0, historyIndex + 1);
      newHistory.push(config);
      
      if (newHistory.length > MAX_HISTORY) {
        newHistory.shift();
      } else {
        setHistoryIndex(historyIndex + 1);
      }
      
      setHistory(newHistory);
    }
    setIsDragging(false);
    setIsRotating(false);
    setIsSnapped(false);
  }, [isDragging, isRotating, roomDims, door, history, historyIndex, activeId]);

  useEffect(() => {
    if (isDragging || isRotating) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
      window.addEventListener('touchmove', handleMouseMove);
      window.addEventListener('touchend', handleMouseUp);
    }
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('touchmove', handleMouseMove);
      window.removeEventListener('touchend', handleMouseUp);
    };
  }, [isDragging, isRotating, handleMouseMove, handleMouseUp]);

  // Pinch-to-zoom support
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let lastTouchDistance = null;

    const handleWheel = (e) => {
      // Check if this is a pinch gesture (ctrlKey is set for trackpad pinch on Mac)
      if (e.ctrlKey) {
        e.preventDefault();
        const delta = -e.deltaY;
        const zoomSpeed = 0.01;
        const newZoom = Math.max(0.5, Math.min(3, zoom + delta * zoomSpeed));
        setZoom(newZoom);
      }
    };

    const getTouchDistance = (touches) => {
      const dx = touches[0].clientX - touches[1].clientX;
      const dy = touches[0].clientY - touches[1].clientY;
      return Math.sqrt(dx * dx + dy * dy);
    };

    const handleTouchStart = (e) => {
      if (e.touches.length === 2) {
        lastTouchDistance = getTouchDistance(e.touches);
      }
    };

    const handleTouchMove = (e) => {
      if (e.touches.length === 2 && lastTouchDistance) {
        e.preventDefault();
        const currentDistance = getTouchDistance(e.touches);
        const delta = currentDistance - lastTouchDistance;
        const zoomSpeed = 0.005;
        const newZoom = Math.max(0.5, Math.min(3, zoom + delta * zoomSpeed));
        setZoom(newZoom);
        lastTouchDistance = currentDistance;
      }
    };

    const handleTouchEnd = (e) => {
      if (e.touches.length < 2) {
        lastTouchDistance = null;
      }
    };

    // Add passive: false to allow preventDefault for touch events
    container.addEventListener('wheel', handleWheel, { passive: false });
    container.addEventListener('touchstart', handleTouchStart, { passive: false });
    container.addEventListener('touchmove', handleTouchMove, { passive: false });
    container.addEventListener('touchend', handleTouchEnd);

    return () => {
      container.removeEventListener('wheel', handleWheel);
      container.removeEventListener('touchstart', handleTouchStart);
      container.removeEventListener('touchmove', handleTouchMove);
      container.removeEventListener('touchend', handleTouchEnd);
    };
  }, [zoom]);

  // --- Render Helpers ---

  const renderGrid = () => (
      <div className="absolute inset-0 pointer-events-none opacity-20" 
           style={{ 
             backgroundImage: `linear-gradient(#ccc 1px, transparent 1px), linear-gradient(90deg, #ccc 1px, transparent 1px)`,
             backgroundSize: `${PIXELS_PER_UNIT}px ${PIXELS_PER_UNIT}px`
           }} 
      />
  );

  const renderDoor = () => {
    const doorX = Math.min(Math.max(0, door.position), roomDims.width - door.width);
    const swingRadius = door.width * PIXELS_PER_UNIT;
    const isLeft = door.hinge === 'left';
    const isIn = door.open === 'in';

    const arcStyle = {
        position: 'absolute',
        width: swingRadius,
        height: swingRadius,
        border: '2px dashed #94a3b8', 
        opacity: 0.5,
        pointerEvents: 'none',
        borderRadius: !isLeft ? (isIn ? '100% 0 0 0' : '0 0 0 100%') : (isIn ? '0 100% 0 0' : '0 0 100% 0'),
        borderBottom: isIn ? '2px dashed #94a3b8' : 'none',
        borderTop: !isIn ? '2px dashed #94a3b8' : 'none',
        borderLeft: !isLeft ? '2px dashed #94a3b8' : 'none',
        borderRight: isLeft ? '2px dashed #94a3b8' : 'none',
        left: isLeft ? doorX * PIXELS_PER_UNIT : (doorX + door.width) * PIXELS_PER_UNIT - swingRadius,
        top: isIn ? (roomDims.height - door.width) * PIXELS_PER_UNIT : roomDims.height * PIXELS_PER_UNIT,
    };

    const panelStyle = {
        position: 'absolute',
        width: 4,
        height: swingRadius,
        backgroundColor: '#cbd5e1', 
        border: '1px solid #64748b', 
        top: isIn ? (roomDims.height - door.width) * PIXELS_PER_UNIT : roomDims.height * PIXELS_PER_UNIT,
        left: isLeft ? doorX * PIXELS_PER_UNIT : (doorX + door.width) * PIXELS_PER_UNIT - (isLeft ? 0 : 4),
    };

    return (
      <>
        <div className="absolute bg-white z-10" style={{ left: doorX * PIXELS_PER_UNIT, top: roomDims.height * PIXELS_PER_UNIT - 2, width: door.width * PIXELS_PER_UNIT, height: 4 }} />
        <div style={arcStyle} />
        <div style={panelStyle} />
      </>
    );
  };

  const fullConfigJson = JSON.stringify({ roomDims, door, items }, null, 2);
  
  const roomArea = (roomDims.width * roomDims.height).toFixed(1);

  return (
    <div className="flex flex-col h-screen bg-slate-50 text-slate-800 font-sans overflow-hidden">
      
      {/* Header */}
      <div className="bg-white border-b border-slate-200 px-4 py-2 flex justify-between items-center shadow-sm relative z-50 h-16">
        <div className="flex items-center gap-2">
            <button 
                onClick={() => {
                  setSidebarOpen(!sidebarOpen);
                  // Clear active item when opening sidebar on mobile to prevent overlap
                  if (!sidebarOpen && isMobile) {
                    setActiveId(null);
                  }
                }}
                className="hidden md:flex p-2 hover:bg-slate-100 rounded-lg text-slate-500 mr-2 transition-colors"
                aria-label={sidebarOpen ? "Close sidebar" : "Open sidebar"}
            >
                {sidebarOpen ? <ChevronLeft className="w-5 h-5" /> : <ChevronRight className="w-5 h-5" />}
            </button>
            
            <Settings className="w-6 h-6 text-indigo-600" />
            <h1 className="text-lg font-bold text-slate-800 hidden sm:block">Room Planner</h1>
            <div className="flex items-center gap-1 ml-2 text-[11px] text-slate-500 bg-slate-50 px-2 py-1 rounded">
              <Maximize2 className="w-3 h-3" />
              <span>{formatDimension(roomDims.width)} × {formatDimension(roomDims.height)}<span className="hidden lg:inline"> ({roomArea} sq ft)</span></span>
            </div>
        </div>
        
        <div className="flex items-center gap-2 sm:gap-4">
          {/* Undo/Redo */}
          <div className="flex items-center gap-1">
            <Tooltip text="Undo">
              <button 
                onClick={undo}
                disabled={historyIndex <= 0}
                className="p-2 hover:bg-slate-100 rounded-lg text-slate-500 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                aria-label="Undo"
              >
                <Undo2 className="w-4 h-4" />
              </button>
            </Tooltip>
            <Tooltip text="Redo">
              <button 
                onClick={redo}
                disabled={historyIndex >= history.length - 1}
                className="p-2 hover:bg-slate-100 rounded-lg text-slate-500 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                aria-label="Redo"
              >
                <Redo2 className="w-4 h-4" />
              </button>
            </Tooltip>
          </div>

          {/* Zoom Controls */}
          <div className="hidden sm:flex items-center gap-1 bg-slate-50 rounded-lg px-2 py-1">
            <Tooltip text="Zoom out">
              <button 
                onClick={() => setZoom(Math.max(0.5, zoom - 0.25))}
                disabled={zoom <= 0.5}
                className="p-1.5 hover:bg-slate-200 rounded text-slate-600 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                aria-label="Zoom out"
              >
                <ZoomOut className="w-4 h-4" />
              </button>
            </Tooltip>
            <span className="text-xs font-medium text-slate-600 min-w-[3rem] text-center">{Math.round(zoom * 100)}%</span>
            <Tooltip text="Zoom in">
              <button 
                onClick={() => setZoom(Math.min(3, zoom + 0.25))}
                disabled={zoom >= 3}
                className="p-1.5 hover:bg-slate-200 rounded text-slate-600 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                aria-label="Zoom in"
              >
                <ZoomIn className="w-4 h-4" />
              </button>
            </Tooltip>
          </div>

          <button 
            onClick={() => setModalOpen(true)}
            className="flex items-center gap-2 px-3 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs sm:text-sm font-medium transition-colors shadow-sm"
            aria-label="Share and save layout"
          >
            <Share2 className="w-4 h-4" />
            <span className="hidden sm:inline">Share / Save</span>
          </button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden relative">
        
        {/* Mobile backdrop overlay */}
        {sidebarOpen && (
          <div 
            className="fixed top-16 bottom-0 left-0 right-0 bg-slate-900/50 z-40 md:hidden animate-fade-in"
            onClick={() => setSidebarOpen(false)}
            aria-hidden="true"
          />
        )}

        {/* Sidebar - Full screen on mobile, side panel on desktop */}
        <div 
            className={`fixed md:relative top-16 md:top-auto bottom-0 md:bottom-auto left-0 right-0 md:inset-auto z-[45] bg-white md:border-r border-slate-200 overflow-y-auto overflow-x-hidden scrollbar-thin scrollbar-thumb-slate-300 scrollbar-track-transparent hover:scrollbar-thumb-slate-400 transition-all duration-300 flex flex-col shadow-xl md:shadow-none
            ${sidebarOpen ? 'md:w-80 translate-x-0' : 'md:w-0 -translate-x-full md:opacity-0 md:overflow-hidden'}`}
        >
          {/* Mobile header for sidebar */}
          <div className="md:hidden bg-white px-4 py-4 flex justify-between items-center sticky top-0 z-10 border-b border-slate-200">
            <h2 className="font-bold text-slate-800 text-base">Settings</h2>
            <button 
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setSidebarOpen(false);
              }}
              className="flex items-center gap-1 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-medium transition-colors active:scale-95"
              aria-label="Done editing"
              type="button"
            >
              <Check className="w-4 h-4" />
              <span>Done</span>
            </button>
          </div>

          <div className="bg-slate-50 p-3 text-xs text-slate-600 border-b border-slate-100 flex gap-2 items-center">
            <Info className="w-4 h-4 shrink-0 text-slate-400" />
            <p>Accepts feet, inches, or decimals (e.g., <strong>12'6"</strong>, <strong>150"</strong>, <strong>12.5</strong>)</p>
          </div>

          <div className="p-6 space-y-8 min-w-0 md:min-w-[20rem]">
            <section>
              <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-4">Room Dimensions</h2>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium mb-1">Width</label>
                  <DimensionInput 
                    value={roomDims.width} 
                    onChange={(val) => updateRoomDims({...roomDims, width: val})}
                    className="w-full p-2 border border-slate-200 rounded focus:ring-2 focus:ring-indigo-500 outline-none"
                    placeholder='e.g. 12'
                    min={1}
                    max={100}
                    label="Room width"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">Length</label>
                  <DimensionInput 
                    value={roomDims.height} 
                    onChange={(val) => updateRoomDims({...roomDims, height: val})}
                    className="w-full p-2 border border-slate-200 rounded focus:ring-2 focus:ring-indigo-500 outline-none"
                    placeholder='e.g. 12'
                    min={1}
                    max={100}
                    label="Room length"
                  />
                </div>
              </div>
              <div className="mt-2 text-xs text-slate-500">
                Total area: <strong>{roomArea} sq ft</strong>
              </div>
            </section>

            <section>
              <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-4">Door (Bottom Wall)</h2>
              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-medium mb-1">Width</label>
                  <DimensionInput 
                    value={door.width} 
                    onChange={(val) => updateDoor({...door, width: val})}
                    className="w-full p-2 border border-slate-200 rounded focus:ring-2 focus:ring-indigo-500 outline-none"
                    min={1}
                    max={roomDims.width}
                    label="Door width"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">Position</label>
                  <div className="flex gap-2 items-center">
                    <input 
                        type="range" 
                        min={0} 
                        max={Math.max(0, roomDims.width - door.width)} 
                        step={0.1}
                        value={door.position} 
                        onChange={(e) => updateDoor({...door, position: Number(e.target.value)})}
                        className="flex-1 h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer"
                        aria-label="Door position"
                    />
                    <div className="w-16">
                        <DimensionInput 
                            value={door.position}
                            onChange={(val) => updateDoor({...door, position: val})}
                            className="w-full p-1 text-center text-xs border border-slate-200 rounded"
                            max={Math.max(0, roomDims.width - door.width)}
                            label="Door position value"
                        />
                    </div>
                  </div>
                </div>
                
                <div className="flex gap-2">
                    <Tooltip text="Switch hinge side">
                      <button 
                        onClick={() => updateDoor({...door, hinge: door.hinge === 'left' ? 'right' : 'left'})} 
                        className="flex-1 py-1.5 px-2 bg-slate-100 hover:bg-slate-200 rounded text-xs font-medium text-slate-600 flex items-center justify-center gap-1 transition-colors"
                        aria-label="Flip door hinge"
                      >
                          <ArrowLeftRight className="w-3 h-3" /> Flip Hinge
                      </button>
                    </Tooltip>
                    <Tooltip text="Switch swing direction">
                      <button 
                        onClick={() => updateDoor({...door, open: door.open === 'in' ? 'out' : 'in'})} 
                        className="flex-1 py-1.5 px-2 bg-slate-100 hover:bg-slate-200 rounded text-xs font-medium text-slate-600 flex items-center justify-center gap-1 transition-colors"
                        aria-label="Flip door swing"
                      >
                          <ArrowUpDown className="w-3 h-3" /> Flip Swing
                      </button>
                    </Tooltip>
                </div>
              </div>
            </section>

            <section>
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Furniture</h2>
                <button 
                    onClick={addItem}
                    className="flex items-center gap-1 text-xs bg-indigo-50 text-indigo-600 hover:bg-indigo-100 px-2 py-1 rounded font-medium transition-colors"
                    aria-label="Add new furniture item"
                >
                    <Plus className="w-3 h-3" /> Add Item
                </button>
              </div>

              <div className="space-y-4">
                {items.map((item) => (
                  <div key={item.id} className={`p-3 bg-slate-50 rounded-lg border transition-all duration-200 ${item.visible === false ? 'opacity-60 border-dashed' : 'border-slate-100'} ${activeId === item.id ? 'ring-2 ring-indigo-500' : ''}`}>
                    <div className="flex justify-between items-center mb-2">
                      <div className="flex items-center gap-2 flex-1 relative">
                        <button
                          onClick={() => setShowColorPicker(showColorPicker === item.id ? null : item.id)}
                          className={`w-6 h-6 rounded-full ${item.color.split(' ')[0]} border-2 border-slate-300 hover:border-indigo-500 transition-colors cursor-pointer shrink-0`}
                          aria-label="Change item color"
                          data-color-button
                        />
                        {!isMobile && showColorPicker === item.id && (
                          <ColorPicker
                            currentColor={item.color}
                            onChange={(color) => {
                              setItems(items.map(i => i.id === item.id ? { ...i, color } : i));
                              saveToHistory();
                            }}
                            onClose={() => setShowColorPicker(null)}
                            isMobile={false}
                          />
                        )}
                        <input 
                            value={item.label}
                            onChange={(e) => setItems(items.map(i => i.id === item.id ? { ...i, label: e.target.value } : i))}
                            onBlur={saveToHistory}
                            className="bg-transparent font-medium text-slate-700 border-b border-transparent hover:border-slate-300 focus:border-indigo-500 outline-none flex-1 text-sm"
                            aria-label="Item label"
                        />
                      </div>
                      <div className="flex items-center gap-1">
                        <Tooltip text={item.visible !== false ? "Hide item" : "Show item"}>
                          <button 
                              onClick={() => toggleVisibility(item.id)}
                              className="p-1 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded transition-colors"
                          >
                              {item.visible !== false ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                          </button>
                        </Tooltip>
                        <Tooltip text="Delete item (Del)">
                          <button 
                              onClick={() => deleteItem(item.id)}
                              className="p-1 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                          >
                              <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </Tooltip>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-[10px] text-slate-500">Width</label>
                        <DimensionInput 
                          value={item.width}
                          onChange={(val) => {
                            setItems(items.map(i => i.id === item.id ? { ...i, width: val } : i));
                            saveToHistory();
                          }}
                          className="w-full p-1 text-xs border border-slate-200 rounded"
                          min={0.1}
                          max={roomDims.width}
                          label={`Width of ${item.label}`}
                        />
                      </div>
                      <div>
                        <label className="text-[10px] text-slate-500">Depth</label>
                        <DimensionInput 
                          value={item.height}
                          onChange={(val) => {
                            setItems(items.map(i => i.id === item.id ? { ...i, height: val } : i));
                            saveToHistory();
                          }}
                          className="w-full p-1 text-xs border border-slate-200 rounded"
                          min={0.1}
                          max={roomDims.height}
                          label={`Depth of ${item.label}`}
                        />
                      </div>
                    </div>
                    <div className="mt-2 text-[10px] text-slate-400 flex justify-between">
                      <span>Position: {formatDimension(item.x)}, {formatDimension(item.y)}</span>
                      <span>Rotation: {Math.round(item.rotation)}°</span>
                    </div>
                  </div>
                ))}
                {items.length === 0 && (
                    <div className="text-center py-8 text-slate-400 text-xs italic border-2 border-dashed border-slate-100 rounded-lg">
                        No furniture added. Click "Add Item" to start.
                    </div>
                )}
              </div>
            </section>
          </div>
        </div>

        {/* Floating Action Button for Mobile */}
        {!sidebarOpen && isMobile && (
          <button
            onClick={() => {
              setSidebarOpen(true);
              setActiveId(null);
            }}
            className="fixed bottom-6 right-6 z-40 bg-indigo-600 hover:bg-indigo-700 text-white rounded-full p-4 shadow-lg flex items-center justify-center transition-all active:scale-95 animate-fade-in"
            aria-label="Edit room settings"
          >
            <Settings className="w-6 h-6" />
          </button>
        )}

        {/* Canvas */}
        <div 
          className="flex-1 bg-slate-100 overflow-auto flex items-center justify-center p-4 md:p-8 relative w-full"
          ref={containerRef}
        >
          {/* Instruction badge - subtle hint that fades out */}
          {!(isMobile && sidebarOpen) && (
            <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-slate-800/80 text-white px-4 py-2 rounded-full shadow-lg text-xs z-20 pointer-events-none animate-fade-in backdrop-blur-sm">
              <span className="hidden sm:inline">Drag items to move • Use handle to rotate</span>
              <span className="sm:hidden">Drag to move • Tap to select</span>
            </div>
          )}

          <div 
            className="bg-white shadow-2xl relative transition-all duration-500 ease-in-out"
            style={{
              width: roomDims.width * PIXELS_PER_UNIT,
              height: roomDims.height * PIXELS_PER_UNIT,
              border: '4px solid #334155',
              transform: `scale(${zoom})`,
              transformOrigin: 'center'
            }}
          >
            {renderGrid()}
            {renderDoor()}

            {items.filter(i => i.visible !== false).map((item) => {
              const isActive = activeId === item.id;
              
              return (
                <div
                  key={item.id}
                  onMouseDown={(e) => handleMouseDown(e, item.id, 'drag')}
                  onTouchStart={(e) => handleMouseDown(e, item.id, 'drag')}
                  onClick={() => setActiveId(item.id)}
                  className={`absolute flex items-center justify-center text-xs font-bold text-slate-700 select-none cursor-grab active:cursor-grabbing transition-shadow ${item.color}`}
                  style={{
                    width: item.width * PIXELS_PER_UNIT,
                    height: item.height * PIXELS_PER_UNIT,
                    transform: `translate(${item.x * PIXELS_PER_UNIT}px, ${item.y * PIXELS_PER_UNIT}px) rotate(${item.rotation}deg)`,
                    borderWidth: '2px',
                    zIndex: isActive ? 50 : 10,
                    boxShadow: isActive ? '0 8px 20px -4px rgba(0, 0, 0, 0.15)' : '0 1px 3px rgba(0, 0, 0, 0.08)',
                    touchAction: 'none'
                  }}
                  role="button"
                  tabIndex={0}
                  aria-label={`${item.label}, ${formatDimension(item.width)} by ${formatDimension(item.height)}`}
                >
                  <span className="truncate px-1">{item.label}</span>
                  {isActive && (
                    <div 
                       onMouseDown={(e) => handleMouseDown(e, item.id, 'rotate')}
                       onTouchStart={(e) => handleMouseDown(e, item.id, 'rotate')}
                       className={`absolute -top-8 left-1/2 -translate-x-1/2 w-8 h-8 md:w-6 md:h-6 bg-white border-2 rounded-full flex items-center justify-center cursor-crosshair hover:scale-110 transition-all z-50 shadow-md
                       ${isRotating && isSnapped ? 'border-emerald-500' : 'border-indigo-500'}`}
                       style={{ touchAction: 'none' }}
                       aria-label="Rotate handle"
                    >
                       <RotateCw className={`w-4 h-4 md:w-3 md:h-3 ${isRotating && isSnapped ? 'text-emerald-600' : 'text-indigo-500'}`} />
                    </div>
                  )}
                  
                  {isActive && (
                      <div className={`absolute -top-8 left-1/2 h-8 w-0.5 -z-10 origin-bottom transition-colors
                      ${isRotating && isSnapped ? 'bg-emerald-500' : 'bg-indigo-500'}`}></div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Import/Export Modal */}
      <Modal isOpen={modalOpen} onClose={() => setModalOpen(false)} title="Share & Save Layout">
          <div className="space-y-6">
              
              {/* URL Share Section */}
              <div>
                  <label className="text-sm font-medium text-slate-700 mb-2 flex items-center gap-2">
                      <Share2 className="w-4 h-4" /> Direct Link
                  </label>
                  <div className="flex gap-2">
                      <input 
                        readOnly 
                        value={getShareUrl()} 
                        className="flex-1 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs text-slate-600 font-mono truncate select-all"
                      />
                      <button 
                        onClick={() => handleCopy(getShareUrl(), 'url')}
                        className="px-3 py-2 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg text-slate-600 transition-colors"
                      >
                        {copyFeedback === 'url' ? <Check className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4" />}
                      </button>
                  </div>
                  {window.location.protocol === 'blob:' && (
                    <p className="text-[10px] text-amber-600 mt-1">
                      Note: URL sharing may not persist in this preview. Use JSON config below for backup.
                    </p>
                  )}
              </div>

              <div className="border-t border-slate-100 my-4"></div>

              {/* JSON Import/Export Section */}
              <div>
                  <div className="flex justify-between items-end mb-2">
                      <label className="text-sm font-medium text-slate-700 flex items-center gap-2">
                          <Download className="w-4 h-4" /> Layout Config (JSON)
                      </label>
                      <button 
                        onClick={() => handleCopy(fullConfigJson, 'json')}
                        className="text-xs text-indigo-600 hover:text-indigo-800 font-medium flex items-center gap-1"
                      >
                        {copyFeedback === 'json' ? <span className="text-green-600 flex items-center gap-1"><Check className="w-3 h-3"/> Copied</span> : 'Copy JSON'}
                      </button>
                  </div>
                  
                  {/* Export Area */}
                  <textarea 
                    readOnly
                    value={fullConfigJson}
                    className="w-full h-24 bg-slate-50 border border-slate-200 rounded-lg p-2 text-[10px] text-slate-600 font-mono mb-4"
                  />

                  {/* Import Area */}
                  <label className="text-sm font-medium text-slate-700 mb-2 flex items-center gap-2">
                      <Upload className="w-4 h-4" /> Import Config
                  </label>
                  <textarea 
                    placeholder="Paste your JSON config here..."
                    value={importText}
                    onChange={(e) => setImportText(e.target.value)}
                    className="w-full h-24 bg-white border border-slate-300 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500 rounded-lg p-2 text-xs font-mono mb-2 outline-none"
                  />
                  
                  {importError && <p className="text-xs text-red-500 mb-2">{importError}</p>}

                  <button 
                    onClick={handleImport}
                    disabled={!importText}
                    className="w-full py-2 bg-slate-800 hover:bg-slate-900 text-white rounded-lg text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    Load Configuration
                  </button>
              </div>

          </div>
      </Modal>

      {/* Color Picker Modal - Rendered at root level for mobile only */}
      {isMobile && showColorPicker !== null && (() => {
        const currentItem = items.find(i => i.id === showColorPicker);
        if (!currentItem) return null;
        return (
          <ColorPicker
            currentColor={currentItem.color}
            onChange={(color) => {
              setItems(items.map(i => i.id === showColorPicker ? { ...i, color } : i));
              saveToHistory();
            }}
            onClose={() => setShowColorPicker(null)}
            isMobile={true}
          />
        );
      })()}

    </div>
  );
}
