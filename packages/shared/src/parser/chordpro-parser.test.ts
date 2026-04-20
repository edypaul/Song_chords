import { parseChordPro, parsePlainText } from './chordpro-parser';
import type { ChordToken, LyricToken, DirectiveToken, SectionToken, CommentToken, ChordGridToken } from '../types/parser.types';

// ---------------------------------------------------------------------------
// parseChordPro
// ---------------------------------------------------------------------------

describe('parseChordPro', () => {
  // --- Metadata directives ---------------------------------------------------

  it('extracts title from {title:} directive', () => {
    const result = parseChordPro('{title: Amazing Grace}');
    expect(result.metadata.title).toBe('Amazing Grace');
  });

  it('extracts title from shorthand {t:}', () => {
    const result = parseChordPro('{t: Amazing Grace}');
    expect(result.metadata.title).toBe('Amazing Grace');
  });

  it('extracts artist from {artist:} directive', () => {
    const result = parseChordPro('{artist: John Newton}');
    expect(result.metadata.artist).toBe('John Newton');
  });

  it('extracts key from {key:} directive', () => {
    const result = parseChordPro('{key: G}');
    expect(result.metadata.key).toBe('G');
  });

  it('parses tempo as integer', () => {
    const result = parseChordPro('{tempo: 120}');
    expect(result.metadata.tempo).toBe(120);
  });

  it('parses capo as integer', () => {
    const result = parseChordPro('{capo: 3}');
    expect(result.metadata.capo).toBe(3);
  });

  it('extracts time signature', () => {
    const result = parseChordPro('{time: 3/4}');
    expect(result.metadata.timeSig).toBe('3/4');
  });

  it('extracts multiple metadata directives', () => {
    const input = `{title: My Song}
{artist: Me}
{key: Am}
{tempo: 90}
{capo: 2}`;
    const result = parseChordPro(input);
    expect(result.metadata).toEqual(expect.objectContaining({
      title: 'My Song',
      artist: 'Me',
      key: 'Am',
      tempo: 90,
      capo: 2,
    }));
  });

  // --- Inline chords ---------------------------------------------------------

  it('parses inline chords in lyrics', () => {
    const result = parseChordPro('[G]Amazing [C]Grace');
    const line = result.lines[0]!;
    expect(line.hasChords).toBe(true);
    expect(line.tokens).toHaveLength(4);

    const chord1 = line.tokens[0] as ChordToken;
    expect(chord1.type).toBe('chord');
    expect(chord1.chord).toBe('G');
    expect(chord1.root).toBe('G');
    expect(chord1.quality).toBe('');

    const lyric1 = line.tokens[1] as LyricToken;
    expect(lyric1.type).toBe('lyric');
    expect(lyric1.text).toBe('Amazing ');

    const chord2 = line.tokens[2] as ChordToken;
    expect(chord2.chord).toBe('C');

    const lyric2 = line.tokens[3] as LyricToken;
    expect(lyric2.text).toBe('Grace');
  });

  it('handles chords with quality and bass note', () => {
    const result = parseChordPro('[Am7/G]Walk with me');
    const chord = result.lines[0]!.tokens[0] as ChordToken;
    expect(chord.root).toBe('A');
    expect(chord.quality).toBe('m7');
    expect(chord.bass).toBe('G');
  });

  it('handles sharp and flat roots', () => {
    const result = parseChordPro('[F#m]hello [Bb]world');
    const chord1 = result.lines[0]!.tokens[0] as ChordToken;
    expect(chord1.root).toBe('F#');
    expect(chord1.quality).toBe('m');

    const chord2 = result.lines[0]!.tokens[2] as ChordToken;
    expect(chord2.root).toBe('Bb');
    expect(chord2.quality).toBe('');
  });

  it('treats unclosed bracket as literal text', () => {
    const result = parseChordPro('This [is broken');
    const tokens = result.lines[0]!.tokens;
    expect(tokens).toHaveLength(1);
    expect((tokens[0] as LyricToken).text).toBe('This [is broken');
  });

  // --- Sections --------------------------------------------------------------

  it('parses section start directives', () => {
    const result = parseChordPro('{verse}');
    const line = result.lines[0]!;
    expect(line.isSection).toBe(true);
    expect(line.sectionType).toBe('verse');
  });

  it('parses chorus section with label', () => {
    const result = parseChordPro('{chorus: Chorus 2}');
    const line = result.lines[0]!;
    expect(line.isSection).toBe(true);
    expect(line.sectionType).toBe('chorus');
    expect(line.sectionLabel).toBe('Chorus 2');
  });

  it('parses section shorthand {v} as verse', () => {
    const result = parseChordPro('{v}');
    expect(result.lines[0]!.sectionType).toBe('verse');
  });

  it('treats {c: text} as a comment, not chorus', () => {
    const result = parseChordPro('{c: Repeat 2x}');
    const line = result.lines[0]!;
    expect(line.isComment).toBe(true);
    expect(line.isSection).toBe(false);
    const token = line.tokens[0] as CommentToken;
    expect(token.text).toBe('Repeat 2x');
  });

  it('treats bare {c} as chorus section', () => {
    const result = parseChordPro('{c}');
    expect(result.lines[0]!.isSection).toBe(true);
    expect(result.lines[0]!.sectionType).toBe('chorus');
  });

  it('parses end-of-section directives', () => {
    const result = parseChordPro('{eoc}');
    const line = result.lines[0]!;
    expect(line.isSectionEnd).toBe(true);
    expect(line.sectionType).toBe('chorus');
  });

  it('parses all section types', () => {
    // pre-chorus uses {prechorus} (no hyphen) in the directive name
    const sectionMap: [string, string][] = [
      ['verse', 'verse'], ['chorus', 'chorus'], ['bridge', 'bridge'],
      ['prechorus', 'pre-chorus'], ['intro', 'intro'], ['outro', 'outro'],
      ['tag', 'tag'], ['interlude', 'interlude'],
    ];
    for (const [directive, expected] of sectionMap) {
      const result = parseChordPro(`{${directive}}`);
      expect(result.lines[0]!.sectionType).toBe(expected);
    }
  });

  // --- Comments --------------------------------------------------------------

  it('parses # comment lines', () => {
    const result = parseChordPro('# This is a comment');
    const line = result.lines[0]!;
    expect(line.isComment).toBe(true);
    const token = line.tokens[0] as CommentToken;
    expect(token.text).toBe('This is a comment');
  });

  it('parses {comment:} directive', () => {
    const result = parseChordPro('{comment: Play softly}');
    const line = result.lines[0]!;
    expect(line.isComment).toBe(true);
    const token = line.tokens[0] as CommentToken;
    expect(token.text).toBe('Play softly');
  });

  // --- Empty lines -----------------------------------------------------------

  it('handles empty lines', () => {
    const result = parseChordPro('line1\n\nline2');
    expect(result.lines).toHaveLength(3);
    expect(result.lines[1]!.isEmpty).toBe(true);
  });

  // --- Chord grid blocks -----------------------------------------------------

  it('parses chord grid {sog}...{eog}', () => {
    const input = `{sog}
| D . . . | G . . . |
| A . . . | D . . . |
{eog}`;
    const result = parseChordPro(input);
    const gridLine = result.lines.find((l) => l.isChordGrid);
    expect(gridLine).toBeDefined();

    const gridToken = gridLine!.tokens[0] as ChordGridToken;
    expect(gridToken.type).toBe('chord-grid');
    expect(gridToken.rows).toHaveLength(2);
    expect(gridToken.rows[0]!.bars).toHaveLength(2);
    expect(gridToken.rows[0]!.bars[0]!.beats[0]!.chord).toBe('D');
    expect(gridToken.rows[0]!.bars[1]!.beats[0]!.chord).toBe('G');
  });

  it('parses repeat markers in chord grids', () => {
    const input = `{sog}
|: D . . . | G . . . :|
{eog}`;
    const result = parseChordPro(input);
    const gridToken = result.lines.find((l) => l.isChordGrid)!.tokens[0] as ChordGridToken;
    const row = gridToken.rows[0]!;
    expect(row.startRepeat).toBe(true);
    expect(row.endRepeat).toBe(true);
  });

  it('parses repeat count in chord grids', () => {
    const input = `{sog}
| D . . . | G . . . | x3
{eog}`;
    const result = parseChordPro(input);
    const gridToken = result.lines.find((l) => l.isChordGrid)!.tokens[0] as ChordGridToken;
    expect(gridToken.rows[0]!.repeatCount).toBe(3);
  });

  it('parses multiple chords in one bar', () => {
    const input = `{sog}
| Bm . . G . |
{eog}`;
    const result = parseChordPro(input);
    const gridToken = result.lines.find((l) => l.isChordGrid)!.tokens[0] as ChordGridToken;
    const bar = gridToken.rows[0]!.bars[0]!;
    expect(bar.beats[0]!.chord).toBe('Bm');
    expect(bar.beats[3]!.chord).toBe('G');
  });

  it('ignores blank lines inside grid blocks', () => {
    const input = `{sog}
| D . . . |

| G . . . |
{eog}`;
    const result = parseChordPro(input);
    const gridToken = result.lines.find((l) => l.isChordGrid)!.tokens[0] as ChordGridToken;
    expect(gridToken.rows).toHaveLength(2);
  });

  // --- Unknown directives ----------------------------------------------------

  it('emits unknown directives as directive tokens', () => {
    const result = parseChordPro('{custom_directive: value}');
    const line = result.lines[0]!;
    expect(line.isDirective).toBe(true);
    const token = line.tokens[0] as DirectiveToken;
    expect(token.name).toBe('custom_directive');
    expect(token.value).toBe('value');
  });

  // --- rawContent preservation -----------------------------------------------

  it('preserves rawContent', () => {
    const input = '{title: Test}\n[G]Hello';
    const result = parseChordPro(input);
    expect(result.rawContent).toBe(input);
  });

  // --- Full song integration test --------------------------------------------

  it('parses a complete song correctly', () => {
    const input = `{title: Amazing Grace}
{artist: John Newton}
{key: G}
{tempo: 80}

{verse}
[G]Amazing [G7]grace, how [C]sweet the [G]sound
That [G]saved a [Em]wretch like [D]me

{chorus}
[G]I once was [G7]lost, but [C]now am [G]found
Was [G]blind but [D]now I [G]see`;

    const result = parseChordPro(input);
    expect(result.metadata.title).toBe('Amazing Grace');
    expect(result.metadata.artist).toBe('John Newton');
    expect(result.metadata.key).toBe('G');
    expect(result.metadata.tempo).toBe(80);

    const sections = result.lines.filter((l) => l.isSection);
    expect(sections).toHaveLength(2);
    expect(sections[0]!.sectionType).toBe('verse');
    expect(sections[1]!.sectionType).toBe('chorus');

    const chordLines = result.lines.filter((l) => l.hasChords);
    expect(chordLines.length).toBeGreaterThanOrEqual(4);
  });
});

