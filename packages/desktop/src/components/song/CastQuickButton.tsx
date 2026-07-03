import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import QRCode from 'qrcode';
import { Cast, X, Power, LayoutGrid, Copy, Check } from 'lucide-react';
import { usePlayerStore } from '@song-chords/shared';
import { buildCastHtml, type CastMode as HtmlCastMode } from '../../utils/cast-html';
import { useCastSyncStore } from '../../store/cast-sync-store';

type Mode = HtmlCastMode; // 'lyrics' | 'lyrics-chords'

/**
 * Compact "Cast this song" trigger used by the song / fullscreen /
 * performance toolbars. Renders just a Cast icon button; clicking it
 * opens a popover with two big choices:
 *
 *   - Show lyrics only      → cast switches to lyrics-only render
 *   - Lyrics and Chords     → cast switches to chord+lyric render
 *
 * Picking either one auto-starts the cast server (idempotent), flips
 * the capture source to the hidden render window in the right mode,
 * and shows the receiver URL + QR code so the audience can join. A
 * Stop button shuts everything back down.
 */
export default function CastQuickButton(): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode | null>(null);
  const [serverInfo, setServerInfo] = useState<{ host: string; port: number } | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [clients, setClients] = useState(0);
  // Brief "Copied!" confirmation after the user hits the copy-URL
  // button — flips back after ~1.5s so the icon doesn't stay green
  // forever. Reset on popover close / cast stop so the next open
  // starts fresh.
  const [copied, setCopied] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  // Popover position is computed from the icon button's bounding rect
  // so the popover can be portaled to <body> and avoid being clipped
  // by toolbars that use `overflow: hidden`. Recomputed on open and on
  // window resize.
  const [popoverPos, setPopoverPos] = useState<{ top: number; left: number } | null>(null);

  // Reflect the REAL cast-server state on mount (and keep it fresh),
  // independent of whether the popover is open. This component is
  // re-mounted every time its host three-dots menu closes/opens, so
  // its local `serverInfo` resets to null on each remount — without
  // this poll the Cast icon would look "off" right after closing the
  // menu even though the server is still actively casting. The cast
  // server lives in the Electron main process and is the source of
  // truth; we just mirror it. (The open-only refresh below stays for
  // the live viewer-count / URL while the popover is visible.)
  useEffect(() => {
    let cancelled = false;
    const sync = async () => {
      try {
        const s = await window.electronAPI.cast.status();
        if (cancelled) return;
        if (s.running && s.host && s.port) {
          setServerInfo({ host: s.host, port: s.port });
          setClients(s.clients);
        } else {
          setServerInfo(null);
        }
      } catch { /* ignore */ }
    };
    void sync();
    const id = setInterval(sync, 2500);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  // Pull current cast server status when the popover opens — if the
  // server is already running (e.g. user already cast from another
  // surface), we want to show its URL instead of starting fresh.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const refresh = async () => {
      try {
        const s = await window.electronAPI.cast.status();
        if (cancelled) return;
        if (s.running && s.host && s.port) {
          setServerInfo({ host: s.host, port: s.port });
        } else {
          setServerInfo(null);
        }
        setClients(s.clients);
      } catch { /* ignore */ }
    };
    void refresh();
    const id = setInterval(refresh, 2000);
    return () => { cancelled = true; clearInterval(id); };
  }, [open]);

  // Auto-start casting as soon as the popover opens — the user opened
  // it specifically to cast, so the QR + URL should be visible right
  // away without an extra click. Idempotent: if the server is already
  // running (e.g. user already cast this or another song), we just
  // re-push the current song's HTML so the receiver shows it.
  useEffect(() => {
    if (!open) return;
    if (mode) return; // already started this session — nothing to do
    void start('lyrics-chord-diagrams');
    // We deliberately don't depend on `mode` here — the first run for
    // a given `open=true` is enough; subsequent re-renders within the
    // same opening shouldn't kick off another start.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // QR generation tracks the live URL.
  const url = useMemo(() => {
    if (!serverInfo) return null;
    return `http://${serverInfo.host}:${serverInfo.port}/`;
  }, [serverInfo]);

  useEffect(() => {
    if (!url) {
      setQrDataUrl(null);
      return;
    }
    let cancelled = false;
    QRCode.toDataURL(url, { width: 200, margin: 1, color: { dark: '#0f172a', light: '#ffffff' } })
      .then((d) => { if (!cancelled) setQrDataUrl(d); })
      .catch(() => { if (!cancelled) setQrDataUrl(null); });
    return () => { cancelled = true; };
  }, [url]);

  // Click-outside to close the popover. Treats both the popover itself
  // and the icon button as "inside" — without that the icon click that
  // opens the popover would also immediately close it.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (popoverRef.current && popoverRef.current.contains(target)) return;
      if (buttonRef.current && buttonRef.current.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  // Compute popover position from the icon's bounding rect. Uses
  // `useLayoutEffect` so the popover is placed before paint — no
  // visible flash. Recomputed on resize / scroll so the popover stays
  // anchored when the user resizes the window or the toolbar shifts.
  //
  // Placement rule: anchor the popover under the icon and CLAMP its
  // horizontal position to the viewport. Previously we pinned the
  // popover's right edge to the icon's right edge, which pushed the
  // popover off the LEFT of the screen when the icon lived on the far
  // left of the window (e.g. the sidebar's cast button). By computing
  // an unclamped left first and then clamping to `[margin,
  // viewport - width - margin]`, the popover always sits fully inside
  // the visible area no matter where the trigger button lives.
  useLayoutEffect(() => {
    if (!open) return;
    const POPOVER_WIDTH = 320;
    const MARGIN = 8;
    const place = () => {
      const btn = buttonRef.current;
      if (!btn) return;
      const r = btn.getBoundingClientRect();
      // Preferred anchor: align the popover's RIGHT edge with the
      // icon's right edge (the original behavior, which reads well
      // when the icon sits in a top-right toolbar).
      const preferredLeft = r.right - POPOVER_WIDTH;
      const maxLeft = Math.max(MARGIN, window.innerWidth - POPOVER_WIDTH - MARGIN);
      const clampedLeft = Math.min(Math.max(preferredLeft, MARGIN), maxLeft);
      setPopoverPos({
        top: r.bottom + 8,
        left: clampedLeft,
      });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open]);

  // Re-push on payload-affecting changes is handled centrally by
  // `CastSync` mounted at the app root: it watches the same durable
  // `useCastSyncStore.htmlMode` this popover writes to. Duplicating
  // that subscription here caused every player / settings mutation to
  // fire TWO IPC pushes and (worse) subscribed to the whole stores
  // without a selector, so unrelated writes like auto-scroll toggle,
  // fullscreen, or inline-diagrams triggered a re-push and made the
  // receiver iframe reload. `CastSync` uses selective subscriptions
  // that only fire on fields `buildCastHtml` actually consumes.

  /** Build the HTML payload for whatever song the player store has
   *  active right now and push it to the server. Bails out gracefully
   *  if there's no song — the user might land in the popover before
   *  having opened any song. */
  const pushCurrentHtml = async (chosen: Mode): Promise<void> => {
    const active = usePlayerStore.getState().activeSong;
    if (!active) return;
    const html = buildCastHtml(active, chosen);
    await window.electronAPI.cast.setHtml(html);
  };

  const start = async (chosen: Mode) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      // start() is idempotent — returns the existing host/port if the
      // server is already up. Then we push the song HTML; the server
      // caches it and forwards to all current + future clients.
      const info = await window.electronAPI.cast.start('app');
      setServerInfo(info);
      await pushCurrentHtml(chosen);
      setMode(chosen);
      // Hand the active mode to the durable store so the app-level
      // CastSync keeps re-pushing on song navigation even after this
      // button (inside the three-dots menu) unmounts.
      useCastSyncStore.getState().setHtmlMode(chosen);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const stop = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await window.electronAPI.cast.stop();
      setServerInfo(null);
      setMode(null);
      // Cast fully stopped — clear the durable mode so CastSync goes
      // inert (no pushes at a dead server).
      useCastSyncStore.getState().clearHtmlMode();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  // Render the popover into <body> via a React portal. That escapes
  // any ancestor with `overflow: hidden` (e.g. the song-view toolbar)
  // which would otherwise clip the dropdown and make it look like the
  // button does nothing.
  const popover = open && popoverPos && createPortal(
    (
        <div
          ref={popoverRef}
          className="rounded-xl shadow-2xl"
          data-cast-popover
          style={{
            position: 'fixed',
            top: popoverPos.top,
            left: popoverPos.left,
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            width: 320,
            // Sit above any host menu (e.g. the song-view three-dots
            // menu which uses z-index 1000) so the cast popover is
            // visible when opened from inside that menu.
            zIndex: 1100,
            padding: 12,
          }}
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
              Cast this song
            </span>
            <button
              onClick={() => setOpen(false)}
              className="p-1 rounded hover:bg-[var(--surface-elevated)]"
              style={{ color: 'var(--text-muted)' }}
              aria-label="Close"
            >
              <X size={13} />
            </button>
          </div>

          {/* Quick description so users opening this for the first
              time understand what's happening on their phone before
              they scan / open the URL. Kept brief — the UI itself
              shows the QR + URL below. */}
          <p className="text-xs mb-3" style={{ color: 'var(--text-muted)', lineHeight: 1.4 }}>
            Share this song with any device on the same Wi-Fi. Scan the QR or
            open the URL — viewers can toggle <strong>Lyrics only</strong> vs
            <strong> Lyrics + chords</strong> and start auto-scroll on their end.
          </p>

          {error && (
            <div
              className="px-2 py-1.5 mb-2 rounded text-xs"
              style={{ background: 'color-mix(in srgb, #ef4444 14%, transparent)', color: '#fecaca' }}
            >
              {error}
            </div>
          )}

          {/* While the cast server is spinning up (auto-start on open),
              show a small spinner-style placeholder so the popover
              doesn't look broken. Once `serverInfo` arrives the QR
              block below renders in its place. */}
          {!serverInfo && !error && (
            <div
              className="flex items-center gap-2 px-2 py-3 mb-2 rounded text-xs"
              style={{ background: 'var(--surface-elevated)', color: 'var(--text-muted)' }}
            >
              <span className="inline-block animate-pulse">●</span>
              <span>Starting cast server…</span>
            </div>
          )}

          {/* QR + URL when running */}
          {serverInfo && url && (
            <div className="flex flex-col gap-2 pt-3 border-t" style={{ borderColor: 'var(--border)' }}>
              <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)', letterSpacing: '0.08em' }}>
                Open on the receiving device
              </span>
              <div className="flex items-start gap-3">
                {qrDataUrl && (
                  <div className="rounded-lg p-2 shrink-0" style={{ background: '#fff', border: '1px solid var(--border)' }}>
                    <img src={qrDataUrl} alt="QR code" width={120} height={120} />
                  </div>
                )}
                <div className="flex flex-col gap-1 min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 min-w-0">
                    {/* Clickable URL — Electron's renderer can't follow
                        an external <a href> directly, so we hand the
                        URL to the main process via shell.openExternal
                        which launches the user's default browser. */}
                    <button
                      onClick={() => {
                        if (!url) return;
                        void window.electronAPI.shell.openExternal(url);
                      }}
                      className="font-mono text-xs break-all min-w-0 flex-1 text-left hover:underline transition-colors"
                      style={{ color: 'var(--accent)', background: 'transparent', border: 0, padding: 0, cursor: 'pointer' }}
                      title="Open in default browser"
                    >
                      {url}
                    </button>
                    <button
                      onClick={() => {
                        if (!url) return;
                        void navigator.clipboard.writeText(url).then(() => {
                          setCopied(true);
                          window.setTimeout(() => setCopied(false), 1500);
                        });
                      }}
                      className="p-1.5 rounded shrink-0 hover:bg-[var(--surface-elevated)] transition-colors"
                      style={{ color: copied ? 'var(--accent)' : 'var(--text-muted)' }}
                      title={copied ? 'Copied!' : 'Copy URL'}
                      aria-label={copied ? 'Copied' : 'Copy URL'}
                    >
                      {copied ? <Check size={14} /> : <Copy size={14} />}
                    </button>
                  </div>
                  <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                    {clients > 0 ? `${clients} viewer${clients === 1 ? '' : 's'} connected` : 'Waiting for viewers…'}
                  </span>
                </div>
              </div>
              <button
                onClick={() => void stop()}
                disabled={busy}
                className="flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors mt-1"
                style={{
                  background: 'var(--surface-elevated)',
                  color: 'var(--text-secondary)',
                  opacity: busy ? 0.5 : 1,
                  cursor: busy ? 'wait' : 'pointer',
                }}
              >
                <Power size={12} /> Stop casting
              </button>
            </div>
          )}
        </div>
    ),
    document.body,
  );

  return (
    <>
      <button
        ref={buttonRef}
        onClick={() => setOpen((v) => !v)}
        className="p-2 rounded-lg hover:bg-[var(--surface-elevated)] transition-colors"
        title="Cast"
        style={{ color: serverInfo ? 'var(--accent)' : 'var(--text-secondary)' }}
      >
        <Cast size={16} fill={serverInfo ? 'currentColor' : 'none'} />
      </button>
      {popover}
    </>
  );
}

function ChoiceButton({
  icon,
  label,
  description,
  active,
  busy,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  description: string;
  active: boolean;
  busy: boolean;
  onClick: () => void;
}): React.ReactElement {
  return (
    <button
      onClick={onClick}
      disabled={busy}
      className="flex items-start gap-2 p-2.5 rounded-lg text-left transition-colors"
      style={{
        background: active ? 'color-mix(in srgb, var(--accent) 14%, transparent)' : 'var(--surface-elevated)',
        border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
        opacity: busy ? 0.6 : 1,
        cursor: busy ? 'wait' : 'pointer',
      }}
    >
      <span style={{ color: active ? 'var(--accent)' : 'var(--text-secondary)', marginTop: 2 }}>{icon}</span>
      <span className="flex flex-col min-w-0 flex-1">
        <span className="text-sm font-semibold" style={{ color: active ? 'var(--accent)' : 'var(--text-primary)' }}>
          {label}
        </span>
        <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
          {description}
        </span>
      </span>
    </button>
  );
}
