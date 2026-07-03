import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';
import type { Song, ChordDiagram, ChordGridToken, ChordGridRow, ChordGridBar } from '@song-chords/shared';
import { toHtml, getRenderableSong } from './song-export';
import {
  useSettingsStore,
  extractUniqueChords,
  getDiagramExact,
  getDiagramByIndex,
} from '@song-chords/shared';
import ChordDiagramSVG from '../components/chord-diagram/ChordDiagramSVG';

/**
 * Build a self-contained HTML document for casting a single song to a
 * receiver device. Reuses the existing `toHtml` exporter (used by the
 * Export modal) so the cast view matches what users would get from a
 * "Save as HTML" export — same chord/lyric layout, same color preset,
 * same typography.
 *
 * Three cast modes:
 *   - `'lyrics'`                 → lyrics-only (chord names hidden)
 *   - `'lyrics-chords'`          → standard chord-over-lyric layout
 *   - `'lyrics-chord-diagrams'`  → inline diagrams for the user's
 *                                  selected instrument (guitar /
 *                                  ukulele / piano), instead of plain
 *                                  chord names above each lyric
 *
 * The resulting HTML is sent over the cast WebSocket as a single
 * payload. The receiver replaces its document with it; nothing on the
 * desktop changes.
 */
/**
 * The cast experience is a single mode now. The cast HTML always
 * carries the chord-over-lyric layout PLUS a sticky chord-diagram bar
 * AND a receiver-side toolbar with two controls:
 *
 *   - A view toggle between "Lyrics only" and "Lyrics + chords"
 *     (toggles chord names AND the diagram bar on/off).
 *   - An auto-scroll start/stop button (scrolls the lyric body at a
 *     rate computed from the song's duration if set, falling back to
 *     the user's autoScrollSpeed slider value).
 *
 * The legacy mode names ('lyrics', 'lyrics-chords') are kept for
 * backward compatibility with stale callers — they all map to the
 * same unified output now.
 */
export type CastMode = 'lyrics' | 'lyrics-chords' | 'lyrics-chord-diagrams';

/** Build the receiver-tweak stylesheet. Captures the live theme
 *  background on `<html>` so the page fills the viewport with the
 *  right color even when the receiver scrolls past the exported body
 *  (mobile rubber-band, TV browsers with letterboxing, etc.). */
function buildReceiverTweaks(themeBg: string, themeFg: string): string {
  return `
/* Receiver-side overrides — make the exported HTML feel like a
   purpose-built mobile / TV view rather than a page on a sheet of
   paper. */
html, body {
  margin: 0;
  padding: 0;
  min-height: 100vh;
  -webkit-text-size-adjust: 100%;
  -webkit-tap-highlight-color: transparent;
}
/* Theme paint — span both elements so the page never shows a
   white strip past the body when the user scrolls. */
html { background: ${themeBg}; color: ${themeFg}; }
body {
  background: ${themeBg};
  color: ${themeFg};
  padding: 24px 32px 64px;
  /* Center the cast content horizontally on wide screens.
     max-width caps line length to a comfortable reading width;
     margin auto centers it within the viewport. */
  max-width: 860px;
  margin: 0 auto;
  font-feature-settings: 'kern' 1, 'liga' 1;
  /* Suppress horizontal scroll WITHOUT breaking vertical scroll.
     Setting overflow-x: hidden on <html> kills touch-scroll on
     mobile browsers, so we only set it on <body>. The exporter
     already wraps lines at word boundaries, so anything wider than
     the viewport is a pasted URL or single super-long word —
     overflow-wrap handles those. */
  overflow-x: clip;
  overflow-wrap: anywhere;
}
@media (max-width: 600px) {
  body { padding: 16px 14px 48px; font-size: 0.95em; }
}
@media (max-width: 380px) {
  body { padding: 12px 10px 40px; }
}

/* Chord-diagrams mode now uses the chord-over-lyric layout PLUS a
   toggleable, horizontally-scrollable chord bar at the top of the
   body. The bar is a <details> element so it can be collapsed by
   the audience. */
.cast-chord-bar summary::-webkit-details-marker { display: none; }
.cast-chord-bar[open] .cast-chord-bar-toggle::after { content: ''; }
.cast-chord-bar:not([open]) .cast-chord-bar-toggle::after { content: ''; }
.cast-chord-bar-strip::-webkit-scrollbar { height: 8px; }
.cast-chord-bar-strip::-webkit-scrollbar-thumb {
  background: rgba(128,128,128,0.4);
  border-radius: 4px;
}

/* Lyrics-only view: collapse the chord row above each lyric. The
   exporter emits a .chord-cell span above every lyric chunk; that
   span holds either a chord-name, an inline diagram, or a zero-width
   placeholder. We hide its content AND collapse its height so the
   lyric lines pack tightly with no leftover chord-row stripe.
   Note: don't use display:none on .chord-cell — it shares the lyric
   baseline, so removing it shifts lyric chunks horizontally. Using
   height 0 plus visibility hidden keeps lyric alignment while still
   removing the visible chord stripe. */
[data-view-mode="lyrics"] .chord-cell,
[data-cast-mode="lyrics"] .chord-cell {
  display: none !important;
}
/* Drop the min-width that the chord-over-lyric layout adds to each
   chunk to make room for the chord name / diagram above it. Without
   this, chunks that had wide chord cells stay artificially wide in
   lyrics-only mode and push lines around unevenly. */
[data-view-mode="lyrics"] .chord-chunk,
[data-cast-mode="lyrics"] .chord-chunk {
  min-width: 0 !important;
}
/* The exporter pads short lyric chunks with trailing whitespace so
   the chord cell above them has room to render. That padding lives
   in a separate .chord-pad span so we can simply hide it here —
   without disturbing the real word-separator spaces that the lyric
   actually contains. */
[data-view-mode="lyrics"] .chord-pad,
[data-cast-mode="lyrics"] .chord-pad { display: none !important; }
/* Chord-only chunks (no real lyric, just whitespace to hold a chord
   name in chord-over-lyric mode) leave dangling whitespace at line
   ends and between words once the chord row is hidden. Drop them. */
[data-view-mode="lyrics"] .chord-chunk-empty,
[data-cast-mode="lyrics"] .chord-chunk-empty { display: none !important; }
/* Also hide the standalone chord-diagram bar and any chord-only grid
   tokens (e.g. {chord-grid: ...} lines). */
[data-view-mode="lyrics"] .cast-chord-bar,
[data-view-mode="lyrics"] .chord-grid,
[data-cast-mode="lyrics"] .cast-chord-bar,
[data-cast-mode="lyrics"] .chord-grid { display: none !important; }
`;
}

