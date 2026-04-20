import type { AppSettings } from '../types/settings.types';
import { DEFAULT_SONG_VIEW_STYLE } from './song-view-presets';

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'system',
  fontSize: 16,
  defaultInstrument: 'guitar',
  preferFlats: false,
  accidentalMode: 'auto',
  scrollSpeed: 40,
  showChordDiagrams: true,
  autoScrollEnabled: false,
  defaultTranspose: 0,
  songViewStyle: { ...DEFAULT_SONG_VIEW_STYLE },
  customPresets: {},
  songCentered: false,
  chordBarPosition: 'top',
  inlineChordDiagrams: false,
  customChords: {},
  perfMetroEnabled: true,
  perfScrollEnabled: true,
  perfZoom: 1,
  songListColumns: {
    artist: true,
    genre: true,
    key: true,
    difficulty: true,
    tempo: true,
    year: true,
    language: true,
  },
};
