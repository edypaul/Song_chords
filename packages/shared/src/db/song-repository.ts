import { v4 as uuidv4 } from 'uuid';
import type { IDatabase } from './db-interface';
import type { Song, SongCreateInput, SongUpdateInput, SongPreferences } from '../types/song.types';
import { parseChordPro } from '../parser/chordpro-parser';
import { extractUniqueChords } from '../utils/extract-chords';
import { chordsOverLyricsToChordPro } from '../utils/chords-over-lyrics';

function countChords(content: string): number {
  try { return extractUniqueChords(parseChordPro(content)).length; }
  catch { return 0; }
}

interface SongRow {
  id: string;
  title: string;
  artist: string | null;
  album: string | null;
  key: string | null;
  tempo: number | null;
  time_sig: string | null;
  capo: number;
  genre: string | null;
  year: number | null;
  language: string | null;
  duration: string | null;
  notes: string | null;
  content: string;
  content_format: string;
  tags: string;
  difficulty: number | null;
  favorite: number;
  created_at: number;
  updated_at: number;
  sort_order: number;
  preferences: string;
  last_viewed_at: number | null;
  link: string | null;
  audio_file: string | null;
}

function rowToSong(row: SongRow): Song {
  // Legacy rows stored as "chords above lyrics" are transparently converted
  // to ChordPro at read time so the rest of the app can assume one format.
  const content = row.content_format === 'plaintext'
    ? chordsOverLyricsToChordPro(row.content)
    : row.content;
  return {
    id: row.id,
    title: row.title,
    artist: row.artist ?? undefined,
    album: row.album ?? undefined,
    key: row.key ?? undefined,
    tempo: row.tempo ?? undefined,
    timeSig: row.time_sig ?? undefined,
    capo: row.capo,
    genre: row.genre ?? undefined,
    year: row.year ?? undefined,
    language: row.language ?? undefined,
    duration: row.duration ?? undefined,
    notes: row.notes ?? undefined,
    content,
    chordsCount: countChords(content),
    tags: JSON.parse(row.tags || '[]') as string[],
    difficulty: row.difficulty ?? undefined,
    favorite: row.favorite === 1,
    preferences: JSON.parse(row.preferences || '{}') as SongPreferences,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    sortOrder: row.sort_order,
    lastViewedAt: row.last_viewed_at ?? undefined,
    link: row.link ?? undefined,
    audioFile: row.audio_file ?? undefined,
  };
}

export class SongRepository {
  constructor(private db: IDatabase) {}

  async getAll(): Promise<Song[]> {
    const rows = await this.db.query<SongRow>(
      'SELECT * FROM songs ORDER BY sort_order ASC, title ASC',
    );
    return rows.map(rowToSong);
  }

  async getById(id: string): Promise<Song | null> {
    const row = await this.db.queryOne<SongRow>('SELECT * FROM songs WHERE id = ?', [id]);
    return row ? rowToSong(row) : null;
  }

  async search(query: string): Promise<Song[]> {
    const like = `%${query}%`;
    const rows = await this.db.query<SongRow>(
      'SELECT * FROM songs WHERE title LIKE ? OR artist LIKE ? ORDER BY title ASC',
      [like, like],
    );
    return rows.map(rowToSong);
  }

  async create(input: SongCreateInput): Promise<Song> {
    const now = Date.now();
    const id = uuidv4();
    const song: Song = {
      ...input,
      id,
      chordsCount: countChords(input.content),
      createdAt: now,
      updatedAt: now,
    };

    await this.db.execute(
      `INSERT INTO songs (id, title, artist, album, key, tempo, time_sig, capo, genre, year, language, duration,
        notes, content, content_format, tags, difficulty, favorite, preferences, created_at, updated_at, sort_order, link, audio_file)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        song.id, song.title, song.artist ?? null, song.album ?? null, song.key ?? null,
        song.tempo ?? null, song.timeSig ?? null, song.capo,
        song.genre ?? null, song.year ?? null, song.language ?? null,
        song.duration ?? null, song.notes ?? null,
        song.content, 'chordpro', JSON.stringify(song.tags),
        song.difficulty ?? null,
        song.favorite ? 1 : 0,
        JSON.stringify(song.preferences ?? {}),
        song.createdAt, song.updatedAt, song.sortOrder,
        song.link ?? null,
        song.audioFile ?? null,
      ],
    );

    return song;
  }

  async update(id: string, input: SongUpdateInput): Promise<Song | null> {
    const existing = await this.getById(id);
    if (!existing) return null;

    const merged: Song = {
      ...existing,
      ...input,
      id,
      updatedAt: Date.now(),
    };
    const updated: Song = { ...merged, chordsCount: countChords(merged.content) };

    await this.db.execute(
      `UPDATE songs SET title=?, artist=?, album=?, key=?, tempo=?, time_sig=?, capo=?,
        genre=?, year=?, language=?, duration=?, notes=?, content=?, content_format=?, tags=?, difficulty=?, favorite=?, preferences=?,
        updated_at=?, sort_order=?, link=?, audio_file=?
       WHERE id=?`,
      [
        updated.title, updated.artist ?? null, updated.album ?? null, updated.key ?? null,
        updated.tempo ?? null, updated.timeSig ?? null, updated.capo,
        updated.genre ?? null, updated.year ?? null, updated.language ?? null,
        updated.duration ?? null, updated.notes ?? null,
        updated.content, 'chordpro', JSON.stringify(updated.tags),
        updated.difficulty ?? null,
        updated.favorite ? 1 : 0,
        JSON.stringify(updated.preferences ?? {}),
        updated.updatedAt, updated.sortOrder,
        updated.link ?? null,
        updated.audioFile ?? null,
        id,
      ],
    );

    return updated;
  }

  async savePreferences(id: string, prefs: SongPreferences): Promise<void> {
    await this.db.execute(
      'UPDATE songs SET preferences=? WHERE id=?',
      [JSON.stringify(prefs), id],
    );
  }

  async setFavorite(id: string, favorite: boolean): Promise<void> {
    await this.db.execute(
      'UPDATE songs SET favorite=?, updated_at=? WHERE id=?',
      [favorite ? 1 : 0, Date.now(), id],
    );
  }

  async delete(id: string): Promise<void> {
    await this.db.execute('DELETE FROM songs WHERE id=?', [id]);
  }

  /** Stamp the song as viewed right now. Does not touch updated_at so
   * "recently edited" and "recently viewed" remain independent signals. */
  async markViewed(id: string): Promise<void> {
    await this.db.execute(
      'UPDATE songs SET last_viewed_at=? WHERE id=?',
      [Date.now(), id],
    );
  }

  async getByKey(key: string): Promise<Song[]> {
    const rows = await this.db.query<SongRow>('SELECT * FROM songs WHERE key=? ORDER BY title ASC', [key]);
    return rows.map(rowToSong);
  }

  async getByTag(tag: string): Promise<Song[]> {
    const rows = await this.db.query<SongRow>(
      "SELECT * FROM songs WHERE tags LIKE ? ORDER BY title ASC",
      [`%${tag}%`],
    );
    return rows.map(rowToSong);
  }
}
