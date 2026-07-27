import React, { useEffect, useRef, useState } from 'react';
import { X, ExternalLink, GripHorizontal } from 'lucide-react';
import { useT } from '../../i18n';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Load the YouTube IFrame Player API exactly once for the whole app
 * and resolve when `window.YT.Player` is ready. We need the API (not
 * a plain <iframe src=embed>) because only the API surfaces an
 * `onError` event — that's the ONLY reliable signal that a video has
 * embedding disabled by its owner (error codes 101 / 150) or is
 * otherwise unplayable in an embed (2 / 5 / 100). A raw iframe just
 * silently shows YouTube's "Video unavailable" screen with no event
 * we can hook, which is why auto-fallback never worked before.
 */
let ytApiPromise: Promise<void> | null = null;
function loadYouTubeApi(): Promise<void> {
  if (ytApiPromise) return ytApiPromise;
  ytApiPromise = new Promise<void>((resolve) => {
    const w = window as any;
    if (w.YT && w.YT.Player) { resolve(); return; }
    const prev = w.onYouTubeIframeAPIReady;
    w.onYouTubeIframeAPIReady = () => {
      if (typeof prev === 'function') prev();
      resolve();
    };
    if (!document.querySelector('script[data-yt-iframe-api]')) {
      const s = document.createElement('script');
      s.src = 'https://www.youtube.com/iframe_api';
      s.async = true;
      s.setAttribute('data-yt-iframe-api', '1');
      document.head.appendChild(s);
    }
  });
  return ytApiPromise;
}

interface Props {
  /** Song title — shown in the panel header. */
  title: string;
  /** Parsed YouTube video ID (caller guarantees it's valid). */
  videoId: string;
  /** Original watch URL — used by the "open in browser" affordance. */
  watchUrl: string;
  onClose: () => void;
}

/**
 * In-app, draggable, WhatsApp-style floating YouTube player.
 *
 * Replaces the old child `BrowserWindow` popup for YouTube links:
 * a compact 16:9 panel that floats over the app, can be dragged
 * anywhere by its header, and embeds the privacy-enhanced YouTube
 * iframe (which — unlike the watch page — is embeddable, so no
 * separate OS window is needed). YouTube's own iframe controls handle
 * play / pause / seek / fullscreen / volume; we only own the window
 * chrome (title, drag, close, open-externally).
 *
 * Non-YouTube links never reach this component — the AudioPlayer
 * provider still routes those to the BrowserWindow popup.
 */
