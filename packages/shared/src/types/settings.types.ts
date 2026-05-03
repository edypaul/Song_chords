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
  | 'exportSong'
  | 'editSong'
  | 'zoomIn'
  | 'zoomOut'
  | 'zoomReset';

export interface KeyboardShortcuts {
  toggleInlineDiagrams: string;
  toggleChordBar: string;
  toggleLyricsOnly: string;
  toggleMetronome: string;
  toggleSongNotes: string;
  toggleAutoScroll: string;
  transposeUp: string;
  transposeDown: string;
  exportSong: string;
  editSong: string;
  zoomIn: string;
  zoomOut: string;
  zoomReset: string;
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
}
