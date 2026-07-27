import React, { useState } from 'react';
import { useSettingsStore } from '@song-chords/shared';
import type { ChordDiagram, InstrumentType } from '@song-chords/shared';
import ChordDiagramSVG from './ChordDiagramSVG';
import InteractiveFretboard from './InteractiveFretboard';
import InteractivePiano from './InteractivePiano';
import { useT } from '../../i18n';

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
  const t = useT();
  const isPiano = instrument === 'piano';
  const strings = instrument === 'guitar' ? 6 : instrument === 'ukulele' ? 4 : 0;
  const [name, setName] = useState(initialName ?? initialDiagram?.name ?? '');
  const [baseFret, setBaseFret] = useState(initialDiagram?.baseFret ?? 1);
  const [frets, setFrets] = useState<(number | 'x' | 0 | null)[]>(
    initialDiagram && !isPiano ? [...initialDiagram.frets] : Array(strings).fill('x') as ('x')[]
  );
  const [barre, setBarre] = useState<{ fret: number; fromString: number; toString: number } | null>(
    initialDiagram?.barre ?? null
  );
  const [pianoNotes, setPianoNotes] = useState<number[]>(
    initialDiagram?.pianoNotes ? [...initialDiagram.pianoNotes] : []
  );

  const svs = useSettingsStore((s) => s.settings.songViewStyle);

  const preview: ChordDiagram = isPiano
    ? { name: name || '?', instrument, baseFret: 1, strings: 0, frets: [], pianoNotes }
    : {
        name: name || '?', instrument, baseFret, strings, frets,
        ...(barre ? { barre } : {}),
      };

  const handleFretboardChange = (newFrets: (number | 'x' | 0 | null)[], newBaseFret: number, newBarre: { fret: number; fromString: number; toString: number } | null) => {
    setFrets(newFrets);
    setBaseFret(newBaseFret);
    setBarre(newBarre);
  };

  // Quick-insert chip palette next to the chord-name input. Each chip
  // appends its `insert` text to whatever the user has typed so they
  // can build a full chord name (e.g. start "C", click "maj", click
  // "7" → "Cmaj7"). Tooltips on hover describe what each symbol means
  // so newer players who don't recognise °/+/# /b learn the notation
  // by using it. The set mirrors the canonical CHORD_FORMULAS suffix
  // grammar (so anything the user assembles is a chord the engine
  // can actually render) plus the two root accidentals (#, b) and the
  // slash-bass separator that aren't part of any single suffix.
  const insertSymbol = (s: string) => {
    if (nameDisabled) return;
    setName((n) => n + s);
  };
  type Chip = { label: string; insert: string; title: string };
  type Group = { chips: Chip[] };
  const palette: Group[] = [
    // Root accidentals — only useful before a quality, but harmless
    // anywhere; placed first so users typing "C" then "#" get C#.
    { chips: [
      { label: '#',  insert: '#',  title: t('chordForm.palette.sharp') },
      { label: '♭',  insert: 'b',  title: t('chordForm.palette.flat') },
    ]},
    // Quality
    { chips: [
      { label: 'm',  insert: 'm',  title: t('chordForm.palette.minor') },
      { label: '+',  insert: '+',  title: t('chordForm.palette.augmented') },
      { label: '°',  insert: '°',  title: t('chordForm.palette.diminished') },
      { label: '°7', insert: '°7', title: t('chordForm.palette.diminished7') },
    ]},
    // Sus
    { chips: [
      { label: 'sus2', insert: 'sus2', title: t('chordForm.palette.sus2') },
      { label: 'sus4', insert: 'sus4', title: t('chordForm.palette.sus4') },
    ]},
    // Sevenths & extensions
    { chips: [
      { label: '6',    insert: '6',    title: t('chordForm.palette.sixth') },
      { label: '7',    insert: '7',    title: t('chordForm.palette.dom7') },
      { label: 'maj7', insert: 'maj7', title: t('chordForm.palette.maj7') },
      { label: '9',    insert: '9',    title: t('chordForm.palette.ninth') },
      { label: '11',   insert: '11',   title: t('chordForm.palette.eleventh') },
      { label: '13',   insert: '13',   title: t('chordForm.palette.thirteenth') },
      { label: 'add9', insert: 'add9', title: t('chordForm.palette.add9') },
    ]},
    // Alterations (applied to an existing quality)
    { chips: [
      { label: 'b5',  insert: 'b5',  title: t('chordForm.palette.flat5') },
      { label: '#5',  insert: '#5',  title: t('chordForm.palette.sharp5') },
      { label: 'b9',  insert: 'b9',  title: t('chordForm.palette.flat9') },
      { label: '#9',  insert: '#9',  title: t('chordForm.palette.sharp9') },
      { label: '#11', insert: '#11', title: t('chordForm.palette.sharp11') },
    ]},
    // Slash bass
    { chips: [
      { label: '/', insert: '/', title: t('chordForm.palette.slashBass') },
    ]},
  ];

  return (


    <div className="mb-4 rounded-lg p-4" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)' }}>
      {/* Quick-insert chord-symbol palette. Each chip appends its
          symbol to the input below. Hover for a description. Disabled
          when the name itself is disabled (e.g. editing a custom
          variation from a fixed chord).

          Same two-column shape as the Chord-Name row below: a
          "Symbols" leader on the left, then the chips on the right
          column. Because the leader text here ("Symbols") is shorter
          than "Chord Name", we render an INVISIBLE "Chord Name"
          placeholder behind it so the column is the exact width of
          the longest label and the chip palette aligns horizontally
          with the input field beneath it. */}
      <div className="flex items-center gap-2 text-xs mb-2" style={{ color: 'var(--text-secondary)' }}>
        <span className="whitespace-nowrap relative inline-block">
          {/* Reserve the width of the longer "Chord Name" label so
              the right column starts at the same x as the input. */}
          <span aria-hidden="true" style={{ visibility: 'hidden' }}>{t('chordForm.chordName')}</span>
          {/* Visible "Symbols" label, absolutely positioned on the
              left so it sits exactly where "Chord Name" sits below. */}
          <span style={{ position: 'absolute', left: 0, top: 0 }}>{t('chordForm.symbols')}</span>
        </span>
        <div
          className="flex-1 min-w-0 flex items-center gap-1 flex-wrap"
          style={{ opacity: nameDisabled ? 0.4 : 1, pointerEvents: nameDisabled ? 'none' : undefined }}
        >
          {palette.map((group, gi) => (
            <React.Fragment key={gi}>
              {gi > 0 && (
                <span aria-hidden="true" style={{ width: 1, height: 18, background: 'var(--border)', margin: '0 4px' }} />
              )}
              {group.chips.map((c) => (
                <button
                  key={c.label}
                  type="button"
                  onClick={() => insertSymbol(c.insert)}
                  title={c.title}
                  aria-label={c.title}
                  className="px-2 py-0.5 rounded text-xs font-mono transition-colors hover:bg-[var(--accent)] hover:text-white"
                  style={{
                    background: 'var(--surface-elevated)',
                    color: 'var(--text-primary)',
                    border: '1px solid var(--border)',
                    minWidth: 26,
                  }}
                >
                  {c.label}
                </button>
              ))}
            </React.Fragment>
          ))}
        </div>
      </div>

      {/* Chord-name input — sits BELOW the symbol palette so the
          symbols feel like the assembly toolbar and the input below
          shows the result the user is building. Generous vertical
          spacing (mt-5 mb-6) gives clear visual separation from both
          the palette above and the fretboard/piano editor below. */}
      <label className="flex items-center gap-2 text-xs mt-5 mb-6" style={{ color: 'var(--text-secondary)' }}>
        <span className="whitespace-nowrap">{t('chordForm.chordName')}</span>
        <input value={name} onChange={(e) => setName(e.target.value)} disabled={nameDisabled} placeholder={t('chordForm.chordNamePlaceholder')}
          className="flex-1 min-w-0 text-sm rounded px-2 py-1" style={{ background: 'var(--surface-elevated)', color: 'var(--text-primary)', border: '1px solid var(--border)', opacity: nameDisabled ? 0.6 : 1 }} />
      </label>

      <div className="flex items-center justify-evenly">
        <div style={{ flex: '0 0 auto' }}>
          {isPiano ? (
            <InteractivePiano notes={pianoNotes} onChange={setPianoNotes} width={300} />
          ) : (
            <InteractiveFretboard instrument={instrument} frets={frets} baseFret={baseFret} barre={barre} onChange={handleFretboardChange} />
          )}
        </div>
        <div className="flex flex-col items-center" style={{ flex: '0 0 auto' }}>
          <p className="text-[10px] mb-1" style={{ color: 'var(--text-muted)' }}>{t('chordForm.preview')}</p>
          <ChordDiagramSVG diagram={preview} width={isPiano ? 200 : 140}
            lineColor={svs.lyrics.color || undefined} chordColor={svs.chords.color || undefined} hideName={hideNameInPreview} />
        </div>
      </div>

      {!isPiano && (
        <div className="flex items-center justify-center gap-3 mt-2">
          <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
            {t('chordForm.fretboardHint')}
          </p>
          {barre && (
            <button onClick={() => handleFretboardChange(frets, baseFret, null)} className="text-[10px] px-2 py-0.5 rounded"
              style={{ color: 'var(--danger, #ef4444)', background: 'var(--surface-elevated)' }}>
              {t('chordForm.removeBarre')}
            </button>
          )}
        </div>
      )}

      <div className="flex gap-2 justify-center mt-3">
        <button onClick={() => { if (name.trim()) onSave({ ...preview, name: name.trim() }); }}
          className="px-4 py-1.5 rounded text-xs font-semibold" style={{ background: 'var(--accent)', color: 'white' }}>
          {initialDiagram ? t('chordForm.update') : t('common.save')}
        </button>
        <button onClick={onCancel} className="px-4 py-1.5 rounded text-xs" style={{ color: 'var(--text-muted)' }}>{t('common.cancel')}</button>
      </div>
    </div>
  );
}
