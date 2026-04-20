import type { Song, ParsedSong, ParsedLine, SongViewStyle } from '@song-chords/shared';
import {
  exportToChordPro, parseChordPro, parsePlainText, transposeKey, transposeSong,
  computeSectionFlats, FLAT_KEYS, SHARP_KEYS,
} from '@song-chords/shared';
import { toTitleCase } from './text';

export type ExportFormat = 'pdf' | 'chordpro' | 'plaintext' | 'html' | 'json';

/** Four mutually-exclusive chord presentations supported in HTML / PDF. */
export type ExportLayout = 'chords' | 'chords-with-bar' | 'inline-diagrams' | 'lyrics-only';

export interface ExportOptions {
  layout: ExportLayout;
  style: SongViewStyle;
  /** Matches the song-view's "Center Song" setting — when true, the title
   *  block is center-aligned and the body is a fit-content column centered
   *  in the page. */
  songCentered?: boolean;
  /** Pre-rendered chord diagrams bar (SVG markup) to prepend to the body.
   *  Only honoured when layout === 'chords-with-bar'. */
  chordBarHtml?: string;
  /** Map of chord name → pre-rendered SVG markup. Used when layout is
   *  'inline-diagrams' to substitute each chord label with a small diagram. */
  inlineDiagrams?: Record<string, string>;
  /** Map of ParsedLine index → pre-rendered HTML for chord-grid blocks
   *  (produced by the modal via renderToStaticMarkup(<ChordGrid />)). */
  chordGrids?: Record<number, string>;
}

export const EXPORT_FORMATS: { id: ExportFormat; label: string; ext: string; mime: string; hint: string }[] = [
  { id: 'pdf',       label: 'PDF',        ext: 'pdf',      mime: 'application/pdf',   hint: 'Opens the print dialog — choose "Save as PDF" as the destination.' },
  { id: 'chordpro',  label: 'ChordPro',   ext: 'chordpro', mime: 'text/plain',        hint: 'Inline [chord] markers — re-importable by this app and most chord editors.' },
  { id: 'plaintext', label: 'Plain text', ext: 'txt',      mime: 'text/plain',        hint: 'Chords above lyrics, printable and universally readable.' },
  { id: 'html',      label: 'HTML',       ext: 'html',     mime: 'text/html',         hint: 'Standalone web page, styled to match the song view.' },
  { id: 'json',      label: 'JSON',       ext: 'json',     mime: 'application/json',  hint: 'Raw song record — handy for backups of a single song.' },
];

export const EXPORT_LAYOUTS: { id: ExportLayout; label: string; hint: string }[] = [
  { id: 'chords',           label: 'Chord names',          hint: 'Chord names above lyrics.' },
  { id: 'chords-with-bar',  label: 'Chord diagrams bar',   hint: 'Chord names above lyrics plus a diagrams strip at the top.' },
  { id: 'inline-diagrams',  label: 'Inline chord diagrams', hint: 'Small chord diagrams placed directly above the lyrics.' },
  { id: 'lyrics-only',      label: 'Lyrics only',           hint: 'No chords — just the lyrics.' },
];

function ensureParsed(song: Song): ParsedSong {
  return parseChordPro(song.content);
}

function resolveFlatsForKey(key: string | undefined, fallback: boolean): boolean {
  if (!key) return fallback;
  if (FLAT_KEYS.has(key)) return true;
  if (SHARP_KEYS.has(key)) return false;
  return fallback;
}

/**
 * Parses the song and applies transpose + capo so chord tokens match the
 * "played" key the user sees in the song view. `shapeSteps = transposeSteps -
 * capo` — the same formula the player store uses — because a capo raises the
 * sounding pitch but lowers the chord shapes the player fingers.
 *
 * Exported so the modal can use the same transposed chord names when it
 * builds the inline-diagram / chord-bar SVG maps.
 */
