import React from 'react';
import { Music2 } from 'lucide-react';

// On Windows the OS native titlebar is used (with minimize/maximize/close).
// On macOS we render a custom draggable bar that sits alongside the traffic lights.
const isMac = navigator.userAgent.includes('Macintosh');

export default function TitleBar(): React.ReactElement | null {
  if (!isMac) return null;

  return (
    <div
      className="flex items-center h-10 px-4 gap-2 border-b select-none shrink-0"
      style={{
        background: 'var(--bg-secondary)',
        borderColor: 'var(--border)',
        // Enables window dragging from this bar (macOS)
        WebkitAppRegion: 'drag',
      } as React.CSSProperties}
    >
      {/* Spacer for macOS traffic lights (≈70px) */}
      <div style={{ width: 70 }} />
      <Music2 size={14} style={{ color: 'var(--accent)' }} />
      <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
        Song Chords
      </span>
    </div>
  );
}
