import type { Song } from './song.types';

export interface SetList {
  id: string;
  name: string;
  description?: string;
  date?: number;
  createdAt: number;
  updatedAt: number;
  /** Drag-order position on the Set Lists page. Nullable because
   *  older rows created before v14/v15 may not have one yet — the
   *  UI falls back to `updatedAt` sort in that case. Included so
   *  the reorder the user does on the Set Lists page survives a
   *  backup round-trip. */
  position?: number;
}

export type SetListEntryType = 'song' | 'note';

export interface SetListEntry {
  id: string;
  setlistId: string;
  type: SetListEntryType;
  /** Song reference — required when type='song', undefined for notes. */
  songId?: string;
  /** Note heading shown in both the setlist and the performance view. */
  noteTitle?: string;
  /** Note body, shown below the title in the perform view. */
  noteBody?: string;
  position: number;
  transpose: number;
  capo: number;
  /** Target performance key for this entry. Overrides the song's display key. */
  key?: string;
  tempo?: number;
  timeSig?: string;
  notes?: string;
  /** Per-entry preferences. When undefined, the field falls back to the
   *  underlying song's preference / global setting — so existing
   *  entries keep working without a bulk migration. First time the
   *  user changes the setting while viewing / performing the entry,
   *  we start storing it here.
   *
   *  Scope: transpose, capo, view mode, auto-scroll mode, tempo
   *  multiplier ("time feel"), chord-bar visibility, and inline chord
   *  diagram visibility are the setlist-controllable settings. Chord
   *  voicings, style preset, font size, and other display prefs stay
   *  song / global scoped. */
  viewMode?: 'chords' | 'lyrics-only' | 'chords-only';
  autoScrollMode?: 'duration' | 'speed';
  /** Metronome tempo multiplier ("time feel") — 0.5 = half-time,
   *  1 = normal, 2 = double-time. Only these three values are valid. */
  tempoMultiplier?: 0.5 | 1 | 2;
  /** Whether the chord-diagram bar is visible for this entry.
   *  Overrides the app-wide `showChordDiagrams` setting. */
  chordBarVisible?: boolean;
  /** Whether inline chord diagrams are rendered above chords in the
   *  lyrics for this entry. Overrides `inlineChordDiagrams`. */
  inlineChordDiagrams?: boolean;
}

export interface SetListWithSongs extends SetList {
  /** For 'song' entries `song` is the attached snapshot; 'note' entries have no song. */
  entries: Array<SetListEntry & { song?: Song }>;
}

export type SetListCreateInput = Omit<SetList, 'id' | 'createdAt' | 'updatedAt'>;
