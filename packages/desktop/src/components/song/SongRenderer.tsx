import React, { useMemo, memo } from 'react';
import type { ParsedSong, ParsedLine, ChordGridToken, SectionType, SongViewStyle } from '@song-chords/shared';
import { useSettingsStore } from '@song-chords/shared';
import ChordLine from './ChordLine';
import ChordGrid from './ChordGrid';

interface Props {
  song: ParsedSong;
  fontSize: number;
  viewMode: 'chords' | 'lyrics-only' | 'chords-only';
  onChordClick?: (chord: string) => void;
  chordVariations?: Record<string, number>;
}

// Section types that get a left border
const BORDERED_SECTIONS = new Set<SectionType>(['chorus']);

interface LineGroup {
  bordered: boolean;
  lines: Array<{ line: ParsedLine; sectionIndex: number; lineIndex: number }>;
}

/** Group a flat line array into bordered (chorus) and plain segments,
 *  and stamp each line with its (sectionIndex, lineIndex) so the
 *  annotation layer can anchor shapes to a specific rendered line.
 *
 *  sectionIndex is the 0-based index of the enclosing section heading
 *  in the parsed song. lineIndex is the 0-based position of the line
 *  WITHIN that section (0 = the heading itself, 1 = the first line
 *  after it, …). For songs with no section headings, sectionIndex = -1
 *  and lineIndex counts from the top of the song.
 *
 *  These indices are DERIVED FROM THE SOURCE PARSE (not from render
 *  order) so they're stable across view-mode changes: a line that
 *  renders `null` in "lyrics-only" mode still occupies its lineIndex
 *  slot, and switching modes doesn't reshuffle the anchoring. */
function groupLines(lines: ParsedLine[]): LineGroup[] {
  const groups: LineGroup[] = [];
  let current: LineGroup['lines'] = [];
  let inBordered = false;
  let sectionIndex = -1;
  let lineIndexInSection = 0;

  for (const line of lines) {
    if (line.isSection) {
      if (current.length) groups.push({ bordered: inBordered, lines: current });
      sectionIndex += 1;
      lineIndexInSection = 0;
      current = [{ line, sectionIndex, lineIndex: lineIndexInSection }];
      lineIndexInSection += 1;
      inBordered = !!(line.sectionType && BORDERED_SECTIONS.has(line.sectionType));
    } else if (line.isSectionEnd && inBordered) {
      groups.push({ bordered: true, lines: current });
      current = [];
      inBordered = false;
    } else {
      current.push({ line, sectionIndex, lineIndex: lineIndexInSection });
      lineIndexInSection += 1;
    }
  }

  if (current.length) groups.push({ bordered: inBordered, lines: current });
  return groups;
}

export default function SongRenderer({ song, fontSize, viewMode, onChordClick, chordVariations }: Props): React.ReactElement {
  const groups = useMemo(() => groupLines(song.lines), [song.lines]);
  const svs = useSettingsStore((s) => s.settings.songViewStyle);
  const inlineDiagramsRaw = useSettingsStore((s) => s.settings.inlineChordDiagrams ?? false);
  const instrument = useSettingsStore((s) => s.settings.defaultInstrument);
  // Piano keyboards don't fit cleanly inline above lyric syllables, so
  // inline diagrams are disabled for piano regardless of the stored setting.
  const inlineDiagrams = inlineDiagramsRaw && instrument !== 'piano';
  const lyricsFontSize = svs.lyrics.fontSize || 16;
  const showInline = inlineDiagrams && viewMode !== 'lyrics-only';

  return (
    <div style={{
      fontSize: `${lyricsFontSize}px`,
      lineHeight: 1.8,
      fontFamily: svs.fontFamily || 'sans-serif',
      color: svs.lyrics.color || undefined,
    }}>
      {groups.map((group, gi) =>
        group.bordered ? (
          <div
            key={gi}
            style={{
              borderLeft: `3px solid ${svs.chorusBorderColor || 'var(--chord-color)'}`,
              paddingLeft: '14px',
              marginLeft: '2px',
              marginTop: '4px',
              marginBottom: '4px',
            }}
          >
            {group.lines.map((entry, li) => (
              <RenderLine key={li} line={entry.line} sectionIndex={entry.sectionIndex} lineIndex={entry.lineIndex} fontSize={lyricsFontSize} viewMode={viewMode} onChordClick={onChordClick} svs={svs} showInline={showInline} instrument={instrument} chordVariations={chordVariations} />
            ))}
          </div>
        ) : (
          group.lines.map((entry, li) => (
            <RenderLine key={`${gi}-${li}`} line={entry.line} sectionIndex={entry.sectionIndex} lineIndex={entry.lineIndex} fontSize={lyricsFontSize} viewMode={viewMode} onChordClick={onChordClick} svs={svs} showInline={showInline} instrument={instrument} chordVariations={chordVariations} />
          ))
        )
      )}
    </div>
  );
}

