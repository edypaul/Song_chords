import { useEffect } from 'react';
import { usePlayerStore, useSettingsStore } from '@song-chords/shared';
import { buildCastHtml } from '../../utils/cast-html';
import { useCastSyncStore } from '../../store/cast-sync-store';

/**
 * Persistent, app-level cast synchroniser. Mounted ONCE at the app root
 * so it lives independently of any menu or page.
 *
 * Why it exists: the per-song cast is triggered from `CastQuickButton`,
 * which sits inside the song / performance three-dots menu and unmounts
 * when that menu closes. Its own "re-push HTML when the player changes"
 * subscription died with it, so navigating songs in a setlist
 * Performance view left the receiver frozen on the first song. This
 * component owns that re-push for the whole app lifetime instead.
 *
 * Behaviour:
 *  - Only acts when a per-song HTML cast mode is active (the durable
 *    `useCastSyncStore.htmlMode`, set by CastQuickButton). Full-app
 *    MIRROR casts need no payload push — the server captures the live
 *    window — so this stays inert for them.
 *  - Re-pushes `buildCastHtml(activeSong, htmlMode)` whenever the
 *    player store (song nav, transpose, capo, view mode) or settings
 *    (theme, accidentals, etc.) change, keeping the receiver in lock
 *    step with the desktop — including song-to-song navigation in a
 *    setlist.
 *  - Setlist NOTE items are never cast: PerformPage's loader leaves
 *    `activeSong` pointing at the previous SONG while a note item is
 *    on screen (notes are private performer cues), and this only ever
 *    pushes `activeSong`. So moving onto a note keeps the last song on
 *    the audience screen and never leaks the note text.
 *  - Verifies the server is genuinely in `html` mode before pushing,
 *    so a stale store entry can't push at a stopped / mirror server.
 */
export default function CastSync(): null {
  const htmlMode = useCastSyncStore((s) => s.htmlMode);
  const clearHtmlMode = useCastSyncStore((s) => s.clearHtmlMode);

  useEffect(() => {
    if (!htmlMode) return;

    let disposed = false;

    const push = async () => {
      if (disposed) return;
      const active = usePlayerStore.getState().activeSong;
      // No active SONG (e.g. nothing loaded yet) → nothing to cast.
      // Note items never set activeSong, so this also covers "user is
      // on a setlist note": the previous song stays on the receiver.
      if (!active) return;
      try {
        const status = await window.electronAPI.cast.status();
        if (disposed) return;
        if (!status.running) {
          // Server died (user stopped it elsewhere) — drop our mode so
          // we stop trying to push.
          clearHtmlMode();
          return;
        }
        if (status.mode !== 'html') {
          // Flipped to full-app mirror (or idle) — the per-song HTML
          // cast is no longer the active broadcast; stay out of its way.
          return;
        }
        const html = buildCastHtml(active, htmlMode);
        await window.electronAPI.cast.setHtml(html);
      } catch {
        /* transient IPC error — the next store change retries */
      }
    };

    // Push immediately so a freshly-activated cast (or this component
    // mounting after a cast was already started) syncs the current
    // song right away.
    void push();

    const unsubPlayer = usePlayerStore.subscribe(() => void push());
    const unsubSettings = useSettingsStore.subscribe(() => void push());
    return () => {
      disposed = true;
      unsubPlayer();
      unsubSettings();
    };
  }, [htmlMode, clearHtmlMode]);

  return null;
}
