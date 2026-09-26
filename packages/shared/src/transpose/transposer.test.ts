import { transposeNote, transposeChord, transposeKey, transposeSong, getSoundingKey, getPlayingKey } from './transposer';
import { parseChordPro } from '../parser/chordpro-parser';

// ---------------------------------------------------------------------------
// transposeNote
// ---------------------------------------------------------------------------

describe('transposeNote', () => {
  it('transposes C up 2 semitones to D (sharps)', () => {
    expect(transposeNote('C', 2, false)).toBe('D');
  });

  it('transposes C up 2 semitones to D (flats)', () => {
    expect(transposeNote('C', 2, true)).toBe('D');
  });

  it('transposes C up 1 semitone — sharp vs flat', () => {
    expect(transposeNote('C', 1, false)).toBe('C#');
    expect(transposeNote('C', 1, true)).toBe('Db');
  });

  it('transposes G up 3 semitones to A#/Bb', () => {
    expect(transposeNote('G', 3, false)).toBe('A#');
    expect(transposeNote('G', 3, true)).toBe('Bb');
  });

  it('wraps around at B → C', () => {
    expect(transposeNote('B', 1, false)).toBe('C');
  });

  it('transposes down (negative semitones)', () => {
    expect(transposeNote('D', -2, false)).toBe('C');
  });

  it('handles large negative transpose wrapping', () => {
    expect(transposeNote('C', -1, false)).toBe('B');
  });

  it('returns same note for 0 semitones', () => {
    expect(transposeNote('E', 0, false)).toBe('E');
  });

  it('transposes full octave returns same note', () => {
    expect(transposeNote('A', 12, false)).toBe('A');
  });

  it('handles flat input notes', () => {
    expect(transposeNote('Bb', 2, true)).toBe('C');
  });

  it('handles sharp input notes', () => {
    expect(transposeNote('F#', 1, false)).toBe('G');
  });

  it('returns unknown note as-is', () => {
    expect(transposeNote('X', 3, false)).toBe('X');
  });
});

// ---------------------------------------------------------------------------
// transposeChord
// ---------------------------------------------------------------------------

describe('transposeChord', () => {
  it('returns same chord for 0 semitones', () => {
    expect(transposeChord('Am7', 0, false)).toBe('Am7');
  });

  it('transposes simple chord', () => {
    expect(transposeChord('G', 2, false)).toBe('A');
  });

  it('transposes chord with quality', () => {
    expect(transposeChord('Am', 3, false)).toBe('Cm');
  });

  it('transposes 7th chords', () => {
    expect(transposeChord('G7', 2, false)).toBe('A7');
  });

  it('transposes complex quality', () => {
    expect(transposeChord('Cmaj7', 4, false)).toBe('Emaj7');
  });

  it('transposes chord with bass note', () => {
    expect(transposeChord('G/B', 2, false)).toBe('A/C#');
  });

  it('transposes chord with bass note using flats', () => {
    expect(transposeChord('G/B', 2, true)).toBe('A/Db');
  });

  it('transposes diminished chord', () => {
    expect(transposeChord('Bdim', 1, false)).toBe('Cdim');
  });

  it('transposes sus chord', () => {
    expect(transposeChord('Dsus4', 2, false)).toBe('Esus4');
  });

  it('returns invalid chord as-is', () => {
    expect(transposeChord('N.C.', 2, false)).toBe('N.C.');
  });
});

// ---------------------------------------------------------------------------
// transposeKey
// ---------------------------------------------------------------------------

describe('transposeKey', () => {
  it('returns same key for 0 semitones', () => {
    expect(transposeKey('G', 0)).toBe('G');
  });

  it('returns empty string as-is', () => {
    expect(transposeKey('', 3)).toBe('');
  });

  it('transposes major key up', () => {
    expect(transposeKey('C', 2)).toBe('D');
  });

  it('transposes to flat key when appropriate', () => {
    // F is a flat key, so transpose from E up 1 → F
    expect(transposeKey('E', 1)).toBe('F');
  });

  it('uses flats when result key is in FLAT_KEYS', () => {
    // Dm is in FLAT_KEYS, so transposing Cm up 2 → Dm (flat result checked)
    expect(transposeKey('Cm', 2)).toBe('Dm');
  });

  it('transposes minor key preserving suffix', () => {
    expect(transposeKey('Am', 3)).toBe('Cm');
  });

  it('transposes down', () => {
    expect(transposeKey('D', -2)).toBe('C');
  });

  it('wraps around', () => {
    expect(transposeKey('B', 1)).toBe('C');
  });

  it('full octave returns same', () => {
    expect(transposeKey('G', 12)).toBe('G');
  });
});

// ---------------------------------------------------------------------------
// transposeSong
// ---------------------------------------------------------------------------

