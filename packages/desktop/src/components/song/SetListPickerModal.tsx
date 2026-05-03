import React, { useEffect, useState } from 'react';
import { X, Check, Plus, ListMusic } from 'lucide-react';
import { useSetListStore } from '@song-chords/shared';
import { db } from '../../ipc/ipc-client';
import { toTitleCase } from '../../utils/text';

interface Props {
  /** Setlist ids already selected — shown with a check. */
  initialSelected: string[];
  /** Short description of what the picker is for (shown under the header). */
  hint?: string;
  onClose: () => void;
  onConfirm: (setlistIds: string[]) => void;
}

/**
 * Minimal set-list picker: shows every set list with a toggle checkmark, and
 * lets the user create a new one inline. Nothing is written to songs — the
 * caller receives the final list of chosen ids via `onConfirm`.
 */
export default function SetListPickerModal({ initialSelected, hint, onClose, onConfirm }: Props): React.ReactElement {
  const setlists = useSetListStore((s) => s.setlists);
  const createSetList = useSetListStore((s) => s.createSetList);
  const [picked, setPicked] = useState<Set<string>>(() => new Set(initialSelected));
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');

  useEffect(() => {
    // Capture + stopImmediatePropagation so page-level Escape handlers
    // don't also fire (otherwise closing the picker navigates the page).
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

  const toggle = (id: string) => {
    setPicked((p) => {
      const next = new Set(p);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name) return;
    const sl = await createSetList(db, { name });
    setPicked((p) => { const n = new Set(p); n.add(sl.id); return n; });
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
        className="w-full max-w-md max-h-[80vh] rounded-xl flex flex-col"
        style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)' }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="flex items-start gap-3 p-5 pb-3 border-b" style={{ borderColor: 'var(--border)' }}>
          <div className="flex-1 min-w-0">
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Add to set list</p>
            <h3 className="font-semibold text-base" style={{ color: 'var(--text-primary)' }}>Pick set lists</h3>
            {hint && <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>{hint}</p>}
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-[var(--surface-elevated)]">
            <X size={16} style={{ color: 'var(--text-muted)' }} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-3 flex flex-col gap-1">
          {setlists.length === 0 && !creating && (
            <p className="text-sm py-4 text-center" style={{ color: 'var(--text-muted)' }}>No set lists yet.</p>
          )}
          {setlists.map((sl) => {
            const on = picked.has(sl.id);
            return (
              <button
                key={sl.id}
                onClick={() => toggle(sl.id)}
                className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-left hover:bg-[var(--surface-elevated)] transition-colors"
                style={{ color: 'var(--text-primary)' }}
              >
                <ListMusic size={14} style={{ color: 'var(--text-muted)' }} />
                <span className="flex-1 truncate">{toTitleCase(sl.name)}</span>
                <span
                  className="flex items-center justify-center w-5 h-5 rounded border"
                  style={{
                    borderColor: on ? 'var(--accent)' : 'var(--border)',
                    background: on ? 'var(--accent)' : 'transparent',
                  }}
                >
                  {on && <Check size={13} style={{ color: 'white' }} />}
                </span>
              </button>
            );
          })}
        </div>

        <div className="p-4 border-t flex flex-col gap-2" style={{ borderColor: 'var(--border)' }}>
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

          <div className="flex items-center justify-end gap-2">
            <button onClick={onClose} className="px-3 py-1.5 text-sm rounded-lg" style={{ color: 'var(--text-muted)' }}>Cancel</button>
            <button
              onClick={() => onConfirm([...picked])}
              className="px-4 py-1.5 text-sm font-medium rounded-lg"
              style={{ background: 'var(--accent)', color: 'white' }}
            >
              Done
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
