import React from 'react';
import { Play, Pause } from 'lucide-react';
import { usePlayerStore } from '@song-chords/shared';

export default function AutoScrollControl(): React.ReactElement {
  const { autoScrollActive, toggleAutoScroll, autoScrollSpeed, setScrollSpeed, activeSong } = usePlayerStore();
  const hasDuration = Boolean(activeSong?.duration);

  return (
    <div className="flex items-center gap-2 text-sm">
      <button
        onClick={toggleAutoScroll}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-colors font-medium"
        style={{
          background: autoScrollActive ? 'var(--accent)' : 'var(--surface-elevated)',
          color: autoScrollActive ? 'white' : 'var(--text-secondary)',
        }}
      >
        {autoScrollActive ? <Pause size={14} /> : <Play size={14} />}
        {autoScrollActive ? 'Stop' : 'Scroll'}
      </button>

      {hasDuration ? (
        <span
          className="text-xs px-2 py-1 rounded"
          style={{ background: 'var(--surface-elevated)', color: 'var(--text-muted)' }}
          title="Scroll speed calculated from song duration"
        >
          {activeSong!.duration}
        </span>
      ) : (
        <input
          type="range"
          min={5}
          max={100}
          value={autoScrollSpeed}
          onChange={(e) => setScrollSpeed(Number(e.target.value))}
          className="w-24 accent-[var(--accent)]"
          title={`Speed: ${autoScrollSpeed}`}
        />
      )}
    </div>
  );
}
