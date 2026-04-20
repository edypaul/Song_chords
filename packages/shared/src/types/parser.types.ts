import type { SongMetadata } from './song.types';

export type SectionType = 'verse' | 'chorus' | 'bridge' | 'pre-chorus' | 'intro' | 'outro' | 'tag' | 'interlude';

export interface ChordToken {
  type: 'chord';
  chord: string;
  root: string;
  quality: string;
  bass?: string;
}

export interface LyricToken {
  type: 'lyric';
  text: string;
}

export interface DirectiveToken {
  type: 'directive';
  name: string;
  value?: string;
}

export interface SectionToken {
  type: 'section';
  sectionType: SectionType;
  label?: string;
}

export interface CommentToken {
  type: 'comment';
  text: string;
}

/** One beat slot inside a bar. A chord is present when a new chord starts on this beat. */
export interface ChordGridBeat {
  chord?: string; // set when a chord starts on this beat; absent for continuation beats (dots)
}

/** One bar inside a chord grid: an ordered list of beat slots. */
export interface ChordGridBar {
  beats: ChordGridBeat[];
}

/** One row of bars in a chord grid block. */
export interface ChordGridRow {
  bars: ChordGridBar[];
  startRepeat?: boolean;
  endRepeat?: boolean;
  repeatCount?: number;
}

/** Token emitted for a complete {sog}…{eog} block. */
export interface ChordGridToken {
  type: 'chord-grid';
  rows: ChordGridRow[];
}

export type Token = ChordToken | LyricToken | DirectiveToken | SectionToken | CommentToken | ChordGridToken;

export interface ParsedLine {
  tokens: Token[];
  hasChords: boolean;
  isDirective: boolean;
  isSection: boolean;
  isComment: boolean;
  isEmpty: boolean;
  isChordGrid?: boolean;
  isSectionEnd?: boolean;
  sectionType?: SectionType;
  sectionLabel?: string;
}

export interface ParsedSong {
  metadata: SongMetadata;
  lines: ParsedLine[];
  rawContent: string;
}
