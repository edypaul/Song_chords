import React, { useRef, useCallback } from 'react';
import type { InstrumentType } from '@song-chords/shared';

interface Props {
  instrument: InstrumentType;
  frets: (number | 'x' | 0 | null)[];
  baseFret: number;
  barre?: { fret: number; fromString: number; toString: number } | null;
  onChange: (frets: (number | 'x' | 0 | null)[], baseFret: number, barre: { fret: number; fromString: number; toString: number } | null) => void;
}

const VISIBLE_FRETS = 5;

export default function InteractiveFretboard({ instrument, frets, baseFret, barre, onChange }: Props): React.ReactElement {
  const strings = instrument === 'guitar' ? 6 : instrument === 'ukulele' ? 4 : 0;
  const width = 220;
  const padTop = 30;
  const padLeft = 24;
  const padRight = 24;
  const padBottom = 16;
  const cellW = (width - padLeft - padRight) / (strings - 1);
  const cellH = cellW * 0.85;
  const height = padTop + VISIBLE_FRETS * cellH + padBottom;
  const dotR = cellW * 0.3;

  const xs = Array.from({ length: strings }, (_, i) => padLeft + i * cellW);
  const ys = Array.from({ length: VISIBLE_FRETS + 1 }, (_, i) => padTop + i * cellH);

  // Drag state for barre creation
  const dragStart = useRef<{ si: number; fi: number } | null>(null);
  const isDragging = useRef(false);

  const handleMouseDown = useCallback((si: number, fi: number) => {
    dragStart.current = { si, fi };
    isDragging.current = false;
  }, []);

  const handleMouseUp = useCallback((si: number, fi: number) => {
    const start = dragStart.current;
    dragStart.current = null;

    if (!start) return;

    // If dragged across strings on the same fret → create barre
    if (start.fi === fi && start.si !== si) {
      isDragging.current = true;
      const fretValue = fi + baseFret;
      const fromStr = Math.min(start.si, si) + 1;
      const toStr = Math.max(start.si, si) + 1;

      onChange(
        frets,
        baseFret,
        { fret: fretValue, fromString: fromStr, toString: toStr },
      );
      return;
    }

    // Single click — toggle dot
    if (!isDragging.current && start.si === si && start.fi === fi) {
      toggleString(si, fi);
    }
  }, [frets, baseFret, barre, onChange]);

  const toggleString = (si: number, fretIdx: number) => {
    const newFrets = [...frets];
    const fretValue = fretIdx + baseFret;

    if (fretIdx === -1) {
      // Cycle above-nut state: x → o → (none) → x
      const cur = newFrets[si];
      newFrets[si] = cur === 'x' ? 0 : cur === 0 ? null : 'x';
    } else {
      if (newFrets[si] === fretValue) {
        newFrets[si] = 'x';
        // Remove barre if it was on this fret
        if (barre && barre.fret === fretValue) {
          onChange(newFrets as (number | 'x' | 0 | null)[], baseFret, null);
          return;
        }
      } else {
        newFrets[si] = fretValue;
      }
    }
    onChange(newFrets as (number | 'x' | 0 | null)[], baseFret, barre ?? null);
  };

  const shiftUp = () => {
    if (baseFret <= 1) return;
    onChange(frets, baseFret - 1, barre ?? null);
  };

  const shiftDown = () => {
    if (baseFret >= 16) return;
    onChange(frets, baseFret + 1, barre ?? null);
  };

  return (
    <div>
      {/* Base fret controls */}
      <div className="flex items-center justify-center gap-2 mb-2">
        <button onClick={shiftUp} className="px-2 py-0.5 rounded text-xs"
          style={{ background: 'var(--surface-elevated)', color: 'var(--text-secondary)' }}>▲</button>
        <span className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>
          {baseFret === 1 ? 'Open' : `Fret ${baseFret}`}
        </span>
        <button onClick={shiftDown} className="px-2 py-0.5 rounded text-xs"
          style={{ background: 'var(--surface-elevated)', color: 'var(--text-secondary)' }}>▼</button>
      </div>

      <svg width={width} height={height}
        style={{ display: 'block', margin: '0 auto', cursor: 'pointer', userSelect: 'none' }}
        onMouseLeave={() => { dragStart.current = null; }}>
        {/* Nut */}
        {baseFret === 1 && (
          <rect x={padLeft - 1} y={padTop - 3} width={width - padLeft - padRight + 2} height={4} rx={2}
            fill="var(--text-primary)" opacity={0.5} />
        )}

        {/* Fret lines */}
        {ys.map((y, i) => (
          <line key={i} x1={padLeft} y1={y} x2={width - padRight} y2={y}
            stroke="var(--text-primary)" strokeWidth={0.5} opacity={0.25} />
        ))}

        {/* String lines */}
        {xs.map((x, i) => (
          <line key={i} x1={x} y1={padTop} x2={x} y2={padTop + VISIBLE_FRETS * cellH}
            stroke="var(--text-primary)" strokeWidth={0.5} opacity={0.4} />
        ))}

        {/* Clickable fret cells */}
        {xs.map((x, si) => (
          <React.Fragment key={si}>
            {/* Above nut — open/muted toggle */}
            <rect x={x - cellW / 2} y={padTop - 22} width={cellW} height={18}
              fill="transparent" onClick={() => toggleString(si, -1)} />

            {/* Open / muted indicators */}
            {frets[si] === 0 && (
              <circle cx={x} cy={padTop - 12} r={5} fill="none" stroke="var(--text-primary)" strokeWidth={1.5} opacity={0.5} />
            )}
            {frets[si] === 'x' && (
              <g opacity={0.5}>
                <line x1={x - 4} y1={padTop - 16} x2={x + 4} y2={padTop - 8} stroke="var(--text-primary)" strokeWidth={1.5} />
                <line x1={x + 4} y1={padTop - 16} x2={x - 4} y2={padTop - 8} stroke="var(--text-primary)" strokeWidth={1.5} />
              </g>
            )}

            {/* Fret positions — drag-enabled */}
            {Array.from({ length: VISIBLE_FRETS }, (_, fi) => {
              const y = ys[fi]! + cellH / 2;
              const fretValue = fi + baseFret;
              const isActive = frets[si] === fretValue;
              return (
                <React.Fragment key={fi}>
                  <rect x={x - cellW / 2} y={ys[fi]!} width={cellW} height={cellH}
                    fill="transparent"
                    onMouseDown={() => handleMouseDown(si, fi)}
                    onMouseUp={() => handleMouseUp(si, fi)} />
                  {isActive && (
                    <circle cx={x} cy={y} r={dotR} fill="var(--accent)"
                      style={{ pointerEvents: 'none' }} />
                  )}
                </React.Fragment>
              );
            })}
          </React.Fragment>
        ))}

        {/* Barre */}
        {barre && (() => {
          const fretIdx = barre.fret - baseFret;
          if (fretIdx < 0 || fretIdx >= VISIBLE_FRETS) return null;
          const y = ys[fretIdx]! + cellH / 2;
          const x1 = xs[barre.fromString - 1]!;
          const x2 = xs[barre.toString - 1]!;
          return (
            <rect x={x1 - dotR} y={y - dotR} width={x2 - x1 + dotR * 2} height={dotR * 2}
              rx={dotR} fill="var(--accent)" opacity={0.7} style={{ pointerEvents: 'none' }} />
          );
        })()}

        {/* Fret numbers on the right */}
        {Array.from({ length: VISIBLE_FRETS }, (_, fi) => (
          <text key={fi} x={width - 6} y={ys[fi]! + cellH / 2}
            textAnchor="end" dominantBaseline="central" fontSize={9} fill="var(--text-muted)"
            style={{ pointerEvents: 'none' }}>
            {fi + baseFret}
          </text>
        ))}
      </svg>

    </div>
  );
}
