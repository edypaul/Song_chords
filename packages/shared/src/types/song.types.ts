export interface SongPreferences {
  transposeSteps?: number;
  viewMode?: 'chords' | 'lyrics-only' | 'chords-only';
  /** Maps chord name → selected variation index (0-based) */
  chordVariations?: Record<string, number>;
  /** Auto-scroll pacing mode for this song:
   *  - 'duration': cover the song in exactly its `duration` (needs a valid
   *     duration; falls back to speed when none is set).
   *  - 'speed': pace by the manual speed slider (`autoScrollSpeed`).
   *  When unset, defaults to 'duration' if the song has a duration, else
   *  'speed'. The user can switch modes at any time. */
  autoScrollMode?: 'duration' | 'speed';
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
  /** Freehand + shape annotations the user drew on top of this song's
   *  rendered chart. Stored as a JSON-encoded `SongAnnotations` in the
   *  `annotations` DB column so migrating the field's shape doesn't
   *  need another schema change. Shared across every place the song is
   *  displayed (song view, perform mode, setlists it appears in).
   *  See `annotation.types.ts` for the runtime shape. */
  annotations?: string;
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
  // ── Extended metadata carried via {year:}/{genre:}/{language:} and
  // {meta: <name> <value>} directives so a ChordPro export can round-trip
  // the full song record between installations of this app.
  year?: number;
  genre?: string;
  language?: string;
  /** 1-5, same scale as Song.difficulty. */
  difficulty?: number;
  tags?: string[];
  /** Multi-line — accumulated from one {meta: notes <line>} per line. */
  notes?: string;
  /** Streaming/audio URL (Song.link). */
  link?: string;
}
