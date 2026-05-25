import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { X, ChevronLeft, ChevronRight, Guitar, LayoutGrid, FileText, StickyNote, ArrowUp, MoreVertical, Edit2, Star, ListMusic, Download } from 'lucide-react';
import { SONG_STYLE_PRESETS, usePlayerStore, useSettingsStore, useSongStore, useSetListStore } from '@song-chords/shared';
import SongExportModal from './SongExportModal';
import SetListPickerModal from './SetListPickerModal';
import type { Song } from '@song-chords/shared';
import SongRenderer from './SongRenderer';
import SongDetails from './SongDetails';
import ChordDiagramBar from '../chord-diagram/ChordDiagramBar';
import ChordModal from '../chord-diagram/ChordModal';
import { useEffectiveChordVariations } from '../../hooks/useEffectiveChordVariations';
import TransposeControl from '../controls/TransposeControl';
import AutoScrollControl from '../controls/AutoScrollControl';
import MetronomeControl from '../controls/MetronomeControl';
import StickyNotePanel from './StickyNotePanel';
import SectionNavigator from './SectionNavigator';
import CastQuickButton from './CastQuickButton';
import PlayLinkButton from './PlayLinkButton';
import BottomSectionSpacer from './BottomSectionSpacer';
import { useAutoScroll } from '../../hooks/useAutoScroll';
import { useMetronome } from '../../hooks/useMetronome';
import { useSwipeNavigation } from '../../hooks/useSwipeNavigation';
import { useKeyboardShortcuts } from '../../hooks/useKeyboardShortcuts';
import { db } from '../../ipc/ipc-client';
import { toTitleCase } from '../../utils/text';

/**
 * One item in a perform queue. Songs carry an optional `overrides` patch that's
 * merged on top of the song before it's loaded (so setlist / favorite contexts
 * can perform with their own key / capo / tempo / transpose without touching
 * the original song). Notes carry free-form title + body text.
 */
export interface PerformItem {
  id: string;
  type: 'song' | 'note';
  song?: Song;
  overrides?: {
    transpose: number;
    capo: number;
    key?: string;
    tempo?: number;
    timeSig?: string;
  };
  noteTitle?: string;
  noteBody?: string;
}

interface PerformPageProps {
  /** Page header title (e.g. setlist name, category value, or "Favorites"). */
  title: string;
  /** Optional leading icon rendered next to the title. */
  icon?: React.ReactNode;
  /** Ordered list of items to perform. */
  items: PerformItem[];
  /** Persist transpose/capo changes for a specific song item. Called on every
   *  distinct change — caller is responsible for debouncing/deduping if needed. */
  onOverridesChange?: (itemId: string, overrides: { transpose: number; capo: number }) => void;
  /** Rendered instead of the normal UI when `items` is empty. */
  emptyState?: React.ReactNode;
}

