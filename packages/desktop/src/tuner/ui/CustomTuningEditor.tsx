import React, { useState } from 'react';
import { X, Plus, Trash2 } from 'lucide-react';
import type { TunerInstrument } from '../tunings/presets';
import { parseNoteName } from '../dsp/note';

/**
 * Modal for creating / editing a custom tuning. Validates each note
 * string against `parseNoteName` so we never persist an unparseable
 * entry — the Save button stays disabled until every row is valid
 * and the name is non-empty.
 */

export interface CustomTuningDraft {
  /** Existing id when editing; undefined for a new tuning. */
  id?: string;
  name: string;
  instrument: TunerInstrument;
  notes: string[];
}

export default function CustomTuningEditor({
  draft,
  onCancel,
  onSave,
}: {
  draft: CustomTuningDraft;
  onCancel: () => void;
  onSave: (d: CustomTuningDraft) => void;
}): React.ReactElement {
  const [name, setName] = useState(draft.name);
  const [notes, setNotes] = useState<string[]>(draft.notes.length ? [...draft.notes] : ['E2']);

  const rowsValid = notes.every((n) => parseNoteName(n) !== null);
  const canSave = name.trim().length > 0 && notes.length > 0 && rowsValid;

  const setNoteAt = (i: number, v: string) => {
    setNotes((arr) => arr.map((n, j) => (j === i ? v : n)));
  };
  const addNote = () => {
    // Default the new note one semitone above the previous one when
    // possible — that's almost always what the user wants next.
    const last = notes[notes.length - 1];
    setNotes((arr) => [...arr, last ?? 'E2']);
  };
  const removeNote = (i: number) => {
    setNotes((arr) => arr.filter((_, j) => j !== i));
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.5)' }}
      onClick={onCancel}
    >
      <div
        className="rounded-xl shadow-2xl p-5"
        style={{
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          width: 380,
          maxWidth: '90vw',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
            {draft.id ? 'Edit tuning' : 'New custom tuning'}
          </h3>
          <button
            onClick={onCancel}
            className="p-1 rounded hover:bg-[var(--surface-elevated)]"
            style={{ color: 'var(--text-muted)' }}
            aria-label="Close"
          >
            <X size={14} />
          </button>
        </div>

        <label className="flex flex-col gap-1 mb-3 text-xs" style={{ color: 'var(--text-secondary)' }}>
          Name
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="rounded px-2 py-1 text-sm"
            placeholder="e.g. Drop C with high E"
            style={{
              background: 'var(--surface-elevated)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border)',
            }}
          />
        </label>

        <div className="text-xs font-semibold uppercase tracking-wider mb-2"
          style={{ color: 'var(--text-muted)', letterSpacing: '0.08em' }}>
          Strings (low → high)
        </div>
        <div className="flex flex-col gap-1.5 mb-3">
          {notes.map((n, i) => {
            const ok = parseNoteName(n) !== null;
            return (
              <div key={i} className="flex items-center gap-2">
                <span className="text-xs font-mono w-6 text-center" style={{ color: 'var(--text-muted)' }}>
                  {i + 1}
                </span>
                <input
                  value={n}
                  onChange={(e) => setNoteAt(i, e.target.value)}
                  className="flex-1 rounded px-2 py-1 text-sm font-mono"
                  placeholder="e.g. E2"
                  style={{
                    background: 'var(--surface-elevated)',
                    color: ok ? 'var(--text-primary)' : 'var(--danger, #ef4444)',
                    border: `1px solid ${ok ? 'var(--border)' : 'var(--danger, #ef4444)'}`,
                  }}
                />
                <button
                  onClick={() => removeNote(i)}
                  disabled={notes.length <= 1}
                  className="p-1 rounded hover:bg-[var(--surface-elevated)] disabled:opacity-30 disabled:cursor-not-allowed"
                  style={{ color: 'var(--text-muted)' }}
                  title="Remove string"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            );
          })}
        </div>

        <button
          onClick={addNote}
          className="flex items-center gap-1.5 text-xs px-2 py-1 rounded hover:bg-[var(--surface-elevated)] mb-4"
          style={{ color: 'var(--text-secondary)', border: '1px solid var(--border)' }}
        >
          <Plus size={12} /> Add string
        </button>

        <p className="text-[11px] mb-3" style={{ color: 'var(--text-muted)' }}>
          Use scientific pitch notation: <code>E2</code>, <code>A2</code>, <code>D3</code>,{' '}
          <code>G#3</code>, <code>Bb3</code>. The number is the octave (A4 = 440 Hz by default).
        </p>

        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="px-3 py-1.5 rounded text-xs"
            style={{ color: 'var(--text-muted)' }}
          >
            Cancel
          </button>
          <button
            disabled={!canSave}
            onClick={() => onSave({ id: draft.id, name: name.trim(), instrument: draft.instrument, notes })}
            className="px-3 py-1.5 rounded text-xs font-semibold disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ background: 'var(--accent)', color: 'white' }}
          >
            {draft.id ? 'Save changes' : 'Create tuning'}
          </button>
        </div>
      </div>
    </div>
  );
}
