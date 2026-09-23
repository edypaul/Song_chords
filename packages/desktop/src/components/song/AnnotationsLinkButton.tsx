import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Highlighter, X, Star, Moon, Sun } from 'lucide-react';
import { parseSongAnnotations, viewModeLabel, SONG_STYLE_PRESETS, useSettingsStore } from '@song-chords/shared';
import { useT } from '../../i18n';

interface Props {
  title: string;
  /** The song's `annotations` JSON, if any. Empty / missing is treated
   *  as "no annotations" and renders the button disabled. */
  annotationsJson?: string;
  /** Visual size — `'sm'` for table rows, `'md'` for toolbars. Matches
   *  PlayLinkButton / NotesLinkButton so the icons line up in a row. */
  size?: 'sm' | 'md';
  /** When true, the component renders NOTHING when the song has no
   *  annotations — useful on surfaces where a disabled-placeholder
   *  icon would add noise (e.g. setlist detail rows). Defaults to
   *  `false` so the SongListTable's column-alignment behaviour is
   *  preserved by omission. */
  hideWhenEmpty?: boolean;
}

/**
 * Reusable "song annotations" button for song-list rows. Mirrors
 * {@link NotesLinkButton}: rendered disabled-but-present when the
 * song has no annotations so column alignment stays consistent
 * across rows. When the song DOES have annotations, clicking pops
 * up a small read-only list of every named set (and its
 * view-configuration tag) so the user can preview what's stored
 * without opening the song.
 *
 * The popover is portalled so it escapes the table's `overflow`
 * clipping, positioned next to the button, and dismisses on
 * outside-click / Escape.
 */
