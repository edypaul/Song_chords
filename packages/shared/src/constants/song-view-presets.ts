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
  title:   { min: 16, max: 40 },
  details: { min: 10, max: 20 },
  section: { min: 8,  max: 28 },
};

const EMPTY: SectionStyle = { fontSize: 0, color: '', background: '' };

function sec(overrides: Partial<SectionStyle>): SectionStyle {
  return { ...EMPTY, ...overrides };
}

/*
 * Preset design rules:
 *
 *  1. Lyrics and chords must be clearly readable against the page
 *     background — every preset is a deliberate high-contrast
 *     background/ink pair, and the chord ACCENT is chosen to stay
 *     legible on that same background.
 *  2. Exactly ONE font family per preset.
 *  3. The song title is large (30–34px).
 *  4. At most THREE colors per preset:
 *        BG     — the page background
 *        INK    — lyrics, song title, details
 *        ACCENT — chords, section-chip background, chorus border
 *     The section-chip TEXT reuses BG (it sits on the ACCENT chip),
 *     so no fourth color is introduced.
 *  5. Section-title size is independent of the lyric size — it gets
 *     its own `sectionFs` argument (defaults a touch below lyrics so
 *     section chips read as headers, not body text).
 */
function makePreset(args: {
  preset: string;
  font: string;
  bg: string;
  ink: string;
  accent: string;
  lyricFs: number;
  titleFs: number;
  detailsFs: number;
  sectionFs?: number;
  titleUppercase?: boolean;
  sectionUppercase?: boolean;
}): SongViewStyle {
  const { preset, font, bg, ink, accent, lyricFs, titleFs, detailsFs } = args;
  const sectionFs = args.sectionFs ?? Math.round(lyricFs * 0.8);
  return {
    preset,
    fontFamily: font,
    titleUppercase: args.titleUppercase ?? false,
    sectionUppercase: args.sectionUppercase ?? true,
    // Lyrics carry the page background for the whole song view.
    lyrics:  sec({ fontSize: lyricFs, color: ink, background: bg }),
    chords:  sec({ fontSize: Math.round(lyricFs * 0.85), color: accent }),
    title:   sec({ fontSize: titleFs, color: ink }),
    details: sec({ fontSize: detailsFs, color: ink }),
    section: sec({ fontSize: sectionFs, color: bg, background: accent }),
    chorusBorderColor: accent,
  };
}

export const SONG_STYLE_PRESETS: Record<string, SongStylePreset> = {
  // ── Default (dark) ────────────────────────────────────────────────────────
  // Deep indigo-navy · soft white · warm gold accent.
  default: {
    name: 'Default',
    mode: 'dark',
    style: makePreset({
      preset: 'default',
      font: 'system-ui, sans-serif',
      bg: '#141b2d',
      ink: '#eef1f8',
      accent: '#f2c14e',
      lyricFs: 20,
      titleFs: 32,
      detailsFs: 14,
      titleUppercase: true,
    }),
  },

  // ── Dark mode presets ─────────────────────────────────────────────────────
  // Charcoal · porcelain · coral-rose.
  midnight: {
    name: 'Midnight',
    mode: 'dark',
    style: makePreset({
      preset: 'midnight',
      font: 'Georgia, serif',
      bg: '#1a1a1f',
      ink: '#f0eef0',
      accent: '#ff8a8a',
      lyricFs: 19,
      titleFs: 32,
      detailsFs: 14,
    }),
  },
  // Near-black blue · ice white · electric lime.
  neon: {
    name: 'Neon',
    mode: 'dark',
    style: makePreset({
      preset: 'neon',
      font: 'Verdana, sans-serif',
      bg: '#0b0e14',
      ink: '#f4f7fb',
      accent: '#aef03f',
      lyricFs: 19,
      titleFs: 34,
      detailsFs: 14,
      titleUppercase: true,
    }),
  },
  // Dark forest · pale cream · soft gold.
  ember: {
    name: 'Forest',
    mode: 'dark',
    style: makePreset({
      preset: 'ember',
      font: 'Georgia, serif',
      bg: '#13241b',
      ink: '#f1f4ec',
      accent: '#e8c267',
      lyricFs: 19,
      titleFs: 32,
      detailsFs: 14,
    }),
  },
  // Deep plum · lilac-white · aqua.
  aurora: {
    name: 'Aurora',
    mode: 'dark',
    style: makePreset({
      preset: 'aurora',
      font: 'Tahoma, sans-serif',
      bg: '#1d1530',
      ink: '#efeaf7',
      accent: '#4fd1c5',
      lyricFs: 19,
      titleFs: 32,
      detailsFs: 14,
    }),
  },
  // Cool gunmetal · near-white · sky blue.
  slate: {
    name: 'Slate',
    mode: 'dark',
    style: makePreset({
      preset: 'slate',
      font: 'Arial, sans-serif',
      bg: '#202733',
      ink: '#f0f3f7',
      accent: '#6cb6ff',
      lyricFs: 19,
      titleFs: 32,
      detailsFs: 14,
      titleUppercase: true,
    }),
  },

  // ── Light mode presets ────────────────────────────────────────────────────
  // Soft white · ink navy · emerald.
  classic: {
    name: 'Classic',
    mode: 'light',
    style: makePreset({
      preset: 'classic',
      font: 'Georgia, serif',
      bg: '#fcfcf9',
      ink: '#1c2733',
      accent: '#1f7a55',
      lyricFs: 18,
      titleFs: 32,
      detailsFs: 13,
    }),
  },
  // Cream · espresso brown · rust red.
  warm: {
    name: 'Warm',
    mode: 'light',
    style: makePreset({
      preset: 'warm',
      font: "'Times New Roman', serif",
      bg: '#fdf4e7',
      ink: '#3b2a1c',
      accent: '#c0461f',
      lyricFs: 18,
      titleFs: 33,
      detailsFs: 13,
    }),
  },
  // Pure white · pure black · vivid blue. Maximum legibility.
  highContrast: {
    name: 'High Contrast',
    mode: 'light',
    style: makePreset({
      preset: 'highContrast',
      font: 'Verdana, sans-serif',
      bg: '#ffffff',
      ink: '#000000',
      accent: '#0b54d6',
      lyricFs: 19,
      titleFs: 34,
      detailsFs: 14,
      titleUppercase: true,
    }),
  },
  // White · graphite · muted indigo. Understated.
  minimal: {
    name: 'Minimal',
    mode: 'light',
    style: makePreset({
      preset: 'minimal',
      font: 'Arial, sans-serif',
      bg: '#ffffff',
      ink: '#222831',
      accent: '#4f5d9c',
      lyricFs: 17,
      titleFs: 30,
      detailsFs: 12,
    }),
  },
  // Pale aqua-white · deep teal · coral.
  ocean: {
    name: 'Ocean',
    mode: 'light',
    style: makePreset({
      preset: 'ocean',
      font: 'Tahoma, sans-serif',
      bg: '#f0faf9',
      ink: '#0f3b40',
      accent: '#e86a4f',
      lyricFs: 18,
      titleFs: 32,
      detailsFs: 13,
    }),
  },
  // Warm paper · charcoal · plum.
  paper: {
    name: 'Paper',
    mode: 'light',
    style: makePreset({
      preset: 'paper',
      font: "'Palatino Linotype', Palatino, serif",
      bg: '#f8f5ee',
      ink: '#2b2620',
      accent: '#8e3b8f',
      lyricFs: 18,
      titleFs: 32,
      detailsFs: 13,
    }),
  },
};

export const DEFAULT_SONG_VIEW_STYLE: SongViewStyle = { ...SONG_STYLE_PRESETS.default.style };
