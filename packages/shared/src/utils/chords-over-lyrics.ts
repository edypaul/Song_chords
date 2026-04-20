const PLAIN_CHORD_LINE_RE = /^([A-G][#b]?[A-Za-z0-9/]*[\s\-]+)*[A-G][#b]?[A-Za-z0-9/]*\s*$/;
const CHORD_TOKEN_RE = /[A-G][#b]?[A-Za-z0-9/]*/g;

function isChordLine(line: string): boolean {
  const t = line.trim();
  return t.length > 0 && PLAIN_CHORD_LINE_RE.test(t);
}

function findChordPositions(line: string): { chord: string; col: number }[] {
  const out: { chord: string; col: number }[] = [];
  for (const m of line.matchAll(CHORD_TOKEN_RE)) {
    if (m.index !== undefined) out.push({ chord: m[0], col: m.index });
  }
  return out;
}

function mergeChordsIntoLyric(chordLine: string, lyricLine: string): string {
  const chords = findChordPositions(chordLine);
  if (chords.length === 0) return lyricLine;

  const maxCol = chords[chords.length - 1]!.col;
  let lyric = lyricLine;
  if (lyric.length < maxCol) lyric = lyric + ' '.repeat(maxCol - lyric.length);

  const chars: string[] = [...lyric];
  for (let i = chords.length - 1; i >= 0; i--) {
    const { chord, col } = chords[i]!;
    chars.splice(col, 0, `[${chord}]`);
  }
  return chars.join('');
}

function chordsOnlyToInline(chordLine: string): string {
  const chords = findChordPositions(chordLine);
  let out = '';
  let cursor = 0;
  for (const { chord, col } of chords) {
    if (col > cursor) out += ' '.repeat(col - cursor);
    out += `[${chord}]`;
    cursor = col + chord.length;
  }
  return out;
}

/**
 * Convert "chords above lyrics" plain-text format into inline ChordPro.
 * Lines that aren't chord lines (directives, section headers, plain lyrics,
 * blanks) pass through unchanged.
 */
export function chordsOverLyricsToChordPro(input: string): string {
  const lines = input.split('\n');
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (!isChordLine(line)) {
      out.push(line);
      i++;
      continue;
    }
    const next = lines[i + 1] ?? '';
    if (next && !isChordLine(next) && next.trim() !== '') {
      out.push(mergeChordsIntoLyric(line, next));
      i += 2;
    } else {
      out.push(chordsOnlyToInline(line));
      i++;
    }
  }
  return out.join('\n');
}

/**
 * Inverse of `chordsOverLyricsToChordPro`: splits each inline-chord line into
 * a chord line (names at their column positions) followed by the bare lyric
 * line.
 */
export function chordProToChordsOverLyrics(input: string): string {
  const out: string[] = [];
  for (const line of input.split('\n')) {
    if (!line.includes('[')) {
      out.push(line);
      continue;
    }
    let stripped = '';
    const chords: { chord: string; col: number }[] = [];
    let i = 0;
    while (i < line.length) {
      if (line[i] === '[') {
        const end = line.indexOf(']', i);
        if (end === -1) { stripped += line.slice(i); break; }
        const chord = line.slice(i + 1, end);
        if (chord) chords.push({ chord, col: stripped.length });
        i = end + 1;
      } else {
        stripped += line[i]!;
        i++;
      }
    }
    if (chords.length === 0) { out.push(stripped); continue; }
    let chordLine = '';
    for (const { chord, col } of chords) {
      if (col >= chordLine.length) {
        chordLine += ' '.repeat(col - chordLine.length) + chord;
      } else {
        chordLine += ' ' + chord;
      }
    }
    out.push(chordLine);
    out.push(stripped);
  }
  return out.join('\n');
}