export default function AnnotationsLinkButton({ title, annotationsJson, size = 'sm', hideWhenEmpty = false }: Props): React.ReactElement | null {
  const t = useT();
  const doc = useMemo(() => parseSongAnnotations(annotationsJson), [annotationsJson]);
  const customPresets = useSettingsStore((s) => s.settings.customPresets ?? {});
  // Human-readable preset name from its key. Falls back to the key
  // itself when the preset can't be found (e.g. a custom preset the
  // user has since deleted) so the row still shows something
  // meaningful instead of a blank column.
  const presetName = (key: string): string => {
    if (!key) return t('songRow.annotations.anyPreset');
    const builtin = SONG_STYLE_PRESETS[key];
    if (builtin) return builtin.name;
    const custom = customPresets[key];
    if (custom) return custom.name;
    return key;
  };
  // Dark/light mode of the preset the set was drawn under — shown so
  // the user knows which appearance the annotation belongs to. null
  // when the preset is unknown (deleted custom preset): the segment
  // is simply omitted.
  const presetMode = (key: string): 'dark' | 'light' | null =>
    SONG_STYLE_PRESETS[key]?.mode ?? customPresets[key]?.mode ?? null;
  // Only named saved sets count for "has annotations" — a lingering
  // draft doesn't survive across sessions and isn't meaningful in a
  // list-row preview.
  const sets = doc?.sets ?? [];
  const has = sets.length > 0;

  const iconSize = size === 'md' ? 18 : 15;
  const padding = size === 'md' ? 'p-2' : 'p-1';

  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  const POP_WIDTH = 300;
  const MAX_HEIGHT = 260;
  const GAP = 8;
  const MARGIN = 12;

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const b = btnRef.current?.getBoundingClientRect();
      if (!b) return;
      let left = b.right + GAP;
      if (left + POP_WIDTH + MARGIN > window.innerWidth) {
        left = b.left - GAP - POP_WIDTH;
      }
      left = Math.max(MARGIN, Math.min(left, window.innerWidth - POP_WIDTH - MARGIN));
      let top = b.top;
      top = Math.max(MARGIN, Math.min(top, window.innerHeight - MAX_HEIGHT - MARGIN));
      setPos({ left, top });
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
      if (popRef.current?.contains(t) || btnRef.current?.contains(t)) return;
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

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!has) return;
    setOpen((v) => !v);
  };

  // Caller opted out of the disabled-placeholder mode (e.g. setlist
  // detail rows, where an "empty annotation slot" per row would
  // just be visual noise). Return nothing when the song has no
  // named sets.
  if (hideWhenEmpty && !has) return null;

  const tooltip = has
    ? (sets.length === 1
        ? t('songRow.annotations.tooltipOne', { count: sets.length, title })
        : t('songRow.annotations.tooltipMany', { count: sets.length, title }))
    : t('songRow.annotations.disabled');

  return (
    <>
      <button
        ref={btnRef}
        onClick={handleClick}
        disabled={!has}
        className={`${padding} rounded-lg transition-colors`}
        style={{
          color: has ? 'var(--accent)' : 'var(--text-muted)',
          opacity: has ? 1 : 0.35,
          cursor: has ? 'pointer' : 'not-allowed',
          background: 'transparent',
        }}
        title={tooltip}
        aria-label={tooltip}
      >
        <Highlighter size={iconSize} strokeWidth={1.75} />
      </button>

      {open && has && pos && createPortal(
        <div
          ref={popRef}
          className="fixed rounded-xl shadow-2xl border flex flex-col"
          onClick={(e) => e.stopPropagation()}
          style={{
            left: pos.left,
            top: pos.top,
            width: POP_WIDTH,
            maxHeight: MAX_HEIGHT,
            background: 'var(--bg-secondary)',
            borderColor: 'var(--border)',
            zIndex: 300,
          }}
        >
          <div
            className="flex items-center justify-between px-3 py-2 border-b"
            style={{ borderColor: 'var(--border)' }}
          >
            <div className="flex items-center gap-2 min-w-0">
              <Highlighter size={14} style={{ color: 'var(--accent)' }} />
              <h3 className="font-semibold text-xs truncate" style={{ color: 'var(--text-primary)' }} title={title}>
                {title}
              </h3>
            </div>
            <button
              onClick={(e) => { e.stopPropagation(); setOpen(false); }}
              className="p-1 rounded hover:bg-[var(--surface-elevated)]"
              title={t('songRow.annotations.close')}
            >
              <X size={14} style={{ color: 'var(--text-muted)' }} />
            </button>
          </div>
          <div className="p-2 overflow-y-auto text-sm" style={{ color: 'var(--text-primary)' }}>
            {sets.map((s) => {
              const vLabel = viewModeLabel(s.viewMode);
              const pLabel = presetName(s.preset);
              const mode = presetMode(s.preset);
              const mLabel = mode
                ? t(mode === 'dark' ? 'songRow.annotations.modeDark' : 'songRow.annotations.modeLight')
                : null;
              return (
                <div
                  key={s.id}
                  className="flex items-center gap-1.5 px-2 py-1.5 rounded"
                  style={{ borderBottom: '1px solid var(--border)' }}
                >
                  {s.isDefault
                    ? <Star size={11} style={{ color: 'var(--accent)' }} fill="currentColor" />
                    : <span style={{ width: 11 }} />}
                  <span className="truncate flex-1 text-xs">{s.name || t('songRow.annotations.unnamed')}</span>
                  <span
                    className="text-[10px] whitespace-nowrap inline-flex items-center gap-1.5"
                    style={{ color: 'var(--text-muted)' }}
                    title={`${vLabel} — ${pLabel}${mLabel ? ` — ${mLabel}` : ''}`}
                  >
                    <span>{vLabel}</span>
                    <span
                      aria-hidden="true"
                      style={{
                        display: 'inline-block',
                        width: 1,
                        height: 10,
                        background: 'var(--border)',
                      }}
                    />
                    <span>{pLabel}</span>
                    {mLabel && (
                      <>
                        <span
                          aria-hidden="true"
                          style={{
                            display: 'inline-block',
                            width: 1,
                            height: 10,
                            background: 'var(--border)',
                          }}
                        />
                        <span className="inline-flex items-center gap-1">
                          {mode === 'dark'
                            ? <Moon size={9} style={{ color: 'var(--text-muted)' }} />
                            : <Sun size={9} style={{ color: 'var(--text-muted)' }} />}
                          {mLabel}
                        </span>
                      </>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
