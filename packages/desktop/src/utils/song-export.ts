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
  /** Map of chord name → pre-rendered SVG markup. Used in the regular
   *  `'chords'` layout to render diagrams *inside* the wrap-friendly
   *  chunk cells (instead of plain chord text). The cast page's
   *  "Lyrics + chord diagrams" mode uses this so diagrams sit inside
   *  the word-grouped layout that wraps cleanly on mobile. */
  chunkDiagrams?: Record<string, string>;
  /** Map of ParsedLine index → pre-rendered HTML for chord-grid blocks
   *  (produced by the modal via renderToStaticMarkup(<ChordGrid />)). */
  chordGrids?: Record<number, string>;
  /** App-theme background color to paint behind the song — normally
   *  `var(--bg)` from the active theme. Lets dark-mode exports match the
   *  song-view container instead of defaulting to white. */
  themeBackground?: string;
  /** App-theme foreground default used when the preset doesn't set a
   *  lyrics color — ensures dark-mode text stays legible on dark bg. */
  themeForeground?: string;
  /** Active `--chord-color` — used when the preset's chord color is empty
   *  (the "Default" preset relies on theme vars). */
  themeChord?: string;
  /** Active `--text-muted` — fallback for the details / artist row color. */
  themeMuted?: string;
  /** Active `--accent` — fallback for section chip backgrounds. */
  themeAccent?: string;
  /** Active `--section-color` — fallback for section chip text color. */
  themeSection?: string;
}

