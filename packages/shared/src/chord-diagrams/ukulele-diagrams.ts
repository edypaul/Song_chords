import type { ChordDiagram } from '../types/chord.types';

// Ukulele tuning: G C E A (strings 4-1)
export const UKULELE_DIAGRAMS: Record<string, ChordDiagram[]> = {
  'C':   [{ name:'C', instrument:'ukulele', baseFret:1, strings:4, frets:[0,0,0,3] }],
  'Cm':  [{ name:'Cm', instrument:'ukulele', baseFret:1, strings:4, frets:[0,3,3,3] }],
  'C7':  [{ name:'C7', instrument:'ukulele', baseFret:1, strings:4, frets:[0,0,0,1] }],
  'Cmaj7':[{ name:'Cmaj7', instrument:'ukulele', baseFret:1, strings:4, frets:[0,0,0,2] }],
  'Cm7': [{ name:'Cm7', instrument:'ukulele', baseFret:1, strings:4, frets:[3,3,3,3] }],
  'Cdim':[{ name:'C°', instrument:'ukulele', baseFret:1, strings:4, frets:[0,3,2,3] }],
  'C°':  [{ name:'C°', instrument:'ukulele', baseFret:1, strings:4, frets:[0,3,2,3] }],

  'D':   [{ name:'D', instrument:'ukulele', baseFret:1, strings:4, frets:[2,2,2,0] }],
  'Dm':  [{ name:'Dm', instrument:'ukulele', baseFret:1, strings:4, frets:[2,2,1,0] }],
  'D7':  [{ name:'D7', instrument:'ukulele', baseFret:1, strings:4, frets:[2,2,2,3] }],
  'Dmaj7':[{ name:'Dmaj7', instrument:'ukulele', baseFret:1, strings:4, frets:[2,2,2,4] }],
  'Dm7': [{ name:'Dm7', instrument:'ukulele', baseFret:1, strings:4, frets:[2,2,1,3] }],

  'E':   [{ name:'E', instrument:'ukulele', baseFret:1, strings:4, frets:[1,4,0,2] }],
  'Em':  [{ name:'Em', instrument:'ukulele', baseFret:1, strings:4, frets:[0,4,3,2] }],
  'E7':  [{ name:'E7', instrument:'ukulele', baseFret:1, strings:4, frets:[1,2,0,2] }],
  'Em7': [{ name:'Em7', instrument:'ukulele', baseFret:1, strings:4, frets:[0,2,0,2] }],

  'F':   [{ name:'F', instrument:'ukulele', baseFret:1, strings:4, frets:[2,0,1,0] }],
  'Fm':  [{ name:'Fm', instrument:'ukulele', baseFret:1, strings:4, frets:[1,0,1,3] }],
  'F7':  [{ name:'F7', instrument:'ukulele', baseFret:1, strings:4, frets:[2,3,1,0] }],
  'Fmaj7':[{ name:'Fmaj7', instrument:'ukulele', baseFret:1, strings:4, frets:[2,4,1,0] }],
  'Fm7': [{ name:'Fm7', instrument:'ukulele', baseFret:1, strings:4, frets:[1,3,1,3] }],

  'G':   [{ name:'G', instrument:'ukulele', baseFret:1, strings:4, frets:[0,2,3,2] }],
  'Gm':  [{ name:'Gm', instrument:'ukulele', baseFret:1, strings:4, frets:[0,2,3,1] }],
  'G7':  [{ name:'G7', instrument:'ukulele', baseFret:1, strings:4, frets:[0,2,1,2] }],
  'Gmaj7':[{ name:'Gmaj7', instrument:'ukulele', baseFret:1, strings:4, frets:[0,2,2,2] }],
  'Gm7': [{ name:'Gm7', instrument:'ukulele', baseFret:1, strings:4, frets:[0,2,1,1] }],

  'A':   [{ name:'A', instrument:'ukulele', baseFret:1, strings:4, frets:[2,1,0,0] }],
  'Am':  [{ name:'Am', instrument:'ukulele', baseFret:1, strings:4, frets:[2,0,0,0] }],
  'A7':  [{ name:'A7', instrument:'ukulele', baseFret:1, strings:4, frets:[0,1,0,0] }],
  'Amaj7':[{ name:'Amaj7', instrument:'ukulele', baseFret:1, strings:4, frets:[1,1,0,0] }],
  'Am7': [{ name:'Am7', instrument:'ukulele', baseFret:1, strings:4, frets:[0,0,0,0] }],

  'B':   [{ name:'B', instrument:'ukulele', baseFret:1, strings:4, frets:[4,3,2,2] }],
  'Bm':  [{ name:'Bm', instrument:'ukulele', baseFret:1, strings:4, frets:[4,2,2,2] }],
  'B7':  [{ name:'B7', instrument:'ukulele', baseFret:1, strings:4, frets:[2,3,2,2] }],
  'Bm7': [{ name:'Bm7', instrument:'ukulele', baseFret:1, strings:4, frets:[2,2,2,2] }],

  // Sharps/flats
  'C#':  [{ name:'C#', instrument:'ukulele', baseFret:1, strings:4, frets:[1,1,1,4] }],
  'C#m': [{ name:'C#m', instrument:'ukulele', baseFret:1, strings:4, frets:[1,4,4,4] }],
  'C#7': [{ name:'C#7', instrument:'ukulele', baseFret:1, strings:4, frets:[1,1,1,2] }],
  'Db':  [{ name:'Db', instrument:'ukulele', baseFret:1, strings:4, frets:[1,1,1,4] }],
  'Ebm': [{ name:'Ebm', instrument:'ukulele', baseFret:1, strings:4, frets:[3,3,2,1] }],
  'Eb':  [{ name:'Eb', instrument:'ukulele', baseFret:1, strings:4, frets:[0,3,3,1] }],
  'Eb7': [{ name:'Eb7', instrument:'ukulele', baseFret:1, strings:4, frets:[3,3,3,4] }],
  'F#':  [{ name:'F#', instrument:'ukulele', baseFret:1, strings:4, frets:[3,1,2,1] }],
  'F#m': [{ name:'F#m', instrument:'ukulele', baseFret:1, strings:4, frets:[2,1,2,0] }],
  'F#7': [{ name:'F#7', instrument:'ukulele', baseFret:1, strings:4, frets:[3,4,2,1] }],
  'Gb':  [{ name:'Gb', instrument:'ukulele', baseFret:1, strings:4, frets:[3,1,2,1] }],
  'G#':  [{ name:'G#', instrument:'ukulele', baseFret:1, strings:4, frets:[5,3,4,3] }],
  'Ab':  [{ name:'Ab', instrument:'ukulele', baseFret:1, strings:4, frets:[5,3,4,3] }],
  'Abm': [{ name:'Abm', instrument:'ukulele', baseFret:1, strings:4, frets:[4,3,4,2] }],
  'Bb':  [{ name:'Bb', instrument:'ukulele', baseFret:1, strings:4, frets:[3,2,1,1] }],
  'Bbm': [{ name:'Bbm', instrument:'ukulele', baseFret:1, strings:4, frets:[3,1,1,1] }],
  'Bb7': [{ name:'Bb7', instrument:'ukulele', baseFret:1, strings:4, frets:[1,2,1,1] }],
  'A#':  [{ name:'A#', instrument:'ukulele', baseFret:1, strings:4, frets:[3,2,1,1] }],
  'A#m': [{ name:'A#m', instrument:'ukulele', baseFret:1, strings:4, frets:[3,1,1,1] }],
};
