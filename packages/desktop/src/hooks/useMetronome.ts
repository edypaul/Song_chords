import { useEffect, useRef, useState } from 'react';
import { useSettingsStore } from '@song-chords/shared';
import { scheduleMetronomeClick, normalizeMetronomeSound } from '../utils/metronome-sounds';

const SCHEDULE_AHEAD = 0.1; // seconds to schedule ahead
const TICK_MS = 25;         // scheduler poll interval

export function useMetronome(bpm: number, timeSig: string) {
  const [isPlaying, setIsPlaying]   = useState(false);
  const [currentBeat, setCurrentBeat] = useState(-1);

  const ctxRef      = useRef<AudioContext | null>(null);
  const nextTimeRef = useRef(0);
  const beatRef     = useRef(0);
  const timerRef    = useRef<ReturnType<typeof setInterval> | null>(null);
  // Keep latest values accessible inside the scheduler closure
  const bpmRef      = useRef(bpm);
  const beatsRef    = useRef(4);

  bpmRef.current  = bpm;
  beatsRef.current = parseInt(timeSig?.split('/')[0] ?? '4') || 4;

  // Sound options from settings, readable inside the scheduler closure
  // without restarting the beat — changing the timbre/volume mid-bar
  // just affects the next scheduled click.
  const sound  = useSettingsStore((s) => normalizeMetronomeSound(s.settings.metronomeSound));
  const volume = useSettingsStore((s) => s.settings.metronomeVolume ?? 0.7);
  const accent = useSettingsStore((s) => s.settings.metronomeAccent ?? true);
  const optsRef = useRef({ sound, volume, accent });
  optsRef.current = { sound, volume, accent };

  const scheduler = () => {
    const ctx = ctxRef.current!;
    while (nextTimeRef.current < ctx.currentTime + SCHEDULE_AHEAD) {
      const beat = beatRef.current;
      const { sound: snd, volume: vol, accent: acc } = optsRef.current;
      scheduleMetronomeClick(ctx, nextTimeRef.current, {
        sound: snd,
        volume: vol,
        accent: beat === 0 && acc,
      });
      // Visual update fired at the right moment
      const delayMs = Math.max(0, (nextTimeRef.current - ctx.currentTime) * 1000);
      const captured = beat;
      setTimeout(() => setCurrentBeat(captured), delayMs);
      nextTimeRef.current += 60 / bpmRef.current;
      beatRef.current = (beatRef.current + 1) % beatsRef.current;
    }
  };

  const stop = () => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    setIsPlaying(false);
    setCurrentBeat(-1);
  };

  const start = () => {
    if (!ctxRef.current) ctxRef.current = new AudioContext();
    if (ctxRef.current.state === 'suspended') void ctxRef.current.resume();
    beatRef.current    = 0;
    nextTimeRef.current = ctxRef.current.currentTime + 0.05;
    timerRef.current   = setInterval(scheduler, TICK_MS);
    setIsPlaying(true);
  };

  const toggle = () => (isPlaying ? stop() : start());

  // Restart on BPM / time-sig change while playing
  useEffect(() => {
    if (isPlaying) { stop(); start(); }
  }, [bpm, timeSig]);

  // Cleanup on unmount
  useEffect(() => () => stop(), []);

  return { isPlaying, currentBeat, beatsPerMeasure: beatsRef.current, toggle };
}