export const EXPORT_FORMATS: { id: ExportFormat; label: string; ext: string; mime: string; hint: string }[] = [
  { id: 'pdf',       label: 'PDF',        ext: 'pdf',      mime: 'application/pdf',
    hint: 'Page-formatted document — best for printing or sharing a finished chart.' },
  { id: 'html',      label: 'HTML',       ext: 'html',     mime: 'text/html',
    hint: 'Self-contained web page that opens in any browser.' },
  { id: 'chordpro',  label: 'ChordPro',   ext: 'chordpro', mime: 'text/plain',
    hint: 'Source with [chord] markers — re-importable here and in most chord editors.' },
  { id: 'plaintext', label: 'Plain text', ext: 'txt',      mime: 'text/plain',
    hint: 'Chords above lyrics, no formatting. Opens in any text editor.' },
  { id: 'json',      label: 'JSON',       ext: 'json',     mime: 'application/json',
    hint: 'Complete song record — best for backups or moving between installations.' },
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
  /** Optional map for the chunk-branch chord cells. When set, each
   *  chord chunk renders the matching SVG diagram instead of the
   *  plain chord-name text. Used by the cast page's "Lyrics + chord
   *  diagrams" mode so diagrams sit inside the wrap-friendly
   *  word-grouped layout (the absolute-positioned `inlineDiagramMap`
   *  branch above doesn't wrap on narrow screens). */
  chunkDiagramMap?: Record<string, string>,
  /** The active song-view style — used to read `lyrics.fontSize` so
   *  the inline-diagram pathway can scale its measurements with the
   *  user's chosen lyric font. */
  style?: SongViewStyle,
): string {
  // Inline-diagrams layout: emit each lyric word (with all its chord
  // markers) as a single inline-block "atom" that can wrap to a new
  // visual line but never break internally. Inside each atom, chord
  // syllables that need spreading (e.g. 4 chords on "habitacion") are
  // joined with literal "-" dashes — visible to the audience and
  // never used as line-break opportunities.
  //
  // Rules implemented:
  //   1. Diagram left edge lands exactly over its syllable (the SVG
  //      starts at the marker character, modulo a -16px nudge so the
  //      leftmost string — not the SVG bounding box — sits on the
  //      character).
  //   2. Each syllable run gets enough horizontal space to hold its
  //      ~90px diagram. Inside a word, syllables are joined with "-"
  //      dashes (padded as needed); BETWEEN words, gaps grow by
  //      inserting normal spaces.
  //   3. Words wrap as units. The browser is only allowed to break at
  //      the spaces BETWEEN atoms, never inside them, because each
  //      atom is `white-space: nowrap`.
  if (inlineDiagramMap) {
    // Equal visible padding above and below the diagram band.
    // All measurements scale with the user's chosen lyric font size
    // so the layout stays proportional across font/viewport settings:
    //   - Diagram width = LYRIC_FONT_SIZE × 5 (matches the cast HTML
    //     builder's scaling). Diagram height ≈ width × 1.2 for guitar.
    //   - DIAGRAM_MARGIN = LYRIC_FONT_SIZE × 1.15 — the visible gap
    //     between previous lyric ↔ this diagram, and between this
    //     diagram ↔ this lyric.
    //   - Line container `padding-top: DIAGRAM_MARGIN` provides the
    //     top gap. Marker reserves
    //     `svgHeight + LYRIC_FONT_SIZE + DIAGRAM_MARGIN` of inline
    //     space so the bottom gap is automatic.
    const LYRIC_FONT_SIZE = style?.lyrics.fontSize || 19;
    // TOP_GAP > BOTTOM_GAP so the diagram unit (chord name +
    // fretboard) looks visually centered between the previous and
    // current lyric lines. The previous line's CSS line-box reaches
    // ~half-leading px below its visible text bottom, so we need
    // extra top padding to compensate. The lyric below this diagram
    // sits at the bottom of the marker (vertical-align: bottom,
    // line-height: 1) with no half-leading, so the bottom gap can
    // be smaller.
    const TOP_GAP = Math.round(LYRIC_FONT_SIZE * 0.95);
    const BOTTOM_GAP = Math.round(LYRIC_FONT_SIZE * 0.05);
    const DIAGRAM_MARGIN = BOTTOM_GAP;
    const DIAGRAM_WIDTH = Math.min(140, Math.max(64, Math.round(LYRIC_FONT_SIZE * 5)));
    const DIAGRAM_HEIGHT = Math.round(DIAGRAM_WIDTH * 1.2);
    const PADDING_TOP = DIAGRAM_HEIGHT + LYRIC_FONT_SIZE + DIAGRAM_MARGIN;
    const SVG_LEFT_OFFSET = -16; // shifts SVG so its leftmost string lands on the marker character (compensates for ChordDiagramSVG's internal padLeft)
    // ChordDiagramSVG has ~3-5px of empty space above the chord name
    // text inside its viewBox (text baseline at y=14 with ascent ~10-12
    // means visible name top ≈ y=3). Pull the SVG up so the visible
    // "diagram unit" (name + fretboard) sits flush with the marker top
    // — keeps the diagram visually centered between two lyric lines.
    const SVG_TOP_TRIM = -4;

    // ── 1. Collect the raw lyric and each chord's source position ──
    let rawLyric = '';
    const chordList: Array<{ name: string; pos: number }> = [];
    for (const t of line.tokens) {
      if (t.type === 'chord') chordList.push({ name: t.chord, pos: rawLyric.length });
      else if (t.type === 'lyric') rawLyric += t.text;
    }
    if (chordList.length === 0) {
      const text = escapeHtml(rawLyric) || '&nbsp;';
      // Tight line-height so adjacent chord-line diagrams stay
      // visually centered between surrounding lyric lines.
      return `<div style="margin:2px 0;line-height:1.4;">${text}</div>`;
    }

    // Normalize leading whitespace from the lyric. ChordPro sources
    // often emit `[Chord]   <text>` with arbitrary trailing spaces
    // before the first real word — those spaces can be much wider
    // than needed and produce a big random indent on the receiver.
    //
    //   - If NO chord landed in the leading whitespace, trim it
    //     entirely so the lyric flushes left to the page edge.
    //   - If chords DID land there (e.g. a chord with no syllable,
    //     meant to be played during a pause before the first word),
    //     replace the leading whitespace with ` ` (non-breaking
    //     spaces) so it becomes a "word" atom — the diagram-spacing
    //     pre-pass downstream will then spread the leading chords
    //     properly within it, the same way it spreads chords inside
    //     a real word. NBSP is used so atom-splitting (which keys
    //     off `\s`) treats the leading area as a word, not a space.
    // Leading-whitespace handling: strip leading whitespace from
    // rawLyric BEFORE atom-splitting; collect leading chord names
    // separately. After atoms are built we prepend each leading chord
    // as its own zero-width chord-only atom followed by a space atom
    // (whose width the post-pre-pass widens via a pixel spacer). This
    // way every leading chord diagram visibly floats over its own
    // empty space, detached from the first real lyric word.
    const leadingWsLen = rawLyric.match(/^s+/)?.[0]?.length ?? 0;
    const leadingChordNames: string[] = [];
    if (leadingWsLen > 0) {
      for (const c of chordList) {
        if (c.pos < leadingWsLen) leadingChordNames.push(c.name);
      }
      for (let i = chordList.length - 1; i >= 0; i--) {
        if (chordList[i]!.pos < leadingWsLen) chordList.splice(i, 1);
        else chordList[i]!.pos -= leadingWsLen;
      }
      rawLyric = rawLyric.slice(leadingWsLen);
    }

    // ── 2. Split the lyric into atoms at whitespace boundaries.
    // Each atom is a run of non-space chars (a word) or a run of
    // spaces. Spaces are emitted between atoms as literal " " — those
    // are the ONLY break opportunities the browser sees. Non-breaking
    // spaces ( ) are NOT treated as splitters here so the
    // normalized leading-whitespace block above (which uses NBSPs)
    // becomes a single "word"-style atom.
    const isSplitSpace = (ch: string): boolean => ch === ' ' || ch === '\t';
    type Atom = { text: string; chords: Array<{ name: string; offset: number }>; isSpace: boolean };
    const atoms: Atom[] = [];
    let bufStart = 0;
    let bufIsSpace = rawLyric.length > 0 && isSplitSpace(rawLyric[0]!);
    for (let i = 1; i <= rawLyric.length; i++) {
      const atEnd = i === rawLyric.length;
      const ch = atEnd ? null : rawLyric[i]!;
      const chIsSpace = ch === null ? !bufIsSpace : isSplitSpace(ch);
      if (atEnd || chIsSpace !== bufIsSpace) {
        atoms.push({ text: rawLyric.slice(bufStart, i), chords: [], isSpace: bufIsSpace });
        bufStart = i;
        if (!atEnd) bufIsSpace = chIsSpace;
      }
    }
    if (atoms.length === 0) atoms.push({ text: '', chords: [], isSpace: false });

    // Chord attachment.
    //   - Chord directly adjacent to a word with NO space before it
    //     ("[A]is") → attach to that word at offset.
    //   - Chord in whitespace or past end ("[A] is" or trailing) →
    //     standalone chord-only atom inserted after preceding word;
    //     diagram floats over empty space.
    const atomStart = (idx: number): number => {
      let s = 0;
      for (let k = 0; k < idx; k++) s += atoms[k]!.text.length;
      return s;
    };
    type Insertion = { afterIdx: number; chord: string; orderIdx: number };
    const insertions: Insertion[] = [];
    let orderCounter = 0;
    for (const c of chordList) {
      const charAtPos = c.pos < rawLyric.length ? rawLyric[c.pos]! : '';
      const isOnSyllable = charAtPos !== '' && !/\s/.test(charAtPos);
      if (!isOnSyllable) {
        let lastWordIdx = -1;
        let cursor = 0;
        for (let k = 0; k < atoms.length; k++) {
          const a = atoms[k]!;
          const end = cursor + a.text.length;
          if (!a.isSpace && end <= c.pos) lastWordIdx = k;
          if (end > c.pos) break;
          cursor = end;
        }
        insertions.push({
          afterIdx: lastWordIdx,
          chord: c.name,
          orderIdx: orderCounter++,
        });
        continue;
      }
      let target = -1;
      let cursor = 0;
      for (let k = 0; k < atoms.length; k++) {
        const a = atoms[k]!;
        const end = cursor + a.text.length;
        if (c.pos < end && !a.isSpace) { target = k; break; }
        cursor = end;
      }
      if (target === -1) {
        insertions.push({
          afterIdx: atoms.length - 1,
          chord: c.name,
          orderIdx: orderCounter++,
        });
        continue;
      }
      const start = atomStart(target);
      atoms[target]!.chords.push({ name: c.name, offset: Math.max(0, c.pos - start) });
    }
    insertions.sort((a, b) => {
      if (a.afterIdx !== b.afterIdx) return b.afterIdx - a.afterIdx;
      return b.orderIdx - a.orderIdx;
    });
    for (const ins of insertions) {
      const insertAt = ins.afterIdx + 1;
      // Insert [leading-space, chord-only-atom, trailing-space] so
      // an inter-atom space always sits on BOTH sides of every
      // standalone chord-only atom. Otherwise the pre-pass would
      // fall back to adding visible ASCII dashes to the preceding
      // syllable.
      atoms.splice(insertAt, 0,
        { text: ' ', chords: [], isSpace: true },
        { text: '', chords: [{ name: ins.chord, offset: 0 }], isSpace: false },
        { text: ' ', chords: [], isSpace: true },
      );
    }

    // Prepend each leading chord as a standalone atom AFTER the
    // chord-attachment loop above (so cursor calculation isn't
    // shifted by the prepended atoms' lengths).
    if (leadingChordNames.length > 0) {
      const prepend: Atom[] = [];
      for (const name of leadingChordNames) {
        prepend.push({ text: '', chords: [{ name, offset: 0 }], isSpace: false });
        prepend.push({ text: ' ', chords: [], isSpace: true });
      }
      atoms.unshift(...prepend);
    }

    // ── 3. Inside each word atom that holds multiple chords, split
    // the word into syllables at each chord's offset and join them
    // with literal "-" dashes. A syllable is only padded when both
    // ITSELF carries a chord AND the segment AFTER it ALSO carries a
    // chord — otherwise there's no diagram-vs-diagram collision to
    // protect against and padding just creates ugly dead space (the
    // "sole------dad" bug). The atom stays a single nowrap unit so
    // the browser can't break in the middle of it.
    const buildWordAtomHtml = (
      _atom: Atom,
      segments: Array<{ chord?: { name: string }; text: string; emDash: boolean; padDashes: number }>,
    ): string => {
      // Segments + per-segment dash padding were computed up front
      // (see the chord-points pre-pass). Here we just emit the HTML
      // with each chord-bearing segment getting a 0-width marker on
      // its left edge and `padDashes` trailing dashes after its text.
      const html: string[] = [];
      for (let k = 0; k < segments.length; k++) {
        const seg = segments[k]!;
        // Trailing em-dash separates this chord's syllable from the
        // next chord's syllable in the same word (e.g. "habi" + em-dash
        // + "ta"). Pure-whitespace segments (leading-NBSP block) never
        // get an em-dash because there's no following syllable.
        // A "real syllable" has non-empty, non-whitespace text. Only
        // real syllables get visible ASCII dashes (padDashes) or
        // em-dash separators. Empty / pure-whitespace placeholder
        // segments pad with NBSP (invisible) — doubled in count
        // because NBSPs are ~half the width of letters, so we need
        // 2× the NBSP count to match the visible pixel width that
        // visible dashes would have produced.
        const hasRealSyllable = seg.text.length > 0 && !/^\s+$/.test(seg.text);
        let body = escapeHtml(seg.text);
        let longDashPx = 0;
        if (seg.padDashes > 0) {
          if (hasRealSyllable) {
            // In-word syllable split: one continuous long-dash bar
            // (inline-block with currentColor background) spans the
            // padDashes width — replaces the run of many ASCII
            // dashes with a single visible horizontal line.
            // Width = (padDashes + 2) × ~one-dash-width, so the long
            // bar matches the combined width of the dashes it
            // replaces plus a 2-dash extension for a cleaner look.
            longDashPx = Math.round((seg.padDashes + 2) * LYRIC_FONT_SIZE * 0.33);
          } else {
            // Non-syllable placeholder: invisible NBSP padding.
            body = body + ' '.repeat(seg.padDashes * 2);
          }
        }
        // em-dash is redundant when long-dash is shown (both are
        // syllable separators). Only emit when no long-dash padding.
        const showEmDash = seg.emDash && hasRealSyllable && longDashPx === 0;
        const longDashHtml = longDashPx > 0
          ? '<span aria-hidden="true" style="display:inline-block;width:' + longDashPx + 'px;height:2px;background-color:currentColor;vertical-align:middle;margin-left:2px;margin-right:2px;"></span>'
          : '';
        const emDashHtml = showEmDash ? '—' : '';
        body = body + longDashHtml + emDashHtml;
        // Lyric body wrapped in a `vertical-align: bottom; line-height: 1`
        // span. Chord-only placeholder segments (chord + no real
        // syllable text) get a min-width so each diagram reserves
        // pixel space. Two policies:
        //   - Tight (~0.75× diagram width) when followed by another
        //     chord-only placeholder → diagrams cluster close together.
        //   - Full (diagram width + breathing room) when followed by
        //     a real syllable (or it's the last segment) → next word
        //     starts past the diagram.
        const isChordOnlyPlaceholder = !!seg.chord && !hasRealSyllable;
        const nextSeg = segments[k + 1];
        const nextIsPlaceholder = !!nextSeg
          && !!nextSeg.chord
          && !(nextSeg.text.length > 0 && !/^\s+$/.test(nextSeg.text));
        let minWidthCss = '';
        if (isChordOnlyPlaceholder) {
          const w = nextIsPlaceholder
            ? Math.round(DIAGRAM_WIDTH * 0.55)
            : Math.round(DIAGRAM_WIDTH * 0.85);
          minWidthCss = `min-width:${w}px;`;
        }
        const bodyHtml = `<span style="display:inline-block;vertical-align:bottom;line-height:1;${minWidthCss}">${body}</span>`;
        if (seg.chord) {
          const hasDiagram = !!inlineDiagramMap[seg.chord.name];
          const diagramHtml = hasDiagram
            ? inlineDiagramMap[seg.chord.name]!
            : `<span style="font-weight:600;color:${chordColor};${chordFontSize ? `font-size:${chordFontSize};` : ''}">${escapeHtml(seg.chord.name)}</span>`;
          // Standalone chord-only atom: center the diagram inside
          // the atom's min-width box. Otherwise use SVG_LEFT_OFFSET
          // so the diagram aligns to the syllable's first character.
          const isStandaloneChordOnly = _atom.text === '' && _atom.chords.length === 1;
          let leftOff: number;
          if (isStandaloneChordOnly && hasDiagram) {
            const atomW = Math.round(DIAGRAM_WIDTH * 0.9);
            leftOff = Math.round((atomW - DIAGRAM_WIDTH) / 2);
          } else {
            leftOff = hasDiagram ? SVG_LEFT_OFFSET : 0;
          }
          const marker = `<span style="display:inline-block;position:relative;width:0;height:${PADDING_TOP}px;vertical-align:top;"><span style="position:absolute;top:${SVG_TOP_TRIM}px;left:${leftOff}px;line-height:1;white-space:nowrap;font-size:initial;">${diagramHtml}</span></span>`;
          html.push(marker + bodyHtml);
        } else {
          html.push(bodyHtml);
        }
      }
      return html.join('');
    };

    const buildSpaceAtomHtml = (atom: Atom): string => {
      // Inter-word whitespace. The atom carries no chords (collected
      // earlier; chords in whitespace were re-attached to the next
      // word). We may need to widen this gap so adjacent diagrams on
      // the two surrounding words clear each other — pad with extra
      // spaces (which remain valid line-break opportunities, ensuring
      // wrapping happens HERE, between words, not mid-word).
      // Use &nbsp; for the FIRST space (so it's preserved when sitting
      // at the start of a wrapped line) and regular spaces after.
      // CSS `white-space: pre` on the atom keeps multiple spaces from
      // collapsing — we set that on the wrapper below.
      const text = atom.text.length === 0 ? ' ' : atom.text;
      return escapeHtml(text);
    };

    // Pre-pass: walk every chord position across the line in order
    // and figure out how much horizontal space separates it from the
    // next chord. If the gap is smaller than MIN_SYLLABLE_CH we widen
    // it — preferably at an INTER-WORD whitespace atom (so the extra
    // gap stays at a wrap-friendly break point), otherwise inside the
    // current word as trailing dashes on the chord's syllable (so we
    // never split a word with whitespace, which would let it wrap
    // mid-word). The text width of each character counts as ~1; this
    // is approximate but consistent enough at the diagram's ±90px
    // scale to guarantee no collisions.
    // Segment each word atom at every chord offset. Each chord-bearing
    // segment except the LAST in its word carries `emDash: true` so
    // the renderer emits a single em-dash separator between syllables
    // (e.g. "habi" + em-dash + "ta"). One em-dash per split, regardless
    // of diagram width. No collision-avoidance pre-pass / extra space
    // injection: lyrics flow at their natural width, matching the
    // reference layout the user requested.
    type Segment = { chord?: { name: string }; text: string; emDash: boolean; padDashes: number };
    const wordSegments: Map<number, Segment[]> = new Map();
    const chordPoints: Array<{ atomIdx: number; segIdx: number }> = [];
    for (let k = 0; k < atoms.length; k++) {
      const a = atoms[k]!;
      if (a.isSpace) continue;
      const word = a.text;
      const chords = a.chords.slice().sort((x, y) => x.offset - y.offset);
      const segs: Segment[] = [];
      let cursor = 0;
      if (chords.length === 0 || chords[0]!.offset > 0) {
        segs.push({ text: word.slice(0, chords[0]?.offset ?? word.length), emDash: false, padDashes: 0 });
        cursor = chords[0]?.offset ?? word.length;
      }
      // When MULTIPLE chords share the same offset (e.g. several
      // chord-only positions all attached to the next word's first
      // character), they're all placeholders — the syllable text
      // goes to a separate no-chord segment AFTER them so the word
      // visually appears AFTER the diagrams, not under them.
      const allSameOffset = chords.every((c) => c.offset === chords[0]!.offset)
        && chords.length > 1;
      for (let m = 0; m < chords.length; m++) {
        const myOffset = chords[m]!.offset;
        const hasNextChord = m + 1 < chords.length;
        const nextChordOffset = hasNextChord ? chords[m + 1]!.offset : word.length;
        const sharedWithNext = hasNextChord && nextChordOffset === myOffset;
        const isPlaceholder = sharedWithNext || allSameOffset;
        const segText = isPlaceholder ? '' : word.slice(myOffset, nextChordOffset);
        // em-dash only fires for REAL syllables (non-empty, non-pure
        // whitespace). Empty / whitespace segments are placeholders.
        const hasRealSyllable = segText.length > 0 && !/^\s+$/.test(segText);
        segs.push({
          chord: { name: chords[m]!.name },
          text: segText,
          emDash: m < chords.length - 1 && hasRealSyllable,
          padDashes: 0,
        });
        if (!isPlaceholder) cursor = nextChordOffset;
      }
      // Append remaining word text as a no-chord segment when all
      // chord-bearing segments are placeholders (cursor didn't
      // advance past the chord cluster).
      if (cursor < word.length && chords.length > 0) {
        segs.push({ text: word.slice(Math.max(cursor, chords[chords.length - 1]!.offset)), emDash: false, padDashes: 0 });
      }
      wordSegments.set(k, segs);
      for (let s = 0; s < segs.length; s++) {
        if (segs[s]!.chord) chordPoints.push({ atomIdx: k, segIdx: s });
      }
    }

    // Minimal collision-avoidance pre-pass: widen inter-word spaces
    // (or, as a fallback, in-word dashes) when adjacent chord positions
    // would let their ~80px diagrams overlap.
    // Chord-to-chord minimum in char-equivalent units. The pre-pass
    // widens inter-word spaces (preferred) or pads in-word segments
    // with NBSPs (for chord-only stacks on the same syllable).
    const MIN_CHORD_GAP_CH = 11;
    // NBSP-only segments count at half-width because NBSP glyphs in
    // proportional fonts are about half as wide as letters.
    const visibleCharCount = (s: string): number => {
      if (s.length === 0) return 0;
      if (/^\s+$/.test(s)) return s.length * 0.5;
      return s.length;
    };
    const segWidth = (seg: Segment): number =>
      visibleCharCount(seg.text) + seg.padDashes + (seg.emDash ? 1 : 0);
    const extraSpaces: Map<number, number> = new Map();
    for (let i = 0; i + 1 < chordPoints.length; i++) {
      const ca = chordPoints[i]!;
      const cb = chordPoints[i + 1]!;
      // Skip pair-wise widening when ca is a standalone chord-only
      // atom (text="", exactly one chord). Such atoms already reserve
      // diagram-width pixel space via their outer min-width style;
      // adding extraSpaces on top would double the visible gap.
      const caAtom = atoms[ca.atomIdx]!;
      if (caAtom.text === '' && caAtom.chords.length === 1) continue;
      let units = 0;
      const interSpaceAtoms: number[] = [];
      if (ca.atomIdx === cb.atomIdx) {
        const segs = wordSegments.get(ca.atomIdx)!;
        units = segWidth(segs[ca.segIdx]!);
      } else {
        const segsA = wordSegments.get(ca.atomIdx)!;
        units += segWidth(segsA[ca.segIdx]!);
        for (let s = ca.segIdx + 1; s < segsA.length; s++) units += segWidth(segsA[s]!);
        for (let kk = ca.atomIdx + 1; kk < cb.atomIdx; kk++) {
          const ak = atoms[kk]!;
          if (ak.isSpace) {
            interSpaceAtoms.push(kk);
            units += ak.text.length + (extraSpaces.get(kk) ?? 0);
          } else {
            const sg = wordSegments.get(kk)!;
            for (let s = 0; s < sg.length; s++) units += segWidth(sg[s]!);
          }
        }
        const segsB = wordSegments.get(cb.atomIdx)!;
        for (let s = 0; s < cb.segIdx; s++) units += segWidth(segsB[s]!);
      }
      const deficit = MIN_CHORD_GAP_CH - units;
      if (deficit <= 0) continue;
      if (interSpaceAtoms.length > 0) {
        const target = interSpaceAtoms[interSpaceAtoms.length - 1]!;
        extraSpaces.set(target, (extraSpaces.get(target) ?? 0) + deficit);
      } else {
        // Always add the deficit width. The renderer turns it into
        // visible dashes for real syllables, or invisible NBSP
        // padding for chord-only placeholders — either way the
        // horizontal space is reserved so diagrams don't collide.
        const segs = wordSegments.get(ca.atomIdx)!;
        segs[ca.segIdx]!.padDashes += deficit;
      }
    }

    // (Standalone chord-only atom spacing is now handled directly
    // via `min-width` on the chord-only atom's outer span — see the
    // render path below. No need to inflate `extraSpaces` for those
    // atoms, which would double the visible gap.)

    // Walk atoms in order, emitting a `nowrap` inline-block for each
    // word atom (so it stays intact through wrapping) and a text node
    // for each space atom (so it's a valid break point).
    let inner = '';
    for (let k = 0; k < atoms.length; k++) {
      const a = atoms[k]!;
      if (a.isSpace) {
        const baseText = a.text.length === 0 ? ' ' : a.text;
        const extra = extraSpaces.get(k) ?? 0;
        // The natural inter-word space stays as a real space char so
        // the line can still break here on wrap. Any extra collision-
        // avoidance width is rendered as an explicit inline-block
        // pixel spacer — independent of the font's narrow space-glyph
        // width. ~`(diagramW + 16) / 10` px per unit gives a full
        // diagram-width gap when extra = MIN_CHORD_GAP_CH.
        const SPACER_PX_PER_UNIT = Math.round((DIAGRAM_WIDTH + 16) / 10);
        const spacerHtml = extra > 0
          ? `<span style="display:inline-block;width:${extra * SPACER_PX_PER_UNIT}px;height:1px;vertical-align:bottom;" aria-hidden="true"></span>`
          : '';
        inner += `<span style="white-space:pre;display:inline-block;vertical-align:bottom;line-height:1;">${escapeHtml(baseText)}${spacerHtml}</span>`;
      } else {
        // Chord-only placeholder atom. Two min-width policies:
        //   - Tight (~0.75× diagram width) when the NEXT non-space
        //     atom is ALSO a chord-only placeholder → diagrams
        //     cluster close together.
        //   - Full (diagram width + breathing room) otherwise → the
        //     next real word starts past this diagram.
        const isChordOnlyAtom = a.text === '' && a.chords.length > 0;
        let outerStyle = '';
        if (isChordOnlyAtom) {
          let nextIsClusterMember = false;
          for (let nk = k + 1; nk < atoms.length; nk++) {
            const na = atoms[nk]!;
            if (na.isSpace) continue;
            nextIsClusterMember = na.text === '' && na.chords.length > 0;
            break;
          }
          let prevWasSyllableWord = false;
          for (let pk = k - 1; pk >= 0; pk--) {
            const pa = atoms[pk]!;
            if (pa.isSpace) continue;
            prevWasSyllableWord = pa.text.length > 0 && !/^\s+$/.test(pa.text);
            break;
          }
          // Min-width = diagramW × 0.9 — slightly NARROWER than the
          // diagram so it overflows the atom box equally on each
          // side. Packs adjacent chord-only diagrams and surrounding
          // lyrics nice and tight.
          const w = Math.round(DIAGRAM_WIDTH * 0.9);
          outerStyle = `min-width:${w}px;`;
        }
        inner += `<span style="display:inline-block;white-space:nowrap;vertical-align:top;${outerStyle}">${buildWordAtomHtml(a, wordSegments.get(k)!)}</span>`;
      }
    }
    // Bypass unused-helper hint when buildSpaceAtomHtml isn't called.
    void buildSpaceAtomHtml;

    // `line-height` is generous so wrapped lines each reserve a
    // diagram band on top. `padding-right` reserves a diagram-width
    // gutter so the rightmost diagram on each line has room to render
    // before `overflow-x: clip` on the body would crop it. Words wrap
    // as atomic units so a word is NEVER split across visual lines.
    // `padding-top: DIAGRAM_MARGIN` provides the gap ABOVE the
    // diagram band (between previous lyric bottom and this diagram
    // top). The marker provides the gap below via its inner diagram
    // `bottom: DIAGRAM_MARGIN`. Together they balance the diagram
    // vertically between two lyric lines.
    const lineH = PADDING_TOP;
    return `<div style="margin:0;padding-top:${TOP_GAP}px;line-height:${lineH}px;">
      <div style="overflow-wrap:normal;word-break:keep-all;">${inner}</div>
    </div>`;
  }

  const rawChunks = buildChunks(line);
  if (rawChunks.length === 0) return '&nbsp;';
  // Split each chunk at whitespace so chord markers landing
  // mid-word produce one chunk per word fragment. Then group those
  // fragments into "word groups" — runs of chunks belonging to a
  // single word — so the line's flex-wrap can never break a word
  // across two screen lines on narrow viewports.
  const split = splitChunksAtWordBoundaries(rawChunks);
  const groups = groupChunksByWord(split);

  // Diagram cells (chord-diagram-mode cast) are taller than text
  // chord names, so when at least one chunk renders a diagram we
  // bump every chord-cell height in this line to keep lyrics aligned
  // along a single baseline.
  const useDiagrams = !!chunkDiagramMap && Object.keys(chunkDiagramMap).length > 0;
  const chordRowHeight = useDiagrams ? '7.5em' : '1.4em';
  // Render diagrams as zero-width absolute markers anchored to the
  // chunk's top-left, so the chunk's intrinsic width is determined
  // by the lyric below it (not the SVG's 80px width). That keeps
  // each chord visually positioned over its own syllable — the same
  // approach the in-app inline-diagrams view uses.
  const SVG_LEFT_OFFSET_PX = -16; // ChordDiagramSVG has 16px left padding before the first string; nudge left so the leftmost string lands at the marker position.

  const renderChunk = (c: Chunk): string => {
    let chordCell: string;
    let lyricText = c.lyric;
    let chunkMinWidth = '';
    // Width-padding inserted to reserve room for the chord cell above.
    // Kept in its own span (.chord-pad) so the cast page's lyrics-only
    // toggle can hide it via CSS without collapsing the real
    // inter-word spaces in the lyric.
    let padSpaces = 0;
    let padTrailing = '';

    if (!c.chord) {
      chordCell = `<span class="chord-cell chord-cell-empty" style="display:block;height:${chordRowHeight};line-height:0;">&#8203;</span>`;
    } else if (useDiagrams && chunkDiagramMap![c.chord]) {
      // Reserve vertical space for the diagram (height) but not
      // horizontal — the SVG sits in an absolutely-positioned inner
      // span so it doesn't push the chunk's width out past the
      // lyric below. The result: each diagram aligns vertically with
      // its own syllable, like the chord-name path does.
      // Anchor the diagram to the BOTTOM of the chord cell so there's
      // a uniform gap (controlled by `bottom`) between the diagram's
      // last fret and the lyric directly below it. The space above
      // the diagram, back toward the previous line's lyric, is
      // provided by the line div's top margin (see lineMargin below).
      chordCell = `<span class="chord-cell chord-cell-diagram" style="display:block;height:${chordRowHeight};position:relative;line-height:0;"><span style="position:absolute;bottom:18px;left:${SVG_LEFT_OFFSET_PX}px;line-height:0;white-space:nowrap;">${chunkDiagramMap![c.chord]}</span></span>`;
      // Diagram-cell collision avoidance — the SVG is ~80px wide but
      // the chunk's natural width is the lyric below it. If the lyric
      // is shorter than the diagram, the next chord's diagram starts
      // before this one ends. Pad the lyric with non-breaking spaces
      // up to a minimum visual width so adjacent diagrams don't
      // overlap. We size in `ch` units (font-relative) so it stays
      // proportional regardless of the user's preset font-size.
      const MIN_LYRIC_CH = 11; // ~88px at typical font sizes — wider than the 80px SVG so adjacent diagrams clear each other
      // Strip trailing whitespace before measuring so we don't double-pad
      // word-end chunks; preserve the trailing space at the end so
      // word-group separation still works.
      const trailing = lyricText.match(/\s*$/)?.[0] ?? '';
      const core = lyricText.slice(0, lyricText.length - trailing.length);
      if (core.length < MIN_LYRIC_CH) {
        lyricText = core;
        padSpaces = MIN_LYRIC_CH - core.length;
        padTrailing = trailing;
      }
      // Hard pixel floor on every diagram-bearing chunk. The
      // space-padding above tries to reserve space via trailing
      // characters, but proportional fonts make spaces much narrower
      // than letters, so a "habita" chunk (6 letters + 5 spaces) can
      // still measure narrower than the 80px diagram and let the next
      // diagram crowd in. A pixel min-width is the only reliable
      // guarantee. We apply it ONLY when the SVG would actually
      // overflow the rendered lyric — when the lyric is long enough
      // (> 11 visible chars), the natural text width already exceeds
      // the diagram and we keep the chunk's natural size to avoid
      // dead space between long words.
      if (core.length < 12) {
        chunkMinWidth = 'min-width:90px;';
      }
    } else {
      chordCell = `<span class="chord-cell chord-cell-text" style="display:block;height:${chordRowHeight};white-space:nowrap;font-weight:600;${chordFontSize ? `font-size:${chordFontSize};` : 'font-size:0.85em;'}padding-right:0.3em;color:${chordColor};">${escapeHtml(c.chord)}</span>`;
    }
    const lyric = lyricText.length === 0 ? '&nbsp;' : escapeHtml(lyricText);
    // Pad-spaces and trailing space live in their own .chord-pad span
    // so the cast page can hide just the width-reservation in lyrics-only
    // mode without affecting the real characters of `lyric`.
    const padInner = padSpaces > 0 ? ' '.repeat(padSpaces) + padTrailing : padTrailing;
    const padSpan = padInner.length > 0
      ? `<span class="chord-pad" style="white-space:pre;">${padInner}</span>`
      : '';
    const isChordOnly = c.lyric.trim().length === 0;
    const chunkClass = isChordOnly ? 'chord-chunk chord-chunk-empty' : 'chord-chunk';
    return `<span class="${chunkClass}" style="display:inline-block;vertical-align:bottom;${chunkMinWidth}">${chordCell}<span class="chunk-lyric" style="display:block;white-space:pre;height:1.2em;line-height:1.2em;">${lyric}${padSpan}</span></span>`;
  };

  // Each word group is a `display:inline-flex; flex-wrap:nowrap` so
  // its chunks stay glued together. The outer line uses
  // `flex-wrap:wrap` so the groups themselves break onto new screen
  // lines at word boundaries.
  const groupHtml = groups
    .map((g) => `<span style="display:inline-flex;flex-wrap:nowrap;align-items:flex-end;">${g.map(renderChunk).join('')}</span>`)
    .join('');
  // Vertical breathing room: text-only chord lines need only a couple
  // of px of margin (chord text is small). Diagram lines, however,
  // stack a ~6em diagram above the lyric inside a fixed-height chord
  // cell — without extra line margin, the diagram brushes against the
  // previous line's lyric while leaving an awkward gap below itself.
  // Bumping the top/bottom margin on the line div centres the diagram
  // optically between the two lyric rows on either side.
  const lineMargin = useDiagrams ? '18px 0 18px' : '2px 0';
  // Every chord-bearing line gets break-inside:avoid so the print
  // engine can't split between the chord row (rendered above) and the
  // lyric row beneath it inside the same line div. The legacy
  // page-break-inside alias is included for older WebKit / Chromium
  // print paths that don't honor the unprefixed property on flex
  // containers.
  const lineHtml = `<div style="display:flex;flex-wrap:wrap;align-items:flex-end;line-height:1;margin:${lineMargin};page-break-inside:avoid;break-inside:avoid;">${groupHtml}</div>`;
  // Chord-only line detection — when a line carries chords but no real
  // lyric text (just whitespace separators), it's a chord row meant to
  // sit ABOVE the following lyric line. Add break-after:avoid so the
  // print engine keeps it glued to whatever comes next. The block-level
  // wrapper is required because Chromium has bugs where break-after on
  // a flex container is ignored.
  const isChordOnlyLine = line.tokens
    .filter((t) => t.type === 'lyric')
    .every((t) => (t as { text: string }).text.trim().length === 0);
  if (isChordOnlyLine) {
    return `<div style="page-break-after:avoid;break-after:avoid;page-break-inside:avoid;break-inside:avoid;">${lineHtml}</div>`;
  }
  return lineHtml;
}

