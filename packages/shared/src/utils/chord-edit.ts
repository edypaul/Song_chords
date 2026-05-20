// Chord-aware editing helpers for the song body editor:
//   - bulkReplaceChord: rename every occurrence of one chord to another
//   - tokenizeChordSpans: locate chord tokens for syntax highlighting
//
// Both are format-aware (inline ChordPro `[D]` AND chords-over-lyrics
// standalone chord lines) and reuse the SAME chord grammar as the rest
// of the app (CHORD_ROOT / CHORD_BODY / isChordLine) so what counts as
// a "chord" is consistent everywhere — the editor highlight, the
// find/replace, and the format converters never disagree.

import { CHORD_ROOT, CHORD_BODY, isChordLine } from './chords-over-lyrics';

// ChordPro directive line, e.g. `{sog}`, `{eog}`, `{start_of_grid}`.
// Mirrors the parser's DIRECTIVE_RE so "what opens/closes a grid" is
// decided identically here and in chordpro-parser.ts.
const DIRECTIVE_RE = /^\{([\w-]+)(?:[:\s]+(.*?))?\s*\}$/;
function directiveName(line: string): string | null {
  const m = DIRECTIVE_RE.exec(line.trim());
  return m ? (m[1] ?? '').toLowerCase() : null;
}
const GRID_OPEN = new Set(['sog', 'start_of_grid']);
const GRID_CLOSE = new Set(['eog', 'end_of_grid']);

// A whole chord token, anchored so we can test an exact match.
const CHORD_EXACT_RE = new RegExp(`^${CHORD_ROOT}[#b]?${CHORD_BODY}$`);
// Global matcher for scanning a line for chord tokens.
function chordTokenRe(): RegExp {
  return new RegExp(`${CHORD_ROOT}[#b]?${CHORD_BODY}`, 'g');
}

/** True when `s` is exactly one valid chord name (no surrounding text). */
export function isValidChordName(s: string): boolean {
  return CHORD_EXACT_RE.test(s.trim());
}

export interface ChordSpan {
  /** Absolute start index in the full text. */
  start: number;
  /** Absolute end index (exclusive). */
  end: number;
  /** The chord text (without brackets). */
  chord: string;
}

/**
 * Find every chord token in `text`, with absolute offsets, handling:
 *   - inline ChordPro: the chord inside each `[...]` (offsets cover the
 *     chord text only, not the brackets)
 *   - chords-over-lyrics: every chord on a line that `isChordLine`
 *     classifies as a pure chord line (so chords are never matched
 *     inside lyrics — "Down to the river" is left alone)
 *   - chord-GRID blocks: every chord on any line between `{sog}` and
 *     `{eog}` (e.g. `| D . . . | Bm . . G . |`). Grid rows are NOT
 *     plain chord lines (the `|` bars and `.` beats make `isChordLine`
 *     reject them), so without this they were invisible to the editor
 *     highlight and untouchable by find/replace. The `|`/`.`
 *     separators aren't chord-shaped, so the chord regex skips them
 *     just like it skips whitespace on a normal chord line.
 *
 * Used by the editor's highlight overlay and the bulk-replace.
 */
export function tokenizeChordSpans(text: string): ChordSpan[] {
  const spans: ChordSpan[] = [];

  // Pass 1: inline [Chord] tokens anywhere in the text.
  const inlineRe = new RegExp(`\\[(${CHORD_ROOT}[#b]?${CHORD_BODY})\\]`, 'g');
  let m: RegExpExecArray | null;
  while ((m = inlineRe.exec(text)) !== null) {
    const chordStart = m.index + 1; // skip '['
    spans.push({ start: chordStart, end: chordStart + m[1]!.length, chord: m[1]! });
  }

  // Pass 2: standalone chord lines (chords-over-lyrics) AND chord-grid
  // rows. Walk lines tracking {sog}…{eog} state. Inside a grid block
  // every non-directive line is scanned for chord tokens; outside it
  // only a *pure chord line* is, so lyric lines (even with a word like
  // "Amen") are still skipped. Lines with an inline bracket are
  // handled by Pass 1, not here.
  let offset = 0;
  let inGrid = false;
  for (const line of text.split('\n')) {
    const dir = directiveName(line);
    if (dir !== null) {
      if (GRID_OPEN.has(dir)) inGrid = true;
      else if (GRID_CLOSE.has(dir)) inGrid = false;
      // Directive lines themselves never contain playable chords.
      offset += line.length + 1;
      continue;
    }
    const scan = !line.includes('[') && (inGrid || isChordLine(line));
    if (scan) {
      const re = chordTokenRe();
      let cm: RegExpExecArray | null;
      while ((cm = re.exec(line)) !== null) {
        spans.push({
          start: offset + cm.index,
          end: offset + cm.index + cm[0].length,
          chord: cm[0],
        });
      }
    }
    offset += line.length + 1; // +1 for the '\n'
  }

  // Sort by position; de-dupe exact overlaps (a token can't be matched
  // by both passes, but stay defensive).
  spans.sort((a, b) => a.start - b.start || a.end - b.end);
  const out: ChordSpan[] = [];
  let lastEnd = -1;
  for (const s of spans) {
    if (s.start >= lastEnd) {
      out.push(s);
      lastEnd = s.end;
    }
  }
  return out;
}

export interface BulkReplaceResult {
  text: string;
  /** How many chord occurrences were replaced. */
  count: number;
}

/**
 * Rename every occurrence of the chord `from` to `to` across the song
 * body, in BOTH formats, WITHOUT touching lyrics.
 *
 * Matching is exact-token: replacing "D" changes `[D]` and a standalone
 * `D` on a chord line, but never the "D" in `[Dm]`, in `[D/F#]`'s
 * sub-parts, or the letter D inside the lyric word "Down". Whole-chord
 * only — to retune a bass note the user edits it directly.
 *
 * `from` / `to` are validated by the caller (isValidChordName); this
 * function still no-ops if `from` isn't a valid single chord.
 */
export function bulkReplaceChord(text: string, from: string, to: string): BulkReplaceResult {
  const fromTrim = from.trim();
  const toTrim = to.trim();
  if (!isValidChordName(fromTrim) || fromTrim === toTrim) {
    return { text, count: 0 };
  }

  const spans = tokenizeChordSpans(text);
  let count = 0;
  // Rebuild the string, replacing only spans whose chord === from.
  let out = '';
  let cursor = 0;
  for (const s of spans) {
    if (s.chord !== fromTrim) continue;
    out += text.slice(cursor, s.start) + toTrim;
    cursor = s.end;
    count++;
  }
  out += text.slice(cursor);
  return { text: out, count };
}

/** Distinct chord names present in the text (sorted, both formats). */
export function uniqueChordNames(text: string): string[] {
  const set = new Set<string>();
  for (const s of tokenizeChordSpans(text)) set.add(s.chord);
  return [...set].sort();
}
