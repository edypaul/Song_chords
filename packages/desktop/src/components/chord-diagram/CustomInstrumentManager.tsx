import React, { useMemo, useState } from 'react';
import { Pencil, Trash2, Plus } from 'lucide-react';
import {
  makeCustomInstrumentId,
  MIN_CUSTOM_STRINGS,
  MAX_CUSTOM_STRINGS,
} from '@song-chords/shared';
import type { ChordDiagram, CustomInstrument } from '@song-chords/shared';
import { useT } from '../../i18n';

/**
 * Modal for the Chord Library's custom instruments: list, add, edit,
 * delete. An instrument is just a name + string count (+ optional
 * tuning shown as labels in the chord editor). Deleting one is
 * destructive for its chords — the caller cascades — so the row asks
 * for an explicit confirmation that names the chord count.
 */

interface Draft {
  id?: CustomInstrument['id'];
  name: string;
  strings: number;
  tuningText: string;
}

const NOTE_RE = /^[A-Ga-g](?:#|b)?\d?$/;

/** "E A D G B E" / "e2, a2, d3" → ["E","A","D","G","B","E"]; `null`
 *  when a token isn't a note. Empty text → []. */
export function parseTuning(text: string): string[] | null {
  const tokens = text.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
  const out: string[] = [];
  for (const tok of tokens) {
    if (!NOTE_RE.test(tok)) return null;
    out.push(tok[0]!.toUpperCase() + tok.slice(1));
  }
  return out;
}

export default function CustomInstrumentManager({
  instruments, customChords, onSave, onDelete, onClose,
}: {
  instruments: Record<string, CustomInstrument>;
  customChords: Record<string, ChordDiagram[]>;
  onSave: (instrument: CustomInstrument) => void;
  onDelete: (id: CustomInstrument['id']) => void;
  onClose: () => void;
}): React.ReactElement {
  const t = useT();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const list = useMemo(
    () => Object.values(instruments).sort((a, b) => a.createdAt - b.createdAt),
    [instruments],
  );
  const chordCountFor = (id: string): number =>
    Object.values(customChords).reduce((n, arr) => n + arr.filter((d) => d.instrument === id).length, 0);

  const startCreate = () => {
    setError(null);
    setDraft({ name: '', strings: 6, tuningText: '' });
  };
  const startEdit = (ci: CustomInstrument) => {
    setError(null);
    setDraft({ id: ci.id, name: ci.name, strings: ci.strings, tuningText: (ci.tuning ?? []).join(' ') });
  };

  const save = () => {
    if (!draft) return;
    const name = draft.name.trim();
    if (!name) { setError(t('chordLibrary.instruments.nameError')); return; }
    const strings = Math.max(MIN_CUSTOM_STRINGS, Math.min(MAX_CUSTOM_STRINGS, Math.round(draft.strings) || 6));
    const tuning = parseTuning(draft.tuningText);
    if (tuning === null || (tuning.length > 0 && tuning.length !== strings)) {
      setError(t('chordLibrary.instruments.tuningError', { count: strings }));
      return;
    }
    const existing = draft.id ? instruments[draft.id] : undefined;
    onSave({
      id: draft.id ?? makeCustomInstrumentId(),
      name,
      strings,
      ...(tuning.length ? { tuning } : {}),
      createdAt: existing?.createdAt ?? Date.now(),
    });
    setDraft(null);
    setError(null);
  };

  const inputStyle: React.CSSProperties = {
    background: 'var(--surface-elevated)',
    color: 'var(--text-primary)',
    border: '1px solid var(--border)',
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.5)' }} onClick={onClose}>
      <div
        className="rounded-xl shadow-2xl p-6 flex flex-col gap-4"
        style={{ background: 'var(--surface)', border: '1px solid var(--border)', width: 520, maxWidth: '92vw', maxHeight: '86vh', overflowY: 'auto' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>{t('chordLibrary.instruments.title')}</h2>
          <button onClick={onClose} className="text-sm px-2 py-1 rounded hover:bg-[var(--surface-elevated)]" style={{ color: 'var(--text-muted)' }}>✕</button>
        </div>
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{t('chordLibrary.instruments.intro')}</p>

        {/* Add / edit form */}
        {draft ? (
          <div className="rounded-lg p-3 flex flex-col gap-2" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)' }}>
            <div className="text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>
              {draft.id ? t('chordLibrary.instruments.edit') : t('chordLibrary.instruments.add')}
            </div>
            <label className="flex items-center gap-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
              <span style={{ width: 110 }}>{t('chordLibrary.instruments.name')}</span>
              <input
                autoFocus
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                placeholder={t('chordLibrary.instruments.namePlaceholder')}
                className="flex-1 min-w-0 text-sm rounded px-2 py-1"
                style={inputStyle}
              />
            </label>
            <label className="flex items-center gap-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
              <span style={{ width: 110 }}>{t('chordLibrary.instruments.strings')}</span>
              <input
                type="number"
                min={MIN_CUSTOM_STRINGS}
                max={MAX_CUSTOM_STRINGS}
                value={draft.strings}
                onChange={(e) => setDraft({ ...draft, strings: parseInt(e.target.value, 10) || 0 })}
                className="text-sm rounded px-2 py-1"
                style={{ ...inputStyle, width: 80 }}
              />
            </label>
            <label className="flex items-center gap-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
              <span style={{ width: 110 }}>{t('chordLibrary.instruments.tuning')}</span>
              <input
                value={draft.tuningText}
                onChange={(e) => setDraft({ ...draft, tuningText: e.target.value })}
                placeholder={t('chordLibrary.instruments.tuningPlaceholder')}
                className="flex-1 min-w-0 text-sm rounded px-2 py-1 font-mono"
                style={inputStyle}
              />
            </label>
            <p className="text-[10px]" style={{ color: 'var(--text-muted)', marginLeft: 118 }}>
              {t('chordLibrary.instruments.tuningHint')}
            </p>
            {error && (
              <p className="text-xs" style={{ color: 'var(--danger, #ef4444)' }}>{error}</p>
            )}
            <div className="flex gap-2 justify-end">
              <button onClick={() => { setDraft(null); setError(null); }} className="px-3 py-1.5 rounded text-xs" style={{ color: 'var(--text-muted)' }}>
                {t('common.cancel')}
              </button>
              <button onClick={save} className="px-4 py-1.5 rounded text-xs font-semibold" style={{ background: 'var(--accent)', color: 'white' }}>
                {t('common.save')}
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={startCreate}
            className="flex items-center gap-1.5 self-start px-3 py-1.5 rounded-lg text-xs font-semibold"
            style={{ background: 'var(--accent)', color: 'white' }}
          >
            <Plus size={13} /> {t('chordLibrary.instruments.add')}
          </button>
        )}

        {/* Existing instruments */}
        {list.length === 0 ? (
          <p className="text-xs text-center py-4" style={{ color: 'var(--text-muted)' }}>{t('chordLibrary.instruments.empty')}</p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {list.map((ci) => {
              const count = chordCountFor(ci.id);
              const confirming = confirmId === ci.id;
              return (
                <div
                  key={ci.id}
                  className="rounded-lg px-3 py-2 flex items-center gap-3"
                  style={{ background: 'var(--surface-elevated)', border: '1px solid var(--border)' }}
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold truncate" style={{ color: 'var(--text-primary)' }}>{ci.name}</div>
                    <div className="text-[11px] font-mono truncate" style={{ color: 'var(--text-muted)' }}>
                      {t('chordLibrary.instruments.stringCount', { count: ci.strings })}
                      {ci.tuning?.length ? ` · ${ci.tuning.join(' ')}` : ''}
                      {' · '}
                      {count === 1
                        ? t('chordLibrary.instruments.chordCountOne')
                        : t('chordLibrary.instruments.chordCountMany', { count })}
                    </div>
                  </div>
                  {confirming ? (
                    <div className="flex items-center gap-2">
                      <span className="text-[11px]" style={{ color: 'var(--danger, #ef4444)' }}>
                        {t('chordLibrary.instruments.confirmDelete', { name: ci.name, count })}
                      </span>
                      <button
                        onClick={() => { setConfirmId(null); onDelete(ci.id); }}
                        className="px-2 py-1 rounded text-[11px] font-semibold"
                        style={{ background: 'var(--danger, #ef4444)', color: 'white' }}
                      >
                        {t('chordLibrary.instruments.confirmDeleteYes')}
                      </button>
                      <button onClick={() => setConfirmId(null)} className="px-2 py-1 rounded text-[11px]" style={{ color: 'var(--text-muted)' }}>
                        {t('common.cancel')}
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => startEdit(ci)}
                        className="p-1.5 rounded hover:bg-[var(--surface)]"
                        style={{ color: 'var(--text-secondary)' }}
                        title={t('common.edit')}
                      >
                        <Pencil size={13} />
                      </button>
                      <button
                        onClick={() => setConfirmId(ci.id)}
                        className="p-1.5 rounded hover:bg-[var(--surface)]"
                        style={{ color: 'var(--danger, #ef4444)' }}
                        title={t('common.delete')}
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
