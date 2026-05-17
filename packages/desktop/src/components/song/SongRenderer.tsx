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
  lines: ParsedLine[];
}

/** Group a flat line array into bordered (chorus) and plain segments. */
function groupLines(lines: ParsedLine[]): LineGroup[] {
  const groups: LineGroup[] = [];
  let current: ParsedLine[] = [];
  let inBordered = false;

  for (const line of lines) {
    if (line.isSection) {
      // Any section start closes the current group (prevents border bleeding into
      // subsequent sections when {eoc} is omitted).
      if (current.length) groups.push({ bordered: inBordered, lines: current });
      current = [line];
      inBordered = !!(line.sectionType && BORDERED_SECTIONS.has(line.sectionType));
    } else if (line.isSectionEnd && inBordered) {
      groups.push({ bordered: true, lines: current });
      current = [];
      inBordered = false;
    } else {
      current.push(line);
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
            {group.lines.map((line, li) => (
              <RenderLine key={li} line={line} fontSize={lyricsFontSize} viewMode={viewMode} onChordClick={onChordClick} svs={svs} showInline={showInline} instrument={instrument} chordVariations={chordVariations} />
            ))}
          </div>
        ) : (
          group.lines.map((line, li) => (
            <RenderLine key={`${gi}-${li}`} line={line} fontSize={lyricsFontSize} viewMode={viewMode} onChordClick={onChordClick} svs={svs} showInline={showInline} instrument={instrument} chordVariations={chordVariations} />
          ))
        )
      )}
    </div>
  );
}

const RenderLine = memo(function RenderLine({
  line,
  fontSize,
  viewMode,
  onChordClick,
  svs,
  showInline,
  instrument,
  chordVariations,
}: {
  line: ParsedLine;
  fontSize: number;
  viewMode: 'chords' | 'lyrics-only' | 'chords-only';
  showInline?: boolean;
  instrument?: 'guitar' | 'ukulele';
  chordVariations?: Record<string, number>;
  onChordClick?: (chord: string) => void;
  svs: SongViewStyle;
}): React.ReactElement | null {
  if (line.isChordGrid) {
    if (viewMode === 'lyrics-only') return null;
    const token = line.tokens[0] as ChordGridToken;
    return <ChordGrid token={token} fontSize={fontSize} chordColor={svs.chords.color} onChordClick={onChordClick} />;
  }

  if (line.isEmpty) {
    return <div className="h-4" />;
  }

  if (line.isSection) {
    const token = line.tokens[0];
    const label = token?.type === 'section' ? token.label : undefined;
    if (!label) return null;
    const ss = svs.section;
    return (
      <div className="mt-2 mb-0.5" data-section-heading={label}>
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
    return <div style={{ lineHeight: 1.4 }}>{lyrics}</div>;
  }

  if (!line.hasChords && viewMode === 'chords-only') {
    return null;
  }

  if (line.hasChords) {
    return <ChordLine line={line} onChordClick={onChordClick} showChords={viewMode !== 'lyrics-only'} chordStyle={svs.chords}
      inlineDiagrams={showInline} instrument={instrument} svs={svs} chordVariations={chordVariations} />;
  }

  const text = line.tokens.map((t) => (t as { text?: string }).text ?? '').join('');
  // Same tight line-height for non-chord lyric lines (or pure text
  // lines) so they don't inflate the visual gap above the next
  // chord-line's diagram.
  return <div style={{ lineHeight: 1.4 }}>{text || ' '}</div>;
});

