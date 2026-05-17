import type { Song } from '@song-chords/shared';

export type SongSortField = 'title' | 'artist' | 'genre' | 'key' | 'difficulty' | 'tempo' | 'duration' | 'year' | 'language' | 'chordsCount' | 'createdAt';
export type SortDir = 'asc' | 'desc';

const NUMERIC: Record<SongSortField, boolean> = {
  title: false, artist: false, genre: false, key: false, language: false, duration: false,
  difficulty: true, tempo: true, year: true, chordsCount: true, createdAt: true,
};

function durationToSeconds(d: string | undefined): number {
  if (!d) return -1;
  const parts = d.split(':').map((p) => parseInt(p, 10));
  if (parts.some((n) => Number.isNaN(n))) return -1;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return -1;
}

/** Stable, non-mutating sort used by both the list pages and perform pages. */
export function sortSongs<T extends Song>(songs: T[], field: SongSortField, dir: SortDir): T[] {
  const direction = dir === 'asc' ? 1 : -1;
  const numeric = NUMERIC[field];
  return [...songs].sort((a, b) => {
    if (numeric) {
      const av = (a[field] ?? 0) as number;
      const bv = (b[field] ?? 0) as number;
      return (av - bv) * direction;
    }
    if (field === 'duration') {
      const av = durationToSeconds(a.duration);
      const bv = durationToSeconds(b.duration);
      if (av < 0 && bv >= 0) return 1;
      if (av >= 0 && bv < 0) return -1;
      return (av - bv) * direction;
    }
    const av = ((a[field] ?? '') as string).toString();
    const bv = ((b[field] ?? '') as string).toString();
    return av.localeCompare(bv) * direction;
  });
}

export function parseSortFromSearch(search: URLSearchParams): { field: SongSortField; dir: SortDir } {
  const rawField = search.get('sort');
  const rawDir = search.get('dir');
  const field: SongSortField = (['title', 'artist', 'genre', 'key', 'difficulty', 'tempo', 'duration', 'year', 'language', 'chordsCount', 'createdAt'] as SongSortField[])
    .includes(rawField as SongSortField) ? (rawField as SongSortField) : 'title';
  const dir: SortDir = rawDir === 'desc' ? 'desc' : 'asc';
  return { field, dir };
}