/** Re-emit each chunk so it covers exactly one word fragment + its
 *  trailing whitespace. Mirrors the in-app `splitChunksByWords`
 *  helper used by `ChordLine.tsx`. */
function splitChunksAtWordBoundaries(chunks: Chunk[]): Chunk[] {
  const result: Chunk[] = [];
  for (const chunk of chunks) {
    const parts = chunk.lyric.match(/\S+\s*|\s+/g);
    if (!parts || parts.length <= 1) { result.push(chunk); continue; }
    result.push({ chord: chunk.chord, lyric: parts[0]! });
    for (let i = 1; i < parts.length; i++) {
      result.push({ chord: undefined, lyric: parts[i]! });
    }
  }
  return result;
}

/** Group chunks into word-level units. A group ends when the chunk's
 *  lyric ends in whitespace, is empty, or is the last chunk. Mirrors
 *  the in-app `groupByWords` helper. */
function groupChunksByWord(chunks: Chunk[]): Chunk[][] {
  const groups: Chunk[][] = [];
  let current: Chunk[] = [];
  for (let i = 0; i < chunks.length; i++) {
    current.push(chunks[i]!);
    const lyric = chunks[i]!.lyric;
    if (lyric === '' || /\s$/.test(lyric) || i === chunks.length - 1) {
      groups.push(current);
      current = [];
    }
  }
  if (current.length) groups.push(current);
  // Merge trailing chord-only groups (no real text, just padding) back
  // into the last group with actual lyrics, so trailing chords don't
  // wrap onto a line by themselves.
  if (groups.length > 1) {
    let lastTextIdx = groups.length - 1;
    while (lastTextIdx >= 0 && !groups[lastTextIdx]!.some((c) => c.lyric.trim() !== '')) lastTextIdx--;
    if (lastTextIdx >= 0 && lastTextIdx < groups.length - 1) {
      for (let i = lastTextIdx + 1; i < groups.length; i++) {
        groups[lastTextIdx] = [...groups[lastTextIdx]!, ...groups[i]!];
      }
      groups.length = lastTextIdx + 1;
    }
  }
  return groups;
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
  chunkDiagrams?: Record<string, string>,
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
  const renderSectionChip = (label: string, kind: 'section' | 'comment'): string => {
    const ss = style.section;
    const bg = ss.background || 'var(--accent)';
    const color = ss.color || 'white';
    const fs = ss.fontSize ? `${ss.fontSize}px` : '0.82em';
    const upper = style.sectionUppercase ? 'uppercase' : 'none';
    const margin = kind === 'section' ? '8px 0 2px' : '6px 0 3px';
    return `<div style="display:inline-block;background:${bg};color:${color};font-family:inherit;font-weight:700;font-size:${fs};letter-spacing:0.06em;text-transform:${upper};padding:2px 8px;border-radius:4px;margin:${margin};">${escapeHtml(label)}</div>`;
  };

  if (line.isSection) {
    const tok = line.tokens[0];
    const label = tok?.type === 'section' ? tok.label : undefined;
    if (!label) return '';
    return renderSectionChip(label, 'section');
  }

  if (line.isComment) {
    const tok = line.tokens[0];
    const text = tok?.type === 'comment' ? tok.text : '';
    if (!text) return '';
    return renderSectionChip(text, 'comment');
  }

  if (line.isDirective) return '';

  // Lyric-bearing line.
  const chordColor = style.chords.color || '#4b73ff';
  const chordFontSize = style.chords.fontSize ? `${style.chords.fontSize}px` : undefined;

  if (line.hasChords && lyricsOnly) {
    const lyrics = line.tokens.filter((t) => t.type === 'lyric').map((t) => (t as { text: string }).text).join('');
    // Tight line-height keeps successive lyric lines from inflating
    // half-leading, which would otherwise throw off the visual
    // centering of any chord-line diagrams between them.
    return `<div style="line-height:1.4;">${escapeHtml(lyrics) || '&nbsp;'}</div>`;
  }

  if (line.hasChords) {
    return renderChordLyricLine(
      line,
      chordColor,
      chordFontSize,
      layout === 'inline-diagrams' ? inlineDiagrams : undefined,
      // chunkDiagrams only kicks in for the regular chord layout —
      // the inline-diagrams branch has its own diagram pathway above.
      layout !== 'inline-diagrams' ? chunkDiagrams : undefined,
      // Style threaded through so renderChordLyricLine can read the
      // lyric font size (used to scale diagram width, line height,
      // long-dash width, etc.).
      style,
    );
  }

  const text = line.tokens.map((t) => ((t as { text?: string }).text ?? '')).join('');
  return `<div style="line-height:1.4;">${escapeHtml(text) || '&nbsp;'}</div>`;
}

