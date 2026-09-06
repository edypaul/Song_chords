import { parseChordPro } from '../parser/chordpro-parser';
import { extractUniqueChords } from './extract-chords';
import type { SongCreateInput, SongPreferences } from '../types/song.types';

export function importFromString(
  content: string,
  filename: string,
): SongCreateInput {
  // Always parse as ChordPro so `{title}`, `{subtitle}`, `{metronome}`,
  // `{duration}`, etc. directives are recognised regardless of file
  // extension. Plain lyric-only files still work because unknown lines just
  // pass through as lyric tokens.
  const parsed = parseChordPro(content);

  const title = parsed.metadata.title ?? filenameToTitle(filename);

  return {
    title,
    artist: parsed.metadata.artist,
    album: parsed.metadata.album,
    key: parsed.metadata.key,
    tempo: parsed.metadata.tempo,
    timeSig: parsed.metadata.timeSig,
    capo: parsed.metadata.capo ?? 0,
    genre: parsed.metadata.genre,
    year: parsed.metadata.year,
    language: parsed.metadata.language,
    duration: parsed.metadata.duration,
    notes: parsed.metadata.notes,
    difficulty: parsed.metadata.difficulty,
    link: parsed.metadata.link,
    content,
    chordsCount: extractUniqueChords(parsed).length,
    tags: parsed.metadata.tags ?? [],
    favorite: false,
    preferences: {},
    sortOrder: 0,
  };
}

function filenameToTitle(filename: string): string {
  const base = filename.split('/').pop()?.split('\\').pop() ?? filename;
  return base.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ');
}

// ─── JSON import ────────────────────────────────────────────────────────────
// Accepts the app's own JSON exports: a single Song record or an array of
// them (the multi-song "binder" export). Only whitelisted fields are kept —
// ids, timestamps, and machine-local fields (audioFile paths, lastViewedAt,
// sortOrder) never transfer between installations.

function asString(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() !== '' ? v : undefined;
}

function asNumber(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = parseInt(v, 10);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function songFromJsonRecord(rec: unknown, index: number): SongCreateInput {
  if (typeof rec !== 'object' || rec === null || Array.isArray(rec)) {
    throw new Error(`Record ${index + 1} is not a song object`);
  }
  const r = rec as Record<string, unknown>;
  const title = asString(r.title);
  const content = typeof r.content === 'string' ? r.content : undefined;
  if (!title || content === undefined) {
    throw new Error(`Record ${index + 1} is missing "title" or "content" — not a song export`);
  }
  const preferences: SongPreferences =
    typeof r.preferences === 'object' && r.preferences !== null && !Array.isArray(r.preferences)
      ? (r.preferences as SongPreferences)
      : {};
  const tags = Array.isArray(r.tags) ? r.tags.filter((t): t is string => typeof t === 'string') : [];
  return {
    title,
    artist: asString(r.artist),
    album: asString(r.album),
    key: asString(r.key),
    tempo: asNumber(r.tempo),
    timeSig: asString(r.timeSig),
    capo: asNumber(r.capo) ?? 0,
    genre: asString(r.genre),
    year: asNumber(r.year),
    language: asString(r.language),
    duration: asString(r.duration),
    notes: typeof r.notes === 'string' ? r.notes : undefined,
    content,
    chordsCount: extractUniqueChords(parseChordPro(content)).length,
    tags,
    difficulty: asNumber(r.difficulty),
    favorite: r.favorite === true,
    preferences,
    sortOrder: 0,
    link: asString(r.link),
    annotations: typeof r.annotations === 'string' ? r.annotations : undefined,
  };
}

/** Parse a JSON export (one Song record or an array of them) into create
 *  inputs. Throws with a human-readable message when the payload isn't a
 *  song export. */
export function importSongsFromJson(content: string): SongCreateInput[] {
  let data: unknown;
  try {
    data = JSON.parse(content);
  } catch {
    throw new Error('File is not valid JSON');
  }
  const records = Array.isArray(data) ? data : [data];
  if (records.length === 0) throw new Error('JSON file contains no songs');
  return records.map((rec, i) => songFromJsonRecord(rec, i));
}
