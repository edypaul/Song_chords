import type {
  ParsedSong,
  ParsedLine,
  Token,
  ChordToken,
  LyricToken,
  DirectiveToken,
  SectionToken,
  CommentToken,
  SectionType,
  ChordGridBeat,
  ChordGridBar,
  ChordGridRow,
  ChordGridToken,
} from '../types/parser.types';
import type { SongMetadata } from '../types/song.types';

const CHORD_ROOT_RE = /^([A-G][#b]?)(.*)/;
const DIRECTIVE_RE = /^\{(\w+)(?::\s*(.*))?\}$/;
const SECTION_DIRECTIVES: Record<string, SectionType> = {
  verse: 'verse', v: 'verse', sov: 'verse',
  chorus: 'chorus', c: 'chorus', soc: 'chorus',
  bridge: 'bridge',
  'pre-chorus': 'pre-chorus', prechorus: 'pre-chorus',
  intro: 'intro',
  outro: 'outro',
  tag: 'tag',
  interlude: 'interlude',
};
const END_SECTION_MAP: Partial<Record<string, SectionType>> = {
  eoc: 'chorus', end_of_chorus: 'chorus',
  eov: 'verse',  end_of_verse: 'verse',
  end_of_bridge: 'bridge',
};
const METADATA_DIRECTIVES = new Set([
  'title', 't',
  'artist', 'a', 'subtitle', 'st',
  'album',
  'key', 'k',
  'tempo', 'metronome', 'bpm',
  'capo',
  'time',
  'duration', 'length',
  'copyright', 'ccli',
]);

function parseChordString(raw: string): Pick<ChordToken, 'chord' | 'root' | 'quality' | 'bass'> {
  const chord = raw.trim();
  const slashIdx = chord.lastIndexOf('/');

  let mainPart = chord;
  let bass: string | undefined;

  if (slashIdx > 0) {
    mainPart = chord.slice(0, slashIdx);
    bass = chord.slice(slashIdx + 1).trim();
  }

  const match = CHORD_ROOT_RE.exec(mainPart);
  if (!match) {
    return { chord, root: chord, quality: '' };
  }

  return {
    chord,
    root: match[1]!,
    quality: match[2] ?? '',
    bass,
  };
}

function tokenizeInlineLine(line: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  let lyricBuf = '';

  while (i < line.length) {
    if (line[i] === '[') {
      const closeIdx = line.indexOf(']', i);
      if (closeIdx === -1) {
        lyricBuf += line[i++];
        continue;
      }
      if (lyricBuf) {
        tokens.push({ type: 'lyric', text: lyricBuf } as LyricToken);
        lyricBuf = '';
      }
      const rawChord = line.slice(i + 1, closeIdx);
      tokens.push({ type: 'chord', ...parseChordString(rawChord) } as ChordToken);
      i = closeIdx + 1;
    } else {
      lyricBuf += line[i++];
    }
  }

  if (lyricBuf) {
    tokens.push({ type: 'lyric', text: lyricBuf } as LyricToken);
  }

  return tokens;
}

function directiveNameToMetadataKey(name: string): keyof SongMetadata | null {
  const map: Record<string, keyof SongMetadata> = {
    title: 'title', t: 'title',
    // Many ChordPro exports use {subtitle:} for the artist.
    artist: 'artist', a: 'artist', subtitle: 'artist', st: 'artist',
    album: 'album',
    key: 'key', k: 'key',
    // Accept {metronome:} as an alias for tempo.
    tempo: 'tempo', metronome: 'tempo', bpm: 'tempo',
    capo: 'capo',
    time: 'timeSig',
    duration: 'duration', length: 'duration',
    copyright: 'copyright',
    ccli: 'ccli',
  };
  return map[name] ?? null;
}

/**
 * Parse one row of a chord grid: `| D . . . | Bm . . G . |`
 * Each token between barlines is either a chord name (starts with A-G) or a beat dot.
 * Multiple chords can appear within one bar: `| Bm . . G . |` → beats 1=Bm, 3=G.
 * Supports repeat barlines: `|: ... :|` and repeat count suffix `| ... | x3`.
 * Returns null if the line contains no valid bars.
 */
function parseGridRow(line: string): ChordGridRow | null {
  const bars: ChordGridBar[] = [];

  const startRepeat = /^\s*\|:/.test(line);
  const endRepeat   = /:\|/.test(line);
  const repeatCountMatch = /\|\s*x(\d+)\s*$/.exec(line);
  const repeatCount = repeatCountMatch ? parseInt(repeatCountMatch[1]!, 10) : undefined;

  // Normalise: strip |: and :| markers, strip trailing xN token
  const normalised = line
    .replace(/^\s*\|:/, '|')
    .replace(/:\|/, '|')
    .replace(/\|\s*x\d+\s*$/, '|');

  const cells = normalised.split('|').map((s) => s.trim()).filter(Boolean);
  for (const cell of cells) {
    const parts = cell.split(/\s+/).filter(Boolean);
    if (parts.length === 0) continue;
    // Bar must contain at least one chord token
    if (!parts.some((p) => /^[A-G]/.test(p))) continue;
    const beats: ChordGridBeat[] = parts.map((p) =>
      /^[A-G]/.test(p) ? { chord: p } : {}
    );
    bars.push({ beats });
  }

  if (bars.length === 0) return null;
  return {
    bars,
    ...(startRepeat  && { startRepeat }),
    ...(endRepeat    && { endRepeat }),
    ...(repeatCount !== undefined && { repeatCount }),
  };
}

export function parseChordPro(rawContent: string): ParsedSong {
  const metadata: SongMetadata = {};
  const lines: ParsedLine[] = [];
  const rawLines = rawContent.split('\n');
  let gridRows: ChordGridRow[] | null = null; // non-null while inside a {sog}…{eog} block

  for (const rawLine of rawLines) {
    const trimmed = rawLine.trim();

    // Empty line
    if (trimmed === '') {
      // Inside a chord grid block, blank lines are ignored
      if (gridRows === null) {
        lines.push({ tokens: [], hasChords: false, isDirective: false, isSection: false, isComment: false, isEmpty: true });
      }
      continue;
    }

    // Chord grid content line (inside {sog}…{eog})
    if (gridRows !== null) {
      // Check for the closing directive first
      const closeMatch = DIRECTIVE_RE.exec(trimmed);
      if (closeMatch && (closeMatch[1] ?? '').toLowerCase() === 'eog') {
        const gridToken: ChordGridToken = { type: 'chord-grid', rows: gridRows };
        lines.push({
          tokens: [gridToken],
          hasChords: false,
          isDirective: false,
          isSection: false,
          isComment: false,
          isEmpty: false,
          isChordGrid: true,
        });
        gridRows = null;
        continue;
      }
      // Otherwise parse as a grid row
      const row = parseGridRow(trimmed);
      if (row) gridRows.push(row);
      continue;
    }

    // Comment line starting with #
    if (trimmed.startsWith('#')) {
      const commentToken: CommentToken = { type: 'comment', text: trimmed.slice(1).trim() };
      lines.push({ tokens: [commentToken], hasChords: false, isDirective: false, isSection: false, isComment: true, isEmpty: false });
      continue;
    }

    // Directive line
    const dirMatch = DIRECTIVE_RE.exec(trimmed);
    if (dirMatch) {
      const name = (dirMatch[1] ?? '').toLowerCase();
      const value = dirMatch[2]?.trim();

      // Start of chord grid block
      if (name === 'sog') {
        gridRows = [];
        continue;
      }

      // End-of-section directives → emit a marker so renderers can close the section border
      if (END_SECTION_MAP[name]) {
        lines.push({
          tokens: [],
          hasChords: false,
          isDirective: true,
          isSection: false,
          isComment: false,
          isEmpty: false,
          isSectionEnd: true,
          sectionType: END_SECTION_MAP[name],
        });
        continue;
      }

      // Section-start directive.
      // Special case: {c: text} with a value is the comment shorthand, not a chorus start.
      // Only treat {c} (bare, no value) as a chorus section marker.
      if (SECTION_DIRECTIVES[name] && !(name === 'c' && value !== undefined)) {
        const sectionType = SECTION_DIRECTIVES[name]!;
        const sectionToken: SectionToken = { type: 'section', sectionType, label: value };
        lines.push({
          tokens: [sectionToken],
          hasChords: false,
          isDirective: true,
          isSection: true,
          isComment: false,
          isEmpty: false,
          sectionType,
          sectionLabel: value,
        });
        continue;
      }

      // Comment directive → render as italic comment
      if (name === 'comment' || name === 'c') {
        const commentToken: CommentToken = { type: 'comment', text: value ?? '' };
        lines.push({ tokens: [commentToken], hasChords: false, isDirective: true, isSection: false, isComment: true, isEmpty: false });
        continue;
      }

      // Metadata directive
      if (METADATA_DIRECTIVES.has(name)) {
        const metaKey = directiveNameToMetadataKey(name);
        if (metaKey && value !== undefined) {
          if (metaKey === 'tempo' || metaKey === 'capo') {
            (metadata as Record<string, unknown>)[metaKey] = parseInt(value, 10);
          } else {
            (metadata as Record<string, unknown>)[metaKey] = value;
          }
        }
        const dirToken: DirectiveToken = { type: 'directive', name, value };
        lines.push({ tokens: [dirToken], hasChords: false, isDirective: true, isSection: false, isComment: false, isEmpty: false });
        continue;
      }

      // Unknown directive — still emit as directive token
      const dirToken: DirectiveToken = { type: 'directive', name, value };
      lines.push({ tokens: [dirToken], hasChords: false, isDirective: true, isSection: false, isComment: false, isEmpty: false });
      continue;
    }

    // Inline chord+lyric line
    const tokens = tokenizeInlineLine(rawLine);
    const hasChords = tokens.some((t) => t.type === 'chord');
    lines.push({ tokens, hasChords, isDirective: false, isSection: false, isComment: false, isEmpty: false });
  }

  return { metadata, lines, rawContent };
}

export function parsePlainText(rawContent: string): ParsedSong {
  const metadata: SongMetadata = {};
  const lines: ParsedLine[] = [];
  const rawLines = rawContent.split('\n');

  // Plain text heuristic: if a line consists only of chord names separated by spaces/dashes,
  // treat it as a chord-only line and pair it with the next lyric line.
  const PLAIN_CHORD_RE = /^([A-G][#b]?[a-z0-9/]*[\s\-]+)*[A-G][#b]?[a-z0-9/]*\s*$/;

  let i = 0;
  while (i < rawLines.length) {
    const line = rawLines[i]!;
    const trimmed = line.trim();

    if (trimmed === '') {
      lines.push({ tokens: [], hasChords: false, isDirective: false, isSection: false, isComment: false, isEmpty: true });
      i++;
      continue;
    }

    if (PLAIN_CHORD_RE.test(trimmed)) {
      // Convert this chord line into inline ChordPro-style tokens by pairing with next lyric line
      const nextLine = rawLines[i + 1] ?? '';
      const chordNames = trimmed.split(/[\s\-]+/).filter(Boolean);

      const tokens: Token[] = chordNames.flatMap((ch) => {
        const chordTok: ChordToken = { type: 'chord', ...parseChordString(ch) };
        const lyricTok: LyricToken = { type: 'lyric', text: ' ' };
        return [chordTok, lyricTok];
      });

      // If next line isn't another chord line, absorb it
      if (nextLine.trim() && !PLAIN_CHORD_RE.test(nextLine.trim())) {
        tokens.push({ type: 'lyric', text: nextLine });
        i++;
      }

      lines.push({ tokens, hasChords: true, isDirective: false, isSection: false, isComment: false, isEmpty: false });
    } else {
      const lyricTok: LyricToken = { type: 'lyric', text: line };
      lines.push({ tokens: [lyricTok], hasChords: false, isDirective: false, isSection: false, isComment: false, isEmpty: false });
    }

    i++;
  }

  return { metadata, lines, rawContent };
}