function renderSongBody(
  parsed: ParsedSong,
  layout: ExportLayout,
  style: SongViewStyle,
  inlineDiagrams?: Record<string, string>,
  chordGrids?: Record<number, string>,
  chunkDiagrams?: Record<string, string>,
): string {
  const groups = groupLines(parsed.lines);
  const chorusBorder = style.chorusBorderColor || '#4b73ff';

  // True when a line carries chords but its lyric tokens are empty /
  // whitespace only — a "chord row" that visually belongs to the
  // following lyric line. We pair such a row with its successor inside
  // a single break-inside:avoid wrapper so the print engine never
  // strands the chords at the bottom of a page.
  const isChordOnly = (line: ParsedLine): boolean => {
    if (!line.hasChords) return false;
    return line.tokens
      .filter((t) => t.type === 'lyric')
      .every((t) => (t as { text: string }).text.trim().length === 0);
  };
  const isAnchor = (line: ParsedLine | undefined): boolean =>
    !!line && !line.isEmpty && !line.isSection && !line.isSectionEnd && !line.isDirective;
  // First pass: flatten all lines across groups and figure out which
  // lines are "successors" of a chord-only line. A successor is the
  // next non-empty/non-section/non-directive line — searched across
  // group boundaries because a chord-only row often sits at the end
  // of a chorus block (its anchor lyric lives in the next group).
  // We also tag every chord-only line that has a real anchor so the
  // line renderer can stick a break-after:avoid on it.
  const flat = parsed.lines;
  const chordOnlyWithAnchor = new Set<number>();
  const successorOf = new Map<number, number>(); // chordOnlyIdx -> anchorIdx
  for (let i = 0; i < flat.length; i++) {
    if (!isChordOnly(flat[i]!)) continue;
    for (let j = i + 1; j < flat.length; j++) {
      if (isAnchor(flat[j]!)) {
        chordOnlyWithAnchor.add(i);
        successorOf.set(i, j);
        break;
      }
      // Walk past blanks/section markers — they don't anchor the chords.
    }
  }
  // Render a single group's inner content, wrapping any same-group
  // chord-only-and-anchor pairs in a keep-together box.
  const renderGroup = (group: typeof groups[number]): string => {
    const renderedSlots: string[] = [];
    for (let li = 0; li < group.lines.length; li++) {
      const line = group.lines[li]!;
      const absIdx = group.startIndex + li;

      if (isChordOnly(line) && chordOnlyWithAnchor.has(absIdx)) {
        const anchorIdx = successorOf.get(absIdx)!;
        const sameGroup = anchorIdx >= group.startIndex && anchorIdx < group.startIndex + group.lines.length;
        if (sameGroup) {
          const upTo = anchorIdx - group.startIndex;
          const slice: string[] = [];
          for (let k = li; k <= upTo; k++) {
            slice.push(renderLineHtml(group.lines[k]!, group.startIndex + k, style, layout, inlineDiagrams, chordGrids, chunkDiagrams));
          }
          renderedSlots.push(`<div style="page-break-inside:avoid;break-inside:avoid;">${slice.join('')}</div>`);
          li = upTo;
          continue;
        }
      }

      renderedSlots.push(renderLineHtml(line, absIdx, style, layout, inlineDiagrams, chordGrids, chunkDiagrams));
    }
    const inner = renderedSlots.join('');
    if (group.bordered) {
      return `<div style="border-left:3px solid ${chorusBorder};padding-left:14px;margin-left:2px;margin-top:4px;margin-bottom:4px;">${inner}</div>`;
    }
    return inner;
  };

  // Walk the groups in order. When the LAST anchor-bearing line of a
  // group's chord-only sequence has its anchor in the NEXT group,
  // emit BOTH groups inside a single outer keep-together wrapper.
  // Same-group pairs are already handled inside `renderGroup`; this
  // outer wrapper is the cross-group safety net.
  const out: string[] = [];
  for (let gi = 0; gi < groups.length; gi++) {
    const group = groups[gi]!;
    const lastLineIdx = group.startIndex + group.lines.length - 1;
    let spansNext = false;
    for (let absIdx = group.startIndex; absIdx <= lastLineIdx; absIdx++) {
      if (chordOnlyWithAnchor.has(absIdx)) {
        const anchorIdx = successorOf.get(absIdx)!;
        if (anchorIdx > lastLineIdx) {
          spansNext = true;
          break;
        }
      }
    }
    if (spansNext && gi + 1 < groups.length) {
      // Bundle current + next group inside a shared keep-together div.
      // Chromium honors break-inside:avoid much more reliably when the
      // constraint lives on a single shared parent than when it lives
      // on adjacent peers via break-after/break-before pairs.
      const a = renderGroup(group);
      const b = renderGroup(groups[gi + 1]!);
      out.push(`<!-- KEEP_TOGETHER spanning groups ${gi}..${gi + 1} --><div style="page-break-inside:avoid;break-inside:avoid;">${a}${b}</div>`);
      gi += 1; // consumed the next group too
    } else {
      out.push(renderGroup(group));
    }
  }
  return out.join('');
}

