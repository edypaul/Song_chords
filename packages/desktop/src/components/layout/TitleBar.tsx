import React, { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Music2, Minus, Square, Copy, X } from 'lucide-react';

const isMac = navigator.userAgent.includes('Macintosh');

/**
 * Map the current pathname to a human-friendly page title shown in the
 * center of the title bar. Falls back to the hash for unknown routes.
 */
function pageTitleFor(pathname: string): string {
  if (pathname === '/' || pathname.startsWith('/library')) return 'Library';
  if (pathname.startsWith('/dashboard')) return 'Dashboard';
  if (pathname.startsWith('/setlists')) return 'Set Lists';
  if (pathname.startsWith('/categories')) return 'Categories';
  if (pathname.startsWith('/favorites')) return 'Favorites';
  if (pathname.startsWith('/chords')) return 'Chord Library';
  if (pathname.startsWith('/import')) return 'Import';
  if (pathname.startsWith('/cast')) return 'Cast';
  if (pathname.startsWith('/settings')) return 'Settings';
  if (pathname.startsWith('/song/new')) return 'New Song';
  if (pathname.match(/^\/song\/[^/]+\/edit/)) return 'Edit Song';
  if (pathname.startsWith('/song/')) return 'Song View';
  return '';
}

/**
 * Custom title bar replacing the OS-native frame on Windows / Linux.
 *
 *  - Mac keeps its native traffic-light buttons; we render only the
 *    branding strip alongside them.
 *  - Windows / Linux are fully frameless — this bar draws its own
 *    minimize / maximize / close controls and the entire empty area is
 *    a draggable region (CSS `WebkitAppRegion: 'drag'`). Buttons opt
 *    out of dragging via `WebkitAppRegion: 'no-drag'`.
 *
 *  All actions go through `window.electronAPI.window` (preload-exposed
 *  IPC). The maximize icon swaps to a "restore" glyph when the window
 *  is maximized; the main process pushes state changes via
 *  `onMaxStateChange`.
 */
export default function TitleBar(): React.ReactElement {
  const { pathname } = useLocation();
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (isMac) return;
    let unsub: (() => void) | undefined;
    void window.electronAPI.window.isMaximized().then(setMaximized);
    unsub = window.electronAPI.window.onMaxStateChange(setMaximized);
    return () => { if (unsub) unsub(); };
  }, []);

  const handleMinimize = () => void window.electronAPI.window.minimize();
  const handleMaximize = () => void window.electronAPI.window.toggleMaximize();
  const handleClose = () => void window.electronAPI.window.close();

  // Double-click anywhere in the drag region toggles maximize — matches
  // the standard Windows/Linux convention.
  const handleDoubleClick = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('[data-no-drag]')) return;
    handleMaximize();
  };

  const dragStyle = { WebkitAppRegion: 'drag' } as React.CSSProperties;
  const noDragStyle = { WebkitAppRegion: 'no-drag' } as React.CSSProperties;

  const title = pageTitleFor(pathname);

  return (
    <div
      className="flex items-center h-8 select-none shrink-0 border-b relative"
      style={{
        background: 'var(--bg-secondary)',
        borderColor: 'var(--border)',
        ...dragStyle,
      }}
      onDoubleClick={handleDoubleClick}
    >
      {/* Mac: leave room for traffic lights */}
      {isMac && <div style={{ width: 70 }} />}

      {/* Left: logo + app name */}
      <div className="flex items-center gap-1.5 px-3" style={isMac ? undefined : dragStyle}>
        <Music2 size={13} style={{ color: 'var(--accent)' }} />
        <span className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>
          Song Chords
        </span>
      </div>

      {/* Center: current page title. Absolutely positioned so it stays
         centered regardless of the variable widths on either side. */}
      {title && (
        <div
          className="absolute left-1/2 -translate-x-1/2 text-xs font-medium pointer-events-none"
          style={{ color: 'var(--text-secondary)', top: 6 }}
        >
          {title}
        </div>
      )}

      {/* Right-side spacer fills the drag area */}
      <div className="flex-1" />

      {/* Right: window controls (Windows / Linux only) */}
      {!isMac && (
        <div className="flex items-stretch h-full" style={noDragStyle} data-no-drag>
          <TitleBarButton
            onClick={handleMinimize}
            ariaLabel="Minimize"
            hoverBg="var(--surface-elevated)"
          >
            <Minus size={13} />
          </TitleBarButton>
          <TitleBarButton
            onClick={handleMaximize}
            ariaLabel={maximized ? 'Restore' : 'Maximize'}
            hoverBg="var(--surface-elevated)"
          >
            {maximized ? <Copy size={11} /> : <Square size={11} />}
          </TitleBarButton>
          <TitleBarButton
            onClick={handleClose}
            ariaLabel="Close"
            hoverBg="#e81123"
            hoverFg="#ffffff"
          >
            <X size={14} />
          </TitleBarButton>
        </div>
      )}
    </div>
  );
}

/**
 * A single window-control button. Wider than tall (~46px × 32px) to
 * mirror the Windows native control aspect, with a hover-colored
 * background. The close button uses a red hover by passing `hoverBg`.
 */
function TitleBarButton({
  children,
  onClick,
  ariaLabel,
  hoverBg,
  hoverFg,
}: {
  children: React.ReactNode;
  onClick: () => void;
  ariaLabel: string;
  hoverBg: string;
  hoverFg?: string;
}): React.ReactElement {
  const [hover, setHover] = useState(false);
  return (
    <button
      onClick={onClick}
      aria-label={ariaLabel}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className="flex items-center justify-center transition-colors"
      style={{
        width: 46,
        height: '100%',
        background: hover ? hoverBg : 'transparent',
        color: hover && hoverFg ? hoverFg : 'var(--text-secondary)',
        border: 'none',
        cursor: 'pointer',
      }}
    >
      {children}
    </button>
  );
}
