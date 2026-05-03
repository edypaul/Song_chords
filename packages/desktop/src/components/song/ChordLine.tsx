import React, { useMemo } from 'react';
import type { ParsedLine, ChordToken, LyricToken, SectionStyle, InstrumentType } from '@song-chords/shared';
import { getDiagramExact, getDiagramByIndex, useSettingsStore, formatChord } from '@song-chords/shared';
import type { SongViewStyle } from '@song-chords/shared';
import ChordDiagramSVG from '../chord-diagram/ChordDiagramSVG';

interface Props {
  line: ParsedLine;
  showChords: boolean;
  onChordClick?: (chord: string) => void;
  chordStyle?: SectionStyle;
  inlineDiagrams?: boolean;
  instrument?: InstrumentType;
  svs?: SongViewStyle;
  chordVariations?: Record<string, number>;
}

interface Chunk {
  chord?: string;
  lyric: string;
}

function buildChunks(line: ParsedLine): Chunk[] {
  const chunks: Chunk[] = [];
  let currentChord: string | undefined;
  let currentLyric = '';

  for (const token of line.tokens) {
    if (token.type === 'chord') {
      if (currentChord !== undefined || currentLyric) {
        chunks.push({ chord: currentChord, lyric: currentLyric });
        currentLyric = '';
      }
      currentChord = (token as ChordToken).chord;
    } else if (token.type === 'lyric') {
      currentLyric += (token as LyricToken).text;
    }
  }

  chunks.push({ chord: currentChord, lyric: currentLyric });
  return chunks.filter((c) => c.chord !== undefined || c.lyric.trim() !== '');
}

/**
 * Ensures every chord chunk has at least a small amount of lyric text so the
 * flex column isn't zero-width.  The chord text itself determines the column
 * width via the flex layout — no need to pad to the chord's character count.
 *
 * Mid-word padding uses em-dashes to visually connect syllables.
 */
function padChunks(chunks: Chunk[]): Chunk[] {
  return chunks.map((chunk, i) => {
    if (!chunk.chord) return chunk;

    const next = chunks[i + 1];
    const midWord =
      chunk.lyric.length > 0 &&
      !/\s$/.test(chunk.lyric) &&
      next !== undefined &&
      next.lyric.length > 0 &&
      !/^\s/.test(next.lyric);

    if (midWord) {
      // Mid-word: pad with em-dashes so syllables stay visually connected
      const minLen = chunk.chord.length + 1;
      if (chunk.lyric.length >= minLen) return chunk;
      return { ...chunk, lyric: chunk.lyric + '\u2014'.repeat(minLen - chunk.lyric.length) };
    }

    // Between words: just ensure at least 1 space so columns aren't flush
    if (chunk.lyric.length < 1) {
      return { ...chunk, lyric: ' ' };
    }
    return chunk;
  });
}

/**
 * Splits chunks at word boundaries so flex-wrap can break between words.
 * Only the first sub-chunk of each split keeps the chord.
 */
function splitChunksByWords(chunks: Chunk[]): Chunk[] {
  const result: Chunk[] = [];
  for (const chunk of chunks) {
    const parts = chunk.lyric.match(/\S+\s*|\s+/g);
    if (!parts || parts.length <= 1) {
      result.push(chunk);
      continue;
    }
    result.push({ chord: chunk.chord, lyric: parts[0]! });
    for (let i = 1; i < parts.length; i++) {
      result.push({ chord: undefined, lyric: parts[i]! });
    }
  }
  return result;
}

/**
 * Groups chunks into word-level units so mid-word chord markers don't break
 * the word apart. A group ends when the chunk's lyric ends with whitespace,
 * is empty, or is the last chunk.
 */
function groupByWords(chunks: Chunk[]): Chunk[][] {
  const groups: Chunk[][] = [];
  let current: Chunk[] = [];
  for (let i = 0; i < chunks.length; i++) {
    current.push(chunks[i]!);
    const lyric = chunks[i]!.lyric;
    if (lyric === '' || /\s$/.test(lyric) || i === chunks.length - 1) {
      groups.push(current);
      current = [];
    }
  }
  if (current.length) groups.push(current);

  // Merge trailing chord-only groups (no real lyrics, just padding spaces)
  // into the last group that has actual text. This prevents chords at the
  // end of a line from wrapping to a new line by themselves.
  if (groups.length > 1) {
    let lastTextIdx = groups.length - 1;
    while (lastTextIdx >= 0 && !groups[lastTextIdx].some((c) => c.lyric.trim() !== '')) {
      lastTextIdx--;
    }
    if (lastTextIdx >= 0 && lastTextIdx < groups.length - 1) {
      for (let i = lastTextIdx + 1; i < groups.length; i++) {
        groups[lastTextIdx] = [...groups[lastTextIdx], ...groups[i]];
      }
      groups.length = lastTextIdx + 1;
    }
  }

  return groups;
}

