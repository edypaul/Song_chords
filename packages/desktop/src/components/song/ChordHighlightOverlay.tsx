import React, { useMemo } from 'react';
import { tokenizeChordSpans } from '@song-chords/shared';

/** Visual style for a section directive, taken from the active song-view
 *  style preset's `section` slot so the editor matches the song view. */
export interface SectionStyleProps {
  /** Section text color (preset `section.color`, defaults to white). */
  sectionColor?: string;
  /** Section chip background (preset `section.background`, defaults accent). */
  sectionBackground?: string;
}

interface Props extends SectionStyleProps {
  /** The exact text shown in the textarea this sits behind. */
  text: string;
  /** Chord color from the active style preset (songViewStyle.chords.color). */
  chordColor: string;
  /** Live scrollTop of the textarea, mirrored so highlights track typing. */
  scrollTop: number;
  scrollLeft: number;
}

/**
 * A line is a "section directive" when it's a single `{...}` brace
 * directive that the parser turns into a section TITLE — i.e. `{c: …}`,
 * `{comment: …}`, a known section keyword ({verse}, {chorus}, …), or a
 * free-form `{Section Name}`. It is NOT a structural / metadata / layout
 * directive ({sog}, {eog}, {pause: N}, {title: …}, {key: …}, …), which
 * render as plain text in the editor.
 *
 * A brace line is chip-styled ONLY when the song view would actually
 * render it as a visible section TITLE. The previous version tried to
 * EXCLUDE a hand-listed set of structural directives, but that missed the
 * start-of-section family ({soc}, {sov}, …) so e.g. {soc} was wrongly
 * chipped while its matching {eoc} was not. The rule below instead mirrors
 * the parser: a directive is a title only if it carries actual label text.
 *
 * Title lines (chip-styled):
 *   - {c: TEXT} / {comment: TEXT}          (a label after the colon/space)
 *   - {Free-form Name}                     (a brace whose name is NOT a known
 *                                           structural / section / metadata
 *                                           keyword — a user-written label)
 * NOT titles (plain text):
 *   - bare keyword directives: {soc} {eoc} {sov} {eov} {sog} {eog}
 *     {verse} {chorus} {bridge} {intro} … (no label text → no chip in the
 *     song view), and all {key:…}/{tempo:…}/etc. metadata + {pause:N}.
 */
const DIRECTIVE_LINE_RE = /^\s*\{([\w-]+)(?:[:\s]+(.*?))?\s*\}\s*$/;

// Reserved directive names the parser recognises structurally — none of
// these, on their own, produce a visible section-title chip.
const KNOWN_DIRECTIVES = new Set([
  // Section keywords (chordpro-parser SECTION_DIRECTIVES)
  'verse', 'v', 'sov', 'chorus', 'c', 'soc', 'bridge',
  'pre-chorus', 'prechorus', 'intro', 'outro', 'tag', 'interlude',
  // End-of-section
  'eoc', 'end_of_chorus', 'eov', 'end_of_verse', 'end_of_bridge', 'eob', 'sob',
  // Grid
  'sog', 'start_of_grid', 'eog', 'end_of_grid',
  // Auto-scroll
  'pause',
  // Metadata (chordpro-parser METADATA_DIRECTIVES)
  'title', 't', 'artist', 'a', 'subtitle', 'st', 'album',
  'key', 'k', 'tempo', 'metronome', 'bpm', 'capo', 'time',
  'duration', 'length', 'copyright', 'ccli', 'composer', 'year', 'meta',
]);

