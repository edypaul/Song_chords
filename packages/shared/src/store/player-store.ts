import { create } from 'zustand';
import { parseChordPro } from '../parser/chordpro-parser';
import { transposeSong, transposeKey, computeSectionFlats } from '../transpose/transposer';
import type { ParsedSong } from '../types/parser.types';
import type { Song, SongPreferences } from '../types/song.types';
import type { ViewMode } from '../types/settings.types';
import { FLAT_KEYS, SHARP_KEYS } from '../constants/chord-names';
import { useSettingsStore } from './settings-store';

export const TRANSPOSE_MIN = -11;
export const TRANSPOSE_MAX = 11;

/**
 * Resolve flats-vs-sharps for a given key using the circle of fifths.
 * - Flat-side keys (F, Bb, Eb, Ab, Db, Gb + relative minors) → flats.
 * - Sharp-side keys (G, D, A, E, B, F#, C# + relative minors) → sharps.
 * - C / Am / unknown → user `fallback` preference.
 */
function resolveFlatsForKey(key: string | undefined, fallback: boolean): boolean {
  if (!key) return fallback;
  if (FLAT_KEYS.has(key)) return true;
  if (SHARP_KEYS.has(key)) return false;
  return fallback;
}

interface PlayerStore {
  activeSong: Song | null;
  parsedSong: ParsedSong | null;
  displayedSong: ParsedSong | null;
  transposeSteps: number;
  capo: number;
  preferFlats: boolean;
  fontSize: number;
  autoScrollActive: boolean;
  autoScrollSpeed: number;
  /** Auto-scroll pacing mode for the active song. Seeded from the song's
   *  preferences / duration on load; the user can switch it at any time. */
  autoScrollMode: 'duration' | 'speed';
  /** True when auto-scroll stopped because it reached the BOTTOM of the
   *  song (vs the user stopping it manually). Lets the UI keep the toolbar
   *  hidden so the page doesn't reflow/jump away from the bottom. Reset
   *  whenever auto-scroll is (re)started or the song changes. */
  autoScrollHitBottom: boolean;
  viewMode: ViewMode;

  // Performance mode state
  performanceMode: boolean;
  perfRunning: boolean;
  perfPaused: boolean;

  loadSong: (song: Song) => void;
  clearSong: () => void;
  refreshDisplayed: () => void;
  transposeUp: () => void;
  transposeDown: () => void;
  resetTranspose: () => void;
  setCapo: (capo: number) => void;
  togglePreferFlats: () => void;
  setFontSize: (size: number) => void;
  toggleAutoScroll: () => void;
  setScrollSpeed: (speed: number) => void;
  /** Switch the active song's auto-scroll pacing mode and persist it to
   *  the song's preferences. */
  setScrollMode: (mode: 'duration' | 'speed', persist?: (prefs: SongPreferences) => void) => void;
  setViewMode: (mode: ViewMode) => void;
  getPreferences: () => SongPreferences;
  enterPerformance: () => void;
  exitPerformance: () => void;
  perfStart: () => void;
  perfStop: () => void;
  perfPause: () => void;
  perfResume: () => void;
}

/**
 * Recomputes the displayed song from the raw parsed song.
 *
 * Capo works by raising every string by `capo` semitones, so the chord
 * *shapes* a guitarist/ukulele player actually fingers are the concert-pitch
 * chords transposed DOWN by `capo`.  The formula is therefore:
 *
 *   shapeSteps = transposeSteps - capo
 *
 * Example: song in G, capo 2, no user-transpose → shapeSteps = -2 → the
 * player fingers an F shape (which sounds as G through the capo).
 */
function recompute(
  parsedSong: ParsedSong | null,
  steps: number,
  capo: number,
  preferFlats: boolean,
): ParsedSong | null {
  if (!parsedSong) return null;
  const shapeSteps = steps - capo;

  // Global accidentals override: when user picked Flats/Sharps, force that
  // spelling throughout the song; only 'auto' consults the circle of fifths
  // and section-level {key:} directives.
  const mode = useSettingsStore.getState().settings.accidentalMode ?? 'auto';
  if (mode === 'flats') return transposeSong(parsedSong, shapeSteps, true);
  if (mode === 'sharps') return transposeSong(parsedSong, shapeSteps, false);

  const playingKey = parsedSong.metadata.key
    ? transposeKey(parsedSong.metadata.key, shapeSteps)
    : undefined;
  const songDefault = resolveFlatsForKey(playingKey, preferFlats);
  const perLine = computeSectionFlats(parsedSong, shapeSteps, songDefault);
  return transposeSong(parsedSong, shapeSteps, (i) => perLine[i] ?? songDefault);
}

