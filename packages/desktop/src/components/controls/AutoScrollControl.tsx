import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useSearchParams } from 'react-router-dom';
import { Play, Pause, ChevronDown } from 'lucide-react';
import { usePlayerStore, useSongStore, useSetListStore } from '@song-chords/shared';
import { db } from '../../ipc/ipc-client';

/**
 * Auto-scroll toolbar control. The play/stop button is the primary
 * affordance; a chevron next to it opens a portaled popover that lets the
 * user ALWAYS choose between the two pacing modes:
 *   - Duration: cover the song in exactly its `duration` (disabled when the
 *     song has no duration set).
 *   - Speed: pace by the manual speed slider.
 * The chosen mode is saved per-song. The slider is shown when Speed mode is
 * active; the duration is shown when Duration mode is active.
 *
 * The popover mirrors the cast page's `.speed-popover` pattern — anchored to
 * the chevron, closes on outside-click, clicks inside don't close it.
 */
export default function AutoScrollControl(): React.ReactElement {
  const { autoScrollActive, toggleAutoScroll, autoScrollSpeed, setScrollSpeed, autoScrollMode, setScrollMode, activeSong } = usePlayerStore();
  const savePreferences = useSongStore((s) => s.savePreferences);
  const hasDuration = Boolean(activeSong?.duration);

  // Detect whether we're viewing the song in a setlist-entry context:
  // when so, mode changes must route to the entry's per-entry override
  // instead of mutating the song's global preferences (which would
  // leak across every setlist that also includes this song). Same
  // detection the SongViewPage uses — reading the URL rather than
  // threading context through props keeps this control drop-in.
  const [searchParams] = useSearchParams();
  const entryId = searchParams.get('entry');
  const setlistEntry = useSetListStore((s) =>
    entryId ? s.activeSetList?.entries.find((e) => e.id === entryId) : undefined,
  );
  const updateSetListEntry = useSetListStore((s) => s.updateEntry);

  // Persist the picked mode. Where it lands depends on the context:
  //   • In a setlist entry — save to the entry so this list can
  //     pace differently from any other setlist containing the song.
  //   • Otherwise — save onto the song's global preferences.
  const pickMode = (mode: 'duration' | 'speed') => {
    setScrollMode(mode, (prefs) => {
      if (setlistEntry) {
        void updateSetListEntry(db, setlistEntry.id, { autoScrollMode: mode });
        return;
      }
      if (activeSong?.id) void savePreferences(db, activeSong.id, prefs);
    });
  };

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
        {/* Chevron is ALWAYS available now — it opens the mode chooser so
            the user can switch between Duration and Speed at any time. */}
        <button
          ref={chevronRef}
          onClick={() => setSpeedOpen((v) => !v)}
          className="px-1.5 transition-colors flex items-center"
          style={{
            color: autoScrollActive ? 'white' : 'var(--text-muted)',
            borderLeft: `1px solid ${autoScrollActive ? 'rgba(255,255,255,0.25)' : 'var(--border)'}`,
          }}
          title="Auto-scroll options"
          aria-label="Auto-scroll options"
          aria-expanded={speedOpen}
        >
          <ChevronDown size={12} />
        </button>
      </div>

      {/* Compact status next to the control: the duration (duration mode)
          or the speed value (speed mode). Fixed min-width + centered,
          tabular figures so switching modes (e.g. "5:01" ↔ "40%") doesn't
          change its width and shift the surrounding toolbar controls. */}
      <span
        className="text-xs px-2 py-1 rounded text-center"
        style={{
          background: 'var(--surface-elevated)',
          color: 'var(--text-muted)',
          minWidth: 48,
          fontVariantNumeric: 'tabular-nums',
        }}
        title={autoScrollMode === 'duration' ? 'Scroll speed from song duration' : 'Manual scroll speed'}
      >
        {autoScrollMode === 'duration' && hasDuration ? activeSong!.duration : `${autoScrollSpeed}%`}
      </span>

      {speedOpen && popoverPos && createPortal(
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
              // FIXED width (not minWidth): the Duration hint text is wider
              // than the Speed slider row, so a min-width box would resize
              // when toggling modes and make the popover jump. A fixed width
              // keeps it stable; the hint wraps within it.
              width: 260,
              boxSizing: 'border-box',
              zIndex: 1100,
            }}
          >
            {/* Mode chooser — always available. */}
            <span
              className="block text-[10px] font-semibold uppercase tracking-wider mb-1.5"
              style={{ color: 'var(--text-muted)', letterSpacing: '0.08em' }}
            >
              Auto-scroll mode
            </span>
            <div className="flex rounded-lg overflow-hidden mb-3" style={{ border: '1px solid var(--border)' }}>
              <button
                onClick={() => pickMode('duration')}
                disabled={!hasDuration}
                className="flex-1 px-2 py-1.5 text-xs font-medium transition-colors"
                style={{
                  background: autoScrollMode === 'duration' ? 'var(--accent)' : 'transparent',
                  color: autoScrollMode === 'duration' ? 'white' : 'var(--text-secondary)',
                  opacity: hasDuration ? 1 : 0.4,
                  cursor: hasDuration ? 'pointer' : 'not-allowed',
                  borderRight: '1px solid var(--border)',
                }}
                title={hasDuration ? 'Pace by the song duration' : 'Set a song duration to use this mode'}
              >
                Duration
              </button>
              <button
                onClick={() => pickMode('speed')}
                className="flex-1 px-2 py-1.5 text-xs font-medium transition-colors"
                style={{
                  background: autoScrollMode === 'speed' ? 'var(--accent)' : 'transparent',
                  color: autoScrollMode === 'speed' ? 'white' : 'var(--text-secondary)',
                }}
                title="Pace by the manual speed slider"
              >
                Speed
              </button>
            </div>

            {/* Fixed min-height so toggling between the slider (Speed) and the
                one-line hint (Duration) doesn't resize the popover and make it
                jump. Content is vertically centred within the reserved space. */}
            <div className="flex flex-col justify-center" style={{ minHeight: 48 }}>
              {autoScrollMode === 'duration' ? (
                <span className="block text-xs" style={{ color: 'var(--text-muted)' }}>
                  {hasDuration
                    ? `Covers the song in ${activeSong!.duration} (from the song's duration).`
                    : 'This song has no duration set, so Speed mode is used.'}
                </span>
              ) : (
                <>
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
                </>
              )}
            </div>
          </div>
        ),
        document.body,
      )}
    </div>
  );
}
