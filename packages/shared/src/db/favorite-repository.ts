import type { IDatabase } from './db-interface';
import type { FavoriteEntry } from '../types/favorite.types';

interface FavoriteEntryRow {
  song_id: string;
  transpose: number;
  capo: number;
  key: string | null;
  tempo: number | null;
  time_sig: string | null;
  added_at: number;
}

function rowToEntry(row: FavoriteEntryRow): FavoriteEntry {
  return {
    songId: row.song_id,
    transpose: row.transpose,
    capo: row.capo,
    key: row.key ?? undefined,
    tempo: row.tempo ?? undefined,
    timeSig: row.time_sig ?? undefined,
    addedAt: row.added_at,
  };
}

export interface FavoriteSnapshot {
  transpose?: number;
  capo?: number;
  key?: string;
  tempo?: number;
  timeSig?: string;
}

export class FavoriteRepository {
  constructor(private db: IDatabase) {}

  async getAll(): Promise<FavoriteEntry[]> {
    const rows = await this.db.query<FavoriteEntryRow>('SELECT * FROM favorite_entries');
    return rows.map(rowToEntry);
  }

  async getBySongId(songId: string): Promise<FavoriteEntry | null> {
    const row = await this.db.queryOne<FavoriteEntryRow>(
      'SELECT * FROM favorite_entries WHERE song_id=?', [songId],
    );
    return row ? rowToEntry(row) : null;
  }

  async add(songId: string, snapshot?: FavoriteSnapshot): Promise<FavoriteEntry> {
    const now = Date.now();
    const entry: FavoriteEntry = {
      songId,
      transpose: snapshot?.transpose ?? 0,
      capo: snapshot?.capo ?? 0,
      key: snapshot?.key,
      tempo: snapshot?.tempo,
      timeSig: snapshot?.timeSig,
      addedAt: now,
    };
    await this.db.execute(
      `INSERT OR REPLACE INTO favorite_entries
         (song_id, transpose, capo, key, tempo, time_sig, added_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        entry.songId, entry.transpose, entry.capo,
        entry.key ?? null, entry.tempo ?? null, entry.timeSig ?? null,
        entry.addedAt,
      ],
    );
    return entry;
  }

  async remove(songId: string): Promise<void> {
    await this.db.execute('DELETE FROM favorite_entries WHERE song_id=?', [songId]);
  }

  async update(
    songId: string,
    overrides: Partial<Pick<FavoriteEntry, 'transpose' | 'capo' | 'key' | 'tempo' | 'timeSig'>>,
  ): Promise<void> {
    if (overrides.transpose !== undefined) {
      await this.db.execute('UPDATE favorite_entries SET transpose=? WHERE song_id=?', [overrides.transpose, songId]);
    }
    if (overrides.capo !== undefined) {
      await this.db.execute('UPDATE favorite_entries SET capo=? WHERE song_id=?', [overrides.capo, songId]);
    }
    if (overrides.key !== undefined) {
      await this.db.execute('UPDATE favorite_entries SET key=? WHERE song_id=?', [overrides.key || null, songId]);
    }
    if (overrides.tempo !== undefined) {
      await this.db.execute('UPDATE favorite_entries SET tempo=? WHERE song_id=?', [overrides.tempo ?? null, songId]);
    }
    if (overrides.timeSig !== undefined) {
      await this.db.execute('UPDATE favorite_entries SET time_sig=? WHERE song_id=?', [overrides.timeSig || null, songId]);
    }
  }
}