export default function PerformPage({ title, icon, items, onOverridesChange, emptyState }: PerformPageProps): React.ReactElement {
  const navigate = useNavigate();
  const updateSongInStore = useSongStore((s) => s.updateSong);

  const loadSong = usePlayerStore((s) => s.loadSong);
  const displayedSong = usePlayerStore((s) => s.displayedSong);
  const activeSong = usePlayerStore((s) => s.activeSong);
  const fontSize = usePlayerStore((s) => s.fontSize);
  const viewMode = usePlayerStore((s) => s.viewMode);
  const setViewMode = usePlayerStore((s) => s.setViewMode);

  // Half/double-time applies only to the metronome, not the stored song
  // tempo. Reset when switching songs so the new song starts at 1×.
  const [tempoMultiplier, setTempoMultiplier] = useState<0.5 | 1 | 2>(1);
  const baseTempo = activeSong?.tempo ?? 120;
  const metronome = useMetronome(Math.round(baseTempo * tempoMultiplier), activeSong?.timeSig ?? '4/4');
  useEffect(() => { setTempoMultiplier(1); }, [activeSong?.id]);

  const svs = useSettingsStore((s) => s.settings.songViewStyle);
  const songCentered = useSettingsStore((s) => s.settings.songCentered ?? false);
  const perfZoom = useSettingsStore((s) => s.settings.perfZoom ?? 1);
  const chordBarPosition = useSettingsStore((s) => s.settings.chordBarPosition ?? 'top');
  const inlineDiagrams = useSettingsStore((s) => s.settings.inlineChordDiagrams ?? false);
  const instrument = useSettingsStore((s) => s.settings.defaultInstrument);
  // Merged chord-variation map (per-song overrides win over the global
  // default for this instrument). See useEffectiveChordVariations.
  const effectiveChordVariations = useEffectiveChordVariations(instrument);
  const showChordDiagrams = useSettingsStore((s) => s.settings.showChordDiagrams ?? true);
  const updateSetting = useSettingsStore((s) => s.updateSetting);

  const [chordBarVisible, setChordBarVisible] = useState(showChordDiagrams);
  useEffect(() => { setChordBarVisible(showChordDiagrams); }, [showChordDiagrams]);
  useEffect(() => {
    if (viewMode === 'lyrics-only') {
      if (chordBarVisible) setChordBarVisible(false);
      if (inlineDiagrams) void updateSetting(db, 'inlineChordDiagrams', false);
    }
  }, [viewMode]);

  const scrollRef = useRef<HTMLDivElement>(null);
  useAutoScroll(scrollRef as React.RefObject<HTMLElement>);

  const [activeIndex, setActiveIndex] = useState(0);
  // Clamp in case the items list shrinks.
  useEffect(() => {
    if (activeIndex > items.length - 1) setActiveIndex(Math.max(0, items.length - 1));
  }, [items.length, activeIndex]);

  const total = items.length;
  const currentItem = items[activeIndex];
  const isNoteActive = currentItem?.type === 'note';

  // Slide direction for the content wrapper.
  const [navDirection, setNavDirection] = useState<'next' | 'prev'>('next');
  const goNext = useCallback(() => {
    setNavDirection('next');
    setActiveIndex((i) => Math.min(i + 1, total - 1));
  }, [total]);
  const goPrev = useCallback(() => {
    setNavDirection('prev');
    setActiveIndex((i) => Math.max(i - 1, 0));
  }, []);
  const swipe = useSwipeNavigation({ onNext: goNext, onPrev: goPrev });

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0, behavior: 'auto' });
  }, [activeIndex]);

  // Track whether the scroll container has bottomed out, so the floating
  // "Back to top" button only appears when there's actually somewhere to
  // scroll back from. The bottom spacer (mounted while the section panel
  // is open) inflates `scrollHeight`, so subtract it before deciding.
  const [atBottom, setAtBottom] = useState(false);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) { setAtBottom(false); return; }
    const update = () => {
      const spacer = el.querySelector<HTMLElement>('[data-bottom-spacer]');
      const spacerHeight = spacer ? spacer.offsetHeight : 0;
      const total = el.scrollHeight - el.clientHeight - spacerHeight;
      setAtBottom(total > 0 && el.scrollTop >= total - 2);
    };
    update();
    el.addEventListener('scroll', update, { passive: true });
    return () => el.removeEventListener('scroll', update);
  }, [activeIndex]);

  const [showSongNotes, setShowSongNotes] = useState(false);

  // Three-dots "more" menu — mirrors SongViewPage 1:1 so the two
  // surfaces have the same options (style preset, favorite, set-list,
  // export, notes, cast, edit song). Less-used actions live here so
  // the live-performance toolbar stays uncluttered.
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const moreMenuRef = useRef<HTMLDivElement>(null);
  const moreMenuTriggerRef = useRef<HTMLButtonElement>(null);
  const [moreMenuPos, setMoreMenuPos] = useState<{ top: number; right: number } | null>(null);
  const [showExport, setShowExport] = useState(false);
  const [showSetListPicker, setShowSetListPicker] = useState(false);
  // Chord clicked in the song body / diagram bar — opens the shared
  // chord diagram modal (same as the standard song view).
  const [selectedChord, setSelectedChord] = useState<string | null>(null);

  // The perform page runs in native fullscreen. Closing the chord
  // modal with Escape makes the browser drop fullscreen (a
  // non-cancelable UA action), so re-request it synchronously inside
  // the modal's Escape keydown to stay fullscreen. Unlike the song
  // view, perform mode has no fullscreenchange→navigate teardown, so
  // simply re-requesting is enough.
  const keepFullscreenAfterModal = () => {
    document.documentElement.requestFullscreen?.().catch(() => {});
  };
  const toggleFavorite = useSongStore((s) => s.toggleFavorite);
  const addSongToSetList = useSetListStore((s) => s.addSongToSetList);
  const customPresets = useSettingsStore((s) => s.settings.customPresets ?? {});
  // effectiveTheme is whatever data-theme is currently applied to
  // <html> — read it once at render so the menu's preset list filters
  // light vs dark builtin presets the same way SongViewPage does.
  const effectiveTheme: 'dark' | 'light' = (typeof document !== 'undefined'
    && document.documentElement.getAttribute('data-theme') === 'dark') ? 'dark' : 'light';
  useLayoutEffect(() => {
    if (!moreMenuOpen) return;
    const place = () => {
      const btn = moreMenuTriggerRef.current;
      if (!btn) return;
      const r = btn.getBoundingClientRect();
      setMoreMenuPos({ top: r.bottom + 6, right: window.innerWidth - r.right });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [moreMenuOpen]);
  useEffect(() => {
    if (!moreMenuOpen) return;
    const onClick = (e: MouseEvent) => {
      const t = e.target as Node;
      if (moreMenuRef.current && moreMenuRef.current.contains(t)) return;
      if (moreMenuTriggerRef.current && moreMenuTriggerRef.current.contains(t)) return;
      if ((t as HTMLElement).closest?.('[data-cast-popover]')) return;
      setMoreMenuOpen(false);
    };
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, [moreMenuOpen]);

  // Shortcut handlers — transpose/capo mutate the player store, which in
  // turn fires the overrides-changed subscription to persist them onto the
  // setlist / favorite entry. Zoom adjusts the global perfZoom setting.
  useKeyboardShortcuts({
    toggleInlineDiagrams: () => {
      // Piano can't render inline; ignore the shortcut so the setting
      // doesn't silently flip on with no visible effect.
      if (instrument === 'piano') return;
      void updateSetting(db, 'inlineChordDiagrams', !inlineDiagrams);
    },
    toggleChordBar:       () => setChordBarVisible((v) => !v),
    toggleLyricsOnly:     () => setViewMode(viewMode === 'lyrics-only' ? 'chords' : 'lyrics-only'),
    toggleMetronome:      () => { if (activeSong?.tempo) metronome.toggle(); },
    toggleSongNotes:      () => { if (activeSong?.notes?.trim() && !isNoteActive) setShowSongNotes((v) => !v); },
    toggleAutoScroll:     () => usePlayerStore.getState().toggleAutoScroll(),
    transposeUp:          () => usePlayerStore.getState().transposeUp(),
    transposeDown:        () => usePlayerStore.getState().transposeDown(),
    resetTranspose:       () => usePlayerStore.getState().resetTranspose(),
    toggleFavorite:       () => { if (activeSong) void toggleFavorite(db, activeSong.id); },
    cast:                 () => {
      const btn = document.querySelector('button[title="Cast"]') as HTMLButtonElement | null;
      btn?.click();
    },
    addToSetList:         () => setShowSetListPicker(true),
    toggleFullscreen:     () => {
      // PerformPage already enters fullscreen on mount; the shortcut
      // becomes an explicit "exit fullscreen" toggle here. If the
      // document somehow isn't fullscreen (browser denied the
      // requestFullscreen on mount, e.g. no user gesture), pressing
      // the binding re-tries the enter.
      if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
      else document.documentElement.requestFullscreen?.().catch(() => {});
    },
    nextSong:             () => goNext(),
    prevSong:             () => goPrev(),
    zoomIn:               () => void updateSetting(db, 'perfZoom', Math.min((perfZoom ?? 1) + 0.1, 3)),
    zoomOut:              () => void updateSetting(db, 'perfZoom', Math.max((perfZoom ?? 1) - 0.1, 0.5)),
    zoomReset:            () => void updateSetting(db, 'perfZoom', 1),
    onCapo:               (fret) => usePlayerStore.getState().setCapo(fret),
  });
  // Auto-open the sticky note only for SONG entries that have notes. When
  // the current entry is a standalone text note (type 'note'), the sticky
  // stays hidden — the note's own content is already the main view.
  useEffect(() => {
    const isSong = currentItem?.type === 'song';
    setShowSongNotes(isSong && !!activeSong?.notes && activeSong.notes.trim().length > 0);
  }, [currentItem?.id, currentItem?.type, activeSong?.id, activeSong?.notes]);

  // Load the current song (merging its overrides) when the index changes.
  useEffect(() => {
    if (!currentItem || currentItem.type !== 'song' || !currentItem.song) return;
    const s = currentItem.song;
    const o = currentItem.overrides;
    const merged = o ? {
      ...s,
      key: o.key ?? s.key,
      tempo: o.tempo ?? s.tempo,
      timeSig: o.timeSig ?? s.timeSig,
      capo: o.capo,
      preferences: {
        ...(s.preferences ?? {}),
        transposeSteps: o.transpose,
      },
    } : s;
    loadSong(merged);
  }, [currentItem?.id, currentItem?.overrides?.transpose, currentItem?.overrides?.capo]);

  // Persist transpose/capo edits via the provided callback. The value check
  // prevents redundant writes triggered by loadSong syncing player state to
  // match the item.
  useEffect(() => {
    if (!onOverridesChange) return;
    return usePlayerStore.subscribe((state, prev) => {
      if (state.transposeSteps === prev.transposeSteps && state.capo === prev.capo) return;
      const item = items[activeIndex];
      if (!item || item.type !== 'song') return;
      const o = item.overrides;
      if (o && state.transposeSteps === o.transpose && state.capo === o.capo) return;
      onOverridesChange(item.id, { transpose: state.transposeSteps, capo: state.capo });
    });
  }, [onOverridesChange, items, activeIndex]);

  // Keyboard navigation — only the hardcoded keys live here.
  // Escape is the universal "exit perform" gesture and stays out of
  // the configurable system. PageUp / PageDown remain as fixed
  // fallbacks so navigation works even if the user rebinds nextSong /
  // prevSong away from the arrow keys. The configurable nextSong /
  // prevSong bindings (default ArrowRight / ArrowLeft) are dispatched
  // via useKeyboardShortcuts above.
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      const editable = (e.target as HTMLElement | null)?.isContentEditable;
      const inInput = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || !!editable;
      if (inInput) return;
      if (e.key === 'Escape') navigate(-1);
      if (e.key === 'PageDown') goNext();
      if (e.key === 'PageUp')   goPrev();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [navigate, goNext, goPrev]);

  // Fullscreen on mount.
  useEffect(() => {
    document.documentElement.requestFullscreen?.().catch(() => {});
    return () => {
      if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    };
  }, []);

  if (total === 0) {
    return (
      <div className="fixed inset-0 flex flex-col items-center justify-center gap-4" style={{ background: 'var(--bg)', color: 'var(--text-muted)', zIndex: 100 }}>
        {emptyState ?? <p>Nothing to perform.</p>}
        <button onClick={() => navigate(-1)} className="px-4 py-2 rounded-lg" style={{ background: 'var(--surface-elevated)', color: 'var(--text-primary)' }}>Back</button>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 flex flex-col" style={{ background: 'var(--bg)', zIndex: 100 }}>
      {/* Top bar */}
      <div className="flex items-center gap-3 px-4 py-3 border-b shrink-0 flex-wrap" style={{ borderColor: 'var(--border)', background: 'var(--bg-secondary)' }}>
        <button onClick={() => navigate(-1)} className="p-2 rounded-lg hover:bg-[var(--surface-elevated)]">
          <X size={16} style={{ color: 'var(--text-secondary)' }} />
        </button>

        <div
          className="flex items-center gap-2 font-semibold"
          style={{ color: 'var(--text-primary)', textTransform: svs.titleUppercase ? 'uppercase' : undefined }}
        >
          {icon}
          <span>{svs.titleUppercase ? title : toTitleCase(title)}</span>
        </div>
        <span className="px-2 py-0.5 rounded text-xs" style={{ background: 'var(--surface-elevated)', color: 'var(--text-muted)' }}>
          {activeIndex + 1} / {total}
        </span>

        <div className="flex gap-1 mx-2">
          <button onClick={goPrev} disabled={activeIndex === 0} className="p-2 rounded-lg hover:bg-[var(--surface-elevated)] disabled:opacity-30">
            <ChevronLeft size={16} />
          </button>
          <button onClick={goNext} disabled={activeIndex >= total - 1} className="p-2 rounded-lg hover:bg-[var(--surface-elevated)] disabled:opacity-30">
            <ChevronRight size={16} />
          </button>
        </div>

        {/* Song-only controls — dimmed & non-interactive when a note is active. */}
        <div
          className="flex items-center gap-3 flex-wrap"
          style={{
            opacity: isNoteActive ? 0.35 : 1,
            pointerEvents: isNoteActive ? 'none' : undefined,
          }}
          aria-disabled={isNoteActive}
          title={isNoteActive ? 'Not available on a note entry' : undefined}
        >
          <TransposeControl />
          <div className="ml-2"><AutoScrollControl /></div>

          {/* Metronome — shared cluster (BPM-button + chevron with
              ½×/1×/2× popover) so the song-view and perform pages have
              the same compact UX. */}
          {activeSong?.tempo && (
            <MetronomeControl
              tempo={activeSong.tempo}
              timeSig={activeSong.timeSig}
              isPlaying={metronome.isPlaying}
              currentBeat={metronome.currentBeat}
              beatsPerMeasure={metronome.beatsPerMeasure}
              tempoMultiplier={tempoMultiplier}
              onToggle={metronome.toggle}
              onMultiplierChange={setTempoMultiplier}
            />
          )}

          {/* Mutually-exclusive view toggle (see SongViewPage for the
              full rationale). Clicking any of the three activates that
              mode and clears the other two. No button disables itself
              except inline-diagrams when the instrument is piano. */}
          {(() => {
            const isPiano = instrument === 'piano';
            const lyricsOnly = viewMode === 'lyrics-only';
            const inlineOn = !lyricsOnly && !chordBarVisible && inlineDiagrams && !isPiano;
            const chordBarOn = !lyricsOnly && chordBarVisible && !inlineOn;
            const activateLyricsOnly = () => {
              if (lyricsOnly) { setViewMode('chords'); return; }
              setViewMode('lyrics-only');
              if (chordBarVisible) setChordBarVisible(false);
              if (inlineDiagrams) void updateSetting(db, 'inlineChordDiagrams', false);
            };
            const activateChordBar = () => {
              if (chordBarOn) { setChordBarVisible(false); return; }
              if (lyricsOnly) setViewMode('chords');
              if (inlineDiagrams) void updateSetting(db, 'inlineChordDiagrams', false);
              setChordBarVisible(true);
            };
            const activateInline = () => {
              if (isPiano) return;
              if (inlineOn) { void updateSetting(db, 'inlineChordDiagrams', false); return; }
              if (lyricsOnly) setViewMode('chords');
              if (chordBarVisible) setChordBarVisible(false);
              if (!inlineDiagrams) void updateSetting(db, 'inlineChordDiagrams', true);
            };
            const btnStyle = (active: boolean, faded: boolean) => ({
              background: active ? 'var(--accent)' : 'var(--surface-elevated)',
              color: active ? 'white' : 'var(--text-muted)',
              opacity: faded ? 0.4 : 1,
              cursor: faded ? 'not-allowed' : 'pointer',
            });
            return (
              <>
                <button
                  onClick={activateLyricsOnly}
                  className="p-1.5 rounded-md"
                  style={btnStyle(lyricsOnly, false)}
                  title={lyricsOnly ? 'Show chord names' : 'Show lyrics only'}
                >
                  <FileText size={14} />
                </button>
                <button
                  onClick={activateChordBar}
                  className="p-1.5 rounded-md"
                  style={btnStyle(chordBarOn, false)}
                  title={chordBarOn ? 'Hide chord diagrams bar' : 'Show chord diagrams bar'}
                >
                  <Guitar size={14} />
                </button>
                <button
                  onClick={activateInline}
                  disabled={isPiano}
                  className="p-1.5 rounded-md"
                  style={btnStyle(inlineOn, isPiano)}
                  title={isPiano
                    ? 'Inline diagrams are unavailable for piano'
                    : (inlineOn ? 'Hide inline chord diagrams' : 'Show inline chord diagrams')}
                >
                  <LayoutGrid size={14} />
                </button>
              </>
            );
          })()}
        </div>

        {/* Audio source + Cast — live-performance one-tap actions. */}
        {activeSong && !isNoteActive && (
          <PlayLinkButton title={activeSong.title} link={activeSong.link} audioFile={activeSong.audioFile} size="md" />
        )}

        {/* Favorite toggle — lives in the main bar (not the menu)
            because performers like the one-tap save-to-favorites
            gesture during a set. */}
        {activeSong && !isNoteActive && (
          <button
            onClick={() => void toggleFavorite(db, activeSong.id)}
            className="p-2 rounded-lg hover:bg-[var(--surface-elevated)] transition-colors"
            title={activeSong.favorite ? 'Remove from favorites' : 'Add to favorites'}
            aria-label={activeSong.favorite ? 'Remove from favorites' : 'Add to favorites'}
          >
            <Star
              size={16}
              fill={activeSong.favorite ? 'currentColor' : 'none'}
              style={{ color: activeSong.favorite ? 'var(--accent)' : 'var(--text-secondary)' }}
            />
          </button>
        )}

        {/* Three-dots "more" menu — same pattern as SongViewPage. The
            style preset, song-notes toggle, cast, and edit-song actions
            live here so the live toolbar stays minimal. Portaled to
            <body> so the toolbar's overflow doesn't clip the dropdown. */}
        {activeSong && !isNoteActive && (
          <>
            <button
              ref={moreMenuTriggerRef}
              onClick={() => setMoreMenuOpen((v) => !v)}
              className="p-2 rounded-lg hover:bg-[var(--surface-elevated)] transition-colors"
              style={{ background: moreMenuOpen ? 'var(--surface-elevated)' : undefined }}
              title="More options"
              aria-label="More options"
              aria-expanded={moreMenuOpen}
            >
              <MoreVertical size={16} style={{ color: 'var(--text-secondary)' }} />
            </button>
            {moreMenuOpen && moreMenuPos && createPortal(
              (
                <div
                  ref={moreMenuRef}
                  className="rounded-lg shadow-2xl py-1"
                  style={{
                    position: 'fixed',
                    top: moreMenuPos.top,
                    right: moreMenuPos.right,
                    background: 'var(--surface)',
                    border: '1px solid var(--border)',
                    minWidth: 220,
                    zIndex: 1000,
                  }}
                >
                  {/* Style preset selector — mirrors SongViewPage's
                      menu entry; lets performers swap presets on the
                      fly during a set without leaving Perform mode. */}
                  <div className="px-3 py-2">
                    <label className="block text-[10px] uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)', letterSpacing: '0.08em' }}>
                      Style preset
                    </label>
                    <select
                      value={svs.preset}
                      onChange={(e) => {
                        const key = e.target.value;
                        const builtin = SONG_STYLE_PRESETS[key];
                        if (builtin) { void updateSetting(db, 'songViewStyle', { ...builtin.style }); return; }
                        const custom = customPresets[key];
                        if (custom) { void updateSetting(db, 'songViewStyle', { ...custom.style }); return; }
                      }}
                      className="w-full text-xs rounded px-2 py-1.5"
                      style={{ background: 'var(--surface-elevated)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
                    >
                      <optgroup label={effectiveTheme === 'dark' ? 'Dark' : 'Light'}>
                        {Object.entries(SONG_STYLE_PRESETS).filter(([, p]) => p.mode === effectiveTheme).map(([k, p]) => (
                          <option key={k} value={k}>{p.name}</option>
                        ))}
                      </optgroup>
                      {Object.entries(customPresets).filter(([, p]) => p.mode === effectiveTheme).length > 0 && (
                        <optgroup label="My Presets">
                          {Object.entries(customPresets).filter(([, p]) => p.mode === effectiveTheme).map(([k, p]) => (
                            <option key={k} value={k}>{p.name}</option>
                          ))}
                        </optgroup>
                      )}
                      {svs.preset === 'custom' && <option value="custom">Custom</option>}
                    </select>
                  </div>

                  <div className="my-1 border-t" style={{ borderColor: 'var(--border)' }} />

                  <PerfMenuItem
                    icon={<ListMusic size={14} style={{ color: 'var(--text-secondary)' }} />}
                    label="Add to set list"
                    onClick={() => { setShowSetListPicker(true); setMoreMenuOpen(false); }}
                  />
                  <PerfMenuItem
                    icon={<Download size={14} style={{ color: 'var(--text-secondary)' }} />}
                    label="Export song"
                    onClick={() => { setShowExport(true); setMoreMenuOpen(false); }}
                  />
                  {(() => {
                    // Always show the row; disable when the active
                    // song has no notes. Keeps the menu shape stable
                    // as the user navigates a set list across songs
                    // with / without notes.
                    const hasNotes = !!activeSong.notes && activeSong.notes.trim().length > 0;
                    return (
                      <PerfMenuItem
                        icon={<StickyNote size={14} style={{ color: hasNotes ? 'var(--accent)' : 'var(--text-muted)' }} />}
                        label={showSongNotes && hasNotes ? 'Hide song notes' : 'Show song notes'}
                        disabled={!hasNotes}
                        disabledTitle="This song has no notes"
                        onClick={() => { setShowSongNotes((v) => !v); setMoreMenuOpen(false); }}
                      />
                    );
                  })()}

                  {/* Cast — same icon-row treatment as SongViewPage's
                      menu. CastQuickButton's popover portals to body
                      and is excluded from the menu's outside-click
                      handler via the data-cast-popover marker. */}
                  <div
                    className="perform-cast-row flex items-center gap-2.5 px-3 py-2 text-xs hover:bg-[var(--surface-elevated)] transition-colors cursor-pointer"
                    onClick={(e) => {
                      const target = e.target as HTMLElement;
                      if (target.closest('button[title="Cast"]')) return;
                      const btn = e.currentTarget.querySelector('button[title="Cast"]') as HTMLButtonElement | null;
                      btn?.click();
                    }}
                  >
                    <span className="shrink-0 flex items-center justify-center" style={{ width: 16 }}>
                      <CastQuickButton />
                    </span>
                    <span className="flex-1" style={{ color: 'var(--text-primary)' }}>
                      Cast to receiver
                    </span>
                  </div>
                  <style>{`
                    .perform-cast-row button[title="Cast"] {
                      padding: 0 !important;
                      border-radius: 0 !important;
                      background: transparent !important;
                    }
                  `}</style>

                  <PerfMenuItem
                    icon={<Edit2 size={14} style={{ color: 'var(--text-secondary)' }} />}
                    label="Edit song"
                    onClick={() => { setMoreMenuOpen(false); navigate(`/song/${activeSong.id}/edit`); }}
                  />
                </div>
              ),
              document.body,
            )}
          </>
        )}

        {/* Next-item hint + indicator dots — stacked so dots sit below. */}
        <div className="ml-auto flex flex-col items-start gap-1">
          {(() => {
            const nextItem = items[activeIndex + 1];
            if (!nextItem) {
              const raw = 'Last song — end of set list';
              return (
                <span
                  className="text-xs italic"
                  style={{ color: 'var(--text-muted)', textTransform: svs.titleUppercase ? 'uppercase' : undefined }}
                >
                  {svs.titleUppercase ? raw : toTitleCase(raw)}
                </span>
              );
            }
            const label = nextItem.type === 'note'
              ? (nextItem.noteTitle?.trim() || 'Note')
              : (nextItem.song ? (svs.titleUppercase ? nextItem.song.title : toTitleCase(nextItem.song.title)) : '');
            return (
              <span
                className="text-xs truncate max-w-xs"
                style={{ color: 'var(--text-muted)', textTransform: svs.titleUppercase ? 'uppercase' : undefined }}
              >
                Next: <strong style={{ color: 'var(--text-secondary)' }}>{label}</strong>
              </span>
            );
          })()}
          <div className="flex gap-1 items-center">
            {items.map((it, i) => {
              const active = i === activeIndex;
              const isNote = it.type === 'note';
              const tip = isNote
                ? (it.noteTitle?.trim() || 'Note')
                : (it.song?.title ?? 'Song');
              if (isNote) {
                return (
                  <button
                    key={it.id}
                    onClick={() => setActiveIndex(i)}
                    className="w-2 h-2 transition-colors"
                    style={{
                      background: active ? 'var(--accent)' : 'transparent',
                      border: `1px solid ${active ? 'var(--accent)' : 'var(--text-muted)'}`,
                      borderRadius: 2,
                    }}
                    title={tip}
                  />
                );
              }
              return (
                <button
                  key={it.id}
                  onClick={() => setActiveIndex(i)}
                  className="w-2 h-2 rounded-full transition-colors"
                  style={{ background: active ? 'var(--accent)' : 'var(--border)' }}
                  title={tip}
                />
              );
            })}
          </div>
        </div>
      </div>

      {/* Chord bar — top */}
      {chordBarVisible && chordBarPosition === 'top' && displayedSong && !isNoteActive && (
        <ChordDiagramBar song={displayedSong} position="top" chordVariations={effectiveChordVariations} onChordClick={(chord) => setSelectedChord(chord)} />
      )}

      {/* Main content + optional right-side chord bar */}
      <div className="flex-1 flex min-h-0" style={{ flexDirection: chordBarVisible && chordBarPosition === 'right' ? 'row' : 'column' }}>
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-16 py-10" {...swipe}>
          {isNoteActive ? (
            <div
              key={currentItem!.id}
              className={navDirection === 'next' ? 'song-slide-next' : 'song-slide-prev'}
              style={{ zoom: perfZoom, maxWidth: '80ch', marginLeft: 'auto', marginRight: 'auto' }}
            >
              {currentItem!.noteTitle?.trim() && (
                <h2
                  className="font-bold mb-6"
                  style={{
                    color: svs.title.color || 'var(--accent)',
                    fontSize: svs.title.fontSize || undefined,
                    fontFamily: svs.fontFamily || undefined,
                    textTransform: svs.titleUppercase ? 'uppercase' : undefined,
                    textAlign: 'center',
                  }}
                >
                  {currentItem!.noteTitle}
                </h2>
              )}
              <div
                className="whitespace-pre-wrap"
                style={{
                  color: svs.lyrics.color || 'var(--text-primary)',
                  fontSize: (svs.lyrics.fontSize || fontSize + 2) + 2,
                  fontFamily: svs.fontFamily || undefined,
                  lineHeight: 1.7,
                }}
              >
                {currentItem!.noteBody ?? ''}
              </div>
            </div>
          ) : (
            <div
              key={activeSong?.id}
              className={navDirection === 'next' ? 'song-slide-next' : 'song-slide-prev'}
              style={{
                zoom: perfZoom,
                ...(songCentered ? { width: 'fit-content', maxWidth: '100%', marginLeft: 'auto', marginRight: 'auto' } : {}),
              } as React.CSSProperties}
            >
              {activeSong && (
                <div className="mb-8" style={songCentered ? { textAlign: 'center' } : undefined}>
                  <h2
                    className="font-bold"
                    style={{
                      color: svs.title.color || 'var(--text-primary)',
                      fontSize: svs.title.fontSize || undefined,
                      fontFamily: svs.fontFamily || undefined,
                      textTransform: svs.titleUppercase ? 'uppercase' : undefined,
                    }}
                  >
                    {svs.titleUppercase ? activeSong.title : toTitleCase(activeSong.title)}
                  </h2>
                  {activeSong.artist && (
                    <p
                      className="mt-1"
                      style={{
                        color: svs.details.color || 'var(--text-secondary)',
                        fontSize: svs.details.fontSize || undefined,
                        fontFamily: svs.fontFamily || undefined,
                      }}
                    >
                      {toTitleCase(activeSong.artist)}
                    </p>
                  )}
                  <SongDetails centered={songCentered} />
                </div>
              )}
              {displayedSong && (
                <SongRenderer song={displayedSong} fontSize={svs.lyrics.fontSize || (fontSize + 2)} viewMode={viewMode} onChordClick={(chord) => setSelectedChord(chord)} chordVariations={effectiveChordVariations} />
              )}
            </div>
          )}
          {!isNoteActive && (
            <BottomSectionSpacer scrollRef={scrollRef} recomputeKey={`${perfZoom}|${viewMode}|${activeSong?.id}`} />
          )}
        </div>
        {chordBarVisible && chordBarPosition === 'right' && displayedSong && !isNoteActive && (
          <ChordDiagramBar song={displayedSong} position="right" chordVariations={effectiveChordVariations} onChordClick={(chord) => setSelectedChord(chord)} />
        )}
      </div>

      {chordBarVisible && chordBarPosition === 'bottom' && displayedSong && !isNoteActive && (
        <ChordDiagramBar song={displayedSong} position="bottom" chordVariations={effectiveChordVariations} onChordClick={(chord) => setSelectedChord(chord)} />
      )}

      {showSongNotes && activeSong && !isNoteActive && (
        <StickyNotePanel
          title={activeSong.title}
          notes={activeSong.notes ?? ''}
          onClose={() => setShowSongNotes(false)}
          onSave={async (next) => {
            await updateSongInStore(db, activeSong.id, { notes: next });
            // `updateSong` persists + refreshes the SONG store, but the
            // perform view reads `activeSong` from the PLAYER store, which
            // it doesn't touch — so the panel kept showing the old note.
            // Mirror the new notes onto the player store's activeSong so the
            // change is reflected live.
            const cur = usePlayerStore.getState().activeSong;
            if (cur && cur.id === activeSong.id) {
              usePlayerStore.setState({ activeSong: { ...cur, notes: next } });
            }
          }}
        />
      )}

      {/* Floating "back to top" button — bottom-right of the perform view,
          only when the user has scrolled to the bottom. */}
      {atBottom && (
        <button
          onClick={() => scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' })}
          className="fixed bottom-6 right-6 p-3 rounded-full shadow-lg transition-colors"
          style={{ background: 'var(--accent)', color: 'white', zIndex: 60 }}
          title="Back to top"
          aria-label="Back to top"
        >
          <ArrowUp size={18} />
        </button>
      )}

      {displayedSong && !isNoteActive && (
        <SectionNavigator
          song={displayedSong}
          scrollRef={scrollRef}
          recomputeKey={`${perfZoom}|${viewMode}|${activeSong?.id}`}
        />
      )}

      {/* Chord diagram modal — opens when a chord in the song body or
          the diagram bar is clicked, same as the standard song view. */}
      {selectedChord && (
        <ChordModal
          chord={selectedChord}
          onClose={() => setSelectedChord(null)}
          songId={activeSong?.id}
          songPrefs={activeSong?.preferences}
          onKeepFullscreen={keepFullscreenAfterModal}
        />
      )}

      {/* Export modal — opens from the three-dots menu. */}
      {showExport && activeSong && (
        <SongExportModal songs={[activeSong]} onClose={() => setShowExport(false)} />
      )}

      {/* Set-list picker — opens from the three-dots menu. */}
      {showSetListPicker && activeSong && (
        <SetListPickerModal
          initialSelected={[]}
          hint={`"${toTitleCase(activeSong.title)}" will be added to the chosen set list.`}
          onClose={() => setShowSetListPicker(false)}
          onConfirm={async (ids) => {
            for (const slId of ids) {
              await addSongToSetList(db, slId, activeSong.id);
            }
            setShowSetListPicker(false);
          }}
        />
      )}
    </div>
  );
}

/** Row inside PerformPage's three-dots menu — leading icon + label.
 *  Mirrors the MoreMenuItem in SongViewPage so the two surfaces feel
 *  consistent. */
function PerfMenuItem({ icon, label, onClick, disabled, disabledTitle }: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  disabledTitle?: string;
}): React.ReactElement {
  return (
    <button
      onClick={() => { if (!disabled) onClick(); }}
      disabled={disabled}
      title={disabled ? disabledTitle : undefined}
      className="w-full flex items-center gap-2.5 px-3 py-2 text-left text-xs transition-colors"
      style={{
        color: disabled ? 'var(--text-muted)' : 'var(--text-primary)',
        opacity: disabled ? 0.5 : 1,
        cursor: disabled ? 'not-allowed' : 'pointer',
      }}
      onMouseEnter={(e) => { if (!disabled) e.currentTarget.style.background = 'var(--surface-elevated)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
    >
      <span className="shrink-0 flex items-center justify-center" style={{ width: 16 }}>{icon}</span>
      <span className="flex-1 truncate">{label}</span>
    </button>
  );
}
