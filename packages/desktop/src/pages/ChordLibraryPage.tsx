import React, { useState, useMemo } from 'react';
import { useSettingsStore, getBuiltinDiagrams, ALL_KEYS, formatChord } from '@song-chords/shared';
import type { ChordDiagram, InstrumentType } from '@song-chords/shared';
import ChordDiagramSVG from '../components/chord-diagram/ChordDiagramSVG';
import ChordForm from '../components/chord-diagram/ChordForm';
import { db } from '../ipc/ipc-client';

const ROOT_NOTES = ['All', ...ALL_KEYS.slice(0, 12)];
const BASS_NOTES = ['None', ...ALL_KEYS.slice(0, 12)];
const CHORD_TYPES = [
  'All',
  '', '5', 'sus4', 'sus2', 'add9',
  '6', '6/9',
  'maj7', 'maj9', 'maj7#11', 'maj13',
  'm', 'm(add9)', 'm6', 'mb6', 'm6/9',
  'm7', 'm7b5', 'm(maj7)',
  'm9', 'm9b5', 'm9(maj7)',
  'm11', 'm13',
  '7', '7sus4', '7b5',
  '9', '9sus4', '9b5',
  '7b9', '7#9', '7b5(#9)',
  '11', '7#11',
  '13', '13sus4',
  '+', '+7', '+9', '+7b9', '+7#9',
  '°', '°7',
];
const CHORD_TYPE_LABELS: Record<string, string> = {
  'All': 'All',
  '': '(no suffix)',
  '5': '5', 'sus4': 'sus4', 'sus2': 'sus2', 'add9': 'add9',
  '6': '6', '6/9': '6/9',
  'maj7': 'maj7', 'maj9': 'maj9', 'maj7#11': 'maj7#11', 'maj13': 'maj13',
  'm': 'm', 'm(add9)': 'm(add9)', 'm6': 'm6', 'mb6': 'mb6', 'm6/9': 'm6/9',
  'm7': 'm7', 'm7b5': 'm7b5', 'm(maj7)': 'm(maj7)',
  'm9': 'm9', 'm9b5': 'm9b5', 'm9(maj7)': 'm9(maj7)',
  'm11': 'm11', 'm13': 'm13',
  '7': '7', '7sus4': '7sus4', '7b5': '7b5',
  '9': '9', '9sus4': '9sus4', '9b5': '9b5',
  '7b9': '7b9', '7#9': '7#9', '7b5(#9)': '7b5(#9)',
  '11': '11', '7#11': '7#11',
  '13': '13', '13sus4': '13sus4',
  '+': '+', '+7': '+7', '+9': '+9', '+7b9': '+7b9', '+7#9': '+7#9',
  '°': '°', '°7': '°7',
};