const RenderLine = memo(function RenderLine({
  line,
  sectionIndex,
  lineIndex,
  fontSize,
  viewMode,
  onChordClick,
  svs,
  showInline,
  instrument,
  chordVariations,
}: {
  line: ParsedLine;
  /** Section index within the parsed song (-1 for songs with no
   *  section headings). Used by the annotation layer to anchor
   *  shapes to a specific rendered line. */
  sectionIndex: number;
  /** Line index within the enclosing section (0 = the heading itself,
   *  1 = first content line after it, …). Stable across view-mode
   *  changes because it's derived from the source parse. */
  lineIndex: number;
  fontSize: number;
  viewMode: 'chords' | 'lyrics-only' | 'chords-only';
  showInline?: boolean;
  instrument?: 'guitar' | 'ukulele';
  chordVariations?: Record<string, number>;
  onChordClick?: (chord: string) => void;
  svs: SongViewStyle;
}): React.ReactElement | null {
  // Every rendered line gets a stable annotation anchor via these
  // data attributes. The draw / render code walks the DOM for
  // `[data-annot-line]` elements and matches on the (section,line)
  // pair. Empty lines and directives ALSO get the attributes so a
  // user drawing on white space anchors to the nearest actual DOM
  // node instead of falling through to the section heading.
  const annotAttrs = {
    'data-annot-line': '',
    'data-annot-section': String(sectionIndex),
    'data-annot-line-index': String(lineIndex),
  } as Record<string, string>;
  if (line.isChordGrid) {
    if (viewMode === 'lyrics-only') return null;
    const token = line.tokens[0] as ChordGridToken;
    // Wrap so the annotation anchor sits on a stable DOM element.
    // ChordGrid renders its own inner container; the wrapper adds no
    // layout impact but gives annotations a reliable target.
    return (
      <div {...annotAttrs}>
        <ChordGrid token={token} fontSize={fontSize} chordColor={svs.chords.color} onChordClick={onChordClick} />
      </div>
    );
  }

  if (line.isEmpty) {
    return <div className="h-4" {...annotAttrs} />;
  }

  if (line.isSection) {
    const token = line.tokens[0];
    const label = token?.type === 'section' ? token.label : undefined;
    if (!label) return null;
    const ss = svs.section;
    return (
      <div className="mt-2 mb-0.5" data-section-heading={label} {...annotAttrs}>
        <span
          style={{
            display: 'inline-block',
            background: ss.background || 'var(--accent)',
            color: ss.color || 'white',
            fontWeight: 700,
            fontSize: ss.fontSize ? `${ss.fontSize}px` : '0.82em',
            letterSpacing: '0.06em',
            textTransform: svs.sectionUppercase ? 'uppercase' : 'none',
            padding: '2px 4px',
            borderRadius: '3px',
          }}
        >
          {label}
        </span>
      </div>
    );
  }

  if (line.isComment) {
    const token = line.tokens[0];
    const text = token?.type === 'comment' ? token.text : '';
    const ss = svs.section;
    return (
      <div
        {...annotAttrs}
        style={{
          display: 'inline-block',
          background: ss.background || 'var(--accent)',
          color: ss.color || 'white',
          fontFamily: 'inherit',
          fontWeight: 700,
          fontSize: ss.fontSize ? `${ss.fontSize}px` : '0.82em',
          letterSpacing: '0.06em',
          textTransform: svs.sectionUppercase ? 'uppercase' : 'none',
          padding: '2px 8px',
          borderRadius: '4px',
          margin: '6px 0 3px',
        }}
      >
        {text}
      </div>
    );
  }

  if (line.isDirective) {
    // {pause: N} renders as a centred pill chip carrying the seconds value
    // via `data-pause`. The auto-scroll hook scans for these markers and
    // pauses for that many seconds when the chip's top edge reaches the
    // top of the visible scroll container.
    const tok = line.tokens[0];
    if (tok?.type === 'directive' && tok.name === 'pause') {
      const seconds = Number(tok.value) || 0;
      if (seconds <= 0) return null;
      return (
        <div
          {...annotAttrs}
          data-pause={seconds}
          className="flex items-center gap-3 my-3 select-none"
          style={{
            color: 'color-mix(in srgb, var(--accent) 70%, transparent)',
            fontSize: '0.7rem',
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
          }}
          title={`Auto-scroll pauses here for ${seconds}s`}
        >
          <div
            style={{
              flex: 1,
              height: '1px',
              background: 'color-mix(in srgb, var(--accent) 30%, transparent)',
            }}
          />
          <span className="font-medium tabular-nums">Pause {seconds}s</span>
          <div
            style={{
              flex: 1,
              height: '1px',
              background: 'color-mix(in srgb, var(--accent) 30%, transparent)',
            }}
          />
        </div>
      );
    }
    return null;
  }

  if (line.hasChords && viewMode === 'lyrics-only') {
    const lyrics = line.tokens.filter((t) => t.type === 'lyric').map((t) => (t as { text: string }).text).join('');
    // line-height: 1.4 keeps successive lyric lines tight (no
    // inflated half-leading), which makes the chord-line diagrams
    // visually centered between the surrounding lyrics.
    return <div {...annotAttrs} style={{ lineHeight: 1.4 }}>{lyrics}</div>;
  }

  if (!line.hasChords && viewMode === 'chords-only') {
    return null;
  }

  if (line.hasChords) {
    // Wrap ChordLine so annotations can anchor to it too. ChordLine
    // has its own internal layout; a bare div wrapper adds no visual
    // side effect.
    return (
      <div {...annotAttrs}>
        <ChordLine line={line} onChordClick={onChordClick} showChords={viewMode !== 'lyrics-only'} chordStyle={svs.chords}
          inlineDiagrams={showInline} instrument={instrument} svs={svs} chordVariations={chordVariations} />
      </div>
    );
  }

  const text = line.tokens.map((t) => (t as { text?: string }).text ?? '').join('');
  // Same tight line-height for non-chord lyric lines (or pure text
  // lines) so they don't inflate the visual gap above the next
  // chord-line's diagram.
  return <div {...annotAttrs} style={{ lineHeight: 1.4 }}>{text || ' '}</div>;
});

