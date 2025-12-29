import React, { useState, useRef, useEffect, useCallback } from 'react';
import ReactDOM from 'react-dom';
import { Move, RotateCw, Lock, Unlock, RotateCcw, Info, ArrowLeftRight, ArrowUpDown, ChevronLeft, ChevronRight, Share2, X, Copy, Check, Download, Upload, Plus, Trash2, Eye, EyeOff, Undo2, Redo2, Maximize2, Palette, ZoomIn, ZoomOut, Home, Sofa, ArrowRight, ChevronDown, ChevronUp, FolderOpen, FileText, Edit3, Copy as CopyIcon, MoreVertical, CheckSquare, Square, FileDown, FileUp, AlertTriangle, Scan } from 'lucide-react';
import Knob from './Knob';

// Constants
const PIXELS_PER_UNIT = 40;
const STORAGE_PREFIX = 'room-sim-v3-';
const PROJECTS_STORAGE_KEY = 'room-planner-projects'; 

const INITIAL_ROOM = { width: 12, height: 12 };

// Door types: 'swing-in', 'swing-out', 'sliding'
const INITIAL_DOORS = [
  { id: 1, width: 3, position: 6, wall: 'bottom', hinge: 'left', type: 'swing-in' }
];

const INITIAL_WINDOWS = [
  { id: 1, width: 4, position: 4, wall: 'top' }
];

const WALL_OPTIONS = ['top', 'right', 'bottom', 'left'];
const DOOR_TYPES = [
  { value: 'swing-in', label: 'Swing In' },
  { value: 'swing-out', label: 'Swing Out' },
  { value: 'sliding', label: 'Sliding' }
];

// Unit system - internal storage is always in feet
const UNIT_SYSTEMS = [
  { value: 'ft-in', label: "Feet & Inches (6'3\")" },
  { value: 'ft', label: 'Decimal Feet (6.25 ft)' },
  { value: 'in', label: 'Inches (75 in)' },
  { value: 'm', label: 'Meters (1.9 m)' },
  { value: 'cm', label: 'Centimeters (190 cm)' },
];

// Conversion factors (to feet)
const FEET_PER_METER = 3.28084;
const FEET_PER_CM = 0.0328084;
const FEET_PER_INCH = 1/12;

const INITIAL_ITEMS = [
  { id: 1, label: 'Bed', width: 6, height: 4, x: 2, y: 2, rotation: 0, color: '#93c5fd', visible: true },
  { id: 2, label: 'Desk', width: 4, height: 2, x: 9, y: 2, rotation: 0, color: '#6ee7b7', visible: true },
  { id: 3, label: 'Wardrobe', width: 3, height: 2, x: 2, y: 8, rotation: 0, color: '#fcd34d', visible: true },
  { id: 4, label: 'Rug', width: 5, height: 8, x: 6, y: 5, rotation: 0, color: '#fecaca', visible: true },
];

// Color presets - stored as hex for standardized sharing
const COLOR_PRESETS = [
  { name: 'Blue', hex: '#93c5fd', border: '#3b82f6' },
  { name: 'Green', hex: '#6ee7b7', border: '#10b981' },
  { name: 'Yellow', hex: '#fcd34d', border: '#f59e0b' },
  { name: 'Red', hex: '#fecaca', border: '#ef4444' },
  { name: 'Indigo', hex: '#a5b4fc', border: '#6366f1' },
  { name: 'Cyan', hex: '#67e8f9', border: '#06b6d4' },
  { name: 'Purple', hex: '#d8b4fe', border: '#a855f7' },
  { name: 'Orange', hex: '#fdba74', border: '#f97316' },
  { name: 'Lime', hex: '#bef264', border: '#84cc16' },
  { name: 'Pink', hex: '#f9a8d4', border: '#ec4899' },
];

// Helper to get border color from a hex (darken it)
const getBorderColor = (hex) => {
  // Check if it's a preset
  const preset = COLOR_PRESETS.find(p => p.hex === hex);
  if (preset) return preset.border;
  
  // For custom colors, darken by 20%
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const darken = (v) => Math.max(0, Math.floor(v * 0.7));
  return `#${darken(r).toString(16).padStart(2, '0')}${darken(g).toString(16).padStart(2, '0')}${darken(b).toString(16).padStart(2, '0')}`;
};

// Legacy color migration - convert old Tailwind classes to hex
const migrateColor = (color) => {
  if (color.startsWith('#')) return color;
  // Map old Tailwind classes to hex
  const legacyMap = {
    'bg-blue-200 border-blue-400': '#93c5fd',
    'bg-emerald-200 border-emerald-400': '#6ee7b7',
    'bg-amber-200 border-amber-400': '#fcd34d',
    'bg-rose-200 border-rose-400': '#fecaca',
    'bg-rose-100 border-rose-300': '#fecaca',
    'bg-indigo-200 border-indigo-400': '#a5b4fc',
    'bg-cyan-200 border-cyan-400': '#67e8f9',
    'bg-purple-200 border-purple-400': '#d8b4fe',
    'bg-orange-200 border-orange-400': '#fdba74',
    'bg-lime-200 border-lime-400': '#bef264',
    'bg-fuchsia-200 border-fuchsia-400': '#f9a8d4',
  };
  return legacyMap[color] || '#93c5fd';
};

const MAX_HISTORY = 50;

// Design modes
const DESIGN_MODES = {
  ROOM_SETUP: 'room-setup',
  FURNITURE: 'furniture'
};

// --- Helpers ---

// Parse any input to feet (internal unit)
const parseToFeet = (input, unitSystem = 'ft-in') => {
  if (!input && input !== 0) return 0;
  const str = String(input).trim().toLowerCase();
  
  // Handle explicit unit markers first (these override the unitSystem)
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
  if (str.endsWith('m') && !str.endsWith('cm')) {
    return parseFloat(str.replace(/m/g, '')) * FEET_PER_METER;
  }
  if (str.endsWith('cm')) {
    return parseFloat(str.replace(/cm/g, '')) * FEET_PER_CM;
  }
  
  // Plain number - interpret based on current unit system
  const num = parseFloat(str) || 0;
  switch (unitSystem) {
    case 'ft-in':
    case 'ft':
      return num;
    case 'in':
      return num * FEET_PER_INCH;
    case 'm':
      return num * FEET_PER_METER;
    case 'cm':
      return num * FEET_PER_CM;
    default:
      return num;
  }
};

// Convert feet to display value based on unit system
const feetToDisplay = (feet, unitSystem = 'ft-in') => {
  if (!feet && feet !== 0) return '0';
  
  switch (unitSystem) {
    case 'ft-in': {
      const wholeFeet = Math.floor(feet);
      const inches = Math.round((feet - wholeFeet) * 12);
      if (inches === 12) return `${wholeFeet + 1}'`;
      if (inches === 0) return `${wholeFeet}'`;
      if (wholeFeet === 0) return `${inches}"`;
      return `${wholeFeet}'${inches}"`;
    }
    case 'ft':
      return `${roundNum(feet, 2)} ft`;
    case 'in':
      return `${roundNum(feet * 12, 1)} in`;
    case 'm':
      return `${roundNum(feet / FEET_PER_METER, 2)} m`;
    case 'cm':
      return `${roundNum(feet / FEET_PER_CM, 1)} cm`;
    default:
      return `${roundNum(feet, 2)}'`;
  }
};

// Convert feet to raw numeric value in target unit system (for export)
const feetToUnitValue = (feet, unitSystem = 'ft-in') => {
  if (!feet && feet !== 0) return 0;
  
  switch (unitSystem) {
    case 'ft-in': // Store as decimal feet for ft-in to preserve precision
    case 'ft':
      return roundNum(feet, 6);
    case 'in':
      return roundNum(feet * 12, 4);
    case 'm':
      return roundNum(feet / FEET_PER_METER, 6);
    case 'cm':
      return roundNum(feet / FEET_PER_CM, 4);
    default:
      return roundNum(feet, 6);
  }
};

// Convert raw numeric value from source unit system to feet (for import)
const unitValueToFeet = (value, unitSystem = 'ft-in') => {
  if (!value && value !== 0) return 0;
  
  switch (unitSystem) {
    case 'ft-in':
    case 'ft':
      return value;
    case 'in':
      return value / 12;
    case 'm':
      return value * FEET_PER_METER;
    case 'cm':
      return value * FEET_PER_CM;
    default:
      return value;
  }
};

