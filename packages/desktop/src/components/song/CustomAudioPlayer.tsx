import React, { useEffect, useRef, useState } from 'react';
import { Play, Pause, SkipBack, SkipForward, Volume2, VolumeX } from 'lucide-react';

interface Props {
  /** Source URL — `song-audio://...` for local files, or any directly
   *  playable audio URL. */
  src: string;
  /** Called when the underlying audio element fails to load (file
   *  missing, codec unsupported, etc.). */
  onError?: () => void;
  /** Auto-start playback when the player mounts. */
  autoPlay?: boolean;
}

/**
 * Custom audio player UI built on top of an HTMLAudioElement.
 *
 * Compared to the bare `<audio controls>` browser default this gives:
 *   - Big centered play/pause button so it's easy to read at a glance
 *   - Skip ±10s buttons (handy for finding a part of a song to learn)
 *   - Click-or-drag seek bar with hover preview
 *   - Time-elapsed / total-duration readout
 *   - Volume slider + mute toggle that persist across re-mounts
 *
 * Renders nothing itself for the audio (no `<audio>` `controls` attr) —
 * we drive an invisible audio element and reflect its state through
 * React-controlled UI.
 */
export default function CustomAudioPlayer({ src, onError, autoPlay }: Props): React.ReactElement {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [time, setTime] = useState(0);
  const [volume, setVolume] = useState(() => {
    const saved = typeof window !== 'undefined' ? window.localStorage.getItem('audioPlayer.volume') : null;
    const n = saved == null ? NaN : parseFloat(saved);
    return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0.85;
  });
  const [muted, setMuted] = useState(false);
  // Drag-scrubbing the seek bar. While `seeking` is true we don't let
  // `timeupdate` events overwrite the local seek position.
  const [seeking, setSeeking] = useState(false);
  const [seekPreview, setSeekPreview] = useState(0);

  // Push volume / muted state to the underlying audio element.
  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    a.volume = muted ? 0 : volume;
    window.localStorage.setItem('audioPlayer.volume', String(volume));
  }, [volume, muted]);

  // Wire native audio events to React state.
  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onTime = () => { if (!seeking) setTime(a.currentTime); };
    const onLoaded = () => setDuration(Number.isFinite(a.duration) ? a.duration : 0);
    const onEnded = () => setPlaying(false);
    const onErr = () => { setPlaying(false); onError?.(); };
    a.addEventListener('play', onPlay);
    a.addEventListener('pause', onPause);
    a.addEventListener('timeupdate', onTime);
    a.addEventListener('loadedmetadata', onLoaded);
    a.addEventListener('durationchange', onLoaded);
    a.addEventListener('ended', onEnded);
    a.addEventListener('error', onErr);
    return () => {
      a.removeEventListener('play', onPlay);
      a.removeEventListener('pause', onPause);
      a.removeEventListener('timeupdate', onTime);
      a.removeEventListener('loadedmetadata', onLoaded);
      a.removeEventListener('durationchange', onLoaded);
      a.removeEventListener('ended', onEnded);
      a.removeEventListener('error', onErr);
    };
  }, [seeking, onError]);

  // Auto-play when src changes (covers swapping songs while the panel
  // stays open).
  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    setTime(0);
    if (autoPlay) {
      // Some browsers require user interaction before play() resolves;
      // catch and ignore — the user can still hit the big play button.
      a.play().catch(() => { /* ignore */ });
    }
  }, [src, autoPlay]);

  const togglePlay = () => {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) a.play().catch(() => { /* ignore */ });
    else a.pause();
  };

  const skip = (seconds: number) => {
    const a = audioRef.current;
    if (!a) return;
    a.currentTime = Math.max(0, Math.min(duration || a.duration || 0, a.currentTime + seconds));
  };

  // Translate an x-coordinate inside the seek bar into a time value.
  const timeFromBarEvent = (e: React.PointerEvent<HTMLDivElement>, el: HTMLDivElement): number => {
    const rect = el.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    return ratio * (duration || 0);
  };

  const onBarPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    setSeeking(true);
    const t = timeFromBarEvent(e, e.currentTarget);
    setSeekPreview(t);
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* ignore */ }
  };
  const onBarPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!seeking) return;
    setSeekPreview(timeFromBarEvent(e, e.currentTarget));
  };
  const onBarPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!seeking) return;
    const a = audioRef.current;
    const t = timeFromBarEvent(e, e.currentTarget);
    if (a) a.currentTime = t;
    setTime(t);
    setSeeking(false);
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
  };

  const displayedTime = seeking ? seekPreview : time;
  const progress = duration > 0 ? Math.max(0, Math.min(1, displayedTime / duration)) : 0;

  return (
    <div className="w-full flex flex-col items-stretch gap-3 px-5 py-4">
      {/* Hidden audio element — UI drives it via the ref. */}
      <audio ref={audioRef} src={src} preload="metadata" />

      {/* Seek bar + time readout */}
      <div className="flex items-center gap-3">
        <span className="text-[11px] font-mono tabular-nums" style={{ color: 'var(--text-muted)', minWidth: 38, textAlign: 'right' }}>
          {formatTime(displayedTime)}
        </span>
        <div
          className="flex-1 relative"
          style={{ touchAction: 'none', cursor: duration > 0 ? 'pointer' : 'default' }}
          onPointerDown={duration > 0 ? onBarPointerDown : undefined}
          onPointerMove={duration > 0 ? onBarPointerMove : undefined}
          onPointerUp={duration > 0 ? onBarPointerUp : undefined}
          onPointerCancel={duration > 0 ? onBarPointerUp : undefined}
          role="slider"
          aria-valuemin={0}
          aria-valuemax={duration}
          aria-valuenow={displayedTime}
          aria-label="Seek"
        >
          <div style={{ height: 4, borderRadius: 2, background: 'var(--surface-elevated)' }}>
            <div
              style={{
                height: '100%',
                width: `${progress * 100}%`,
                borderRadius: 2,
                background: 'var(--accent)',
                transition: seeking ? 'none' : 'width 0.1s linear',
              }}
            />
          </div>
          {/* Knob */}
          <div
            style={{
              position: 'absolute',
              top: '50%',
              left: `${progress * 100}%`,
              transform: 'translate(-50%, -50%)',
              width: 12,
              height: 12,
              borderRadius: '50%',
              background: 'var(--accent)',
              boxShadow: '0 0 0 3px color-mix(in srgb, var(--accent) 30%, transparent)',
              opacity: duration > 0 ? 1 : 0.4,
            }}
          />
        </div>
        <span className="text-[11px] font-mono tabular-nums" style={{ color: 'var(--text-muted)', minWidth: 38 }}>
          {formatTime(duration)}
        </span>
      </div>

      {/* Transport row */}
      <div className="flex items-center gap-2">
        {/* Volume cluster (left) */}
        <button
          onClick={() => setMuted((m) => !m)}
          className="p-1.5 rounded-md hover:bg-[var(--surface-elevated)]"
          style={{ color: 'var(--text-secondary)' }}
          title={muted ? 'Unmute' : 'Mute'}
          aria-label={muted ? 'Unmute' : 'Mute'}
        >
          {muted ? <VolumeX size={14} /> : <Volume2 size={14} />}
        </button>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={muted ? 0 : volume}
          onChange={(e) => {
            const v = parseFloat(e.target.value);
            setVolume(v);
            if (v > 0 && muted) setMuted(false);
          }}
          aria-label="Volume"
          style={{ width: 70, accentColor: 'var(--accent)' }}
        />

        <div className="flex-1" />

        {/* Transport controls (centered group) */}
        <button
          onClick={() => skip(-10)}
          className="p-1.5 rounded-md hover:bg-[var(--surface-elevated)]"
          style={{ color: 'var(--text-secondary)' }}
          title="Back 10 seconds"
          aria-label="Back 10 seconds"
        >
          <SkipBack size={16} />
        </button>
        <button
          onClick={togglePlay}
          className="p-2 rounded-full transition-colors"
          style={{
            background: 'var(--accent)',
            color: 'white',
            width: 44,
            height: 44,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          title={playing ? 'Pause' : 'Play'}
          aria-label={playing ? 'Pause' : 'Play'}
        >
          {playing ? <Pause size={20} fill="currentColor" strokeWidth={0} /> : <Play size={20} fill="currentColor" strokeWidth={0} style={{ marginLeft: 2 }} />}
        </button>
        <button
          onClick={() => skip(10)}
          className="p-1.5 rounded-md hover:bg-[var(--surface-elevated)]"
          style={{ color: 'var(--text-secondary)' }}
          title="Forward 10 seconds"
          aria-label="Forward 10 seconds"
        >
          <SkipForward size={16} />
        </button>

        <div className="flex-1" />
        {/* Right spacer keeps the play button visually centered between
            the volume cluster on the left and an empty slot of the
            same width on the right. */}
        <div style={{ width: 88 }} />
      </div>
    </div>
  );
}

function formatTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '0:00';
  const total = Math.floor(sec);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}
