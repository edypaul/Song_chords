import React, { useMemo } from 'react';
import type { ParsedLine, ChordToken, LyricToken, SectionStyle, InstrumentType } from '@song-chords/shared';
import { getDiagramExact, getDiagramByIndex, useSettingsStore, formatChord } from '@song-chords/shared';
import type { SongViewStyle } from '@song-chords/shared';
import ChordDiagramSVG from '../chord-diagram/ChordDiagramSVG';
import { useSongTrainerStore, isHiddenAtPercentage } from '../../store/song-trainer-store';

interface Props {
  line: ParsedLine;
  showChords: boolean;
  onChordClick?: (chord: string) => void;
  chordStyle?: SectionStyle;
  inlineDiagrams?: boolean;
  instrument?: InstrumentType;
  svs?: SongViewStyle;
  chordVariations?: Record<string, number>;
  /** Song trainer inputs — passed together so the same line can be
   *  rendered under different songs / positions without collisions. The
   *  trainer only activates when `trainerEnabled` is true AND
   *  `inlineDiagrams` is false (it's a chord-names-over-lyrics feature).
   *  Undefined values simply skip the masking. */
  songId?: string;
  sectionIndex?: number;
  lineIndex?: number;
  trainerEnabled?: boolean;
}

interface Chunk {
  chord?: string;
  lyric: string;
}

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
      currentChord = (token as ChordToken).chord;
    } else if (token.type === 'lyric') {
      currentLyric += (token as LyricToken).text;
    }
  }

  chunks.push({ chord: currentChord, lyric: currentLyric });
  return chunks.filter((c) => c.chord !== undefined || c.lyric.trim() !== '');
}

/**
 * Ensures every chord chunk has at least a small amount of lyric text so the
 * flex column isn't zero-width.  The chord text itself determines the column
 * width via the flex layout — no need to pad to the chord's character count.
 *
 * Mid-word padding uses em-dashes to visually connect syllables.
 */
function padChunks(chunks: Chunk[]): Chunk[] {
  return chunks.map((chunk, i) => {
    if (!chunk.chord) return chunk;

    const next = chunks[i + 1];
    const midWord =
      chunk.lyric.length > 0 &&
      !/\s$/.test(chunk.lyric) &&
      next !== undefined &&
      next.lyric.length > 0 &&
      !/^\s/.test(next.lyric);

    if (midWord) {
      // Mid-word: pad with em-dashes so syllables stay visually connected
      const minLen = chunk.chord.length + 1;
      if (chunk.lyric.length >= minLen) return chunk;
      return { ...chunk, lyric: chunk.lyric + '\u2014'.repeat(minLen - chunk.lyric.length) };
    }

    // Between words: just ensure at least 1 space so columns aren't flush
    if (chunk.lyric.length < 1) {
      return { ...chunk, lyric: ' ' };
    }
    return chunk;
  });
}

/**
 * Splits chunks at word boundaries so flex-wrap can break between words.
 * Only the first sub-chunk of each split keeps the chord.
 */
function splitChunksByWords(chunks: Chunk[]): Chunk[] {
  const result: Chunk[] = [];
  for (const chunk of chunks) {
    const parts = chunk.lyric.match(/\S+\s*|\s+/g);
    if (!parts || parts.length <= 1) {
      result.push(chunk);
      continue;
    }
    result.push({ chord: chunk.chord, lyric: parts[0]! });
    for (let i = 1; i < parts.length; i++) {
      result.push({ chord: undefined, lyric: parts[i]! });
    }
  }
  return result;
}

/**
 * Groups chunks into word-level units so mid-word chord markers don't break
 * the word apart. A group ends when the chunk's lyric ends with whitespace,
 * is empty, or is the last chunk.
 */
function groupByWords(chunks: Chunk[]): Chunk[][] {
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

  // Merge trailing chord-only groups (no real lyrics, just padding spaces)
  // into the last group that has actual text. This prevents chords at the
  // end of a line from wrapping to a new line by themselves.
  if (groups.length > 1) {
    let lastTextIdx = groups.length - 1;
    while (lastTextIdx >= 0 && !groups[lastTextIdx].some((c) => c.lyric.trim() !== '')) {
      lastTextIdx--;
    }
    if (lastTextIdx >= 0 && lastTextIdx < groups.length - 1) {
      for (let i = lastTextIdx + 1; i < groups.length; i++) {
        groups[lastTextIdx] = [...groups[lastTextIdx], ...groups[i]];
      }
      groups.length = lastTextIdx + 1;
    }
  }

  return groups;
}

/**
 * Flex-column chord line renderer.
 *
 * Each chunk is an inline-flex column (chord on top, lyric on bottom) inside
 * word-level nowrap groups.  The outer container uses flex-wrap so lines break
 * at word boundaries — chords and lyrics always wrap together and stay
 * vertically aligned.
 *
 * For chordless chunks (mid-word fragments like the "i" in i[A]nevitable),
 * the chord row is a zero-width placeholder so no gap is introduced.
 */
