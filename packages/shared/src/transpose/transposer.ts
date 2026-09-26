import { SHARPS, FLATS, FLAT_KEYS, SHARP_KEYS } from '../constants/chord-names';
import type { ParsedSong, ChordToken, ChordGridToken, DirectiveToken } from '../types/parser.types';

const CHORD_ROOT_RE = /^([A-G][#b]?)(.*)/;

// White-key enharmonics missing from the SHARPS/FLATS tables. Rare
// but valid spellings (Cb major exists); without this, a note like
// the Cb in "D/Cb" would bypass respelling/transposition entirely.
const WHITE_KEY_ENHARMONICS: Record<string, string> = {
  'Cb': 'B', 'Fb': 'E', 'E#': 'F', 'B#': 'C',
};

function noteIndex(note: string): number {
  const n = WHITE_KEY_ENHARMONICS[note] ?? note;
  const si = SHARPS.indexOf(n as (typeof SHARPS)[number]);
  if (si !== -1) return si;
  const fi = FLATS.indexOf(n as (typeof FLATS)[number]);
  return fi;
}

export function transposeNote(note: string, semitones: number, preferFlats: boolean): string {
  const idx = noteIndex(note);
  if (idx === -1) return note;
  const newIdx = ((idx + semitones) % 12 + 12) % 12;
  return preferFlats ? FLATS[newIdx]! : SHARPS[newIdx]!;
}

export function transposeChord(chord: string, semitones: number, preferFlats: boolean): string {
  // Note: we intentionally do NOT early-return on semitones === 0 so that
  // chord spellings are normalised to match `preferFlats` (e.g. Bb vs A#)
  // even when no transposition is happening.
  const slashIdx = chord.lastIndexOf('/');
  let main = chord;
  let bass: string | undefined;

  if (slashIdx > 0) {
    main = chord.slice(0, slashIdx);
    bass = chord.slice(slashIdx + 1).trim();
  }

  const match = CHORD_ROOT_RE.exec(main);
  if (!match) return chord;

  const root = match[1]!;
  const quality = match[2] ?? '';
  const newRoot = transposeNote(root, semitones, preferFlats);
  const newBass = bass ? transposeNote(bass, semitones, preferFlats) : undefined;

  return newBass ? `${newRoot}${quality}/${newBass}` : `${newRoot}${quality}`;
}

export function transposeKey(key: string, semitones: number): string {
  if (!key || semitones === 0) return key;

  // Detect minor suffix
  const isMinor = key.endsWith('m') && key.length > 1;
  const root = isMinor ? key.slice(0, -1) : key;
  const idx = noteIndex(root);
  if (idx === -1) return key;

  const newIdx = ((idx + semitones) % 12 + 12) % 12;
  const suffix = isMinor ? 'm' : '';
  const sharpKey = SHARPS[newIdx]! + suffix;
  const flatKey = FLATS[newIdx]! + suffix;

  // Circle-of-fifths spelling:
  // 1. If the flat spelling is a recognized flat-side key → use it (Bb, Eb, Ab, Db, Gb, F, …).
  // 2. Else if the sharp spelling is a recognized sharp-side key → use it (G, D, A, E, B, F#, C#, …).
  // 3. Else fall through to the sharp spelling (naturals like C/D/E/G/A/B).
  if (FLAT_KEYS.has(flatKey)) return flatKey;
  if (SHARP_KEYS.has(sharpKey)) return sharpKey;
  return sharpKey;
}

/**
 * Per-line flats/sharps decision based on section-level key detection.
 *
 * Rules (per section):
 *   1. If the section contains an explicit `{key: X}` directive, transpose
 *      that key by `semitones` and pick flats vs sharps from the resulting
 *      key's position on the circle of fifths.
 *   2. Otherwise inherit the caller-supplied `fallback` (typically the
 *      transposed song-level key's preference).
 *
 * This supports modulations: drop a `{key: F}` at the start of a section that
 * modulates to F, and that section will render with flats while the rest of
 * the song follows its home-key preference.
 */
export function computeSectionFlats(
  parsedSong: ParsedSong,
  semitones: number,
  fallback: boolean,
): boolean[] {
  const n = parsedSong.lines.length;
  const result: boolean[] = new Array(n).fill(fallback);
  if (n === 0) return result;

  type Range = { start: number; end: number; explicitKey?: string };
  const ranges: Range[] = [];
  let cur: Range | null = null;
  const close = (endIdx: number) => {
    if (cur) { cur.end = endIdx; ranges.push(cur); cur = null; }
  };

  parsedSong.lines.forEach((line, i) => {
    if (line.isSection) {
      close(i - 1);
      cur = { start: i, end: i };
      return;
    }
    if (line.isSectionEnd) {
      close(i);
      return;
    }
    for (const token of line.tokens) {
      if (token.type === 'directive') {
        const d = token as DirectiveToken;
        if ((d.name === 'key' || d.name === 'k') && d.value && cur) {
          cur.explicitKey = d.value;
        }
      }
    }
  });
  close(n - 1);

  for (const r of ranges) {
    if (!r.explicitKey) continue;
    const transposed = transposeKey(r.explicitKey, semitones);
    let useFlats: boolean;
    if (FLAT_KEYS.has(transposed)) useFlats = true;
    else if (SHARP_KEYS.has(transposed)) useFlats = false;
    else useFlats = fallback;
    for (let i = r.start; i <= r.end && i < n; i++) result[i] = useFlats;
  }
  return result;
}

export function transposeSong(
  parsedSong: ParsedSong,
  semitones: number,
  preferFlats?: boolean | ((lineIdx: number) => boolean),
): ParsedSong {
  // No early return on semitones === 0 — we still re-spell each chord so
  // accidentals match the song's key (e.g. a song in F renders as "Bb",
  // not "A#", even at rest).

  const songDefault = parsedSong.metadata.key ? FLAT_KEYS.has(parsedSong.metadata.key) : false;
  const resolver: (lineIdx: number) => boolean =
    typeof preferFlats === 'function' ? preferFlats
    : typeof preferFlats === 'boolean' ? (() => preferFlats)
    : (() => songDefault);

  const newLines = parsedSong.lines.map((line, lineIdx) => {
    const useFlats = resolver(lineIdx);
    return {
    ...line,
    tokens: line.tokens.map((token) => {
      if (token.type === 'chord') {
        const chordToken = token as ChordToken;
        const newChord = transposeChord(chordToken.chord, semitones, useFlats);
        const slashIdx = newChord.lastIndexOf('/');
        const main = slashIdx > 0 ? newChord.slice(0, slashIdx) : newChord;
        const bass = slashIdx > 0 ? newChord.slice(slashIdx + 1) : undefined;
        const match = /^([A-G][#b]?)(.*)/.exec(main);
        return {
          type: 'chord' as const,
          chord: newChord,
          root: match ? match[1]! : newChord,
          quality: match ? (match[2] ?? '') : '',
          bass,
        } as ChordToken;
      }
      if (token.type === 'chord-grid') {
        const gridToken = token as ChordGridToken;
        return {
          ...gridToken,
          rows: gridToken.rows.map((row) => ({
            ...row,
            bars: row.bars.map((bar) => ({
              ...bar,
              beats: bar.beats.map((beat) =>
                beat.chord
                  ? { chord: transposeChord(beat.chord, semitones, useFlats) }
                  : {}
              ),
            })),
          })),
        } as ChordGridToken;
      }
      return token;
    }),
    };
  });

  const newKey = parsedSong.metadata.key
    ? transposeKey(parsedSong.metadata.key, semitones)
    : undefined;

  return {
    ...parsedSong,
    metadata: { ...parsedSong.metadata, key: newKey },
    lines: newLines,
  };
}

export function getSoundingKey(playingKey: string, capo: number): string {
  return transposeKey(playingKey, capo);
}

export function getPlayingKey(soundingKey: string, capo: number): string {
  return transposeKey(soundingKey, -capo);
}

/**
 * Transpose a song's RAW ChordPro content by `semitones`, preserving
 * every byte of formatting except the musical tokens themselves:
 *
 *   • `[Chord]` markers in lyric lines,
 *   • bare chord names inside `{sog}…{eog}` chord-grid rows,
 *   • the `{key: X}` / `{k: X}` metadata directive.
 *
 * Everything else — directives, comments, whitespace, lyrics — is
 * untouched. Used by "save transposed version": the current transpose
 * offset gets baked into the stored content so it becomes the song's
 * real key.
 */
export function transposeChordProContent(content: string, semitones: number, preferFlats: boolean): string {
  const KEY_DIRECTIVE_RE = /^(\s*\{(?:key|k)\s*:\s*)([^}]*?)(\s*\}\s*)$/i;
  const lines = content.split('\n');
  let inGrid = false;
  const out = lines.map((line) => {
    const trimmed = line.trim();
    // Chord-grid block tracking ({sog} … {eog}).
    if (/^\{sog\s*\}$/i.test(trimmed)) { inGrid = true; return line; }
    if (/^\{eog\s*\}$/i.test(trimmed)) { inGrid = false; return line; }
    if (inGrid) {
      // Grid rows: `| C . . | Am7 . |` — transpose tokens that start
      // with a note letter; dots, barlines and `xN` repeats pass through.
      return line.replace(/[A-G][#b]?[^\s|]*/g, (tok) => transposeChord(tok, semitones, preferFlats));
    }
    // {key:} directive.
    const keyMatch = KEY_DIRECTIVE_RE.exec(line);
    if (keyMatch) {
      return keyMatch[1]! + transposeChord(keyMatch[2]!.trim(), semitones, preferFlats) + keyMatch[3]!;
    }
    // Other directives and # comments carry no chords.
    if (trimmed.startsWith('{') || trimmed.startsWith('#')) return line;
    // Lyric lines: transpose inline [Chord] markers only.
    return line.replace(/\[([^\]\n]+)\]/g, (whole, inner: string) =>
      /^[A-G]/.test(inner.trim()) ? `[${transposeChord(inner.trim(), semitones, preferFlats)}]` : whole);
  });
  return out.join('\n');
}