export function getRenderableSong(song: Song): ParsedSong {
  const parsed = ensureParsed(song);
  // Mirror player-store.loadSong: fall back to the song entity's key if the
  // parsed content didn't declare one — the transposer uses metadata.key for
  // flat/sharp resolution.
  if (!parsed.metadata.key && song.key) parsed.metadata.key = song.key;
  const steps = song.preferences?.transposeSteps ?? 0;
  const capo = song.capo ?? 0;
  const shapeSteps = steps - capo;
  const playingKey = parsed.metadata.key ? transposeKey(parsed.metadata.key, shapeSteps) : undefined;
  const songDefault = resolveFlatsForKey(playingKey, false);
  const perLine = computeSectionFlats(parsed, shapeSteps, songDefault);
  return transposeSong(parsed, shapeSteps, (i) => perLine[i] ?? songDefault);
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ─── Plain-text (chords above lyrics) ──────────────────────────────────────

function lineToChordAboveLyric(line: ParsedLine): string[] {
  let chordRow = '';
  let lyricRow = '';
  for (const t of line.tokens) {
    if (t.type === 'chord') {
      while (chordRow.length < lyricRow.length) chordRow += ' ';
      chordRow += t.chord + ' ';
    } else if (t.type === 'lyric') {
      lyricRow += t.text;
    }
  }
  const out: string[] = [];
  if (chordRow.trim()) out.push(chordRow.trimEnd());
  out.push(lyricRow);
  return out;
}

export function toChordPro(song: Song): string {
  return song.content;
}

export function toPlainText(song: Song): string {
  const parsed = getRenderableSong(song);
  const out: string[] = [];

  out.push(song.title);
  if (song.artist) out.push(song.artist);
  const details: string[] = [];
  if (song.key) details.push(`Key: ${song.key}`);
  if (song.tempo) details.push(`Tempo: ${song.tempo} BPM`);
  if (song.timeSig) details.push(`Time: ${song.timeSig}`);
  if (song.capo && song.capo > 0) details.push(`Capo: ${song.capo}`);
  if (details.length) out.push(details.join('  |  '));
  out.push('');

  for (const line of parsed.lines) {
    if (line.isEmpty) { out.push(''); continue; }

    if (line.isSection) {
      const tok = line.tokens[0];
      if (tok?.type === 'section') {
        const map: Record<string, string> = { soc: 'Chorus', sob: 'Bridge', sot: 'Tab', sov: 'Verse' };
        const label = tok.label || map[tok.sectionType];
        if (label && !tok.sectionType.startsWith('eo')) out.push(`[${label}]`);
      }
      continue;
    }

    if (line.isDirective) {
      const tok = line.tokens[0];
      if (tok?.type === 'directive' && (tok.name === 'c' || tok.name === 'comment')) {
        if (tok.value) out.push(`[${tok.value}]`);
      }
      continue;
    }

    if (line.isComment) {
      const tok = line.tokens[0];
      if (tok?.type === 'comment') out.push(`# ${tok.text}`);
      continue;
    }

    out.push(...lineToChordAboveLyric(line));
  }

  return out.join('\n');
}

// ─── HTML (styled, matches the song view) ──────────────────────────────────

interface Chunk { chord?: string; lyric: string }

function buildChunks(line: ParsedLine): Chunk[] {
  const chunks: Chunk[] = [];
  let currentChord: string | undefined;
  let currentLyric = '';
  for (const token of line.tokens) {
    if (token.type === 'chord') {
      if (currentChord !== undefined || currentLyric) {
        chunks.push({ chord: currentChord, lyric: currentLyric });
        currentLyric = '';
      }
      currentChord = token.chord;
    } else if (token.type === 'lyric') {
      currentLyric += token.text;
    }
  }
  chunks.push({ chord: currentChord, lyric: currentLyric });
  return chunks.filter((c) => c.chord !== undefined || c.lyric.trim() !== '');
}

function renderLyricsOnlyLine(line: ParsedLine): string {
  let text = '';
  for (const t of line.tokens) {
    if (t.type === 'lyric') text += t.text;
  }
  return escapeHtml(text || '\u00A0');
}

function renderChordLyricLine(
  line: ParsedLine,
  chordColor: string,
  chordFontSize: string | undefined,
  inlineDiagramMap?: Record<string, string>,
): string {
  // Inline-diagrams layout: each chord diagram is embedded as a 0-width
  // marker at its source character position in the lyric flow. The diagram
  // SVG is absolutely positioned above the marker, so the natural text
  // layout handles alignment — whatever font the preset uses, the diagram's
  // left edge lands exactly at the character where the chord appears.
  // Collision avoidance adds spaces at word boundaries (never mid-word),
  // so words stay intact.
  if (inlineDiagramMap) {
    const DIAGRAM_CH = 10; // approximate min char-count between adjacent diagrams
    const PADDING_TOP = 86; // reserved space above lyrics — leaves ~5px between fretboard bottom and lyric top, matching the natural ~5px gap to the next line's chord name

    let rawLyric = '';
    const chordList: Array<{ name: string; pos: number }> = [];
    for (const t of line.tokens) {
      if (t.type === 'chord') chordList.push({ name: t.chord, pos: rawLyric.length });
      else if (t.type === 'lyric') rawLyric += t.text;
    }

    if (chordList.length === 0) {
      const text = escapeHtml(rawLyric) || '&nbsp;';
      return `<div style="margin:2px 0;">${text}</div>`;
    }

    // Never break a word. If the chord is in whitespace, insert there;
    // otherwise walk left to the start of the current word and insert
    // before it so the whole word slides right together.
    const findInsertionPoint = (s: string, pos: number): number => {
      if (pos >= s.length) return s.length;
      if (/\s/.test(s[pos]!)) return pos;
      let i = pos;
      while (i > 0 && !/\s/.test(s[i - 1]!)) i--;
      return i;
    };

    // Effective width: letters take ~1 unit, spaces ~0.5. Summing units
    // between chords gives a font-agnostic estimate of how much pixel gap
    // the lyric provides. We require DIAGRAM_CH units of gap so the
    // diagrams (≈80px wide) don't overlap regardless of whether the gap
    // is letters, spaces, or a mix.
    const charUnit = (ch: string): number => /\s/.test(ch) ? 0.5 : 1.0;
    const effUnits = (s: string, start: number, end: number): number => {
      let u = 0;
      const e = Math.min(end, s.length);
      for (let i2 = start; i2 < e; i2++) u += charUnit(s[i2]!);
      return u;
    };

    let lyric = rawLyric;
    const finalPositions: number[] = [];
    for (let i = 0; i < chordList.length; i++) {
      const c = chordList[i]!;
      if (i === 0) {
        finalPositions.push(c.pos);
        continue;
      }
      const prev = finalPositions[i - 1]!;
      const units = effUnits(lyric, prev, c.pos);
      if (units < DIAGRAM_CH) {
        // Each inserted space adds 0.5 units, so take twice the deficit.
        const spacesToAdd = Math.ceil((DIAGRAM_CH - units) / 0.5);
        const insertPoint = findInsertionPoint(lyric, c.pos);
        lyric = lyric.slice(0, insertPoint) + ' '.repeat(spacesToAdd) + lyric.slice(insertPoint);
        for (let j = 0; j < chordList.length; j++) {
          if (chordList[j]!.pos >= insertPoint) chordList[j]!.pos += spacesToAdd;
        }
        for (let j = 0; j < finalPositions.length; j++) {
          if (finalPositions[j]! >= insertPoint) finalPositions[j]! += spacesToAdd;
        }
      }
      finalPositions.push(chordList[i]!.pos);
    }

    // Build the lyric with a marker span at each chord position. The SVG
    // is absolutely positioned above the marker — natural text flow picks
    // the x-offset, so preset font is preserved.
    //
    // SVG left-offset: ChordDiagramSVG has padLeft=16 (internal padding
    // before the leftmost string line). We shift the SVG 16px left so the
    // first string aligns with the marker's character position, not the
    // SVG's outer bounding box.
    const SVG_LEFT_OFFSET = -16;
    const sorted = chordList
      .map((c, i) => ({ name: c.name, pos: finalPositions[i]! }))
      .sort((a, b) => a.pos - b.pos);
    let inner = '';
    let lyricIdx = 0;
    for (const m of sorted) {
      if (m.pos > lyricIdx) {
        inner += escapeHtml(lyric.slice(lyricIdx, m.pos));
        lyricIdx = m.pos;
      }
      const hasDiagram = !!inlineDiagramMap[m.name];
      const diagramHtml = hasDiagram
        ? inlineDiagramMap[m.name]!
        : `<span style="font-weight:600;color:${chordColor};${chordFontSize ? `font-size:${chordFontSize};` : ''}">${escapeHtml(m.name)}</span>`;
      const leftOff = hasDiagram ? SVG_LEFT_OFFSET : 0;
      inner += `<span style="position:relative;"><span style="position:absolute;top:-${PADDING_TOP}px;left:${leftOff}px;line-height:0;white-space:nowrap;">${diagramHtml}</span></span>`;
    }
    if (lyricIdx < lyric.length) {
      inner += escapeHtml(lyric.slice(lyricIdx));
    }

    return `<div style="margin:0;padding-top:${PADDING_TOP}px;">
      <div style="white-space:pre;">${inner}</div>
    </div>`;
  }

  const chunks = buildChunks(line);
  if (chunks.length === 0) return '&nbsp;';
  const chunkHtml = chunks.map((c) => {
    let chordCell: string;
    if (!c.chord) {
      chordCell = `<span style="display:block;height:1.4em;line-height:0;">&#8203;</span>`;
    } else {
      chordCell = `<span style="display:block;height:1.4em;white-space:nowrap;font-weight:600;${chordFontSize ? `font-size:${chordFontSize};` : 'font-size:0.85em;'}padding-right:0.3em;color:${chordColor};">${escapeHtml(c.chord)}</span>`;
    }
    const lyric = c.lyric.length === 0 ? '&nbsp;' : escapeHtml(c.lyric);
    return `<span style="display:inline-block;vertical-align:bottom;">${chordCell}<span style="display:block;white-space:pre;height:1.2em;line-height:1.2em;">${lyric}</span></span>`;
  }).join('');
  return `<div style="display:flex;flex-wrap:wrap;align-items:flex-end;line-height:1;margin:2px 0;">${chunkHtml}</div>`;
}

/**
 * Renders the body of a song with the same visual structure as the app's
 * SongRenderer/ChordLine: styled title, chorus sections wrapped with a border,
 * comment-directive labels, and stacked chord/lyric chunks.
 */
// Port of SongRenderer.groupLines — bundles chorus-type sections so the
// whole group can share a left border the same way the app does.
function groupLines(lines: ParsedLine[]): { bordered: boolean; lines: ParsedLine[]; startIndex: number }[] {
  const groups: { bordered: boolean; lines: ParsedLine[]; startIndex: number }[] = [];
  let current: ParsedLine[] = [];
  let inBordered = false;
  let startIndex = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.isSection) {
      if (current.length) groups.push({ bordered: inBordered, lines: current, startIndex });
      current = [line];
      inBordered = line.sectionType === 'chorus';
      startIndex = i;
    } else if (line.isSectionEnd && inBordered) {
      groups.push({ bordered: true, lines: current, startIndex });
      current = [];
      inBordered = false;
      startIndex = i + 1;
    } else {
      if (current.length === 0) startIndex = i;
      current.push(line);
    }
  }
  if (current.length) groups.push({ bordered: inBordered, lines: current, startIndex });
  return groups;
}