export default React.memo(function ChordLine({ line, showChords, onChordClick, chordStyle, inlineDiagrams, instrument, svs, chordVariations, songId, sectionIndex, lineIndex, trainerEnabled }: Props): React.ReactElement {
  const custom = useSettingsStore((s) => s.settings.customChords ?? {});
  const notation = useSettingsStore((s) => s.settings.chordNotation ?? 'letter');

  // Song trainer: hides a percentage of chord-name occurrences behind
  // clickable `?` marks so the user can practise guessing the next
  // chord. Only active on the chord-names-over-lyrics render branch
  // (bottom of this file) — the inline-diagrams branch above is
  // intentionally left untouched because there's no plain chord-name
  // element to swap out there.
  const trainerPct = useSongTrainerStore((s) => s.percentage);
  const trainerNonce = useSongTrainerStore((s) => s.nonce);
  const revealed = useSongTrainerStore((s) => s.revealed);
  const revealShape = useSongTrainerStore((s) => s.reveal);
  const trainerActive = !!trainerEnabled
    && !inlineDiagrams
    && showChords
    && typeof songId === 'string'
    && typeof sectionIndex === 'number'
    && typeof lineIndex === 'number';

  // Inline-diagrams data, mirroring the cast view's pathway in
  // utils/song-export.ts (renderChordLyricLine inline branch).
  // Builds:
  //   - atoms: word/space units (split on space/tab only, NBSP stays
  //     attached to its word so a leading-NBSP block reads as one atom)
  //   - per-word segments with chord markers and padDashes counts for
  //     in-word collision avoidance
  //   - extraSpaces map: inter-word atoms that need widening
  //
  // Three rules implemented here, identical to the cast pathway:
  //   1. Leading whitespace is trimmed (or replaced with NBSPs if a
  //      leading chord exists, so the diagram has invisible padding
  //      on its left).
  //   2. Multiple chords inside one word split it with visible dashes
  //      ("ha--bi-tacion") so the audience sees the syllable boundary.
  //   3. Words never break across visual lines (each word atom is a
  //      `display: inline-block; white-space: nowrap` span).
  const inlineData = useMemo(() => {
    if (!(showChords && inlineDiagrams && instrument)) return null;
    // Width in regular-letter "char-equivalents" needed to clear a
    // diagram. Used by the chord-spacing pre-pass.
    const MIN_SYLLABLE_CH = 10;
    // Width in NBSP characters needed to span one diagram-worth of
    // visible space. NBSPs are ~half the width of a letter, so we
    // need ≥ 2× the syllable-char count to actually clear a diagram.
    // 17 = balance between "tight but no collision" and avoiding too
    // much gap between leading chord diagrams.
    const LEADING_NBSP_PER_CHORD = 17;

    let rawLyric = '';
    const chordList: Array<{ name: string; pos: number }> = [];
    for (const t of line.tokens) {
      if (t.type === 'chord') chordList.push({ name: (t as ChordToken).chord, pos: rawLyric.length });
      else if (t.type === 'lyric') rawLyric += (t as LyricToken).text;
    }
    if (chordList.length === 0) {
      return { lyricOnly: true as const, lyric: rawLyric };
    }

    // Normalize leading whitespace: trim when no chord lives there,
    // otherwise replace with a fixed NBSP block sized to fit each
    // leading chord (so chord-only-no-syllable pieces have just enough
    // empty space on their left to render the diagram).
    const leadingWsLen = rawLyric.match(/^\s+/)?.[0]?.length ?? 0;
    // Leading whitespace handling. Strip any leading whitespace from
    // rawLyric BEFORE atom-splitting; collect leading-chord names
    // separately and prepend them as standalone chord-only atoms
    // after the atoms array is built. Each leading chord becomes its
    // own zero-width atom preceded by a regular-space atom that the
    // collision pre-pass will widen with a pixel spacer, so the
    // diagram has visible empty space around it.
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

    // Split rawLyric into atoms at regular space/tab boundaries only
    // (NBSP stays attached to its surrounding word).
    const isSplitSpace = (ch: string): boolean => ch === ' ' || ch === '\t';
    type Atom = { text: string; chords: Array<{ name: string; offset: number }>; isSpace: boolean };
    const atoms: Atom[] = [];
    if (rawLyric.length > 0) {
      let bufStart = 0;
      let bufIsSpace = isSplitSpace(rawLyric[0]!);
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
    }
    if (atoms.length === 0) atoms.push({ text: '', chords: [], isSpace: false });

    // Attach each chord to its word atom (inter-word whitespace chords
    // attach to the next word at offset 0).
    const atomStart = (idx: number): number => {
      let s = 0;
      for (let k = 0; k < idx; k++) s += atoms[k]!.text.length;
      return s;
    };
    // Chord attachment. The simple case (chord inside a word atom)
    // attaches the chord at its offset. Chords that fall in inter-
    // word whitespace get attached to the FOLLOWING word atom at
    // offset 0 — so multiple such chords stack on the same syllable
    // and the segment builder produces empty-text segments for them.
    // Chords past the end of the line trigger a standalone atom
    // insertion at the END of the atoms array.
    //
    // For the rendering side, empty-text segments get NBSP padding
    // (invisible but pixel-wide) and never display em-dashes, so the
    // visible result is just the chord diagrams without ugly dashes.
    // Chord attachment.
    //
    //   - Chord at the START of a word atom with NO space before it
    //     in the source (chord directly precedes the word, like
    //     `[A]is`) → attach at offset 0 of that word. Renders as
    //     chord-over-syllable.
    //   - Chord INSIDE a word atom (splits it mid-syllable, like
    //     `habi[Em]tacion`) → attach at its offset. Renders as
    //     in-word syllable split with em-dash.
    //   - Chord at the start of a word but PRECEDED BY whitespace
    //     in the source (like `[A] is`) OR in inter-word whitespace
    //     OR past end of lyric → standalone chord-only atom inserted
    //     after the preceding word. The lyric flows on, diagram over
    //     empty space.
    //
    // We use the original chord position (`c.pos`) AND the lyric
    // character at that position to discriminate:
    //   - rawLyric[c.pos] is a non-space character → chord is
    //     directly adjacent to a word with NO preceding space → it's
    //     a chord-on-syllable.
    //   - rawLyric[c.pos] is a space, OR c.pos >= rawLyric.length →
    //     standalone insertion.
    type Insertion = { afterIdx: number; chord: string; orderIdx: number };
    const insertions: Insertion[] = [];
    let orderCounter = 0;
    for (const c of chordList) {
      // Inspect the character AT the chord's source position.
      const charAtPos = c.pos < rawLyric.length ? rawLyric[c.pos]! : '';
      const isOnSyllable = charAtPos !== '' && !/\s/.test(charAtPos);
      if (!isOnSyllable) {
        // Chord in whitespace or past end → standalone insertion.
        // Find the last non-space atom whose end is <= c.pos so the
        // insertion goes immediately after the preceding word.
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
      // Chord on a syllable: find the containing word atom and
      // attach at the offset relative to that atom's start.
      let target = -1;
      let cursor = 0;
      for (let k = 0; k < atoms.length; k++) {
        const a = atoms[k]!;
        const end = cursor + a.text.length;
        if (c.pos < end && !a.isSpace) { target = k; break; }
        cursor = end;
      }
      if (target === -1) {
        // Defensive fallback — shouldn't happen for a syllable
        // character, but if it does, emit as standalone.
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
    // Apply insertions in reverse afterIdx order so earlier splices
    // don't shift later ones. Same-afterIdx insertions keep source
    // order: splice in REVERSE source order so the source-first
    // chord ends up leftmost after all splices.
    insertions.sort((a, b) => {
      if (a.afterIdx !== b.afterIdx) return b.afterIdx - a.afterIdx;
      return b.orderIdx - a.orderIdx;
    });
    for (const ins of insertions) {
      const insertAt = ins.afterIdx + 1;
      // Insert [leading-space, chord-only-atom, trailing-space] so
      // there's always an inter-atom space on BOTH sides of every
      // inserted chord-only atom. Without the leading space, the
      // pre-pass would see no `interSpaceAtoms` between the
      // preceding word and this standalone chord, and fall back to
      // adding visible ASCII dashes (`padDashes`) on the preceding
      // syllable.
      atoms.splice(insertAt, 0,
        { text: ' ', chords: [], isSpace: true },
        { text: '', chords: [{ name: ins.chord, offset: 0 }], isSpace: false },
        { text: ' ', chords: [], isSpace: true },
      );
    }

    // Prepend each leading chord as its own standalone atom + space
    // atom AT THE FRONT of the atoms array. Done AFTER the chord-
    // attachment loop above so the cursor calculation isn't shifted
    // by the prepended atoms' lengths.
    const hasLeadingChord = leadingChordNames.length > 0;
    if (hasLeadingChord) {
      const prepend: Atom[] = [];
      for (const name of leadingChordNames) {
        prepend.push({ text: '', chords: [{ name, offset: 0 }], isSpace: false });
        prepend.push({ text: ' ', chords: [], isSpace: true });
      }
      atoms.unshift(...prepend);
    }

    // Segment each word atom at every chord offset. Each chord-bearing
    // segment except the last in its word gets `emDash: true` so the
    // renderer emits one em-dash between syllables (e.g. "habi—ta").
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
      // For every chord, decide whether it OWNS its syllable text or
      // is a placeholder. A chord owns a syllable when it's the LAST
      // chord at its offset (and there's text to slice). When
      // multiple chords share an offset (e.g. 6 chord-only positions
      // all attached to "voy" at offset 0), the LAST one would
      // normally own "voy" — but we ALSO want to treat that last
      // one as a placeholder when ALL chords on this word share the
      // same offset (i.e. they're all chord-only, the word should
      // appear as a separate no-chord segment AFTER them). Detect
      // this by checking if EVERY chord has the same offset.
      const allSameOffset = chords.every((c) => c.offset === chords[0]!.offset)
        && chords.length > 1;
      for (let m = 0; m < chords.length; m++) {
        const myOffset = chords[m]!.offset;
        const hasNextChord = m + 1 < chords.length;
        const nextChordOffset = hasNextChord ? chords[m + 1]!.offset : word.length;
        // sharedWithNext only fires when there is actually a next chord at the same offset.
        // Without this guard, a single-chord atom with empty word text (e.g. a prepended
        // leading chord) would be flagged shared and forced into placeholder mode.
        // Stacked: another chord shares this offset (current or next
        // chord, or all-same-offset case). All such chords are
        // placeholders with empty text.
        const sharedWithNext = hasNextChord && nextChordOffset === myOffset;
        const isPlaceholder = sharedWithNext || allSameOffset;
        const segText = isPlaceholder ? '' : word.slice(myOffset, nextChordOffset);
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
      // chord-bearing segments were placeholders (cursor never
      // advanced past the chord cluster).
      if (cursor < word.length && chords.length > 0) {
        segs.push({ text: word.slice(Math.max(cursor, chords[chords.length - 1]!.offset)), emDash: false, padDashes: 0 });
      }
      wordSegments.set(k, segs);
      for (let s = 0; s < segs.length; s++) {
        if (segs[s]!.chord) chordPoints.push({ atomIdx: k, segIdx: s });
      }
    }

    // Collision-avoidance pre-pass. For every adjacent pair of chord
    // positions, ensure they're at least MIN_CHORD_GAP_CH "char units"
    // apart so two diagrams don't overlap. The deficit is added as
    // `extraSpaces` on the inter-word whitespace (preferred, keeps
    // wrap points) or as `padDashes` inside the current word
    // (fallback).
    //
    // The rendered output converts each `extraSpaces` unit into an
    // explicit pixel-width spacer (~diagramW/8 per unit) so the
    // collision width is deterministic regardless of the font's
    // narrow space-glyph width.
    // Chord-to-chord minimum in char-equivalent units. The pre-pass
    // widens inter-word spaces (preferred) or pads in-word segments
    // with NBSPs (for chord-only stacks on the same syllable).
    const MIN_CHORD_GAP_CH = 10;
    const extraSpaces: Map<number, number> = new Map();
    // Count NBSP-only segments at half-width because NBSP glyphs in
    // proportional fonts are about half as wide as letter glyphs.
    // Without this, a leading-NBSP block (which inserts 2× more
    // NBSPs per chord to compensate) would be over-counted in the
    // pre-pass and no collision padding would be added even though
    // the visible diagrams are colliding.
    const visibleCharCount = (s: string): number => {
      if (s.length === 0) return 0;
      if (/^\s+$/.test(s)) return s.length * 0.5;
      return s.length;
    };
    const segWidth = (seg: Segment): number =>
      visibleCharCount(seg.text) + seg.padDashes + (seg.emDash ? 1 : 0);
    for (let i = 0; i + 1 < chordPoints.length; i++) {
      const ca = chordPoints[i]!;
      const cb = chordPoints[i + 1]!;
      // Skip the pair-wise widening when `ca` is a standalone
      // chord-only atom (entire atom: empty text + exactly one chord).
      // Such atoms already reserve diagram-width pixel space via
      // their outer `min-width` style — widening the inter-atom space
      // on top of that would double the visible gap.
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
        for (let k = ca.atomIdx + 1; k < cb.atomIdx; k++) {
          const ak = atoms[k]!;
          if (ak.isSpace) {
            interSpaceAtoms.push(k);
            units += ak.text.length + (extraSpaces.get(k) ?? 0);
          } else {
            const sg = wordSegments.get(k)!;
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
        // In-word collision (no inter-word space between the two
        // chord positions). Always add the deficit width — the
        // renderer turns it into visible "-" dashes for real
        // syllables (so the audience sees the syllable split) OR
        // invisible NBSP padding for non-syllable placeholders (so
        // the chord-only diagrams keep their horizontal space).
        const segs = wordSegments.get(ca.atomIdx)!;
        segs[ca.segIdx]!.padDashes += deficit;
      }
    }

    // (Standalone chord-only atom spacing is now handled directly via
    // `min-width` on the chord-only atom's outer span — see the
    // render path below. No need to inflate `extraSpaces` for those
    // atoms, which would double the visible gap.)

    return { lyricOnly: false as const, atoms, wordSegments, extraSpaces, hasLeadingChord: leadingChordNames.length > 0 };
  }, [line, showChords, inlineDiagrams, instrument]);

  const wordGroups = useMemo(() => {
    const raw = buildChunks(line);
    const chunks = showChords ? padChunks(raw) : raw;
    return groupByWords(splitChunksByWords(chunks));
  }, [line, showChords]);

  // Pre-compute diagrams for every unique chord in this line. Doing the lookup
  // once in useMemo avoids re-looking up the same chord per render.
  const diagramMap = useMemo<Record<string, import('@song-chords/shared').ChordDiagram> | null>(() => {
    if (!inlineDiagrams || !instrument) return null;
    const map: Record<string, import('@song-chords/shared').ChordDiagram> = {};
    for (const group of wordGroups) {
      for (const chunk of group) {
        if (!chunk.chord || map[chunk.chord]) continue;
        const varIdx = chordVariations?.[chunk.chord] ?? 0;
        const found = varIdx > 0
          ? getDiagramByIndex(chunk.chord, instrument, varIdx, custom)
          : getDiagramExact(chunk.chord, instrument, custom);
        const diag = found ?? (instrument === 'piano'
          ? { name: chunk.chord, instrument, baseFret: 1, strings: 0, frets: [], pianoNotes: [] }
          : {
              name: chunk.chord,
              instrument,
              baseFret: 1,
              strings: instrument === 'guitar' ? 6 : 4,
              frets: Array(instrument === 'guitar' ? 6 : 4).fill('x') as ('x')[],
            });
        map[chunk.chord] = diag;
      }
    }
    return map;
  }, [inlineDiagrams, instrument, wordGroups, chordVariations, custom]);

  const chordFontSize = chordStyle?.fontSize ? `${chordStyle.fontSize}px` : '0.85em';
  // Diagram width scales with the lyric font size so diagrams stay
  // visually balanced with the lyrics across font-size settings (and
  // viewport sizes, since users typically pick a smaller lyric font
  // on phones). Clamped to a sensible range so very small fonts
  // don't shrink diagrams below readability and very large fonts
  // don't blow them up to fill the screen.
  const lyricFontSize = svs?.lyrics.fontSize || 19;
  const diagramW = Math.min(120, Math.max(56, Math.round(lyricFontSize * 4.5)));

  // Inline-diagrams mode: embed each chord diagram as a 0-width marker at
  // its source character position inside the lyric flow. The SVG is
  // absolutely positioned above the marker so natural text layout (in the
  // preset font) handles horizontal alignment — no monospace override.
  if (inlineData) {
    if (inlineData.lyricOnly) {
      // Lyric-only chord-line (no chords on this line). Use the same
      // tight line-height as the chord-bearing line so the inherited
      // 1.8 line-height from SongRenderer doesn't add half-leading
      // above/below the text \u2014 that half-leading would otherwise
      // throw off the visual centering of the NEXT chord-line's
      // diagrams between the surrounding lyrics.
      return (
        <div style={{ margin: '2px 0', lineHeight: 1 }}>
          {inlineData.lyric || '\u00A0'}
        </div>
      );
    }
    const { atoms, wordSegments, extraSpaces } = inlineData;
    // Per-instrument SVG height. Each diagram has a different intrinsic
    // rendered height (a 4-string ukulele draws taller-aspect cells than
    // a 6-string guitar at the same width), so a single multiplier
    // either crops shorter instruments or leaves a gap.
    //
    //  - guitar: 6 strings → cellH ≈ width × 0.108 → ~93 px @ 80
    //  - ukulele: 4 strings → cellH ≈ width × 0.18  → ~122 px @ 80
    //  - piano (vertical): 14 keys + label          → ~190 px @ 80
    const svgHeight =
      instrument === 'piano'
        ? Math.round(diagramW * 2.4)
        : instrument === 'ukulele'
          ? Math.round(diagramW * 1.55)
          : Math.round(diagramW * 1.2);
    // Visible gap between the diagram's bottom edge and the lyric's
    // top edge.
    // Equal visible padding above and below the diagram band.
    //   - Line container `padding-top: DIAGRAM_MARGIN` → gap from
    //     previous lyric BOTTOM EDGE to this diagram TOP.
    //   - Marker height = svgHeight + LYRIC_FONT_SIZE + DIAGRAM_MARGIN.
    //     Diagram sits `top: 0` inside, lyric text wraps in a
    //     `vertical-align: bottom; line-height: 1` span so it sits at
    //     the BOTTOM. The leftover space inside the marker
    //     (= DIAGRAM_MARGIN) becomes the visible gap between the
    //     diagram bottom and the lyric top.
    // Vertical spacing around the diagram band, both scaled with the
    // lyric font size:
    //   - TOP_GAP: visible space between previous lyric BOTTOM and
    //     this diagram's chord NAME (the top of the visible diagram
    //     unit). Bigger than the bottom gap because the previous
    //     line's CSS line-box reaches all the way to its half-leading
    //     bottom edge — the visible text bottom is ~half-leading px
    //     above, so we need extra padding for the diagram to look
    //     centered.
    //   - BOTTOM_GAP: visible space between this diagram's FRETBOARD
    //     bottom and this lyric's TOP. The lyric sits at the bottom
    //     of the marker (vertical-align: bottom, line-height: 1) so
    //     there's no half-leading on this side — this gap can be
    //     smaller and still look balanced.
    const LYRIC_FONT_SIZE = lyricFontSize;
    const TOP_GAP = Math.round(LYRIC_FONT_SIZE * 0.95);
    const BOTTOM_GAP = Math.round(LYRIC_FONT_SIZE * 0.05);
    // Backward-compatible alias used elsewhere in the file.
    const DIAGRAM_MARGIN = BOTTOM_GAP;
    // The SVG is absolutely positioned `top: -PADDING_TOP` from the
    // lyric anchor — i.e. PADDING_TOP px above the lyric. Make
    // PADDING_TOP = svgHeight + VISIBLE_GAP so the SVG's bottom sits
    // exactly VISIBLE_GAP px above the lyric. The container's
    // `paddingTop` (below) uses the same value to reserve room above
    // the lyric line.
    // Marker reserves: diagram + lyric font height + bottom gap.
    // With diagram positioned `top: 0` inside and lyric at the BOTTOM
    // via vertical-align: bottom, the leftover space between them is
    // the bottom gap.
    const PADDING_TOP = svgHeight + LYRIC_FONT_SIZE + DIAGRAM_MARGIN;
    // ChordDiagramSVG has padLeft=16 before its first string. Shift the
    // SVG 16px left so that leftmost string aligns with the marker's
    // character position, not the SVG's outer bounding box.
    const SVG_LEFT_OFFSET = -16;
    // ChordDiagramSVG also has ~3-5px of empty space above the chord
    // name text (the text baseline is at y=14, ascent ~10-12px → name
    // visible top at y≈3). Pull the SVG up by SVG_TOP_TRIM so the
    // visible "diagram unit" (chord name + fretboard) sits flush with
    // the marker top — making the visual centering between two lyric
    // lines symmetrical.
    const SVG_TOP_TRIM = -4;

    const renderMarker = (chordName: string, key: string, leftOverride?: number): React.ReactNode => {
      const varIdx = chordVariations?.[chordName] ?? 0;
      const found = varIdx > 0
        ? getDiagramByIndex(chordName, instrument!, varIdx, custom)
        : getDiagramExact(chordName, instrument!, custom);
      const diag = found ?? (instrument === 'piano'
        ? { name: chordName, instrument: instrument!, baseFret: 1, strings: 0, frets: [], pianoNotes: [] }
        : {
            name: chordName,
            instrument: instrument!,
            baseFret: 1,
            strings: instrument === 'guitar' ? 6 : 4,
            frets: Array(instrument === 'guitar' ? 6 : 4).fill('x') as ('x')[],
          });
      // Marker is a 0-width inline-block. Its `vertical-align: top`
      // anchors it to the TOP of the line-box (consistent across
      // browsers, unaffected by font metrics or half-leading). The
      // marker reserves PADDING_TOP of inline height so the line-box
      // grows to fit the diagram. The diagram itself sits in an
      // absolute child anchored to the marker's TOP, offset RIGHT by
      // `left: SVG_LEFT_OFFSET` so the diagram's leftmost string
      // aligns with the syllable's first character.
      return (
        <span
          key={key}
          style={{
            display: 'inline-block',
            position: 'relative',
            width: 0,
            height: PADDING_TOP,
            verticalAlign: 'top',
          }}
        >
          <span
            style={{
              position: 'absolute',
              top: SVG_TOP_TRIM,
              left: leftOverride ?? SVG_LEFT_OFFSET,
              lineHeight: 1,
              whiteSpace: 'nowrap',
              cursor: onChordClick ? 'pointer' : undefined,
              fontSize: 'initial',
            }}
            onClick={() => onChordClick?.(chordName)}
            title={formatChord(chordName, notation)}
          >
            <ChordDiagramSVG
              diagram={diag}
              width={diagramW}
              lineColor={svs?.lyrics.color || undefined}
              chordColor={svs?.chords.color || undefined}
              nameColor={svs?.chords.color || undefined}
              displayName={formatChord(chordName, notation)}
              vertical={instrument === 'piano'}
            />
          </span>
        </span>
      );
    };

    // Each word atom becomes one `display: inline-block; white-space: nowrap`
    // span so wrapping only happens at the spaces between atoms. Marker
    // spans inside contribute their full PADDING_TOP height to every
    // visual line, so wrapped lines also reserve diagram clearance.
    const pieces: React.ReactNode[] = [];
    for (let k = 0; k < atoms.length; k++) {
      const a = atoms[k]!;
      if (a.isSpace) {
        const baseText = a.text.length === 0 ? ' ' : a.text;
        const extra = extraSpaces.get(k) ?? 0;
        // The natural inter-word space stays as text (a real space
        // char, so the line can still break here on wrap). Any extra
        // collision-avoidance width is rendered as an inline-block
        // SPACER with explicit pixel width — measured in pixels so it
        // doesn't depend on the proportional font's narrow space
        // glyph. A full MIN_CHORD_GAP_CH (10) units corresponds to
        // ~diagramW + small breathing room.
        const SPACER_PX_PER_UNIT = Math.round((diagramW + 16) / 10);
        pieces.push(
          <span
            key={`s${k}`}
            style={{ whiteSpace: 'pre', display: 'inline-block', verticalAlign: 'bottom', lineHeight: 1 }}
          >
            {baseText}
            {extra > 0 && (
              <span
                style={{
                  display: 'inline-block',
                  width: `${extra * SPACER_PX_PER_UNIT}px`,
                  height: '1px',
                  verticalAlign: 'bottom',
                }}
                aria-hidden="true"
              />
            )}
          </span>
        );
      } else {
        const segs = wordSegments.get(k)!;
        const children: React.ReactNode[] = [];
        for (let s = 0; s < segs.length; s++) {
          const seg = segs[s]!;
          // Trailing em-dash separates this chord's syllable from the
          // next chord's syllable in the same word (e.g. "habi" + "—"
          // + "ta"). One em-dash per split; matches the reference
          // images. Pure-whitespace segments (leading-NBSP block) never
          // get an em-dash because they have no following syllable to
          // separate from.
          // A segment is a "real syllable" only when it has non-empty,
          // non-whitespace text. Chord-only placeholders (empty text
          // OR pure whitespace like the leading-NBSP block) are NOT
          // real syllables — they never get visible ASCII dashes or
          // em-dashes; their collision padding is invisible NBSPs.
          // NBSPs are roughly half as wide as letters in proportional
          // fonts, so non-syllable padding is doubled to match the
          // visible pixel width of the equivalent dash padding.
          const hasRealSyllable = seg.text.length > 0 && !/^\s+$/.test(seg.text);
          let body = seg.text;
          let longDashPx = 0;
          if (seg.padDashes > 0) {
            if (hasRealSyllable) {
              // In-word syllable split: a single long visible dash
              // (inline-block span with a centered border) spans
              // the padDashes width, replacing the previous run of
              // many ASCII dashes.
              // Width = (padDashes + 2) × ~one-dash-width, so the
              // long-dash bar is the combined width of the dashes it
              // replaces plus a 2-dash extension for a cleaner look.
              longDashPx = Math.round((seg.padDashes + 2) * lyricFontSize * 0.33);
            } else {
              // Non-syllable placeholder: invisible NBSP padding.
              body = body + ' '.repeat(seg.padDashes * 2);
            }
          }
          const trailingEmDash = seg.emDash && hasRealSyllable;
          if (seg.chord) {
            // For chord-only standalone atoms (empty word atom whose
            // only chord is this segment), center the diagram
            // horizontally within the atom's min-width box so it
            // sits in the middle of the visible gap. For chord-on-
            // syllable atoms keep the default SVG_LEFT_OFFSET so the
            // diagram's leftmost string aligns with the character.
            const isStandaloneChordOnly = a.text === '' && a.chords.length === 1;
            let leftOverride: number | undefined;
            if (isStandaloneChordOnly) {
              // Atom min-width = diagramW × 0.9 (see outer span).
              // Center the diagram inside it: shift right by
              // (atomW - diagramW) / 2 from offset 0. With atomW <
              // diagramW the offset is NEGATIVE, so the diagram
              // overflows the atom box equally on each side.
              const atomW = Math.round(diagramW * 0.9);
              leftOverride = Math.round((atomW - diagramW) / 2);
            }
            children.push(renderMarker(seg.chord.name, `m${k}_${s}`, leftOverride));
          }
          // Lyric text wrapped in a span with `vertical-align: bottom`
          // so it sits at the bottom of the (tall) line-box instead
          // of being vertically centered by the inflated line-height.
          // `lineHeight: 1` keeps the text's own line-box compact.
          //
          // Chord-only placeholder = has chord but no real syllable.
          // Two width policies:
          //   - Adjacent chord-only placeholders in a cluster get a
          //     SMALLER min-width — diagrams sit close together, like
          //     the reference layout. Adjacent placeholders' diagrams
          //     are still distinguishable thanks to the chord-name
          //     label centered above each.
          //   - The LAST chord-only placeholder (or any placeholder
          //     whose next segment is a real syllable) gets the FULL
          //     diagram-width — so the lyric word following the
          //     cluster doesn't end up under the last diagram.
          const isChordOnlyPlaceholder = !!seg.chord && !hasRealSyllable;
          const nextSeg = segs[s + 1];
          const nextIsPlaceholder = !!nextSeg
            && !!nextSeg.chord
            && !(nextSeg.text.length > 0 && !/^\s+$/.test(nextSeg.text));
          const bodyStyle: React.CSSProperties = {
            display: 'inline-block',
            verticalAlign: 'bottom',
            lineHeight: 1,
          };
          if (isChordOnlyPlaceholder) {
            bodyStyle.minWidth = nextIsPlaceholder
              ? `${Math.round(diagramW * 0.55)}px`
              : `${Math.round(diagramW * 0.85)}px`;
          }
          children.push(
            <span
              key={`t${k}_${s}`}
              style={bodyStyle}
            >
              {body}
              {longDashPx > 0 && (
                <span
                  aria-hidden="true"
                  style={{
                    display: 'inline-block',
                    width: `${longDashPx}px`,
                    height: '2px',
                    backgroundColor: 'currentColor',
                    verticalAlign: 'middle',
                    marginLeft: '2px',
                    marginRight: '2px',
                  }}
                />
              )}
              {/* The em-dash is redundant when a long-dash is shown
                  (both serve as syllable separators). Only render the
                  em-dash when there's no long-dash padding. */}
              {trailingEmDash && longDashPx === 0 && '—'}
            </span>
          );
        }
        // Chord-only placeholder atom (empty text, has chord). Two
        // width policies depending on whether the NEXT non-space atom
        // is ALSO a chord-only placeholder:
        //   - Tight (~0.75× diagram width) when followed by another
        //     chord-only atom → diagrams sit close together as a
        //     cluster.
        //   - Full (diagram width + breathing room) when followed by
        //     a real word → the lyric word starts past this diagram.
        const isChordOnlyAtom = a.text === '' && a.chords.length > 0;
        let isClusterNonLast = false;
        let prevWasSyllableWord = false;
        if (isChordOnlyAtom) {
          // Look ahead through space atoms for the next non-space atom.
          for (let nk = k + 1; nk < atoms.length; nk++) {
            const na = atoms[nk]!;
            if (na.isSpace) continue;
            isClusterNonLast = na.text === '' && na.chords.length > 0;
            break;
          }
          // Look back: was the previous non-space atom a syllable-bearing
          // word? If so, add a bit of padding-left so the chord-only
          // diagram doesn't sit flush against the preceding lyric.
          for (let pk = k - 1; pk >= 0; pk--) {
            const pa = atoms[pk]!;
            if (pa.isSpace) continue;
            // syllable-bearing = has visible text and either no chord
            // or chord at a real syllable offset (i.e. NOT a chord-only
            // placeholder atom).
            prevWasSyllableWord = pa.text.length > 0 && !/^\s+$/.test(pa.text);
            break;
          }
        }
        // Min-width = diagramW × 0.9 — slightly NARROWER than the
        // diagram so it visually extends a few px past each side of
        // its atom. Combined with the centered `leftOverride`, this
        // packs adjacent chord-only diagrams and the surrounding
        // lyrics nice and tight.
        const minWidthPx = isChordOnlyAtom
          ? Math.round(diagramW * 0.9)
          : 0;
        const minWidthStyle: React.CSSProperties = minWidthPx > 0
          ? { minWidth: `${minWidthPx}px` }
          : {};
        pieces.push(
          <span
            key={`w${k}`}
            style={{
              display: 'inline-block',
              whiteSpace: 'nowrap',
              verticalAlign: 'top',
              ...minWidthStyle,
            }}
          >
            {children}
          </span>
        );
      }
    }

    // OUTER container reserves `padding-top: DIAGRAM_MARGIN` ABOVE
    // the diagram band — that's the visible gap between the previous
    // line's lyric and this line's diagram top. The marker reserves
    // `svgHeight + VISIBLE_GAP` inline (which provides the gap
    // between the diagram bottom and this lyric). `padding-bottom`
    // adds a bit of breathing room below this lyric before the next
    // line starts. line-height is set just to contain the marker.
    const lineH = PADDING_TOP;
    return (
      <div style={{ margin: 0, paddingTop: TOP_GAP, paddingBottom: 0, lineHeight: `${lineH}px` }}>
        <div style={{ overflowWrap: 'normal', wordBreak: 'keep-all' }}>{pieces}</div>
      </div>
    );
  }

  return (
    <div style={{
      display: 'flex',
      flexWrap: 'wrap',
      alignItems: 'flex-end',
      lineHeight: 1,
      margin: '2px 0',
    }}>
      {wordGroups.map((group, gi) => (
        <span key={gi} style={{ display: 'inline-flex', flexWrap: 'nowrap', alignItems: 'flex-end' }}>
          {group.map((chunk, ci) => (
            // Each chunk is an inline-block with two stacked fixed-height
            // rows (chord + lyric). Using inline-block + verticalAlign
            // anchors every chunk to the same baseline; the chord row has a
            // fixed height so chord-only chunks (padded lyric = " ") can
            // never shrink the column and pull the chord onto the lyric row.
            <span key={ci} style={{ display: 'inline-block', verticalAlign: 'bottom' }}>
              {showChords && (
                <span style={{
                  // Flex container anchored to the row's bottom edge so
                  // the diagram sits flush against the row's bottom.
                  display: 'flex',
                  alignItems: 'flex-end',
                  // Per-instrument height, sized to each diagram's actual
                  // rendered SVG.
                  //
                  //  - guitar: 6 strings → cellH ≈ width × 0.108 → ~93 px @ 80
                  //  - ukulele: 4 strings → cellH ≈ width × 0.18  → ~122 px @ 80
                  //  - piano (vertical): 14 keys stacked + label   → ~190 px @ 80
                  height: inlineDiagrams
                    ? (instrument === 'piano'
                        ? `${Math.round(diagramW * 2.4)}px`
                        : instrument === 'ukulele'
                          ? `${Math.round(diagramW * 1.55)}px`
                          : `${Math.round(diagramW * 1.2)}px`)
                    : '1.4em',
                  lineHeight: inlineDiagrams ? '0' : '1.4em',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                }}>
                  {chunk.chord ? (
                    diagramMap && diagramMap[chunk.chord] ? (
                      <span
                        style={{
                          cursor: onChordClick ? 'pointer' : undefined,
                          marginRight: 4,
                          // Fretboards have 14px left padding for muted/open
                          // markers — pull the wrapper left to compensate.
                          // Vertical pianos don't have that padding so don't
                          // need the negative margin.
                          marginLeft: instrument === 'piano' ? 0 : -14,
                          display: 'inline-block',
                          // Bottom-aligned in the chord row's flex container
                          // (see chord-row span above), so the diagram sits
                          // flush against the lyric line below.
                          verticalAlign: 'bottom',
                        }}
                        onClick={() => onChordClick?.(chunk.chord!)}
                        title={formatChord(chunk.chord, notation)}
                      >
                        <ChordDiagramSVG diagram={diagramMap[chunk.chord]!} width={diagramW}
                          lineColor={svs?.lyrics.color || undefined}
                          chordColor={svs?.chords.color || undefined}
                          nameColor={svs?.chords.color || undefined}
                          displayName={formatChord(chunk.chord, notation)}
                          vertical={instrument === 'piano'} />
                      </span>
                    ) : (
                      (() => {
                        // Song trainer masking. Stable key per chord
                        // occurrence: (section, line, group, chunk,
                        // chord). Hash decides whether this occurrence
                        // is hidden at the current percentage; the
                        // `revealed` set overrides once the user
                        // clicks the `?` to reveal it.
                        const occKey = trainerActive
                          ? `${sectionIndex}:${lineIndex}:${gi}:${ci}:${chunk.chord}`
                          : '';
                        const isHidden = trainerActive
                          && !revealed.has(occKey)
                          && isHiddenAtPercentage(songId!, occKey, trainerPct, trainerNonce);
                        if (isHidden) {
                          return (
                            <span
                              className="chord chord-trainer-mask"
                              style={{
                                fontWeight: 700,
                                fontSize: chordFontSize,
                                whiteSpace: 'nowrap',
                                paddingRight: '0.3em',
                                // Trainer `?` is always red so the
                                // "guess me" affordance is visually
                                // distinct from the surrounding chord
                                // names in ANY style preset (including
                                // presets whose chord color is red-ish
                                // — using the preset color could make
                                // the `?` blend in). --danger is the
                                // app-wide red token.
                                color: 'var(--danger, #ef4444)',
                                cursor: 'pointer',
                                userSelect: 'none',
                              }}
                              onClick={(e) => {
                                // Reveal-only: don't fall through to the
                                // chord-diagram popup, which would fire
                                // simultaneously and confuse "click to
                                // reveal" vs "click to view diagram".
                                e.stopPropagation();
                                revealShape(occKey);
                              }}
                              title="Click to reveal chord"
                              aria-label="Hidden chord — click to reveal"
                            >
                              ?
                            </span>
                          );
                        }
                        return (
                          <span
                            className="chord"
                            style={{
                              fontWeight: 600,
                              fontSize: chordFontSize,
                              whiteSpace: 'nowrap',
                              paddingRight: '0.3em',
                              color: chordStyle?.color || undefined,
                              cursor: onChordClick ? 'pointer' : undefined,
                            }}
                            onClick={() => onChordClick?.(chunk.chord!)}
                            title={chunk.chord ? `Click to view ${formatChord(chunk.chord, notation)} diagram` : undefined}
                          >
                            {formatChord(chunk.chord, notation)}
                          </span>
                        );
                      })()
                    )
                  ) : (
                    // Zero-width space so the chord row keeps its fixed height.
                    '\u200B'
                  )}
                </span>
              )}
              {/* Explicit gap between the chord row and the lyric.
                  Empty block element with a fixed height \u2014 guaranteed
                  to render visible space regardless of how parent
                  flex / inline contexts collapse margins. */}
              {inlineDiagrams && (
                <span style={{ display: 'block', height: '14px', lineHeight: '0' }} aria-hidden="true">
                  {'\u200B'}
                </span>
              )}
              <span style={{
                display: 'block',
                whiteSpace: 'pre',
                height: '1.2em',
                lineHeight: '1.2em',
              }}>{chunk.lyric.length === 0 ? '\u00A0' : chunk.lyric}</span>
            </span>
          ))}
        </span>
      ))}
    </div>
  );
});
