import type { InstrumentType } from './chord.types';

export type ThemeType = 'light' | 'dark' | 'system';
export type ViewMode = 'chords' | 'lyrics-only' | 'chords-only';

/** Columns the user can show or hide in every song-list table (library,
 * categories drill-down, favorites). Title is always visible and not
 * included here. */
export type SongListColumn = 'artist' | 'genre' | 'key' | 'difficulty' | 'tempo' | 'year' | 'language';
export const SONG_LIST_COLUMNS: SongListColumn[] = ['artist', 'genre', 'key', 'difficulty', 'tempo', 'year', 'language'];

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
  /** Which columns appear in every song-list table. Title is always shown. */
  songListColumns: Record<SongListColumn, boolean>;
}
