import { v4 as uuidv4 } from 'uuid';
import type { IDatabase } from './db-interface';
import type { SetList, SetListEntry, SetListCreateInput } from '../types/setlist.types';

interface SetListRow {
  id: string;
  name: string;
  description: string | null;
  date: number | null;
  created_at: number;
  updated_at: number;
}

interface SetListEntryRow {
  id: string;
  setlist_id: string;
  song_id: string;
  position: number;
  transpose: number;
  capo: number;
  key: string | null;
  tempo: number | null;
  time_sig: string | null;
  notes: string | null;
}

export interface SetListEntrySnapshot {
  transpose?: number;
  capo?: number;
  key?: string;
  tempo?: number;
  timeSig?: string;
}

function rowToSetList(row: SetListRow): SetList {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? undefined,
    date: row.date ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToEntry(row: SetListEntryRow): SetListEntry {
  return {
    id: row.id,
    setlistId: row.setlist_id,
    songId: row.song_id,
    position: row.position,
    transpose: row.transpose,
    capo: row.capo,
    key: row.key ?? undefined,
    tempo: row.tempo ?? undefined,
    timeSig: row.time_sig ?? undefined,
    notes: row.notes ?? undefined,
  };
}

export class SetListRepository {
  constructor(private db: IDatabase) {}

  async getAll(): Promise<SetList[]> {
    const rows = await this.db.query<SetListRow>('SELECT * FROM setlists ORDER BY updated_at DESC');
    return rows.map(rowToSetList);
  }

  async getById(id: string): Promise<SetList | null> {
    const row = await this.db.queryOne<SetListRow>('SELECT * FROM setlists WHERE id=?', [id]);
    return row ? rowToSetList(row) : null;
  }

  async create(input: SetListCreateInput): Promise<SetList> {
    const now = Date.now();
    const id = uuidv4();
    await this.db.execute(
      'INSERT INTO setlists (id, name, description, date, created_at, updated_at) VALUES (?,?,?,?,?,?)',
      [id, input.name, input.description ?? null, input.date ?? null, now, now],
    );
    return { ...input, id, createdAt: now, updatedAt: now };
  }

  async update(id: string, patch: Partial<Pick<SetList, 'name' | 'description' | 'date'>>): Promise<void> {
    const now = Date.now();
    await this.db.execute(
      'UPDATE setlists SET name=COALESCE(?,name), description=COALESCE(?,description), date=COALESCE(?,date), updated_at=? WHERE id=?',
      [patch.name ?? null, patch.description ?? null, patch.date ?? null, now, id],
    );
  }

  async delete(id: string): Promise<void> {
    await this.db.execute('DELETE FROM setlists WHERE id=?', [id]);
  }

  /**
   * All (entryId, setlistId) rows where this song appears — used by the
   * add-to-playlist modal to show a toggleable checkmark for each setlist.
   */
  async getEntriesBySong(songId: string): Promise<Array<{ entryId: string; setlistId: string }>> {
    const rows = await this.db.query<{ id: string; setlist_id: string }>(
      'SELECT id, setlist_id FROM setlist_entries WHERE song_id=?',
      [songId],
    );
    return rows.map((r) => ({ entryId: r.id, setlistId: r.setlist_id }));
  }

  /** Song count per setlist — powers the dashboard set-lists card. */
  async getEntryCounts(): Promise<Record<string, number>> {
    const rows = await this.db.query<{ setlist_id: string; count: number }>(
      'SELECT setlist_id, COUNT(*) as count FROM setlist_entries GROUP BY setlist_id',
    );
    const map: Record<string, number> = {};
    for (const r of rows) map[r.setlist_id] = r.count;
    return map;
  }

  async getEntries(setlistId: string): Promise<SetListEntry[]> {
    const rows = await this.db.query<SetListEntryRow>(
      'SELECT * FROM setlist_entries WHERE setlist_id=? ORDER BY position ASC',
      [setlistId],
    );
    return rows.map(rowToEntry);
  }

  async addEntry(
    setlistId: string,
    songId: string,
    snapshot?: SetListEntrySnapshot,
    position?: number,
  ): Promise<SetListEntry> {
    const id = uuidv4();
    let pos = position;
    if (pos === undefined) {
      const result = await this.db.queryOne<{ max_pos: number | null }>(
        'SELECT MAX(position) as max_pos FROM setlist_entries WHERE setlist_id=?',
        [setlistId],
      );
      pos = (result?.max_pos ?? -1) + 1;
    }
    const transpose = snapshot?.transpose ?? 0;
    const capo = snapshot?.capo ?? 0;
    const key = snapshot?.key ?? null;
    const tempo = snapshot?.tempo ?? null;
    const timeSig = snapshot?.timeSig ?? null;
    await this.db.execute(
      'INSERT INTO setlist_entries (id, setlist_id, song_id, position, transpose, capo, key, tempo, time_sig) VALUES (?,?,?,?,?,?,?,?,?)',
      [id, setlistId, songId, pos, transpose, capo, key, tempo, timeSig],
    );
    return {
      id, setlistId, songId, position: pos, transpose, capo,
      key: key ?? undefined,
      tempo: tempo ?? undefined,
      timeSig: timeSig ?? undefined,
    };
  }

  async removeEntry(entryId: string): Promise<void> {
    await this.db.execute('DELETE FROM setlist_entries WHERE id=?', [entryId]);
  }

  async updateEntryPosition(entryId: string, position: number): Promise<void> {
    await this.db.execute('UPDATE setlist_entries SET position=? WHERE id=?', [position, entryId]);
  }

  async updateEntrySettings(
    entryId: string,
    settings: Partial<Pick<SetListEntry, 'transpose' | 'capo' | 'key' | 'tempo' | 'timeSig' | 'notes'>>,
  ): Promise<void> {
    if (settings.transpose !== undefined) {
      await this.db.execute('UPDATE setlist_entries SET transpose=? WHERE id=?', [settings.transpose, entryId]);
    }
    if (settings.capo !== undefined) {
      await this.db.execute('UPDATE setlist_entries SET capo=? WHERE id=?', [settings.capo, entryId]);
    }
    if (settings.key !== undefined) {
      await this.db.execute('UPDATE setlist_entries SET key=? WHERE id=?', [settings.key || null, entryId]);
    }
    if (settings.tempo !== undefined) {
      await this.db.execute('UPDATE setlist_entries SET tempo=? WHERE id=?', [settings.tempo ?? null, entryId]);
    }
    if (settings.timeSig !== undefined) {
      await this.db.execute('UPDATE setlist_entries SET time_sig=? WHERE id=?', [settings.timeSig || null, entryId]);
    }
    if (settings.notes !== undefined) {
      await this.db.execute('UPDATE setlist_entries SET notes=? WHERE id=?', [settings.notes, entryId]);
    }
  }

  async reorderEntries(setlistId: string, orderedEntryIds: string[]): Promise<void> {
    for (let i = 0; i < orderedEntryIds.length; i++) {
      await this.db.execute(
        'UPDATE setlist_entries SET position=? WHERE id=? AND setlist_id=?',
        [i, orderedEntryIds[i], setlistId],
      );
    }
  }
}
