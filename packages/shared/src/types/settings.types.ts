import type { InstrumentType } from './chord.types';

export type ThemeType = 'light' | 'dark' | 'system';
export type ViewMode = 'chords' | 'lyrics-only' | 'chords-only';

/** Supported UI languages. `en` is the source-of-truth dictionary
 *  every other locale falls back to when a key is missing. Add a new
 *  language by extending this union AND providing a dictionary in
 *  `packages/desktop/src/i18n/dict/<code>.ts`. */
export type UiLanguage = 'en' | 'es' | 'pt' | 'it' | 'fr' | 'de';

/** Columns the user can show or hide in every song-list table (library,
 * categories drill-down, favorites). Title is always visible and not
 * included here. */
export type SongListColumn = 'artist' | 'genre' | 'key' | 'difficulty' | 'tempo' | 'duration' | 'year' | 'language' | 'chordsCount' | 'createdAt';
export const SONG_LIST_COLUMNS: SongListColumn[] = ['artist', 'genre', 'key', 'difficulty', 'tempo', 'duration', 'year', 'language', 'chordsCount', 'createdAt'];

/** Identifiers for every customisable card on the Dashboard. `stats` is the
 *  top row of count tiles (treated as one group); each other key is a single
 *  card. Adding a card here + a default in DEFAULT_SETTINGS + a render gate in
 *  DashboardPage is all that's needed to make a new card toggleable. */
export type DashboardCardKey =
  | 'stats'
  | 'favorites'
  | 'setlists'
  | 'recentlyViewed'
  | 'recentlyEdited'
  | 'difficulty'
  | 'topKeys'
  | 'topGenres'
  | 'topArtists'
  | 'languages'
  | 'decades'
  | 'topTags'
  | 'recentlyAdded';
export const DASHBOARD_CARDS: DashboardCardKey[] = [
  'stats', 'favorites', 'setlists', 'recentlyViewed', 'recentlyEdited',
  'difficulty', 'topKeys', 'topGenres', 'topArtists', 'languages',
  'decades', 'topTags', 'recentlyAdded',
];

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
  | 'openSearch'
  | 'toggleToolbar'
  | 'toggleSongTrainer';

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
  /** Show / hide the Song view + Perform toolbar so the song content
   *  gets more vertical room. Distinct from auto-scroll (which used to
   *  hide it as a side effect). */
  toggleToolbar: string;
  /** Toggle the Song Trainer — hides a percentage of chord names
   *  behind `?` marks the user can click to reveal, so they can
   *  practise guessing the next chord. Only active in the default
   *  chords-over-lyrics view. */
  toggleSongTrainer: string;
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
  /** Global toggle for the read-only annotation layer. Preserved on
   *  disk; annotations themselves live on each song, so flipping this
   *  hides the overlay everywhere without touching the data. Default
   *  true so a user who annotates a song sees the result the next
   *  time they open it.
   *  LEGACY: superseded by the per-view `annotationsIn*` switches
   *  below, which fall back to this value so existing users keep
   *  their choice. */
  showAnnotations: boolean;
  /** Per-view visibility switches (Settings → Display). Sticky-note
   *  switches auto-open each song's note panel in that view (the
   *  toolbar button still toggles it ad hoc); annotation switches
   *  show/hide the drawn-annotation overlay in that view. */
  stickyNotesInPerform?: boolean;
  stickyNotesInSongView?: boolean;
  annotationsInPerform?: boolean;
  annotationsInSongView?: boolean;
  customChords: Record<string, import('../types/chord.types').ChordDiagram[]>;
  /**
   * User-defined fretted instruments, keyed by id (`custom:…`). Their
   * chords live in `customChords` tagged with the instrument id, so
   * deleting an instrument must also drop those voicings (the Chord
   * Library's manager does). Backed up together with custom chords.
   */
  customInstruments: Record<string, import('../types/chord.types').CustomInstrument>;
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
  /** Display order for the song-list columns (Title stays leftmost). The
   *  user can drag-and-drop column headers to reorder — the result is
   *  written here and reused across the Library, Favorites and Categories
   *  pages. Sanitised on read: unknown keys are dropped, missing keys are
   *  appended so a new column added in a future version shows up. */
  songListColumnOrder: SongListColumn[];
  /** Which cards are visible on the Dashboard. Users can toggle any of
   *  them on/off from the Dashboard "Customize" popover. The header
   *  (`stats` — the top row of count tiles) is treated as one group. */
  dashboardCards: Record<DashboardCardKey, boolean>;
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
  /** UI language for menus, buttons, tooltips, and dialog text.
   *  Song content itself (lyrics, chord names, notes) is user data
   *  and never translated. Defaults to `'en'` for backwards compat;
   *  older settings blobs simply fall through to English. */
  uiLanguage?: UiLanguage;
}