/** Offsets of section-TITLE directive lines within `text`. */
function sectionLineSpans(text: string): Array<{ start: number; end: number }> {
  const spans: Array<{ start: number; end: number }> = [];
  let offset = 0;
  for (const line of text.split('\n')) {
    const m = DIRECTIVE_LINE_RE.exec(line);
    if (m) {
      const name = (m[1] ?? '').toLowerCase();
      const value = (m[2] ?? '').trim();
      // A line is a section TITLE when it has visible label text:
      //   • {c: …} / {comment: …} with a value, OR
      //   • a free-form {Name} whose keyword isn't a known directive.
      const isLabelledComment = (name === 'c' || name === 'comment') && value.length > 0;
      const isFreeForm = !KNOWN_DIRECTIVES.has(name);
      if (isLabelledComment || isFreeForm) {
        // Style the trimmed brace span only (not surrounding spaces), so
        // the highlight hugs the `{...}` text and stays caret-aligned.
        const lead = line.length - line.trimStart().length;
        const trimmed = line.trim();
        spans.push({ start: offset + lead, end: offset + lead + trimmed.length });
      }
    }
    offset += line.length + 1; // +1 for the '\n'
  }
  return spans;
}

type Segment = { text: string; kind: 'chord' | 'section' | 'plain' };

/** Split `text` into chord / section / plain segments. Section spans
 *  (whole `{...}` lines) take precedence over chord spans inside them
 *  (a directive line never contains a playable chord anyway). */
function buildSegments(text: string): Segment[] {
  const chords = tokenizeChordSpans(text).map((s) => ({ start: s.start, end: s.end, kind: 'chord' as const }));
  const sections = sectionLineSpans(text).map((s) => ({ ...s, kind: 'section' as const }));
  // Drop any chord span that falls inside a section line.
  const chordsOutside = chords.filter((c) => !sections.some((s) => c.start >= s.start && c.end <= s.end));
  const marks = [...sections, ...chordsOutside].sort((a, b) => a.start - b.start);
  const out: Segment[] = [];
  let cursor = 0;
  for (const mk of marks) {
    if (mk.start > cursor) out.push({ text: text.slice(cursor, mk.start), kind: 'plain' });
    out.push({ text: text.slice(mk.start, mk.end), kind: mk.kind });
    cursor = mk.end;
  }
  out.push({ text: text.slice(cursor), kind: 'plain' });
  return out;
}

/** Inline style for a section segment — mirrors the song view's chip
 *  (preset section color + background) but kept inline so the overlay
 *  text stays aligned with the textarea caret behind it. */
function sectionSpanStyle(props: SectionStyleProps): React.CSSProperties {
  return {
    color: props.sectionColor || 'white',
    background: props.sectionBackground || 'var(--accent)',
    fontWeight: 700,
    borderRadius: 3,
    // Horizontal-only padding via box-shadow so the text box width (and
    // thus caret alignment) is unchanged — a real `padding` would shift
    // every following glyph out of sync with the transparent textarea.
    boxShadow: `0 0 0 2px ${props.sectionBackground || 'var(--accent)'}`,
  };
}

/**
 * A render-only backdrop that colors chord tokens in the song editor.
 *
 * A <textarea> can't style runs of its own text, so the standard
 * technique is used: this div is positioned EXACTLY under a textarea
 * whose own text is transparent (caret + selection stay visible). It
 * renders the identical text with chord tokens wrapped in colored
 * spans, and is scroll-synced to the textarea. Every box-model and
 * font property MUST match the textarea or the colored text drifts
 * out of alignment with the caret — see the shared style object the
 * Song tab applies to both.
 *
 * Chord detection reuses the shared `tokenizeChordSpans`, so what gets
 * colored is exactly what the format converters / bulk-replace treat
 * as a chord (inline ChordPro `[D]` and standalone chord lines), and
 * never a chord-looking word inside lyrics.
 */
