import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { X, ExternalLink, AlertCircle, FileAudio, Globe, ArrowLeft } from 'lucide-react';
import { fileBasename, pathToAudioUrl } from '../../utils/audio-source';
import CustomAudioPlayer, { type CustomAudioPlayerHandle } from './CustomAudioPlayer';

interface Props {
  /** Title shown in the panel header — the song title. */
  title: string;
  /** Optional absolute path to a local audio file. */
  audioFile?: string;
  /** Optional remote URL (YouTube / SoundCloud / Spotify / direct mp3
   *  / etc.). Shown in the chooser when the song also has a local
   *  file. */
  link?: string;
  /** Called when the user picks "Online source" from the chooser.
   *  Delegates URL playback back to the provider so a YouTube link
   *  gets the SAME routing as a URL-only song (custom in-app player
   *  for embeddable videos, browser popup otherwise) instead of
   *  always force-opening the popup window. */
  onPlayUrl?: (title: string, link: string) => void;
  onClose: () => void;
}

/**
 * Floating, draggable, resizable audio panel for *local-file* playback.
 *
 * Two internal modes:
 *   - **chooser** — when the song has BOTH a local file AND a remote
 *     link. User picks which source to play.
 *   - **file** — custom audio player with play / pause / seek /
 *     volume / ±10s controls. Streams via the `song-audio://` custom
 *     protocol.
 *
 * URL playback never renders here. Songs with only a `link` skip the
 * panel entirely (the provider opens the popup window directly).
 * Picking "Online source" from the chooser closes the panel and
 * routes through the same popup IPC.
 */
