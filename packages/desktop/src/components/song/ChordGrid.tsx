import React, { useEffect, useRef, useState } from 'react';
import type { ChordGridBar, ChordGridToken, ChordGridRow as GridRow } from '@song-chords/shared';
import { useSettingsStore, formatChord } from '@song-chords/shared';
import ChordDiagramPopover from '../chord-diagram/ChordDiagramPopover';

// ── Layout constants ──────────────────────────────────────────────────────────
const ROW_H      = 28;
const TOP_PAD    = 4;
const BOT_PAD    = 4;
const SVG_H      = TOP_PAD + ROW_H + BOT_PAD;
const LEFT_PAD   = 4;

const MIN_BAR_W    = 70;
const CHORD_FONT   = 14;
const CHORD_CHAR_W = 8.4;

// Chord text vertical baseline
const CHORD_Y = TOP_PAD + ROW_H * 0.72;

// Beat dot (replaces slash)
const BEAT_DOT_R = 3.5;
const BEAT_DOT_Y = TOP_PAD + ROW_H * 0.5;

// Barlines
const BAR_Y1 = TOP_PAD;
const BAR_Y2 = TOP_PAD + ROW_H;

// Repeat barline dots
const DOT_R  = 2.5;
const DOT_Y1 = TOP_PAD + ROW_H * 0.33;
const DOT_Y2 = TOP_PAD + ROW_H * 0.67;

// Insets from outer barlines into the beat content area
const PLAIN_INSET        = 10; // always-on gap from plain barline
const START_REPEAT_INSET = 20; // extra space for |: symbol
const END_REPEAT_INSET   = 18; // extra space for :| symbol

/** Centre of each beat slot within an adjusted content region. */
function beatXs(contentLeft: number, contentW: number, numBeats: number): number[] {
  const slotW = contentW / numBeats;
  return Array.from({ length: numBeats }, (_, i) =>
    contentLeft + slotW * i + slotW / 2
  );
}

/**
 * Returns true when every bar in the token has exactly one chord and it sits
 * on the first beat — no beat-dot decoration needed.
 */
function isSimpleGrid(token: ChordGridToken): boolean {
  return token.rows.every((row) =>
    row.bars.every(
      (bar) =>
        bar.beats.filter((b) => b.chord).length === 1 &&
        bar.beats[0]?.chord !== undefined
    )
  );
}

/** Compute a single uniform bar width from ALL rows in the token. */
function computeBarW(token: ChordGridToken, simple: boolean): number {
  const allChordLengths = token.rows.flatMap((row) =>
    row.bars.flatMap((b) =>
      b.beats.filter((bt) => bt.chord).map((bt) => bt.chord!.length)
    )
  );
  const maxChordW = allChordLengths.length > 0
    ? Math.max(...allChordLengths) * CHORD_CHAR_W
    : 0;
  const maxOuterInset = START_REPEAT_INSET + END_REPEAT_INSET;
  if (simple) {
    return Math.max(MIN_BAR_W, maxChordW + maxOuterInset);
  }
  const maxBeats = Math.max(
    ...token.rows.flatMap((row) => row.bars.map((b) => b.beats.length))
  );
  const minSlotW = Math.max(maxChordW + 10, 20);
  // Add worst-case outer insets so content area always fits all beats
  return Math.max(MIN_BAR_W, maxBeats * minSlotW + maxOuterInset);
}

// ── single rendered line ──────────────────────────────────────────────────────
interface StaffRowProps {
  bars: ChordGridBar[];
  barW: number;
  startRepeat: boolean;
  endRepeat: boolean;
  repeatCount?: number;
  simple: boolean;
  chordColor?: string;
  onChordClick?: (chord: string) => void;
}