// ---------------------------------------------------------------------------
// parsePlainText
// ---------------------------------------------------------------------------

describe('parsePlainText', () => {
  it('detects chord-only lines and pairs with next lyric', () => {
    const input = `G    C    D
Amazing Grace how sweet`;
    const result = parsePlainText(input);
    // Should merge into a single line with chords
    const chordLine = result.lines.find((l) => l.hasChords);
    expect(chordLine).toBeDefined();
    const chords = chordLine!.tokens.filter((t) => t.type === 'chord') as ChordToken[];
    expect(chords.map((c) => c.chord)).toEqual(['G', 'C', 'D']);
  });

  it('handles plain lyric lines without chords', () => {
    const input = 'Just a normal lyric line';
    const result = parsePlainText(input);
    expect(result.lines[0]!.hasChords).toBe(false);
    expect((result.lines[0]!.tokens[0] as LyricToken).text).toBe('Just a normal lyric line');
  });

  it('handles empty lines', () => {
    const result = parsePlainText('line1\n\nline2');
    expect(result.lines[1]!.isEmpty).toBe(true);
  });

  it('handles consecutive chord lines', () => {
    const input = `Am  F  C  G
Am  F  C  G`;
    const result = parsePlainText(input);
    const chordLines = result.lines.filter((l) => l.hasChords);
    expect(chordLines).toHaveLength(2);
  });

  it('handles chord lines with dashes as separators', () => {
    const input = 'G - C - D';
    const result = parsePlainText(input);
    const chordLine = result.lines.find((l) => l.hasChords);
    expect(chordLine).toBeDefined();
    const chords = chordLine!.tokens.filter((t) => t.type === 'chord') as ChordToken[];
    expect(chords.map((c) => c.chord)).toEqual(['G', 'C', 'D']);
  });

  it('handles complex chord names in plain text', () => {
    const input = 'Am7 F#m Bb Dm';
    const result = parsePlainText(input);
    const chordLine = result.lines.find((l) => l.hasChords);
    expect(chordLine).toBeDefined();
    const chords = chordLine!.tokens.filter((t) => t.type === 'chord') as ChordToken[];
    expect(chords.map((c) => c.chord)).toEqual(['Am7', 'F#m', 'Bb', 'Dm']);
  });

  it('preserves rawContent', () => {
    const input = 'G  C\nHello world';
    expect(parsePlainText(input).rawContent).toBe(input);
  });
});