export default function AudioPlayerPanel({ title, audioFile, link, onPlayUrl, onClose }: Props): React.ReactElement | null {
  const hasFile = !!(audioFile && audioFile.trim());
  const hasUrl = !!(link && link.trim());

  type Mode = 'chooser' | 'file';
  const initialMode: Mode = hasFile && hasUrl ? 'chooser' : 'file';
  const [mode, setMode] = useState<Mode>(initialMode);
  const [loadError, setLoadError] = useState(false);

  // Reset mode + clear error when the song changes (panel persists
  // across navigation; new song = clean slate).
  useEffect(() => {
    setMode(initialMode);
    setLoadError(false);
  }, [audioFile, link, initialMode]);

  const fileUrl = audioFile ? pathToAudioUrl(audioFile) : '';
  const playerRef = useRef<CustomAudioPlayerHandle>(null);

  // Chooser is fixed-size — its content (label + two cards) doesn't
  // benefit from resizing, and a stable footprint feels purposeful.
  // The file-mode panel stays user-resizable.
  const CHOOSER_W = 380;
  const CHOOSER_H = 260;
  const dimensionsFor = (m: Mode): { w: number; h: number } => {
    if (m === 'file') return { w: 460, h: 160 };
    return { w: CHOOSER_W, h: CHOOSER_H };
  };
  const MARGIN = 20;

  const [pos, setPos] = useState(() => {
    const init = dimensionsFor(initialMode);
    return {
      x: Math.max(MARGIN, (typeof window !== 'undefined' ? window.innerWidth : 1200) - init.w - MARGIN),
      y: 100,
    };
  });
  const [size, setSize] = useState(() => dimensionsFor(initialMode));
  const userResizedRef = useRef(false);
  const ignoreNextResizeRef = useRef(0);
  const dragRef = useRef<{ dx: number; dy: number; id: number } | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Snap size to the right preset whenever the mode changes.
  useLayoutEffect(() => {
    const next = dimensionsFor(mode);
    userResizedRef.current = false;
    ignoreNextResizeRef.current += 1;
    setSize(next);
  }, [mode]);

  useEffect(() => {
    const el = panelRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (!rect) return;
      const w = Math.round(rect.width);
      const h = Math.round(rect.height);
      if (ignoreNextResizeRef.current > 0) {
        ignoreNextResizeRef.current--;
      } else {
        userResizedRef.current = true;
      }
      setSize({ w, h });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if ((e.target as HTMLElement).closest('[data-no-drag]')) return;
    const rect = panelRef.current?.getBoundingClientRect();
    if (!rect) return;
    dragRef.current = { dx: e.clientX - rect.left, dy: e.clientY - rect.top, id: e.pointerId };
    try { (e.currentTarget as Element).setPointerCapture(e.pointerId); } catch { /* ignore */ }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d || d.id !== e.pointerId) return;
    const nextX = Math.max(0, Math.min(window.innerWidth - 40, e.clientX - d.dx));
    const nextY = Math.max(0, Math.min(window.innerHeight - 40, e.clientY - d.dy));
    setPos({ x: nextX, y: nextY });
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const d = dragRef.current;
    dragRef.current = null;
    if (!d) return;
    try { (e.currentTarget as Element).releasePointerCapture(d.id); } catch { /* ignore */ }
  };

  // Defensive — parent shouldn't open us with no file. URL-only songs
  // bypass the panel via the provider.
  if (!hasFile) return null;

  const openExternalAudio = () => {
    // Stop our own playback first so the user doesn't hear the song
    // twice (in-app player + the external app at once).
    playerRef.current?.pause();
    // Open the REAL file path with the OS default audio app (VLC etc.)
    // via shell.openPath. Passing the song-audio:// URL to
    // openExternal made Windows show "you'll need a new app from the
    // Store" because nothing is registered for that custom scheme.
    if (audioFile) void window.electronAPI.shell.openPath(audioFile);
  };

  const handlePickUrl = () => {
    // Delegate back to the provider so YouTube links open the custom
    // in-app player (for embeddable videos) exactly like a URL-only
    // song does. Falling back to the popup directly here is what made
    // "Online source" always skip the custom player. `onPlayUrl` is
    // optional; if a caller renders this panel without it, keep the
    // old popup behaviour so nothing breaks.
    if (link) {
      if (onPlayUrl) onPlayUrl(title, link);
      else void window.electronAPI.youtube.openPopup(link);
    }
    onClose();
  };

  const showBackToChooser = hasFile && hasUrl && mode !== 'chooser';

  return (
    <div
      ref={panelRef}
      className="fixed rounded-xl shadow-2xl border flex flex-col"
      style={{
        left: pos.x,
        top: pos.y,
        // Chooser uses fixed dimensions; file mode follows user
        // resizing via the bottom-right grip.
        width: mode === 'chooser' ? CHOOSER_W : size.w,
        height: mode === 'chooser' ? CHOOSER_H : size.h,
        minWidth: mode === 'chooser' ? CHOOSER_W : 320,
        minHeight: mode === 'chooser' ? CHOOSER_H : 140,
        maxWidth: mode === 'chooser' ? CHOOSER_W : '95vw',
        maxHeight: mode === 'chooser' ? CHOOSER_H : '90vh',
        resize: mode === 'chooser' ? 'none' : 'both',
        overflow: 'hidden',
        background: 'var(--bg-secondary)',
        borderColor: 'var(--border)',
        // Float above all other in-renderer UI (modals z≈1000, cast
        // popover z=1000, etc.) so the audio panel stays visible while
        // the user interacts with the rest of the app — matching the
        // YouTube player panel (z=9999) and the always-on-top browser
        // popup window.
        zIndex: 9999,
      }}
    >
      {/* Drag handle / header */}
      <div
        className="flex items-center justify-between px-3 py-2 border-b select-none"
        style={{ borderColor: 'var(--border)', cursor: 'grab', touchAction: 'none' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <div className="flex items-center gap-2 min-w-0">
          {showBackToChooser && (
            <button
              data-no-drag
              onClick={() => { setMode('chooser'); setLoadError(false); }}
              className="p-1 rounded hover:bg-[var(--surface-elevated)]"
              style={{ color: 'var(--text-muted)' }}
              title="Switch source"
              aria-label="Switch source"
            >
              <ArrowLeft size={13} />
            </button>
          )}
          <FileAudio size={14} style={{ color: 'var(--accent)' }} />
          <div className="flex flex-col min-w-0">
            <h3 className="font-semibold text-xs truncate" style={{ color: 'var(--text-primary)' }} title={title}>
              {title}
            </h3>
            {mode === 'file' && audioFile && (
              <span className="text-[10px] truncate font-mono" style={{ color: 'var(--text-muted)' }} title={audioFile}>
                {fileBasename(audioFile)}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1" data-no-drag>
          {mode === 'file' && (
            <button
              onClick={openExternalAudio}
              className="p-1 rounded hover:bg-[var(--surface-elevated)]"
              style={{ color: 'var(--text-muted)' }}
              title="Open in default audio app"
              aria-label="Open in external app"
            >
              <ExternalLink size={13} />
            </button>
          )}
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-[var(--surface-elevated)]"
            style={{ color: 'var(--text-muted)' }}
            title="Close"
            aria-label="Close audio panel"
          >
            <X size={13} />
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 relative flex items-center justify-center" style={{ background: 'var(--bg)' }}>
        {mode === 'chooser' && (
          <ChooserBody
            onPickFile={() => { setMode('file'); setLoadError(false); }}
            onPickUrl={handlePickUrl}
            audioFile={audioFile}
            link={link}
          />
        )}

        {mode === 'file' && !loadError && fileUrl && (
          <CustomAudioPlayer
            ref={playerRef}
            key={fileUrl}
            src={fileUrl}
            autoPlay
            onError={() => setLoadError(true)}
          />
        )}

        {loadError && mode === 'file' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center" style={{ background: 'var(--bg)', color: 'var(--text-secondary)' }}>
            <AlertCircle size={28} style={{ color: 'var(--accent)' }} />
            <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
              Couldn't play this file
            </span>
            <span className="text-xs max-w-sm">
              The file may have been moved, renamed, or deleted. Re-attach it from the song edit page, or open it in your default audio app.
            </span>
            <div className="flex items-center gap-2 mt-2">
              {showBackToChooser && (
                <button
                  onClick={() => { setMode('chooser'); setLoadError(false); }}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold"
                  style={{ background: 'var(--surface-elevated)', color: 'var(--text-secondary)' }}
                >
                  Try other source
                </button>
              )}
              <button
                onClick={openExternalAudio}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold"
                style={{ background: 'var(--accent)', color: 'white' }}
              >
                <ExternalLink size={12} /> Open in audio app
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** Two big buttons asking the user which source to play. Shown only
 *  when both `audioFile` and `link` are set on the song. "Online
 *  source" hands off to a child BrowserWindow rather than an iframe —
 *  reliably plays YouTube videos that have embedding disabled. */
function ChooserBody({
  onPickFile,
  onPickUrl,
  audioFile,
  link,
}: {
  onPickFile: () => void;
  onPickUrl: () => void;
  audioFile?: string;
  link?: string;
}): React.ReactElement {
  return (
    <div className="flex flex-col gap-3 p-4 w-full">
      <span className="text-xs font-semibold uppercase tracking-wider text-center" style={{ color: 'var(--text-muted)', letterSpacing: '0.08em' }}>
        Pick a source
      </span>
      <button
        onClick={onPickFile}
        className="flex items-start gap-3 p-3 rounded-lg text-left transition-colors"
        style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
      >
        <FileAudio size={16} style={{ color: 'var(--accent)', marginTop: 2, flexShrink: 0 }} />
        <span className="flex flex-col min-w-0 flex-1">
          <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Local file</span>
          <span className="text-xs truncate font-mono" style={{ color: 'var(--text-muted)' }} title={audioFile}>
            {audioFile ? fileBasename(audioFile) : ''}
          </span>
        </span>
      </button>
      <button
        onClick={onPickUrl}
        className="flex items-start gap-3 p-3 rounded-lg text-left transition-colors"
        style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
      >
        <Globe size={16} style={{ color: 'var(--accent)', marginTop: 2, flexShrink: 0 }} />
        <span className="flex flex-col min-w-0 flex-1">
          <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Online source</span>
          <span className="text-xs truncate" style={{ color: 'var(--text-muted)' }} title={link}>
            {link ?? ''}
          </span>
        </span>
      </button>
    </div>
  );
}
