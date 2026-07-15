import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { X, ChevronLeft, ChevronRight, ChevronUp, ChevronDown, Guitar, LayoutGrid, FileText, StickyNote, ArrowUp, Edit2, Star, ListMusic, Download, Highlighter } from 'lucide-react';
import { SONG_STYLE_PRESETS, usePlayerStore, useSettingsStore, useSongStore, useSetListStore, annotationModeFromToggles } from '@song-chords/shared';
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
import AnnotationLayer from '../annotation/AnnotationLayer';
import AnnotationEditingRoot from '../annotation/AnnotationEditingRoot';
import AnnotationSetPicker from '../annotation/AnnotationSetPicker';
import { useAnnotationEditStore } from '../annotation/annotation-store';
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
    /** Per-entry preference overrides. Fall through to the song's
     *  own preference (or the app's global setting) when unset —
     *  same rule as SongViewPage's setlist-context load path. */
    viewMode?: 'chords' | 'lyrics-only' | 'chords-only';
    autoScrollMode?: 'duration' | 'speed';
    tempoMultiplier?: 0.5 | 1 | 2;
    chordBarVisible?: boolean;
    inlineChordDiagrams?: boolean;
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
  /** Persist per-entry override changes for a specific song item. Any
   *  subset of the entry's setlist-scoped settings may be passed —
   *  transpose, capo, tempo multiplier, chord-bar visibility, or
   *  inline-chord-diagrams. Called on every distinct change; caller
   *  debounces / deduplicates if needed. */
  onOverridesChange?: (
    itemId: string,
    overrides: Partial<{
      transpose: number;
      capo: number;
      tempoMultiplier: 0.5 | 1 | 2;
      chordBarVisible: boolean;
      inlineChordDiagrams: boolean;
    }>,
  ) => void;
  /** Rendered instead of the normal UI when `items` is empty. */
  emptyState?: React.ReactNode;
  /** Destination for the top-left close (X) button and the Escape key. When
   *  provided, exiting the perform view routes to this URL directly instead
   *  of walking browser history back — so Edit → Perform → close always
   *  lands on the same place regardless of how the user arrived. When
   *  omitted, falls back to `navigate(-1)` (browser back). */
  exitTo?: string;
}

