import React, { useEffect, useState } from 'react';
import { X, Plus, ListMusic, Check } from 'lucide-react';
import { useSetListStore, SetListRepository } from '@song-chords/shared';
import type { Song } from '@song-chords/shared';
import { db } from '../../ipc/ipc-client';
import { toTitleCase } from '../../utils/text';

interface Props {
  song: Song;
  onClose: () => void;
}

export default function AddToPlaylistModal({ song, onClose }: Props): React.ReactElement {
  const setlists = useSetListStore((s) => s.setlists);
  const createSetList = useSetListStore((s) => s.createSetList);
  const addSongToSetList = useSetListStore((s) => s.addSongToSetList);
  const removeSongFromSetList = useSetListStore((s) => s.removeSongFromSetList);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  // Map of setlistId → entryId for setlists the song is already in. Toggling
  // a row flips membership: removes the entry if present, adds it otherwise.
  const [entries, setEntries] = useState<Record<string, string>>({});
  const [pending, setPending] = useState<string | null>(null);

  useEffect(() => {
    // Capture phase + stopImmediatePropagation so page-level Escape handlers
    // don't also fire (otherwise closing the modal also navigates back).
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopImmediatePropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKey, { capture: true });
    return () => window.removeEventListener('keydown', handleKey, { capture: true });
  }, [onClose]);

  const refetch = async () => {
    const repo = new SetListRepository(db);
    const rows = await repo.getEntriesBySong(song.id);
    const map: Record<string, string> = {};
    for (const r of rows) map[r.setlistId] = r.entryId;
    setEntries(map);
  };

  useEffect(() => {
    void refetch();
  }, [song.id]);

  const handleToggle = async (setlistId: string) => {
    if (pending) return;
    setPending(setlistId);
    try {
      const existingEntryId = entries[setlistId];
      if (existingEntryId) {
        await removeSongFromSetList(db, existingEntryId);
      } else {
        await addSongToSetList(db, setlistId, song.id);
      }
      await refetch();
    } finally {
      setPending(null);
    }
  };

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name) return;
    const created = await createSetList(db, { name });
    await addSongToSetList(db, created.id, song.id);
    await refetch();
    setNewName('');
    setCreating(false);
  };

  return (
    <div
      className="fixed inset-0 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.5)', zIndex: 300 }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-xl flex flex-col"
        style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', maxHeight: '80vh' }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="flex items-start gap-3 p-5 pb-3">
          <div className="flex-1 min-w-0">
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Add to set list</p>
            <h3 className="font-semibold text-base truncate" style={{ color: 'var(--text-primary)' }}>{toTitleCase(song.title)}</h3>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-[var(--surface-elevated)]">
            <X size={16} style={{ color: 'var(--text-muted)' }} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 pb-3 flex flex-col gap-1">
          {setlists.length === 0 && !creating && (
            <p className="text-sm py-4 text-center" style={{ color: 'var(--text-muted)' }}>No set lists yet.</p>
          )}
          {setlists.map((sl) => {
            const added = !!entries[sl.id];
            const busy = pending === sl.id;
            return (
              <button
                key={sl.id}
                onClick={() => void handleToggle(sl.id)}
                disabled={busy}
                className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-left hover:bg-[var(--surface-elevated)] transition-colors disabled:opacity-60"
                style={{ color: 'var(--text-primary)' }}
                title={added ? 'In this set list — click to remove' : 'Click to add to this set list'}
              >
                <ListMusic size={14} style={{ color: 'var(--text-muted)' }} />
                <span className="flex-1 truncate">{toTitleCase(sl.name)}</span>
                <span
                  className="flex items-center justify-center w-5 h-5 rounded border"
                  style={{
                    borderColor: added ? 'var(--accent)' : 'var(--border)',
                    background: added ? 'var(--accent)' : 'transparent',
                  }}
                >
                  {added && <Check size={13} style={{ color: 'white' }} />}
                </span>
              </button>
            );
          })}
        </div>

        <div className="p-5 pt-2 border-t flex flex-col gap-2" style={{ borderColor: 'var(--border)' }}>
          {creating ? (
            <div className="flex items-center gap-2">
              <input
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') void handleCreate(); if (e.key === 'Escape') setCreating(false); }}
                placeholder="New set list name"
                className="flex-1 px-2 py-1.5 rounded text-sm outline-none"
                style={{ background: 'var(--surface)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
              />
              <button
                onClick={() => void handleCreate()}
                disabled={!newName.trim()}
                className="px-3 py-1.5 rounded text-sm font-medium disabled:opacity-50"
                style={{ background: 'var(--accent)', color: 'white' }}
              >
                Create
              </button>
            </div>
          ) : (
            <button
              onClick={() => setCreating(true)}
              className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm w-full hover:bg-[var(--surface-elevated)] transition-colors"
              style={{ color: 'var(--text-secondary)' }}
            >
              <Plus size={14} />
              New set list
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
