import React from 'react';
import type { ChordDiagram } from '@song-chords/shared';

interface Props {
  diagram: ChordDiagram;
  /** Approximate render width (horizontal layout) or height-anchor (vertical
   *  layout). The keyboard uses a fixed aspect ratio and scales internally. */
  width?: number;
  /** Color for the keyboard outlines + black-key fill. */
  lineColor?: string;
  /** Color for highlighted notes (the chord pitches). */
  chordColor?: string;
  /** Color for the root note specifically — defaults to chord color. */
  rootColor?: string;
  /** Override color for the chord-name text. */
  nameColor?: string;
  /** Hide the chord name text. */
  hideName?: boolean;
  fontFamily?: string;
  nameFontSize?: number;
  /** Override the chord-name text (e.g. Latin notation). */
  displayName?: string;
  /** Render the keyboard vertically (keys top-to-bottom, low pitch at the
   *  bottom). Used by the inline-diagrams view to fit a piano above a
   *  single chord position without taking horizontal space. */
  vertical?: boolean;
}

const OCTAVES = 2;
const WHITE_KEYS_PER_OCTAVE = 7;
const TOTAL_WHITE = OCTAVES * WHITE_KEYS_PER_OCTAVE;

// Black key positions inside one octave: after C(0), D(1), F(3), G(4), A(5).
// Index here is the white-key index within an octave; the value is the
// semitone offset of the black key (1 = C#, 3 = D#, 6 = F#, 8 = G#, 10 = A#).
const BLACK_KEY_AFTER_WHITE: Record<number, number> = { 0: 1, 1: 3, 3: 6, 4: 8, 5: 10 };

// White-key index → semitone offset within the octave.
const WHITE_TO_SEMITONE: number[] = [0, 2, 4, 5, 7, 9, 11];

/**
 * Two-octave piano keyboard with chord notes highlighted. The lowest key
 * is C of the first octave; semitone offsets in `diagram.pianoNotes` map
 * to keys 0..23. The first entry of `pianoNotes` is the root and is
 * accented with `rootColor` (a deeper hue) so inversions read at a glance.
 *
 * Generic over key count: width and key dimensions scale based on
 * `width`. Keeps the same name-label position as `ChordDiagramSVG` so the
 * piano shape can substitute for the fretboard wherever a chord renders.
 */
