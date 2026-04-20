export type InstrumentType = 'guitar' | 'ukulele';

export interface ChordDiagram {
  name: string;
  instrument: InstrumentType;
  baseFret: number;
  strings: number;
  frets: Array<number | 'x' | 0 | null>;
  fingers?: number[];
  barre?: { fret: number; fromString: number; toString: number };
}