export default function YouTubePlayerPanel({ title, videoId, watchUrl, onClose }: Props): React.ReactElement {
  const t = useT();
  // 16:9 at a compact width — matches the old 400×300 popup footprint
  // but a touch wider so the video isn't letterboxed.
  const WIDTH = 420;
  // +40 header bar, +28 for the "open in browser" fallback strip,
  // so the video area itself stays a clean 16:9.
  const HEIGHT = Math.round((WIDTH * 9) / 16) + 40 + 28;
  const MARGIN = 20;

  const [pos, setPos] = useState(() => ({
    x: Math.max(MARGIN, (typeof window !== 'undefined' ? window.innerWidth : 1200) - WIDTH - MARGIN),
    y: 100,
  }));
  const dragRef = useRef<{ dx: number; dy: number; id: number } | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const playerHostRef = useRef<HTMLDivElement>(null);

  // Mount the IFrame Player API and auto-fall-back on error. An
  // embed-disabled / unavailable video must hand off to the
  // always-on-top browser popup IMMEDIATELY and silently — no notice,
  // no delay — then this panel closes. Codes: 101 & 150 = owner
  // disabled embedding; 2 = bad param; 5 = HTML5 player error;
  // 100 = removed / private. All mean "can't play here" → hand off.
  useEffect(() => {
    let player: any = null;
    let cancelled = false;
    void loadYouTubeApi().then(() => {
      if (cancelled || !playerHostRef.current) return;
      const w = window as any;
      player = new w.YT.Player(playerHostRef.current, {
        videoId,
        playerVars: { autoplay: 1, rel: 0, modestbranding: 1, playsinline: 1 },
        events: {
          onError: () => {
            if (cancelled) return;
            // Open the original watch URL in the in-app browser popup
            // (no embed restriction there) and close this panel right
            // away — the user goes straight from click to a playing
            // video, never seeing a dead embed or a transition notice.
            void window.electronAPI.youtube.openPopup(watchUrl);
            onClose();
          },
        },
      });
    });
    return () => {
      cancelled = true;
      try { player?.destroy?.(); } catch { /* ignore */ }
    };
    // videoId is stable per panel instance (keyed by the caller).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoId]);

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    // Buttons inside the header opt out of the drag.
    if ((e.target as HTMLElement).closest('[data-no-drag]')) return;
    const rect = panelRef.current?.getBoundingClientRect();
    if (!rect) return;
    dragRef.current = { dx: e.clientX - rect.left, dy: e.clientY - rect.top, id: e.pointerId };
    try { (e.currentTarget as Element).setPointerCapture(e.pointerId); } catch { /* ignore */ }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d || d.id !== e.pointerId) return;
    // Keep at least a sliver on-screen so the panel can't be lost.
    const nextX = Math.max(-WIDTH + 60, Math.min(window.innerWidth - 60, e.clientX - d.dx));
    const nextY = Math.max(0, Math.min(window.innerHeight - 40, e.clientY - d.dy));
    setPos({ x: nextX, y: nextY });
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const d = dragRef.current;
    dragRef.current = null;
    if (!d) return;
    try { (e.currentTarget as Element).releasePointerCapture(d.id); } catch { /* ignore */ }
  };

  return (
    <div
      ref={panelRef}
      className="fixed rounded-xl overflow-hidden shadow-2xl flex flex-col"
      style={{
        left: pos.x,
        top: pos.y,
        width: WIDTH,
        height: HEIGHT,
        zIndex: 9999,
        background: 'var(--bg-secondary)',
        border: '1px solid var(--border)',
      }}
      role="dialog"
      aria-label={t('youtube.playerAria', { title })}
    >
      {/* Drag handle / header */}
      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        className="flex items-center gap-2 px-3 select-none"
        style={{ height: 40, cursor: 'grab', background: 'var(--surface)', borderBottom: '1px solid var(--border)' }}
      >
        <GripHorizontal size={14} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
        <span className="flex-1 truncate text-xs font-medium" style={{ color: 'var(--text-primary)' }} title={title}>
          {title}
        </span>
        <button
          data-no-drag
          onClick={() => { void window.electronAPI.shell.openExternal(watchUrl); }}
          className="p-1 rounded transition-colors hover:bg-[var(--surface-elevated)]"
          style={{ color: 'var(--text-muted)' }}
          title={t('youtube.openInBrowser')}
          aria-label={t('youtube.openInBrowser')}
        >
          <ExternalLink size={14} />
        </button>
        <button
          data-no-drag
          onClick={onClose}
          className="p-1 rounded transition-colors hover:bg-[var(--surface-elevated)]"
          style={{ color: 'var(--text-muted)' }}
          title={t('youtube.closePlayer')}
          aria-label={t('youtube.closePlayer')}
        >
          <X size={15} />
        </button>
      </div>

      {/* Video — the YouTube IFrame Player API replaces this host div
          with its own <iframe>. Using the API (not a raw iframe) is
          what lets us catch onError and auto-fall-back below. */}
      <div style={{ flex: 1, background: '#000', position: 'relative' }}>
        <div ref={playerHostRef} style={{ width: '100%', height: '100%' }} />
      </div>

      {/* Manual fallback — kept as a belt-and-suspenders. The onError
          handler auto-hands-off for embed-disabled / unavailable
          videos, but some failure modes (a video that loads then
          errors mid-playback, or API edge cases) may not fire it; the
          button lets the user force the browser-window popup any
          time. */}
      <button
        data-no-drag
        onClick={() => { void window.electronAPI.youtube.openPopup(watchUrl); onClose(); }}
        className="w-full text-[11px] py-1.5 transition-colors hover:opacity-80"
        style={{
          background: 'var(--surface)',
          color: 'var(--text-muted)',
          borderTop: '1px solid var(--border)',
          flexShrink: 0,
        }}
        title={t('youtube.notPlayingTitle')}
      >
        {t('youtube.notPlaying')}
      </button>
    </div>
  );
}