export default React.memo(function PianoDiagramSVG({
  diagram,
  width = 160,
  lineColor,
  chordColor,
  rootColor,
  nameColor,
  hideName,
  fontFamily,
  nameFontSize,
  displayName,
  vertical,
}: Props): React.ReactElement {
  const notes = new Set(diagram.pianoNotes ?? []);
  const rootPitch = diagram.pianoNotes?.[0];
  const renderName = displayName ?? diagram.name;

  const lc = lineColor || 'currentColor';
  const cc = chordColor || 'var(--chord-color)';
  const rc = rootColor || cc;

  if (vertical) {
    // Vertical layout — keys run top-to-bottom with the LOW pitch at the
    // bottom (conventional piano-on-its-side orientation). The `width`
    // prop is reinterpreted as the keyboard's narrow axis (the depth of
    // a single white key). Total height = TOTAL_WHITE × white-key
    // thickness, + small padding + label space at the top.
    const padSide = 4;
    const labelH = hideName ? 0 : (nameFontSize ?? 11) + 6;
    const keyboardX = padSide;
    const keyboardW = width - padSide * 2;
    const whiteH = keyboardW * 0.42;
    const totalKeyboardH = whiteH * TOTAL_WHITE;
    const blackH = whiteH * 0.6;
    const blackW = keyboardW * 0.62;
    const totalH = labelH + totalKeyboardH + 4;

    // Build white-key rows. Y position runs top-to-bottom for high→low
    // pitch: highest semitone (23) at the top, lowest (0) at the bottom.
    type Row = { y: number; semitone: number; highlighted: boolean; isRoot: boolean };
    const whiteRows: Row[] = [];
    const blackRows: Row[] = [];
    let whiteIdx = 0;
    for (let octave = 0; octave < OCTAVES; octave++) {
      for (let w = 0; w < WHITE_KEYS_PER_OCTAVE; w++) {
        const semitone = octave * 12 + WHITE_TO_SEMITONE[w]!;
        // Inverted Y: highest white index 13 at the top, 0 at the bottom.
        const yFromBottom = whiteIdx;
        const y = labelH + (TOTAL_WHITE - 1 - yFromBottom) * whiteH;
        whiteRows.push({
          y,
          semitone,
          highlighted: notes.has(semitone),
          isRoot: semitone === rootPitch,
        });
        // Black key — drawn between this white key and the next one
        // (i.e. at the boundary above this white in vertical layout).
        const blackOffset = BLACK_KEY_AFTER_WHITE[w];
        if (blackOffset !== undefined) {
          const blackSemi = octave * 12 + blackOffset;
          // Place the black key at the boundary between the current
          // white key and the next-higher one. In our top-to-bottom
          // descending layout, the next-higher white sits *above* this
          // one, so the black key spans (y - blackH/2) to (y + blackH/2).
          const blackY = y - blackH / 2;
          blackRows.push({
            y: blackY,
            semitone: blackSemi,
            highlighted: notes.has(blackSemi),
            isRoot: blackSemi === rootPitch,
          });
        }
        whiteIdx++;
      }
    }
    return (
      <svg width={width} height={totalH} viewBox={`0 0 ${width} ${totalH}`} style={{ display: 'block', ...(fontFamily ? { fontFamily } : {}) }}>
        {!hideName && (
          <text x={width / 2} y={(nameFontSize ?? 11) + 1} textAnchor="middle" fontSize={nameFontSize ?? 11} fontWeight="800" fill={nameColor || lc} fontFamily={fontFamily}>
            {renderName}
          </text>
        )}
        {/* White keys */}
        {whiteRows.map((k) => {
          const fill = k.highlighted ? (k.isRoot ? rc : cc) : '#fff';
          return (
            <rect
              key={`w${k.semitone}`}
              x={keyboardX}
              y={k.y}
              width={keyboardW}
              height={whiteH}
              fill={fill}
              stroke={lc}
              strokeWidth={1}
              opacity={k.highlighted ? 0.85 : 1}
            />
          );
        })}
        {/* Black keys */}
        {blackRows.map((k) => {
          const baseFill = k.highlighted ? (k.isRoot ? rc : cc) : '#111';
          return (
            <g key={`b${k.semitone}`}>
              <rect
                x={keyboardX}
                y={k.y}
                width={blackW}
                height={blackH}
                fill={baseFill}
                stroke={lc}
                strokeWidth={1}
                opacity={k.highlighted ? 0.95 : 1}
              />
              {k.highlighted && (
                <circle
                  cx={keyboardX + blackW - blackH * 0.4}
                  cy={k.y + blackH / 2}
                  r={Math.min(blackH, blackW) * 0.18}
                  fill="#fff"
                  opacity={0.85}
                />
              )}
            </g>
          );
        })}
      </svg>
    );
  }

  // Horizontal layout — original implementation.
  const padTop = 38;
  const padSide = 6;
  const totalW = width;
  const keyboardW = totalW - padSide * 2;
  const whiteW = keyboardW / TOTAL_WHITE;
  const whiteH = whiteW * 3.2;
  const blackW = whiteW * 0.6;
  const blackH = whiteH * 0.62;
  const height = padTop + whiteH + 8;

  const whiteKeys: { x: number; semitone: number; highlighted: boolean; isRoot: boolean }[] = [];
  const blackKeys: { x: number; semitone: number; highlighted: boolean; isRoot: boolean }[] = [];

  for (let octave = 0; octave < OCTAVES; octave++) {
    for (let w = 0; w < WHITE_KEYS_PER_OCTAVE; w++) {
      const whiteIdx = octave * WHITE_KEYS_PER_OCTAVE + w;
      const semitone = octave * 12 + WHITE_TO_SEMITONE[w]!;
      const x = padSide + whiteIdx * whiteW;
      whiteKeys.push({
        x,
        semitone,
        highlighted: notes.has(semitone),
        isRoot: semitone === rootPitch,
      });
      const blackOffset = BLACK_KEY_AFTER_WHITE[w];
      if (blackOffset !== undefined) {
        const blackSemi = octave * 12 + blackOffset;
        const bx = x + whiteW - blackW / 2;
        blackKeys.push({
          x: bx,
          semitone: blackSemi,
          highlighted: notes.has(blackSemi),
          isRoot: blackSemi === rootPitch,
        });
      }
    }
  }

  return (
    <svg width={totalW} height={height} viewBox={`0 0 ${totalW} ${height}`} style={fontFamily ? { fontFamily } : undefined}>
      {!hideName && (
        <text x={totalW / 2} y={14} textAnchor="middle" fontSize={nameFontSize ?? 13} fontWeight="800" fill={nameColor || lc} fontFamily={fontFamily}>
          {renderName}
        </text>
      )}
      {whiteKeys.map((k) => {
        const fill = k.highlighted ? (k.isRoot ? rc : cc) : '#fff';
        return (
          <rect
            key={`w${k.semitone}`}
            x={k.x}
            y={padTop}
            width={whiteW}
            height={whiteH}
            fill={fill}
            stroke={lc}
            strokeWidth={1}
            opacity={k.highlighted ? 0.85 : 1}
          />
        );
      })}
      {blackKeys.map((k) => {
        const baseFill = k.highlighted ? (k.isRoot ? rc : cc) : '#111';
        return (
          <g key={`b${k.semitone}`}>
            <rect
              x={k.x}
              y={padTop}
              width={blackW}
              height={blackH}
              fill={baseFill}
              stroke={lc}
              strokeWidth={1}
              opacity={k.highlighted ? 0.95 : 1}
            />
            {k.highlighted && (
              <circle
                cx={k.x + blackW / 2}
                cy={padTop + blackH - blackW * 0.6}
                r={blackW * 0.22}
                fill="#fff"
                opacity={0.85}
              />
            )}
          </g>
        );
      })}
    </svg>
  );
});
