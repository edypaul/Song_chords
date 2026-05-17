import { create } from 'zustand';
import type { CastMode } from '../utils/cast-html';

/**
 * Tiny renderer-side store tracking which per-song HTML cast mode is
 * currently active (if any).
 *
 * WHY this exists: the per-song cast is triggered from `CastQuickButton`,
 * which is rendered INSIDE the song/performance three-dots menu. That
 * menu unmounts when closed, destroying the button's local state — so
 * its "re-push the song HTML when the player changes" subscription dies
 * too. Result: navigating songs in a setlist Performance view left the
 * receiver stuck on the first song.
 *
 * The fix is a persistent app-level sync (see `CastSync`) that needs to
 * know which mode the user picked even after the button is gone. This
 * store is that durable handoff. It is desktop-only renderer state
 * (casting is an Electron feature), so it lives in the desktop package
 * rather than the shared store layer.
 *
 * `htmlMode === null` means no per-song HTML cast is active (server may
 * still be running in full-app MIRROR mode — that path doesn't need a
 * payload re-push, the mirror captures the live window directly).
 */
interface CastSyncState {
  /** Active per-song HTML cast mode, or null when not HTML-casting. */
  htmlMode: CastMode | null;
  /** Mark an HTML cast active with the chosen render mode. */
  setHtmlMode: (mode: CastMode) => void;
  /** Clear when the cast stops (or flips to full-app mirror). */
  clearHtmlMode: () => void;
}

export const useCastSyncStore = create<CastSyncState>((set) => ({
  htmlMode: null,
  setHtmlMode: (mode) => set({ htmlMode: mode }),
  clearHtmlMode: () => set({ htmlMode: null }),
}));
