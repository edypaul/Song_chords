import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Play, Pause, ChevronDown } from 'lucide-react';
import { usePlayerStore } from '@song-chords/shared';

/**
 * Auto-scroll toolbar control. The play/stop button is the primary
 * affordance; when the song has no duration the speed slider lives
 * behind a small chevron next to it (portaled popover) so the slider
 * doesn't permanently take up horizontal room in the toolbar.
 *
 * The popover mirrors the cast page's `.speed-popover` pattern —
 * appears anchored to the chevron, closes on outside-click, click on
 * the slider doesn't close the popover.
 */
export default function AutoScrollControl(): React.ReactElement {
  const { autoScrollActive, toggleAutoScroll, autoScrollSpeed, setScrollSpeed, activeSong } = usePlayerStore();
  const hasDuration = Boolean(activeSong?.duration);

  const [speedOpen, setSpeedOpen] = useState(false);
  const chevronRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  // Position the popover above the chevron — toolbar sits near the top
  // of the screen so "below" would have plenty of room, but matching
  // the cast page's "above" placement keeps the visual pattern
  // consistent across surfaces.
  const [popoverPos, setPopoverPos] = useState<{ top: number; left: number } | null>(null);
  useLayoutEffect(() => {
    if (!speedOpen) return;
    const place = () => {
      const btn = chevronRef.current;
      if (!btn) return;
      const r = btn.getBoundingClientRect();
      setPopoverPos({ top: r.bottom + 6, left: r.left });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [speedOpen]);
  useEffect(() => {
    if (!speedOpen) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (popoverRef.current && popoverRef.current.contains(t)) return;
      if (chevronRef.current && chevronRef.current.contains(t)) return;
      setSpeedOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [speedOpen]);

  return (
    <div className="flex items-center gap-2 text-sm">
      <div
        className="flex items-stretch rounded-lg overflow-hidden"
        style={{ background: autoScrollActive ? 'var(--accent)' : 'var(--surface-elevated)' }}
      >
        <button
          onClick={toggleAutoScroll}
          className="flex items-center gap-1.5 px-3 py-1.5 transition-colors font-medium"
          style={{ color: autoScrollActive ? 'white' : 'var(--text-secondary)' }}
        >
          {autoScrollActive ? <Pause size={14} /> : <Play size={14} />}
          {autoScrollActive ? 'Stop' : 'Scroll'}
        </button>
        {!hasDuration && (
          <button
            ref={chevronRef}
            onClick={() => setSpeedOpen((v) => !v)}
            className="px-1.5 transition-colors flex items-center"
            style={{
              color: autoScrollActive ? 'white' : 'var(--text-muted)',
              borderLeft: `1px solid ${autoScrollActive ? 'rgba(255,255,255,0.25)' : 'var(--border)'}`,
            }}
            title="Auto-scroll speed"
            aria-label="Auto-scroll speed"
            aria-expanded={speedOpen}
          >
            <ChevronDown size={12} />
          </button>
        )}
      </div>

      {hasDuration && (
        <span
          className="text-xs px-2 py-1 rounded"
          style={{ background: 'var(--surface-elevated)', color: 'var(--text-muted)' }}
          title="Scroll speed calculated from song duration"
        >
          {activeSong!.duration}
        </span>
      )}

      {speedOpen && popoverPos && !hasDuration && createPortal(
        (
          <div
            ref={popoverRef}
            className="rounded-xl shadow-2xl"
            style={{
              position: 'fixed',
              top: popoverPos.top,
              left: popoverPos.left,
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              padding: '10px 12px',
              minWidth: 220,
              zIndex: 1100,
            }}
          >
            <span
              className="block text-[10px] font-semibold uppercase tracking-wider mb-1.5"
              style={{ color: 'var(--text-muted)', letterSpacing: '0.08em' }}
            >
              Speed
            </span>
            <div className="flex items-center gap-2">
              <span aria-hidden="true" style={{ color: 'var(--text-muted)', fontSize: '0.95em' }}>🐢</span>
              <input
                type="range"
                min={5}
                max={100}
                value={autoScrollSpeed}
                onChange={(e) => setScrollSpeed(Number(e.target.value))}
                className="flex-1 accent-[var(--accent)]"
                title={`Speed: ${autoScrollSpeed}`}
              />
              <span aria-hidden="true" style={{ color: 'var(--text-muted)', fontSize: '0.95em' }}>🐇</span>
            </div>
          </div>
        ),
        document.body,
      )}
    </div>
  );
}
