/**
 * Per-line list of chord tokens with their column position in the
 * *lyric-only* version of the line (i.e. after stripping [brackets]).
 */
export type ChordPattern = { chord: string; col: number }[][];

/**
 * Extract a chord pattern from text that uses inline ChordPro markers.
 * One entry per source line. Empty arrays are preserved so lines align 1:1
 * with the source when the pattern is later applied.
 */
export function extractChordPattern(text: string): ChordPattern {
  return text.split('\n').map((line) => {
    const out: { chord: string; col: number }[] = [];
    let stripped = '';
    let i = 0;
    while (i < line.length) {
      if (line[i] === '[') {
        const end = line.indexOf(']', i);
        if (end === -1) { stripped += line.slice(i); break; }
        const chord = line.slice(i + 1, end);
        if (chord) out.push({ chord, col: stripped.length });
        i = end + 1;
      } else {
        stripped += line[i]!;
        i++;
      }
    }
    return out;
  });
}

/** True when the pattern has at least one chord anywhere. */
export function patternHasChords(pattern: ChordPattern): boolean {
  return pattern.some((l) => l.length > 0);
}

/**
 * Apply a chord pattern to plain-lyric text, matching lines 1:1 with the
 * pattern. Any existing [chord] markers on the target line are stripped
 * first so the result only carries chords from the pattern. If a target
 * line is shorter than the pattern's furthest chord column, it's padded
 * with spaces so the chord still lands at the intended position.
 */
export function applyChordPattern(pattern: ChordPattern, text: string): string {
  const lines = text.split('\n');
  return lines.map((line, idx) => {
    const pat = pattern[idx];
    if (!pat || pat.length === 0) return line;
    const stripped = line.replace(/\[[^\]]+\]/g, '');
    const maxCol = pat[pat.length - 1]!.col;
    const base = stripped.length < maxCol
      ? stripped + ' '.repeat(maxCol - stripped.length)
      : stripped;
    const chars: string[] = [...base];
    for (let i = pat.length - 1; i >= 0; i--) {
      const { chord, col } = pat[i]!;
      chars.splice(col, 0, `[${chord}]`);
    }
    return chars.join('');
  }).join('\n');
}
