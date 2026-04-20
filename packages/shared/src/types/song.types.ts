export interface SongPreferences {
  transposeSteps?: number;
  viewMode?: 'chords' | 'lyrics-only' | 'chords-only';
  /** Maps chord name → selected variation index (0-based) */
  chordVariations?: Record<string, number>;
}

export interface Song {
  id: string;
  title: string;
  artist?: string;
  album?: string;
  key?: string;
  tempo?: number;
  timeSig?: string;
  capo: number;
  genre?: string;
  year?: number;
  language?: string;
  duration?: string;
  notes?: string;
  content: string;
  /** Count of unique chord names in `content`. Computed at save time from
   *  the parsed ChordPro content (all songs are stored as ChordPro). */
  chordsCount: number;
  tags: string[];
  /** 1 = Basic, 2 = Easy, 3 = Intermediate, 4 = Advanced, 5 = Professional; 0/undefined = unset */
  difficulty?: number;
  favorite: boolean;
  preferences: SongPreferences;
  createdAt: number;
  updatedAt: number;
  sortOrder: number;
}

export type SongCreateInput = Omit<Song, 'id' | 'createdAt' | 'updatedAt'>;
export type SongUpdateInput = Partial<Omit<Song, 'id' | 'createdAt'>>;

export interface SongMetadata {
  title?: string;
  artist?: string;
  album?: string;
  key?: string;
  tempo?: number;
  timeSig?: string;
  capo?: number;
  duration?: string;
  copyright?: string;
  ccli?: string;
}