function StaffRow({ bars, barW, startRepeat, endRepeat, repeatCount, simple, chordColor, onChordClick }: StaffRowProps): React.ReactElement {
  const notation = useSettingsStore((s) => s.settings.chordNotation ?? 'letter');
  const n      = bars.length;
  const totalW = LEFT_PAD + n * barW + (endRepeat ? 20 : 10);
  const openX  = LEFT_PAD;

  return (
    <svg
      width={totalW}
      height={SVG_H}
      viewBox={`0 0 ${totalW} ${SVG_H}`}
      style={{ display: 'block', overflow: 'visible', marginBottom: 6 }}
    >
      {/* Opening barline */}
      {startRepeat ? (
        <>
          <line x1={openX} y1={BAR_Y1} x2={openX} y2={BAR_Y2}
            stroke="var(--text-primary)" strokeWidth={3} opacity={0.85} />
          <line x1={openX + 6} y1={BAR_Y1} x2={openX + 6} y2={BAR_Y2}
            stroke="var(--text-primary)" strokeWidth={1} opacity={0.75} />
          <circle cx={openX + 13} cy={DOT_Y1} r={DOT_R} fill="var(--text-primary)" opacity={0.8} />
          <circle cx={openX + 13} cy={DOT_Y2} r={DOT_R} fill="var(--text-primary)" opacity={0.8} />
        </>
      ) : (
        <line x1={openX} y1={BAR_Y1} x2={openX} y2={BAR_Y2}
          stroke="var(--text-primary)" strokeWidth={1} opacity={0.75} />
      )}

      {/* Bars */}
      {bars.map((bar, bi) => {
        const barLeft     = LEFT_PAD + bi * barW;
        const isLast      = bi === n - 1;
        const rightX      = barLeft + barW;
        // Always leave space from outer barlines; more when repeat symbols are present
        const leftInset   = bi === 0 ? (startRepeat ? START_REPEAT_INSET : PLAIN_INSET) : 0;
        const rightInset  = isLast   ? (endRepeat   ? END_REPEAT_INSET   : PLAIN_INSET) : 0;
        const contentLeft = barLeft + leftInset;
        const contentW    = barW - leftInset - rightInset;
        const xs          = beatXs(contentLeft, contentW, bar.beats.length);

        return (
          <React.Fragment key={bi}>
            {simple ? (
              <text
                x={contentLeft + contentW / 2} y={CHORD_Y}
                textAnchor="middle" fontSize={CHORD_FONT} fontWeight="700"
                fontFamily="sans-serif" fill={chordColor || 'var(--chord-color)'}
                style={onChordClick ? { cursor: 'pointer' } : undefined}
                onClick={() => bar.beats[0]!.chord && onChordClick?.(bar.beats[0]!.chord)}
              >{formatChord(bar.beats[0]!.chord ?? '', notation)}</text>
            ) : bar.beats.map((beat, si) =>
              beat.chord ? (
                <text key={si}
                  x={xs[si]} y={CHORD_Y}
                  textAnchor="middle" fontSize={CHORD_FONT} fontWeight="700"
                  fontFamily="sans-serif" fill={chordColor || 'var(--chord-color)'}
                  style={onChordClick ? { cursor: 'pointer' } : undefined}
                  onClick={() => onChordClick?.(beat.chord!)}
                >{formatChord(beat.chord, notation)}</text>
              ) : (
                <circle key={si}
                  cx={xs[si]} cy={BEAT_DOT_Y}
                  r={BEAT_DOT_R}
                  fill={chordColor || 'var(--chord-color)'} opacity={0.3}
                />
              )
            )}

            {/* Right barline */}
            {isLast && endRepeat ? (
              <>
                <circle cx={rightX - 10} cy={DOT_Y1} r={DOT_R} fill="var(--text-primary)" opacity={0.8} />
                <circle cx={rightX - 10} cy={DOT_Y2} r={DOT_R} fill="var(--text-primary)" opacity={0.8} />
                <line x1={rightX - 3} y1={BAR_Y1} x2={rightX - 3} y2={BAR_Y2}
                  stroke="var(--text-primary)" strokeWidth={1} opacity={0.75} />
                <line x1={rightX + 3} y1={BAR_Y1} x2={rightX + 3} y2={BAR_Y2}
                  stroke="var(--text-primary)" strokeWidth={1} opacity={0.75} />
                {repeatCount && (
                  <text x={rightX + 10} y={CHORD_Y}
                    textAnchor="start" fontSize={17} fontWeight="700"
                    fontFamily="sans-serif" fill="var(--text-secondary)"
                  >×{repeatCount}</text>
                )}
              </>
            ) : (
              <>
                <line x1={rightX} y1={BAR_Y1} x2={rightX} y2={BAR_Y2}
                  stroke="var(--text-primary)" strokeWidth={1} opacity={0.75} />
                {isLast && repeatCount && (
                  <text x={rightX + 6} y={CHORD_Y}
                    textAnchor="start" fontSize={17} fontWeight="700"
                    fontFamily="sans-serif" fill="var(--text-secondary)"
                  >×{repeatCount}</text>
                )}
              </>
            )}
          </React.Fragment>
        );
      })}
    </svg>
  );
}

// ── GridRow → wrapped sub-rows ────────────────────────────────────────────────
function WrappedRow({ row, barW, containerW, simple, chordColor, onChordClick }: { row: GridRow; barW: number; containerW: number; simple: boolean; chordColor?: string; onChordClick?: (chord: string) => void }): React.ReactElement {
  const barsPerLine = Math.max(1, Math.floor((containerW - LEFT_PAD) / barW));

  const chunks: ChordGridBar[][] = [];
  for (let i = 0; i < row.bars.length; i += barsPerLine) {
    chunks.push(row.bars.slice(i, i + barsPerLine));
  }

  return (
    <div>
      {chunks.map((bars, ci) => {
        const isFirst = ci === 0;
        const isLast  = ci === chunks.length - 1;
        return (
          <StaffRow
            key={ci}
            bars={bars}
            barW={barW}
            startRepeat={isFirst && !!row.startRepeat}
            endRepeat={isLast && !!row.endRepeat}
            repeatCount={isLast ? row.repeatCount : undefined}
            simple={simple}
            chordColor={chordColor}
            onChordClick={onChordClick}
          />
        );
      })}
    </div>
  );
}

// ── public component ──────────────────────────────────────────────────────────
export default function ChordGrid({ token, chordColor, onChordClick }: { token: ChordGridToken; fontSize: number; chordColor?: string; onChordClick?: (chord: string) => void }): React.ReactElement {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerW, setContainerW] = useState(600);
  const simple = isSimpleGrid(token);
  const barW = computeBarW(token, simple);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    setContainerW(el.clientWidth);
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w) setContainerW(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={containerRef} className="my-4">
      {token.rows.map((row, ri) => (
        <WrappedRow key={ri} row={row} barW={barW} containerW={containerW} simple={simple} chordColor={chordColor} onChordClick={onChordClick} />
      ))}
    </div>
  );
}
