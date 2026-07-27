import React, { useEffect, useMemo, useState } from 'react';
import {
  Keyboard, X, Music, FileText, ZoomIn,
  Play, Timer, User as UserIcon, Command,
  Undo2, Tag, AlertCircle, Search,
} from 'lucide-react';
import { useSettingsStore } from '@song-chords/shared';
import type { ShortcutAction } from '@song-chords/shared';
import { formatShortcut } from '../../utils/shortcut';
import { useT } from '../../i18n';
import type { TKey } from '../../i18n';

interface Shortcut {
  keys: string[];
  desc: string;
}

interface Group {
  title: string;
  icon: React.ReactNode;
  shortcuts: Shortcut[];
}

/** Per-action i18n descriptions. Bound at render time via the `useT` hook. */
const ACTION_LABEL_KEYS: Record<ShortcutAction, TKey> = {
  toggleInlineDiagrams: 'shortcuts.actions.toggleInlineDiagrams',
  toggleChordBar:       'shortcuts.actions.toggleChordBar',
  toggleLyricsOnly:     'shortcuts.actions.toggleLyricsOnly',
  toggleMetronome:      'shortcuts.actions.toggleMetronome',
  toggleSongNotes:      'shortcuts.actions.toggleSongNotes',
  toggleAutoScroll:     'shortcuts.actions.toggleAutoScroll',
  transposeUp:          'shortcuts.actions.transposeUp',
  transposeDown:        'shortcuts.actions.transposeDown',
  resetTranspose:       'shortcuts.actions.resetTranspose',
  exportSong:           'shortcuts.actions.exportSong',
  editSong:             'shortcuts.actions.editSong',
  toggleFavorite:       'shortcuts.actions.toggleFavorite',
  cast:                 'shortcuts.actions.cast',
  addToSetList:         'shortcuts.actions.addToSetList',
  toggleFullscreen:     'shortcuts.actions.toggleFullscreen',
  nextSong:             'shortcuts.actions.nextSong',
  prevSong:             'shortcuts.actions.prevSong',
  zoomIn:               'shortcuts.actions.zoomIn',
  zoomOut:              'shortcuts.actions.zoomOut',
  zoomReset:            'shortcuts.actions.zoomReset',
  openSearch:           'shortcuts.actions.openSearch',
  toggleToolbar:        'shortcuts.actions.toggleToolbar',
  toggleSongTrainer:    'shortcuts.actions.toggleSongTrainer',
};

/** Static groups whose contents don't depend on user settings. Titles
 *  and descriptions are dictionary KEYS resolved at render time so the
 *  modal re-renders in the active language. */
interface StaticShortcut { keys: string[]; descKey: TKey; }
interface StaticGroup { titleKey: TKey; icon: React.ReactNode; shortcuts: StaticShortcut[]; }