/**
 * Read a CSS variable from the document root and trim it. Returns
 * `fallback` when the var is empty / unresolvable. Used to capture
 * the live theme colors at cast-build time so the receiver mirrors
 * what the user is actually looking at — light vs. dark mode plus
 * any preset overrides.
 */
function cssVar(name: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

/**
 * Build a responsive HTML+SVG markup for a chord-grid token. Unlike the
 * in-app `<ChordGrid />` React component (which measures its container
 * via ResizeObserver to decide bars-per-line), this emits ONE SVG PER
 * BAR wrapped in a CSS flex-wrap container. The browser flows bars onto
 * as many lines as needed for the current viewport width, with no
 * client-side JS — perfect for the cast receiver where the renderer
 * runs no React effects (renderToStaticMarkup) and the device width is
 * unknown at build time.
 *
 * Visual details (barline weights, repeat dots, beat dots, font sizes)
 * mirror ChordGrid.tsx so the cast view is recognisably the same chart.
 */
function renderChordGridHtml(token: ChordGridToken, chordColor: string, fgColor: string): string {
  // ── layout constants (kept in sync with ChordGrid.tsx) ──
  const ROW_H = 28;
  const TOP_PAD = 4;
  const BOT_PAD = 4;
  const SVG_H = TOP_PAD + ROW_H + BOT_PAD;
  const CHORD_FONT = 14;
  const CHORD_CHAR_W = 8.4;
  const CHORD_Y = TOP_PAD + ROW_H * 0.72;
  const BEAT_DOT_R = 3.5;
  const BEAT_DOT_Y = TOP_PAD + ROW_H * 0.5;
  const BAR_Y1 = TOP_PAD;
  const BAR_Y2 = TOP_PAD + ROW_H;
  const DOT_R = 2.5;
  const DOT_Y1 = TOP_PAD + ROW_H * 0.33;
  const DOT_Y2 = TOP_PAD + ROW_H * 0.67;
  const PLAIN_INSET = 10;
  const START_REPEAT_INSET = 20;
  const END_REPEAT_INSET = 18;
  const MIN_BAR_W = 70;

  const isSimple = token.rows.every((row) =>
    row.bars.every(
      (bar) =>
        bar.beats.filter((b) => b.chord).length === 1 &&
        bar.beats[0]?.chord !== undefined,
    ),
  );

  // Single uniform bar width across the whole token (matches the in-app
  // computeBarW behaviour so wide chord names don't squash short bars).
  const allChordLengths = token.rows.flatMap((row) =>
    row.bars.flatMap((b) => b.beats.filter((bt) => bt.chord).map((bt) => bt.chord!.length)),
  );
  const maxChordW = allChordLengths.length > 0 ? Math.max(...allChordLengths) * CHORD_CHAR_W : 0;
  const maxOuterInset = START_REPEAT_INSET + END_REPEAT_INSET;
  let barW: number;
  if (isSimple) {
    barW = Math.max(MIN_BAR_W, maxChordW + maxOuterInset);
  } else {
    const maxBeats = Math.max(...token.rows.flatMap((row) => row.bars.map((b) => b.beats.length)));
    const minSlotW = Math.max(maxChordW + 10, 20);
    barW = Math.max(MIN_BAR_W, maxBeats * minSlotW + maxOuterInset);
  }

  const barSvg = (
    bar: ChordGridBar,
    isFirstInRow: boolean,
    isLastInRow: boolean,
    rowStartRepeat: boolean,
    rowEndRepeat: boolean,
    rowRepeatCount: number | undefined,
  ): string => {
    // Each bar SVG carries its own opening + closing barlines so it
    // renders correctly as a standalone flex item.
    const startRepeat = isFirstInRow && rowStartRepeat;
    const endRepeat = isLastInRow && rowEndRepeat;
    const leftInset = startRepeat ? START_REPEAT_INSET : PLAIN_INSET;
    const rightInset = endRepeat ? END_REPEAT_INSET : PLAIN_INSET;
    // Total width includes a small overhang on the right for an ×N
    // repeat-count label when present — that label sits just outside
    // the rightmost barline.
    const overhang = endRepeat ? 32 : (isLastInRow && rowRepeatCount ? 32 : 0);
    const totalW = barW + overhang;
    const openX = 0;
    const rightX = barW;
    const contentLeft = leftInset;
    const contentW = barW - leftInset - rightInset;

    const beatXs: number[] = bar.beats.map((_, i) => {
      const slotW = contentW / bar.beats.length;
      return contentLeft + slotW * i + slotW / 2;
    });

    let inner = '';

    // Opening barline
    if (startRepeat) {
      inner += `<line x1="${openX}" y1="${BAR_Y1}" x2="${openX}" y2="${BAR_Y2}" stroke="${fgColor}" stroke-width="3" opacity="0.85"/>`;
      inner += `<line x1="${openX + 6}" y1="${BAR_Y1}" x2="${openX + 6}" y2="${BAR_Y2}" stroke="${fgColor}" stroke-width="1" opacity="0.75"/>`;
      inner += `<circle cx="${openX + 13}" cy="${DOT_Y1}" r="${DOT_R}" fill="${fgColor}" opacity="0.8"/>`;
      inner += `<circle cx="${openX + 13}" cy="${DOT_Y2}" r="${DOT_R}" fill="${fgColor}" opacity="0.8"/>`;
    } else {
      inner += `<line x1="${openX}" y1="${BAR_Y1}" x2="${openX}" y2="${BAR_Y2}" stroke="${fgColor}" stroke-width="1" opacity="0.75"/>`;
    }

    // Beat content
    if (isSimple) {
      const ch = bar.beats[0]?.chord ?? '';
      inner += `<text x="${contentLeft + contentW / 2}" y="${CHORD_Y}" text-anchor="middle" font-size="${CHORD_FONT}" font-weight="700" font-family="sans-serif" fill="${chordColor}">${escapeXml(ch)}</text>`;
    } else {
      bar.beats.forEach((beat, si) => {
        if (beat.chord) {
          inner += `<text x="${beatXs[si]}" y="${CHORD_Y}" text-anchor="middle" font-size="${CHORD_FONT}" font-weight="700" font-family="sans-serif" fill="${chordColor}">${escapeXml(beat.chord)}</text>`;
        } else {
          inner += `<circle cx="${beatXs[si]}" cy="${BEAT_DOT_Y}" r="${BEAT_DOT_R}" fill="${chordColor}" opacity="0.3"/>`;
        }
      });
    }

    // Closing barline (every bar gets one — for non-last bars this
    // doubles as the next bar's opening boundary; CSS flex-gap keeps
    // them visually adjacent).
    if (endRepeat) {
      inner += `<circle cx="${rightX - 10}" cy="${DOT_Y1}" r="${DOT_R}" fill="${fgColor}" opacity="0.8"/>`;
      inner += `<circle cx="${rightX - 10}" cy="${DOT_Y2}" r="${DOT_R}" fill="${fgColor}" opacity="0.8"/>`;
      inner += `<line x1="${rightX - 3}" y1="${BAR_Y1}" x2="${rightX - 3}" y2="${BAR_Y2}" stroke="${fgColor}" stroke-width="1" opacity="0.75"/>`;
      inner += `<line x1="${rightX + 3}" y1="${BAR_Y1}" x2="${rightX + 3}" y2="${BAR_Y2}" stroke="${fgColor}" stroke-width="1" opacity="0.75"/>`;
      if (rowRepeatCount) {
        inner += `<text x="${rightX + 10}" y="${CHORD_Y}" text-anchor="start" font-size="17" font-weight="700" font-family="sans-serif" fill="${fgColor}" opacity="0.7">${'×'}${rowRepeatCount}</text>`;
      }
    } else {
      inner += `<line x1="${rightX}" y1="${BAR_Y1}" x2="${rightX}" y2="${BAR_Y2}" stroke="${fgColor}" stroke-width="1" opacity="0.75"/>`;
      if (isLastInRow && rowRepeatCount) {
        inner += `<text x="${rightX + 6}" y="${CHORD_Y}" text-anchor="start" font-size="17" font-weight="700" font-family="sans-serif" fill="${fgColor}" opacity="0.7">${'×'}${rowRepeatCount}</text>`;
      }
    }

    return `<svg width="${totalW}" height="${SVG_H}" viewBox="0 0 ${totalW} ${SVG_H}" style="display:block;overflow:visible;flex-shrink:0;">${inner}</svg>`;
  };

  const rowHtml = (row: ChordGridRow): string => {
    const bars = row.bars
      .map((bar, bi) =>
        barSvg(
          bar,
          bi === 0,
          bi === row.bars.length - 1,
          !!row.startRepeat,
          !!row.endRepeat,
          row.repeatCount,
        ),
      )
      .join('');
    // `flex-wrap: wrap` is what makes the chart responsive — the
    // browser flows bars onto extra lines on narrow viewports without
    // any JS measurement. row-gap keeps wrapped lines visually
    // separated; column-gap is 0 so bars sit flush, mirroring the
    // continuous staff look on wide screens.
    return `<div class="chord-grid-row" style="display:flex;flex-wrap:wrap;align-items:flex-start;column-gap:0;row-gap:6px;margin-bottom:6px;">${bars}</div>`;
  };

  return `<div class="chord-grid" style="margin:0.6em 0;max-width:100%;">${token.rows.map(rowHtml).join('')}</div>`;
}

/** Minimal XML-safe escaping for SVG text content. */
function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Render the chosen song to an HTML document string ready to push to
 * the cast receiver. The settings store + the live theme variables
 * are read so the receiver picks up the same style preset AND the
 * same dark/light mode the user is looking at right now.
 */
export function buildCastHtml(song: Song, _mode: CastMode): string {
  const settings = useSettingsStore.getState().settings;
  const svs = settings.songViewStyle;
  // Cast view ALWAYS centers the song content horizontally regardless
  // of the user's in-app "Center Song" setting. The receiver is a
  // presentation surface where a centered layout reads cleaner.
  const songCentered = true;
  void settings.songCentered; // intentionally not used
  const instrument = settings.defaultInstrument;
  const customChords = settings.customChords ?? {};

  // All cast sessions now share a single layout: chord-over-lyric
  // with a chord-diagram bar at the top. The receiver-side toolbar
  // toggles between "Lyrics only" and "Lyrics + chords" views (and
  // controls auto-scroll) — see the injected JS at the bottom of
  // this function.
  const layout: 'chords-with-bar' = 'chords-with-bar';

  // Pull the live theme palette from the document root. These vars
  // flip automatically with the user's light/dark choice (set by
  // App.tsx via `data-theme="dark|light"` on <html>), so the cast
  // matches the desktop session in real time. Preset-set values on
  // `svs.*` still win when explicitly defined — those are
  // intentional overrides the user picked.
  const themeBg = svs.lyrics.background || cssVar('--bg', '#ffffff');
  const themeFg = svs.lyrics.color || cssVar('--text-primary', '#0f172a');
  const themeMuted = svs.details.color || cssVar('--text-muted', '#94a3b8');
  const themeChord = svs.chords.color || cssVar('--chord-color', '#6366f1');
  const themeAccent = cssVar('--accent', '#6366f1');
  const themeSection = svs.section.color || cssVar('--text-secondary', '#475569');

  // Pre-render every {chord-grid: ...} line as responsive HTML+SVG keyed
  // by line index — the exporter's `renderLineHtml` looks each one up
  // when it walks the parsed song. We deliberately do NOT use the
  // in-app `<ChordGrid />` React component here because it relies on a
  // ResizeObserver inside a useEffect to decide bars-per-line; that
  // never runs under `renderToStaticMarkup`, so the receiver would get
  // a fixed-width chart that overflows narrow screens. Our local
  // renderer emits one SVG per bar in a flex-wrap container so the
  // browser re-flows bars onto more lines as the viewport shrinks.
  let chordGrids: Record<number, string> | undefined;
  {
    const parsed = getRenderableSong(song);
    const map: Record<number, string> = {};
    parsed.lines.forEach((line, i) => {
      if (!line.isChordGrid) return;
      const token = line.tokens[0];
      if (!token || token.type !== 'chord-grid') return;
      map[i] = renderChordGridHtml(token as ChordGridToken, themeChord, themeFg);
    });
    if (Object.keys(map).length > 0) chordGrids = map;
  }

  // Build the chord-bar HTML. Always included — the receiver toolbar
  // shows/hides it via the view-mode toggle.
  let chordBarHtml: string | undefined;
  {
    const parsed = getRenderableSong(song);
    const chords = extractUniqueChords(parsed);
    const variations = song.preferences?.chordVariations ?? {};
    const strings = instrument === 'guitar' ? 6 : instrument === 'ukulele' ? 4 : 0;
    const castLyricFontSize = svs.lyrics.fontSize || 19;
    const castDiagramW = Math.min(140, Math.max(64, Math.round(castLyricFontSize * 5)));
    const diagramSvgs: string[] = [];
    for (const name of chords) {
      const varIdx = variations[name] ?? 0;
      const found = varIdx > 0
        ? getDiagramByIndex(name, instrument, varIdx, customChords)
        : getDiagramExact(name, instrument, customChords);
      const d: ChordDiagram = found ?? (instrument === 'piano'
        ? { name, instrument, baseFret: 1, strings: 0, frets: [], pianoNotes: [] }
        : { name, instrument, baseFret: 1, strings, frets: Array(strings).fill('x') as ('x')[] });
      const svg = renderToStaticMarkup(
        React.createElement(ChordDiagramSVG, {
          diagram: d,
          width: castDiagramW,
          lineColor: themeFg,
          chordColor: themeChord,
          nameColor: themeChord,
          fontFamily: svs.fontFamily || undefined,
          nameFontSize: svs.chords.fontSize || undefined,
        }),
      );
      diagramSvgs.push(`<div style="flex:0 0 auto;">${svg}</div>`);
    }
    // <details> wrapper makes the bar toggleable in plain HTML (no
    // JS needed). Inner strip is `display: flex; overflow-x: auto`
    // so when the bar is wider than the viewport, the audience can
    // scroll horizontally with finger / mouse-wheel.
    chordBarHtml = `
<details class="cast-chord-bar" open style="position:sticky;top:0;z-index:10;margin:0 -32px 12px;padding:0 32px 8px;background:${themeBg};border-bottom:1px solid ${themeFg}22;">
  <summary style="cursor:pointer;font-size:0.85em;font-weight:600;color:${themeMuted};padding:6px 0;list-style:none;user-select:none;">
    <span class="cast-chord-bar-toggle">Chord diagrams ▾</span>
  </summary>
  <div class="cast-chord-bar-strip" style="display:flex;gap:14px;overflow-x:auto;padding:8px 4px 4px;-webkit-overflow-scrolling:touch;">
    ${diagramSvgs.join('')}
  </div>
</details>`;
  }

  const html = toHtml(song, {
    layout,
    style: svs,
    songCentered,
    themeBackground: themeBg,
    themeForeground: themeFg,
    themeMuted: themeMuted,
    themeChord: themeChord,
    themeAccent: themeAccent,
    themeSection: themeSection,
    chordBarHtml,
    chordGrids,
  });

  // Splice the receiver tweaks into the document right before
  // `</style>` (the exporter always emits a single inline style block).
  // If for any reason there's no </style>, fall through unchanged.
  const tweaks = buildReceiverTweaks(themeBg, themeFg);
  const styleEnd = html.indexOf('</style>');
  let finalHtml = styleEnd > -1
    ? html.slice(0, styleEnd) + tweaks + html.slice(styleEnd)
    : html.replace('</head>', `<style>${tweaks}</style></head>`);

  // Compute auto-scroll parameters for the receiver-side JS.
  //   - durationSec: parsed from song.duration ("MM:SS") when set.
  //     If parseable, the receiver scrolls the whole song-body over
  //     this number of seconds.
  //   - autoScrollSpeed: the user's slider value 1-100, mapped to
  //     ~1.2 .. 120 px/s. Used as the fallback when no duration set.
  const durationSec = parseDurationToSeconds(song.duration);
  const autoScrollSpeed = settings.autoScrollSpeed ?? 40;
  const autoScrollPxPerSec = (autoScrollSpeed / 100) * 120;
  // Seed the receiver's initial auto-scroll mode from the song's saved
  // preference, mirroring the desktop's player-store rule: honour the
  // stored value, else default to 'duration' when the song has a
  // duration, else 'speed'. The receiver toolbar exposes a mode chooser
  // so the audience-side viewer can switch even when we auto-picked.
  const initialAutoScrollMode: 'duration' | 'speed' =
    song.preferences?.autoScrollMode ?? (durationSec !== null ? 'duration' : 'speed');
  const toolbar = buildReceiverToolbar({
    themeBg,
    themeFg,
    themeMuted,
    themeAccent,
    durationSec,
    autoScrollPxPerSec,
    initialMode: initialAutoScrollMode,
  });

  // Inject the toolbar element and its driving JS right before
  // `</body>`. The toolbar handles view-mode toggle (lyrics-only vs.
  // lyrics+chords) and auto-scroll start/stop. View-mode is reflected
  // on <body data-view-mode="..."> so the existing
  // `data-cast-mode="lyrics"` CSS rules pick up the change.
  finalHtml = finalHtml.replace('</body>', toolbar + '</body>');

  // Initial view-mode defaults to lyrics-only — most audiences want
  // to sing along without the chord clutter, and the receiver toolbar
  // lets them switch to lyrics+chords with a tap. We seed the
  // attributes on BOTH <html> and <body> so the chord-hiding CSS
  // rules apply on the very first paint with no toggle click required.
  finalHtml = finalHtml.replace(
    '<html',
    '<html data-view-mode="lyrics" data-cast-mode="lyrics"',
  );
  finalHtml = finalHtml.replace(
    '<body>',
    '<body data-view-mode="lyrics" data-cast-mode="lyrics">',
  );

  return finalHtml;
}

function parseDurationToSeconds(d: string | undefined): number | null {
  if (!d) return null;
  const parts = d.split(':');
  if (parts.length !== 2) return null;
  const m = parseInt(parts[0]!, 10);
  const s = parseInt(parts[1]!, 10);
  if (isNaN(m) || isNaN(s) || s >= 60) return null;
  return m * 60 + s;
}

interface ReceiverToolbarOpts {
  themeBg: string;
  themeFg: string;
  themeMuted: string;
  themeAccent: string;
  /** Total seconds to scroll the whole body over. When null the song
   *  has no duration set: Duration mode is disabled in the mode chooser
   *  and the receiver falls back to Speed mode. */
  durationSec: number | null;
  /** Fallback px/sec when Speed mode is active. */
  autoScrollPxPerSec: number;
  /** Mode the receiver should start in. */
  initialMode: 'duration' | 'speed';
}

/**
 * The receiver toolbar is a small fixed-bottom strip with:
 *   - A pill switch between "Lyrics only" and "Lyrics + chords".
 *   - A play/pause button for auto-scroll.
 *
 * View-mode toggle: sets `data-view-mode` on <body>. CSS rules in the
 * receiver-tweaks stylesheet hide chord-related elements when this is
 * "lyrics".
 *
 * Auto-scroll: requestAnimationFrame loop that calls window.scrollBy.
 * Pixel-per-second rate is computed from song duration when known,
 * otherwise from the user's autoScrollSpeed setting. The loop stops
 * automatically when it reaches the bottom of the document. Manual
 * scroll (the user dragging the page) doesn't fight it — we just keep
 * adding pxPerSec * dt to the current scrollY each frame.
 */
function buildReceiverToolbar(opts: ReceiverToolbarOpts): string {
  const { themeBg, themeFg, themeMuted, themeAccent, durationSec, autoScrollPxPerSec, initialMode } = opts;
  // Duration mode can only work when we actually have a duration; if the
  // receiver was seeded with 'duration' but durationSec is null (song has
  // none), silently fall back to 'speed' so the initial paint is coherent
  // with what the audience will actually see when they hit play.
  const effectiveInitialMode: 'duration' | 'speed' = initialMode === 'duration' && durationSec === null ? 'speed' : initialMode;
  const hasDuration = durationSec !== null;
  // Inline styles + a small CSS block; everything is scoped under
  // .cast-toolbar so it can't collide with the song body's styles.
  const styles = `
.cast-toolbar {
  position: fixed;
  left: 50%;
  bottom: max(12px, env(safe-area-inset-bottom, 0px));
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 6px;
  background: ${themeBg};
  border: 1px solid ${themeFg}33;
  border-radius: 999px;
  padding: 5px 8px;
  z-index: 100;
  font: 13px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  box-shadow: 0 4px 18px rgba(0,0,0,0.25);
  -webkit-tap-highlight-color: transparent;
  max-width: calc(100vw - 16px);
}
.cast-toolbar button {
  background: transparent;
  color: ${themeMuted};
  border: 0;
  padding: 6px 10px;
  border-radius: 999px;
  cursor: pointer;
  font: inherit;
  white-space: nowrap;
  transition: background 120ms, color 120ms;
}
.cast-toolbar button:hover { color: ${themeFg}; }
.cast-toolbar .pill {
  display: inline-flex;
  background: ${themeFg}11;
  border-radius: 999px;
  padding: 2px;
  gap: 2px;
  flex-shrink: 0;
}
.cast-toolbar .pill button.active { background: ${themeAccent}; color: #fff; }
.cast-toolbar .scroll-btn.active { background: ${themeAccent}; color: #fff; }
/* Auto-scroll cluster — bundles the play/pause button with a small
   chevron that opens a speed-slider popover above. Only emitted when
   the song has no duration set; otherwise the scroll button stands
   alone. */
.cast-toolbar .scroll-cluster {
  position: relative;
  display: inline-flex;
  align-items: stretch;
  border-radius: 999px;
  overflow: visible;
}
.cast-toolbar .scroll-cluster .scroll-btn {
  border-top-right-radius: 0;
  border-bottom-right-radius: 0;
  padding-right: 8px;
}
.cast-toolbar .speed-toggle {
  background: transparent;
  color: ${themeMuted};
  border: 0;
  border-left: 1px solid ${themeFg}22;
  padding: 6px 8px;
  border-radius: 0 999px 999px 0;
  cursor: pointer;
  font: inherit;
  line-height: 1;
}
.cast-toolbar .speed-toggle:hover { color: ${themeFg}; }
.cast-toolbar .scroll-btn.active + .speed-toggle {
  background: ${themeAccent};
  color: #fff;
  border-left-color: rgba(255,255,255,0.25);
}
/* Slider popover — anchored above the scroll cluster so it doesn't
   push the toolbar wider. Uses position:absolute against the cluster's
   relative wrapper (no portal needed — the toolbar sits at the bottom
   of the viewport with plenty of room above it). */
.cast-toolbar .speed-popover {
  position: absolute;
  left: 50%;
  bottom: calc(100% + 8px);
  transform: translateX(-50%);
  background: ${themeBg};
  border: 1px solid ${themeFg}33;
  border-radius: 12px;
  padding: 10px 12px;
  box-shadow: 0 4px 18px rgba(0,0,0,0.25);
  min-width: 220px;
  z-index: 110;
}
.cast-toolbar .speed-popover[hidden] { display: none; }
.cast-toolbar .speed-popover .speed-label {
  display: block;
  font-size: 0.75em;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: ${themeMuted};
  margin-bottom: 6px;
}
/* Mode chooser (Duration vs Speed) row inside the popover — same
   segmented-button look as the desktop AutoScrollControl. */
.cast-toolbar .speed-popover .mode-row {
  display: flex;
  border: 1px solid ${themeFg}33;
  border-radius: 8px;
  overflow: hidden;
  margin-bottom: 10px;
}
.cast-toolbar .speed-popover .mode-row button {
  flex: 1;
  background: transparent;
  color: ${themeMuted};
  border: 0;
  padding: 6px 8px;
  border-radius: 0;
  cursor: pointer;
  font: inherit;
  font-size: 0.85em;
  font-weight: 600;
}
.cast-toolbar .speed-popover .mode-row button + button {
  border-left: 1px solid ${themeFg}22;
}
.cast-toolbar .speed-popover .mode-row button.active {
  background: ${themeAccent};
  color: #fff;
}
.cast-toolbar .speed-popover .mode-row button[disabled] {
  opacity: 0.4;
  cursor: not-allowed;
}
.cast-toolbar .speed-popover .duration-hint {
  color: ${themeMuted};
  font-size: 0.85em;
  line-height: 1.35;
}
/* Reserve enough height so switching between the slider (Speed) and the
   one-line hint (Duration) doesn't resize the popover and make it jump. */
.cast-toolbar .speed-popover .mode-body {
  min-height: 44px;
  display: flex;
  flex-direction: column;
  justify-content: center;
}
.cast-toolbar .speed-popover [data-body="speed"][hidden],
.cast-toolbar .speed-popover [data-body="duration"][hidden] { display: none; }
.cast-toolbar .speed-popover .speed-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.cast-toolbar .speed-popover .speed-icon {
  color: ${themeMuted};
  font-size: 0.95em;
  user-select: none;
}
.cast-toolbar .speed-popover input[type="range"] {
  -webkit-appearance: none;
  appearance: none;
  flex: 1;
  height: 4px;
  background: ${themeFg}22;
  border-radius: 999px;
  outline: none;
  cursor: pointer;
  margin: 0;
}
.cast-toolbar .speed-popover input[type="range"]::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: ${themeAccent};
  border: 0;
  cursor: pointer;
}
.cast-toolbar .speed-popover input[type="range"]::-moz-range-thumb {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: ${themeAccent};
  border: 0;
  cursor: pointer;
}
/* Phone / narrow viewport: shrink the chrome. */
@media (max-width: 480px) {
  .cast-toolbar {
    font-size: 12px;
    padding: 4px 6px;
    gap: 4px;
    bottom: max(8px, env(safe-area-inset-bottom, 0px));
  }
  .cast-toolbar button { padding: 5px 8px; }
  .cast-toolbar .pill { padding: 2px; gap: 1px; }
  .cast-toolbar .speed-toggle { padding: 5px 6px; }
  .cast-toolbar .speed-popover { min-width: 200px; padding: 8px 10px; }
}
/* Very narrow viewport (small phones, landscape keyboards): hide the
   "Auto" label on the scroll button so the whole toolbar still fits
   in one line. */
@media (max-width: 360px) {
  .cast-toolbar .scroll-btn .label { display: none; }
  .cast-toolbar .speed-popover { min-width: 180px; }
}
/* Reserve space at the bottom so the toolbar doesn't cover the last
   lyric line when the user scrolls all the way down. */
body { padding-bottom: 88px; }
`;
  // The chevron next to the scroll button always opens a popover with a
  // mode chooser (Duration vs Speed) — matching the desktop's
  // AutoScrollControl. Duration is disabled when the song has none. The
  // popover body swaps between a duration hint and the speed slider
  // depending on which mode is active.
  const speedInitialValue = Math.round((autoScrollPxPerSec / 120) * 100);
  const durationHintHtml = hasDuration
    ? `Covers the song in the song's duration.`
    : `This song has no duration set — Speed mode is used.`;
  const scrollClusterHtml = `<div class="scroll-cluster" data-has-speed="true">
    <button class="scroll-btn" data-action="toggle-scroll" aria-label="Auto-scroll" title="Auto-scroll"><span class="icon">▶</span> <span class="label">Auto</span></button>
    <button class="speed-toggle" data-action="toggle-speed" aria-label="Auto-scroll options" title="Auto-scroll options" aria-expanded="false">▾</button>
    <div class="speed-popover" role="dialog" aria-label="Auto-scroll options" hidden>
      <span class="speed-label">Auto-scroll mode</span>
      <div class="mode-row" role="tablist">
        <button data-mode="duration"${effectiveInitialMode === 'duration' ? ' class="active"' : ''}${hasDuration ? '' : ' disabled'} title="Pace by the song duration">Duration</button>
        <button data-mode="speed"${effectiveInitialMode === 'speed' ? ' class="active"' : ''} title="Pace by the manual speed slider">Speed</button>
      </div>
      <div class="mode-body">
        <div data-body="duration"${effectiveInitialMode === 'duration' ? '' : ' hidden'}>
          <span class="duration-hint">${durationHintHtml}</span>
        </div>
        <div data-body="speed"${effectiveInitialMode === 'speed' ? '' : ' hidden'}>
          <span class="speed-label">Speed</span>
          <div class="speed-row">
            <span class="speed-icon" aria-hidden="true">🐢</span>
            <input type="range" min="1" max="100" value="${speedInitialValue}" aria-label="Auto-scroll speed" />
            <span class="speed-icon" aria-hidden="true">🐇</span>
          </div>
        </div>
      </div>
    </div>
  </div>`;
  const html = `<div class="cast-toolbar" aria-label="Cast controls">
  <div class="pill" role="tablist" aria-label="View mode">
    <button data-view="lyrics" class="active" aria-label="Lyrics only">Lyrics</button>
    <button data-view="lyrics-chords" aria-label="Lyrics and chords">+ Chords</button>
  </div>
  ${scrollClusterHtml}
</div>`;
  // Driving JS — inline so the iframe srcdoc carries it. No external
  // deps; uses requestAnimationFrame for the scroll loop.
  const js = `
(function () {
  var body = document.body;
  var root = document.documentElement;
  // View-mode toggle pill. The seeded attributes live on BOTH <html>
  // and <body> (see buildCastHtml), and the CSS uses ancestor attribute
  // selectors — so the toggle must clear/set both, otherwise the
  // seeded <html data-view-mode="lyrics"> keeps hiding chords even
  // after the user switches to lyrics+chords.
  var pillBtns = document.querySelectorAll('.cast-toolbar [data-view]');
  pillBtns.forEach(function (btn) {
    btn.addEventListener('click', function () {
      var view = btn.getAttribute('data-view');
      var castMode = view === 'lyrics' ? 'lyrics' : 'lyrics-chords';
      body.setAttribute('data-view-mode', view);
      body.setAttribute('data-cast-mode', castMode);
      root.setAttribute('data-view-mode', view);
      root.setAttribute('data-cast-mode', castMode);
      pillBtns.forEach(function (b) {
        b.classList.toggle('active', b === btn);
      });
    });
  });

  // Auto-scroll
  var scrollBtn = document.querySelector('.cast-toolbar [data-action="toggle-scroll"]');
  var rafId = null;
  var lastTs = 0;
  var posY = 0;
  var lastSetY = 0;
  var durationSec = ${durationSec === null ? 'null' : String(durationSec)};
  var fallbackPxPerSec = ${autoScrollPxPerSec.toFixed(3)};
  // Current auto-scroll pacing mode. The mode chooser inside the
  // popover switches this between 'duration' and 'speed'. Duration
  // mode is only meaningful when durationSec > 0; the desktop bakes
  // the initial value with that check applied, but we defend against
  // stale HTML by falling back to speed if duration is missing.
  var mode = ${JSON.stringify(effectiveInitialMode)};
  if (mode === 'duration' && !(durationSec && durationSec > 0)) mode = 'speed';
  // Speed slider lives inside the .speed-popover. Maps 1..100 to
  // ~1.2..120 px/s so the low end is "barely moving" and the high end
  // is "fast read".
  var speedSlider = document.querySelector('.cast-toolbar .speed-popover input[type="range"]');
  if (speedSlider) {
    speedSlider.addEventListener('input', function () {
      var v = parseFloat(speedSlider.value) || 1;
      fallbackPxPerSec = (v / 100) * 120;
    });
  }
  // Mode chooser — segmented buttons at the top of the popover. Wire
  // each button to update the active class, swap the popover body
  // (duration hint ↔ speed slider), and update the pacing variable.
  var modeBtns = document.querySelectorAll('.cast-toolbar .speed-popover .mode-row button');
  var bodyDuration = document.querySelector('.cast-toolbar .speed-popover [data-body="duration"]');
  var bodySpeed = document.querySelector('.cast-toolbar .speed-popover [data-body="speed"]');
  function applyMode(next) {
    // Guard: 'duration' only when we actually have a duration.
    if (next === 'duration' && !(durationSec && durationSec > 0)) return;
    mode = next;
    modeBtns.forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-mode') === mode);
    });
    if (bodyDuration && bodySpeed) {
      if (mode === 'duration') {
        bodyDuration.removeAttribute('hidden');
        bodySpeed.setAttribute('hidden', '');
      } else {
        bodySpeed.removeAttribute('hidden');
        bodyDuration.setAttribute('hidden', '');
      }
    }
  }
  modeBtns.forEach(function (btn) {
    btn.addEventListener('click', function () {
      if (btn.hasAttribute('disabled')) return;
      applyMode(btn.getAttribute('data-mode'));
    });
  });
  // Chevron toggle for the options popover. Closes on outside-click so
  // the user can dismiss it without aiming at the chevron again.
  var speedToggle = document.querySelector('.cast-toolbar .speed-toggle');
  var speedPopover = document.querySelector('.cast-toolbar .speed-popover');
  if (speedToggle && speedPopover) {
    speedToggle.addEventListener('click', function (e) {
      e.stopPropagation();
      var isOpen = !speedPopover.hasAttribute('hidden');
      if (isOpen) {
        speedPopover.setAttribute('hidden', '');
        speedToggle.setAttribute('aria-expanded', 'false');
      } else {
        speedPopover.removeAttribute('hidden');
        speedToggle.setAttribute('aria-expanded', 'true');
      }
    });
    document.addEventListener('click', function (e) {
      if (speedPopover.hasAttribute('hidden')) return;
      var t = e.target;
      if (speedPopover.contains(t) || speedToggle.contains(t)) return;
      speedPopover.setAttribute('hidden', '');
      speedToggle.setAttribute('aria-expanded', 'false');
    });
  }
  function maxScroll() {
    return Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
  }
  function pxPerSec() {
    // Honour the user's explicit mode choice: only fall back to speed
    // when duration mode has no viable duration.
    if (mode === 'duration' && durationSec && durationSec > 0) {
      var m = maxScroll();
      if (m > 0) return m / durationSec;
    }
    return fallbackPxPerSec;
  }
  function tick(ts) {
    if (rafId === null) return;
    var dt = lastTs ? (ts - lastTs) / 1000 : 0;
    lastTs = ts;
    // If the user manually scrolled, sync our tracked position.
    if (Math.abs(window.scrollY - lastSetY) > 2) {
      posY = window.scrollY;
    }
    posY += pxPerSec() * dt;
    var m = maxScroll();
    if (posY >= m) {
      posY = m;
      window.scrollTo(0, posY);
      stopScroll();
      return;
    }
    window.scrollTo(0, posY);
    lastSetY = window.scrollY;
    rafId = requestAnimationFrame(tick);
  }
  var scrollIcon = scrollBtn.querySelector('.icon');
  function startScroll() {
    if (rafId !== null) return;
    posY = window.scrollY;
    lastSetY = posY;
    lastTs = 0;
    scrollBtn.classList.add('active');
    if (scrollIcon) scrollIcon.textContent = '⏸';
    rafId = requestAnimationFrame(tick);
  }
  function stopScroll() {
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    scrollBtn.classList.remove('active');
    if (scrollIcon) scrollIcon.textContent = '▶';
  }
  scrollBtn.addEventListener('click', function () {
    if (rafId !== null) stopScroll();
    else startScroll();
  });
})();
`;
  return `<style>${styles}</style>${html}<script>${js}</script>`;
}
