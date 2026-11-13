/** Preset furniture colors. Stored as hex so shared layouts render identically everywhere. */
export const COLOR_PRESETS = [
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
] as const;

export const DEFAULT_COLOR = '#93c5fd';

export const isValidHex = (hex: string): boolean => /^#[0-9A-Fa-f]{6}$/.test(hex);

/** Border color for a fill: the preset's border, or the fill darkened to 70%. */
export const getBorderColor = (hex: string): string => {
  const preset = COLOR_PRESETS.find((p) => p.hex === hex);
  if (preset) return preset.border;
  const channel = (start: number) => {
    const v = parseInt(hex.slice(start, start + 2), 16);
    return Math.max(0, Math.floor((Number.isNaN(v) ? 0 : v) * 0.7))
      .toString(16)
      .padStart(2, '0');
  };
  return `#${channel(1)}${channel(3)}${channel(5)}`;
};

/** Tailwind class pairs used as colors before v1 switched to hex. */
const LEGACY_COLOR_MAP: Record<string, string> = {
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

/** Convert any stored color (hex or legacy Tailwind classes) to hex. */
export const migrateColor = (color: unknown): string => {
  if (typeof color !== 'string') return DEFAULT_COLOR;
  if (color.startsWith('#')) return color;
  return LEGACY_COLOR_MAP[color] ?? DEFAULT_COLOR;
};

/** A random preset color for newly added furniture. */
export const randomPresetColor = (random: () => number = Math.random): string =>
  COLOR_PRESETS[Math.floor(random() * COLOR_PRESETS.length)]!.hex;
