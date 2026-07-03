import type { SongListColumn } from '@song-chords/shared';

/** Human labels for every song-list column key. Single source of truth
 *  reused by the header cells, the columns editor, and the Settings page,
 *  so relabelling a column (e.g. "Added" → "Created") only changes one
 *  spot. */
export const COLUMN_LABEL: Record<SongListColumn, string> = {
  artist: 'Artist',
  genre: 'Genre',
  key: 'Key',
  difficulty: 'Difficulty',
  tempo: 'Tempo',
  duration: 'Duration',
  year: 'Year',
  language: 'Language',
  chordsCount: 'Chords',
  createdAt: 'Added',
};
