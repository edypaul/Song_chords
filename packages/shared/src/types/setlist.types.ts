import type { Song } from './song.types';

export interface SetList {
  id: string;
  name: string;
  description?: string;
  date?: number;
  createdAt: number;
  updatedAt: number;
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
}

export interface SetListWithSongs extends SetList {
  /** For 'song' entries `song` is the attached snapshot; 'note' entries have no song. */
  entries: Array<SetListEntry & { song?: Song }>;
}

export type SetListCreateInput = Omit<SetList, 'id' | 'createdAt' | 'updatedAt'>;