export function toHtml(song: Song, options?: ExportOptions): string {
  const parsed = getRenderableSong(song);
  const style = options?.style;
  const layout: ExportLayout = options?.layout ?? 'chords';

  // Fall back to a proportional sans-serif when the preset doesn't set a
  // font. Monospace is intentionally avoided here because the cast view's
  // chord-diagram mode pads inter-chord gaps with literal space chars —
  // monospace fonts render those as huge fixed-width gaps, breaking
  // visual rhythm for the audience.
  const fontFamily = style?.fontFamily || 'sans-serif';
  // Prefer the preset's lyrics color, then the theme's foreground; fall back
  // to dark grey so light-mode defaults still work when neither is supplied.
  const lyricsColor = style?.lyrics.color || options?.themeForeground || '#111';
  // Background: preset > theme bg > white. This is what makes dark-mode
  // exports match the song-view container instead of printing on white.
  const lyricsBackground = style?.lyrics.background || options?.themeBackground || '#fff';
  const lyricsFontSize = style?.lyrics.fontSize ? `${style.lyrics.fontSize}px` : '16px';
  const titleColor = style?.title.color || options?.themeForeground || '#111';
  const titleFontSize = style?.title.fontSize ? `${style.title.fontSize}px` : '28px';
  // Title background is intentionally ignored — many presets set a tinted
  // title chip (Midnight, Ember, Aurora…) which the user does not want
  // applied to exported documents. Other title styling (color / size /
  // font / uppercase) still comes from the preset.
  const titleBackground = 'transparent';
  const titleHasBg = false;
  const detailsColor = style?.details.color || options?.themeMuted || '#555';
  const detailsFontSize = style?.details.fontSize ? `${style.details.fontSize}px` : '14px';
  const detailsBackground = style?.details.background || 'transparent';
  const detailsHasBg = !!style?.details.background;
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

  const bodyHtml = renderSongBody(parsed, layout, style ?? DEFAULT_FALLBACK_STYLE, options?.inlineDiagrams, options?.chordGrids, options?.chunkDiagrams);
  const barHtml = layout === 'chords-with-bar' && options?.chordBarHtml ? options.chordBarHtml : '';
  const centered = options?.songCentered ?? false;
  const titleAlign = centered ? 'text-align:center;' : '';
  const bodyWrapStart = centered
    ? '<div style="width:fit-content;max-width:100%;margin:0 auto;">'
    : '<div>';
  const bodyWrapEnd = '</div>';

  // Inline CSS variables used by the ChordGrid SVG (stroke="var(--text-primary)"
  // etc.) and as fallbacks in section/comment chip styles when the preset
  // hasn't filled those slots. Each one prefers the live app theme value
  // (captured at export time) so the "Default" preset — which intentionally
  // leaves colors empty so it can adapt — looks correct in dark or light.
  const textPrimary = style?.lyrics.color || options?.themeForeground || '#111';
  const textSecondary = style?.details.color || options?.themeMuted || '#555';
  const chordColorVar = style?.chords.color || options?.themeChord || '#4b73ff';
  const accent = options?.themeAccent || '#6366f1';
  const sectionColorVar = options?.themeSection || '#64748b';

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
  /* Header block (title / artist / details) is always centered in HTML and
     PDF exports — independent of the song body's centering setting. */
  .song-header { text-align: center; margin-bottom: 1em; }
  h1.title { margin: 0 0 0.2em; color: ${titleColor}; font-size: ${titleFontSize}; font-family: ${fontFamily}; font-weight: 700; background: ${titleBackground}; ${titleHasBg ? 'padding:6px 10px;border-radius:6px;display:inline-block;' : ''} ${titleUppercase} }
  .artist { color: ${detailsColor}; font-size: ${detailsFontSize}; font-family: ${fontFamily}; margin-bottom: 0.35em; }
  .details { color: ${detailsColor}; font-size: ${detailsFontSize}; font-family: ${fontFamily}; margin-bottom: 0; background: ${detailsBackground}; ${detailsHasBg ? 'padding:6px 10px;border-radius:6px;' : ''} display:inline-flex; flex-wrap:wrap; justify-content:center; }
  /* Direct children only — otherwise the label/value sibling spans inside
     each detail would each get an extra "|" prepended. Use margin (not
     spaces inside content) because browsers collapse whitespace in CSS
     content strings. */
  .details > span + span::before { content: '|'; margin: 0 8px; color: ${detailsColor}; opacity: 0.5; }
  /* Song body: replicate SongRenderer root div — lineHeight 1.8 + the
     picked font-family (monospace when the preset has none). */
  .body { margin-top: 1em; font-size: ${lyricsFontSize}; line-height: 1.8; font-family: ${fontFamily}; color: ${lyricsColor}; }
  @media print {
    /* Per-page margins via CSS @page so every page (not just first/last)
       has space on top, bottom, and sides. Chromium's printToPDF honours
       these when preferCSSPageSize is true. */
    @page { margin: 2cm 2cm; }
    body { max-width: none; margin: 0; padding: 0; background: ${lyricsBackground}; }
    * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
  }
</style>
</head>
<body>
<div class="song-header">
  <h1 class="title">${escapeHtml(style?.titleUppercase ? song.title : toTitleCase(song.title))}</h1>
  ${song.artist ? `<div class="artist">${escapeHtml(toTitleCase(song.artist))}</div>` : ''}
  ${details.length ? `<div class="details">${details.map((d) => `<span>${d}</span>`).join('')}</div>` : ''}
</div>
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

// Build a filesystem-safe version of the song title in Title Case — spaces
// stay as spaces, only characters illegal in filenames get stripped.
function titleCaseFilename(s: string): string {
  const cased = toTitleCase(s.trim());
  // Strip characters Windows/macOS disallow in filenames: \ / : * ? " < > |
  const cleaned = cased.replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, ' ').trim();
  return cleaned || 'Song';
}

