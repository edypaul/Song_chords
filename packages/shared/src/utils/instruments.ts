import type {
  ChordDiagram,
  CustomInstrument,
  CustomInstrumentId,
  InstrumentType,
} from '../types/chord.types';

/**
 * Helpers for the one question every diagram consumer asks — "how
 * many strings does this instrument have?" — now that instruments
 * are not a closed set of three. Every call site that used to inline
 * `instrument === 'guitar' ? 6 : instrument === 'ukulele' ? 4 : 0`
 * goes through here so a custom instrument (7-string guitar,
 * charango, bouzouki…) is drawn with the right grid everywhere: the
 * chord library, the song view's chord bar, inline diagrams, the
 * chord modal, exports and the cast receiver.
 */

export const CUSTOM_INSTRUMENT_PREFIX = 'custom:';

export function isCustomInstrument(instrument: string): instrument is CustomInstrumentId {
  return instrument.startsWith(CUSTOM_INSTRUMENT_PREFIX);
}

export function makeCustomInstrumentId(): CustomInstrumentId {
  return `${CUSTOM_INSTRUMENT_PREFIX}${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
}

/** Hard limits for a custom instrument's string count. Two is the
 *  smallest grid the renderer can draw (it divides by strings − 1);
 *  twelve covers 12-string guitars and any course instrument drawn
 *  one line per course. */
export const MIN_CUSTOM_STRINGS = 2;
export const MAX_CUSTOM_STRINGS = 12;

/**
 * String count for an instrument. Piano is 0 (it isn't fretted).
 * A custom instrument whose definition is missing (deleted while a
 * diagram still references it, or a backup restored without its
 * instruments file) falls back to 6 so diagrams still render.
 */
export function instrumentStringCount(
  instrument: InstrumentType,
  customInstruments?: Readonly<Record<string, CustomInstrument>>,
): number {
  if (instrument === 'guitar') return 6;
  if (instrument === 'ukulele') return 4;
  if (instrument === 'piano') return 0;
  const custom = customInstruments?.[instrument];
  return custom ? custom.strings : 6;
}

/** The placeholder diagram shown when a chord has no voicing for the
 *  instrument: an all-muted grid (or an empty keyboard for piano). */
export function emptyDiagramFor(
  name: string,
  instrument: InstrumentType,
  customInstruments?: Readonly<Record<string, CustomInstrument>>,
): ChordDiagram {
  if (instrument === 'piano') {
    return { name, instrument, baseFret: 1, strings: 0, frets: [], pianoNotes: [] };
  }
  const strings = instrumentStringCount(instrument, customInstruments);
  return { name, instrument, baseFret: 1, strings, frets: Array(strings).fill('x') as 'x'[] };
}

/**
 * Rendered height of a `ChordDiagramSVG` fretboard at `width` px for
 * a given string count. Layouts that reserve vertical room for a
 * diagram (inline-diagram lines) need this before the SVG exists.
 * The 6- and 4-string values are the long-standing tuned constants;
 * other counts use the renderer's actual geometry (padTop 38 +
 * 5 frets × 0.9 × cellW + padBottom 12, cellW = (width − 32)/(n − 1)).
 */
export function fretboardDiagramHeight(width: number, strings: number): number {
  if (strings === 6) return Math.round(width * 1.2);
  if (strings === 4) return Math.round(width * 1.55);
  return Math.round(50 + (4.5 * (width - 32)) / Math.max(1, strings - 1));
}

/** Height reserved above a lyric line for an inline diagram of the
 *  given instrument (vertical piano, or a fretboard of the right
 *  string count). */
export function inlineDiagramHeight(
  width: number,
  instrument: InstrumentType,
  customInstruments?: Readonly<Record<string, CustomInstrument>>,
): number {
  if (instrument === 'piano') return Math.round(width * 2.4);
  return fretboardDiagramHeight(width, instrumentStringCount(instrument, customInstruments));
}