function renderLineHtml(
  line: ParsedLine,
  absoluteIndex: number,
  style: SongViewStyle,
  layout: ExportLayout,
  inlineDiagrams?: Record<string, string>,
  chordGrids?: Record<number, string>,
): string {
  const lyricsOnly = layout === 'lyrics-only';

  // Order matches SongRenderer: chord-grid → empty → section → comment →
  // directive. Critically, isComment must come BEFORE isDirective — the
  // parser sets both flags on {c: …} / {comment: …} lines, so checking
  // isDirective first would drop every section-title chip.
  if (line.isChordGrid) {
    if (lyricsOnly) return '';
    return chordGrids?.[absoluteIndex] ?? '';
  }
  if (line.isEmpty) return '<div style="height:1rem;"></div>';
  if (line.isSectionEnd) return '';

  // Section labels ({start_of_verse: X}, {sov: X}) and comment labels
  // ({c: X}, {comment: X}) both render as the same chip so section titles
  // look visually consistent in the export regardless of which ChordPro
  // syntax the source song uses. Uses the preset's section color/background,
  // falling back to var(--accent) / white so a chip is always visible.
  const renderSectionChip = (label: string): string => {
    const ss = style.section;
    const bg = ss.background || 'var(--accent)';
    const color = ss.color || 'white';
    const fs = ss.fontSize ? `${ss.fontSize}px` : '0.82em';
    const upper = style.sectionUppercase ? 'uppercase' : 'none';
    return `<div style="display:inline-block;background:${bg};color:${color};font-family:inherit;font-weight:700;font-size:${fs};letter-spacing:0.06em;text-transform:${upper};padding:2px 8px;border-radius:4px;margin:6px 0 3px;">${escapeHtml(label)}</div>`;
  };

  if (line.isSection) {
    const tok = line.tokens[0];
    const label = tok?.type === 'section' ? tok.label : undefined;
    if (!label) return '';
    return renderSectionChip(label);
  }

  if (line.isComment) {
    const tok = line.tokens[0];
    const text = tok?.type === 'comment' ? tok.text : '';
    if (!text) return '';
    return renderSectionChip(text);
  }

  if (line.isDirective) return '';

  // Lyric-bearing line.
  const chordColor = style.chords.color || '#4b73ff';
  const chordFontSize = style.chords.fontSize ? `${style.chords.fontSize}px` : undefined;

  if (line.hasChords && lyricsOnly) {
    const lyrics = line.tokens.filter((t) => t.type === 'lyric').map((t) => (t as { text: string }).text).join('');
    return `<div>${escapeHtml(lyrics) || '&nbsp;'}</div>`;
  }

  if (line.hasChords) {
    return renderChordLyricLine(line, chordColor, chordFontSize, layout === 'inline-diagrams' ? inlineDiagrams : undefined);
  }

  const text = line.tokens.map((t) => ((t as { text?: string }).text ?? '')).join('');
  return `<div>${escapeHtml(text) || '&nbsp;'}</div>`;
}

