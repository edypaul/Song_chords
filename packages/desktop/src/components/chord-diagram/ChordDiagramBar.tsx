import React, { useMemo } from 'react';
import { useSettingsStore, getDiagramExact, getDiagramByIndex, extractUniqueChords, formatChord, emptyDiagramFor } from '@song-chords/shared';
import type { ParsedSong } from '@song-chords/shared';
import ChordDiagramSVG from './ChordDiagramSVG';

interface Props {
  song: ParsedSong;
  position: 'top' | 'bottom' | 'right';
  chordVariations?: Record<string, number>;
  onChordClick?: (chord: string) => void;
}

export default React.memo(function ChordDiagramBar({ song, position, chordVariations, onChordClick }: Props): React.ReactElement | null {
  const instrument = useSettingsStore((s) => s.settings.defaultInstrument);
  const svs = useSettingsStore((s) => s.settings.songViewStyle);
  const custom = useSettingsStore((s) => s.settings.customChords ?? {});
  const notation = useSettingsStore((s) => s.settings.chordNotation ?? 'letter');

  const chords = useMemo(() => extractUniqueChords(song), [song]);
  const customInstruments = useSettingsStore((s) => s.settings.customInstruments);

  const diagrams = useMemo(() => chords.map((name) => {
    const varIdx = chordVariations?.[name] ?? 0;
    const found = varIdx > 0 ? getDiagramByIndex(name, instrument, varIdx, custom) : getDiagramExact(name, instrument, custom);
    if (found) return { name, diagram: found };
    // Fallback empty diagram — shaped for the instrument (keyboard for
    // piano, an all-muted grid with the right string count otherwise,
    // including custom instruments).
    return { name, diagram: emptyDiagramFor(name, instrument, customInstruments) };
  }), [chords, chordVariations, instrument, custom, customInstruments]);

  if (chords.length === 0) return null;

  const isRight = position === 'right';
  const lineColor = svs.lyrics.color || undefined;
  const chordColor = svs.chords.color || undefined;

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: isRight ? 'column' : 'row',
        // `safe center` falls back to start-alignment when content overflows
        // the container — without it, the first item ends up at a negative
        // scroll position and gets clipped in a scrollable bar.
        justifyContent: 'safe center',
        alignItems: isRight ? 'center' : 'flex-start',
        gap: isRight ? 8 : 12,
        padding: isRight ? '10px 6px' : '8px 16px',
        background: 'var(--bg-secondary)',
        borderTop: position === 'bottom' ? '1px solid var(--border)' : undefined,
        borderBottom: position === 'top' ? '1px solid var(--border)' : undefined,
        borderLeft: isRight ? '1px solid var(--border)' : undefined,
        overflowX: isRight ? undefined : 'auto',
        overflowY: isRight ? 'auto' : undefined,
        flexShrink: 0,
        ...(isRight ? { width: 150, minHeight: 0 } : { maxHeight: 210 }),
      } as React.CSSProperties}
    >
      {diagrams.map((d) => (
        <div
          key={d.name}
          style={{ flexShrink: 0, textAlign: 'center', cursor: onChordClick ? 'pointer' : undefined }}
          onClick={onChordClick ? () => onChordClick(d.name) : undefined}
          title={onChordClick ? formatChord(d.name, notation) : undefined}
        >
          <ChordDiagramSVG diagram={d.diagram} width={isRight ? 120 : 110} lineColor={lineColor} chordColor={chordColor} displayName={formatChord(d.name, notation)} />
        </div>
      ))}
    </div>
  );
});
