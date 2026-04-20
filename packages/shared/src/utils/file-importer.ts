import { parseChordPro } from '../parser/chordpro-parser';
import { extractUniqueChords } from './extract-chords';
import type { SongCreateInput } from '../types/song.types';

export function importFromString(
  content: string,
  filename: string,
): SongCreateInput {
  // Always parse as ChordPro so `{title}`, `{subtitle}`, `{metronome}`,
  // `{duration}`, etc. directives are recognised regardless of file
  // extension. Plain lyric-only files still work because unknown lines just
  // pass through as lyric tokens.
  const parsed = parseChordPro(content);

  const title = parsed.metadata.title ?? filenameToTitle(filename);

  return {
    title,
    artist: parsed.metadata.artist,
    album: parsed.metadata.album,
    key: parsed.metadata.key,
    tempo: parsed.metadata.tempo,
    timeSig: parsed.metadata.timeSig,
    capo: parsed.metadata.capo ?? 0,
    duration: parsed.metadata.duration,
    content,
    chordsCount: extractUniqueChords(parsed).length,
    tags: [],
    favorite: false,
    preferences: {},
    sortOrder: 0,
  };
}

function filenameToTitle(filename: string): string {
  const base = filename.split('/').pop()?.split('\\').pop() ?? filename;
  return base.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ');
}