function renderSongBody(
  parsed: ParsedSong,
  layout: ExportLayout,
  style: SongViewStyle,
  inlineDiagrams?: Record<string, string>,
  chordGrids?: Record<number, string>,
): string {
  const groups = groupLines(parsed.lines);
  const chorusBorder = style.chorusBorderColor || '#4b73ff';

  return groups.map((group) => {
    const inner = group.lines
      .map((line, li) => renderLineHtml(line, group.startIndex + li, style, layout, inlineDiagrams, chordGrids))
      .join('');
    if (group.bordered) {
      // Matches SongRenderer's chorus wrapper styles: 3px left border, 14px
      // padding, 2px left margin, 4px vertical margins.
      return `<div style="border-left:3px solid ${chorusBorder};padding-left:14px;margin-left:2px;margin-top:4px;margin-bottom:4px;">${inner}</div>`;
    }
    return inner;
  }).join('');
}

export function toHtml(song: Song, options?: ExportOptions): string {
  const parsed = getRenderableSong(song);
  const style = options?.style;
  const layout: ExportLayout = options?.layout ?? 'chords';

  // Match SongRenderer defaults exactly: monospace when the preset hasn't
  // set a font; lineHeight 1.8 on the song body; lyrics color/size straight
  // from svs.lyrics.
  const fontFamily = style?.fontFamily || 'monospace';
  const lyricsColor = style?.lyrics.color || '#111';
  const lyricsBackground = style?.lyrics.background || '#fff';
  const lyricsFontSize = style?.lyrics.fontSize ? `${style.lyrics.fontSize}px` : '16px';
  const titleColor = style?.title.color || '#111';
  const titleFontSize = style?.title.fontSize ? `${style.title.fontSize}px` : '28px';
  const detailsColor = style?.details.color || '#555';
  const detailsFontSize = style?.details.fontSize ? `${style.details.fontSize}px` : '14px';
  const titleUppercase = style?.titleUppercase ? 'text-transform:uppercase;' : '';

  const transposeSteps = song.preferences?.transposeSteps ?? 0;
  const displayKey = song.key ? transposeKey(song.key, transposeSteps) : undefined;
  // Mirror SongViewPage's detail row: label in svs.details.color with
  // fontWeight:700, value in same color with fontWeight:400 + opacity:0.85.
  const lbl = (t: string) => `<span style="font-weight:700;color:${detailsColor};">${escapeHtml(t)}</span>`;
  const val = (t: string | number) => `<span style="font-weight:400;opacity:0.85;color:${detailsColor};">${escapeHtml(String(t))}</span>`;
  const details: string[] = [];
  if (displayKey)                  details.push(`${lbl('Key: ')}${val(displayKey)}`);
  if (song.capo && song.capo > 0)  details.push(`${lbl('Capo: ')}${val(song.capo)}`);
  if (transposeSteps !== 0)        details.push(`${lbl('Transpose: ')}${val((transposeSteps > 0 ? '+' : '') + transposeSteps)}`);
  if (song.tempo)                  details.push(`${lbl('Tempo: ')}${val(`${song.tempo} BPM`)}`);
  if (song.timeSig)                details.push(`${lbl('Time: ')}${val(song.timeSig)}`);

  const bodyHtml = renderSongBody(parsed, layout, style ?? DEFAULT_FALLBACK_STYLE, options?.inlineDiagrams, options?.chordGrids);
  const barHtml = layout === 'chords-with-bar' && options?.chordBarHtml ? options.chordBarHtml : '';
  const centered = options?.songCentered ?? false;
  const titleAlign = centered ? 'text-align:center;' : '';
  const bodyWrapStart = centered
    ? '<div style="width:fit-content;max-width:100%;margin:0 auto;">'
    : '<div>';
  const bodyWrapEnd = '</div>';

  // Inline CSS variables used by the ChordGrid SVG (stroke="var(--text-primary)"
  // etc.) and as fallbacks in section/comment chip styles when the preset
  // hasn't filled those slots. Values mirror the theme/index.css defaults.
  const textPrimary = style?.lyrics.color || '#111';
  const textSecondary = style?.details.color || '#555';
  const chordColorVar = style?.chords.color || '#4b73ff';
  const accent = '#6366f1';         // theme/index.css light-mode --accent
  const sectionColorVar = '#64748b'; // theme/index.css light-mode --section-color

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeHtml(song.title)}</title>
<style>
  :root {
    color-scheme: light dark;
    --text-primary: ${textPrimary};
    --text-secondary: ${textSecondary};
    --chord-color: ${chordColorVar};
    --accent: ${accent};
    --section-color: ${sectionColorVar};
  }
  /* Preserve background colors when printing / saving as PDF. Chromium
     strips backgrounds by default to save ink; these rules override that so
     the section chips, body background, and chord-grid strokes come through. */
  html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body, .body, * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .my-4 { margin-top: 1rem; margin-bottom: 1rem; }
  body { font-family: ${fontFamily}; max-width: 860px; margin: 2em auto; padding: 0 1.5em; background: ${lyricsBackground}; color: ${lyricsColor}; font-size: ${lyricsFontSize}; }
  h1.title { margin: 0 0 0.2em; color: ${titleColor}; font-size: ${titleFontSize}; ${titleUppercase} ${titleAlign} }
  .artist { color: ${detailsColor}; font-size: ${detailsFontSize}; margin-bottom: 0.35em; ${titleAlign} }
  .details { color: ${detailsColor}; font-size: ${detailsFontSize}; font-family: ${fontFamily}; margin-bottom: 1.2em; ${titleAlign ? 'display:flex;justify-content:center;flex-wrap:wrap;' : 'display:flex;flex-wrap:wrap;'} }
  /* Direct children only — otherwise the label/value sibling spans inside
     each detail would each get an extra "|" prepended. Use margin (not
     spaces inside content) because browsers collapse whitespace in CSS
     content strings. */
  .details > span + span::before { content: '|'; margin: 0 8px; color: ${detailsColor}; opacity: 0.5; }
  /* Song body: replicate SongRenderer root div — lineHeight 1.8 + the
     picked font-family (monospace when the preset has none). */
  .body { margin-top: 1em; font-size: ${lyricsFontSize}; line-height: 1.8; font-family: ${fontFamily}; color: ${lyricsColor}; }
  @media print {
    body { max-width: none; margin: 0; padding: 1.2cm; }
    @page { margin: 1.2cm; }
    * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
  }
