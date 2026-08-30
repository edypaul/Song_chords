import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Timer, ChevronDown } from 'lucide-react';
import { useShortcutHint } from '../../hooks/useShortcutHint';
import { useT } from '../../i18n';

/**
 * Metronome cluster: the BPM-button (toggles play/stop) sits next to a
 * chevron that opens a small popover with the three time-feel presets
 * (½×, 1×, 2×). Keeping the multiplier presets behind a chevron
 * tightens the toolbar dramatically. The active-beat indicator (row of
 * dots) renders to the right of the cluster while the metronome is
 * playing.
 *
 * Shared between SongViewPage and PerformPage so both surfaces have
 * the same compact metronome UX. The popover is portaled to <body>
 * because both host toolbars use `overflow: hidden`, which would
 * otherwise clip the dropdown.
 */
export default function MetronomeControl({
  tempo,
  timeSig,
  isPlaying,
  currentBeat,
  beatsPerMeasure,
  tempoMultiplier,
  onToggle,
  onMultiplierChange,
  disabled,
}: {
  tempo: number;
  timeSig?: string | null;
  isPlaying: boolean;
  currentBeat: number;
  beatsPerMeasure: number;
  tempoMultiplier: 0.5 | 1 | 2;
  onToggle: () => void;
  onMultiplierChange: (m: 0.5 | 1 | 2) => void;
  /** True when the song has no tempo — the cluster stays visible (so
   *  the toolbar layout is stable across songs) but is greyed out and
   *  inert, with a tooltip explaining why. */
  disabled?: boolean;
}): React.ReactElement {
  const hint = useShortcutHint();
  const t = useT();
  const [open, setOpen] = useState(false);
  const chevronRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [popoverPos, setPopoverPos] = useState<{ top: number; left: number } | null>(null);
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const btn = chevronRef.current;
      if (!btn) return;
      const r = btn.getBoundingClientRect();
      setPopoverPos({ top: r.bottom + 4, left: r.left });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (popoverRef.current && popoverRef.current.contains(t)) return;
      if (chevronRef.current && chevronRef.current.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const effectiveBpm = Math.round(tempo * tempoMultiplier);
  const multiplierLabel = (m: 0.5 | 1 | 2): string => (m === 0.5 ? t('metronome.halfTime') : m === 2 ? t('metronome.doubleTime') : t('metronome.normalTempo'));
  const multiplierGlyph = (m: 0.5 | 1 | 2): string => (m === 0.5 ? '½×' : m === 2 ? '2×' : '1×');

  return (
    <div className="flex items-center" style={disabled ? { opacity: 0.45 } : undefined}>
      <div className="flex items-center rounded overflow-hidden" style={{ background: isPlaying ? 'var(--accent)' : 'var(--surface-elevated)' }}>
        <button
          onClick={disabled ? undefined : onToggle}
          disabled={disabled}
          className="flex items-center gap-1.5 px-2 py-1.5 text-xs transition-colors"
          style={{ color: isPlaying ? 'white' : 'var(--text-secondary)', cursor: disabled ? 'not-allowed' : undefined }}
          title={disabled
            ? t('metronome.noTempo')
            : `${t('metronome.tooltip', { bpm: effectiveBpm, timeSig: timeSig ?? '4/4' })}${hint('toggleMetronome')}`}
        >
          <Timer size={13} />
          <span>{disabled ? '—' : effectiveBpm}</span>
        </button>
        <button
          ref={chevronRef}
          onClick={disabled ? undefined : () => setOpen((v) => !v)}
          disabled={disabled}
          className="px-1 py-1.5 transition-colors hover:opacity-80 flex items-center"
          style={{
            color: isPlaying ? 'white' : 'var(--text-muted)',
            borderLeft: `1px solid ${isPlaying ? 'rgba(255,255,255,0.25)' : 'var(--border)'}`,
            cursor: disabled ? 'not-allowed' : undefined,
          }}
          title={disabled ? t('metronome.noTempo') : t('metronome.timeFeel')}
          aria-label={t('metronome.timeFeel')}
          aria-expanded={open}
        >
          <ChevronDown size={12} />
          {tempoMultiplier !== 1 && (
            <span className="ml-1 text-[10px] font-mono">{multiplierGlyph(tempoMultiplier)}</span>
          )}
        </button>
      </div>
      {open && popoverPos && createPortal(
        (
          <div
            ref={popoverRef}
            className="rounded-md shadow-lg py-1"
            style={{
              position: 'fixed',
              top: popoverPos.top,
              left: popoverPos.left,
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              minWidth: 160,
              zIndex: 1000,
            }}
          >
            {([0.5, 1, 2] as const).map((m) => {
              const active = tempoMultiplier === m;
              return (
                <button
                  key={m}
                  onClick={() => { onMultiplierChange(m); setOpen(false); }}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-[var(--surface-elevated)] transition-colors text-left"
                  style={{ color: active ? 'var(--accent)' : 'var(--text-primary)' }}
                >
                  <span className="font-mono w-7" style={{ color: active ? 'var(--accent)' : 'var(--text-muted)' }}>{multiplierGlyph(m)}</span>
                  <span className="flex-1">{multiplierLabel(m)}</span>
                </button>
              );
            })}
          </div>
        ),
        document.body,
      )}
      {isPlaying && (
        <div className="flex items-center gap-1 ml-2">
          {Array.from({ length: beatsPerMeasure }, (_, i) => (
            <div
              key={i}
              style={{
                width: 7,
                height: 7,
                borderRadius: '50%',
                background: i === currentBeat ? (i === 0 ? 'var(--accent)' : 'var(--chord-color)') : 'var(--border)',
                transition: 'background 0.05s',
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
