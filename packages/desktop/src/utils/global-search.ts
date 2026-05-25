import type { Song, SetList } from '@song-chords/shared';

/**
 * Global search over the whole library: songs (by title, artist, album,
 * genre, key, tags, language, year, and lyrics) and set lists (by name,
 * description). Plain substring matching, case- and accent-insensitive,
 * with light ranking so the most relevant hits float to the top.
 *
 * This is deliberately dependency-free (no Fuse.js): the library is held
 * fully in memory and a query runs against at most a few thousand songs,
 * so a single normalised pass per song is fast and predictable. The
 * matched FIELD is reported so the UI can show *why* a result matched
 * ("matched lyrics", "matched genre: Pop", …).
 */

export type SearchResultKind = 'song' | 'setlist';

/** Which field the query hit — drives the "why it matched" subtitle. */
export type MatchField =
  | 'title' | 'artist' | 'album' | 'genre' | 'key'
  | 'tag' | 'language' | 'year' | 'lyrics' | 'notes'
  | 'setlist-name' | 'setlist-description';

export interface SearchResult {
  kind: SearchResultKind;
  /** Route to navigate to when the result is chosen. */
  to: string;
  /** Primary line (song title / set-list name). */
  title: string;
  /** Secondary line (artist, or set-list date/description). */
  subtitle?: string;
  /** Field that matched + a short human snippet of the match. */
  matchField: MatchField;
  matchSnippet?: string;
  /** Higher = more relevant; used for ordering. */
  score: number;
  /** Stable key for React lists. */
  id: string;
}

/** Lowercase + strip diacritics so "Maná" matches "mana". */
function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

/** Remove inline ChordPro markers ([C], [Am7], {c: …}) so a lyrics search
 *  matches the words a singer reads, not the chord grammar. */
function toPlainLyrics(content: string): string {
  return content
    .replace(/\[[^\]]*\]/g, ' ')   // inline [chords]
    .replace(/\{[^}]*\}/g, ' ')    // {directives}
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Score a single field match. Earlier matches and whole-field / prefix
 * matches rank higher. Returns 0 for no match.
 *
 * `weight` lets important fields (title, artist) outrank incidental ones
 * (lyrics, notes) so a song whose TITLE contains the query beats one that
 * only mentions it deep in a verse.
 */
function fieldScore(haystack: string, needle: string, weight: number): number {
  const idx = haystack.indexOf(needle);
  if (idx === -1) return 0;
  let s = weight;
  if (idx === 0) s += 30;                          // prefix match
  if (haystack === needle) s += 40;                // exact whole-field
  s += Math.max(0, 20 - idx);                      // earlier = better
  return s;
}

/** Build a short snippet around the match for lyrics/notes hits. */
function snippet(original: string, normNeedle: string): string | undefined {
  const norm = normalize(original);
  const idx = norm.indexOf(normNeedle);
  if (idx === -1) return undefined;
  const start = Math.max(0, idx - 24);
  const end = Math.min(original.length, idx + normNeedle.length + 36);
  return (start > 0 ? '…' : '') + original.slice(start, end).trim() + (end < original.length ? '…' : '');
}

/**
 * Run a query against the full library. Returns ranked results, capped at
 * `limit`. An empty / whitespace query returns [].
 */
export function searchLibrary(
  query: string,
  songs: ReadonlyArray<Song>,
  setlists: ReadonlyArray<SetList>,
  limit = 30,
): SearchResult[] {
  const q = normalize(query.trim());
  if (!q) return [];

  const results: SearchResult[] = [];

  for (const song of songs) {
    // Each candidate field: [normalized value, MatchField, weight, raw value].
    const fields: Array<[string, MatchField, number, string]> = [];
    fields.push([normalize(song.title), 'title', 100, song.title]);
    if (song.artist)  fields.push([normalize(song.artist), 'artist', 80, song.artist]);
    if (song.album)   fields.push([normalize(song.album), 'album', 50, song.album]);
    if (song.genre)   fields.push([normalize(song.genre), 'genre', 45, song.genre]);
    if (song.key)     fields.push([normalize(song.key), 'key', 40, song.key]);
    if (song.language) fields.push([normalize(song.language), 'language', 30, song.language]);
    if (song.year != null) fields.push([String(song.year), 'year', 30, String(song.year)]);
    for (const tag of song.tags ?? []) fields.push([normalize(tag), 'tag', 55, tag]);
    if (song.notes)   fields.push([normalize(song.notes), 'notes', 25, song.notes]);
    // Lyrics last + lowest weight: a match here is real but least specific.
    const lyrics = toPlainLyrics(song.content);
    fields.push([normalize(lyrics), 'lyrics', 20, lyrics]);

    // Take the single best-scoring field for this song.
    let best: { score: number; field: MatchField; raw: string } | null = null;
    for (const [hay, field, weight, raw] of fields) {
      const s = fieldScore(hay, q, weight);
      if (s > 0 && (!best || s > best.score)) best = { score: s, field, raw };
    }
    if (!best) continue;

    const needsSnippet = best.field === 'lyrics' || best.field === 'notes';
    results.push({
      kind: 'song',
      id: `song:${song.id}`,
      to: `/song/${song.id}`,
      title: song.title,
      subtitle: song.artist || undefined,
      matchField: best.field,
      matchSnippet: needsSnippet ? snippet(best.raw, q)
        : best.field !== 'title' && best.field !== 'artist' ? best.raw
        : undefined,
      score: best.score,
    });
  }

  for (const sl of setlists) {
    const fields: Array<[string, MatchField, number, string]> = [
      [normalize(sl.name), 'setlist-name', 90, sl.name],
    ];
    if (sl.description) fields.push([normalize(sl.description), 'setlist-description', 35, sl.description]);
    let best: { score: number; field: MatchField; raw: string } | null = null;
    for (const [hay, field, weight, raw] of fields) {
      const s = fieldScore(hay, q, weight);
      if (s > 0 && (!best || s > best.score)) best = { score: s, field, raw };
    }
    if (!best) continue;
    results.push({
      kind: 'setlist',
      id: `setlist:${sl.id}`,
      to: `/setlists/${sl.id}`,
      title: sl.name,
      subtitle: sl.date ? new Date(sl.date).toLocaleDateString() : undefined,
      matchField: best.field,
      matchSnippet: best.field === 'setlist-description' ? snippet(best.raw, q) : undefined,
      score: best.score,
    });
  }

  results.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
  return results.slice(0, limit);
}

/** Human label for the matched field, shown as the result's "why". */
export function matchFieldLabel(field: MatchField): string {
  switch (field) {
    case 'title': return 'Title';
    case 'artist': return 'Artist';
    case 'album': return 'Album';
    case 'genre': return 'Genre';
    case 'key': return 'Key';
    case 'tag': return 'Tag';
    case 'language': return 'Language';
    case 'year': return 'Year';
    case 'lyrics': return 'Lyrics';
    case 'notes': return 'Notes';
    case 'setlist-name': return 'Set list';
    case 'setlist-description': return 'Set list';
  }
}
