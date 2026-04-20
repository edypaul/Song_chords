import type { Song } from './song.types';

export interface SetList {
  id: string;
  name: string;
  description?: string;
  date?: number;
  createdAt: number;
  updatedAt: number;
}

export interface SetListEntry {
  id: string;
  setlistId: string;
  songId: string;
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
  entries: Array<SetListEntry & { song: Song }>;
}

export type SetListCreateInput = Omit<SetList, 'id' | 'createdAt' | 'updatedAt'>;