/** Per-song layout extras used by binder export — the modal pre-renders
 * each song's chord-bar SVGs / inline diagrams / chord grids so the binder
 * pages match the on-screen rendering exactly. */
export interface PerSongExtras {
  chordBarHtml?: string;
  inlineDiagrams?: Record<string, string>;
  chordGrids?: Record<number, string>;
}

/** Builds the per-song block (title, artist, details, body) used inside the
 * binder PDF — everything that would go between `<body>` and `</body>` in
 * toHtml, but without the outer document / shared styles. */
function renderSongBlock(song: Song, options?: ExportOptions, extras?: PerSongExtras, anchorId?: string, withPageBreak?: boolean): string {
  const parsed = getRenderableSong(song);
  const style = options?.style;
  const layout: ExportLayout = options?.layout ?? 'chords';
  const transposeSteps = song.preferences?.transposeSteps ?? 0;
  const displayKey = song.key ? transposeKey(song.key, transposeSteps) : undefined;
  const detailsColor = style?.details.color || '#555';
  const lbl = (t: string) => `<span style="font-weight:700;color:${detailsColor};">${escapeHtml(t)}</span>`;
  const val = (t: string | number) => `<span style="font-weight:400;opacity:0.85;color:${detailsColor};">${escapeHtml(String(t))}</span>`;
  const details: string[] = [];
  if (displayKey)                  details.push(`${lbl('Key: ')}${val(displayKey)}`);
  if (song.capo && song.capo > 0)  details.push(`${lbl('Capo: ')}${val(song.capo)}`);
  if (transposeSteps !== 0)        details.push(`${lbl('Transpose: ')}${val((transposeSteps > 0 ? '+' : '') + transposeSteps)}`);
  if (song.tempo)                  details.push(`${lbl('Tempo: ')}${val(`${song.tempo} BPM`)}`);
  if (song.timeSig)                details.push(`${lbl('Time: ')}${val(song.timeSig)}`);
  const bodyHtml = renderSongBody(
    parsed,
    layout,
    style ?? DEFAULT_FALLBACK_STYLE,
    layout === 'inline-diagrams' ? extras?.inlineDiagrams : undefined,
    extras?.chordGrids,
  );
  const barHtml = layout === 'chords-with-bar' ? (extras?.chordBarHtml ?? '') : '';
  // The `id` on the <h1> covers HTML navigation (which doesn't
  // suffer Chromium's +1-page PDF offset bug). For PDF, the binder
  // emits a separate <a name> sentinel at the END of the previous
  // song's section — see toBinderHtml — so Chromium's offset bumps
  // the link target forward to the correct page.
  // `withPageBreak` is no longer used here (the binder owns the
  // page-break placement on the section wrapper); accept it for
  // API compatibility and ignore.
  void withPageBreak;
  const titleIdAttr = anchorId ? ` id="${anchorId}"` : '';
  return `
<div class="song-header">
  <h1 class="title"${titleIdAttr}>${escapeHtml(style?.titleUppercase ? song.title : toTitleCase(song.title))}</h1>
  ${song.artist ? `<div class="artist">${escapeHtml(toTitleCase(song.artist))}</div>` : ''}
  ${details.length ? `<div class="details">${details.map((d) => `<span>${d}</span>`).join('')}</div>` : ''}
</div>
${barHtml}
<div class="body">${bodyHtml}</div>`;
}

