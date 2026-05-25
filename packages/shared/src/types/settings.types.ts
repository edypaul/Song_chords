import type { InstrumentType } from './chord.types';

export type ThemeType = 'light' | 'dark' | 'system';
export type ViewMode = 'chords' | 'lyrics-only' | 'chords-only';

/** Columns the user can show or hide in every song-list table (library,
 * categories drill-down, favorites). Title is always visible and not
 * included here. */
export type SongListColumn = 'artist' | 'genre' | 'key' | 'difficulty' | 'tempo' | 'duration' | 'year' | 'language' | 'chordsCount' | 'createdAt';
export const SONG_LIST_COLUMNS: SongListColumn[] = ['artist', 'genre', 'key', 'difficulty', 'tempo', 'duration', 'year', 'language', 'chordsCount', 'createdAt'];

/** Per-section style — only the fields relevant to each section are used. */
export interface SectionStyle {
  fontSize: number;
  color: string;
  background: string;
}

export interface SongViewStyle {
  preset: string;
  fontFamily: string;
  titleUppercase: boolean;
  sectionUppercase: boolean;
  lyrics: SectionStyle;   // color, fontSize
  chords: SectionStyle;   // color, fontSize
  title: SectionStyle;    // color, fontSize
  details: SectionStyle;  // color, fontSize
  section: SectionStyle;  // color, background, fontSize
  chorusBorderColor: string;
}

export interface CustomPreset {
  name: string;
  mode: 'dark' | 'light';
  style: SongViewStyle;
}

/** Named, user-rebindable keyboard shortcuts. Each entry stores a key combo
 * in the form used by parseShortcut / matchShortcut — e.g. "Ctrl+E",
 * "Shift+ArrowUp", "Space". An empty string disables that shortcut. */
export type ShortcutAction =
  | 'toggleInlineDiagrams'
  | 'toggleChordBar'
  | 'toggleLyricsOnly'
  | 'toggleMetronome'
  | 'toggleSongNotes'
  | 'toggleAutoScroll'
  | 'transposeUp'
  | 'transposeDown'
  | 'resetTranspose'
  | 'exportSong'
  | 'editSong'
  | 'toggleFavorite'
  | 'cast'
  | 'addToSetList'
  | 'toggleFullscreen'
  | 'nextSong'
  | 'prevSong'
  | 'zoomIn'
  | 'zoomOut'
  | 'zoomReset'
  | 'openSearch';

export interface KeyboardShortcuts {
  toggleInlineDiagrams: string;
  toggleChordBar: string;
  toggleLyricsOnly: string;
  toggleMetronome: string;
  toggleSongNotes: string;
  toggleAutoScroll: string;
  transposeUp: string;
  transposeDown: string;
  resetTranspose: string;
  exportSong: string;
  editSong: string;
  toggleFavorite: string;
  cast: string;
  addToSetList: string;
  toggleFullscreen: string;
  nextSong: string;
  prevSong: string;
  zoomIn: string;
  zoomOut: string;
  zoomReset: string;
  /** Opens the global search overlay from anywhere in the app. */
  openSearch: string;
  /** Modifier used for capo shortcuts — combined with a digit 0-9 to set
   *  the capo to that fret. */
  capoModifier: 'Alt' | 'Ctrl' | 'Shift' | 'Meta';
}

export interface AppSettings {
  theme: ThemeType;
  fontSize: number;
  defaultInstrument: InstrumentType;
  preferFlats: boolean;
  accidentalMode: 'auto' | 'flats' | 'sharps';
  scrollSpeed: number;
  showChordDiagrams: boolean;
  autoScrollEnabled: boolean;
  defaultTranspose: number;
  songViewStyle: SongViewStyle;
  customPresets: Record<string, CustomPreset>;
  songCentered: boolean;
  chordBarPosition: 'top' | 'bottom' | 'right' | 'off';
  inlineChordDiagrams: boolean;
  customChords: Record<string, import('../types/chord.types').ChordDiagram[]>;
  /**
   * Global default chord voicing per instrument. When the user picks a
   * voicing in the Chord Library and clicks "Set as default for all
   * songs", we store its index here keyed by instrument + chord name.
   * Per-song overrides (`song.preferences.chordVariations`) ALWAYS
   * win over this for the song they belong to — these globals are only
   * the fallback when a song hasn't pinned that chord itself.
   *
   * Shape: `defaultChordVariations[instrument][chordName] = index`.
   * Optional/partial so older settings load cleanly with `?? {}` /
   * `?? undefined` chains; treat any missing entry as "no default".
   */
  defaultChordVariations?: Partial<Record<
    import('../types/chord.types').InstrumentType,
    Record<string, number>
  >>;
  perfMetroEnabled: boolean;
  perfScrollEnabled: boolean;
  perfZoom: number;
  /** Show the section navigator panel in song views. Persists across sessions. */
  sectionPanelOpen: boolean;
  /** How chord names are displayed. `letter` is the canonical A-G form
   *  (also used in storage). `latin` shows solfège names: DO, RE, MI, FA,
   *  SOL, LA, SI — uppercase for major, lowercase with the `m` dropped for
   *  minor (e.g. Gm → sol, Gm7 → sol7). Bass notes keep uppercase. */
  chordNotation: 'letter' | 'latin';
  /** Which columns appear in every song-list table. Title is always shown. */
  songListColumns: Record<SongListColumn, boolean>;
  shortcuts: KeyboardShortcuts;
  /**
   * Per-user persistent "don't show again" flags for in-app hint
   * banners. Keyed by a stable hint id (e.g. `chordSpelling`) so a
   * single setting covers multiple banners and future hint widgets
   * without schema churn. A missing key (or `false`) means the
   * banner is still shown.
   *
   * Used by the chord-spelling warning on the Import page and the
   * new-song / song-edit Song tab. The chord-spelling notice INSIDE
   * the Settings library-restore confirmation dialog is intentionally
   * not gated by this — that one is part of the destructive-action
   * confirmation and must always show.
   */
  dismissedHints?: Record<string, boolean>;
}