export default function ChordHighlightOverlay({
  text,
  chordColor,
  sectionColor,
  sectionBackground,
  scrollTop,
  scrollLeft,
}: Props): React.ReactElement {
  const segments = useMemo(() => {
    const segs = buildSegments(text);
    // Append a zero-width-safe newline guard so a text ending in '\n'
    // keeps the same height as the textarea.
    if (segs.length && segs[segs.length - 1]!.kind === 'plain') {
      segs[segs.length - 1] = { ...segs[segs.length - 1]!, text: segs[segs.length - 1]!.text + '\n' };
    } else {
      segs.push({ text: '\n', kind: 'plain' });
    }
    return segs;
  }, [text]);

  return (
    <div
      aria-hidden="true"
      className="chord-hl-overlay"
      style={{
        // Painted under the transparent-text textarea; the textarea is
        // the interactive layer on top.
        position: 'absolute',
        inset: 0,
        overflow: 'hidden',
        pointerEvents: 'none',
        // Mirror the textarea's scroll by translating the inner content.
        // (Using transform avoids a second scrollbar.)
      }}
    >
      <div
        style={{
          transform: `translate(${-scrollLeft}px, ${-scrollTop}px)`,
          whiteSpace: 'pre-wrap',
          overflowWrap: 'break-word',
          // These MUST match the textarea exactly.
          padding: 16, // = Tailwind p-4
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
          fontSize: 14, // = text-sm
          lineHeight: 1.6,
          // The textarea on top has transparent text, so THIS overlay
          // is the only visible copy — it must paint EVERYTHING:
          // lyrics/plain text in the normal editor color, chords in
          // the preset accent. (It was `transparent` here, which hid
          // the lyrics entirely — only the per-chord spans showed.)
          color: 'var(--text-primary)',
        }}
      >
        {segments.map((seg, i) =>
          seg.kind === 'chord' ? (
            <span key={i} style={{ color: chordColor, fontWeight: 600 }}>
              {seg.text}
            </span>
          ) : seg.kind === 'section' ? (
            <span key={i} style={sectionSpanStyle({ sectionColor, sectionBackground })}>
              {seg.text}
            </span>
          ) : (
            <span key={i}>{seg.text}</span>
          ),
        )}
      </div>
    </div>
  );
}

/**
 * Read-only, self-scrolling chord-colored preview of a piece of song
 * text. Used by the Song-tab "Split view": the pane whose format does
 * NOT match the live editor shows the other representation here,
 * derived one-way from `content`.
 *
 * Unlike the editable side, a preview has NO caret to keep aligned, so
 * it does NOT need the transparent-textarea + absolute translating
 * overlay trick. That earlier approach (a transparent spacer to
 * establish scroll height + an `position:absolute; inset:0` overlay
 * translated by a manual scroll listener) failed to fill the pane and
 * never produced a scrollbar. This is just a normal block element
 * that renders the colored text directly and scrolls natively —
 * `flex:1` makes it fill the flex-column pane, `overflow:auto` gives
 * a real vertical scrollbar when the song is taller than the pane.
 */
export function ChordPreviewPane({
  text,
  chordColor,
  sectionColor,
  sectionBackground,
  scrollRef,
  onScroll,
}: SectionStyleProps & {
  text: string;
  chordColor: string;
  /** Ref to the scrollable element so the parent can sync its scroll
   *  position with the editor pane in split view. */
  scrollRef?: React.Ref<HTMLDivElement>;
  /** Fires on native scroll so the parent can mirror it onto the
   *  editor textarea. */
  onScroll?: React.UIEventHandler<HTMLDivElement>;
}): React.ReactElement {
  const segments = useMemo(() => buildSegments(text), [text]);

  return (
    <div
      ref={scrollRef}
      onScroll={onScroll}
      className="chord-preview-pane"
      style={{
        // Fill the flex-column pane and scroll natively. No absolute
        // positioning / spacer / scroll-sync — the content itself is
        // the scrollable flow, so it always uses the full height and
        // shows a vertical scrollbar on overflow.
        flex: 1,
        minHeight: 0,
        height: '100%',
        overflow: 'auto',
        background: 'var(--bg)',
        whiteSpace: 'pre-wrap',
        overflowWrap: 'break-word',
        padding: 16,
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
        fontSize: 14,
        lineHeight: 1.6,
        color: 'var(--text-primary)',
      }}
    >
      {segments.map((seg, i) =>
        seg.kind === 'chord' ? (
          <span key={i} style={{ color: chordColor, fontWeight: 600 }}>
            {seg.text}
          </span>
        ) : seg.kind === 'section' ? (
          <span key={i} style={sectionSpanStyle({ sectionColor, sectionBackground })}>
            {seg.text}
          </span>
        ) : (
          <span key={i}>{seg.text}</span>
        ),
      )}
    </div>
  );
}
