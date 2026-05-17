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
  song_id: string | null;
  type: string | null;
  note_title: string | null;
  note_body: string | null;
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

function parseDurationSeconds(d: string | null): number {
  if (!d) return 0;
  const parts = d.split(':').map((p) => parseInt(p, 10));
  if (parts.some((n) => Number.isNaN(n))) return 0;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return 0;
}

function rowToEntry(row: SetListEntryRow): SetListEntry {
  return {
    id: row.id,
    setlistId: row.setlist_id,
    type: (row.type as SetListEntry['type']) ?? 'song',
    songId: row.song_id ?? undefined,
    noteTitle: row.note_title ?? undefined,
    noteBody: row.note_body ?? undefined,
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
    // Order by the user-controlled `position` column (set via drag &
    // drop on the Set Lists page). Ties break by updated_at DESC so
    // newly-touched lists still surface above older same-position rows
    // — useful for fresh databases where every row starts at position 0.
    const rows = await this.db.query<SetListRow>('SELECT * FROM setlists ORDER BY position ASC, updated_at DESC');
    return rows.map(rowToSetList);
  }

  async getById(id: string): Promise<SetList | null> {
    const row = await this.db.queryOne<SetListRow>('SELECT * FROM setlists WHERE id=?', [id]);
    return row ? rowToSetList(row) : null;
  }

  async create(input: SetListCreateInput): Promise<SetList> {
    const now = Date.now();
    const id = uuidv4();
    // New setlists land at the END of the user-controlled order — the
    // top of the list is reserved for the user's own arrangement.
    // We could also put new lists at the top; ending the list is
    // safer (existing drag order isn't disrupted by a sudden
    // shuffle), and the user can drag the new card up if they want.
    const maxRow = await this.db.queryOne<{ max_pos: number | null }>(
      'SELECT MAX(position) as max_pos FROM setlists',
    );
    const nextPosition = (maxRow?.max_pos ?? -1) + 1;
    await this.db.execute(
      'INSERT INTO setlists (id, name, description, date, position, created_at, updated_at) VALUES (?,?,?,?,?,?,?)',
      [id, input.name, input.description ?? null, input.date ?? null, nextPosition, now, now],
    );
    return { ...input, id, createdAt: now, updatedAt: now };
  }

  /**
   * Rewrite every setlist's `position` according to the given id order
   * (index 0 = top). Used by the Set Lists page's drag-to-reorder UI.
   * Sequential UPDATEs — mirrors `reorderEntries` below. `IDatabase`
   * has no transaction primitive; a partial failure here would just
   * leave some positions stale until the next reorder, which the
   * store's optimistic update + DB-backed reload reconciles anyway.
   */
  async reorder(orderedIds: string[]): Promise<void> {
    for (let i = 0; i < orderedIds.length; i++) {
      await this.db.execute('UPDATE setlists SET position=? WHERE id=?', [i, orderedIds[i]]);
    }
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

  /** Songs vs notes breakdown per setlist — used on the Set Lists page. */
  async getEntryCountsByType(): Promise<Record<string, { songs: number; notes: number }>> {
    const rows = await this.db.query<{ setlist_id: string; type: string | null; count: number }>(
      "SELECT setlist_id, type, COUNT(*) as count FROM setlist_entries GROUP BY setlist_id, type",
    );
    const map: Record<string, { songs: number; notes: number }> = {};
    for (const r of rows) {
      const bucket = map[r.setlist_id] ?? (map[r.setlist_id] = { songs: 0, notes: 0 });
      if (r.type === 'note') bucket.notes += r.count;
      else bucket.songs += r.count; // legacy rows with null `type` count as songs
    }
    return map;
  }

  /** Total duration (in seconds) per setlist, summing song entries whose
   * underlying song has a `mm:ss` (or `hh:mm:ss`) duration. Notes and songs
   * without a duration contribute zero. Used by the Set Lists page to show an
   * approximate total runtime per card. */
  async getSetlistDurations(): Promise<Record<string, number>> {
    const rows = await this.db.query<{ setlist_id: string; duration: string | null }>(
      "SELECT se.setlist_id, s.duration " +
      "FROM setlist_entries se " +
      "JOIN songs s ON s.id = se.song_id " +
      "WHERE (se.type IS NULL OR se.type = 'song')",
    );
    const map: Record<string, number> = {};
    for (const r of rows) {
      const secs = parseDurationSeconds(r.duration);
      if (secs > 0) map[r.setlist_id] = (map[r.setlist_id] ?? 0) + secs;
    }
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
      'INSERT INTO setlist_entries (id, setlist_id, song_id, type, position, transpose, capo, key, tempo, time_sig) VALUES (?,?,?,?,?,?,?,?,?,?)',
      [id, setlistId, songId, 'song', pos, transpose, capo, key, tempo, timeSig],
    );
    return {
      id, setlistId, type: 'song', songId, position: pos, transpose, capo,
      key: key ?? undefined,
      tempo: tempo ?? undefined,
      timeSig: timeSig ?? undefined,
    };
  }

  async addNoteEntry(
    setlistId: string,
    title: string,
    body: string,
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
    await this.db.execute(
      'INSERT INTO setlist_entries (id, setlist_id, song_id, type, note_title, note_body, position, transpose, capo) VALUES (?,?,?,?,?,?,?,0,0)',
      [id, setlistId, null, 'note', title, body, pos],
    );
    return {
      id, setlistId, type: 'note', noteTitle: title, noteBody: body,
      position: pos, transpose: 0, capo: 0,
    };
  }

  async updateNoteEntry(entryId: string, title: string, body: string): Promise<void> {
    await this.db.execute(
      'UPDATE setlist_entries SET note_title=?, note_body=? WHERE id=?',
      [title, body, entryId],
    );
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
