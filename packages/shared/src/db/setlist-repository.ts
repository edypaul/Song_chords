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
  view_mode: string | null;
  auto_scroll_mode: string | null;
  /** Legacy JSON column from v16. Kept for backwards compat with
   *  databases that already ran that migration; not populated by
   *  current code. */
  chord_variations: string | null;
  tempo_multiplier: number | null;
  chord_bar_visible: number | null;
  inline_chord_diagrams: number | null;
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
  const viewMode = row.view_mode as SetListEntry['viewMode'];
  const autoScrollMode = row.auto_scroll_mode as SetListEntry['autoScrollMode'];
  // tempo_multiplier is stored as REAL; guard against unexpected
  // values so a corrupted row can't crash the player when the
  // metronome multiplies by it.
  let tempoMultiplier: SetListEntry['tempoMultiplier'];
  if (row.tempo_multiplier === 0.5 || row.tempo_multiplier === 1 || row.tempo_multiplier === 2) {
    tempoMultiplier = row.tempo_multiplier;
  }
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
    viewMode: viewMode ?? undefined,
    autoScrollMode: autoScrollMode ?? undefined,
    tempoMultiplier,
    // Nullable booleans: NULL means "inherit the app-wide setting", so
    // leave the field undefined. `0` and `1` are explicit overrides.
    chordBarVisible: row.chord_bar_visible === null ? undefined : row.chord_bar_visible === 1,
    inlineChordDiagrams: row.inline_chord_diagrams === null ? undefined : row.inline_chord_diagrams === 1,
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

  /** Songs vs notes breakdown per setlist — used on the Set Lists page.
   *
   * SONG rows only count when the referenced song still exists. The
   * detail view (`openSetList`) silently drops entries whose `song_id`
   * no longer resolves (e.g. the underlying song was deleted), so if
   * we counted every row here we'd show more songs on the SetListsPage
   * card than the detail page ever renders. Left-joining `songs` and
   * ignoring rows where the join fails matches the detail view's
   * reality exactly.
   *
   * NOTE rows have no `song_id` reference to check, so they count
   * unconditionally. */
  async getEntryCountsByType(): Promise<Record<string, { songs: number; notes: number }>> {
    const rows = await this.db.query<{ setlist_id: string; songs: number; notes: number }>(
      "SELECT se.setlist_id, " +
      "  SUM(CASE WHEN (se.type IS NULL OR se.type = 'song') AND s.id IS NOT NULL THEN 1 ELSE 0 END) AS songs, " +
      "  SUM(CASE WHEN se.type = 'note' THEN 1 ELSE 0 END) AS notes " +
      "FROM setlist_entries se " +
      "LEFT JOIN songs s ON s.id = se.song_id " +
      "GROUP BY se.setlist_id",
    );
    const map: Record<string, { songs: number; notes: number }> = {};
    for (const r of rows) {
      // COUNT / SUM come back as JS numbers under the current adapter,
      // but coerce defensively — a string like "8" would otherwise
      // concatenate later if we ever chained additions.
      map[r.setlist_id] = { songs: Number(r.songs) || 0, notes: Number(r.notes) || 0 };
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
    settings: Partial<Pick<SetListEntry, 'transpose' | 'capo' | 'key' | 'tempo' | 'timeSig' | 'notes' | 'viewMode' | 'autoScrollMode' | 'tempoMultiplier' | 'chordBarVisible' | 'inlineChordDiagrams'>>,
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
    if (settings.viewMode !== undefined) {
      await this.db.execute('UPDATE setlist_entries SET view_mode=? WHERE id=?', [settings.viewMode ?? null, entryId]);
    }
    if (settings.autoScrollMode !== undefined) {
      await this.db.execute('UPDATE setlist_entries SET auto_scroll_mode=? WHERE id=?', [settings.autoScrollMode ?? null, entryId]);
    }
    if (settings.tempoMultiplier !== undefined) {
      await this.db.execute('UPDATE setlist_entries SET tempo_multiplier=? WHERE id=?', [settings.tempoMultiplier ?? null, entryId]);
    }
    if (settings.chordBarVisible !== undefined) {
      // Booleans encoded as 0/1. Explicit undefined leaves the column
      // alone; explicit null (or `undefined` reached via `?? null`) would
      // mean "clear the override", which we don't currently expose in
      // the UI, so we always write 0 / 1 when the setting is present.
      await this.db.execute('UPDATE setlist_entries SET chord_bar_visible=? WHERE id=?', [settings.chordBarVisible ? 1 : 0, entryId]);
    }
    if (settings.inlineChordDiagrams !== undefined) {
      await this.db.execute('UPDATE setlist_entries SET inline_chord_diagrams=? WHERE id=?', [settings.inlineChordDiagrams ? 1 : 0, entryId]);
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