describe('transposeSong', () => {
  it('keeps chord names unchanged at 0 semitones', () => {
    const parsed = parseChordPro('[G]Hello');
    const result = transposeSong(parsed, 0);
    const chord = result.lines[0]!.tokens.find((t) => t.type === 'chord')!;
    expect(chord).toEqual(expect.objectContaining({ chord: 'G' }));
  });

  it('respells chords at 0 semitones based on preferFlats', () => {
    const parsed = parseChordPro('[A#]Hello');
    // With preferFlats=true the enharmonic Bb spelling is used.
    const result = transposeSong(parsed, 0, true);
    const chord = result.lines[0]!.tokens.find((t) => t.type === 'chord')!;
    expect(chord).toEqual(expect.objectContaining({ chord: 'Bb' }));
  });

  it('transposes all chords in the song', () => {
    const parsed = parseChordPro('[G]Hello [C]World');
    const result = transposeSong(parsed, 2);
    const chords = result.lines[0]!.tokens.filter((t) => t.type === 'chord');
    expect(chords[0]!).toEqual(expect.objectContaining({ chord: 'A' }));
    expect(chords[1]!).toEqual(expect.objectContaining({ chord: 'D' }));
  });

  it('transposes metadata key', () => {
    const parsed = parseChordPro('{key: G}\n[G]Hello');
    const result = transposeSong(parsed, 2);
    expect(result.metadata.key).toBe('A');
  });

  it('preserves lyrics while transposing chords', () => {
    const parsed = parseChordPro('[G]Amazing [C]Grace');
    const result = transposeSong(parsed, 2);
    const lyrics = result.lines[0]!.tokens.filter((t) => t.type === 'lyric');
    expect(lyrics[0]!).toEqual(expect.objectContaining({ text: 'Amazing ' }));
    expect(lyrics[1]!).toEqual(expect.objectContaining({ text: 'Grace' }));
  });

  it('transposes chords inside chord grids', () => {
    const input = `{sog}
| D . . . | G . . . |
{eog}`;
    const parsed = parseChordPro(input);
    const result = transposeSong(parsed, 2);
    const gridLine = result.lines.find((l) => l.isChordGrid)!;
    const grid = gridLine.tokens[0] as import('../types/parser.types').ChordGridToken;
    expect(grid.rows[0]!.bars[0]!.beats[0]!.chord).toBe('E');
    expect(grid.rows[0]!.bars[1]!.beats[0]!.chord).toBe('A');
  });

  it('uses preferFlats override', () => {
    const parsed = parseChordPro('[A]Hello');
    const result = transposeSong(parsed, 1, true);
    const chord = result.lines[0]!.tokens.find((t) => t.type === 'chord')!;
    expect(chord).toEqual(expect.objectContaining({ chord: 'Bb' }));
  });

  it('auto-detects flats from song key', () => {
    const parsed = parseChordPro('{key: F}\n[A]Hello');
    // F is a flat key → should prefer flats
    const result = transposeSong(parsed, 1);
    // Line 0 is the directive, line 1 has the chord
    const chord = result.lines[1]!.tokens.find((t) => t.type === 'chord')!;
    expect(chord).toEqual(expect.objectContaining({ chord: 'Bb' }));
  });

  it('handles bass notes in transposed chords', () => {
    const parsed = parseChordPro('[G/B]Hello');
    const result = transposeSong(parsed, 2);
    const chord = result.lines[0]!.tokens[0]!;
    expect(chord).toEqual(expect.objectContaining({ chord: 'A/C#', bass: 'C#' }));
  });
});

// ---------------------------------------------------------------------------
// getSoundingKey / getPlayingKey
// ---------------------------------------------------------------------------

describe('getSoundingKey / getPlayingKey', () => {
  it('getSoundingKey: capo 2, playing C shapes → sounds D', () => {
    expect(getSoundingKey('C', 2)).toBe('D');
  });

  it('getPlayingKey: sounding D, capo 2 → plays C shapes', () => {
    expect(getPlayingKey('D', 2)).toBe('C');
  });

  it('round-trips correctly', () => {
    const playing = 'G';
    const capo = 3;
    const sounding = getSoundingKey(playing, capo);
    expect(getPlayingKey(sounding, capo)).toBe(playing);
  });

  it('capo 0 returns same key', () => {
    expect(getSoundingKey('A', 0)).toBe('A');
    expect(getPlayingKey('A', 0)).toBe('A');
  });
});

describe('transposeChordProContent', () => {
  const { transposeChordProContent } = require('./transposer');

  it('transposes inline chord markers and preserves formatting', () => {
    const src = '{title: X}\n\n[C]Hola  [G/B]mundo [Am7]ya\nsin acordes';
    expect(transposeChordProContent(src, 2, false)).toBe(
      '{title: X}\n\n[D]Hola  [A/C#]mundo [Bm7]ya\nsin acordes');
  });

  it('transposes the {key:} directive', () => {
    expect(transposeChordProContent('{key: Eb}\n[Eb]la', 1, false)).toBe('{key: E}\n[E]la');
  });

  it('transposes chord-grid rows and leaves dots/repeats alone', () => {
    const src = '{sog}\n|: C . . | G7 . :| x3\n{eog}\n[C]after';
    expect(transposeChordProContent(src, 2, false)).toBe(
      '{sog}\n|: D . . | A7 . :| x3\n{eog}\n[D]after');
  });

  it('leaves non-chord bracket tokens and directives untouched', () => {
    const src = '{pause: 3}\n# comment [C]\n[??]odd [C]ok';
    expect(transposeChordProContent(src, 2, false)).toBe(
      '{pause: 3}\n# comment [C]\n[??]odd [D]ok');
  });

  it('uses flat spelling when asked', () => {
    expect(transposeChordProContent('[A]x', 1, true)).toBe('[Bb]x');
  });
});

describe('slash-chord accidental respelling (Auto mode)', () => {
  const { transposeChord: tc } = require('./transposer');

  it('respells the bass to match the key side at 0 semitones', () => {
    expect(tc('D/Gb', 0, false)).toBe('D/F#');
    expect(tc('A/Db', 0, false)).toBe('A/C#');
    expect(tc('F/A#', 0, true)).toBe('F/Bb');
  });

  it('normalizes white-key enharmonic basses and roots', () => {
    expect(tc('D/Cb', 0, false)).toBe('D/B');
    expect(tc('Cb', 0, false)).toBe('B');
    expect(tc('E#m', 0, false)).toBe('Fm');
    expect(tc('G/B#', 0, true)).toBe('G/C');
  });

  it('transposes such spellings correctly too', () => {
    expect(tc('Cb', 2, false)).toBe('C#');
    expect(tc('D/E#', 2, false)).toBe('E/G');
  });
});