export const usePlayerStore = create<PlayerStore>((set, get) => ({
  activeSong: null,
  parsedSong: null,
  displayedSong: null,
  transposeSteps: 0,
  capo: 0,
  preferFlats: false,
  fontSize: 16,
  autoScrollActive: false,
  autoScrollSpeed: 40,
  autoScrollMode: 'duration',
  autoScrollHitBottom: false,
  viewMode: 'chords',

  performanceMode: false,
  perfRunning: false,
  perfPaused: false,

  loadSong: (song) => {
    const parsed = parseChordPro(song.content);

    // Overlay the song entity's key onto the parsed metadata when the content
    // itself doesn't declare one (via `{key: X}`). The transposer relies on
    // `parsedSong.metadata.key` to pick sharp- vs flat-side spellings.
    if (!parsed.metadata.key && song.key) parsed.metadata.key = song.key;

    const prefs = song.preferences ?? {};
    const transposeSteps = prefs.transposeSteps ?? 0;
    const capo = prefs.transposeSteps !== undefined ? (song.capo ?? 0) : (song.capo ?? 0);
    // Base flat/sharp preference on the *playing* key (what the fingers see),
    // not the sounding key, using the circle-of-fifths resolver. C / Am /
    // unknown keys fall back to `false` (sharps) until the user overrides.
    const playingKey = song.key ? transposeKey(song.key, -capo) : undefined;
    const preferFlats = resolveFlatsForKey(playingKey, false);

    // Auto-scroll mode: honour the saved per-song preference; otherwise
    // default to duration-based when the song has a duration, else speed.
    const hasDuration = typeof song.duration === 'string' && song.duration.trim() !== '';
    const autoScrollMode: 'duration' | 'speed' =
      prefs.autoScrollMode ?? (hasDuration ? 'duration' : 'speed');

    set({
      activeSong: song,
      parsedSong: parsed,
      displayedSong: recompute(parsed, transposeSteps, capo, preferFlats),
      transposeSteps,
      capo,
      preferFlats,
      autoScrollMode,
      autoScrollHitBottom: false,
      viewMode: (prefs.viewMode as ViewMode) ?? 'chords',
    });
  },

  clearSong: () => set({ activeSong: null, parsedSong: null, displayedSong: null, transposeSteps: 0 }),

  refreshDisplayed: () => {
    const { parsedSong, transposeSteps, capo, preferFlats } = get();
    set({ displayedSong: recompute(parsedSong, transposeSteps, capo, preferFlats) });
  },

  transposeUp: () => {
    const { parsedSong, transposeSteps, capo, preferFlats } = get();
    if (transposeSteps >= TRANSPOSE_MAX) return;
    const steps = transposeSteps + 1;
    set({ transposeSteps: steps, displayedSong: recompute(parsedSong, steps, capo, preferFlats) });
  },

  transposeDown: () => {
    const { parsedSong, transposeSteps, capo, preferFlats } = get();
    if (transposeSteps <= TRANSPOSE_MIN) return;
    const steps = transposeSteps - 1;
    set({ transposeSteps: steps, displayedSong: recompute(parsedSong, steps, capo, preferFlats) });
  },

  resetTranspose: () => {
    const { parsedSong, capo, preferFlats } = get();
    set({ transposeSteps: 0, displayedSong: recompute(parsedSong, 0, capo, preferFlats) });
  },

  setCapo: (capo) => {
    const { parsedSong, transposeSteps, preferFlats } = get();
    set({ capo, displayedSong: recompute(parsedSong, transposeSteps, capo, preferFlats) });
  },

  togglePreferFlats: () => {
    const { parsedSong, transposeSteps, capo, preferFlats } = get();
    const newPreferFlats = !preferFlats;
    set({ preferFlats: newPreferFlats, displayedSong: recompute(parsedSong, transposeSteps, capo, newPreferFlats) });
  },

  setFontSize: (fontSize) => set({ fontSize }),
  toggleAutoScroll: () => set((s) => {
    const turningOn = !s.autoScrollActive;
    return {
      autoScrollActive: turningOn,
      // Clear the "hit bottom" flag only when STARTING. On stop we leave it
      // as-is: the hook sets it true just before calling this on an
      // end-of-content stop, and a manual stop leaves it false — so the UI
      // can tell the two apart.
      ...(turningOn ? { autoScrollHitBottom: false } : {}),
    };
  }),
  setScrollSpeed: (autoScrollSpeed) => set({ autoScrollSpeed }),
  setScrollMode: (autoScrollMode, persist) => {
    set({ autoScrollMode });
    // Reflect the choice on the in-memory activeSong's preferences and let
    // the caller persist it to the DB (the player store is DB-agnostic).
    const { activeSong } = get();
    if (activeSong) {
      const nextPrefs: SongPreferences = { ...(activeSong.preferences ?? {}), autoScrollMode };
      set({ activeSong: { ...activeSong, preferences: nextPrefs } });
      persist?.(nextPrefs);
    }
  },
  setViewMode: (viewMode) => set({ viewMode }),
  getPreferences: () => {
    const { transposeSteps, viewMode, autoScrollMode, activeSong } = get();
    // Preserve chordVariations (managed separately by the chord modal)
    const existing = activeSong?.preferences ?? {};
    return { ...existing, transposeSteps, viewMode, autoScrollMode };
  },

  enterPerformance: () => set({ performanceMode: true }),
  exitPerformance: () => set({
    performanceMode: false,
    perfRunning: false,
    perfPaused: false,
    autoScrollActive: false,
  }),
  perfStart: () => set({ perfRunning: true, perfPaused: false, autoScrollHitBottom: false }),
  perfStop: () => set({ perfRunning: false, perfPaused: false, autoScrollActive: false }),
  perfPause: () => set({ perfPaused: true, autoScrollActive: false }),
  perfResume: () => set({ perfPaused: false, autoScrollHitBottom: false }),
}));
