import { createContext, useContext } from 'react';

/**
 * The audio-player context lives in its OWN module, separate from the
 * provider component (`AudioPlayer.tsx`). Keeping `createContext` in a
 * file that exports only the context + hook (no components) matters
 * for Vite/React Fast Refresh: a file that mixes a component export
 * with a context export can't be hot-refreshed in place, so an edit
 * anywhere in its import graph re-instantiated the module — the
 * mounted provider kept feeding the OLD context object while
 * consumers imported a NEW one, and every `useAudioPlayer()` call
 * crashed with "must be used within AudioPlayerProvider" until a full
 * reload. With the context isolated here, hot updates swap the
 * provider component while this module (and the context identity)
 * stays put.
 */

export interface AudioPlayerSourceInput {
  /** Local audio file path. Wins over `link` when both set. */
  audioFile?: string;
  /** Remote URL (YouTube / SoundCloud / Spotify / direct mp3 / etc.). */
  link?: string;
}

export interface AudioPlayerCtx {
  /** Open the floating player for the given song. No-op if neither
   *  source is set. Replaces whatever was playing. */
  open: (title: string, source: AudioPlayerSourceInput) => void;
  /** Close the player if it's open. */
  close: () => void;
  /** Currently-loaded source, or null when the player is closed. */
  current: { title: string; audioFile?: string; link?: string } | null;
}

export const AudioPlayerContext = createContext<AudioPlayerCtx | null>(null);

export function useAudioPlayer(): AudioPlayerCtx {
  const ctx = useContext(AudioPlayerContext);
  if (!ctx) throw new Error('useAudioPlayer must be used within AudioPlayerProvider');
  return ctx;
}
