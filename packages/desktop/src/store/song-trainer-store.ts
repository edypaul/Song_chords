import { create } from 'zustand';

/**
 * In-session state for the "Song Trainer" feature.
 *
 * When enabled, ChordLine hides a random subset of chord-name
 * occurrences and renders each as a `?`. Clicking the `?` reveals
 * that specific occurrence (per-occurrence, not per-chord-name) for
 * the rest of the practice session.
 *
 * The hidden set is picked FRESH each time the user:
 *   • turns the trainer on,
 *   • changes the hide-percentage,
 *   • switches to a different song.
 * That's done by regenerating a `nonce` on those transitions and
 * mixing it into the per-occurrence hash — the hash stays stable
 * across re-renders (so the user isn't chasing a moving target
 * mid-session), but the CHOICE of which occurrences to hide is
 * random each session.
 *
 * The trainer is also turned OFF on every song change so a user
 * who opted in for Song A doesn't get chord names silently hidden
 * on Song B. They re-enable per song from the toolbar.
 *
 * Nothing persists — the feature is a practice aid, not a preference.
 */

/** Percentage range accepted by the trainer's slider — 10 % to 100 %
 *  in 5 % steps. Anything outside is clamped by the setter. */
export const TRAINER_MIN = 10;
export const TRAINER_MAX = 100;
export const TRAINER_STEP = 5;

interface SongTrainerState {
  enabled: boolean;
  /** Percentage of chord-name occurrences to hide (10..100, stepped by 5). */
  percentage: number;
  /** Song id whose reveals we're currently tracking. When it changes,
   *  `revealed` clears and `nonce` is regenerated — Song A's reveals
   *  don't leak into Song B, and Song B's hidden set is randomised
   *  fresh for its practice session. */
  currentSongId: string | null;
  /** Per-occurrence reveal keys the user has clicked open. Format:
   *  `${sectionIndex}:${lineIndex}:${chunkIndex}:${chord}`. Kept as a
   *  Set for O(1) membership checks in the ChordLine render path. */
  revealed: Set<string>;
  /** Random 32-bit salt mixed into the hide-selection hash. Regenerated
   *  on every transition that should reshuffle the hidden set (enable,
   *  percentage change, song change). Stable across pure re-renders so
   *  the user isn't chasing a moving target mid-practice. */
  nonce: number;

  setEnabled: (v: boolean) => void;
  toggleEnabled: () => void;
  /** Setter clamps to [TRAINER_MIN, TRAINER_MAX] and snaps to the
   *  nearest TRAINER_STEP. Clears reveals and regenerates the nonce
   *  so the new percentage starts with a fresh random hidden set. */
  setPercentage: (n: number) => void;
  /** Mark an occurrence key as revealed. */
  reveal: (key: string) => void;
  /** Reset reveals + regenerate the nonce when the active song
   *  changes. No-op when the id matches what we're already tracking. */
  syncActiveSong: (songId: string | null) => void;
  /** Reshuffle the hidden set without changing the percentage — used
   *  by the toolbar's "Shuffle" affordance so the user can practise
   *  the same song multiple times against different hidden sets. */
  reshuffle: () => void;
}

const clampPercentage = (n: number): number => {
  if (!Number.isFinite(n)) return TRAINER_MIN;
  const stepped = Math.round(n / TRAINER_STEP) * TRAINER_STEP;
  return Math.min(TRAINER_MAX, Math.max(TRAINER_MIN, stepped));
};

/** Fresh 32-bit unsigned nonce. Session-only, non-cryptographic —
 *  `Math.random()` is fine for shuffling a UI hidden-set. */
const nextNonce = (): number => Math.floor(Math.random() * 0x1_0000_0000) >>> 0;

export const useSongTrainerStore = create<SongTrainerState>((set) => ({
  enabled: false,
  percentage: 50,
  currentSongId: null,
  revealed: new Set<string>(),
  nonce: nextNonce(),

  setEnabled: (v) => set((s) => {
    if (s.enabled === v) return s;
    // Turning ON gets a fresh nonce so the FIRST enable in a session
    // isn't cached across app restarts (unlikely to matter but keeps
    // the "random each time" contract simple). Turning OFF also
    // regenerates so the NEXT enable is a different pick — otherwise
    // toggling off/on with the same percentage would show the same
    // hidden set until the user changed something else.
    return { enabled: v, revealed: new Set<string>(), nonce: nextNonce() };
  }),
  toggleEnabled: () => set((s) => ({
    enabled: !s.enabled,
    revealed: new Set<string>(),
    nonce: nextNonce(),
  })),
  setPercentage: (n) => set((s) => {
    const next = clampPercentage(n);
    if (next === s.percentage) return s;
    return { percentage: next, revealed: new Set<string>(), nonce: nextNonce() };
  }),
  reveal: (key) => set((s) => {
    if (s.revealed.has(key)) return s;
    const next = new Set(s.revealed);
    next.add(key);
    return { revealed: next };
  }),
  syncActiveSong: (songId) => set((s) => {
    if (s.currentSongId === songId) return s;
    // Turn the trainer OFF on every song change. The user opted in
    // for a specific song; carrying that opt-in silently into the
    // next song surprised them (chord names suddenly hidden on a
    // song they hadn't asked to train on). They can re-enable per
    // song from the toolbar. Reveals + nonce also reset so the
    // next enable starts with a fresh random hidden set.
    return {
      currentSongId: songId,
      enabled: false,
      revealed: new Set<string>(),
      nonce: nextNonce(),
    };
  }),
  reshuffle: () => set(() => ({ revealed: new Set<string>(), nonce: nextNonce() })),
}));

/** Fast 32-bit hash of a string (FNV-1a). Used to bucket chord
 *  occurrences into "hidden" / "shown" at the current percentage.
 *  The nonce mixed into the input by the caller is what randomises
 *  the pick across sessions — the hash function itself is
 *  deterministic so a re-render doesn't reshuffle mid-practice. */
function hashString(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h;
}

/** True when the given occurrence should be HIDDEN behind a `?` at
 *  the current trainer percentage. Random per session (via `nonce`),
 *  stable within a session (so the hidden set doesn't shift on
 *  re-render). */
export function isHiddenAtPercentage(
  songId: string,
  occurrenceKey: string,
  percentage: number,
  nonce: number,
): boolean {
  if (percentage <= 0) return false;
  if (percentage >= 100) return true;
  // Bucket 0..99 — hide when bucket < percentage. Mixing the nonce
  // into the hash reshuffles which occurrences fall into which
  // bucket each time a new nonce is generated.
  const bucket = hashString(`${nonce}::${songId}::${occurrenceKey}`) % 100;
  return bucket < percentage;
}