const STATIC_GROUPS: StaticGroup[] = [
  {
    titleKey: 'shortcuts.groups.global',
    icon: <Command size={14} />,
    shortcuts: [
      { keys: ['?'],   descKey: 'shortcuts.desc.toggleThisList' },
      { keys: ['Esc'], descKey: 'shortcuts.desc.closeModals' },
    ],
  },
  {
    titleKey: 'shortcuts.groups.performMode',
    icon: <Play size={14} />,
    shortcuts: [
      // Set-list navigation is configurable in Settings (default
      // ArrowRight / ArrowLeft) and surfaces in the dynamic groups
      // above. The hardcoded fallbacks listed here always work as
      // a safety net even if the user clears the configurable
      // bindings.
      { keys: ['PgDn'],  descKey: 'shortcuts.desc.nextSongAlways' },
      { keys: ['PgUp'],  descKey: 'shortcuts.desc.prevSongAlways' },
      { keys: ['Esc'],   descKey: 'shortcuts.desc.leavePerformMode' },
      { keys: ['Swipe'], descKey: 'shortcuts.desc.swipeTouch' },
    ],
  },
  {
    titleKey: 'shortcuts.groups.songContentEditor',
    icon: <Undo2 size={14} />,
    shortcuts: [
      { keys: ['Ctrl+Z'],                 descKey: 'shortcuts.desc.undo' },
      { keys: ['Ctrl+Y', 'Ctrl+Shift+Z'], descKey: 'shortcuts.desc.redo' },
    ],
  },
  {
    titleKey: 'shortcuts.groups.tempoInput',
    icon: <Timer size={14} />,
    shortcuts: [
      { keys: ['Space', '↵'], descKey: 'shortcuts.desc.tapTempo' },
    ],
  },
  {
    titleKey: 'shortcuts.groups.artistField',
    icon: <UserIcon size={14} />,
    shortcuts: [
      { keys: ['↓', '↑'], descKey: 'shortcuts.desc.moveSuggestions' },
      { keys: ['↵'],       descKey: 'shortcuts.desc.acceptSuggestion' },
    ],
  },
  {
    titleKey: 'shortcuts.groups.tagsField',
    icon: <Tag size={14} />,
    shortcuts: [
      { keys: ['↵'],         descKey: 'shortcuts.desc.addTag' },
      { keys: ['Backspace'], descKey: 'shortcuts.desc.removeLastTag' },
    ],
  },
  {
    titleKey: 'shortcuts.groups.confirmDialogs',
    icon: <AlertCircle size={14} />,
    shortcuts: [
      { keys: ['↵'],   descKey: 'shortcuts.desc.confirmAction' },
      { keys: ['Esc'], descKey: 'shortcuts.desc.cancel' },
    ],
  },
  {
    // Non-rebindable zoom gestures on the Song view. The keyboard
    // zoom (Ctrl+= / Ctrl+- / Ctrl+0) IS rebindable and lives in the
    // dynamic groups below via the ShortcutAction routing; this
    // group is just for the mouse-wheel + touch equivalents.
    titleKey: 'shortcuts.groups.zoomSongView',
    icon: <ZoomIn size={14} />,
    shortcuts: [
      { keys: ['Ctrl+Wheel'], descKey: 'shortcuts.desc.zoomWheel' },
      { keys: ['Pinch'],      descKey: 'shortcuts.desc.zoomPinch' },
    ],
  },
  {
    // GlobalSearch overlay has its own in-overlay navigation keys —
    // Escape closes the overlay (covered in the Global group above);
    // Arrow keys and Enter move through and open results.
    titleKey: 'shortcuts.groups.globalSearchOverlay',
    icon: <Search size={14} />,
    shortcuts: [
      { keys: ['↓', '↑'], descKey: 'shortcuts.desc.moveResults' },
      { keys: ['↵'],       descKey: 'shortcuts.desc.openHighlighted' },
    ],
  },
];

function splitCombo(combo: string): string[] {
  if (combo.includes(' ')) return [combo];
  return combo.split('+').map((t) => t.trim()).filter(Boolean);
}

/** Splits a translated template around the literal `{key}` token and
 *  renders a <KeyBadge> in place of the token so the surrounding copy
 *  translates while the physical key name stays a literal badge. */
function renderWithKey(template: string, keyLabel: string): React.ReactNode {
  const parts = template.split('{key}');
  return parts.flatMap((part, i) => (
    i === parts.length - 1
      ? [<React.Fragment key={`t-${i}`}>{part}</React.Fragment>]
      : [
          <React.Fragment key={`t-${i}`}>{part}</React.Fragment>,
          <KeyBadge key={`k-${i}`} label={keyLabel} />,
        ]
  ));
}

function KeyBadge({ label }: { label: string }): React.ReactElement {
  return (
    <kbd
      className="inline-flex items-center justify-center px-2 min-w-[1.75rem] h-[1.75rem] rounded-md text-xs font-mono font-semibold whitespace-nowrap"
      style={{
        background: 'var(--surface-elevated)',
        color: 'var(--text-primary)',
        border: '1px solid var(--border)',
        boxShadow: '0 1px 0 rgba(0,0,0,0.25), inset 0 -1px 0 rgba(255,255,255,0.04)',
      }}
    >
      {label}
    </kbd>
  );
}

