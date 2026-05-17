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
  /** Epoch ms of when the song was last opened in the Song View page.
   *  Undefined for songs never viewed since migration v11. */
  lastViewedAt?: number;
  /** Optional URL to a streaming source for the song's audio
   *  (YouTube, Spotify, SoundCloud, a direct mp3, etc.). Surfaced as
   *  a play icon on every song-list and the song view toolbar — when
   *  clicked it opens a draggable floating player anchored over the
   *  current view. */
  link?: string;
  /** Optional absolute path to a local audio file (mp3, m4a, ogg, wav,
   *  flac, aac, webm). Played by the floating audio panel via a
   *  registered `song-audio://` protocol that streams the file from
   *  disk. Takes precedence over `link` when both are set. */
  audioFile?: string;
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