/**
 * Flex-column chord line renderer.
 *
 * Each chunk is an inline-flex column (chord on top, lyric on bottom) inside
 * word-level nowrap groups.  The outer container uses flex-wrap so lines break
 * at word boundaries — chords and lyrics always wrap together and stay
 * vertically aligned.
 *
 * For chordless chunks (mid-word fragments like the "i" in i[A]nevitable),
 * the chord row is a zero-width placeholder so no gap is introduced.
 */
export default React.memo(function ChordLine({ line, showChords, onChordClick, chordStyle, inlineDiagrams, instrument, svs, chordVariations }: Props): React.ReactElement {
  const custom = useSettingsStore((s) => s.settings.customChords ?? {});
  const notation = useSettingsStore((s) => s.settings.chordNotation ?? 'letter');

  // Inline-diagrams: precompute collision-avoided chord positions and the
  // adjusted lyric. Spaces are inserted at word-boundary/existing-whitespace
  // positions only, never mid-word — so words stay intact.
  const inlineData = useMemo(() => {
    if (!(showChords && inlineDiagrams && instrument)) return null;
    const DIAGRAM_CH = 10;
    let rawLyric = '';
    const chordList: Array<{ name: string; pos: number }> = [];
    for (const t of line.tokens) {
      if (t.type === 'chord') chordList.push({ name: (t as ChordToken).chord, pos: rawLyric.length });
      else if (t.type === 'lyric') rawLyric += (t as LyricToken).text;
    }
    if (chordList.length === 0) return { chords: [], positions: [], lyric: rawLyric };

    const findInsertionPoint = (s: string, pos: number): number => {
      if (pos >= s.length) return s.length;
      if (/\s/.test(s[pos]!)) return pos;
      let i = pos;
      while (i > 0 && !/\s/.test(s[i - 1]!)) i--;
      return i;
    };

    // Effective width: letters take ~1 unit, spaces ~0.5. Summing units
    // between chords gives a font-agnostic estimate of how much pixel gap
    // the lyric provides. We require DIAGRAM_CH units of gap so the
    // diagrams (≈80px wide) don't overlap regardless of whether the gap
    // is letters, spaces, or a mix.
    const charUnit = (ch: string): number => /\s/.test(ch) ? 0.5 : 1.0;
    const effUnits = (s: string, start: number, end: number): number => {
      let u = 0;
      const e = Math.min(end, s.length);
      for (let i2 = start; i2 < e; i2++) u += charUnit(s[i2]!);
      return u;
    };

    let lyric = rawLyric;
    const finalPositions: number[] = [];
    for (let i = 0; i < chordList.length; i++) {
      const c = chordList[i]!;
      if (i === 0) {
        finalPositions.push(c.pos);
        continue;
      }
      const prev = finalPositions[i - 1]!;
      const units = effUnits(lyric, prev, c.pos);
      if (units < DIAGRAM_CH) {
        const spacesToAdd = Math.ceil((DIAGRAM_CH - units) / 0.5);
        const insertPoint = findInsertionPoint(lyric, c.pos);
        lyric = lyric.slice(0, insertPoint) + ' '.repeat(spacesToAdd) + lyric.slice(insertPoint);
        for (let j = 0; j < chordList.length; j++) {
          if (chordList[j]!.pos >= insertPoint) chordList[j]!.pos += spacesToAdd;
        }
        for (let j = 0; j < finalPositions.length; j++) {
          if (finalPositions[j]! >= insertPoint) finalPositions[j]! += spacesToAdd;
        }
      }
      finalPositions.push(chordList[i]!.pos);
    }
    return { chords: chordList, positions: finalPositions, lyric };
  }, [line, showChords, inlineDiagrams, instrument]);

  const wordGroups = useMemo(() => {
    const raw = buildChunks(line);
    const chunks = showChords ? padChunks(raw) : raw;
    return groupByWords(splitChunksByWords(chunks));
  }, [line, showChords]);

  // Pre-compute diagrams for every unique chord in this line. Doing the lookup
  // once in useMemo avoids re-looking up the same chord per render.
  const diagramMap = useMemo<Record<string, import('@song-chords/shared').ChordDiagram> | null>(() => {
    if (!inlineDiagrams || !instrument) return null;
    const map: Record<string, import('@song-chords/shared').ChordDiagram> = {};
    for (const group of wordGroups) {
      for (const chunk of group) {
        if (!chunk.chord || map[chunk.chord]) continue;
        const varIdx = chordVariations?.[chunk.chord] ?? 0;
        const found = varIdx > 0
          ? getDiagramByIndex(chunk.chord, instrument, varIdx, custom)
          : getDiagramExact(chunk.chord, instrument, custom);
        const diag = found ?? (instrument === 'piano'
          ? { name: chunk.chord, instrument, baseFret: 1, strings: 0, frets: [], pianoNotes: [] }
          : {
              name: chunk.chord,
              instrument,
              baseFret: 1,
              strings: instrument === 'guitar' ? 6 : 4,
              frets: Array(instrument === 'guitar' ? 6 : 4).fill('x') as ('x')[],
            });
        map[chunk.chord] = diag;
      }
    }
    return map;
  }, [inlineDiagrams, instrument, wordGroups, chordVariations, custom]);

  const chordFontSize = chordStyle?.fontSize ? `${chordStyle.fontSize}px` : '0.85em';
  const diagramW = 80;

  // Inline-diagrams mode: embed each chord diagram as a 0-width marker at
  // its source character position inside the lyric flow. The SVG is
  // absolutely positioned above the marker so natural text layout (in the
  // preset font) handles horizontal alignment — no monospace override.
  if (inlineData) {
    const { chords, positions, lyric } = inlineData;
    if (chords.length === 0) {
      return <div style={{ margin: '2px 0' }}>{lyric || '\u00A0'}</div>;
    }
    // Per-instrument SVG height. Each diagram has a different intrinsic
    // rendered height (a 4-string ukulele draws taller-aspect cells than
    // a 6-string guitar at the same width), so a single multiplier
    // either crops shorter instruments or leaves a gap.
    //
    //  - guitar: 6 strings → cellH ≈ width × 0.108 → ~93 px @ 80
    //  - ukulele: 4 strings → cellH ≈ width × 0.18  → ~122 px @ 80
    //  - piano (vertical): 14 keys + label          → ~190 px @ 80
    const svgHeight =
      instrument === 'piano'
        ? Math.round(diagramW * 2.4)
        : instrument === 'ukulele'
          ? Math.round(diagramW * 1.55)
          : Math.round(diagramW * 1.2);
    // Visible gap between the diagram's bottom edge and the lyric's
    // top edge.
    const VISIBLE_GAP = 3;
    // The SVG is absolutely positioned `top: -PADDING_TOP` from the
    // lyric anchor — i.e. PADDING_TOP px above the lyric. Make
    // PADDING_TOP = svgHeight + VISIBLE_GAP so the SVG's bottom sits
    // exactly VISIBLE_GAP px above the lyric. The container's
    // `paddingTop` (below) uses the same value to reserve room above
    // the lyric line.
    const PADDING_TOP = svgHeight + VISIBLE_GAP;
    // ChordDiagramSVG has padLeft=16 before its first string. Shift the
    // SVG 16px left so that leftmost string aligns with the marker's
    // character position, not the SVG's outer bounding box.
    const SVG_LEFT_OFFSET = -16;

    // Merge chord markers into the lyric text, ordered by final position.
    const sorted = chords
      .map((c, i) => ({ name: c.name, pos: positions[i]! }))
      .sort((a, b) => a.pos - b.pos);

    const pieces: React.ReactNode[] = [];
    let lyricIdx = 0;
    sorted.forEach((m, mi) => {
      if (m.pos > lyricIdx) {
        pieces.push(lyric.slice(lyricIdx, m.pos));
        lyricIdx = m.pos;
      }
      const varIdx = chordVariations?.[m.name] ?? 0;
      const found = varIdx > 0
        ? getDiagramByIndex(m.name, instrument!, varIdx, custom)
        : getDiagramExact(m.name, instrument!, custom);
      const diag = found ?? (instrument === 'piano'
        ? { name: m.name, instrument: instrument!, baseFret: 1, strings: 0, frets: [], pianoNotes: [] }
        : {
            name: m.name,
            instrument: instrument!,
            baseFret: 1,
            strings: instrument === 'guitar' ? 6 : 4,
            frets: Array(instrument === 'guitar' ? 6 : 4).fill('x') as ('x')[],
          });
      pieces.push(
        <span key={`m${mi}`} style={{ position: 'relative' }}>
          <span style={{ position: 'absolute', top: -PADDING_TOP, left: SVG_LEFT_OFFSET, lineHeight: 0, whiteSpace: 'nowrap', cursor: onChordClick ? 'pointer' : undefined }} onClick={() => onChordClick?.(m.name)} title={formatChord(m.name, notation)}>
            <ChordDiagramSVG
              diagram={diag}
              width={diagramW}
              lineColor={svs?.lyrics.color || undefined}
              chordColor={svs?.chords.color || undefined}
              nameColor={svs?.chords.color || undefined}
              displayName={formatChord(m.name, notation)}
              vertical={instrument === 'piano'}
            />
          </span>
        </span>
      );
    });
    if (lyricIdx < lyric.length) {
      pieces.push(lyric.slice(lyricIdx));
    }

    return (
      <div style={{ margin: 0, paddingTop: PADDING_TOP }}>
        <div style={{ whiteSpace: 'pre' }}>{pieces}</div>
      </div>
    );
  }

  return (
    <div style={{
      display: 'flex',
      flexWrap: 'wrap',
      alignItems: 'flex-end',
      lineHeight: 1,
      margin: '2px 0',
    }}>
      {wordGroups.map((group, gi) => (
        <span key={gi} style={{ display: 'inline-flex', flexWrap: 'nowrap', alignItems: 'flex-end' }}>
          {group.map((chunk, ci) => (
            // Each chunk is an inline-block with two stacked fixed-height
            // rows (chord + lyric). Using inline-block + verticalAlign
            // anchors every chunk to the same baseline; the chord row has a
            // fixed height so chord-only chunks (padded lyric = " ") can
            // never shrink the column and pull the chord onto the lyric row.
            <span key={ci} style={{ display: 'inline-block', verticalAlign: 'bottom' }}>
              {showChords && (
                <span style={{
                  // Flex container anchored to the row's bottom edge so
                  // the diagram sits flush against the row's bottom.
                  display: 'flex',
                  alignItems: 'flex-end',
                  // Per-instrument height, sized to each diagram's actual
                  // rendered SVG.
                  //
                  //  - guitar: 6 strings → cellH ≈ width × 0.108 → ~93 px @ 80
                  //  - ukulele: 4 strings → cellH ≈ width × 0.18  → ~122 px @ 80
                  //  - piano (vertical): 14 keys stacked + label   → ~190 px @ 80
                  height: inlineDiagrams
                    ? (instrument === 'piano'
                        ? `${Math.round(diagramW * 2.4)}px`
                        : instrument === 'ukulele'
                          ? `${Math.round(diagramW * 1.55)}px`
                          : `${Math.round(diagramW * 1.2)}px`)
                    : '1.4em',
                  lineHeight: inlineDiagrams ? '0' : '1.4em',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                }}>
                  {chunk.chord ? (
                    diagramMap && diagramMap[chunk.chord] ? (
                      <span
                        style={{
                          cursor: onChordClick ? 'pointer' : undefined,
                          marginRight: 4,
                          // Fretboards have 14px left padding for muted/open
                          // markers — pull the wrapper left to compensate.
                          // Vertical pianos don't have that padding so don't
                          // need the negative margin.
                          marginLeft: instrument === 'piano' ? 0 : -14,
                          display: 'inline-block',
                          // Bottom-aligned in the chord row's flex container
                          // (see chord-row span above), so the diagram sits
                          // flush against the lyric line below.
                          verticalAlign: 'bottom',
                        }}
                        onClick={() => onChordClick?.(chunk.chord!)}
                        title={formatChord(chunk.chord, notation)}
                      >
                        <ChordDiagramSVG diagram={diagramMap[chunk.chord]!} width={diagramW}
                          lineColor={svs?.lyrics.color || undefined}
                          chordColor={svs?.chords.color || undefined}
                          nameColor={svs?.chords.color || undefined}
                          displayName={formatChord(chunk.chord, notation)}
                          vertical={instrument === 'piano'} />
                      </span>
                    ) : (
                      <span
                        className="chord"
                        style={{
                          fontWeight: 600,
                          fontSize: chordFontSize,
                          whiteSpace: 'nowrap',
                          paddingRight: '0.3em',
                          color: chordStyle?.color || undefined,
                          cursor: onChordClick ? 'pointer' : undefined,
                        }}
                        onClick={() => onChordClick?.(chunk.chord!)}
                        title={chunk.chord ? `Click to view ${formatChord(chunk.chord, notation)} diagram` : undefined}
                      >
                        {formatChord(chunk.chord, notation)}
                      </span>
                    )
                  ) : (
                    // Zero-width space so the chord row keeps its fixed height.
                    '\u200B'
                  )}
                </span>
              )}
              {/* Explicit gap between the chord row and the lyric.
                  Empty block element with a fixed height \u2014 guaranteed
                  to render visible space regardless of how parent
                  flex / inline contexts collapse margins. */}
              {inlineDiagrams && (
                <span style={{ display: 'block', height: '14px', lineHeight: '0' }} aria-hidden="true">
                  {'\u200B'}
                </span>
              )}
              <span style={{
                display: 'block',
                whiteSpace: 'pre',
                height: '1.2em',
                lineHeight: '1.2em',
              }}>{chunk.lyric.length === 0 ? '\u00A0' : chunk.lyric}</span>
            </span>
          ))}
        </span>
      ))}
    </div>
  );
});