export default function ChordLibraryPage(): React.ReactElement {
  const { settings, updateSetting } = useSettingsStore();
  const customChords = settings.customChords ?? {};
  const svs = settings.songViewStyle;

  const [instrument, setInstrument] = useState<InstrumentType>(settings.defaultInstrument);
  const [rootFilter, setRootFilter] = useState('All');
  const [typeFilter, setTypeFilter] = useState('All');
  const [bassFilter, setBassFilter] = useState('None');
  const [customOnly, setCustomOnly] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [selectedChord, setSelectedChord] = useState<string | null>(null);

  const builtin = getBuiltinDiagrams(instrument);

  const allChords = useMemo(() => {
    const merged: Record<string, { diagrams: ChordDiagram[]; builtinCount: number }> = {};

    // 1) Hardcoded diagrams
    for (const [name, diagrams] of Object.entries(builtin)) {
      merged[name] = { diagrams: [...diagrams], builtinCount: diagrams.length };
    }

    // 2) Custom user diagrams (filtered to the active instrument so a
    //    user-saved piano chord doesn't render in the guitar library).
    for (const [name, diagrams] of Object.entries(customChords)) {
      const matched = diagrams.filter((d) => d.instrument === instrument);
      if (matched.length === 0) continue;
      if (merged[name]) {
        merged[name].diagrams.push(...matched);
      } else {
        merged[name] = { diagrams: [...matched], builtinCount: 0 };
      }
    }

    return merged;
  }, [builtin, customChords]);

  const filtered = useMemo(() => {
    // When a bass note is selected, search for slash chords (e.g. "Csus4/E").
    // If the slash chord exists in the library, show it.
    // Otherwise show the base chord with a "/{bass}" label.
    if (bassFilter !== 'None') {
      const results: [string, { diagrams: ChordDiagram[]; builtinCount: number }][] = [];
      for (const [name] of Object.entries(allChords)) {
        const root = name.match(/^[A-G][#b]?/)?.[0] ?? '';
        const type = name.slice(root.length);
        if (rootFilter !== 'All' && root !== rootFilter) continue;
        if (typeFilter !== 'All' && type !== typeFilter) continue;
        if (customOnly && !customChords[name]?.length) continue;

        // Only show chords whose exact slash name exists in the library
        const slashName = `${name}/${bassFilter}`;
        if (allChords[slashName]) {
          results.push([slashName, allChords[slashName]!]);
        }
      }
      return results.sort(([a], [b]) => a.localeCompare(b));
    }

    return Object.entries(allChords).filter(([name]) => {
      const root = name.match(/^[A-G][#b]?/)?.[0] ?? '';
      const type = name.slice(root.length);
      if (rootFilter !== 'All' && root !== rootFilter) return false;
      if (typeFilter !== 'All' && type !== typeFilter) return false;
      if (customOnly && !customChords[name]?.length) return false;
      return true;
    }).sort(([a], [b]) => a.localeCompare(b));
  }, [allChords, rootFilter, typeFilter, bassFilter, customOnly, customChords]);

  const addCustomChord = (diagram: ChordDiagram) => {
    const existing = { ...customChords };
    existing[diagram.name] = [...(existing[diagram.name] ?? []), diagram];
    void updateSetting(db, 'customChords', existing);
    setShowAddForm(false);
  };

  const updateCustomChord = (chordName: string, customIdx: number, diagram: ChordDiagram) => {
    const existing = { ...customChords };
    const arr = [...(existing[chordName] ?? [])];
    arr[customIdx] = diagram;
    existing[chordName] = arr;
    void updateSetting(db, 'customChords', existing);
  };

  const deleteCustomChord = (chordName: string, customIdx: number) => {
    const existing = { ...customChords };
    const arr = [...(existing[chordName] ?? [])];
    arr.splice(customIdx, 1);
    if (arr.length === 0) delete existing[chordName];
    else existing[chordName] = arr;
    void updateSetting(db, 'customChords', existing);
  };

  const hasCustom = (name: string) => (customChords[name]?.filter((d) => d.instrument === instrument).length ?? 0) > 0;

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>Chord Library</h1>
        {!showAddForm && (
          <button onClick={() => setShowAddForm(true)}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
            style={{ background: 'var(--accent)', color: 'white' }}>
            + Add Chord
          </button>
        )}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 mb-6">
        <label className="flex items-center gap-1.5 text-sm" style={{ color: 'var(--text-secondary)' }}>
          Instrument
          <select value={instrument} onChange={(e) => setInstrument(e.target.value as InstrumentType)} className="setting-select">
            <option value="guitar">Guitar</option>
            <option value="ukulele">Ukulele</option>
            <option value="piano">Piano</option>
          </select>
        </label>
        <label className="flex items-center gap-1.5 text-sm" style={{ color: 'var(--text-secondary)' }}>
          Root
          <select value={rootFilter} onChange={(e) => setRootFilter(e.target.value)} className="setting-select">
            {ROOT_NOTES.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-1.5 text-sm" style={{ color: 'var(--text-secondary)' }}>
          Type
          <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="setting-select">
            {CHORD_TYPES.map((t) => <option key={t} value={t}>{CHORD_TYPE_LABELS[t] ?? t}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-1.5 text-sm" style={{ color: 'var(--text-secondary)' }}>
          Over
          <select value={bassFilter} onChange={(e) => setBassFilter(e.target.value)} className="setting-select">
            {BASS_NOTES.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        <button onClick={() => setCustomOnly((v) => !v)}
          className="flex items-center gap-1 text-xs px-2 py-1 rounded-md transition-colors"
          style={{ background: customOnly ? 'var(--accent)' : 'var(--surface-elevated)', color: customOnly ? 'white' : 'var(--text-muted)' }}>
          ★ My Chords
        </button>
        <span className="text-xs ml-auto" style={{ color: 'var(--text-muted)' }}>
          {filtered.length} chord{filtered.length !== 1 ? 's' : ''}
        </span>
      </div>

      {showAddForm ? (
        <div>
          <h2 className="text-sm font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>New Custom Chord</h2>
          <ChordForm instrument={instrument} onSave={addCustomChord} onCancel={() => setShowAddForm(false)} />
        </div>
      ) : (
      <>
        <div className="flex flex-wrap gap-3">
          {filtered.map(([name, { diagrams }]) => (
            <div key={name}
              className="rounded-lg cursor-pointer transition-colors hover:border-[var(--accent)] flex flex-col items-center justify-between"
              style={{ background: 'var(--surface)', border: '1px solid var(--border)', position: 'relative', width: 110, height: 140, padding: '4px 6px' }}
              onClick={() => setSelectedChord(name)}>
              {hasCustom(name) && (
                <span className="absolute top-0.5 right-0.5" style={{ color: 'var(--accent)', fontSize: 12 }} title="Has custom variations">★</span>
              )}
              <div style={{ flex: 1, display: 'flex', alignItems: 'center' }}>
                <ChordDiagramSVG diagram={diagrams[0]!} width={90}
                  lineColor={svs.lyrics.color || undefined} chordColor={svs.chords.color || undefined}
                  displayName={formatChord(name, settings.chordNotation ?? 'letter')} />
              </div>
              {diagrams.length > 1 ? (
                <p className="text-center text-[10px]" style={{ color: 'var(--text-muted)' }}>{diagrams.length} var.</p>
              ) : <div style={{ height: 14 }} />}
            </div>
          ))}
        </div>
        {filtered.length === 0 && (
          <p className="text-center py-12 text-sm" style={{ color: 'var(--text-muted)' }}>No chords match the current filter.</p>
        )}
      </>
      )}

      {/* Chord detail modal */}
      {selectedChord && allChords[selectedChord] && (
        <ChordDetailModal
          chordName={selectedChord}
          diagrams={allChords[selectedChord].diagrams}
          builtinCount={allChords[selectedChord].builtinCount}
          customChords={customChords}
          instrument={instrument}
          svs={svs}
          onClose={() => setSelectedChord(null)}
          onAddVariation={addCustomChord}
          onUpdateCustom={updateCustomChord}
          onDeleteCustom={deleteCustomChord}
        />
      )}

      <style>{`
        .setting-select {
          padding: 6px 10px; border-radius: 8px; border: 1px solid var(--border);
          background: var(--surface-elevated); color: var(--text-primary); font-size: 13px; outline: none; min-width: 100px;
        }
        .setting-select:focus { border-color: var(--accent); }
      `}</style>
    </div>
  );
}

/* ── Chord Detail Modal ─────────────────────────────────────────────────── */

function ChordDetailModal({ chordName, diagrams, builtinCount, customChords, instrument, svs, onClose, onAddVariation, onUpdateCustom, onDeleteCustom }: {
  chordName: string;
  diagrams: ChordDiagram[];
  builtinCount: number;
  customChords: Record<string, ChordDiagram[]>;
  instrument: InstrumentType;
  svs: { lyrics: { color: string }; chords: { color: string } };
  onClose: () => void;
  onAddVariation: (d: ChordDiagram) => void;
  onUpdateCustom: (name: string, customIdx: number, d: ChordDiagram) => void;
  onDeleteCustom: (name: string, customIdx: number) => void;
}): React.ReactElement {
  const [currentIdx, setCurrentIdx] = useState(0);
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const notation = useSettingsStore((s) => s.settings.chordNotation ?? 'letter');

  const isCustomVariation = (idx: number) => idx >= builtinCount;
  const customIdx = (idx: number) => idx - builtinCount;
  const diag = diagrams[currentIdx] ?? diagrams[0]!;
  const custom = isCustomVariation(currentIdx);
  const prev = () => setCurrentIdx((i) => (i > 0 ? i - 1 : diagrams.length - 1));
  const next = () => setCurrentIdx((i) => (i < diagrams.length - 1 ? i + 1 : 0));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.5)' }} onClick={onClose}>
      <div className="rounded-xl shadow-2xl p-6" style={{ background: 'var(--surface)', border: '1px solid var(--border)', minWidth: 280, maxWidth: 860 }}
        onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>{formatChord(chordName, notation)}</h2>
          <div className="flex items-center gap-2">
            <button onClick={() => { setShowAdd((v) => !v); setEditingIdx(null); }}
              className="text-xs px-2 py-1 rounded" style={{ background: showAdd ? 'var(--surface-elevated)' : 'var(--accent)', color: showAdd ? 'var(--text-muted)' : 'white' }}>
              {showAdd ? 'Cancel' : '+ Add'}
            </button>
            <button onClick={onClose} className="text-sm px-2 py-1 rounded hover:bg-[var(--surface-elevated)]" style={{ color: 'var(--text-muted)' }}>✕</button>
          </div>
        </div>

        {/* Add form */}
        {showAdd && (
          <ChordForm instrument={instrument} initialName={chordName} nameDisabled hideNameInPreview
            onSave={(d) => { onAddVariation(d); setShowAdd(false); }}
            onCancel={() => setShowAdd(false)} />
        )}

        {/* Edit form */}
        {editingIdx !== null && isCustomVariation(editingIdx) && (
          <ChordForm instrument={instrument} initialName={chordName} nameDisabled hideNameInPreview
            initialDiagram={diagrams[editingIdx]}
            onSave={(d) => { onUpdateCustom(chordName, customIdx(editingIdx), d); setEditingIdx(null); }}
            onCancel={() => setEditingIdx(null)} />
        )}

        {/* Slider */}
        <div className="flex items-center gap-3">
          {diagrams.length > 1 && (
            <button onClick={prev} className="p-2 rounded-lg hover:bg-[var(--surface-elevated)]" style={{ color: 'var(--text-secondary)', fontSize: 20 }}>‹</button>
          )}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <div key={currentIdx} className="chord-slide" style={{ position: 'relative' }}>
              {custom && (
                <span className="absolute top-0 right-0" style={{ color: 'var(--accent)', fontSize: 12 }} title="Custom variation">★</span>
              )}
              <ChordDiagramSVG diagram={diag} width={showAdd || editingIdx !== null ? 100 : 150}
                lineColor={svs.lyrics.color || undefined} chordColor={svs.chords.color || undefined} hideName />
            </div>
          </div>
          {diagrams.length > 1 && (
            <button onClick={next} className="p-2 rounded-lg hover:bg-[var(--surface-elevated)]" style={{ color: 'var(--text-secondary)', fontSize: 20 }}>›</button>
          )}
        </div>

        {/* Dots + info */}
        <div className="flex flex-col items-center gap-2 mt-3">
          {diagrams.length > 1 && (
            <div className="flex gap-1.5">
              {diagrams.map((_, i) => (
                <button key={i} onClick={() => setCurrentIdx(i)}
                  style={{ width: 8, height: 8, borderRadius: '50%', background: i === currentIdx ? 'var(--accent)' : 'var(--border)', border: 'none', cursor: 'pointer' }} />
              ))}
            </div>
          )}
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
            {custom ? 'Custom' : 'Built-in'} — {currentIdx + 1} of {diagrams.length}
          </span>
          {/* Edit/Delete for custom */}
          {custom && editingIdx !== currentIdx && (
            <div className="flex gap-2">
              <button onClick={() => { setEditingIdx(currentIdx); setShowAdd(false); }}
                className="text-xs px-3 py-1 rounded" style={{ color: 'var(--text-secondary)', background: 'var(--surface-elevated)' }}>Edit</button>
              <button onClick={() => { onDeleteCustom(chordName, customIdx(currentIdx)); setCurrentIdx(Math.max(0, currentIdx - 1)); }}
                className="text-xs px-3 py-1 rounded" style={{ color: 'var(--danger, #ef4444)', background: 'var(--surface-elevated)' }}>Delete</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

