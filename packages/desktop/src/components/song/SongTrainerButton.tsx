import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { GraduationCap, Shuffle } from 'lucide-react';
import {
  TRAINER_MAX,
  TRAINER_MIN,
  TRAINER_STEP,
  useSongTrainerStore,
} from '../../store/song-trainer-store';
import { useShortcutHint } from '../../hooks/useShortcutHint';
import { useT } from '../../i18n';

interface Props {
  /** When false, the button is rendered disabled with a tooltip
   *  explaining why. Trainer is only meaningful on the default
   *  chords-over-lyrics view — see the caller for the eligibility
   *  rule (`viewMode === 'chords' && !inlineDiagrams`). */
  eligible: boolean;
  /** Human-readable reason shown as the tooltip when disabled. */
  ineligibleReason?: string;
}

/**
 * Toolbar entry for the Song Trainer feature. Icon toggles the trainer
 * on/off; chevron dropdown carries a percentage slider (10 % → 100 %,
 * step 5 %) that controls how many chord-name occurrences get hidden
 * behind a `?`. Clicking the `?` in the song body reveals that
 * occurrence — reveal logic lives in `ChordLine`.
 *
 * The button is fully self-contained: it reads and writes the shared
 * `useSongTrainerStore`, so any surface can drop it into a toolbar
 * without wiring extra props.
 */
export default function SongTrainerButton({ eligible, ineligibleReason }: Props): React.ReactElement {
  const t = useT();
  const enabled = useSongTrainerStore((s) => s.enabled);
  const setEnabled = useSongTrainerStore((s) => s.setEnabled);
  const percentage = useSongTrainerStore((s) => s.percentage);
  const setPercentage = useSongTrainerStore((s) => s.setPercentage);
  const reshuffle = useSongTrainerStore((s) => s.reshuffle);
  const hint = useShortcutHint();

  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  // Portal position — matches the AnnotationMenu / AnnotationSetPicker
  // pattern so the popover isn't clipped by an overflow: hidden
  // toolbar container.
  const POP_WIDTH = 260;
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  useLayoutEffect(() => {
    if (!open) return;
    const measure = () => {
      const el = buttonRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const preferredLeft = r.left;
      const rightIfLeft = preferredLeft + POP_WIDTH;
      const viewportW = window.innerWidth;
      const margin = 8;
      const clampedLeft = rightIfLeft > viewportW - margin
        ? Math.max(margin, viewportW - margin - POP_WIDTH)
        : preferredLeft;
      setPos({ top: r.bottom + 4, left: clampedLeft });
    };
    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (popRef.current?.contains(t)) return;
      if (buttonRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // Close the popover if the view becomes ineligible while it's open —
  // the trainer is disabled elsewhere by the caller, but the dropdown
  // itself shouldn't linger over a now-unusable feature.
  useEffect(() => {
    if (!eligible) setOpen(false);
  }, [eligible]);

  const onClick = () => {
    if (!eligible) return;
    // Two behaviors on click:
    //   - Trainer OFF: turn it on AND open the slider popover so the
    //     user can dial in a percentage in one gesture.
    //   - Trainer ON: just toggle the popover (they've already tuned
    //     it; the second click either shows the slider again or hides
    //     it, without disabling the feature).
    if (!enabled) {
      setEnabled(true);
      setOpen(true);
      return;
    }
    setOpen((v) => !v);
  };

  // Long-press-like secondary action: shift-click turns the trainer
  // OFF without opening the popover. Simple discoverable off-switch
  // that doesn't require reaching for a menu.
  const onAuxClick = (e: React.MouseEvent) => {
    if (!eligible) return;
    if (e.shiftKey) {
      e.preventDefault();
      setEnabled(false);
      setOpen(false);
    }
  };

  const iconColor = !eligible
    ? 'var(--text-muted)'
    : enabled
      ? 'var(--accent)'
      : 'var(--text-secondary)';

  const disabledTitle = ineligibleReason
    ?? t('songTrainer.ineligibleDefault');
  const activeTitle = `${t('songTrainer.title')}${hint('toggleSongTrainer')}`;

  const popover = open && eligible && pos ? createPortal(
    <div
      ref={popRef}
      className="rounded-md shadow-xl"
      onClick={(e) => e.stopPropagation()}
      style={{
        position: 'fixed',
        top: pos.top,
        left: pos.left,
        width: POP_WIDTH,
        background: 'var(--bg-secondary)',
        border: '1px solid var(--border)',
        zIndex: 10010,
        padding: 12,
      }}
    >
      <div className="flex items-center justify-between mb-2">
        <div className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>
          {t('songTrainer.title')}
        </div>
        <button
          onClick={() => { setEnabled(false); setOpen(false); }}
          className="text-[10px] px-2 py-0.5 rounded"
          style={{ color: 'var(--text-muted)', background: 'var(--surface)' }}
          title={t('songTrainer.offTitle')}
        >
          {t('songTrainer.off')}
        </button>
      </div>
      <div className="text-[11px] mb-2" style={{ color: 'var(--text-secondary)' }}>
        {t('songTrainer.hintPrefix')}<span style={{ color: 'var(--accent)', fontWeight: 700 }}>?</span>{t('songTrainer.hintMiddle')}<span style={{ color: 'var(--accent)', fontWeight: 700 }}>?</span>{t('songTrainer.hintSuffix')}
      </div>
      <div className="flex items-center gap-2">
        <input
          type="range"
          min={TRAINER_MIN}
          max={TRAINER_MAX}
          step={TRAINER_STEP}
          value={percentage}
          onChange={(e) => setPercentage(Number(e.target.value))}
          className="flex-1"
          aria-label={t('songTrainer.percentageAria')}
        />
        <span
          className="text-xs font-mono tabular-nums"
          style={{ color: 'var(--text-primary)', minWidth: '3ch', textAlign: 'right' }}
        >
          {percentage}%
        </span>
      </div>

      {/* Reshuffle — pick a NEW random subset of chords to hide at
          the same percentage. Useful for practising the same song
          against several hidden sets without changing the difficulty
          knob. */}
      <button
        onClick={() => reshuffle()}
        className="mt-3 w-full flex items-center justify-center gap-1.5 py-1.5 rounded-md text-xs font-medium transition-colors"
        style={{
          background: 'var(--surface-elevated)',
          color: 'var(--text-secondary)',
          border: '1px solid var(--border)',
        }}
        title={t('songTrainer.reshuffleTitle')}
      >
        <Shuffle size={12} />
        {t('songTrainer.reshuffle')}
      </button>
    </div>,
    document.body,
  ) : null;

  return (
    <>
      <button
        ref={buttonRef}
        onClick={onClick}
        onClickCapture={onAuxClick}
        disabled={!eligible}
        className="p-2 rounded-lg hover:bg-[var(--surface-elevated)] transition-colors"
        style={{
          opacity: eligible ? 1 : 0.4,
          cursor: eligible ? 'pointer' : 'not-allowed',
        }}
        title={eligible ? activeTitle : disabledTitle}
        aria-label={t('songTrainer.ariaLabel')}
        aria-pressed={enabled}
      >
        <GraduationCap size={16} style={{ color: iconColor }} />
      </button>
      {popover}
    </>
  );
}