/** Assemble a single HTML document containing every song, with a page break
 * between each one, suitable for `savePdf`. Optional front-matter lists the
 * songs as a simple TOC on the first page. `perSongExtras`, when supplied,
 * provides each song's chord-bar / inline-diagrams / chord-grid markup
 * (keyed by `song.id`) so the layout chosen in the export modal renders
 * identically to the in-app song view. */
export function toBinderHtml(
  songs: Song[],
  bookTitle: string,
  options?: ExportOptions,
  perSongExtras?: Record<string, PerSongExtras>,
): string {
  const style = options?.style;
  const fontFamily = style?.fontFamily || 'sans-serif';
  const lyricsColor = style?.lyrics.color || options?.themeForeground || '#111';
  const lyricsBackground = style?.lyrics.background || options?.themeBackground || '#fff';
  const lyricsFontSize = style?.lyrics.fontSize ? `${style.lyrics.fontSize}px` : '16px';
  const titleColor = style?.title.color || options?.themeForeground || '#111';
  const titleFontSize = style?.title.fontSize ? `${style.title.fontSize}px` : '28px';
  // Title background is intentionally ignored — many presets set a tinted
  // title chip (Midnight, Ember, Aurora…) which the user does not want
  // applied to exported documents. Other title styling (color / size /
  // font / uppercase) still comes from the preset.
  const titleBackground = 'transparent';
  const titleHasBg = false;
  const titleUppercase = style?.titleUppercase ? 'text-transform:uppercase;' : '';
  const detailsColor = style?.details.color || options?.themeMuted || '#555';
  const detailsFontSize = style?.details.fontSize ? `${style.details.fontSize}px` : '14px';
  const detailsBackground = style?.details.background || 'transparent';
  const detailsHasBg = !!style?.details.background;
  const textPrimary = style?.lyrics.color || options?.themeForeground || '#111';
  const textSecondary = style?.details.color || options?.themeMuted || '#555';
  const chordColorVar = style?.chords.color || options?.themeChord || '#4b73ff';
  const accent = options?.themeAccent || '#6366f1';
  const sectionColorVar = options?.themeSection || '#64748b';

  // Anchor IDs match between TOC entries and per-song sections so the
  // Contents page acts as a clickable nav in HTML and as a PDF
  // bookmark-style link target in viewers that honour internal links.
  // Using index-based slugs (song-1, song-2, ...) keeps the anchors
  // stable regardless of song title characters.
  const songAnchorId = (i: number) => `song-${i + 1}`;

  const toc = songs.map((s, i) => {
    const artist = s.artist ? ` — ${escapeHtml(toTitleCase(s.artist))}` : '';
    const anchor = songAnchorId(i);
    return `<li><a class="toc-link" href="#${anchor}"><span class="toc-num">${i + 1}.</span> ${escapeHtml(toTitleCase(s.title))}${artist}</a></li>`;
  }).join('');

  // Chromium's printToPDF has a stubborn +1-page offset bug on
  // internal anchor links: <a href="#X"> lands ONE page after the
  // page where id="X" actually renders. The bug persists regardless
  // of where in the target section the anchor is placed.
  //
  // Workaround: pre-compensate. For each song i (i >= 1), we render
  // a legacy <a name="song-i"> sentinel at the BOTTOM of the previous
  // song's section. Chromium's +1 offset then bumps the link target
  // forward by exactly one page — landing on the actual title page of
  // song i. The <h1> still carries id="song-i" so HTML navigation
  // (no offset bug) works correctly.
  //
  // <a name> is the legacy named-anchor mechanism — it doesn't share
  // the namespace with `id` attributes, so emitting both is valid
  // HTML5 and the duplicates don't fight each other.
  const pages = songs.map((s, i) => {
    const anchor = songAnchorId(i);
    const block = renderSongBlock(s, options, perSongExtras?.[s.id], anchor);
    const pageBreakStyle = i === 0 ? '' : 'page-break-before: always; break-before: page;';
    // Sentinel for the NEXT song, placed at the end of THIS section.
    // No sentinel for the last song (no song after it).
    const nextSentinel = i + 1 < songs.length
      ? `<a name="${songAnchorId(i + 1)}" style="display:block;height:0;line-height:0;font-size:0;"></a>`
      : '';
    return `<section class="song-section" style="${pageBreakStyle}">${block}${nextSentinel}</section>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeHtml(bookTitle)}</title>
<style>
  :root {
    color-scheme: light dark;
    --text-primary: ${textPrimary};
    --text-secondary: ${textSecondary};
    --chord-color: ${chordColorVar};
    --accent: ${accent};
    --section-color: ${sectionColorVar};
  }
  html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body, * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { font-family: ${fontFamily}; max-width: 860px; margin: 2em auto; padding: 0 1.5em; background: ${lyricsBackground}; color: ${lyricsColor}; font-size: ${lyricsFontSize}; }
  /* Per-song header block is always centered in the binder. */
  .song-header { text-align: center; margin-bottom: 1em; }
  h1.title { margin: 0 0 0.2em; color: ${titleColor}; font-size: ${titleFontSize}; font-family: ${fontFamily}; font-weight: 700; background: ${titleBackground}; ${titleHasBg ? 'padding:6px 10px;border-radius:6px;display:inline-block;' : ''} ${titleUppercase} }
  .artist { color: ${detailsColor}; font-size: ${detailsFontSize}; font-family: ${fontFamily}; margin-bottom: 0.35em; }
  .details { color: ${detailsColor}; font-size: ${detailsFontSize}; font-family: ${fontFamily}; margin-bottom: 0; background: ${detailsBackground}; ${detailsHasBg ? 'padding:6px 10px;border-radius:6px;' : ''} display:inline-flex; flex-wrap:wrap; justify-content:center; }
  .details > span + span::before { content: '|'; margin: 0 8px; color: ${detailsColor}; opacity: 0.5; }
  .body { margin-top: 1em; font-size: ${lyricsFontSize}; line-height: 1.8; font-family: ${fontFamily}; color: ${lyricsColor}; }
  .cover { text-align: center; margin-top: 25vh; }
  .cover h1 { font-size: 36px; color: ${titleColor}; margin-bottom: 0.3em; }
  .cover p { color: ${detailsColor}; font-size: ${detailsFontSize}; }
  .toc { page-break-after: always; }
  .toc h2 { color: ${titleColor}; font-size: 22px; margin-bottom: 0.6em; }
  .toc ol { list-style: none; padding: 0; margin: 0; }
  /* Roomier TOC rows in HTML view (~14px top/bottom). Print keeps a
     tighter 4px so the contents page stays compact in PDF binder
     output. */
  .toc li { padding: 14px 0; border-bottom: 1px solid ${detailsColor}33; color: ${lyricsColor}; font-size: ${lyricsFontSize}; }
  /* Per-song section spacing in HTML — page-break-before only kicks
     in for print, so without this rule the songs would visually
     collide on screen. Print mode resets it so the page-break does
     all the separating. */
  .song-section { margin: 64px 0; }
  @media print {
    .toc li { padding: 4px 0; }
    .song-section { margin: 0; }
  }
  .toc .toc-num { display: inline-block; width: 2.2em; color: ${detailsColor}; font-variant-numeric: tabular-nums; }
  /* Clickable TOC entries: each row is wrapped in an anchor that
     targets a per-song section. Inherit the surrounding color so the
     link does not pop visually (the underline-on-hover signals the
     interactivity in HTML view; in PDF the link works without the
     underline, like every other link). */
  .toc .toc-link { color: inherit; text-decoration: none; display: block; }
  .toc .toc-link:hover { text-decoration: underline; }
  @media print {
    .toc .toc-link { text-decoration: none; }
  }
  @media print {
    /* Per-page margins via CSS @page so every page (not just first/last)
       has space on top, bottom, and sides. Chromium's printToPDF honours
       these when preferCSSPageSize is true. */
    @page { margin: 2.5cm 2cm; }
    body { max-width: none; margin: 0; padding: 0; background: ${lyricsBackground}; }
    * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
  }
</style>
</head>
<body>
<section class="cover">
  <h1>${escapeHtml(bookTitle)}</h1>
  <p>${songs.length} song${songs.length === 1 ? '' : 's'}</p>
</section>
<section class="toc" style="page-break-before: always;">
  <h2>Contents</h2>
  <ol>${toc}</ol>
</section>
${pages}
</body>
</html>`;
}

/** Render a multi-song binder to PDF via the same IPC used for single-song
 * exports. `bookTitle` becomes both the document title and the file name. */
export async function printBinderPdf(
  songs: Song[],
  bookTitle: string,
  options?: ExportOptions,
  perSongExtras?: Record<string, PerSongExtras>,
): Promise<void> {
  if (songs.length === 0) return;
  const html = toBinderHtml(songs, bookTitle, options, perSongExtras);
  const slug = titleCaseFilename(bookTitle);
  const bg = options?.style?.lyrics.background || options?.themeBackground;
  const api = window.electronAPI?.pdf?.savePdf;
  if (!api) {
    alert('PDF export requires a full app restart to pick up a new Electron handler. Please close and reopen the app.');
    return;
  }
  const result = await api(html, slug, bg);
  if (result?.error) alert(`Could not save PDF: ${result.error}`);
}

export async function printSongPdf(song: Song, options?: ExportOptions): Promise<void> {
  const html = toHtml(song, options);
  const slug = titleCaseFilename(song.title);
  // The background color from the theme also gets threaded to the main
  // process so the top/bottom @page margin strips can be painted via
  // header/footer templates — otherwise they print as white bands.
  const bg = options?.style?.lyrics.background || options?.themeBackground;
  const api = window.electronAPI?.pdf?.savePdf;
  if (!api) {
    alert('PDF export requires a full app restart to pick up a new Electron handler. Please close and reopen the app.');
    return;
  }
  const result = await api(html, slug, bg);
  if (result?.error) {
    alert(`Could not save PDF: ${result.error}`);
  }
}

export function exportSong(song: Song, format: ExportFormat, options?: ExportOptions): void {
  if (format === 'pdf') {
    void printSongPdf(song, options);
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
  const filename = `${titleCaseFilename(song.title)}.${cfg.ext}`;
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

/** Export multiple songs.
 *  - PDF / HTML: one "binder" document with a title page, TOC, and a page
 *    per song. The active layout (chord names / chord-bar / inline diagrams
 *    / lyrics-only) is honoured per song via `perSongExtras`.
 *  - ChordPro / plain text: writes one file per song into a folder picked
 *    by the user (a sub-folder named after `bookTitle` is created inside it).
 *  - JSON: a single file with an array of every song's full record.
 */
export async function exportSongs(
  songs: Song[],
  format: ExportFormat,
  bookTitle: string,
  options?: ExportOptions,
  perSongExtras?: Record<string, PerSongExtras>,
): Promise<void> {
  if (songs.length === 0) return;
  if (songs.length === 1) {
    exportSong(songs[0]!, format, options);
    return;
  }
  if (format === 'pdf') {
    await printBinderPdf(songs, bookTitle, options, perSongExtras);
    return;
  }
  if (format === 'html') {
    const html = toBinderHtml(songs, bookTitle, options, perSongExtras);
    const filename = `${titleCaseFilename(bookTitle)}.html`;
    saveBlob(html, 'text/html', filename);
    return;
  }
  if (format === 'json') {
    const filename = `${titleCaseFilename(bookTitle)}.json`;
    saveBlob(JSON.stringify(songs, null, 2), 'application/json', filename);
    return;
  }
  // ChordPro / plain text — one file per song, written into a folder.
  const cfg = EXPORT_FORMATS.find((f) => f.id === format)!;
  const used = new Set<string>();
  const files = songs.map((s) => {
    let base = titleCaseFilename(s.title);
    if (used.has(base.toLowerCase())) {
      let i = 2;
      while (used.has(`${base} (${i})`.toLowerCase())) i++;
      base = `${base} (${i})`;
    }
    used.add(base.toLowerCase());
    const content = format === 'chordpro' ? toChordPro(s) : toPlainText(s);
    return { filename: `${base}.${cfg.ext}`, content };
  });
  const api = window.electronAPI?.files?.saveSongsFolder;
  if (!api) {
    alert('Folder export requires a full app restart to pick up a new Electron handler. Please close and reopen the app.');
    return;
  }
  const result = await api(titleCaseFilename(bookTitle), files);
  if (result.error) alert(`Could not save folder: ${result.error}`);
}

function saveBlob(content: string, mime: string, filename: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