function ShortcutRow({ shortcut }: { shortcut: Shortcut }): React.ReactElement {
  const t = useT();
  return (
    <div className="flex items-center gap-4 py-2">
      <span className="flex-1 text-sm" style={{ color: 'var(--text-primary)' }}>{shortcut.desc}</span>
      <span className="flex items-center gap-1 shrink-0 flex-wrap justify-end">
        {shortcut.keys.map((combo, ci) => (
          <React.Fragment key={ci}>
            {ci > 0 && <span className="text-[11px] px-0.5" style={{ color: 'var(--text-muted)' }}>{t('shortcuts.separator.or')}</span>}
            <span className="flex items-center gap-1">
              {splitCombo(combo).map((part, pi) => (
                <React.Fragment key={pi}>
                  {pi > 0 && <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>+</span>}
                  <KeyBadge label={part} />
                </React.Fragment>
              ))}
            </span>
          </React.Fragment>
        ))}
      </span>
    </div>
  );
}

/** Listens for `?` anywhere (unless the user is typing) and opens a modal
 * listing every keyboard shortcut available in the app. */
export default function KeyboardShortcutsOverlay(): React.ReactElement | null {
  const t = useT();
  const [open, setOpen] = useState(false);
  const shortcuts = useSettingsStore((s) => s.settings.shortcuts);

  const dynamicGroups = useMemo<Group[]>(() => {
    if (!shortcuts) return [];
    const global: Shortcut[] = [];
    const songPerform: Shortcut[] = [];
    const songOnly: Shortcut[] = [];
    const setlistNav: Shortcut[] = [];
    const zoom: Shortcut[] = [];
    const routing: Array<{ action: ShortcutAction; target: Shortcut[] }> = [
      { action: 'openSearch',           target: global },
      { action: 'toggleInlineDiagrams', target: songPerform },
      { action: 'toggleChordBar',       target: songPerform },
      { action: 'toggleLyricsOnly',     target: songPerform },
      { action: 'toggleMetronome',      target: songPerform },
      { action: 'toggleAutoScroll',     target: songPerform },
      { action: 'toggleSongNotes',      target: songPerform },
      { action: 'toggleFullscreen',     target: songPerform },
      { action: 'toggleToolbar',        target: songPerform },
      { action: 'toggleSongTrainer',    target: songOnly },
      { action: 'transposeUp',          target: songPerform },
      { action: 'transposeDown',        target: songPerform },
      { action: 'resetTranspose',       target: songPerform },
      { action: 'exportSong',           target: songOnly },
      { action: 'editSong',             target: songOnly },
      { action: 'toggleFavorite',       target: songOnly },
      { action: 'cast',                 target: songOnly },
      { action: 'addToSetList',         target: songOnly },
      { action: 'nextSong',             target: setlistNav },
      { action: 'prevSong',             target: setlistNav },
      { action: 'zoomIn',               target: zoom },
      { action: 'zoomOut',              target: zoom },
      { action: 'zoomReset',            target: zoom },
    ];
    for (const { action, target } of routing) {
      const binding = shortcuts[action];
      if (!binding) continue;
      target.push({ keys: [formatShortcut(binding)], desc: t(ACTION_LABEL_KEYS[action]) });
    }
    songPerform.push({ keys: [`${shortcuts.capoModifier} + 0…9`], desc: t('shortcuts.desc.setCapo') });

    const out: Group[] = [];
    if (global.length)      out.push({ title: t('shortcuts.groups.search'),             icon: <Search size={14} />,   shortcuts: global });
    if (songPerform.length) out.push({ title: t('shortcuts.groups.songViewPerform'),    icon: <Music size={14} />,    shortcuts: songPerform });
    if (songOnly.length)    out.push({ title: t('shortcuts.groups.songActions'),        icon: <FileText size={14} />, shortcuts: songOnly });
    if (setlistNav.length)  out.push({ title: t('shortcuts.groups.setListNavigation'),  icon: <Play size={14} />,     shortcuts: setlistNav });
    if (zoom.length)        out.push({ title: t('shortcuts.groups.zoom'),               icon: <ZoomIn size={14} />,   shortcuts: zoom });
    return out;
  }, [shortcuts, t]);

  const groups = useMemo<Group[]>(() => {
    // Resolve STATIC_GROUPS' TKey placeholders through `t` at render time.
    const resolvedStatic = STATIC_GROUPS.map((g) => ({
      title: t(g.titleKey),
      icon: g.icon,
      shortcuts: g.shortcuts.map((s) => ({ keys: s.keys, desc: t(s.descKey) })),
    }));
    return [...dynamicGroups, ...resolvedStatic];
  }, [dynamicGroups, t]);

  useEffect(() => {
    // Listen in the capture phase so closing the modal on Escape can halt
    // the event before other page-level Escape handlers (e.g. the Song View
    // page's "navigate back" handler) see it.
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      const editable = (e.target as HTMLElement | null)?.isContentEditable;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || editable) return;
      if (e.key === '?' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        e.stopImmediatePropagation();
        setOpen((v) => !v);
      } else if (e.key === 'Escape' && open) {
        e.preventDefault();
        e.stopImmediatePropagation();
        setOpen(false);
      }
    };
    window.addEventListener('keydown', handler, { capture: true });
    return () => window.removeEventListener('keydown', handler, { capture: true });
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 flex items-center justify-center p-6"
      style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)', zIndex: 500 }}
      onClick={() => setOpen(false)}
    >
      <div
        className="w-full max-w-2xl rounded-2xl flex flex-col overflow-hidden"
        style={{
          maxHeight: 'min(88vh, 720px)',
          background: 'var(--bg-secondary)',
          border: '1px solid var(--border)',
          boxShadow: '0 30px 60px -15px rgba(0,0,0,0.5)',
        }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        {/* Header */}
        <div
          className="flex items-center gap-3 px-6 py-4 shrink-0"
          style={{
            borderBottom: '1px solid var(--border)',
            background: 'color-mix(in srgb, var(--accent) 6%, transparent)',
          }}
        >
          <div
            className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
            style={{ background: 'color-mix(in srgb, var(--accent) 20%, transparent)', color: 'var(--accent)' }}
          >
            <Keyboard size={18} />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>{t('shortcuts.title')}</h2>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
              {t('shortcuts.subtitle')}
            </p>
          </div>
          <button
            onClick={() => setOpen(false)}
            className="p-2 rounded-lg hover:bg-[var(--surface-elevated)] transition-colors"
            aria-label={t('common.close')}
          >
            <X size={16} style={{ color: 'var(--text-muted)' }} />
          </button>
        </div>

        {/* Body: scrollable single-column list */}
        <div className="flex-1 min-h-0 overflow-y-auto px-6 py-4">
          {groups.map((g, gi) => (
            <section
              key={g.title}
              className={gi > 0 ? 'mt-5 pt-5' : ''}
              style={gi > 0 ? { borderTop: '1px solid var(--border)' } : undefined}
            >
              <header className="flex items-center gap-2 mb-1">
                <span style={{ color: 'var(--accent)' }}>{g.icon}</span>
                <h3 className="text-[11px] uppercase tracking-wider font-semibold" style={{ color: 'var(--text-secondary)' }}>
                  {g.title}
                </h3>
              </header>
              <div>
                {g.shortcuts.map((s, i) => (
                  <ShortcutRow key={i} shortcut={s} />
                ))}
              </div>
            </section>
          ))}
        </div>

        {/* Footer */}
        <div
          className="px-6 py-3 flex items-center justify-between text-xs shrink-0"
          style={{ borderTop: '1px solid var(--border)', color: 'var(--text-muted)' }}
        >
          <span className="flex items-center gap-1.5">{renderWithKey(t('shortcuts.footerReopen'), '?')}</span>
          <span className="flex items-center gap-1.5">{renderWithKey(t('shortcuts.footerClose'), 'Esc')}</span>
        </div>
      </div>
    </div>
  );
}
