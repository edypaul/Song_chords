import type { ParsedSong, ChordToken, ChordGridToken } from '../types/parser.types';

/** Extract unique chord names from a parsed song, in order of first appearance. */
export function extractUniqueChords(song: ParsedSong): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const line of song.lines) {
    for (const token of line.tokens) {
      if (token.type === 'chord') {
        const name = (token as ChordToken).chord;
        if (!seen.has(name)) {
          seen.add(name);
          result.push(name);
        }
      }
      if (token.type === 'chord-grid') {
        const grid = token as ChordGridToken;
        for (const row of grid.rows) {
          for (const bar of row.bars) {
            for (const beat of bar.beats) {
              if (beat.chord && !seen.has(beat.chord)) {
                seen.add(beat.chord);
                result.push(beat.chord);
              }
            }
          }
        }
      }
    }
  }

  return result;
}