export default function PerformPage({ title, icon, items, onOverridesChange, emptyState, exitTo }: PerformPageProps): React.ReactElement {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const updateSongInStore = useSongStore((s) => s.updateSong);

  const loadSong = usePlayerStore((s) => s.loadSong);
  const displayedSong = usePlayerStore((s) => s.displayedSong);
  const activeSong = usePlayerStore((s) => s.activeSong);
  const fontSize = usePlayerStore((s) => s.fontSize);
  const viewMode = usePlayerStore((s) => s.viewMode);
  const setViewMode = usePlayerStore((s) => s.setViewMode);

  const svs = useSettingsStore((s) => s.settings.songViewStyle);
  const songCentered = useSettingsStore((s) => s.settings.songCentered ?? false);
  const perfZoom = useSettingsStore((s) => s.settings.perfZoom ?? 1);
  const chordBarPosition = useSettingsStore((s) => s.settings.chordBarPosition ?? 'top');
  const globalInlineDiagrams = useSettingsStore((s) => s.settings.inlineChordDiagrams ?? false);
  const instrument = useSettingsStore((s) => s.settings.defaultInstrument);
  // Merged chord-variation map (per-song overrides win over the global
  // default for this instrument). See useEffectiveChordVariations.
  const effectiveChordVariations = useEffectiveChordVariations(instrument);
  const showChordDiagrams = useSettingsStore((s) => s.settings.showChordDiagrams ?? true);
  const updateSetting = useSettingsStore((s) => s.updateSetting);

  const scrollRef = useRef<HTMLDivElement>(null);
  useAutoScroll(scrollRef as React.RefObject<HTMLElement>);

  // Initial index comes from the URL's `?item=<n>` query param so a fresh
  // mount (e.g. returning here after Edit) lands on the same song the user
  // was on. Falls back to 0 when the param is absent or invalid. Clamped
  // against `items.length` in the effect below.
  const [activeIndex, setActiveIndex] = useState(() => {
    const raw = searchParams.get('item');
    const n = raw ? parseInt(raw, 10) : 0;
    return Number.isFinite(n) && n >= 0 ? n : 0;
  });
  // Clamp in case the items list shrinks.
  useEffect(() => {
    if (activeIndex > items.length - 1) setActiveIndex(Math.max(0, items.length - 1));
  }, [items.length, activeIndex]);
  // Keep the `?item=<n>` param in sync with activeIndex so the current
  // position survives navigation away and back (e.g. via the Edit button's
  // `?return=<url>`). Uses `replace: true` so paging through songs doesn't
  // pollute browser history.
  useEffect(() => {
    const raw = searchParams.get('item');
    const current = raw ? parseInt(raw, 10) : 0;
    if (current === activeIndex) return;
    const next = new URLSearchParams(searchParams);
    if (activeIndex === 0) next.delete('item');
    else next.set('item', String(activeIndex));
    setSearchParams(next, { replace: true });
  }, [activeIndex, searchParams, setSearchParams]);

  const total = items.length;
  const currentItem = items[activeIndex];
  const isNoteActive = currentItem?.type === 'note';

  // Current item's per-entry overrides — resolved once per render so the
  // three setlist-scoped settings (time feel / chord bar / inline
  // diagrams) can be read off it consistently. Populated by the setlist
  // player page (see PerformItem.overrides).
  const currentOverrides = currentItem?.overrides;
  // Effective values: entry override wins, otherwise fall through to the
  // app-wide setting or local component state (out-of-setlist context).
  const inlineDiagrams = currentOverrides?.inlineChordDiagrams ?? globalInlineDiagrams;

  // Half/double-time applies only to the metronome, not the stored song
  // tempo. In setlist context the entry's saved multiplier wins on load
  // and any change persists to the entry; otherwise reset to 1× when
  // the user navigates to a different song.
  const [tempoMultiplierLocal, setTempoMultiplierLocal] = useState<0.5 | 1 | 2>(1);
  const tempoMultiplier: 0.5 | 1 | 2 = currentOverrides?.tempoMultiplier ?? tempoMultiplierLocal;
  const setTempoMultiplier = (next: 0.5 | 1 | 2) => {
    if (onOverridesChange && currentOverrides !== undefined && currentItem) {
      // Reuse the same callback that persists transpose / capo — the
      // parent (SetListPlayerPage) routes it to the entry.
      onOverridesChange(currentItem.id, { tempoMultiplier: next });
    }
    setTempoMultiplierLocal(next);
  };
  useEffect(() => { setTempoMultiplierLocal(1); }, [activeSong?.id]);
  const baseTempo = activeSong?.tempo ?? 120;
  const metronome = useMetronome(Math.round(baseTempo * tempoMultiplier), activeSong?.timeSig ?? '4/4');

  // Chord-bar visibility. Entry override wins in setlist context.
  const [chordBarVisibleLocal, setChordBarVisibleLocal] = useState(showChordDiagrams);
  const chordBarVisible = currentOverrides?.chordBarVisible ?? chordBarVisibleLocal;
  const setChordBarVisible: React.Dispatch<React.SetStateAction<boolean>> = (next) => {
    const resolved = typeof next === 'function'
      ? (next as (prev: boolean) => boolean)(chordBarVisible)
      : next;
    if (onOverridesChange && currentOverrides !== undefined && currentItem) {
      onOverridesChange(currentItem.id, { chordBarVisible: resolved });
    }
    setChordBarVisibleLocal(resolved);
  };
  useEffect(() => { setChordBarVisibleLocal(showChordDiagrams); }, [showChordDiagrams]);

  /** Toggle inline chord diagrams. Routes to the entry when in setlist
   *  context (so this setlist can differ from the global default);
   *  otherwise flips the app-wide setting. */
  const setInlineDiagrams = (next: boolean) => {
    if (onOverridesChange && currentOverrides !== undefined && currentItem) {
      onOverridesChange(currentItem.id, { inlineChordDiagrams: next });
      return;
    }
    void updateSetting(db, 'inlineChordDiagrams', next);
  };
  useEffect(() => {
    if (viewMode === 'lyrics-only') {
      if (chordBarVisible) setChordBarVisible(false);
      if (inlineDiagrams) setInlineDiagrams(false);
    }
  }, [viewMode]);

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
  // Disable swipe while the annotation drawing panel is open —
  // otherwise a horizontal drag to draw a line/arrow triggers a
  // next-/prev-song navigation.
  const swipeEnabled = !useAnnotationEditStore((s) => s.editing);
  const swipe = useSwipeNavigation({ onNext: goNext, onPrev: goPrev, enabled: swipeEnabled });

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

  // Annotation toggles — same as SongViewPage: visibility persisted via
  // the global `showAnnotations` setting so it survives across songs
  // and sessions; editing mode is session-scoped in the annotation-edit
  // store and shared with the toolbar + draw surface.
  const showAnnotations = useSettingsStore((s) => s.settings.showAnnotations ?? true);
  const setShowAnnotations = (v: boolean) => { void updateSetting(db, 'showAnnotations', v); };
  const annotationEditing = useAnnotationEditStore((s) => s.editing);
  const selectedSetIds = useAnnotationEditStore((s) => s.selectedSetIds);
  const setAnnotationEditing = useAnnotationEditStore((s) => s.setEditing);
  // The four-way annotation mode is derived from the three top-toolbar
  // toggle booleans. Sets are tagged with whichever mode was active
  // at save time and only render when that same mode is active again.
  const annotationMode = annotationModeFromToggles({
    lyricsOnly: viewMode === 'lyrics-only',
    chordBarVisible,
    inlineDiagrams,
  });

  const [showExport, setShowExport] = useState(false);
  const [showSetListPicker, setShowSetListPicker] = useState(false);
  // Chord clicked in the song body / diagram bar — opens the shared
  // chord diagram modal (same as the standard song view).
  const [selectedChord, setSelectedChord] = useState<string | null>(null);

  // Collapse the whole perform toolbar to give the song content more
  // vertical room. When hidden, a slim "show toolbar" tab replaces it so
  // the controls are always one click away. Mirrors the SongViewPage
  // toolbar toggle 1:1 so the two surfaces behave the same.
  const [toolbarHidden, setToolbarHidden] = useState(false);
  // Toolbar visibility is INDEPENDENT of auto-scroll. The dedicated
  // `toggleToolbar` shortcut (default `T`), the collapse chevron in the
  // bar, and the "Show toolbar" tab are the only three things that ever
  // move `toolbarHidden`. Pressing Space to start auto-scroll used to
  // also hide the toolbar as a side effect, which surprised users — the
  // two features are now fully decoupled.

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

  // Shortcut handlers — transpose/capo mutate the player store, which in
  // turn fires the overrides-changed subscription to persist them onto the
  // setlist / favorite entry. Zoom adjusts the global perfZoom setting.
  useKeyboardShortcuts({
    toggleInlineDiagrams: () => {
      // Piano can't render inline; ignore the shortcut so the setting
      // doesn't silently flip on with no visible effect.
      if (instrument === 'piano') return;
      setInlineDiagrams(!inlineDiagrams);
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
    toggleToolbar:        () => setToolbarHidden((v) => !v),
    nextSong:             () => goNext(),
    prevSong:             () => goPrev(),
    zoomIn:               () => void updateSetting(db, 'perfZoom', Math.min((perfZoom ?? 1) + 0.1, 3)),
    zoomOut:              () => void updateSetting(db, 'perfZoom', Math.max((perfZoom ?? 1) - 0.1, 0.5)),
    zoomReset:            () => void updateSetting(db, 'perfZoom', 1),
    onCapo:               (fret) => usePlayerStore.getState().setCapo(fret),
  });
  // Auto-open the sticky note only when the SONG genuinely CHANGES (i.e.
  // the user navigated to a different entry in the set list). Once the
  // user has manually toggled the panel for the current song, nothing in
  // this component may override that choice until they navigate away.
  //
  // Implementation: track the last id we auto-opened for in a ref. The
  // effect runs on every render but ONLY calls setShowSongNotes when the
  // id it sees differs from the last one it acted on. That means:
  //   - Manual toggle click → deps unchanged, id unchanged → effect body
  //     runs but early-returns, so `showSongNotes` is untouched.
  //   - Song navigation → id differs from lastId → effect updates state.
  // The earlier `useEffect(..., [dep])` approach was fragile because any
  // spurious dep churn (a `null → same-value` blip during a store update,
  // or a ref-identity change bubbling through Zustand) could re-run the
  // effect and clobber the manual toggle.
  const lastAutoOpenedIdRef = useRef<string | null>(null);
  useEffect(() => {
    const isSong = currentItem?.type === 'song';
    const id = isSong ? (activeSong?.id ?? null) : (currentItem?.id ?? null);
    if (lastAutoOpenedIdRef.current === id) return;
    lastAutoOpenedIdRef.current = id;
    setShowSongNotes(isSong && !!activeSong?.notes && activeSong.notes.trim().length > 0);
  });

  // Load the current song (merging its overrides) when the index changes.
  useEffect(() => {
    if (!currentItem || currentItem.type !== 'song' || !currentItem.song) return;
    const s = currentItem.song;
    const o = currentItem.overrides;
    const songPrefs = s.preferences ?? {};
    const merged = o ? {
      ...s,
      key: o.key ?? s.key,
      tempo: o.tempo ?? s.tempo,
      timeSig: o.timeSig ?? s.timeSig,
      capo: o.capo,
      preferences: {
        ...songPrefs,
        transposeSteps: o.transpose,
        // Per-entry preferences overlay the song's when set; otherwise
        // fall through so existing entries keep inheriting the song's
        // choice until the user changes them in setlist context.
        viewMode: o.viewMode ?? songPrefs.viewMode,
        autoScrollMode: o.autoScrollMode ?? songPrefs.autoScrollMode,
      },
    } : s;
    loadSong(merged);
  }, [currentItem?.id, currentItem?.overrides?.transpose, currentItem?.overrides?.capo, currentItem?.overrides?.viewMode, currentItem?.overrides?.autoScrollMode]);

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
  // Exit the perform view. Callers can pin the destination via `exitTo` so
  // that history side-effects (like a round-trip through the Edit page)
  // don't send the user somewhere unexpected. Without it, walk history.
  const exitPerform = useCallback(() => {
    if (exitTo) navigate(exitTo);
    else navigate(-1);
  }, [navigate, exitTo]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      const editable = (e.target as HTMLElement | null)?.isContentEditable;
      const inInput = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || !!editable;
      if (inInput) return;
      if (e.key === 'Escape') exitPerform();
      if (e.key === 'PageDown') goNext();
      if (e.key === 'PageUp')   goPrev();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [exitPerform, goNext, goPrev]);

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
        <button onClick={exitPerform} className="px-4 py-2 rounded-lg" style={{ background: 'var(--surface-elevated)', color: 'var(--text-primary)' }}>Back</button>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 flex flex-col" style={{ background: 'var(--bg)', zIndex: 100 }}>
      {/* Slim strip to bring the toolbar back when it's hidden.
          Rendered ONLY when the toolbar is hidden — no grid-rows
          collapse animation, no layered pointer-events tricks, no
          overlap with the toolbar's DOM. When present, it's a plain
          22px-tall bar with a centred button as the ONLY click
          target. When absent, nothing in this region is interactive
          — the toolbar row below takes its place. */}
      {toolbarHidden && (
        <div
          className="shrink-0 flex items-center justify-center border-b"
          style={{
            height: 22,
            borderColor: 'var(--border)',
            background: 'var(--bg-secondary)',
          }}
        >
          <button
            onClick={() => setToolbarHidden(false)}
            className="flex items-center justify-center gap-1.5 text-xs rounded-md px-3 py-0.5 hover:bg-[var(--surface-elevated)] transition-colors"
            style={{ color: 'var(--text-muted)', cursor: 'pointer' }}
            title="Show toolbar"
            aria-label="Show toolbar"
          >
            <ChevronDown size={14} />
            <span>Show toolbar</span>
          </button>
        </div>
      )}
      {/* Top bar — mounted only when the toolbar is showing. The
          show-tab above handles the hidden state; conditionally
          rendering both keeps the DOM small and eliminates the layered
          pointer-events / visibility tricks that were previously
          needed to stop the collapsed toolbar's descendants from
          eating clicks intended for the show-tab. */}
      {!toolbarHidden && (
      <div className="shrink-0"><div>
      <div className="flex items-center gap-3 px-4 py-3 border-b flex-wrap" style={{ borderColor: 'var(--border)', background: 'var(--bg-secondary)' }}>
        <button onClick={exitPerform} className="p-2 rounded-lg hover:bg-[var(--surface-elevated)]">
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

        {/* Compact three-dot navigator: ‹ o O o › — previous / current /
            next only. Sits immediately after the "n / total" counter so
            the position indicators (numeric + visual) are grouped, with
            the textual "Next: <title>" preview tucked to the right of
            the dots so both position cues live in one cluster.
            Encoding:
              • SHAPE = item type — circle for songs, square for
                performance notes.
              • COLOUR = item type — accent hue for songs, an amber
                secondary hue for notes, so a glance disambiguates.
              • SIZE = position — the middle dot is enlarged so the
                current item is unmistakable next to prev/next.
            The chevron arrows step through items one at a time. */}
        <div className="flex gap-4 items-center">
          <button
            onClick={goPrev}
            disabled={activeIndex === 0}
            className="rounded-full transition-colors hover:bg-[var(--surface-elevated)] disabled:opacity-25 disabled:cursor-not-allowed disabled:hover:bg-transparent flex items-center justify-center"
            style={{
              width: 22,
              height: 22,
              border: '1px solid var(--border)',
              background: 'transparent',
              color: 'var(--text-secondary)',
            }}
            title="Previous"
            aria-label="Previous item"
          >
            <ChevronLeft size={14} />
          </button>
          <div className="flex gap-2 items-center">
            {[
              { item: items[activeIndex - 1], role: 'prev' as const, idx: activeIndex - 1 },
              { item: items[activeIndex],     role: 'current' as const, idx: activeIndex },
              { item: items[activeIndex + 1], role: 'next' as const, idx: activeIndex + 1 },
            ].map(({ item: it, role, idx }) => {
              // Reserve space even when the slot is empty (start / end of
              // list) so the strip's width doesn't jump as the user
              // navigates. A hidden placeholder keeps the layout stable.
              if (!it) {
                return <span key={role} style={{ width: 12, height: 12 }} aria-hidden="true" />;
              }
              const isCurrent = role === 'current';
              const isNote = it.type === 'note';
              // Hover tooltip — follow the style preset's title case
              // rule so the label matches how song titles appear
              // everywhere else in the app.
              const rawTip = isNote
                ? (it.noteTitle?.trim() || 'Note')
                : (it.song?.title ?? 'Song');
              const tip = svs.titleUppercase ? rawTip.toUpperCase() : toTitleCase(rawTip);
              const activeColor = isNote ? '#f59e0b' : 'var(--accent)';
              const dim = isCurrent ? 12 : 8;
              const commonStyle: React.CSSProperties = {
                width: dim,
                height: dim,
                background: isCurrent ? activeColor : 'transparent',
                borderRadius: isNote ? 3 : 999,
                border: `1.5px solid ${activeColor}`,
                opacity: isCurrent ? 1 : 0.55,
                padding: 0,
                flexShrink: 0,
              };
              return (
                <button
                  key={role}
                  onClick={() => setActiveIndex(idx)}
                  className="transition-all"
                  style={commonStyle}
                  title={tip}
                  aria-current={isCurrent ? 'true' : undefined}
                  aria-label={`${role === 'prev' ? 'Previous' : role === 'next' ? 'Next' : 'Current'}: ${tip}`}
                />
              );
            })}
          </div>
          <button
            onClick={goNext}
            disabled={activeIndex >= total - 1}
            className="rounded-full transition-colors hover:bg-[var(--surface-elevated)] disabled:opacity-25 disabled:cursor-not-allowed disabled:hover:bg-transparent flex items-center justify-center"
            style={{
              width: 22,
              height: 22,
              border: '1px solid var(--border)',
              background: 'transparent',
              color: 'var(--text-secondary)',
            }}
            title="Next"
            aria-label="Next item"
          >
            <ChevronRight size={14} />
          </button>

          {/* Textual next-item hint — same cluster as the dots so both
              cues live together, right of the arrows. */}
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
              if (inlineDiagrams) setInlineDiagrams(false);
            };
            const activateChordBar = () => {
              if (chordBarOn) { setChordBarVisible(false); return; }
              if (lyricsOnly) setViewMode('chords');
              if (inlineDiagrams) setInlineDiagrams(false);
              setChordBarVisible(true);
            };
            const activateInline = () => {
              if (isPiano) return;
              if (inlineOn) { setInlineDiagrams(false); return; }
              if (lyricsOnly) setViewMode('chords');
              if (chordBarVisible) setChordBarVisible(false);
              if (!inlineDiagrams) setInlineDiagrams(true);
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

        {/* ── Actions formerly hidden in the three-dots menu, now inline
             icon buttons on the main bar. Each button is a direct sibling
             of the toolbar's flex-wrap row so they overflow onto a second
             line naturally when horizontal space runs out. Only the Style
             preset stays as a compact <select> (a preset list can't be
             icon-only). ── */}

        {/* Add to set list */}
        {activeSong && !isNoteActive && (
          <button
            onClick={() => setShowSetListPicker(true)}
            className="p-2 rounded-lg hover:bg-[var(--surface-elevated)] transition-colors"
            title="Add to set list"
            aria-label="Add to set list"
          >
            <ListMusic size={16} style={{ color: 'var(--text-secondary)' }} />
          </button>
        )}

        {/* Export song */}
        {activeSong && !isNoteActive && (
          <button
            onClick={() => setShowExport(true)}
            className="p-2 rounded-lg hover:bg-[var(--surface-elevated)] transition-colors"
            title="Export song"
            aria-label="Export song"
          >
            <Download size={16} style={{ color: 'var(--text-secondary)' }} />
          </button>
        )}

        {/* Song notes toggle — disabled when the active song has no notes.
             Kept rendered (rather than hidden) so the bar shape stays
             stable as the user pages through a set list. */}
        {activeSong && !isNoteActive && (() => {
          const hasNotes = !!activeSong.notes && activeSong.notes.trim().length > 0;
          return (
            <button
              onClick={() => { if (hasNotes) setShowSongNotes((v) => !v); }}
              disabled={!hasNotes}
              className="p-2 rounded-lg hover:bg-[var(--surface-elevated)] transition-colors"
              style={{ opacity: hasNotes ? 1 : 0.4, cursor: hasNotes ? 'pointer' : 'not-allowed' }}
              title={hasNotes ? (showSongNotes ? 'Hide song notes' : 'Show song notes') : 'This song has no notes'}
              aria-label="Toggle song notes"
            >
              <StickyNote size={16} style={{ color: hasNotes && showSongNotes ? 'var(--accent)' : 'var(--text-secondary)' }} />
            </button>
          );
        })()}

        {/* Annotation editing + set-picker. Skipped on note items
             where there's no song to draw on. Visibility toggle
             (was an eye icon here) is now folded into the Annotations
             list dropdown ("Off" entry). */}
        {activeSong && !isNoteActive && (() => {
          return (
            <>
              <button
                onClick={() => setAnnotationEditing(!annotationEditing)}
                className="p-2 rounded-lg hover:bg-[var(--surface-elevated)] transition-colors"
                title={annotationEditing ? 'Close annotation tools' : 'Annotate this song'}
                aria-label="Annotate"
                aria-pressed={annotationEditing}
              >
                <Highlighter size={16} style={{ color: annotationEditing ? 'var(--accent)' : 'var(--text-secondary)' }} />
              </button>
              {activeSong && (
                <AnnotationSetPicker
                  songId={activeSong.id}
                  annotationsJson={activeSong.annotations}
                  viewMode={annotationMode}
                />
              )}
            </>
          );
        })()}

        {/* Cast — reuses the existing CastQuickButton, which already
             renders as its own p-2 icon button (title="Cast"). */}
        {activeSong && !isNoteActive && <CastQuickButton />}

        {/* Edit song — pass the current perform URL (with its `?item=<n>`
             query, kept in sync above) as `?return=<url>` so SongEditPage's
             back-arrow brings the user back to the SAME song in perform
             mode, not to activeIndex 0. */}
        {activeSong && !isNoteActive && (
          <button
            onClick={() => {
              const back = encodeURIComponent(location.pathname + location.search);
              navigate(`/song/${activeSong.id}/edit?return=${back}`);
            }}
            className="p-2 rounded-lg hover:bg-[var(--surface-elevated)] transition-colors"
            title="Edit song"
            aria-label="Edit song"
          >
            <Edit2 size={16} style={{ color: 'var(--text-secondary)' }} />
          </button>
        )}

        {/* Style preset — compact <select>. It's the one non-icon control,
             capped in width so it never eats a whole row on wrap. */}
        {activeSong && !isNoteActive && (
          <select
            value={svs.preset}
            onChange={(e) => {
              const key = e.target.value;
              const builtin = SONG_STYLE_PRESETS[key];
              if (builtin) { void updateSetting(db, 'songViewStyle', { ...builtin.style }); return; }
              const custom = customPresets[key];
              if (custom) { void updateSetting(db, 'songViewStyle', { ...custom.style }); return; }
            }}
            className="text-xs rounded px-1.5 py-1 max-w-[9rem]"
            style={{ background: 'var(--surface-elevated)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
            title="Style preset"
            aria-label="Style preset"
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
        )}

        {/* Collapse the toolbar — sits at the end of the left cluster
            (immediately after the last option) so the affordance is
            grouped with the tools it controls rather than pinned to the
            far right. A slim "Show toolbar" tab takes the bar's place. */}
        <button
          onClick={() => setToolbarHidden(true)}
          className="p-2 rounded-lg hover:bg-[var(--surface-elevated)] transition-colors"
          title="Hide toolbar"
          aria-label="Hide toolbar"
        >
          <ChevronUp size={16} style={{ color: 'var(--text-secondary)' }} />
        </button>

      </div>
       </div>
      </div>
      )}

      {/* Chord bar — top */}
      {chordBarVisible && chordBarPosition === 'top' && displayedSong && !isNoteActive && (
        <ChordDiagramBar song={displayedSong} position="top" chordVariations={effectiveChordVariations} onChordClick={(chord) => setSelectedChord(chord)} />
      )}

      {/* Main content + optional right-side chord bar */}
      <div className="flex-1 flex min-h-0" style={{ flexDirection: chordBarVisible && chordBarPosition === 'right' ? 'row' : 'column' }}>
        <div ref={scrollRef} className="flex-1 overflow-y-auto overflow-x-hidden px-16 py-10 relative" {...swipe}>
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
            // Outer wrapper: applies the zoom + centring. Kept static
            // (no slide-in animation) so its children can be measured
            // against a stable coord frame — the annotation SVG lives
            // here and must not be affected by the slide-in transform
            // that would otherwise drag it across the screen for
            // 260ms every time a song changes.
            <div
              style={{
                position: 'relative',
                zoom: perfZoom,
                ...(songCentered ? { width: 'fit-content', maxWidth: '100%', marginLeft: 'auto', marginRight: 'auto' } : {}),
              } as React.CSSProperties}
            >
              {/* Inner wrapper: applies the slide-in animation ONLY
                  to the song text. `key={activeSong.id}` remounts it
                  on song change so the CSS animation replays. */}
              <div
                key={activeSong?.id}
                className={navDirection === 'next' ? 'song-slide-next' : 'song-slide-prev'}
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
              {/* Annotation overlays sit OUTSIDE the animated inner
                  wrapper so they don't get carried along by the
                  slide-in transform. They still live inside the zoom
                  wrapper so their coordinate frame matches the
                  content's for zoom-correct rendering. */}
              {/* Always mounted so measurement state persists across
                  opening / closing the annotation toolbar. Hidden
                  visually while editing (the draw surface renders its
                  own copy on top). Without this, closing the toolbar
                  triggered a fresh mount which briefly showed no
                  shapes while the initial measurement stabilised,
                  reading to users as "annotations cleared". */}
              {activeSong && (
                <AnnotationLayer
                  annotationsJson={activeSong.annotations}
                  scrollRef={scrollRef as React.RefObject<HTMLElement>}
                  recomputeKey={`perform|${perfZoom}|${viewMode}|${svs.lyrics.fontSize ?? 16}|${chordBarVisible}|${chordBarPosition}|${activeSong.id}`}
                  visible={showAnnotations}
                  suppress={annotationEditing}
                  viewMode={annotationMode}
                  selectedSetId={selectedSetIds[activeSong.id] ?? null}
                />
              )}
              {activeSong && annotationEditing && (
                <AnnotationEditingRoot
                  songId={activeSong.id}
                  annotationsJson={activeSong.annotations}
                  scrollRef={scrollRef as React.RefObject<HTMLElement>}
                  recomputeKey={`perform|${perfZoom}|${viewMode}|${svs.lyrics.fontSize ?? 16}|${chordBarVisible}|${chordBarPosition}|${activeSong.id}`}
                  showCommitted={showAnnotations}
                  viewMode={annotationMode}
                  onCloseToolbar={() => setAnnotationEditing(false)}
                />
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
          // One shared position for every song in perform mode: the
          // first song's note anchors the spot, every later song's
          // note reuses it. If we keyed by song id, each song would
          // measure independently and land in a slightly different
          // place depending on how the DOM had shifted.
          positionKey="perform"
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

      {/* Annotation floating toolbar lives inside AnnotationEditingRoot
          (mounted above) so it shares the doc controller with the draw
          surface. */}

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