</style>
</head>
<body>
<h1 class="title">${escapeHtml(style?.titleUppercase ? song.title : toTitleCase(song.title))}</h1>
${song.artist ? `<div class="artist">${escapeHtml(toTitleCase(song.artist))}</div>` : ''}
${details.length ? `<div class="details">${details.map((d) => `<span>${d}</span>`).join('')}</div>` : ''}
${barHtml}
${bodyWrapStart}<div class="body">${bodyHtml}</div>${bodyWrapEnd}
</body>
</html>`;
}

// A minimal fallback used when no SongViewStyle is supplied. Matches the
// type shape well enough for renderSongBody; values mirror the app's light
// defaults so the output is readable.
const DEFAULT_FALLBACK_STYLE: SongViewStyle = {
  preset: 'light',
  fontFamily: '',
  titleUppercase: false,
  sectionUppercase: false,
  lyrics:  { fontSize: 16, color: '#111', background: '#fff' },
  chords:  { fontSize: 14, color: '#4b73ff', background: 'transparent' },
  title:   { fontSize: 28, color: '#111', background: 'transparent' },
  details: { fontSize: 14, color: '#555', background: 'transparent' },
  section: { fontSize: 14, color: '#111', background: '#eee' },
  chorusBorderColor: '#4b73ff',
};

export function toJson(song: Song): string {
  return JSON.stringify(song, null, 2);
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'song';
}

export function printSongPdf(song: Song, options?: ExportOptions): void {
  const html = toHtml(song, options);
  const iframe = document.createElement('iframe');
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  iframe.setAttribute('aria-hidden', 'true');
  iframe.srcdoc = html;
  document.body.appendChild(iframe);

  const originalTitle = document.title;
  document.title = slugify(song.title);

  iframe.onload = () => {
    try {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
    } finally {
      window.setTimeout(() => {
        iframe.remove();
        document.title = originalTitle;
      }, 1000);
    }
  };
}

export function exportSong(song: Song, format: ExportFormat, options?: ExportOptions): void {
  if (format === 'pdf') {
    printSongPdf(song, options);
    return;
  }
  const cfg = EXPORT_FORMATS.find((f) => f.id === format)!;
  let content: string;
  switch (format) {
    case 'chordpro':  content = toChordPro(song); break;
    case 'plaintext': content = toPlainText(song); break;
    case 'html':      content = toHtml(song, options); break;
    case 'json':      content = toJson(song); break;
  }
  const filename = `${slugify(song.title)}.${cfg.ext}`;
  const blob = new Blob([content], { type: cfg.mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
