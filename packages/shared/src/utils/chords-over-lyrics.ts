// Accepted chord roots: English letter notation (A-G) plus Spanish / Italian
// solfège (Do, Re, Mi, Fa, Sol, La, Si) in either UPPERCASE or Title Case.
// Lowercase is left out on purpose so common words like "la", "si", "mi"
// aren't mistaken for chord roots inside lyrics.
// Multi-char solfège names come first so `DO` wins over `D`, `RE` over nothing
// ambiguous but kept for symmetry, `FA` over `F`, etc. The catch-all `[A-G]`
// matches plain English roots when no solfège prefix fits.
export const CHORD_ROOT = '(?:SOL|Sol|DO|Do|RE|Re|MI|Mi|FA|Fa|LA|La|SI|Si|[A-G])';
// Chord-name body: either empty OR starts with a character that marks the
// beginning of a real chord suffix (digit, #/b, slash, m/M for minor/major,
// s/a/d for sus/add/dim/aug, `(`, `+`, `°`) so plain-letter words like SOLA
// or SOLAMENTE don't get mistaken for chord extensions.
export const CHORD_BODY = '(?:[0-9#b/mMsad(+°][A-Za-z0-9#b/+°()]*)?';
const PLAIN_CHORD_LINE_RE = new RegExp(`^(${CHORD_ROOT}[#b]?${CHORD_BODY}[\\s\\-]+)*${CHORD_ROOT}[#b]?${CHORD_BODY}\\s*$`);
const CHORD_TOKEN_RE = new RegExp(`${CHORD_ROOT}[#b]?${CHORD_BODY}`, 'g');
const INLINE_CHORD_RE = new RegExp(`\\[${CHORD_ROOT}[#b]?${CHORD_BODY}\\]`);

export function isChordLine(line: string): boolean {
  const t = line.trim();
  return t.length > 0 && PLAIN_CHORD_LINE_RE.test(t);
}

/**
 * Heuristic: decide whether a block of song text looks like inline ChordPro
 * (has `[Chord]` markers) or the "chords above lyrics" form (standalone chord
 * lines). Returns `null` when no chord markers are detected at all.
 */
export function detectSongFormat(text: string): 'chordpro' | 'plaintext' | null {
  if (INLINE_CHORD_RE.test(text)) return 'chordpro';
  for (const line of text.split('\n')) {
    if (isChordLine(line)) return 'plaintext';
  }
  return null;
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
  // Strip ALIGNMENT PADDING: em-dash runs directly before a chord are
  // the dashes `chordProToChordsOverLyrics` inserted into the lyric to
  // keep a tightly-packed chord over its true syllable (same visual
  // convention the song view uses). They are layout, not lyrics —
  // removing them here restores the original text, so packed chords
  // like `[Ab]Ah[Cm]or[Bb7sus4]a.` round-trip with their positions
  // intact.
  return chars.join('').replace(/—+(?=\[)/g, '');
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
    let lyricOut = stripped;
    // Running count of characters inserted into `lyricOut` so far, so
    // later chords' lyric columns stay in step with the padded text.
    let shift = 0;
    for (const { chord, col: rawCol } of chords) {
      const col = rawCol + shift;
      // Place each chord at its lyric column when possible, but ALWAYS
      // keep at least one space between consecutive chords (adjacent
      // chords would otherwise mash into one unparseable token, e.g.
      // "BmG").
      const minStart = chordLine.length === 0 ? 0 : chordLine.length + 1;
      const start = Math.max(col, minStart);
      // When the chord had to be pushed RIGHT of its lyric column
      // (its name — plus the separating space — didn't fit), pad the
      // LYRIC at that column so the syllable moves back under the
      // chord: em-dashes for a mid-word split (the same convention the
      // song view renders), plain spaces at word boundaries. Without
      // this the pushed column silently became the chord's new
      // position on the way back, drifting tightly-packed chords
      // (`[Ab]Ah[Cm]or[Bb7sus4]a.` → "…Aho[?]ra."). The reverse
      // converter strips dash-padding that sits directly before a
      // chord, so the round trip is position-exact. Chords at/past
      // the end of the lyric need no padding — there's no syllable to
      // keep aligned.
      if (start > col && col < lyricOut.length) {
        const before = col > 0 ? lyricOut[col - 1]! : '';
        const at = lyricOut[col]!;
        const midWord = before !== '' && !/\s/.test(before) && !/\s/.test(at);
        const padStr = (midWord ? '—' : ' ').repeat(start - col);
        lyricOut = lyricOut.slice(0, col) + padStr + lyricOut.slice(col);
        shift += start - col;
      }
      chordLine += ' '.repeat(start - chordLine.length) + chord;
    }
    const stripped2 = lyricOut;
    out.push(chordLine);
    // Only emit the lyric line when there is actual lyric text. A
    // chord-only ChordPro line (e.g. "[C]" or an intro like
    // "[C] [G] [D]") has an empty `stripped`; pushing it added a
    // spurious blank line that the inverse preserved, so every
    // CP->over->CP toggle grew another newline and the editor saw the
    // song as modified (phantom unsaved change). chordsOnlyToInline
    // reconstructs a chord-only line from just the chord line, so the
    // empty lyric line is not needed for a lossless round trip.
    if (stripped2.trim() !== '') out.push(stripped2);
  }
  return out.join('\n');
}
