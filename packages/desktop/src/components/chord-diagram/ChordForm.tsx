import React, { useState } from 'react';
import { useSettingsStore } from '@song-chords/shared';
import type { ChordDiagram, InstrumentType } from '@song-chords/shared';
import ChordDiagramSVG from './ChordDiagramSVG';
import InteractiveFretboard from './InteractiveFretboard';

export default function ChordForm({ instrument, initialName, nameDisabled, hideNameInPreview, initialDiagram, onSave, onCancel }: {
  instrument: InstrumentType;
  initialName?: string;
  nameDisabled?: boolean;
  /** Hide the chord-name text in the live preview diagram — use when the
   *  hosting modal already shows the chord name in its header. */
  hideNameInPreview?: boolean;
  initialDiagram?: ChordDiagram;
  onSave: (d: ChordDiagram) => void;
  onCancel: () => void;
}): React.ReactElement {
  const strings = instrument === 'guitar' ? 6 : 4;
  const [name, setName] = useState(initialName ?? initialDiagram?.name ?? '');
  const [baseFret, setBaseFret] = useState(initialDiagram?.baseFret ?? 1);
  const [frets, setFrets] = useState<(number | 'x' | 0 | null)[]>(
    initialDiagram ? [...initialDiagram.frets] : Array(strings).fill('x') as ('x')[]
  );
  const [barre, setBarre] = useState<{ fret: number; fromString: number; toString: number } | null>(
    initialDiagram?.barre ?? null
  );

  const svs = useSettingsStore((s) => s.settings.songViewStyle);

  const preview: ChordDiagram = {
    name: name || '?', instrument, baseFret, strings, frets,
    ...(barre ? { barre } : {}),
  };

  const handleFretboardChange = (newFrets: (number | 'x' | 0 | null)[], newBaseFret: number, newBarre: { fret: number; fromString: number; toString: number } | null) => {
    setFrets(newFrets);
    setBaseFret(newBaseFret);
    setBarre(newBarre);
  };

  return (

    
    <div className="mb-4 rounded-lg p-4" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)' }}>
      <label className="flex items-center gap-2 text-xs mb-5" style={{ color: 'var(--text-secondary)' }}>
        <span className="whitespace-nowrap">Chord Name</span>
        <input value={name} onChange={(e) => setName(e.target.value)} disabled={nameDisabled} placeholder="e.g. Cmaj9"
          className="flex-1 min-w-0 text-sm rounded px-2 py-1" style={{ background: 'var(--surface-elevated)', color: 'var(--text-primary)', border: '1px solid var(--border)', opacity: nameDisabled ? 0.6 : 1 }} />
      </label>

      <div className="flex items-center justify-evenly">
        <div style={{ flex: '0 0 auto' }}>
          <InteractiveFretboard instrument={instrument} frets={frets} baseFret={baseFret} barre={barre} onChange={handleFretboardChange} />
        </div>
        <div className="flex flex-col items-center" style={{ flex: '0 0 auto' }}>
          <p className="text-[10px] mb-1" style={{ color: 'var(--text-muted)' }}>Preview</p>
          <ChordDiagramSVG diagram={preview} width={140}
            lineColor={svs.lyrics.color || undefined} chordColor={svs.chords.color || undefined} hideName={hideNameInPreview} />
        </div>
      </div>

      <div className="flex items-center justify-center gap-3 mt-2">
        <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
          Click to place dots · Above nut cycles x → o → none · Drag across strings for barre
        </p>
        {barre && (
          <button onClick={() => handleFretboardChange(frets, baseFret, null)} className="text-[10px] px-2 py-0.5 rounded"
            style={{ color: 'var(--danger, #ef4444)', background: 'var(--surface-elevated)' }}>
            Remove barre
          </button>
        )}
      </div>

      <div className="flex gap-2 justify-center mt-3">
        <button onClick={() => { if (name.trim()) onSave({ ...preview, name: name.trim() }); }}
          className="px-4 py-1.5 rounded text-xs font-semibold" style={{ background: 'var(--accent)', color: 'white' }}>
          {initialDiagram ? 'Update' : 'Save'}
        </button>
        <button onClick={onCancel} className="px-4 py-1.5 rounded text-xs" style={{ color: 'var(--text-muted)' }}>Cancel</button>
      </div>
    </div>
  );
}
