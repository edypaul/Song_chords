import type { SongViewStyle, SectionStyle } from '../types/settings.types';

export interface SongStylePreset {
  name: string;
  mode: 'dark' | 'light';
  style: SongViewStyle;
}

/** Font size limits per section type (px) */
export const FONT_SIZE_LIMITS: Record<string, { min: number; max: number }> = {
  lyrics:  { min: 12, max: 28 },
  chords:  { min: 10, max: 24 },
  title:   { min: 16, max: 36 },
  details: { min: 10, max: 20 },
  section: { min: 8,  max: 18 },
};

const EMPTY: SectionStyle = { fontSize: 0, color: '', background: '' };

function sec(overrides: Partial<SectionStyle>): SectionStyle {
  return { ...EMPTY, ...overrides };
}

/*
 * Color contrast guidelines:
 *   Dark mode  bg: #0f172a — all text ≥ #94a3b8 brightness, primary text ≥ #cbd5e1
 *   Light mode bg: #ffffff — all text ≤ #6b7280 brightness, primary text ≤ #374151
 */
export const SONG_STYLE_PRESETS: Record<string, SongStylePreset> = {
  // ── Default (adapts to both modes via theme CSS vars) ─────────────────────
  default: {
    name: 'Default',
    mode: 'dark',
    style: {
      preset: 'default',
      fontFamily: 'monospace',
      titleUppercase: false,
      sectionUppercase: true,
      lyrics:  sec({ fontSize: 16 }),
      chords:  sec({ fontSize: 14 }),
      title:   sec({ fontSize: 22 }),
      details: sec({ fontSize: 13 }),
      section: sec({ fontSize: 11 }),
      chorusBorderColor: '',
    },
  },

  // ── Dark mode presets (bg #0f172a) ────────────────────────────────────────
  midnight: {
    name: 'Midnight',
    mode: 'dark',
    style: {
      preset: 'midnight',
      fontFamily: "'Courier New', monospace",
      titleUppercase: false,
      sectionUppercase: true,
      lyrics:  sec({ fontSize: 16, color: '#cbd5e1' }),
      chords:  sec({ fontSize: 13, color: '#a5b4fc' }),
      title:   sec({ fontSize: 24, color: '#f1f5f9', background: '#1e293b' }),
      details: sec({ fontSize: 12, color: '#94a3b8' }),
      section: sec({ fontSize: 10, color: '#c7d2fe', background: '#312e81' }),
      chorusBorderColor: '#a5b4fc',
    },
  },
  neon: {
    name: 'Neon',
    mode: 'dark',
    style: {
      preset: 'neon',
      fontFamily: 'Verdana, sans-serif',
      titleUppercase: true,
      sectionUppercase: true,
      lyrics:  sec({ fontSize: 15, color: '#e2e8f0' }),
      chords:  sec({ fontSize: 14, color: '#22d3ee' }),
      title:   sec({ fontSize: 26, color: '#f0abfc', background: '#1e1030' }),
      details: sec({ fontSize: 11, color: '#93c5fd' }),
      section: sec({ fontSize: 12, color: '#0f172a', background: '#a78bfa' }),
      chorusBorderColor: '#22d3ee',
    },
  },
  ember: {
    name: 'Ember',
    mode: 'dark',
    style: {
      preset: 'ember',
      fontFamily: 'Georgia, serif',
      titleUppercase: false,
      sectionUppercase: true,
      lyrics:  sec({ fontSize: 16, color: '#d6d3d1' }),
      chords:  sec({ fontSize: 14, color: '#fdba74' }),
      title:   sec({ fontSize: 24, color: '#fef3c7', background: '#451a03' }),
      details: sec({ fontSize: 13, color: '#a8a29e' }),
      section: sec({ fontSize: 11, color: '#fef3c7', background: '#78350f' }),
      chorusBorderColor: '#fdba74',
    },
  },
  aurora: {
    name: 'Aurora',
    mode: 'dark',
    style: {
      preset: 'aurora',
      fontFamily: 'Tahoma, sans-serif',
      titleUppercase: false,
      sectionUppercase: true,
      lyrics:  sec({ fontSize: 15, color: '#ddd6fe' }),
      chords:  sec({ fontSize: 13, color: '#6ee7b7' }),
      title:   sec({ fontSize: 22, color: '#a5f3fc', background: '#0c4a6e' }),
      details: sec({ fontSize: 12, color: '#a5b4fc' }),
      section: sec({ fontSize: 10, color: '#d9f99d', background: '#14532d' }),
      chorusBorderColor: '#6ee7b7',
    },
  },
  slate: {
    name: 'Slate',
    mode: 'dark',
    style: {
      preset: 'slate',
      fontFamily: 'Arial, sans-serif',
      titleUppercase: true,
      sectionUppercase: true,
      lyrics:  sec({ fontSize: 16, color: '#cbd5e1' }),
      chords:  sec({ fontSize: 12, color: '#93c5fd' }),
      title:   sec({ fontSize: 20, color: '#f1f5f9' }),
      details: sec({ fontSize: 11, color: '#94a3b8' }),
      section: sec({ fontSize: 9, color: '#e2e8f0', background: '#334155' }),
      chorusBorderColor: '#93c5fd',
    },
  },

  // ── Light mode presets (bg #ffffff) ───────────────────────────────────────
  classic: {
    name: 'Classic',
    mode: 'light',
    style: {
      preset: 'classic',
      fontFamily: 'Georgia, serif',
      titleUppercase: false,
      sectionUppercase: true,
      lyrics:  sec({ fontSize: 16, color: '#1f2937' }),
      chords:  sec({ fontSize: 14, color: '#2563eb' }),
      title:   sec({ fontSize: 24, color: '#1e3a5f', background: '#eff6ff' }),
      details: sec({ fontSize: 12, color: '#4b5563' }),
      section: sec({ fontSize: 11, color: '#1e40af', background: '#dbeafe' }),
      chorusBorderColor: '#2563eb',
    },
  },
  warm: {
    name: 'Warm',
    mode: 'light',
    style: {
      preset: 'warm',
      fontFamily: "'Times New Roman', serif",
      titleUppercase: false,
      sectionUppercase: true,
      lyrics:  sec({ fontSize: 16, color: '#292524' }),
      chords:  sec({ fontSize: 15, color: '#b45309' }),
      title:   sec({ fontSize: 26, color: '#451a03', background: '#fef3c7' }),
      details: sec({ fontSize: 13, color: '#57534e' }),
      section: sec({ fontSize: 12, color: '#78350f', background: '#fed7aa' }),
      chorusBorderColor: '#b45309',
    },
  },
  highContrast: {
    name: 'High Contrast',
    mode: 'light',
    style: {
      preset: 'highContrast',
      fontFamily: 'Verdana, sans-serif',
      titleUppercase: true,
      sectionUppercase: true,
      lyrics:  sec({ fontSize: 18, color: '#000000' }),
      chords:  sec({ fontSize: 16, color: '#dc2626' }),
      title:   sec({ fontSize: 28, color: '#ffffff', background: '#000000' }),
      details: sec({ fontSize: 14, color: '#374151' }),
      section: sec({ fontSize: 13, color: '#ffffff', background: '#dc2626' }),
      chorusBorderColor: '#dc2626',
    },
  },
  minimal: {
    name: 'Minimal',
    mode: 'light',
    style: {
      preset: 'minimal',
      fontFamily: 'Arial, sans-serif',
      titleUppercase: false,
      sectionUppercase: true,
      lyrics:  sec({ fontSize: 15, color: '#374151' }),
      chords:  sec({ fontSize: 12, color: '#6b7280' }),
      title:   sec({ fontSize: 20, color: '#111827' }),
      details: sec({ fontSize: 11, color: '#6b7280' }),
      section: sec({ fontSize: 9, color: '#4b5563' }),
      chorusBorderColor: '#9ca3af',
    },
  },
  ocean: {
    name: 'Ocean',
    mode: 'light',
    style: {
      preset: 'ocean',
      fontFamily: 'Tahoma, sans-serif',
      titleUppercase: false,
      sectionUppercase: true,
      lyrics:  sec({ fontSize: 16, color: '#1e3a5f' }),
      chords:  sec({ fontSize: 14, color: '#0e7490' }),
      title:   sec({ fontSize: 22, color: '#ecfeff', background: '#0e7490' }),
      details: sec({ fontSize: 12, color: '#475569' }),
      section: sec({ fontSize: 11, color: '#164e63', background: '#cffafe' }),
      chorusBorderColor: '#0e7490',
    },
  },
  paper: {
    name: 'Paper',
    mode: 'light',
    style: {
      preset: 'paper',
      fontFamily: "'Palatino Linotype', Palatino, serif",
      titleUppercase: false,
      sectionUppercase: true,
      lyrics:  sec({ fontSize: 17, color: '#1c1917' }),
      chords:  sec({ fontSize: 13, color: '#6d28d9' }),
      title:   sec({ fontSize: 24, color: '#44403c', background: '#fafaf9' }),
      details: sec({ fontSize: 14, color: '#57534e' }),
      section: sec({ fontSize: 10, color: '#44403c', background: '#f5f5f4' }),
      chorusBorderColor: '#6d28d9',
    },
  },
};

export const DEFAULT_SONG_VIEW_STYLE: SongViewStyle = { ...SONG_STYLE_PRESETS.default.style };
