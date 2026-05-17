import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Play, Pause, SkipBack, SkipForward, Volume2, VolumeX } from 'lucide-react';

/** Imperative handle the parent panel can use to control playback
 *  (e.g. pause when the user hands the file off to an external app). */
export interface CustomAudioPlayerHandle {
  pause: () => void;
}

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
function CustomAudioPlayer(
  { src, onError, autoPlay }: Props,
  ref: React.Ref<CustomAudioPlayerHandle>,
): React.ReactElement {
  const audioRef = useRef<HTMLAudioElement>(null);

  // Let the parent pause us without reaching into the audio element.
  useImperativeHandle(ref, () => ({
    pause: () => { audioRef.current?.pause(); },
  }), []);
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
  // `timeupdate` events overwrite the local seek position. A ref
  // mirrors it so the audio-event effect can read the latest value
  // WITHOUT `seeking` being in its dep array (re-binding all audio
  // listeners on every scrub toggle was what reset the
  // duration-resolved guard and re-triggered the seek-to-end hack
  // mid-playback, freezing the slider after the first seek).
  const [seeking, setSeeking] = useState(false);
  const seekingRef = useRef(false);
  useEffect(() => { seekingRef.current = seeking; }, [seeking]);
  // Pointer position during a drag, as a pure 0..1 ratio of the bar
  // width (NOT seconds — keeping it unit-less is what makes the drag
  // immune to the audio element's duration going NaN mid-scrub).
  const [seekRatio, setSeekRatio] = useState(0);

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
    // The song-audio:// protocol now serves a correct Content-Length
    // and proper 206/Content-Range responses, so the media element
    // gets a real finite duration straight from metadata. The old
    // "seek to 1e9 to force the engine to compute Infinity duration"
    // workaround is no longer needed — and it was the cause of the
    // recurring seek freezes: that giant seek (and its restore-the-
    // playhead listener) collided with user seeks and re-fired when
    // the element re-buffered near the song start, leaving
    // `currentTime` writes silently ignored. We just read whatever
    // finite duration the element reports.
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onTime = () => { if (!seekingRef.current) setTime(a.currentTime); };
    const applyDuration = () => {
      const d = a.duration;
      if (Number.isFinite(d) && d > 0) setDuration(d);
    };
    const onLoaded = () => applyDuration();
    const onEnded = () => setPlaying(false);
    const onErr = () => { setPlaying(false); onError?.(); };
    a.addEventListener('play', onPlay);
    a.addEventListener('pause', onPause);
    a.addEventListener('timeupdate', onTime);
    a.addEventListener('loadedmetadata', onLoaded);
    a.addEventListener('durationchange', onLoaded);
    a.addEventListener('canplay', onLoaded);
    a.addEventListener('ended', onEnded);
    a.addEventListener('error', onErr);
    return () => {
      a.removeEventListener('play', onPlay);
      a.removeEventListener('pause', onPause);
      a.removeEventListener('timeupdate', onTime);
      a.removeEventListener('loadedmetadata', onLoaded);
      a.removeEventListener('durationchange', onLoaded);
      a.removeEventListener('canplay', onLoaded);
      a.removeEventListener('ended', onEnded);
      a.removeEventListener('error', onErr);
    };
    // Bind audio listeners ONCE (not per scrub). `seeking` is read via
    // seekingRef so it doesn't need to be a dependency.
  }, [onError]);

  // Auto-play when src changes (covers swapping songs while the panel
  // stays open).
  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    setTime(0);
    setDuration(0);
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
    // Use the audio element's LIVE values, not the React `duration`
    // state (which can still be 0 while metadata resolves). Lower-
    // clamp at 0 always; upper-clamp only when we actually have a
    // finite length — otherwise forward-skip was pinned to 0 and
    // back-skip jammed.
    const len = Number.isFinite(a.duration) && a.duration > 0
      ? a.duration
      : (duration > 0 ? duration : null);
    let next = a.currentTime + seconds;
    if (next < 0) next = 0;
    if (len !== null && next > len) next = len;
    seekTo(next);
  };

  // The effective track length: prefer the resolved React state, fall
  // back to the audio element's live duration so seeking works even
  // in the brief window before `duration` state catches up.
  const effectiveDuration = (): number => {
    if (duration > 0) return duration;
    const a = audioRef.current;
    if (a && Number.isFinite(a.duration) && a.duration > 0) return a.duration;
    if (a && a.seekable && a.seekable.length > 0) {
      const end = a.seekable.end(a.seekable.length - 1);
      if (Number.isFinite(end) && end > 0) return end;
    }
    return 0;
  };

  // Reliably move the playhead. A bare `a.currentTime = t` is silently
  // clamped (often to 0) when the element doesn't yet consider `t`
  // seekable — which is precisely a BACKWARD seek into a region whose
  // 206 range is still being (re)fetched. We write it, then if the
  // element clamped it away we re-assert once on the next `seeked` /
  // `canplay` (when the range has arrived and the write will stick).
  const seekTo = (t: number) => {
    const a = audioRef.current;
    if (!a) return;
    const target = Math.max(0, t);
    try { a.currentTime = target; } catch { /* ignore */ }
    setTime(target);
    if (Math.abs(a.currentTime - target) < 0.5) return; // took immediately
    let tries = 0;
    const reassert = () => {
      tries += 1;
      try { a.currentTime = target; } catch { /* ignore */ }
      if (Math.abs(a.currentTime - target) < 0.5 || tries >= 3) {
        a.removeEventListener('seeked', reassert);
        a.removeEventListener('canplay', reassert);
        a.removeEventListener('loadeddata', reassert);
      }
    };
    a.addEventListener('seeked', reassert);
    a.addEventListener('canplay', reassert);
    a.addEventListener('loadeddata', reassert);
  };

  // === Seek bar: PURE-UI drag, fully decoupled from the audio state ===
  //
  // Hard rule (user requirement): the slider drag must NEVER be
  // blocked, no matter what the <audio> element is doing. Every prior
  // bug came from coupling the drag to the audio: gating pointerdown on
  // a known duration, computing the drag position in *seconds* (which
  // collapses to 0 when duration briefly goes NaN after a backward
  // seek), or unbinding handlers when `seekable` hit 0.
  //
  // So the drag now works on a pure 0..1 RATIO derived only from the
  // pointer x within the bar — it touches the audio at exactly ONE
  // moment: pointer-up, to convert the final ratio into seconds and
  // apply it. Nothing about the audio can prevent starting, tracking,
  // or finishing a drag.
  // CAPTURE-FREE drag. We do NOT call setPointerCapture on the bar.
  // The bar is a 4px-tall sliver nested inside the panel, whose HEADER
  // also setPointerCapture's for window-dragging. Two nested capturing
  // elements + a tiny hit target made Chromium contest the capture and
  // fire `pointercancel` after a few px — that's the "not-allowed
  // cursor, only moves a couple seconds, then frozen" symptom.
  //
  // Instead: pointerdown starts the drag and attaches move/up listeners
  // to `window`. Window-level listeners receive the pointer no matter
  // where it goes or what re-renders, with zero capture contention.
  const barElRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef(false);
  const dragRatioRef = useRef(0);

  const ratioFromClientX = (clientX: number): number => {
    const el = barElRef.current;
    if (!el) return dragRatioRef.current;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0) return dragRatioRef.current;
    return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  };

  // STABLE listener identities (defined once via refs) so the matching
  // removeEventListener actually removes them — recreating these every
  // render would leak listeners and double-fire seeks.
  const moveListenerRef = useRef<(ev: PointerEvent) => void>(() => {});
  const upListenerRef = useRef<() => void>(() => {});

  const detachWindowListeners = () => {
    window.removeEventListener('pointermove', moveListenerRef.current);
    window.removeEventListener('pointerup', upListenerRef.current);
    window.removeEventListener('pointercancel', upListenerRef.current);
  };

  moveListenerRef.current = (ev: PointerEvent) => {
    if (!dragRef.current) return;
    const r = ratioFromClientX(ev.clientX);
    dragRatioRef.current = r;
    setSeekRatio(r);
  };
  upListenerRef.current = () => {
    if (!dragRef.current) return;
    dragRef.current = false;
    detachWindowListeners();
    setSeeking(false);
    // Resolve length ONLY now, to map ratio -> seconds. If it's still
    // unknown we simply don't move the audio — but the UI already
    // followed the pointer and the drag was never blocked.
    const len = effectiveDuration();
    if (len > 0) {
      seekTo(Math.max(0, Math.min(len, dragRatioRef.current * len)));
    }
  };

  // Safety net: if the component unmounts mid-drag, drop the listeners.
  useEffect(() => detachWindowListeners, []);

  const onBarPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    // No audio checks, no pointer capture — a drag ALWAYS starts.
    const r = ratioFromClientX(e.clientX);
    dragRef.current = true;
    dragRatioRef.current = r;
    setSeeking(true);
    setSeekRatio(r);
    window.addEventListener('pointermove', moveListenerRef.current);
    window.addEventListener('pointerup', upListenerRef.current);
    window.addEventListener('pointercancel', upListenerRef.current);
  };

  const seekable = effectiveDuration();
  // Progress while dragging follows the pure pointer ratio; otherwise
  // it tracks playback time against whatever length we know.
  const progress = seeking
    ? seekRatio
    : (seekable > 0 ? Math.max(0, Math.min(1, time / seekable)) : 0);
  const displayedTime = seeking
    ? (seekable > 0 ? seekRatio * seekable : 0)
    : time;

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
          ref={barElRef}
          className="flex-1 relative"
          /* Generous vertical hit-padding: the visible track is only
             4px, far too small to reliably press. The negative margin
             keeps the row layout unchanged while giving the pointer a
             ~20px tall target. */
          style={{ touchAction: 'none', cursor: 'pointer', paddingTop: 8, paddingBottom: 8, marginTop: -8, marginBottom: -8 }}
          /* ONLY onPointerDown is bound here. The drag tracks via
             window-level pointermove/up listeners (see the seek-bar
             block above) — capture-free, so the nested panel-header
             pointer-capture can't contest it, and audio state can
             never block or freeze the slider. */
          onPointerDown={onBarPointerDown}
          role="slider"
          aria-valuemin={0}
          aria-valuemax={seekable}
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

export default forwardRef(CustomAudioPlayer);

function formatTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '0:00';
  const total = Math.floor(sec);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}
