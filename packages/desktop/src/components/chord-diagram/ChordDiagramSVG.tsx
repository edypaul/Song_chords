import React, { useMemo } from 'react';
import type { ChordDiagram } from '@song-chords/shared';

interface Props {
  diagram: ChordDiagram;
  width?: number;
  /** Color for the grid lines, nut, string lines, muted/open markers */
  lineColor?: string;
  /** Color for dots and barre */
  chordColor?: string;
  /** Override color for the chord name text (defaults to lineColor) */
  nameColor?: string;
  /** Hide the chord name text */
  hideName?: boolean;
}

export default React.memo(function ChordDiagramSVG({ diagram, width = 120, lineColor, chordColor, nameColor, hideName }: Props): React.ReactElement {
  const { frets, strings, baseFret, barre, name } = diagram;
  const numFrets = 5;
  const padTop = 38;
  const fretLabelW = baseFret > 1 ? Math.round(width * 0.16) : 0;
  const totalW = width + fretLabelW;
  const padLeft = 16;
  const padRight = 16 + fretLabelW;
  const padBottom = 12;
  const cellW = (totalW - padLeft - padRight) / (strings - 1);
  const cellH = cellW * 0.9;
  const height = padTop + numFrets * cellH + padBottom;

  const xs = Array.from({ length: strings }, (_, i) => padLeft + i * cellW);
  const ys = Array.from({ length: numFrets + 1 }, (_, i) => padTop + i * cellH);

  const dotR = cellW * 0.32;

  const lc = lineColor || 'currentColor';
  const cc = chordColor || 'var(--chord-color)';

  // Auto-detect barre: if >4 fretted dots and 2+ share the same fret,
  // draw a bar across them (use explicit barre if provided, otherwise detect)
  const effectiveBarre = (() => {
    if (barre) return barre;
    const fretted: { si: number; fret: number }[] = [];
    frets.forEach((f, si) => {
      if (typeof f === 'number' && f > 0) fretted.push({ si, fret: f });
    });
    if (fretted.length <= 4) return undefined;
    // Group by fret, find lowest fret with 2+ strings and no gaps (open/muted)
    const groups: Record<number, number[]> = {};
    for (const { si, fret: fr } of fretted) {
      if (!groups[fr]) groups[fr] = [];
      groups[fr].push(si);
    }
    // Sort by fret ascending (lowest first — most likely barre candidate)
    const sorted = Object.entries(groups)
      .filter(([, sis]) => sis.length >= 2)
      .sort((a, b) => Number(a[0]) - Number(b[0]));
    for (const [fretStr, sis] of sorted) {
      const fr = Number(fretStr);
      const from = Math.min(...sis);
      const to = Math.max(...sis);
      // Verify no open/muted strings between endpoints
      let valid = true;
      for (let i = from; i <= to; i++) {
        const v = frets[i];
        if (v === 'x' || v === 0) { valid = false; break; }
      }
      if (valid) {
        return { fret: fr, fromString: from + 1, toString: to + 1 };
      }
    }
    return undefined;
  })();

  return (
    <svg width={totalW} height={height} viewBox={`0 0 ${totalW} ${height}`}>
      {/* Chord name */}
      {!hideName && (
        <text x={totalW / 2} y={14} textAnchor="middle" fontSize={13} fontWeight="800" fill={nameColor || lc}>
          {name}
        </text>
      )}

      {/* Nut or base fret marker */}
      {baseFret === 1 ? (
        <rect x={padLeft - 1} y={padTop - 3} width={totalW - padLeft - padRight + 2} height={4} rx={2} fill={lc} opacity={0.6} />
      ) : (
        <text x={xs[strings - 1]! + Math.max(10, width * 0.08)} y={padTop + cellH * 0.5} textAnchor="start" dominantBaseline="central" fontSize={Math.min(16, Math.max(10, Math.round(width * 0.1)))} fontWeight="700" fill={lc} opacity={0.9}>
          {baseFret}
        </text>
      )}

      {/* Fret lines */}
      {ys.map((y, i) => (
        <line key={i} x1={padLeft} y1={y} x2={totalW - padRight} y2={y} stroke={lc} strokeWidth={0.5} opacity={0.3} />
      ))}

      {/* String lines */}
      {xs.map((x, i) => (
        <line key={i} x1={x} y1={padTop} x2={x} y2={padTop + numFrets * cellH} stroke={lc} strokeWidth={0.5} opacity={0.5} />
      ))}

      {/* Barre (explicit or auto-detected) */}
      {effectiveBarre && (
        <rect
          x={xs[effectiveBarre.fromString - 1]! - dotR}
          y={ys[effectiveBarre.fret - baseFret]! + cellH / 2 - dotR}
          width={xs[effectiveBarre.toString - 1]! - xs[effectiveBarre.fromString - 1]! + dotR * 2}
          height={dotR * 2}
          rx={dotR}
          fill={cc}
        />
      )}

      {/* Fret dots — skip strings covered by barre at the barre fret */}
      {frets.map((fret, si) => {
        const x = xs[si]!;
        const stringNum = strings - si;
        if (fret === null) return null;
        if (fret === 'x') {
          return (
            <g key={si}>
              <line x1={x - 5} y1={padTop - 14} x2={x + 5} y2={padTop - 4} stroke={lc} strokeWidth={1.5} opacity={0.6} />
              <line x1={x + 5} y1={padTop - 14} x2={x - 5} y2={padTop - 4} stroke={lc} strokeWidth={1.5} opacity={0.6} />
            </g>
          );
        }
        if (fret === 0) {
          return (
            <circle key={si} cx={x} cy={padTop - 9} r={4} fill="none" stroke={lc} strokeWidth={1.5} opacity={0.6} />
          );
        }
        // Skip dot if this string is covered by the barre at the same fret
        // barre.fromString/toString use 1-based index matching xs[] (1 = xs[0] = leftmost)
        const svgStringNum = si + 1;
        if (effectiveBarre && fret === effectiveBarre.fret && svgStringNum >= effectiveBarre.fromString && svgStringNum <= effectiveBarre.toString) {
          return null;
        }
        const fretIdx = fret - baseFret;
        if (fretIdx < 0 || fretIdx >= numFrets) return null;
        const y = ys[fretIdx]! + cellH / 2;
        return <circle key={si} cx={x} cy={y} r={dotR} fill={cc} />;
      })}
    </svg>
  );
});
