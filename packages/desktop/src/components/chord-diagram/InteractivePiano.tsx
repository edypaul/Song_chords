import React from 'react';

interface Props {
  /** Currently-selected semitone offsets (0..23). The first entry is the
   *  chord root (drawn with the accent color). */
  notes: number[];
  /** Called whenever the selection changes. Receives the new note list,
   *  ordered with the root first. */
  onChange: (next: number[]) => void;
  /** Approximate render width. */
  width?: number;
}

const OCTAVES = 2;
const WHITE_KEYS_PER_OCTAVE = 7;
const TOTAL_WHITE = OCTAVES * WHITE_KEYS_PER_OCTAVE;
const BLACK_KEY_AFTER_WHITE: Record<number, number> = { 0: 1, 1: 3, 3: 6, 4: 8, 5: 10 };
const WHITE_TO_SEMITONE: number[] = [0, 2, 4, 5, 7, 9, 11];

/**
 * Click-to-toggle 2-octave keyboard editor for piano chord diagrams.
 *
 * Click a key to add/remove it from the chord. Double-click (or
 * ctrl-click) sets the clicked key as the chord root — the first entry
 * of the notes array, which the renderer accents in `rootColor`.
 *
 * Layout matches `PianoDiagramSVG` so the editor and the live preview
 * read as the same instrument.
 */
export default function InteractivePiano({ notes, onChange, width = 300 }: Props): React.ReactElement {
  const selected = new Set(notes);
  const root = notes[0];

  const padTop = 6;
  const padSide = 4;
  const keyboardW = width - padSide * 2;
  const whiteW = keyboardW / TOTAL_WHITE;
  const whiteH = whiteW * 3.4;
  const blackW = whiteW * 0.6;
  const blackH = whiteH * 0.62;
  const height = padTop + whiteH + 6;

  const setRootOf = (semitone: number) => {
    if (!selected.has(semitone)) {
      // Adding a new note as root.
      onChange([semitone, ...notes]);
      return;
    }
    // Already in chord — promote to root.
    if (root === semitone) return;
    const others = notes.filter((n) => n !== semitone);
    onChange([semitone, ...others]);
  };

  const toggle = (semitone: number) => {
    if (selected.has(semitone)) {
      // Removing the root: the next-lowest note becomes root.
      const next = notes.filter((n) => n !== semitone);
      if (root === semitone && next.length) {
        const sorted = [...next].sort((a, b) => a - b);
        const newRoot = sorted[0]!;
        onChange([newRoot, ...next.filter((n) => n !== newRoot)]);
      } else {
        onChange(next);
      }
      return;
    }
    // Adding: append. If no root yet, this becomes the root.
    if (notes.length === 0) {
      onChange([semitone]);
    } else {
      onChange([root!, ...notes.filter((n) => n !== root), semitone]);
    }
  };

  const handleClick = (e: React.MouseEvent, semitone: number) => {
    if (e.shiftKey || e.ctrlKey || e.metaKey) {
      setRootOf(semitone);
      return;
    }
    toggle(semitone);
  };

  // Build the keyboard.
  const whites: { x: number; semitone: number }[] = [];
  const blacks: { x: number; semitone: number }[] = [];
  for (let octave = 0; octave < OCTAVES; octave++) {
    for (let w = 0; w < WHITE_KEYS_PER_OCTAVE; w++) {
      const whiteIdx = octave * WHITE_KEYS_PER_OCTAVE + w;
      const semitone = octave * 12 + WHITE_TO_SEMITONE[w]!;
      whites.push({ x: padSide + whiteIdx * whiteW, semitone });
      const offset = BLACK_KEY_AFTER_WHITE[w];
      if (offset !== undefined) {
        blacks.push({
          x: padSide + whiteIdx * whiteW + whiteW - blackW / 2,
          semitone: octave * 12 + offset,
        });
      }
    }
  }

  // Editor pressed-key color tracks the active style preset's chord
  // color so the editor matches displayed diagrams in the same view.
  const cc = 'var(--chord-color)';
  const lc = 'var(--text-primary)';

  return (
    <div className="flex flex-col items-center select-none">
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
        {whites.map((k) => {
          const isSel = selected.has(k.semitone);
          // Naturals (C D E F G A B) — solid white when unselected.
          // All selected keys (root included) use the same chord color.
          const fill = isSel ? cc : '#fff';
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
              opacity={isSel ? 0.85 : 1}
              style={{ cursor: 'pointer' }}
              onClick={(e) => handleClick(e, k.semitone)}
            />
          );
        })}
        {blacks.map((k) => {
          const isSel = selected.has(k.semitone);
          // Sharps / flats (C# D# F# G# A#) — solid black when unselected.
          // All selected keys (root included) use the same chord color.
          const fill = isSel ? cc : '#111';
          return (
            <g key={`b${k.semitone}`}>
              <rect
                x={k.x}
                y={padTop}
                width={blackW}
                height={blackH}
                fill={fill}
                stroke={lc}
                strokeWidth={1}
                opacity={isSel ? 0.95 : 1}
                style={{ cursor: 'pointer' }}
                onClick={(e) => handleClick(e, k.semitone)}
              />
              {isSel && (
                <circle
                  cx={k.x + blackW / 2}
                  cy={padTop + blackH - blackW * 0.6}
                  r={blackW * 0.22}
                  fill="#fff"
                  opacity={0.85}
                  pointerEvents="none"
                />
              )}
            </g>
          );
        })}
      </svg>
      <p className="text-[10px] mt-1" style={{ color: 'var(--text-muted)' }}>
        Click a key to add/remove · Shift-click to set as root
      </p>
    </div>
  );
}