// Round a number to specified decimal places
const roundNum = (num, decimals = 2) => {
  const factor = Math.pow(10, decimals);
  return Math.round(num * factor) / factor;
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

// Format time ago string
const formatTimeAgo = (date) => {
  if (!date) return '';
  const seconds = Math.floor((new Date() - date) / 1000);
  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return date.toLocaleDateString();
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

const DimensionInput = ({ value, onChange, className, placeholder, min = 0, max = 1000, label, unitSystem = 'ft-in' }) => {
  const [localVal, setLocalVal] = useState('');
  const [isFocused, setIsFocused] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isFocused && typeof value === 'number') {
      // Always update display when value or unitSystem changes
      setLocalVal(getDisplayValue(value, unitSystem));
    }
  }, [value, isFocused, unitSystem]);

  const getDisplayValue = (feet, unit) => {
    switch (unit) {
      case 'ft-in': {
        const wholeFeet = Math.floor(feet);
        const inches = Math.round((feet - wholeFeet) * 12);
        if (inches === 12) return `${wholeFeet + 1}'`;
        if (inches === 0) return `${wholeFeet}'`;
        if (wholeFeet === 0) return `${inches}"`;
        return `${wholeFeet}'${inches}"`;
      }
      case 'ft':
        return roundNum(feet, 2).toString();
      case 'in':
        return roundNum(feet * 12, 1).toString();
      case 'm':
        return roundNum(feet / FEET_PER_METER, 2).toString();
      case 'cm':
        return roundNum(feet / FEET_PER_CM, 1).toString();
      default:
        return roundNum(feet, 2).toString();
    }
  };

  const commitValue = () => {
    setIsFocused(false);
    const feet = parseToFeet(localVal, unitSystem);
    
    if (feet < min) {
      setError(`Min: ${feetToDisplay(min, unitSystem)}`);
      setLocalVal(getDisplayValue(min, unitSystem));
      onChange(min);
      setTimeout(() => setError(''), 3000);
      return;
    }
    
    if (feet > max) {
      setError(`Max: ${feetToDisplay(max, unitSystem)}`);
      setLocalVal(getDisplayValue(max, unitSystem));
      onChange(max);
      setTimeout(() => setError(''), 3000);
      return;
    }
    
    setError('');
    // Always update display to show converted value in current unit system
    setLocalVal(getDisplayValue(feet, unitSystem));
    onChange(feet);
  };

  // Get unit suffix for display (only for units that need it)
  const getUnitSuffix = () => {
    switch (unitSystem) {
      case 'ft-in': return null; // Already shown in value like 6'3"
      case 'ft': return 'ft';
      case 'in': return 'in';
      case 'm': return 'm';
      case 'cm': return 'cm';
      default: return null;
    }
  };
  
  const unitSuffix = getUnitSuffix();

  return (
    <div className="relative w-full">
      <div className="relative flex items-center">
        <input
          type="text"
          value={localVal}
          onChange={(e) => setLocalVal(e.target.value)}
          onFocus={() => setIsFocused(true)}
          onBlur={commitValue}
          onKeyDown={(e) => e.key === 'Enter' && e.target.blur()}
          className={`${className} ${error ? 'border-red-400 focus:ring-red-500' : ''} ${unitSuffix ? 'pr-7' : ''} flex-1`}
          placeholder={placeholder}
          aria-label={label || placeholder}
        />
        {unitSuffix && (
          <span className="absolute right-1.5 text-[10px] text-slate-400 pointer-events-none select-none bg-white px-0.5">
            {unitSuffix}
          </span>
        )}
      </div>
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

const ColorPicker = ({ currentColor, onChange, onClose, isMobile = false, triggerRef }) => {
  const [showCustom, setShowCustom] = useState(false);
  const [customHex, setCustomHex] = useState(currentColor.startsWith('#') ? currentColor : '#93c5fd');
  const [hexError, setHexError] = useState('');
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const pickerRef = useRef(null);
  
  const isValidHex = (hex) => /^#[0-9A-Fa-f]{6}$/.test(hex);
  
  // Position the picker relative to the trigger button
  useEffect(() => {
    if (!isMobile && triggerRef?.current) {
      const updatePosition = () => {
        const rect = triggerRef.current.getBoundingClientRect();
        const pickerWidth = 220;
        const pickerHeight = 280;
        
        let top = rect.bottom + 4;
        let left = rect.left;
        
        // Ensure it doesn't go off the right edge
        if (left + pickerWidth > window.innerWidth - 8) {
          left = window.innerWidth - pickerWidth - 8;
        }
        
        // Ensure it doesn't go off the bottom edge
        if (top + pickerHeight > window.innerHeight - 8) {
          top = rect.top - pickerHeight - 4;
        }
        
        // Ensure it doesn't go off the left edge
        if (left < 8) left = 8;
        
        setPosition({ top, left });
      };
      
      updatePosition();
      window.addEventListener('scroll', updatePosition, true);
      window.addEventListener('resize', updatePosition);
      
      return () => {
        window.removeEventListener('scroll', updatePosition, true);
        window.removeEventListener('resize', updatePosition);
      };
    }
  }, [isMobile, triggerRef]);
  
  const handleCustomSubmit = () => {
    if (isValidHex(customHex)) {
      onChange(customHex);
      onClose();
    } else {
      setHexError('Invalid hex code');
      setTimeout(() => setHexError(''), 2000);
    }
  };
  
  const isCurrentPreset = COLOR_PRESETS.some(p => p.hex === currentColor);
  
  const content = (
    <>
      <div className="flex justify-between items-center mb-3">
        <h3 className="font-semibold text-slate-800 text-sm">Choose Color</h3>
        {isMobile && (
          <button 
            onClick={onClose}
            className="p-1 hover:bg-slate-100 rounded-full transition-colors"
            aria-label="Close color picker"
          >
            <X className="w-5 h-5 text-slate-500" />
          </button>
        )}
      </div>
      
      {/* Preset Colors */}
      <div className="grid grid-cols-5 gap-2 mb-3">
        {COLOR_PRESETS.map((preset) => (
          <button
            key={preset.hex}
            onClick={() => {
              onChange(preset.hex);
              onClose();
            }}
            className={`${isMobile ? 'w-10 h-10' : 'w-7 h-7'} rounded-full border-2 transition-all hover:scale-110 active:scale-95`}
            style={{ 
              backgroundColor: preset.hex, 
              borderColor: preset.border 
            }}
            title={preset.name}
            aria-label={`Select ${preset.name}`}
          >
            {currentColor === preset.hex && (
              <Check className={`${isMobile ? 'w-5 h-5' : 'w-4 h-4'} mx-auto text-slate-700`} />
            )}
          </button>
        ))}
      </div>
      
      {/* Custom Color Section */}
      <div className="border-t border-slate-200 pt-3">
        {!showCustom ? (
          <button
            onClick={() => setShowCustom(true)}
            className="w-full flex items-center justify-center gap-2 py-2 text-xs text-slate-600 hover:text-slate-800 hover:bg-slate-50 rounded transition-colors"
          >
            <Palette className="w-3.5 h-3.5" />
            Custom Color {!isCurrentPreset && currentColor.startsWith('#') && `(${currentColor})`}
          </button>
        ) : (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <label 
                className="w-8 h-8 rounded-lg border-2 border-slate-300 shrink-0 cursor-pointer shadow-sm hover:border-slate-400 hover:shadow transition-all relative overflow-hidden"
                style={{ backgroundColor: isValidHex(customHex) ? customHex : '#fff' }}
                title="Click to open color picker"
              >
                <input
                  type="color"
                  value={isValidHex(customHex) ? customHex : '#93c5fd'}
                  onChange={(e) => {
                    setCustomHex(e.target.value);
                    setHexError('');
                  }}
                  className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                />
              </label>
              <input
                type="text"
                value={customHex}
                onChange={(e) => {
                  let val = e.target.value;
                  if (!val.startsWith('#')) val = '#' + val;
                  setCustomHex(val.slice(0, 7));
                  setHexError('');
                }}
                onKeyDown={(e) => e.key === 'Enter' && handleCustomSubmit()}
                placeholder="#93c5fd"
                className={`flex-1 px-2 py-1 text-xs font-mono border rounded ${hexError ? 'border-red-400' : 'border-slate-200'} focus:outline-none focus:ring-1 focus:ring-indigo-500`}
              />
            </div>
            {hexError && <p className="text-[10px] text-red-500">{hexError}</p>}
            <div className="flex gap-2">
              <button
                onClick={() => setShowCustom(false)}
                className="flex-1 py-1.5 text-xs text-slate-600 hover:bg-slate-100 rounded transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleCustomSubmit}
                className="flex-1 py-1.5 text-xs bg-indigo-600 hover:bg-indigo-700 text-white rounded transition-colors"
              >
                Apply
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );

  if (isMobile) {
    return (
      <div 
        className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-slate-900/50 backdrop-blur-sm animate-fade-in"
        onClick={onClose}
      >
        <div 
          className="bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl w-full sm:w-auto sm:min-w-[280px] p-4 animate-slide-up"
          onClick={(e) => e.stopPropagation()}
          data-color-picker
        >
          {content}
        </div>
      </div>
    );
  }

  // Desktop: render via portal to avoid z-index/overflow issues
  return ReactDOM.createPortal(
    <div 
      ref={pickerRef}
      className="fixed bg-white rounded-lg shadow-xl border border-slate-200 p-3 z-[9999] min-w-[200px] animate-fade-in"
      style={{ top: position.top, left: position.left }}
      data-color-picker
      onClick={(e) => e.stopPropagation()}
    >
      {content}
    </div>,
    document.body
  );
};

const Tooltip = ({ children, text }) => {
  const [show, setShow] = useState(false);
  const [tooltipStyle, setTooltipStyle] = useState({});
  const [arrowStyle, setArrowStyle] = useState({});
  const [position, setPosition] = useState('top');
  const triggerRef = useRef(null);
  
  const handleMouseEnter = () => {
    if (triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      const tooltipHeight = 32;
      const tooltipWidth = text.length * 7 + 16; // Rough estimate
      const padding = 8;
      
      // Determine vertical position
      let vertPos = 'top';
      if (rect.top < tooltipHeight + padding) {
        vertPos = 'bottom';
      }
      setPosition(vertPos);
      
      // Calculate tooltip position
      let top = vertPos === 'top' 
        ? rect.top - tooltipHeight - padding 
        : rect.bottom + padding;
      let left = rect.left + rect.width / 2 - tooltipWidth / 2;
      
      // Clamp horizontal position to viewport
      const minLeft = padding;
      const maxLeft = window.innerWidth - tooltipWidth - padding;
      left = Math.max(minLeft, Math.min(maxLeft, left));
      
      // Calculate arrow offset (how much the tooltip shifted)
      const centerX = rect.left + rect.width / 2;
      const arrowLeft = centerX - left;
      
      setTooltipStyle({
        position: 'fixed',
        top: `${top}px`,
        left: `${left}px`,
        zIndex: 999999,
      });
      
      setArrowStyle({
        left: `${arrowLeft}px`,
      });
    }
    setShow(true);
  };
  
  return (
    <div 
      ref={triggerRef}
      className="relative inline-flex" 
      onMouseEnter={handleMouseEnter} 
      onMouseLeave={() => setShow(false)}
    >
      {children}
      {show && ReactDOM.createPortal(
        <div 
          className="px-2 py-1 bg-slate-800 text-white text-xs rounded whitespace-nowrap pointer-events-none"
          style={tooltipStyle}
        >
          {text}
          <div 
            className={`absolute border-4 border-transparent -translate-x-1/2 ${
              position === 'top' ? 'top-full border-t-slate-800' : 'bottom-full border-b-slate-800'
            }`}
            style={arrowStyle}
          />
        </div>,
        document.body
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
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const [unitSystem, setUnitSystem] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_PREFIX + 'units') || 'ft-in';
    } catch (e) { return 'ft-in'; }
  });
  
  // Design mode: 'room-setup' or 'furniture'
  const [designMode, setDesignMode] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_PREFIX + 'mode') || DESIGN_MODES.ROOM_SETUP;
    } catch (e) { return DESIGN_MODES.ROOM_SETUP; }
  });
  
  // Track if sections are expanded when locked (for optional viewing)
  const [roomSetupExpanded, setRoomSetupExpanded] = useState(false);
  const [furnitureExpanded, setFurnitureExpanded] = useState(false);
  
  // File browser state
  const [fileBrowserOpen, setFileBrowserOpen] = useState(false);
  const [savedProjects, setSavedProjects] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(PROJECTS_STORAGE_KEY) || '[]');
    } catch (e) { return []; }
  });
  const [currentProjectId, setCurrentProjectId] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_PREFIX + 'currentProject') || null;
    } catch (e) { return null; }
  });
  const [selectedProjects, setSelectedProjects] = useState([]);
  const [editingProjectId, setEditingProjectId] = useState(null);
  const [editingName, setEditingName] = useState('');
  const [fileImportText, setFileImportText] = useState('');
  const [fileImportError, setFileImportError] = useState('');
  const [lastSavedAt, setLastSavedAt] = useState(() => {
    // If there's a current project, show as already saved
    try {
      const projectId = localStorage.getItem(STORAGE_PREFIX + 'currentProject');
      if (projectId) {
        const projects = JSON.parse(localStorage.getItem(PROJECTS_STORAGE_KEY) || '[]');
        const project = projects.find(p => p.id === projectId);
        if (project?.updatedAt) return new Date(project.updatedAt);
      }
    } catch (e) {}
    return null;
  });
  const [saveStatus, setSaveStatus] = useState(() => {
    // If there's a current project, start as saved
    try {
      return localStorage.getItem(STORAGE_PREFIX + 'currentProject') ? 'saved' : 'unsaved';
    } catch (e) { return 'unsaved'; }
  });

  // Save unit preference
  useEffect(() => {
    localStorage.setItem(STORAGE_PREFIX + 'units', unitSystem);
  }, [unitSystem]);
  
  // Save design mode preference
  useEffect(() => {
    localStorage.setItem(STORAGE_PREFIX + 'mode', designMode);
  }, [designMode]);

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
  const [doors, setDoors] = useState(() => getInitialState('doors', INITIAL_DOORS));
  const [windows, setWindows] = useState(() => getInitialState('windows', INITIAL_WINDOWS));
  const [items, setItems] = useState(() => getInitialState('items', INITIAL_ITEMS));
  
  // History for undo/redo
  const [history, setHistory] = useState([]);
  const [historyIndex, setHistoryIndex] = useState(-1);

  // --- Persistence Effects ---
  
  // Save state to history for undo/redo
  const saveToHistory = useCallback(() => {
    const newState = { roomDims, doors, windows, items };
    const newHistory = history.slice(0, historyIndex + 1);
    newHistory.push(newState);
    
    if (newHistory.length > MAX_HISTORY) {
      newHistory.shift();
    } else {
      setHistoryIndex(historyIndex + 1);
    }
    
    setHistory(newHistory);
  }, [roomDims, doors, windows, items, history, historyIndex]);
  
  const undo = useCallback(() => {
    if (historyIndex > 0) {
      const prevState = history[historyIndex - 1];
      setRoomDims(prevState.roomDims);
      setDoors(prevState.doors || INITIAL_DOORS);
      setWindows(prevState.windows || INITIAL_WINDOWS);
      setItems(prevState.items);
      setHistoryIndex(historyIndex - 1);
    }
  }, [history, historyIndex]);
  
  const redo = useCallback(() => {
    if (historyIndex < history.length - 1) {
      const nextState = history[historyIndex + 1];
      setRoomDims(nextState.roomDims);
      setDoors(nextState.doors || INITIAL_DOORS);
      setWindows(nextState.windows || INITIAL_WINDOWS);
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
          if (parsed && parsed.roomDims && parsed.items) {
              // Convert from source unit system to internal feet storage
              const sourceUnitSystem = parsed.unitSystem || 'ft';
              const convertLength = (value) => unitValueToFeet(value, sourceUnitSystem);
              
              setRoomDims({
                width: convertLength(parsed.roomDims.width),
                height: convertLength(parsed.roomDims.height)
              });
              
              if (parsed.doors) {
                setDoors(parsed.doors.map(d => ({
                  ...d,
                  width: convertLength(d.width),
                  position: convertLength(d.position)
                })));
              } else if (parsed.door) {
                setDoors([{ 
                  ...parsed.door, 
                  id: 1, 
                  type: parsed.door.open === 'in' ? 'swing-in' : 'swing-out',
                  width: convertLength(parsed.door.width),
                  position: convertLength(parsed.door.position)
                }]);
              }
              
              if (parsed.windows) {
                setWindows(parsed.windows.map(w => ({
                  ...w,
                  width: convertLength(w.width),
                  position: convertLength(w.position)
                })));
              }
              
              setItems(parsed.items.map(i => ({
                ...i,
                x: convertLength(i.x),
                y: convertLength(i.y),
                width: convertLength(i.width),
                height: convertLength(i.height),
                color: migrateColor(i.color)
              })));
              
              // If the shared config has a name, save as a new project with that name
              if (parsed.name) {
                const now = new Date().toISOString();
                const newProject = {
                  id: `project-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                  name: parsed.name,
                  data: {
                    roomDims: {
                      width: convertLength(parsed.roomDims.width),
                      height: convertLength(parsed.roomDims.height)
                    },
                    doors: parsed.doors ? parsed.doors.map(d => ({
                      ...d,
                      width: convertLength(d.width),
                      position: convertLength(d.position)
                    })) : INITIAL_DOORS,
                    windows: parsed.windows ? parsed.windows.map(w => ({
                      ...w,
                      width: convertLength(w.width),
                      position: convertLength(w.position)
                    })) : INITIAL_WINDOWS,
                    items: parsed.items.map(i => ({
                      ...i,
                      x: convertLength(i.x),
                      y: convertLength(i.y),
                      width: convertLength(i.width),
                      height: convertLength(i.height),
                      color: migrateColor(i.color)
                    }))
                  },
                  createdAt: now,
                  updatedAt: now
                };
                try {
                  const existingProjects = JSON.parse(localStorage.getItem(PROJECTS_STORAGE_KEY) || '[]');
                  localStorage.setItem(PROJECTS_STORAGE_KEY, JSON.stringify([...existingProjects, newProject]));
                  setSavedProjects([...existingProjects, newProject]);
                  setCurrentProjectId(newProject.id);
                  localStorage.setItem(STORAGE_PREFIX + 'currentProject', newProject.id);
                  setSaveStatus('saved');
                  setLastSavedAt(new Date());
                } catch (e) {
                  console.error('Failed to save imported project:', e);
                }
              }
          }
      }
  }, []);

  // 2. Save to LocalStorage ONLY (Removed automatic URL replacement to avoid SecurityError)
  useEffect(() => {
      localStorage.setItem(STORAGE_PREFIX + 'dims', JSON.stringify(roomDims));
      localStorage.setItem(STORAGE_PREFIX + 'doors', JSON.stringify(doors));
      localStorage.setItem(STORAGE_PREFIX + 'windows', JSON.stringify(windows));
      localStorage.setItem(STORAGE_PREFIX + 'items', JSON.stringify(items));
      // Mark as unsaved when data changes
      setSaveStatus('unsaved');
  }, [roomDims, doors, windows, items]);

  // 3. Autosave to projects every 500ms when there are unsaved changes
  useEffect(() => {
    if (saveStatus !== 'unsaved') return;
    
    const autosaveTimer = setTimeout(() => {
      setSaveStatus('saving');
      
      const now = new Date().toISOString();
      const data = { roomDims, doors, windows, items, designMode, unitSystem };
      
      if (currentProjectId) {
        // Update existing project
        const updated = savedProjects.map(p => 
          p.id === currentProjectId 
            ? { ...p, data, updatedAt: now }
            : p
        );
        try {
          localStorage.setItem(PROJECTS_STORAGE_KEY, JSON.stringify(updated));
          setSavedProjects(updated);
        } catch (e) {
          console.error('Autosave failed:', e);
        }
      } else {
        // Create new project with default name
        const newProject = {
          id: `project-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          name: `Floor Plan - ${new Date().toLocaleDateString()}`,
          data,
          createdAt: now,
          updatedAt: now
        };
        try {
          const newProjects = [...savedProjects, newProject];
          localStorage.setItem(PROJECTS_STORAGE_KEY, JSON.stringify(newProjects));
          setSavedProjects(newProjects);
          setCurrentProjectId(newProject.id);
          localStorage.setItem(STORAGE_PREFIX + 'currentProject', newProject.id);
        } catch (e) {
          console.error('Autosave failed:', e);
        }
      }
      
      setLastSavedAt(new Date());
      setSaveStatus('saved');
    }, 500);
    
    return () => clearTimeout(autosaveTimer);
  }, [saveStatus, roomDims, doors, windows, items, designMode, unitSystem, currentProjectId, savedProjects]);

  // 4. Refresh "time ago" display every 10 seconds
  const [, setTimeRefresh] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => setTimeRefresh(t => t + 1), 10000);
    return () => clearInterval(interval);
  }, []);

  // --- Interaction State ---
  const [activeId, setActiveId] = useState(null);
  const [activeType, setActiveType] = useState(null); // 'item', 'door', or 'window'
  const [isDragging, setIsDragging] = useState(false);
  const [isRotating, setIsRotating] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [isSnapped, setIsSnapped] = useState(false);
  const knobInstanceRef = useRef(null);
  const containerRef = useRef(null);
  const hasAutoFitRun = useRef(false);
  const itemsRef = useRef(items);
  const doorsRef = useRef(doors);
  const windowsRef = useRef(windows);

  // Calculate the zoom level needed to fit the room in the container
  const calculateFitZoom = useCallback(() => {
    const container = containerRef.current;
    if (!container) return 1;
    
    // Get container dimensions (minus padding)
    const containerRect = container.getBoundingClientRect();
    const padding = isMobile ? 32 : 64; // p-4 = 16px*2, p-8 = 32px*2
    const availableWidth = containerRect.width - padding;
    const availableHeight = containerRect.height - padding;
    
    // Room dimensions in pixels
    const roomWidthPx = roomDims.width * PIXELS_PER_UNIT;
    const roomHeightPx = roomDims.height * PIXELS_PER_UNIT;
    
    // Calculate zoom to fit both dimensions
    const zoomX = availableWidth / roomWidthPx;
    const zoomY = availableHeight / roomHeightPx;
    
    // Use the smaller zoom to ensure it fits, clamped between 0.25 and 2
    const fitZoom = Math.min(zoomX, zoomY);
    return Math.max(0.25, Math.min(2, fitZoom));
  }, [roomDims.width, roomDims.height, isMobile]);

  // Fit the room to the view
  const fitToView = useCallback(() => {
    const newZoom = calculateFitZoom();
    setZoom(newZoom);
    setPanOffset({ x: 0, y: 0 });
  }, [calculateFitZoom]);

  // Auto-fit the room to the view on initial load (especially important for mobile/shared links)
  useEffect(() => {
    // Only run once after the container is mounted and we have room dimensions
    if (hasAutoFitRun.current) return;
    
    const container = containerRef.current;
    if (!container) return;
    
    // Longer delay to ensure the container has proper dimensions after layout settles
    // (sidebar animation is 300ms, plus buffer for rendering)
    const timer = setTimeout(() => {
      if (!hasAutoFitRun.current) {
        hasAutoFitRun.current = true;
        fitToView();
      }
    }, 500);
    
    return () => clearTimeout(timer);
  }, [fitToView]);

  // Re-fit on window resize (debounced)
  useEffect(() => {
    let resizeTimer = null;
    
    const handleResize = () => {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        fitToView();
      }, 300);
    };
    
    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
      if (resizeTimer) clearTimeout(resizeTimer);
    };
  }, [fitToView]);

  // Keep refs in sync with state
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  useEffect(() => {
    doorsRef.current = doors;
  }, [doors]);

  useEffect(() => {
    windowsRef.current = windows;
  }, [windows]);

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

  const toggleLock = (id) => {
      setItems(items.map(i => i.id === id ? { ...i, locked: !i.locked } : i));
      saveToHistory();
  };
  
  const updateRoomDims = (newDims) => {
    const validWidth = Math.max(1, newDims.width || 1);
    const validHeight = Math.max(1, newDims.height || 1);
    setRoomDims({ width: validWidth, height: validHeight });
    saveToHistory();
  };
  
  // Door management
  const getWallLength = (wall) => {
    return (wall === 'top' || wall === 'bottom') ? roomDims.width : roomDims.height;
  };
  
  const addDoor = () => {
    const newDoor = {
      id: Date.now(),
      width: 3,
      position: 2,
      wall: 'bottom',
      hinge: 'left',
      type: 'swing-in'
    };
    setDoors([...doors, newDoor]);
    saveToHistory();
  };
  
  const updateDoor = (id, updates) => {
    setDoors(doors.map(d => {
      if (d.id !== id) return d;
      const wallLen = getWallLength(updates.wall || d.wall);
      const newWidth = clamp(updates.width ?? d.width, 1, wallLen);
      const newPosition = clamp(updates.position ?? d.position, 0, Math.max(0, wallLen - newWidth));
      return { ...d, ...updates, width: newWidth, position: newPosition };
    }));
    saveToHistory();
  };
  
  const deleteDoor = (id) => {
    setDoors(doors.filter(d => d.id !== id));
    saveToHistory();
  };
  
  // Window management
  const addWindow = () => {
    const newWindow = {
      id: Date.now(),
      width: 3,
      position: 2,
      wall: 'top'
    };
    setWindows([...windows, newWindow]);
    saveToHistory();
  };
  
  const updateWindow = (id, updates) => {
    setWindows(windows.map(w => {
      if (w.id !== id) return w;
      const wallLen = getWallLength(updates.wall || w.wall);
      const newWidth = clamp(updates.width ?? w.width, 1, wallLen);
      const newPosition = clamp(updates.position ?? w.position, 0, Math.max(0, wallLen - newWidth));
      return { ...w, ...updates, width: newWidth, position: newPosition };
    }));
    saveToHistory();
  };
  
  const deleteWindow = (id) => {
    setWindows(windows.filter(w => w.id !== id));
    saveToHistory();
  };

  // Convert config values to specified unit system for export (preserves precision)
  const exportConfigInUnits = (targetUnitSystem) => {
    const convertLength = (feet) => feetToUnitValue(feet, targetUnitSystem);
    
    return {
      name: getCurrentProjectName(),
      unitSystem: targetUnitSystem,
      roomDims: {
        width: convertLength(roomDims.width),
        height: convertLength(roomDims.height)
      },
      doors: doors.map(d => ({
        ...d,
        width: convertLength(d.width),
        position: convertLength(d.position)
      })),
      windows: windows.map(w => ({
        ...w,
        width: convertLength(w.width),
        position: convertLength(w.position)
      })),
      items: items.map(i => ({
        ...i,
        x: convertLength(i.x),
        y: convertLength(i.y),
        width: convertLength(i.width),
        height: convertLength(i.height),
        color: migrateColor(i.color) // Ensure colors are hex for sharing
      }))
    };
  };

  // Import config and convert from source unit system to feet (internal storage)
  const importConfigFromUnits = (config) => {
    const sourceUnitSystem = config.unitSystem || 'ft'; // Legacy configs are in feet
    const convertLength = (value) => unitValueToFeet(value, sourceUnitSystem);
    
    return {
      roomDims: {
        width: convertLength(config.roomDims.width),
        height: convertLength(config.roomDims.height)
      },
      doors: (config.doors || []).map(d => ({
        ...d,
        width: convertLength(d.width),
        position: convertLength(d.position)
      })),
      windows: (config.windows || []).map(w => ({
        ...w,
        width: convertLength(w.width),
        position: convertLength(w.position)
      })),
      items: (config.items || []).map(i => ({
        ...i,
        x: convertLength(i.x),
        y: convertLength(i.y),
        width: convertLength(i.width),
        height: convertLength(i.height),
        color: migrateColor(i.color) // Ensure colors are migrated
      }))
    };
  };

  const getShareUrl = () => {
    try {
      const config = exportConfigInUnits(unitSystem);
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
          
          const converted = importConfigFromUnits(parsed);
          
          setRoomDims(converted.roomDims);
          // Handle legacy single door format
          if (parsed.doors) {
            setDoors(converted.doors);
          } else if (parsed.door) {
            const sourceUnitSystem = parsed.unitSystem || 'ft';
            setDoors([{ 
              ...parsed.door, 
              id: 1, 
              type: parsed.door.open === 'in' ? 'swing-in' : 'swing-out',
              width: unitValueToFeet(parsed.door.width, sourceUnitSystem),
              position: unitValueToFeet(parsed.door.position, sourceUnitSystem)
            }]);
          } else {
            setDoors(INITIAL_DOORS);
          }
          setWindows(converted.windows.length > 0 ? converted.windows : INITIAL_WINDOWS);
          setItems(converted.items);
          
          // If the imported config has a name, save as a new project
          if (parsed.name) {
            const now = new Date().toISOString();
            const newProject = {
              id: generateProjectId(),
              name: parsed.name,
              data: {
                roomDims: converted.roomDims,
                doors: converted.doors.length > 0 ? converted.doors : INITIAL_DOORS,
                windows: converted.windows.length > 0 ? converted.windows : INITIAL_WINDOWS,
                items: converted.items
              },
              createdAt: now,
              updatedAt: now
            };
            saveProjectsToStorage([...savedProjects, newProject]);
            setCurrentProjectId(newProject.id);
            localStorage.setItem(STORAGE_PREFIX + 'currentProject', newProject.id);
            setSaveStatus('saved');
            setLastSavedAt(new Date());
          }
          
          setModalOpen(false);
          setImportText('');
          setImportError(null);
      } catch (e) {
          setImportError("Invalid JSON format. Please check your input.");
      }
  };

  // --- Project Management Functions ---
  
  const saveProjectsToStorage = (projects) => {
    try {
      localStorage.setItem(PROJECTS_STORAGE_KEY, JSON.stringify(projects));
      setSavedProjects(projects);
    } catch (e) {
      console.error('Failed to save projects:', e);
    }
  };
  
  const generateProjectId = () => `project-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  
  const getCurrentProjectData = () => ({
    roomDims,
    doors,
    windows,
    items,
    designMode,
    unitSystem
  });
  
  const saveCurrentProject = (name = null) => {
    const now = new Date().toISOString();
    const data = getCurrentProjectData();
    
    if (currentProjectId) {
      // Update existing project
      const updated = savedProjects.map(p => 
        p.id === currentProjectId 
          ? { ...p, data, updatedAt: now, name: name || p.name }
          : p
      );
      saveProjectsToStorage(updated);
    } else {
      // Create new project
      const newProject = {
        id: generateProjectId(),
        name: name || `Floor Plan ${savedProjects.length + 1}`,
        data,
        createdAt: now,
        updatedAt: now
      };
      saveProjectsToStorage([...savedProjects, newProject]);
      setCurrentProjectId(newProject.id);
      localStorage.setItem(STORAGE_PREFIX + 'currentProject', newProject.id);
    }
  };
  
  const saveAsNewProject = (name) => {
    const now = new Date().toISOString();
    const data = getCurrentProjectData();
    const newProject = {
      id: generateProjectId(),
      name: name || `Floor Plan ${savedProjects.length + 1}`,
      data,
      createdAt: now,
      updatedAt: now
    };
    saveProjectsToStorage([...savedProjects, newProject]);
    setCurrentProjectId(newProject.id);
    localStorage.setItem(STORAGE_PREFIX + 'currentProject', newProject.id);
    return newProject;
  };
  
  const loadProject = (project) => {
    const { data } = project;
    setRoomDims(data.roomDims || INITIAL_ROOM);
    setDoors(data.doors || INITIAL_DOORS);
    setWindows(data.windows || INITIAL_WINDOWS);
    setItems(data.items || INITIAL_ITEMS);
    if (data.designMode) setDesignMode(data.designMode);
    if (data.unitSystem) setUnitSystem(data.unitSystem);
    setCurrentProjectId(project.id);
    localStorage.setItem(STORAGE_PREFIX + 'currentProject', project.id);
    setFileBrowserOpen(false);
    setHistory([]);
    setHistoryIndex(-1);
  };
  
  const duplicateProject = (project) => {
    const now = new Date().toISOString();
    const newProject = {
      id: generateProjectId(),
      name: `${project.name} (Copy)`,
      data: { ...project.data },
      createdAt: now,
      updatedAt: now
    };
    saveProjectsToStorage([...savedProjects, newProject]);
    return newProject;
  };
  
  const renameProject = (projectId, newName) => {
    const updated = savedProjects.map(p => 
      p.id === projectId ? { ...p, name: newName, updatedAt: new Date().toISOString() } : p
    );
    saveProjectsToStorage(updated);
    setEditingProjectId(null);
    setEditingName('');
  };
  
  const deleteProjects = (projectIds) => {
    const updated = savedProjects.filter(p => !projectIds.includes(p.id));
    saveProjectsToStorage(updated);
    if (projectIds.includes(currentProjectId)) {
      setCurrentProjectId(null);
      localStorage.removeItem(STORAGE_PREFIX + 'currentProject');
    }
    setSelectedProjects([]);
  };
  
  const exportProjects = (projectIds) => {
    const projectsToExport = savedProjects.filter(p => projectIds.includes(p.id));
    const exportData = {
      version: 1,
      exportedAt: new Date().toISOString(),
      projects: projectsToExport
    };
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = projectsToExport.length === 1 
      ? `${projectsToExport[0].name.replace(/[^a-z0-9]/gi, '_')}.json`
      : `floor_plans_export_${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };
  
  const importProjects = (jsonText) => {
    try {
      const parsed = JSON.parse(jsonText);
      let projectsToImport = [];
      
      // Handle both single project and multi-project export formats
      if (parsed.projects && Array.isArray(parsed.projects)) {
        projectsToImport = parsed.projects;
      } else if (parsed.roomDims && parsed.items) {
        // Single project in old format
        projectsToImport = [{
          id: generateProjectId(),
          name: `Imported Plan ${savedProjects.length + 1}`,
          data: parsed,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }];
      } else {
        throw new Error('Invalid format');
      }
      
      // Generate new IDs for imported projects to avoid conflicts
      const now = new Date().toISOString();
      const processedProjects = projectsToImport.map(p => ({
        ...p,
        id: generateProjectId(),
        name: p.name || `Imported Plan`,
        createdAt: p.createdAt || now,
        updatedAt: now
      }));
      
      saveProjectsToStorage([...savedProjects, ...processedProjects]);
      setFileImportText('');
      setFileImportError('');
      return processedProjects.length;
    } catch (e) {
      setFileImportError('Invalid file format. Please check your JSON.');
      return 0;
    }
  };
  
  const createNewProject = () => {
    // Reset to defaults
    setRoomDims(INITIAL_ROOM);
    setDoors(INITIAL_DOORS);
    setWindows(INITIAL_WINDOWS);
    setItems(INITIAL_ITEMS);
    setDesignMode(DESIGN_MODES.ROOM_SETUP);
    setCurrentProjectId(null);
    localStorage.removeItem(STORAGE_PREFIX + 'currentProject');
    setFileBrowserOpen(false);
    setHistory([]);
    setHistoryIndex(-1);
  };
  
  const getCurrentProjectName = () => {
    if (!currentProjectId) return 'Untitled';
    const project = savedProjects.find(p => p.id === currentProjectId);
    return project?.name || 'Untitled';
  };
  
  const toggleProjectSelection = (projectId) => {
    setSelectedProjects(prev => 
      prev.includes(projectId) 
        ? prev.filter(id => id !== projectId)
        : [...prev, projectId]
    );
  };
  
  const selectAllProjects = () => {
    if (selectedProjects.length === savedProjects.length) {
      setSelectedProjects([]);
    } else {
      setSelectedProjects(savedProjects.map(p => p.id));
    }
  };

  const handleMouseDown = (e, id, interactionType, entityType = 'item') => {
    // Check if this entity type is locked based on current design mode
    const isRoomSetupMode = designMode === DESIGN_MODES.ROOM_SETUP;
    const isFurnitureMode = designMode === DESIGN_MODES.FURNITURE;
    
    // In room-setup mode, furniture is locked
    // In furniture mode, doors/windows are locked
    if (isRoomSetupMode && entityType === 'item') {
      // Furniture is locked during room setup - allow selection but not dragging
      setActiveId(id);
      setActiveType(entityType);
      return;
    }
    if (isFurnitureMode && (entityType === 'door' || entityType === 'window')) {
      // Doors/windows are locked during furniture placement
      return;
    }
    
    // Check if individual item is locked
    if (entityType === 'item') {
      const item = items.find(i => i.id === id);
      if (item?.locked) {
        // Allow selection but not dragging/rotating
        setActiveId(id);
        setActiveType(entityType);
        return;
      }
    }
    
    e.stopPropagation();
    e.preventDefault();

    setActiveId(id);
    setActiveType(entityType);

    const clientX = e.type.startsWith('touch') ? e.touches[0].clientX : e.clientX;
    const clientY = e.type.startsWith('touch') ? e.touches[0].clientY : e.clientY;

    if (interactionType === 'drag') {
      setIsDragging(true);
      setDragOffset({ x: clientX, y: clientY });
    } else if (interactionType === 'rotate' && entityType === 'item') {
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
        let newRotation = -knobInstance.angle();
        // Normalize to 0-360 range
        newRotation = ((newRotation % 360) + 360) % 360;
        
        const itemIndex = itemsRef.current.findIndex(i => i.id === id);
        if (itemIndex !== -1) {
          const newItems = [...itemsRef.current];
          newItems[itemIndex] = { ...itemsRef.current[itemIndex], rotation: newRotation };
          setItems(newItems);
          
          // Visual feedback for snap zones
          const nearest = Math.round(newRotation / 15) * 15;
          setIsSnapped(Math.abs(newRotation - nearest) < 5);
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
    if (!activeId || !isDragging) {
      if (isRotating && knobInstanceRef.current) {
        const clientX = e.type.startsWith('touch') ? e.touches[0].clientX : e.clientX;
        const clientY = e.type.startsWith('touch') ? e.touches[0].clientY : e.clientY;
        knobInstanceRef.current.doTouchMove([{ pageX: clientX, pageY: clientY }], e.timeStamp || Date.now());
      }
      return;
    }

    const clientX = e.type.startsWith('touch') ? e.touches[0].clientX : e.clientX;
    const clientY = e.type.startsWith('touch') ? e.touches[0].clientY : e.clientY;
    const deltaX = (clientX - dragOffset.x) / PIXELS_PER_UNIT / zoom;
    const deltaY = (clientY - dragOffset.y) / PIXELS_PER_UNIT / zoom;

    if (activeType === 'item') {
      const currentItems = itemsRef.current;
      const itemIndex = currentItems.findIndex(i => i.id === activeId);
      if (itemIndex === -1) return;
      const item = currentItems[itemIndex];
      const newItems = [...currentItems];
      newItems[itemIndex] = { ...item, x: item.x + deltaX, y: item.y + deltaY };
      setItems(newItems);
    } else if (activeType === 'door') {
      const currentDoors = doorsRef.current;
      const doorIndex = currentDoors.findIndex(d => d.id === activeId);
      if (doorIndex === -1) return;
      const door = currentDoors[doorIndex];
      const isHorizontal = door.wall === 'top' || door.wall === 'bottom';
      const delta = isHorizontal ? deltaX : deltaY;
      const wallLen = isHorizontal ? roomDims.width : roomDims.height;
      const newPosition = clamp(door.position + delta, 0, wallLen - door.width);
      const newDoors = [...currentDoors];
      newDoors[doorIndex] = { ...door, position: newPosition };
      setDoors(newDoors);
    } else if (activeType === 'window') {
      const currentWindows = windowsRef.current;
      const winIndex = currentWindows.findIndex(w => w.id === activeId);
      if (winIndex === -1) return;
      const win = currentWindows[winIndex];
      const isHorizontal = win.wall === 'top' || win.wall === 'bottom';
      const delta = isHorizontal ? deltaX : deltaY;
      const wallLen = isHorizontal ? roomDims.width : roomDims.height;
      const newPosition = clamp(win.position + delta, 0, wallLen - win.width);
      const newWindows = [...currentWindows];
      newWindows[winIndex] = { ...win, position: newPosition };
      setWindows(newWindows);
    }
    
    setDragOffset({ x: clientX, y: clientY });
  }, [activeId, activeType, isDragging, isRotating, dragOffset, roomDims, zoom]);

  const handleMouseUp = useCallback(() => {
    if (isDragging || isRotating) {
      if (isRotating && knobInstanceRef.current) {
        // End the touch on the knob
        knobInstanceRef.current.doTouchEnd(Date.now());
        
        // Normalize rotation to 0-360 range and snap to nearest 15 degrees if close
        const currentItems = itemsRef.current;
        const itemIndex = currentItems.findIndex(i => i.id === activeId);
        if (itemIndex !== -1) {
          const item = currentItems[itemIndex];
          // Normalize to 0-360 range
          let normRot = ((item.rotation % 360) + 360) % 360;
          const nearest = Math.round(normRot / 15) * 15;
          
          // Snap if within 5 degrees of a 15-degree increment
          if (Math.abs(normRot - nearest) < 5) {
            normRot = nearest % 360;
          }
          
          const newItems = [...currentItems];
          newItems[itemIndex] = { ...item, rotation: normRot };
          setItems(newItems);
        }
        
        knobInstanceRef.current = null;
      }
      
      // Save to history
      const config = { roomDims, doors, windows, items: itemsRef.current };
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
  }, [isDragging, isRotating, roomDims, doors, windows, history, historyIndex, activeId]);

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

  // Pinch-to-zoom and pan support
  // Use a ref to track zoom for event handlers to avoid re-running effect on zoom change
  const zoomRef = useRef(zoom);
  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Use refs to persist state across the gesture without re-running the effect
    let lastTouchDistance = null;
    let lastTouchCenter = null;
    let isPinching = false;
    let lastSingleTouch = null;
    let isSingleFingerPanning = false;

    const handleWheel = (e) => {
      // Check if this is a pinch gesture (ctrlKey is set for trackpad pinch on Mac)
      if (e.ctrlKey) {
        e.preventDefault();
        const delta = -e.deltaY;
        const zoomSpeed = 0.01;
        const newZoom = Math.max(0.25, Math.min(3, zoomRef.current + delta * zoomSpeed));
        setZoom(newZoom);
      } else {
        // Regular two-finger scroll = pan
        e.preventDefault();
        setPanOffset(prev => ({
          x: prev.x - e.deltaX,
          y: prev.y - e.deltaY
        }));
      }
    };

    const getTouchDistance = (touches) => {
      const dx = touches[0].clientX - touches[1].clientX;
      const dy = touches[0].clientY - touches[1].clientY;
      return Math.sqrt(dx * dx + dy * dy);
    };

    const getTouchCenter = (touches) => ({
      x: (touches[0].clientX + touches[1].clientX) / 2,
      y: (touches[0].clientY + touches[1].clientY) / 2
    });

    const handleTouchStart = (e) => {
      if (e.touches.length === 2) {
        // Two finger gesture - pinch/pan - always allow this
        isPinching = true;
        isSingleFingerPanning = false;
        lastTouchDistance = getTouchDistance(e.touches);
        lastTouchCenter = getTouchCenter(e.touches);
        e.preventDefault();
      } else if (e.touches.length === 1) {
        // Check if touch started on a draggable item (furniture, door handle, window handle)
        const target = e.target;
        const isDraggableItem = target.closest('[role="button"]') || 
                               target.closest('.cursor-grab') ||
                               target.closest('.cursor-crosshair');
        
        // Allow single finger pan on anything that's not a draggable item
        if (!isDraggableItem) {
          isSingleFingerPanning = true;
          lastSingleTouch = {
            x: e.touches[0].clientX,
            y: e.touches[0].clientY
          };
        }
      }
    };

    const handleTouchMove = (e) => {
      if (e.touches.length === 2 && isPinching) {
        e.preventDefault();
        
        // Handle zoom
        const currentDistance = getTouchDistance(e.touches);
        if (lastTouchDistance !== null) {
          const delta = currentDistance - lastTouchDistance;
          const zoomSpeed = 0.008;
          const newZoom = Math.max(0.25, Math.min(3, zoomRef.current + delta * zoomSpeed));
          setZoom(newZoom);
        }
        lastTouchDistance = currentDistance;
        
        // Handle pan
        const currentCenter = getTouchCenter(e.touches);
        if (lastTouchCenter !== null) {
          const deltaX = currentCenter.x - lastTouchCenter.x;
          const deltaY = currentCenter.y - lastTouchCenter.y;
          setPanOffset(prev => ({
            x: prev.x + deltaX,
            y: prev.y + deltaY
          }));
        }
        lastTouchCenter = currentCenter;
      } else if (e.touches.length === 1 && isSingleFingerPanning && lastSingleTouch) {
        // Single finger pan on background
        e.preventDefault();
        const currentTouch = {
          x: e.touches[0].clientX,
          y: e.touches[0].clientY
        };
        const deltaX = currentTouch.x - lastSingleTouch.x;
        const deltaY = currentTouch.y - lastSingleTouch.y;
        setPanOffset(prev => ({
          x: prev.x + deltaX,
          y: prev.y + deltaY
        }));
        lastSingleTouch = currentTouch;
      }
    };

    const handleTouchEnd = (e) => {
      if (e.touches.length < 2) {
        isPinching = false;
        lastTouchDistance = null;
        lastTouchCenter = null;
      }
      if (e.touches.length === 0) {
        isSingleFingerPanning = false;
        lastSingleTouch = null;
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
  }, []); // No dependencies - effect runs once, uses refs for current values

  // --- Render Helpers ---

  const renderGrid = () => (
      <div className="absolute inset-0 pointer-events-none opacity-20" 
           style={{ 
             backgroundImage: `linear-gradient(#ccc 1px, transparent 1px), linear-gradient(90deg, #ccc 1px, transparent 1px)`,
             backgroundSize: `${PIXELS_PER_UNIT}px ${PIXELS_PER_UNIT}px`
           }} 
      />
  );

  // Render a single door based on wall, position, type, etc.
  const renderSingleDoor = (door) => {
    const wall = door.wall || 'bottom';
    const isHorizontal = wall === 'top' || wall === 'bottom';
    const wallLength = isHorizontal ? roomDims.width : roomDims.height;
    const doorPos = clamp(door.position, 0, wallLength - door.width);
    const swingRadius = door.width * PIXELS_PER_UNIT;
    const isLeft = door.hinge === 'left';
    const doorType = door.type || 'swing-in';
    const isSwingIn = doorType === 'swing-in';
    const isSwingOut = doorType === 'swing-out';
    const isSliding = doorType === 'sliding';

    // Calculate positions based on wall
    let gapStyle = {};
    let arcStyle = {};
    let panelStyle = {};
    let slidingStyle = {};
    let jambLine1Style = {};
    let jambLine2Style = {};
    
    const doorWidthPx = door.width * PIXELS_PER_UNIT;
    const wallThickness = 4;
    const jambLength = 12; // Length of the jamb lines perpendicular to wall

    if (wall === 'bottom') {
      gapStyle = {
        position: 'absolute',
        left: doorPos * PIXELS_PER_UNIT,
        top: roomDims.height * PIXELS_PER_UNIT - wallThickness / 2,
        width: doorWidthPx,
        height: wallThickness,
        backgroundColor: 'white',
        zIndex: 10
      };
      
      if (!isSliding) {
        const swingInward = isSwingIn;
        arcStyle = {
          position: 'absolute',
          width: swingRadius,
          height: swingRadius,
          border: '2px dashed #94a3b8',
          opacity: 0.5,
          pointerEvents: 'none',
          borderRadius: !isLeft 
            ? (swingInward ? '100% 0 0 0' : '0 0 0 100%') 
            : (swingInward ? '0 100% 0 0' : '0 0 100% 0'),
          borderBottom: swingInward ? '2px dashed #94a3b8' : 'none',
          borderTop: !swingInward ? '2px dashed #94a3b8' : 'none',
          borderLeft: !isLeft ? '2px dashed #94a3b8' : 'none',
          borderRight: isLeft ? '2px dashed #94a3b8' : 'none',
          left: isLeft ? doorPos * PIXELS_PER_UNIT : (doorPos + door.width) * PIXELS_PER_UNIT - swingRadius,
          top: swingInward ? (roomDims.height - door.width) * PIXELS_PER_UNIT : roomDims.height * PIXELS_PER_UNIT,
        };
        
        panelStyle = {
          position: 'absolute',
          width: 4,
          height: swingRadius,
          backgroundColor: '#cbd5e1',
          border: '1px solid #64748b',
          top: swingInward ? (roomDims.height - door.width) * PIXELS_PER_UNIT : roomDims.height * PIXELS_PER_UNIT,
          left: isLeft ? doorPos * PIXELS_PER_UNIT : (doorPos + door.width) * PIXELS_PER_UNIT - 4,
        };
      } else {
        // Sliding door indicator
        slidingStyle = {
          position: 'absolute',
          left: doorPos * PIXELS_PER_UNIT,
          top: roomDims.height * PIXELS_PER_UNIT - 8,
          width: doorWidthPx,
          height: 6,
          backgroundColor: '#94a3b8',
          borderRadius: 2,
          opacity: 0.6
        };
      }
    } else if (wall === 'top') {
      gapStyle = {
        position: 'absolute',
        left: doorPos * PIXELS_PER_UNIT,
        top: -wallThickness / 2,
        width: doorWidthPx,
        height: wallThickness,
        backgroundColor: 'white',
        zIndex: 10
      };
      
      if (!isSliding) {
        const swingInward = isSwingIn;
        arcStyle = {
          position: 'absolute',
          width: swingRadius,
          height: swingRadius,
          border: '2px dashed #94a3b8',
          opacity: 0.5,
          pointerEvents: 'none',
          borderRadius: isLeft 
            ? (swingInward ? '0 0 100% 0' : '0 0 0 100%')
            : (swingInward ? '0 0 0 100%' : '0 0 100% 0'),
          borderTop: !swingInward ? '2px dashed #94a3b8' : 'none',
          borderBottom: swingInward ? '2px dashed #94a3b8' : 'none',
          borderLeft: isLeft ? '2px dashed #94a3b8' : 'none',
          borderRight: !isLeft ? '2px dashed #94a3b8' : 'none',
          left: isLeft ? doorPos * PIXELS_PER_UNIT : (doorPos + door.width) * PIXELS_PER_UNIT - swingRadius,
          top: swingInward ? 0 : -swingRadius,
        };
        
        panelStyle = {
          position: 'absolute',
          width: 4,
          height: swingRadius,
          backgroundColor: '#cbd5e1',
          border: '1px solid #64748b',
          top: swingInward ? 0 : -swingRadius,
          left: isLeft ? doorPos * PIXELS_PER_UNIT : (doorPos + door.width) * PIXELS_PER_UNIT - 4,
        };
      } else {
        slidingStyle = {
          position: 'absolute',
          left: doorPos * PIXELS_PER_UNIT,
          top: 2,
          width: doorWidthPx,
          height: 6,
          backgroundColor: '#94a3b8',
          borderRadius: 2,
          opacity: 0.6
        };
      }
    } else if (wall === 'left') {
      gapStyle = {
        position: 'absolute',
        left: -wallThickness / 2,
        top: doorPos * PIXELS_PER_UNIT,
        width: wallThickness,
        height: doorWidthPx,
        backgroundColor: 'white',
        zIndex: 10
      };
      
      if (!isSliding) {
        const swingInward = isSwingIn;
        arcStyle = {
          position: 'absolute',
          width: swingRadius,
          height: swingRadius,
          border: '2px dashed #94a3b8',
          opacity: 0.5,
          pointerEvents: 'none',
          borderRadius: isLeft 
            ? (swingInward ? '0 100% 0 0' : '0 0 0 100%')
            : (swingInward ? '0 0 100% 0' : '100% 0 0 0'),
          borderLeft: !swingInward ? '2px dashed #94a3b8' : 'none',
          borderRight: swingInward ? '2px dashed #94a3b8' : 'none',
          borderTop: isLeft ? '2px dashed #94a3b8' : 'none',
          borderBottom: !isLeft ? '2px dashed #94a3b8' : 'none',
          left: swingInward ? 0 : -swingRadius,
          top: isLeft ? doorPos * PIXELS_PER_UNIT : (doorPos + door.width) * PIXELS_PER_UNIT - swingRadius,
        };
        
        panelStyle = {
          position: 'absolute',
          width: swingRadius,
          height: 4,
          backgroundColor: '#cbd5e1',
          border: '1px solid #64748b',
          left: swingInward ? 0 : -swingRadius,
          top: isLeft ? doorPos * PIXELS_PER_UNIT : (doorPos + door.width) * PIXELS_PER_UNIT - 4,
        };
      } else {
        slidingStyle = {
          position: 'absolute',
          left: 2,
          top: doorPos * PIXELS_PER_UNIT,
          width: 6,
          height: doorWidthPx,
          backgroundColor: '#94a3b8',
          borderRadius: 2,
          opacity: 0.6
        };
      }
    } else if (wall === 'right') {
      gapStyle = {
        position: 'absolute',
        left: roomDims.width * PIXELS_PER_UNIT - wallThickness / 2,
        top: doorPos * PIXELS_PER_UNIT,
        width: wallThickness,
        height: doorWidthPx,
        backgroundColor: 'white',
        zIndex: 10
      };
      
      if (!isSliding) {
        const swingInward = isSwingIn;
        arcStyle = {
          position: 'absolute',
          width: swingRadius,
          height: swingRadius,
          border: '2px dashed #94a3b8',
          opacity: 0.5,
          pointerEvents: 'none',
          borderRadius: !isLeft 
            ? (swingInward ? '100% 0 0 0' : '0 0 100% 0')
            : (swingInward ? '0 0 0 100%' : '0 100% 0 0'),
          borderLeft: swingInward ? '2px dashed #94a3b8' : 'none',
          borderRight: !swingInward ? '2px dashed #94a3b8' : 'none',
          borderTop: !isLeft ? '2px dashed #94a3b8' : 'none',
          borderBottom: isLeft ? '2px dashed #94a3b8' : 'none',
          left: swingInward ? (roomDims.width - door.width) * PIXELS_PER_UNIT : roomDims.width * PIXELS_PER_UNIT,
          top: isLeft ? doorPos * PIXELS_PER_UNIT : (doorPos + door.width) * PIXELS_PER_UNIT - swingRadius,
        };
        
        panelStyle = {
          position: 'absolute',
          width: swingRadius,
          height: 4,
          backgroundColor: '#cbd5e1',
          border: '1px solid #64748b',
          left: swingInward ? (roomDims.width - door.width) * PIXELS_PER_UNIT : roomDims.width * PIXELS_PER_UNIT,
          top: isLeft ? doorPos * PIXELS_PER_UNIT : (doorPos + door.width) * PIXELS_PER_UNIT - 4,
        };
      } else {
        slidingStyle = {
          position: 'absolute',
          left: roomDims.width * PIXELS_PER_UNIT - 8,
          top: doorPos * PIXELS_PER_UNIT,
          width: 6,
          height: doorWidthPx,
          backgroundColor: '#94a3b8',
          borderRadius: 2,
          opacity: 0.6
        };
      }
    }

    const isActive = activeId === door.id && activeType === 'door';
    const isLocked = designMode === DESIGN_MODES.FURNITURE;
    
    // Draggable handle style based on wall
    let handleStyle = {};
    const handleSize = 20;
    
    if (wall === 'bottom') {
      handleStyle = {
        position: 'absolute',
        left: doorPos * PIXELS_PER_UNIT + doorWidthPx / 2 - handleSize / 2,
        top: roomDims.height * PIXELS_PER_UNIT - handleSize / 2,
        width: handleSize,
        height: handleSize,
        cursor: 'ew-resize',
        zIndex: 20,
      };
    } else if (wall === 'top') {
      handleStyle = {
        position: 'absolute',
        left: doorPos * PIXELS_PER_UNIT + doorWidthPx / 2 - handleSize / 2,
        top: -handleSize / 2,
        width: handleSize,
        height: handleSize,
        cursor: 'ew-resize',
        zIndex: 20,
      };
    } else if (wall === 'left') {
      handleStyle = {
        position: 'absolute',
        left: -handleSize / 2,
        top: doorPos * PIXELS_PER_UNIT + doorWidthPx / 2 - handleSize / 2,
        width: handleSize,
        height: handleSize,
        cursor: 'ns-resize',
        zIndex: 20,
      };
    } else if (wall === 'right') {
      handleStyle = {
        position: 'absolute',
        left: roomDims.width * PIXELS_PER_UNIT - handleSize / 2,
        top: doorPos * PIXELS_PER_UNIT + doorWidthPx / 2 - handleSize / 2,
        width: handleSize,
        height: handleSize,
        cursor: 'ns-resize',
        zIndex: 20,
      };
    }

    // Compute jamb line positions based on wall
    const jambColor = '#334155';
    const jambWidth = 2;
    
    if (isHorizontal) {
      // Top or Bottom walls - jambs are vertical lines
      const yBase = wall === 'top' ? -jambLength / 2 : roomDims.height * PIXELS_PER_UNIT - jambLength / 2;
      jambLine1Style = {
        position: 'absolute',
        left: doorPos * PIXELS_PER_UNIT - jambWidth / 2,
        top: yBase,
        width: jambWidth,
        height: jambLength,
        backgroundColor: jambColor,
        zIndex: 11
      };
      jambLine2Style = {
        position: 'absolute',
        left: (doorPos + door.width) * PIXELS_PER_UNIT - jambWidth / 2,
        top: yBase,
        width: jambWidth,
        height: jambLength,
        backgroundColor: jambColor,
        zIndex: 11
      };
    } else {
      // Left or Right walls - jambs are horizontal lines
      const xBase = wall === 'left' ? -jambLength / 2 : roomDims.width * PIXELS_PER_UNIT - jambLength / 2;
      jambLine1Style = {
        position: 'absolute',
        left: xBase,
        top: doorPos * PIXELS_PER_UNIT - jambWidth / 2,
        width: jambLength,
        height: jambWidth,
        backgroundColor: jambColor,
        zIndex: 11
      };
      jambLine2Style = {
        position: 'absolute',
        left: xBase,
        top: (doorPos + door.width) * PIXELS_PER_UNIT - jambWidth / 2,
        width: jambLength,
        height: jambWidth,
        backgroundColor: jambColor,
        zIndex: 11
      };
    }

    return (
      <React.Fragment key={door.id}>
        <div style={gapStyle} />
        {/* Architectural jamb lines showing wall break */}
        <div style={jambLine1Style} />
        <div style={jambLine2Style} />
        {!isSliding && <div style={arcStyle} />}
        {!isSliding && <div style={panelStyle} />}
        {isSliding && <div style={slidingStyle} />}
        {/* Draggable handle - hidden when locked */}
        {!isLocked && (
          <div 
            style={handleStyle}
            className={`rounded-full transition-all ${isActive ? 'bg-indigo-500 ring-2 ring-indigo-300' : 'bg-slate-400 hover:bg-indigo-400'}`}
            onMouseDown={(e) => handleMouseDown(e, door.id, 'drag', 'door')}
            onTouchStart={(e) => handleMouseDown(e, door.id, 'drag', 'door')}
            title="Drag to reposition door"
          />
        )}
      </React.Fragment>
    );
  };

  const renderDoors = () => doors.map(door => renderSingleDoor(door));

  // Render windows
  const renderWindows = () => {
    const isLocked = designMode === DESIGN_MODES.FURNITURE;
    const jambColor = '#334155';
    const jambWidth = 2;
    const jambLength = 12;
    
    return windows.map(win => {
      const wall = win.wall || 'top';
      const isHorizontal = wall === 'top' || wall === 'bottom';
      const wallLength = isHorizontal ? roomDims.width : roomDims.height;
      const winPos = clamp(win.position, 0, wallLength - win.width);
      const winWidthPx = win.width * PIXELS_PER_UNIT;
      const isActive = activeId === win.id && activeType === 'window';
      
      let style = {};
      let gapStyle = {};
      let handleStyle = {};
      let jambLine1Style = {};
      let jambLine2Style = {};
      const handleSize = 16;
      const wallThickness = 4;
      
      if (wall === 'top') {
        gapStyle = {
          position: 'absolute',
          left: winPos * PIXELS_PER_UNIT,
          top: -wallThickness / 2,
          width: winWidthPx,
          height: wallThickness,
          backgroundColor: 'white',
          zIndex: 10
        };
        style = {
          position: 'absolute',
          left: winPos * PIXELS_PER_UNIT,
          top: -2,
          width: winWidthPx,
          height: 8,
          backgroundColor: '#93c5fd',
          border: '2px solid #3b82f6',
          borderRadius: 2,
          zIndex: 11,
          cursor: 'ew-resize',
        };
        handleStyle = {
          position: 'absolute',
          left: winPos * PIXELS_PER_UNIT + winWidthPx / 2 - handleSize / 2,
          top: -handleSize / 2 + 2,
          width: handleSize,
          height: handleSize,
          cursor: 'ew-resize',
          zIndex: 20,
        };
      } else if (wall === 'bottom') {
        style = {
          position: 'absolute',
          left: winPos * PIXELS_PER_UNIT,
          top: roomDims.height * PIXELS_PER_UNIT - 6,
          width: winWidthPx,
          height: 8,
          backgroundColor: '#93c5fd',
          border: '2px solid #3b82f6',
          borderRadius: 2,
          zIndex: 11,
          cursor: 'ew-resize',
        };
        handleStyle = {
          position: 'absolute',
          left: winPos * PIXELS_PER_UNIT + winWidthPx / 2 - handleSize / 2,
          top: roomDims.height * PIXELS_PER_UNIT - handleSize / 2,
          width: handleSize,
          height: handleSize,
          cursor: 'ew-resize',
          zIndex: 20,
        };
      } else if (wall === 'left') {
        style = {
          position: 'absolute',
          left: -2,
          top: winPos * PIXELS_PER_UNIT,
          width: 8,
          height: winWidthPx,
          backgroundColor: '#93c5fd',
          border: '2px solid #3b82f6',
          borderRadius: 2,
          zIndex: 11,
          cursor: 'ns-resize',
        };
        handleStyle = {
          position: 'absolute',
          left: -handleSize / 2 + 2,
          top: winPos * PIXELS_PER_UNIT + winWidthPx / 2 - handleSize / 2,
          width: handleSize,
          height: handleSize,
          cursor: 'ns-resize',
          zIndex: 20,
        };
      } else if (wall === 'right') {
        style = {
          position: 'absolute',
          left: roomDims.width * PIXELS_PER_UNIT - 6,
          top: winPos * PIXELS_PER_UNIT,
          width: 8,
          height: winWidthPx,
          backgroundColor: '#93c5fd',
          border: '2px solid #3b82f6',
          borderRadius: 2,
          zIndex: 11,
          cursor: 'ns-resize',
        };
        handleStyle = {
          position: 'absolute',
          left: roomDims.width * PIXELS_PER_UNIT - handleSize / 2,
          top: winPos * PIXELS_PER_UNIT + winWidthPx / 2 - handleSize / 2,
          width: handleSize,
          height: handleSize,
          cursor: 'ns-resize',
          zIndex: 20,
        };
      }
      
      // Compute jamb line positions for windows based on wall
      if (isHorizontal) {
        // Top or Bottom walls - jambs are vertical lines
        const yBase = wall === 'top' ? -jambLength / 2 : roomDims.height * PIXELS_PER_UNIT - jambLength / 2;
        jambLine1Style = {
          position: 'absolute',
          left: winPos * PIXELS_PER_UNIT - jambWidth / 2,
          top: yBase,
          width: jambWidth,
          height: jambLength,
          backgroundColor: jambColor,
          zIndex: 11
        };
        jambLine2Style = {
          position: 'absolute',
          left: (winPos * PIXELS_PER_UNIT) + winWidthPx - jambWidth / 2,
          top: yBase,
          width: jambWidth,
          height: jambLength,
          backgroundColor: jambColor,
          zIndex: 11
        };
        // Gap style for horizontal walls
        if (!gapStyle.position) {
          const wallY = wall === 'top' ? -wallThickness / 2 : roomDims.height * PIXELS_PER_UNIT - wallThickness / 2;
          gapStyle = {
            position: 'absolute',
            left: winPos * PIXELS_PER_UNIT,
            top: wallY,
            width: winWidthPx,
            height: wallThickness,
            backgroundColor: 'white',
            zIndex: 10
          };
        }
      } else {
        // Left or Right walls - jambs are horizontal lines
        const xBase = wall === 'left' ? -jambLength / 2 : roomDims.width * PIXELS_PER_UNIT - jambLength / 2;
        jambLine1Style = {
          position: 'absolute',
          left: xBase,
          top: winPos * PIXELS_PER_UNIT - jambWidth / 2,
          width: jambLength,
          height: jambWidth,
          backgroundColor: jambColor,
          zIndex: 11
        };
        jambLine2Style = {
          position: 'absolute',
          left: xBase,
          top: (winPos * PIXELS_PER_UNIT) + winWidthPx - jambWidth / 2,
          width: jambLength,
          height: jambWidth,
          backgroundColor: jambColor,
          zIndex: 11
        };
        // Gap style for vertical walls
        const wallX = wall === 'left' ? -wallThickness / 2 : roomDims.width * PIXELS_PER_UNIT - wallThickness / 2;
        gapStyle = {
          position: 'absolute',
          left: wallX,
          top: winPos * PIXELS_PER_UNIT,
          width: wallThickness,
          height: winWidthPx,
          backgroundColor: 'white',
          zIndex: 10
        };
      }
      
      return (
        <React.Fragment key={win.id}>
          <div style={gapStyle} />
          {/* Architectural jamb lines showing wall break */}
          <div style={jambLine1Style} />
          <div style={jambLine2Style} />
          <div style={style} />
          {/* Draggable handle - hidden when locked */}
          {!isLocked && (
            <div 
              style={handleStyle}
              className={`rounded-full transition-all ${isActive ? 'bg-blue-500 ring-2 ring-blue-300' : 'bg-blue-400 hover:bg-blue-500'}`}
              onMouseDown={(e) => handleMouseDown(e, win.id, 'drag', 'window')}
              onTouchStart={(e) => handleMouseDown(e, win.id, 'drag', 'window')}
              title="Drag to reposition window"
            />
          )}
        </React.Fragment>
      );
    });
  };

  const fullConfigJson = JSON.stringify(exportConfigInUnits(unitSystem), null, 2);

  return (
    <div className="flex flex-col h-screen bg-slate-50 text-slate-800 font-sans overflow-hidden">
      
      {/* Header */}
      <div className="bg-white border-b border-slate-200 px-3 sm:px-4 py-2 flex justify-between items-center shadow-sm relative z-50 h-12 sm:h-16" style={{ paddingTop: 'max(0.5rem, env(safe-area-inset-top))' }}>
        <div className="flex items-center gap-1.5 sm:gap-2 min-w-0 flex-1">
            {/* File Browser Button */}
            <Tooltip text="My Floor Plans">
              <button 
                onClick={() => setFileBrowserOpen(true)}
                className="p-1.5 sm:p-2 hover:bg-slate-100 rounded-lg text-slate-500 transition-colors shrink-0 flex items-center justify-center"
                aria-label="Open file browser"
              >
                <FolderOpen className="w-4 h-4 sm:w-5 sm:h-5" />
              </button>
            </Tooltip>
            
            <div className="min-w-0 flex-1 max-w-[200px] sm:max-w-none">
              {editingProjectId === 'header' ? (
                <input
                  type="text"
                  value={editingName}
                  onChange={(e) => setEditingName(e.target.value)}
                  onBlur={() => {
                    if (editingName.trim() && currentProjectId) {
                      renameProject(currentProjectId, editingName.trim());
                    }
                    setEditingProjectId(null);
                    setEditingName('');
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      if (editingName.trim() && currentProjectId) {
                        renameProject(currentProjectId, editingName.trim());
                      }
                      setEditingProjectId(null);
                      setEditingName('');
                    } else if (e.key === 'Escape') {
                      setEditingProjectId(null);
                      setEditingName('');
                    }
                  }}
                  className="text-sm font-bold text-slate-800 leading-tight bg-transparent border-b-2 border-indigo-500 outline-none w-full max-w-[200px]"
                  autoFocus
                />
              ) : (
                <button
                  onClick={() => {
                    if (currentProjectId) {
                      setEditingProjectId('header');
                      setEditingName(getCurrentProjectName());
                    } else {
                      const newProject = saveCurrentAsProject('Untitled');
                      if (newProject) {
                        setEditingProjectId('header');
                        setEditingName('Untitled');
                      }
                    }
                  }}
                  className="text-left group hover:bg-slate-50 rounded px-1 -mx-1 transition-colors flex items-center justify-center"
                  title="Click to rename"
                >
                  <h1 className="text-sm font-bold text-slate-800 leading-tight truncate group-hover:text-indigo-600 transition-colors">
                    {getCurrentProjectName()}
                    <Edit3 className="w-3 h-3 inline ml-1 opacity-0 group-hover:opacity-50 transition-opacity" />
                  </h1>
                </button>
              )}
              {/* Dimensions - hidden on mobile, shown on sm+ */}
              <div className="hidden sm:flex items-center gap-1 text-[10px] text-slate-500 -mt-0.5">
                <Maximize2 className="w-3 h-3 shrink-0" />
                <span className="truncate">{feetToDisplay(roomDims.width, unitSystem)} × {feetToDisplay(roomDims.height, unitSystem)} ({roundNum(roomDims.width * roomDims.height, 1)} sq ft)</span>
              </div>
            </div>
        </div>
        
        <div className="flex items-center gap-1 sm:gap-2">
          {/* Save Status Indicator */}
          <div className="hidden sm:flex items-center gap-1.5 text-[10px] text-slate-400">
            {saveStatus === 'saving' ? (
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 bg-amber-400 rounded-full animate-pulse" />
                Saving...
              </span>
            ) : saveStatus === 'saved' && lastSavedAt ? (
              <span className="flex items-center gap-1">
                <Check className="w-3 h-3 text-green-500" />
                Saved {formatTimeAgo(lastSavedAt)}
              </span>
            ) : (
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 bg-slate-300 rounded-full" />
                Unsaved
              </span>
            )}
          </div>
          
          {/* Undo/Redo */}
          <div className="flex items-center">
            <Tooltip text="Undo">
              <button 
                onClick={undo}
                disabled={historyIndex <= 0}
                className="p-1.5 sm:p-2 hover:bg-slate-100 rounded-lg text-slate-500 disabled:opacity-30 disabled:cursor-not-allowed transition-colors flex items-center justify-center"
                aria-label="Undo"
              >
                <Undo2 className="w-4 h-4" />
              </button>
            </Tooltip>
            <Tooltip text="Redo">
              <button 
                onClick={redo}
                disabled={historyIndex >= history.length - 1}
                className="p-1.5 sm:p-2 hover:bg-slate-100 rounded-lg text-slate-500 disabled:opacity-30 disabled:cursor-not-allowed transition-colors flex items-center justify-center"
                aria-label="Redo"
              >
                <Redo2 className="w-4 h-4" />
              </button>
            </Tooltip>
          </div>

          {/* Zoom Controls - only show in header on md+ when sidebar is side-by-side */}
          <div className="hidden md:flex items-center gap-1 bg-slate-50 rounded-lg px-2 py-1">
            <Tooltip text="Zoom out">
              <button 
                onClick={() => setZoom(Math.max(0.25, zoom - 0.25))}
                disabled={zoom <= 0.25}
                className="p-1.5 hover:bg-slate-200 rounded text-slate-600 disabled:opacity-30 disabled:cursor-not-allowed transition-colors flex items-center justify-center"
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
                className="p-1.5 hover:bg-slate-200 rounded text-slate-600 disabled:opacity-30 disabled:cursor-not-allowed transition-colors flex items-center justify-center"
                aria-label="Zoom in"
              >
                <ZoomIn className="w-4 h-4" />
              </button>
            </Tooltip>
            <div className="w-px h-4 bg-slate-300 mx-1" />
            <Tooltip text="Fit to view">
              <button 
                onClick={fitToView}
                className="p-1.5 hover:bg-slate-200 rounded text-slate-600 transition-colors flex items-center justify-center"
                aria-label="Fit to view"
              >
                <Scan className="w-4 h-4" />
              </button>
            </Tooltip>
          </div>

          <button 
            onClick={() => setModalOpen(true)}
            className="flex items-center justify-center gap-1.5 px-2 sm:px-3 py-1.5 sm:py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs sm:text-sm font-medium transition-colors shadow-sm"
            aria-label="Share and save layout"
          >
            <Share2 className="w-4 h-4 shrink-0" />
            <span className="hidden sm:inline">Share / Save</span>
          </button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden relative">
        
        {/* Mobile backdrop overlay */}
        {sidebarOpen && (
          <div 
            className="fixed top-12 sm:top-16 bottom-0 left-0 right-0 bg-slate-900/50 z-40 md:hidden animate-fade-in"
            onClick={() => setSidebarOpen(false)}
            aria-hidden="true"
          />
        )}

        {/* Sidebar - Full screen on mobile, side panel on desktop */}
        <div 
            className={`fixed md:relative top-12 sm:top-16 md:top-auto bottom-0 md:bottom-auto left-0 right-0 md:inset-auto z-[45] bg-white md:border-r border-slate-200 overflow-y-auto overflow-x-hidden scrollbar-thin scrollbar-thumb-slate-300 scrollbar-track-transparent hover:scrollbar-thumb-slate-400 transition-all duration-300 flex flex-col shadow-xl md:shadow-none
            ${sidebarOpen ? 'md:w-80 translate-x-0' : 'md:w-0 -translate-x-full md:opacity-0 md:overflow-hidden'}`}
        >
          {/* Mobile header for sidebar */}
          <div className="md:hidden bg-white px-4 py-3 flex justify-between items-center sticky top-0 z-10 border-b border-slate-200">
            <div className="flex items-center gap-2">
              <div className={`p-1.5 rounded-lg ${designMode === DESIGN_MODES.ROOM_SETUP ? 'bg-indigo-100' : 'bg-emerald-100'}`}>
                {designMode === DESIGN_MODES.ROOM_SETUP 
                  ? <Home className="w-4 h-4 text-indigo-600" />
                  : <Sofa className="w-4 h-4 text-emerald-600" />}
              </div>
              <div>
                <h2 className="font-bold text-slate-800 text-sm leading-tight">
                  {designMode === DESIGN_MODES.ROOM_SETUP ? 'Room Setup' : 'Furniture'}
                </h2>
                <p className="text-[10px] text-slate-500">
                  {designMode === DESIGN_MODES.ROOM_SETUP 
                    ? 'Configure room, doors & windows'
                    : 'Add and arrange furniture'}
                </p>
              </div>
            </div>
            <button 
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setSidebarOpen(false);
              }}
              className={`flex items-center gap-1 px-4 py-2 text-white rounded-lg text-sm font-medium transition-colors active:scale-95 ${
                designMode === DESIGN_MODES.ROOM_SETUP 
                  ? 'bg-indigo-600 hover:bg-indigo-700' 
                  : 'bg-emerald-600 hover:bg-emerald-700'
              }`}
              aria-label="View floor plan"
              type="button"
            >
              <Eye className="w-4 h-4" />
              <span>View</span>
            </button>
          </div>

          {/* Unit System Selector */}
          <div className="bg-indigo-50 p-3 border-b border-indigo-100">
            <div className="flex items-center justify-between gap-2">
              <label className="text-xs font-medium text-indigo-700">Display Units:</label>
              <select 
                value={unitSystem}
                onChange={(e) => setUnitSystem(e.target.value)}
                className="text-xs border border-indigo-200 rounded px-2 py-1.5 bg-white focus:ring-2 focus:ring-indigo-500 outline-none"
              >
                {UNIT_SYSTEMS.map(u => (
                  <option key={u.value} value={u.value}>{u.label}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Design Mode Switcher */}
          <div className="bg-white p-4 border-b border-slate-200">
            <div className="flex items-center gap-2 mb-3">
              <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Design Steps</span>
            </div>
            
            {/* Step Buttons */}
            <div className="flex gap-2">
              <button
                onClick={() => setDesignMode(DESIGN_MODES.ROOM_SETUP)}
                className={`flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg text-xs font-medium transition-all ${
                  designMode === DESIGN_MODES.ROOM_SETUP 
                    ? 'bg-indigo-600 text-white shadow-md' 
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                <Home className="w-4 h-4" />
                <span className="hidden sm:inline">1. Room Setup</span>
                <span className="sm:hidden">1. Room</span>
              </button>
              
              <button
                onClick={() => setDesignMode(DESIGN_MODES.FURNITURE)}
                className={`flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg text-xs font-medium transition-all ${
                  designMode === DESIGN_MODES.FURNITURE 
                    ? 'bg-emerald-600 text-white shadow-md' 
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                <Sofa className="w-4 h-4" />
                <span className="hidden sm:inline">2. Furniture</span>
                <span className="sm:hidden">2. Items</span>
              </button>
            </div>
            
            {/* Mode Description */}
            <div className={`mt-3 p-2 rounded-lg text-[11px] ${
              designMode === DESIGN_MODES.ROOM_SETUP 
                ? 'bg-indigo-50 text-indigo-700' 
                : 'bg-emerald-50 text-emerald-700'
            }`}>
              {designMode === DESIGN_MODES.ROOM_SETUP ? (
                <div className="flex items-center gap-2">
                  <Lock className="w-3 h-3 shrink-0" />
                  <span>Set up your room, doors & windows. Furniture is locked.</span>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <Lock className="w-3 h-3 shrink-0" />
                  <span>Arrange furniture. Room layout is locked.</span>
                </div>
              )}
            </div>
          </div>

          <div className="bg-slate-50 p-3 text-xs text-slate-600 border-b border-slate-100 flex gap-2 items-center">
            <Info className="w-4 h-4 shrink-0 text-slate-400" />
            <p>You can type values with units (e.g., <strong>12'6"</strong>, <strong>150cm</strong>, <strong>1.5m</strong>)</p>
          </div>

          <div className="p-4 space-y-4 min-w-0 md:min-w-[20rem]">
            
            {/* ===== ROOM SETUP GROUP ===== */}
            <div className={`rounded-xl border-2 transition-all duration-300 ${
              designMode === DESIGN_MODES.ROOM_SETUP 
                ? 'border-indigo-200 bg-white shadow-sm' 
                : 'border-slate-200 bg-slate-50'
            }`}>
              {/* Group Header */}
              <button
                onClick={() => {
                  if (designMode === DESIGN_MODES.FURNITURE) {
                    setRoomSetupExpanded(!roomSetupExpanded);
                  }
                }}
                className={`w-full flex items-center justify-between p-3 ${
                  designMode === DESIGN_MODES.FURNITURE ? 'cursor-pointer hover:bg-slate-100' : 'cursor-default'
                } rounded-t-xl transition-colors`}
              >
                <div className="flex items-center gap-2">
                  <div className={`p-1.5 rounded-lg ${
                    designMode === DESIGN_MODES.ROOM_SETUP 
                      ? 'bg-indigo-100 text-indigo-600' 
                      : 'bg-slate-200 text-slate-500'
                  }`}>
                    <Home className="w-4 h-4" />
                  </div>
                  <div className="text-left">
                    <span className="text-sm font-semibold text-slate-700 block">Room Setup</span>
                    <span className="text-[10px] text-slate-500">
                      {feetToDisplay(roomDims.width, unitSystem)} × {feetToDisplay(roomDims.height, unitSystem)} • {doors.length} door{doors.length !== 1 ? 's' : ''} • {windows.length} window{windows.length !== 1 ? 's' : ''}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {designMode === DESIGN_MODES.FURNITURE && (
                    <>
                      <span className="text-[10px] text-slate-400 flex items-center gap-1">
                        <Lock className="w-3 h-3" /> Locked
                      </span>
                      {roomSetupExpanded ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
                    </>
                  )}
                  {designMode === DESIGN_MODES.ROOM_SETUP && (
                    <span className="text-[10px] text-indigo-600 font-medium px-2 py-0.5 bg-indigo-100 rounded-full">Editing</span>
                  )}
                </div>
              </button>
              
              {/* Unlock button when in furniture mode */}
              {designMode === DESIGN_MODES.FURNITURE && roomSetupExpanded && (
                <div className="px-3 pb-2">
                  <button
                    onClick={() => setDesignMode(DESIGN_MODES.ROOM_SETUP)}
                    className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-600 rounded-lg text-xs font-medium transition-colors"
                  >
                    <Unlock className="w-3 h-3" />
                    Switch to Room Setup Mode
                  </button>
                </div>
              )}
              
              {/* Room Setup Content */}
              {(designMode === DESIGN_MODES.ROOM_SETUP || roomSetupExpanded) && (
                <div className={`p-4 pt-2 space-y-6 border-t border-slate-100 ${
                  designMode === DESIGN_MODES.FURNITURE ? 'opacity-60 pointer-events-none' : ''
                }`}>
                  
                  {/* Room Dimensions */}
                  <section>
                    <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Room Dimensions</h2>
                    <div className="grid grid-cols-2 gap-3">
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
                          unitSystem={unitSystem}
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
                          unitSystem={unitSystem}
                        />
                      </div>
                    </div>
                    <div className="mt-2 text-xs text-slate-500">
                      Total area: <strong>{roundNum(roomDims.width * roomDims.height, 1)} sq ft</strong>
                    </div>
                  </section>

                  {/* Doors Section */}
                  <section>
                    <div className="flex justify-between items-center mb-3">
                      <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Doors</h2>
                      <button 
                        onClick={addDoor}
                        className="flex items-center gap-1 text-xs bg-indigo-50 text-indigo-600 hover:bg-indigo-100 px-2 py-1 rounded font-medium transition-colors"
                        aria-label="Add new door"
                      >
                        <Plus className="w-3 h-3" /> Add Door
                      </button>
                    </div>
                    
                    <div className="space-y-3">
                      {doors.map((door, index) => {
                        const wallLen = getWallLength(door.wall);
                        return (
                          <div key={door.id} className="p-3 bg-white rounded-lg border border-slate-200">
                            <div className="flex justify-between items-center mb-2">
                              <span className="text-xs font-medium text-slate-700">Door {index + 1}</span>
                              <button 
                                onClick={() => deleteDoor(door.id)}
                                className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors flex items-center justify-center"
                                aria-label="Delete door"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                            
                            <div className="grid grid-cols-2 gap-2 mb-2">
                              <div>
                                <label className="block text-[10px] text-slate-500 mb-1">Wall</label>
                                <select 
                                  value={door.wall}
                                  onChange={(e) => updateDoor(door.id, { wall: e.target.value })}
                                  className="w-full p-1.5 text-xs border border-slate-200 rounded focus:ring-2 focus:ring-indigo-500 outline-none bg-white"
                                >
                                  {WALL_OPTIONS.map(w => (
                                    <option key={w} value={w}>{w.charAt(0).toUpperCase() + w.slice(1)}</option>
                                  ))}
                                </select>
                              </div>
                              <div>
                                <label className="block text-[10px] text-slate-500 mb-1">Type</label>
                                <select 
                                  value={door.type}
                                  onChange={(e) => updateDoor(door.id, { type: e.target.value })}
                                  className="w-full p-1.5 text-xs border border-slate-200 rounded focus:ring-2 focus:ring-indigo-500 outline-none bg-white"
                                >
                                  {DOOR_TYPES.map(t => (
                                    <option key={t.value} value={t.value}>{t.label}</option>
                                  ))}
                                </select>
                              </div>
                            </div>
                            
                            <div className="grid grid-cols-2 gap-2 mb-2">
                              <div>
                                <label className="block text-[10px] text-slate-500 mb-1">Width</label>
                                <DimensionInput 
                                  value={door.width}
                                  onChange={(val) => updateDoor(door.id, { width: val })}
                                  className="w-full p-1.5 text-xs border border-slate-200 rounded focus:ring-2 focus:ring-indigo-500 outline-none"
                                  min={1}
                                  max={wallLen}
                                  label="Door width"
                                  unitSystem={unitSystem}
                                />
                              </div>
                              <div>
                                <label className="block text-[10px] text-slate-500 mb-1">Position</label>
                                <DimensionInput 
                                  value={door.position}
                                  onChange={(val) => updateDoor(door.id, { position: val })}
                                  className="w-full p-1.5 text-xs border border-slate-200 rounded focus:ring-2 focus:ring-indigo-500 outline-none"
                                  min={0}
                                  max={Math.max(0, wallLen - door.width)}
                                  label="Door position"
                                  unitSystem={unitSystem}
                                />
                              </div>
                            </div>
                            
                            {door.type !== 'sliding' && (
                              <button 
                                onClick={() => updateDoor(door.id, { hinge: door.hinge === 'left' ? 'right' : 'left' })}
                                className="w-full py-1.5 px-2 bg-slate-100 hover:bg-slate-200 rounded text-[10px] font-medium text-slate-600 flex items-center justify-center gap-1 transition-colors"
                              >
                                <ArrowLeftRight className="w-3 h-3" /> Hinge: {door.hinge === 'left' ? 'Left' : 'Right'}
                              </button>
                            )}
                          </div>
                        );
                      })}
                      
                      {doors.length === 0 && (
                        <div className="text-center py-3 text-slate-400 text-xs italic border-2 border-dashed border-slate-200 rounded-lg">
                          No doors added yet
                        </div>
                      )}
                    </div>
                  </section>

                  {/* Windows Section */}
                  <section>
                    <div className="flex justify-between items-center mb-3">
                      <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Windows</h2>
                      <button 
                        onClick={addWindow}
                        className="flex items-center gap-1 text-xs bg-blue-50 text-blue-600 hover:bg-blue-100 px-2 py-1 rounded font-medium transition-colors"
                        aria-label="Add new window"
                      >
                        <Plus className="w-3 h-3" /> Add Window
                      </button>
                    </div>
                    
                    <div className="space-y-3">
                      {windows.map((win, index) => {
                        const wallLen = getWallLength(win.wall);
                        return (
                          <div key={win.id} className="p-3 bg-blue-50/30 rounded-lg border border-blue-100">
                            <div className="flex justify-between items-center mb-2">
                              <span className="text-xs font-medium text-slate-700">Window {index + 1}</span>
                              <button 
                                onClick={() => deleteWindow(win.id)}
                                className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors flex items-center justify-center"
                                aria-label="Delete window"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                            
                            <div className="grid grid-cols-3 gap-2">
                              <div>
                                <label className="block text-[10px] text-slate-500 mb-1">Wall</label>
                                <select 
                                  value={win.wall}
                                  onChange={(e) => updateWindow(win.id, { wall: e.target.value })}
                                  className="w-full p-1.5 text-xs border border-slate-200 rounded focus:ring-2 focus:ring-blue-500 outline-none bg-white"
                                >
                                  {WALL_OPTIONS.map(w => (
                                    <option key={w} value={w}>{w.charAt(0).toUpperCase() + w.slice(1)}</option>
                                  ))}
                                </select>
                              </div>
                              <div>
                                <label className="block text-[10px] text-slate-500 mb-1">Width</label>
                                <DimensionInput 
                                  value={win.width}
                                  onChange={(val) => updateWindow(win.id, { width: val })}
                                  className="w-full p-1.5 text-xs border border-slate-200 rounded focus:ring-2 focus:ring-blue-500 outline-none"
                                  min={0.5}
                                  max={wallLen}
                                  label="Window width"
                                  unitSystem={unitSystem}
                                />
                              </div>
                              <div>
                                <label className="block text-[10px] text-slate-500 mb-1">Position</label>
                                <DimensionInput 
                                  value={win.position}
                                  onChange={(val) => updateWindow(win.id, { position: val })}
                                  className="w-full p-1.5 text-xs border border-slate-200 rounded focus:ring-2 focus:ring-blue-500 outline-none"
                                  min={0}
                                  max={Math.max(0, wallLen - win.width)}
                                  label="Window position"
                                  unitSystem={unitSystem}
                                />
                              </div>
                            </div>
                          </div>
                        );
                      })}
                      
                      {windows.length === 0 && (
                        <div className="text-center py-3 text-slate-400 text-xs italic border-2 border-dashed border-blue-100 rounded-lg">
                          No windows added yet
                        </div>
                      )}
                    </div>
                  </section>
                  
                  {/* Continue to Furniture button */}
                  {designMode === DESIGN_MODES.ROOM_SETUP && (
                    <button
                      onClick={() => setDesignMode(DESIGN_MODES.FURNITURE)}
                      className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-medium transition-colors shadow-sm"
                    >
                      Continue to Furniture
                      <ArrowRight className="w-4 h-4" />
                    </button>
                  )}
                </div>
              )}
            </div>
            
            {/* ===== FURNITURE GROUP ===== */}
            <div className={`rounded-xl border-2 transition-all duration-300 ${
              designMode === DESIGN_MODES.FURNITURE 
                ? 'border-emerald-200 bg-white shadow-sm' 
                : 'border-slate-200 bg-slate-50'
            }`}>
              {/* Group Header */}
              <button
                onClick={() => {
                  if (designMode === DESIGN_MODES.ROOM_SETUP) {
                    setFurnitureExpanded(!furnitureExpanded);
                  }
                }}
                className={`w-full flex items-center justify-between p-3 ${
                  designMode === DESIGN_MODES.ROOM_SETUP ? 'cursor-pointer hover:bg-slate-100' : 'cursor-default'
                } rounded-t-xl transition-colors`}
              >
                <div className="flex items-center gap-2">
                  <div className={`p-1.5 rounded-lg ${
                    designMode === DESIGN_MODES.FURNITURE 
                      ? 'bg-emerald-100 text-emerald-600' 
                      : 'bg-slate-200 text-slate-500'
                  }`}>
                    <Sofa className="w-4 h-4" />
                  </div>
                  <div className="text-left">
                    <span className="text-sm font-semibold text-slate-700 block">Furniture</span>
                    <span className="text-[10px] text-slate-500">
                      {items.length} item{items.length !== 1 ? 's' : ''}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {designMode === DESIGN_MODES.ROOM_SETUP && (
                    <>
                      <span className="text-[10px] text-slate-400 flex items-center gap-1">
                        <Lock className="w-3 h-3" /> Locked
                      </span>
                      {furnitureExpanded ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
                    </>
                  )}
                  {designMode === DESIGN_MODES.FURNITURE && (
                    <span className="text-[10px] text-emerald-600 font-medium px-2 py-0.5 bg-emerald-100 rounded-full">Editing</span>
                  )}
                </div>
              </button>
              
              {/* Unlock button when in room-setup mode */}
              {designMode === DESIGN_MODES.ROOM_SETUP && furnitureExpanded && (
                <div className="px-3 pb-2">
                  <button
                    onClick={() => setDesignMode(DESIGN_MODES.FURNITURE)}
                    className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-emerald-50 hover:bg-emerald-100 text-emerald-600 rounded-lg text-xs font-medium transition-colors"
                  >
                    <Unlock className="w-3 h-3" />
                    Switch to Furniture Mode
                  </button>
                </div>
              )}
              
              {/* Furniture Content */}
              {(designMode === DESIGN_MODES.FURNITURE || furnitureExpanded) && (
                <div className={`p-4 pt-2 space-y-4 border-t border-slate-100 ${
                  designMode === DESIGN_MODES.ROOM_SETUP ? 'opacity-60 pointer-events-none' : ''
                }`}>
                  <div className="flex justify-end">
                    <button 
                      onClick={addItem}
                      className="flex items-center gap-1 text-xs bg-emerald-50 text-emerald-600 hover:bg-emerald-100 px-2 py-1 rounded font-medium transition-colors"
                      aria-label="Add new furniture item"
                    >
                      <Plus className="w-3 h-3" /> Add Item
                    </button>
                  </div>

                  <div className="space-y-3">
                    {items.map((item) => {
                      const colorButtonRef = React.createRef();
                      const isSelected = activeId === item.id && activeType === 'item';
                      const isItemLocked = item.locked;
                      
                      // Check for warnings (collision/out-of-bounds)
                      const isOutOfBounds = !isItemInBounds(item, roomDims);
                      const hasCollision = items.some(other => 
                        other.id !== item.id && 
                        other.visible !== false && 
                        checkItemsCollision(item, other)
                      );
                      const hasWarning = item.visible !== false && (isOutOfBounds || hasCollision);
                      const warningText = isOutOfBounds && hasCollision 
                        ? 'Outside room & overlapping' 
                        : isOutOfBounds 
                          ? 'Outside room bounds' 
                          : 'Overlapping furniture';
                      
                      return (
                      <div 
                        key={item.id} 
                        className={`p-3 bg-white rounded-lg border transition-all duration-200 cursor-pointer hover:border-emerald-300 ${item.visible === false ? 'opacity-60 border-dashed' : 'border-slate-200'} ${isSelected ? 'ring-2 ring-emerald-500' : ''} ${isItemLocked ? 'bg-slate-50' : ''} ${hasWarning ? 'border-red-300 bg-red-50/50' : ''} overflow-hidden`}
                        onClick={() => { setActiveId(item.id); setActiveType('item'); }}
                      >
                        <div className="flex justify-between items-center mb-3 gap-2">
                          <div className="flex items-center gap-2 flex-1 min-w-0 relative">
                            {hasWarning && (
                              <div className="w-5 h-5 bg-red-100 rounded flex items-center justify-center shrink-0" title={warningText}>
                                <AlertTriangle className="w-3 h-3 text-red-500" />
                              </div>
                            )}
                            {isItemLocked && !hasWarning && (
                              <div className="w-5 h-5 bg-amber-100 rounded flex items-center justify-center shrink-0" title="Locked">
                                <Lock className="w-3 h-3 text-amber-600" />
                              </div>
                            )}
                            <button
                              ref={colorButtonRef}
                              onClick={(e) => { e.stopPropagation(); if (!isItemLocked) setShowColorPicker(showColorPicker === item.id ? null : item.id); }}
                              className={`w-6 h-6 rounded-full border-2 border-slate-300 transition-colors shrink-0 ${isItemLocked ? 'cursor-not-allowed opacity-60' : 'hover:border-emerald-500 cursor-pointer'}`}
                              style={{ backgroundColor: migrateColor(item.color) }}
                              aria-label="Change item color"
                              data-color-button
                              disabled={isItemLocked}
                            />
                            {!isMobile && showColorPicker === item.id && !isItemLocked && (
                              <ColorPicker
                                currentColor={migrateColor(item.color)}
                                onChange={(color) => {
                                  setItems(items.map(i => i.id === item.id ? { ...i, color } : i));
                                  saveToHistory();
                                }}
                                onClose={() => setShowColorPicker(null)}
                                isMobile={false}
                                triggerRef={colorButtonRef}
                              />
                            )}
                            <input 
                              value={item.label}
                              onChange={(e) => setItems(items.map(i => i.id === item.id ? { ...i, label: e.target.value } : i))}
                              onBlur={saveToHistory}
                              onClick={(e) => e.stopPropagation()}
                              className={`bg-transparent font-medium text-slate-700 border-b border-transparent outline-none min-w-0 flex-1 text-sm truncate ${isItemLocked ? 'cursor-not-allowed' : 'hover:border-slate-300 focus:border-emerald-500'}`}
                              aria-label="Item label"
                              readOnly={isItemLocked}
                            />
                          </div>
                          <div className="flex items-center shrink-0">
                            <Tooltip text={isItemLocked ? "Unlock" : "Lock"}>
                              <button 
                                onClick={(e) => { e.stopPropagation(); toggleLock(item.id); }}
                                className={`p-1.5 rounded transition-colors flex items-center justify-center ${isItemLocked ? 'text-amber-600 bg-amber-50 hover:bg-amber-100' : 'text-slate-400 hover:text-amber-600 hover:bg-amber-50'}`}
                              >
                                {isItemLocked ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
                              </button>
                            </Tooltip>
                            <Tooltip text={item.visible !== false ? "Hide" : "Show"}>
                              <button 
                                onClick={(e) => { e.stopPropagation(); toggleVisibility(item.id); }}
                                className="p-1.5 text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 rounded transition-colors flex items-center justify-center"
                              >
                                {item.visible !== false ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                              </button>
                            </Tooltip>
                            <Tooltip text="Delete">
                              <button 
                                onClick={(e) => { e.stopPropagation(); deleteItem(item.id); }}
                                className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors flex items-center justify-center"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </Tooltip>
                          </div>
                        </div>
                        
                        {/* Warning message for collision or out-of-bounds */}
                        {hasWarning && (
                          <div className="mb-2 py-1.5 px-2 bg-red-50 border border-red-200 rounded text-center">
                            <p className="text-[10px] text-red-600 flex items-center justify-center gap-1">
                              <AlertTriangle className="w-3 h-3" />
                              {warningText}
                            </p>
                          </div>
                        )}
                        
                        {/* Show locked message or editable inputs */}
                        {isItemLocked ? (
                          <div className="py-3 px-2 bg-amber-50 border border-amber-200 rounded-lg text-center">
                            <p className="text-xs text-amber-700 flex items-center justify-center gap-1.5">
                              <Lock className="w-3 h-3" />
                              Position and size locked
                            </p>
                            <p className="text-[10px] text-amber-600 mt-1">Click the lock icon to unlock</p>
                          </div>
                        ) : (
                        <>
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="text-[10px] text-slate-500">Width</label>
                            <DimensionInput 
                              value={item.width}
                              onChange={(val) => {
                                setItems(items.map(i => i.id === item.id ? { ...i, width: val } : i));
                                saveToHistory();
                              }}
                              className="w-full p-1.5 text-xs border border-slate-200 rounded"
                              min={0.1}
                              max={roomDims.width}
                              label={`Width of ${item.label}`}
                              unitSystem={unitSystem}
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
                              className="w-full p-1.5 text-xs border border-slate-200 rounded"
                              min={0.1}
                              max={roomDims.height}
                              label={`Depth of ${item.label}`}
                              unitSystem={unitSystem}
                            />
                          </div>
                        </div>
                        
                        {/* Position inputs */}
                        <div className="grid grid-cols-3 gap-2 mt-3">
                          <div>
                            <label className="text-[10px] text-slate-500">X Position</label>
                            <DimensionInput 
                              value={item.x}
                              onChange={(val) => {
                                const clampedX = clamp(val, 0, roomDims.width - item.width);
                                setItems(items.map(i => i.id === item.id ? { ...i, x: clampedX } : i));
                                saveToHistory();
                              }}
                              className="w-full p-1.5 text-xs border border-slate-200 rounded"
                              min={0}
                              max={roomDims.width - item.width}
                              label={`X position of ${item.label}`}
                              unitSystem={unitSystem}
                            />
                          </div>
                          <div>
                            <label className="text-[10px] text-slate-500">Y Position</label>
                            <DimensionInput 
                              value={item.y}
                              onChange={(val) => {
                                const clampedY = clamp(val, 0, roomDims.height - item.height);
                                setItems(items.map(i => i.id === item.id ? { ...i, y: clampedY } : i));
                                saveToHistory();
                              }}
                              className="w-full p-1.5 text-xs border border-slate-200 rounded"
                              min={0}
                              max={roomDims.height - item.height}
                              label={`Y position of ${item.label}`}
                              unitSystem={unitSystem}
                            />
                          </div>
                          <div>
                            <label className="text-[10px] text-slate-500">Rotation °</label>
                            <input 
                              type="number"
                              value={Math.round(((item.rotation % 360) + 360) % 360)}
                              onChange={(e) => {
                                const val = parseFloat(e.target.value) || 0;
                                setItems(items.map(i => i.id === item.id ? { ...i, rotation: val } : i));
                              }}
                              onBlur={saveToHistory}
                              className="w-full p-1.5 text-xs border border-slate-200 rounded focus:ring-2 focus:ring-emerald-500 outline-none"
                              min={0}
                              max={360}
                              step={1}
                              aria-label={`Rotation of ${item.label}`}
                            />
                          </div>
                        </div>
                        </>
                        )}
                      </div>
                    )})}
                    {items.length === 0 && (
                      <div className="text-center py-6 text-slate-400 text-xs italic border-2 border-dashed border-slate-200 rounded-lg">
                        No furniture added. Click "Add Item" to start.
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

          </div>
        </div>

        {/* Floating Action Button for Mobile */}
        {!sidebarOpen && isMobile && (
          <button
            onClick={() => {
              setSidebarOpen(true);
              setActiveId(null);
            }}
            className={`fixed bottom-6 right-6 z-40 text-white rounded-full pl-4 pr-5 py-3 shadow-lg flex items-center gap-2 transition-all active:scale-95 animate-fade-in ${
              designMode === DESIGN_MODES.ROOM_SETUP 
                ? 'bg-indigo-600 hover:bg-indigo-700' 
                : 'bg-emerald-600 hover:bg-emerald-700'
            }`}
            aria-label={designMode === DESIGN_MODES.ROOM_SETUP ? "Edit room settings" : "Edit furniture"}
          >
            {designMode === DESIGN_MODES.ROOM_SETUP 
              ? <><Home className="w-5 h-5" /><span className="text-sm font-medium">Edit Room</span></>
              : <><Sofa className="w-5 h-5" /><span className="text-sm font-medium">Edit Furniture</span></>}
          </button>
        )}

        {/* Floating Zoom Controls - show on smaller screens when sidebar isn't covering canvas */}
        {!sidebarOpen && (
          <div className="fixed bottom-6 left-4 z-40 flex md:hidden items-center gap-1 bg-white/95 backdrop-blur-sm rounded-full shadow-lg px-2 py-1.5 animate-fade-in" style={{ paddingBottom: 'max(0.375rem, env(safe-area-inset-bottom))' }}>
            <button 
              onClick={() => setZoom(Math.max(0.25, zoom - 0.25))}
              disabled={zoom <= 0.25}
              className="p-2 hover:bg-slate-100 rounded-full text-slate-600 disabled:opacity-30 disabled:cursor-not-allowed transition-colors flex items-center justify-center"
              aria-label="Zoom out"
            >
              <ZoomOut className="w-5 h-5" />
            </button>
            <span className="text-xs font-medium text-slate-600 min-w-[3rem] text-center">{Math.round(zoom * 100)}%</span>
            <button 
              onClick={() => setZoom(Math.min(3, zoom + 0.25))}
              disabled={zoom >= 3}
              className="p-2 hover:bg-slate-100 rounded-full text-slate-600 disabled:opacity-30 disabled:cursor-not-allowed transition-colors flex items-center justify-center"
              aria-label="Zoom in"
            >
              <ZoomIn className="w-5 h-5" />
            </button>
            <div className="w-px h-5 bg-slate-300 mx-1" />
            <button 
              onClick={fitToView}
              className="p-2 hover:bg-slate-100 rounded-full text-slate-600 transition-colors flex items-center justify-center"
              aria-label="Fit to view"
            >
              <Scan className="w-5 h-5" />
            </button>
          </div>
        )}

        {/* Canvas */}
        <div 
          className="flex-1 bg-slate-100 overflow-hidden relative w-full"
          ref={containerRef}
          data-pan-area
        >
          {/* Mode indicator badge */}
          {!(isMobile && sidebarOpen) && (
            <div className={`absolute top-4 left-1/2 -translate-x-1/2 px-3 sm:px-4 py-2 rounded-full shadow-lg text-[11px] sm:text-xs z-20 pointer-events-none animate-fade-in backdrop-blur-sm ${
              designMode === DESIGN_MODES.ROOM_SETUP 
                ? 'bg-indigo-600/90 text-white' 
                : 'bg-emerald-600/90 text-white'
            }`}>
              {designMode === DESIGN_MODES.ROOM_SETUP ? (
                <>
                  <Home className="w-3 h-3 inline mr-1 -mt-0.5" />
                  <span className="hidden sm:inline">Room Setup Mode • Drag door/window handles to reposition</span>
                  <span className="sm:hidden">Drag handles to reposition</span>
                </>
              ) : (
                <>
                  <Sofa className="w-3 h-3 inline mr-1 -mt-0.5" />
                  <span className="hidden sm:inline">Furniture Mode • Drag to move • Handle to rotate</span>
                  <span className="sm:hidden">Drag to move • Handle to rotate</span>
                </>
              )}
            </div>
          )}

          {/* Room - centered with transform, supports pan and zoom */}
          <div 
            className="absolute inset-0 flex items-center justify-center"
            style={{
              transform: `translate(${panOffset.x}px, ${panOffset.y}px)`
            }}
            data-pan-area
          >
            <div 
              className="bg-white shadow-2xl relative flex-shrink-0"
              style={{
                width: roomDims.width * PIXELS_PER_UNIT,
                height: roomDims.height * PIXELS_PER_UNIT,
                border: '4px solid #334155',
                transform: `scale(${zoom})`,
                transformOrigin: 'center'
              }}
            >
            {renderGrid()}
            {renderDoors()}
            {renderWindows()}

            {items.filter(i => i.visible !== false).map((item) => {
              const isActive = activeId === item.id && activeType === 'item';
              const isModeLockedFurniture = designMode === DESIGN_MODES.ROOM_SETUP;
              const isItemLocked = item.locked;
              const isLocked = isModeLockedFurniture || isItemLocked;
              const itemColor = migrateColor(item.color);
              
              // Check for collisions and out-of-bounds
              const isOutOfBounds = !isItemInBounds(item, roomDims);
              const collidingItems = items.filter(other => 
                other.id !== item.id && 
                other.visible !== false && 
                checkItemsCollision(item, other)
              );
              const hasCollision = collidingItems.length > 0;
              const hasWarning = isOutOfBounds || hasCollision;
              
              // Determine border color based on state
              let borderColor = getBorderColor(itemColor);
              let borderWidth = '2px';
              if (hasWarning) {
                borderColor = '#ef4444'; // red-500
                borderWidth = '3px';
              } else if (isItemLocked && !isModeLockedFurniture) {
                borderColor = '#d97706'; // amber-600
                borderWidth = '3px';
              }
              
              return (
                <div
                  key={item.id}
                  onMouseDown={(e) => handleMouseDown(e, item.id, 'drag', 'item')}
                  onTouchStart={(e) => handleMouseDown(e, item.id, 'drag', 'item')}
                  onClick={() => { setActiveId(item.id); setActiveType('item'); }}
                  className={`absolute flex items-center justify-center text-xs font-bold text-slate-700 select-none transition-shadow rounded-md ${
                    isModeLockedFurniture 
                      ? 'cursor-not-allowed opacity-50' 
                      : isItemLocked 
                        ? 'cursor-pointer'
                        : 'cursor-grab active:cursor-grabbing'
                  }`}
                  style={{
                    width: item.width * PIXELS_PER_UNIT,
                    height: item.height * PIXELS_PER_UNIT,
                    transform: `translate(${item.x * PIXELS_PER_UNIT}px, ${item.y * PIXELS_PER_UNIT}px) rotate(${item.rotation}deg)`,
                    backgroundColor: itemColor,
                    borderColor: borderColor,
                    borderWidth: borderWidth,
                    zIndex: isActive ? 50 : 10,
                    boxShadow: isActive && !isLocked ? '0 8px 20px -4px rgba(0, 0, 0, 0.15)' : '0 1px 3px rgba(0, 0, 0, 0.08)',
                    touchAction: 'none'
                  }}
                  role="button"
                  tabIndex={0}
                  aria-label={`${item.label}, ${feetToDisplay(item.width, unitSystem)} by ${feetToDisplay(item.height, unitSystem)}${isLocked ? ' (locked)' : ''}${hasWarning ? ' (warning)' : ''}`}
                >
                  <span className="truncate px-1">{item.label}</span>
                  
                  {/* Warning indicator for collision or out-of-bounds */}
                  {hasWarning && (
                    <div 
                      className="absolute -top-2 -left-2 w-5 h-5 bg-red-500 rounded-full flex items-center justify-center shadow-md"
                      title={isOutOfBounds && hasCollision ? 'Outside room & overlapping' : isOutOfBounds ? 'Outside room bounds' : 'Overlapping with other furniture'}
                    >
                      <AlertTriangle className="w-3 h-3 text-white" />
                    </div>
                  )}
                  
                  {/* Lock indicator when mode locks all furniture */}
                  {isModeLockedFurniture && (
                    <div className="absolute -top-2 -right-2 w-5 h-5 bg-slate-600 rounded-full flex items-center justify-center shadow-md">
                      <Lock className="w-3 h-3 text-white" />
                    </div>
                  )}
                  
                  {/* Lock indicator when individual item is locked */}
                  {isItemLocked && !isModeLockedFurniture && (
                    <div className="absolute -top-2 -right-2 w-5 h-5 bg-amber-500 rounded-full flex items-center justify-center shadow-md">
                      <Lock className="w-3 h-3 text-white" />
                    </div>
                  )}
                  
                  {isActive && !isLocked && (
                    <div 
                       onMouseDown={(e) => handleMouseDown(e, item.id, 'rotate', 'item')}
                       onTouchStart={(e) => handleMouseDown(e, item.id, 'rotate', 'item')}
                       className={`absolute -top-8 left-1/2 -translate-x-1/2 w-8 h-8 md:w-6 md:h-6 bg-white border-2 rounded-full flex items-center justify-center cursor-crosshair hover:scale-110 transition-all z-50 shadow-md
                       ${isRotating && isSnapped ? 'border-emerald-500' : 'border-emerald-500'}`}
                       style={{ touchAction: 'none' }}
                       aria-label="Rotate handle"
                    >
                       <RotateCw className={`w-4 h-4 md:w-3 md:h-3 ${isRotating && isSnapped ? 'text-emerald-600' : 'text-emerald-500'}`} />
                    </div>
                  )}
                  
                  {isActive && !isLocked && (
                      <div className={`absolute -top-8 left-1/2 h-8 w-0.5 -z-10 origin-bottom transition-colors
                      ${isRotating && isSnapped ? 'bg-emerald-500' : 'bg-emerald-500'}`}></div>
                  )}
                </div>
              );
            })}
          </div>
          </div>
        </div>
      </div>

      {/* Import/Export Modal */}
      <Modal isOpen={modalOpen} onClose={() => setModalOpen(false)} title="Share & Save Layout">
          <div className="space-y-6">
              
              {/* URL Share Section */}
              <div>
                  <label className="text-sm font-medium text-slate-700 mb-2 flex items-center gap-2">
                      <Share2 className="w-4 h-4" /> Direct Link (Snapshot)
                  </label>
                  <p className="text-[10px] text-slate-500 mb-2">
                    This link captures your current layout. Any changes you make after sharing won't be reflected — it's a snapshot, not a live link.
                  </p>
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

      {/* File Browser Modal */}
      <Modal isOpen={fileBrowserOpen} onClose={() => { setFileBrowserOpen(false); setSelectedProjects([]); setEditingProjectId(null); }} title="My Floor Plans">
        <div className="space-y-4">
          {/* Action Bar */}
          <div className="flex flex-wrap gap-2 pb-3 border-b border-slate-200">
            <button
              onClick={createNewProject}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-medium transition-colors"
            >
              <Plus className="w-3.5 h-3.5" /> New
            </button>
            <button
              onClick={() => {
                if (selectedProjects.length > 0) {
                  exportProjects(selectedProjects);
                } else if (currentProjectId) {
                  exportProjects([currentProjectId]);
                }
              }}
              disabled={selectedProjects.length === 0 && !currentProjectId}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 rounded-lg text-xs font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <FileDown className="w-3.5 h-3.5" /> Export {selectedProjects.length > 0 ? `(${selectedProjects.length})` : ''}
            </button>
            {selectedProjects.length > 0 && (
              <>
                <button
                  onClick={() => selectedProjects.forEach(id => {
                    const project = savedProjects.find(p => p.id === id);
                    if (project) duplicateProject(project);
                  })}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 rounded-lg text-xs font-medium transition-colors"
                >
                  <CopyIcon className="w-3.5 h-3.5" /> Duplicate ({selectedProjects.length})
                </button>
                <button
                  onClick={() => {
                    if (confirm(`Delete ${selectedProjects.length} project(s)?`)) {
                      deleteProjects(selectedProjects);
                    }
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-red-50 border border-red-200 hover:bg-red-100 text-red-600 rounded-lg text-xs font-medium transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" /> Delete ({selectedProjects.length})
                </button>
              </>
            )}
          </div>

          {/* Select All / Deselect All */}
          {savedProjects.length > 0 && (
            <div className="flex items-center justify-between">
              <button
                onClick={selectAllProjects}
                className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-700"
              >
                {selectedProjects.length === savedProjects.length ? (
                  <><CheckSquare className="w-3.5 h-3.5" /> Deselect All</>
                ) : (
                  <><Square className="w-3.5 h-3.5" /> Select All</>
                )}
              </button>
              <span className="text-xs text-slate-400">{savedProjects.length} plan{savedProjects.length !== 1 ? 's' : ''}</span>
            </div>
          )}

          {/* Project List */}
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {savedProjects.length === 0 ? (
              <div className="text-center py-8 text-slate-400">
                <FileText className="w-10 h-10 mx-auto mb-2 opacity-50" />
                <p className="text-sm">No saved floor plans yet</p>
                <p className="text-xs mt-1">Save your current plan or create a new one</p>
              </div>
            ) : (
              savedProjects.map(project => (
                <div
                  key={project.id}
                  className={`flex items-center gap-3 p-3 rounded-lg border transition-all cursor-pointer ${
                    project.id === currentProjectId 
                      ? 'border-indigo-300 bg-indigo-50' 
                      : selectedProjects.includes(project.id)
                        ? 'border-slate-300 bg-slate-50'
                        : 'border-slate-200 bg-white hover:border-slate-300'
                  }`}
                  onClick={() => {
                    if (editingProjectId !== project.id) {
                      toggleProjectSelection(project.id);
                    }
                  }}
                >
                  {/* Selection Checkbox */}
                  <div className="flex-shrink-0">
                    {selectedProjects.includes(project.id) ? (
                      <CheckSquare className="w-4 h-4 text-indigo-600" />
                    ) : (
                      <Square className="w-4 h-4 text-slate-400" />
                    )}
                  </div>
                  
                  {/* Project Info */}
                  <div className="flex-1 min-w-0">
                    {editingProjectId === project.id ? (
                      <input
                        type="text"
                        value={editingName}
                        onChange={(e) => setEditingName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            renameProject(project.id, editingName);
                          } else if (e.key === 'Escape') {
                            setEditingProjectId(null);
                            setEditingName('');
                          }
                        }}
                        onBlur={() => {
                          if (editingName.trim()) {
                            renameProject(project.id, editingName);
                          } else {
                            setEditingProjectId(null);
                            setEditingName('');
                          }
                        }}
                        className="w-full px-2 py-1 text-sm border border-indigo-300 rounded focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        autoFocus
                        onClick={(e) => e.stopPropagation()}
                      />
                    ) : (
                      <>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-slate-800 truncate">{project.name}</span>
                          {project.id === currentProjectId && (
                            <span className="text-[10px] bg-indigo-100 text-indigo-600 px-1.5 py-0.5 rounded font-medium">Active</span>
                          )}
                        </div>
                        <div className="text-[10px] text-slate-400 mt-0.5">
                          {project.data?.roomDims && (
                            <span>{feetToDisplay(project.data.roomDims.width, unitSystem)} × {feetToDisplay(project.data.roomDims.height, unitSystem)}</span>
                          )}
                          <span className="mx-1">•</span>
                          <span>{new Date(project.updatedAt).toLocaleDateString()}</span>
                        </div>
                      </>
                    )}
                  </div>
                  
                  {/* Action Buttons */}
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <Tooltip text="Open">
                      <button
                        onClick={(e) => { e.stopPropagation(); loadProject(project); }}
                        className="p-1.5 hover:bg-slate-100 rounded text-slate-500 hover:text-indigo-600 transition-colors"
                      >
                        <FolderOpen className="w-4 h-4" />
                      </button>
                    </Tooltip>
                    <Tooltip text="Rename">
                      <button
                        onClick={(e) => { 
                          e.stopPropagation(); 
                          setEditingProjectId(project.id); 
                          setEditingName(project.name); 
                        }}
                        className="p-1.5 hover:bg-slate-100 rounded text-slate-500 hover:text-slate-700 transition-colors"
                      >
                        <Edit3 className="w-4 h-4" />
                      </button>
                    </Tooltip>
                    <Tooltip text="Duplicate">
                      <button
                        onClick={(e) => { e.stopPropagation(); duplicateProject(project); }}
                        className="p-1.5 hover:bg-slate-100 rounded text-slate-500 hover:text-slate-700 transition-colors"
                      >
                        <CopyIcon className="w-4 h-4" />
                      </button>
                    </Tooltip>
                    <Tooltip text="Delete">
                      <button
                        onClick={(e) => { 
                          e.stopPropagation(); 
                          if (confirm(`Delete "${project.name}"?`)) {
                            deleteProjects([project.id]);
                          }
                        }}
                        className="p-1.5 hover:bg-red-50 rounded text-slate-500 hover:text-red-600 transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </Tooltip>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Import Section */}
          <div className="pt-3 border-t border-slate-200">
            <label className="text-sm font-medium text-slate-700 mb-2 flex items-center gap-2">
              <FileUp className="w-4 h-4" /> Import Floor Plan(s)
            </label>
            <textarea
              placeholder="Paste exported JSON here to import floor plan(s)..."
              value={fileImportText}
              onChange={(e) => { setFileImportText(e.target.value); setFileImportError(''); }}
              className="w-full h-20 bg-white border border-slate-300 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500 rounded-lg p-2 text-xs font-mono mb-2 outline-none resize-none"
            />
            {fileImportError && <p className="text-xs text-red-500 mb-2">{fileImportError}</p>}
            <button
              onClick={() => {
                const count = importProjects(fileImportText);
                if (count > 0) {
                  setFileImportText('');
                }
              }}
              disabled={!fileImportText.trim()}
              className="w-full py-2 bg-slate-800 hover:bg-slate-900 text-white rounded-lg text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              Import
            </button>
          </div>

          {/* Save Current */}
          {currentProjectId && (
            <div className="pt-3 border-t border-slate-200">
              <button
                onClick={() => { saveCurrentProject(); setFileBrowserOpen(false); }}
                className="w-full py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-medium transition-colors"
              >
                Save Current Plan
              </button>
            </div>
          )}
        </div>
      </Modal>

      {/* Color Picker Modal - Rendered at root level for mobile only */}
      {isMobile && showColorPicker !== null && (() => {
        const currentItem = items.find(i => i.id === showColorPicker);
        if (!currentItem) return null;
        return (
          <ColorPicker
            currentColor={migrateColor(currentItem.color)}
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
