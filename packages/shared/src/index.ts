// Types
export type { Song, SongCreateInput, SongUpdateInput, SongMetadata, SongPreferences } from './types/song.types';
export type { SetList, SetListEntry, SetListWithSongs, SetListCreateInput } from './types/setlist.types';
export type { FavoriteEntry } from './types/favorite.types';
export type {
  ParsedSong, ParsedLine, Token, ChordToken, LyricToken,
  DirectiveToken, SectionToken, CommentToken, SectionType,
  ChordGridBeat, ChordGridBar, ChordGridRow, ChordGridToken,
} from './types/parser.types';
export type { ChordDiagram, InstrumentType } from './types/chord.types';
export type { AppSettings, ThemeType, ViewMode, SongViewStyle, SectionStyle, CustomPreset, SongListColumn, KeyboardShortcuts, ShortcutAction } from './types/settings.types';
export { SONG_LIST_COLUMNS } from './types/settings.types';

// Constants
export { SHARPS, FLATS, FLAT_KEYS, SHARP_KEYS, ALL_KEYS } from './constants/chord-names';
export { DEFAULT_SETTINGS, DEFAULT_SHORTCUTS } from './constants/default-settings';
export { FONT_FAMILIES } from './constants/font-families';
export type { FontOption } from './constants/font-families';
export { SONG_STYLE_PRESETS, DEFAULT_SONG_VIEW_STYLE, FONT_SIZE_LIMITS } from './constants/song-view-presets';
export type { SongStylePreset } from './constants/song-view-presets';

// Parser
export { parseChordPro, parsePlainText } from './parser/chordpro-parser';

// Transpose
export { transposeChord, transposeNote, transposeKey, transposeSong, getSoundingKey, getPlayingKey, computeSectionFlats } from './transpose/transposer';

// Database
export type { IDatabase, Migration } from './db/db-interface';
export { migrations } from './db/schema';
export { SongRepository } from './db/song-repository';
export { SetListRepository } from './db/setlist-repository';
export { FavoriteRepository } from './db/favorite-repository';
export { SettingsRepository } from './db/settings-repository';

// Stores
export { useSongStore } from './store/song-store';
export { usePlayerStore } from './store/player-store';
export { useSetListStore } from './store/setlist-store';
export { useSettingsStore } from './store/settings-store';

// Utils
export { exportToChordPro } from './utils/chordpro-exporter';
export { extractUniqueChords } from './utils/extract-chords';
export { chordsOverLyricsToChordPro, chordProToChordsOverLyrics, detectSongFormat } from './utils/chords-over-lyrics';
export { importFromString } from './utils/file-importer';
export { toLatin, fromLatin, formatChord, formatKey, normalizeContentToLetter } from './utils/chord-notation';

// Chord diagrams
export { getDiagram, getDiagramExact, getDiagramVariations, getDiagramByIndex, getAllChordNames, hasCustomVariations, getBuiltinDiagrams } from './chord-diagrams/diagram-lookup';
export { GUITAR_DIAGRAMS } from './chord-diagrams/guitar-diagrams';
export { UKULELE_DIAGRAMS } from './chord-diagrams/ukulele-diagrams';
export { GUITAR_SLASH_DIAGRAMS, UKULELE_SLASH_DIAGRAMS } from './chord-diagrams/slash-diagrams';
export { PIANO_DIAGRAMS, getAllPianoChordNames } from './chord-diagrams/piano-diagrams';

// Chord engine
export { CHORD_FORMULAS, getFormula, noteToSemitone, parseChordName } from './chord-engine/formulas';
export type { ChordFormula } from './chord-engine/formulas';
export { generateGuitarVoicings } from './chord-engine/voicing-generator';
export { getGuitarDiagrams, buildGuitarDiagramMap, preGenerateAllGuitarDiagrams, clearCache } from './chord-engine/index';
