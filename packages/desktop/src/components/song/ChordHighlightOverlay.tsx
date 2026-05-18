import React, { useMemo } from 'react';
import { tokenizeChordSpans } from '@song-chords/shared';

interface Props {
  /** The exact text shown in the textarea this sits behind. */
  text: string;
  /** Chord color from the active style preset (songViewStyle.chords.color). */
  chordColor: string;
  /** Live scrollTop of the textarea, mirrored so highlights track typing. */
  scrollTop: number;
  scrollLeft: number;
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
  scrollTop,
  scrollLeft,
}: Props): React.ReactElement {
  const segments = useMemo(() => {
    const spans = tokenizeChordSpans(text);
    const out: Array<{ text: string; chord: boolean }> = [];
    let cursor = 0;
    for (const s of spans) {
      if (s.start > cursor) out.push({ text: text.slice(cursor, s.start), chord: false });
      out.push({ text: text.slice(s.start, s.end), chord: true });
      cursor = s.end;
    }
    // Trailing remainder. Append a zero-width-safe newline guard so a
    // text ending in '\n' keeps the same height as the textarea.
    out.push({ text: text.slice(cursor) + '\n', chord: false });
    return out;
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
          seg.chord ? (
            <span key={i} style={{ color: chordColor, fontWeight: 600 }}>
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
