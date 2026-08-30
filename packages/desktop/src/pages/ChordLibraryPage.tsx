import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Settings2 } from 'lucide-react';
import { useSettingsStore, getBuiltinDiagrams, ALL_KEYS, formatChord, isCustomInstrument } from '@song-chords/shared';
import type { ChordDiagram, InstrumentType, CustomInstrument } from '@song-chords/shared';
import ChordDiagramSVG from '../components/chord-diagram/ChordDiagramSVG';
import ChordForm from '../components/chord-diagram/ChordForm';
import CustomInstrumentManager from '../components/chord-diagram/CustomInstrumentManager';
import { db } from '../ipc/ipc-client';
import { useT } from '../i18n';

const ROOT_NOTES = ['All', ...ALL_KEYS.slice(0, 12)];
const BASS_NOTES = ['None', ...ALL_KEYS.slice(0, 12)];
const CHORD_TYPES = [
  'All',
  '', '5', 'sus4', 'sus2', 'add9',
  '6', '6/9',
  'maj7', 'maj9', 'maj7#11', 'maj13',
  'm', 'm(add9)', 'm6', 'mb6', 'm6/9',
  'm7', 'm7b5', 'm(maj7)',
  'm9', 'm9b5', 'm9(maj7)',
  'm11', 'm13',
  '7', '7sus4', '7b5',
  '9', '9sus4', '9b5',
  '7b9', '7#9', '7b5(#9)',
  '11', '7#11',
  '13', '13sus4',
  '+', '+7', '+9', '+7b9', '+7#9',
  '°', '°7',
];
const CHORD_TYPE_LABELS: Record<string, string> = {
  'All': 'All',
  '': '(no suffix)',
  '5': '5', 'sus4': 'sus4', 'sus2': 'sus2', 'add9': 'add9',
  '6': '6', '6/9': '6/9',
  'maj7': 'maj7', 'maj9': 'maj9', 'maj7#11': 'maj7#11', 'maj13': 'maj13',
  'm': 'm', 'm(add9)': 'm(add9)', 'm6': 'm6', 'mb6': 'mb6', 'm6/9': 'm6/9',
  'm7': 'm7', 'm7b5': 'm7b5', 'm(maj7)': 'm(maj7)',
  'm9': 'm9', 'm9b5': 'm9b5', 'm9(maj7)': 'm9(maj7)',
  'm11': 'm11', 'm13': 'm13',
  '7': '7', '7sus4': '7sus4', '7b5': '7b5',
  '9': '9', '9sus4': '9sus4', '9b5': '9b5',
  '7b9': '7b9', '7#9': '7#9', '7b5(#9)': '7b5(#9)',
  '11': '11', '7#11': '7#11',
  '13': '13', '13sus4': '13sus4',
  '+': '+', '+7': '+7', '+9': '+9', '+7b9': '+7b9', '+7#9': '+7#9',
  '°': '°', '°7': '°7',
};
const EMPTY_INSTRUMENTS: Record<string, CustomInstrument> = {};

export default function ChordLibraryPage(): React.ReactElement {
  const t = useT();
  const { settings, updateSetting } = useSettingsStore();
  const customChords = settings.customChords ?? {};
  const customInstruments = settings.customInstruments ?? EMPTY_INSTRUMENTS;
  const customInstrumentList = useMemo(
    () => Object.values(customInstruments).sort((a, b) => a.createdAt - b.createdAt),
    [customInstruments],
  );
  const svs = settings.songViewStyle;

  const [instrument, setInstrument] = useState<InstrumentType>(settings.defaultInstrument);
  const [showInstrumentManager, setShowInstrumentManager] = useState(false);

  // If the selected custom instrument disappears (deleted here, or a
  // chords backup restored without it), fall back to guitar rather
  // than showing an empty page for an instrument that no longer exists.
  useEffect(() => {
    if (isCustomInstrument(instrument) && !customInstruments[instrument]) setInstrument('guitar');
  }, [instrument, customInstruments]);

  // ── Custom instrument CRUD ────────────────────────────────────────
  const saveInstrument = (ci: CustomInstrument) => {
    void updateSetting(db, 'customInstruments', { ...customInstruments, [ci.id]: ci });
  };
  // Deleting an instrument cascades: its chords go, a global default
  // pointing at it is cleared, and any per-chord default voicings
  // recorded for it are dropped. Sequential awaits so each setting
  // write sees the previous one.
  const deleteInstrument = async (id: CustomInstrument['id']) => {
    const nextInstruments = { ...customInstruments };
    delete nextInstruments[id];
    const nextChords: Record<string, ChordDiagram[]> = {};
    for (const [name, list] of Object.entries(customChords)) {
      const kept = list.filter((d) => d.instrument !== id);
      if (kept.length) nextChords[name] = kept;
    }
    await updateSetting(db, 'customInstruments', nextInstruments);
    await updateSetting(db, 'customChords', nextChords);
    if (settings.defaultInstrument === id) await updateSetting(db, 'defaultInstrument', 'guitar');
    const dv = settings.defaultChordVariations;
    if (dv && dv[id]) {
      const nextDv = { ...dv };
      delete nextDv[id];
      await updateSetting(db, 'defaultChordVariations', nextDv);
    }
    if (instrument === id) setInstrument('guitar');
  };
  const [rootFilter, setRootFilter] = useState('All');
  const [typeFilter, setTypeFilter] = useState('All');
  const [bassFilter, setBassFilter] = useState('None');
  const [customOnly, setCustomOnly] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [selectedChord, setSelectedChord] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 20;
  const gridTopRef = useRef<HTMLDivElement>(null);

  // Built-in library for the instrument (empty for custom instruments —
  // their whole library is user-made). Memoised: the enharmonic
  // expansion is not free and this used to run on every render.
  const builtin = useMemo(() => getBuiltinDiagrams(instrument), [instrument]);

  const allChords = useMemo(() => {
    const merged: Record<string, { diagrams: ChordDiagram[]; builtinCount: number }> = {};

    // 1) Hardcoded diagrams
    for (const [name, diagrams] of Object.entries(builtin)) {
      merged[name] = { diagrams: [...diagrams], builtinCount: diagrams.length };
    }

    // 2) Custom user diagrams (filtered to the active instrument so a
    //    user-saved piano chord doesn't render in the guitar library).
    for (const [name, diagrams] of Object.entries(customChords)) {
      const matched = diagrams.filter((d) => d.instrument === instrument);
      if (matched.length === 0) continue;
      if (merged[name]) {
        merged[name].diagrams.push(...matched);
      } else {
        merged[name] = { diagrams: [...matched], builtinCount: 0 };
      }
    }

    return merged;
  }, [builtin, customChords]);

  // "My Chords" must be scoped to the SELECTED instrument — a custom
  // guitar voicing for "C" should NOT make "C" show up while the
  // Ukulele instrument is selected. `customChords[name]` mixes all
  // instruments together, so filter by `d.instrument` (same rule the
  // ★ badge uses via `hasCustom`).
  const hasCustomForInstrument = (name: string): boolean =>
    (customChords[name]?.some((d) => d.instrument === instrument)) ?? false;

  const filtered = useMemo(() => {
    // When a bass note is selected, search for slash chords (e.g. "Csus4/E").
    // If the slash chord exists in the library, show it.
    // Otherwise show the base chord with a "/{bass}" label.
    if (bassFilter !== 'None') {
      const results: [string, { diagrams: ChordDiagram[]; builtinCount: number }][] = [];
      for (const [name] of Object.entries(allChords)) {
        const root = name.match(/^[A-G][#b]?/)?.[0] ?? '';
        const type = name.slice(root.length);
        if (rootFilter !== 'All' && root !== rootFilter) continue;
        if (typeFilter !== 'All' && type !== typeFilter) continue;
        if (customOnly && !hasCustomForInstrument(name)) continue;

        // Only show chords whose exact slash name exists in the library
        const slashName = `${name}/${bassFilter}`;
        if (allChords[slashName]) {
          results.push([slashName, allChords[slashName]!]);
        }
      }
      return results.sort(([a], [b]) => a.localeCompare(b));
    }

    return Object.entries(allChords).filter(([name]) => {
      const root = name.match(/^[A-G][#b]?/)?.[0] ?? '';
      const type = name.slice(root.length);
      if (rootFilter !== 'All' && root !== rootFilter) return false;
      if (typeFilter !== 'All' && type !== typeFilter) return false;
      if (customOnly && !hasCustomForInstrument(name)) return false;
      return true;
    }).sort(([a], [b]) => a.localeCompare(b));
    // `instrument` participates via hasCustomForInstrument — include it
    // so toggling the instrument re-filters "My Chords".
  }, [allChords, rootFilter, typeFilter, bassFilter, customOnly, customChords, instrument]);

  // Numbered pagination. Whenever the filter set changes (any filter,
  // any instrument, or a chord list mutation that shortens the total)
  // we snap back to page 1 so the user isn't stranded on an empty
  // trailing page.
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  useEffect(() => {
    setPage(1);
  }, [rootFilter, typeFilter, bassFilter, customOnly, instrument]);
  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);
  const pageStart = (page - 1) * PAGE_SIZE;
  const pageEnd = pageStart + PAGE_SIZE;
  const paged = useMemo(() => filtered.slice(pageStart, pageEnd), [filtered, pageStart, pageEnd]);

  const goToPage = (p: number) => {
    setPage(Math.max(1, Math.min(totalPages, p)));
    // Scroll to the top of the grid so the first row of the new
    // page is in view — the user's viewport otherwise stays where
    // it was, which reads as "nothing happened" on a full-screen
    // pager click.
    gridTopRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  };

  const addCustomChord = (diagram: ChordDiagram) => {
    const existing = { ...customChords };
    existing[diagram.name] = [...(existing[diagram.name] ?? []), diagram];
    void updateSetting(db, 'customChords', existing);
    setShowAddForm(false);
  };

  const updateCustomChord = (chordName: string, customIdx: number, diagram: ChordDiagram) => {
    const existing = { ...customChords };
    const arr = [...(existing[chordName] ?? [])];
    arr[customIdx] = diagram;
    existing[chordName] = arr;
    void updateSetting(db, 'customChords', existing);
  };

  const deleteCustomChord = (chordName: string, customIdx: number) => {
    const existing = { ...customChords };
    const arr = [...(existing[chordName] ?? [])];
    arr.splice(customIdx, 1);
    if (arr.length === 0) delete existing[chordName];
    else existing[chordName] = arr;
    void updateSetting(db, 'customChords', existing);
  };

  const hasCustom = (name: string) => (customChords[name]?.filter((d) => d.instrument === instrument).length ?? 0) > 0;

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>{t('chordLibrary.title')}</h1>
        {!showAddForm && (
          <button onClick={() => setShowAddForm(true)}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
            style={{ background: 'var(--accent)', color: 'white' }}>
            + {t('chordLibrary.addChord')}
          </button>
        )}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 mb-6">
        <label className="flex items-center gap-1.5 text-sm" style={{ color: 'var(--text-secondary)' }}>
          {t('chordLibrary.filter.instrument')}
          <select value={instrument} onChange={(e) => setInstrument(e.target.value as InstrumentType)} className="setting-select">
            <option value="guitar">{t('settings.music.defaultInstrument.guitar')}</option>
            <option value="ukulele">{t('settings.music.defaultInstrument.ukulele')}</option>
            <option value="piano">{t('settings.music.defaultInstrument.piano')}</option>
            {customInstrumentList.length > 0 && (
              <optgroup label={t('settings.music.defaultInstrument.customGroup')}>
                {customInstrumentList.map((ci) => (
                  <option key={ci.id} value={ci.id}>{ci.name}</option>
                ))}
              </optgroup>
            )}
          </select>
        </label>
        {/* Custom instruments: define any fretted instrument by its
            string count and build its own chord library. */}
        <button
          onClick={() => setShowInstrumentManager(true)}
          className="flex items-center gap-1 text-xs px-2 py-1 rounded-md transition-colors hover:bg-[var(--surface-elevated)]"
          style={{ color: 'var(--text-secondary)', border: '1px solid var(--border)', background: 'transparent' }}
          title={t('chordLibrary.instruments.manageTitle')}
        >
          <Settings2 size={12} /> {t('chordLibrary.instruments.manage')}
        </button>
        <label className="flex items-center gap-1.5 text-sm" style={{ color: 'var(--text-secondary)' }}>
          {t('chordLibrary.filter.root')}
          <select value={rootFilter} onChange={(e) => setRootFilter(e.target.value)} className="setting-select">
            {ROOT_NOTES.map((n) => <option key={n} value={n}>{n === 'All' ? t('chordLibrary.filter.all') : n}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-1.5 text-sm" style={{ color: 'var(--text-secondary)' }}>
          {t('chordLibrary.filter.type')}
          <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="setting-select">
            {CHORD_TYPES.map((ct) => {
              const label = ct === 'All'
                ? t('chordLibrary.filter.all')
                : ct === ''
                  ? t('chordLibrary.filter.noSuffix')
                  : (CHORD_TYPE_LABELS[ct] ?? ct);
              return <option key={ct} value={ct}>{label}</option>;
            })}
          </select>
        </label>
        <label className="flex items-center gap-1.5 text-sm" style={{ color: 'var(--text-secondary)' }}>
          {t('chordLibrary.filter.over')}
          <select value={bassFilter} onChange={(e) => setBassFilter(e.target.value)} className="setting-select">
            {BASS_NOTES.map((n) => <option key={n} value={n}>{n === 'None' ? t('chordLibrary.filter.none') : n}</option>)}
          </select>
        </label>
        <button onClick={() => setCustomOnly((v) => !v)}
          className="flex items-center gap-1 text-xs px-2 py-1 rounded-md transition-colors"
          style={{ background: customOnly ? 'var(--accent)' : 'var(--surface-elevated)', color: customOnly ? 'white' : 'var(--text-muted)' }}>
          ★ {t('chordLibrary.filter.myChords')}
        </button>
        <span className="text-xs ml-auto" style={{ color: 'var(--text-muted)' }}>
          {filtered.length === 0
            ? t('chordLibrary.chordCountZero')
            : filtered.length === 1
              ? t('chordLibrary.chordCountRangeOne', {
                  from: pageStart + 1,
                  to: Math.min(pageEnd, filtered.length),
                  total: filtered.length,
                })
              : t('chordLibrary.chordCountRangeMany', {
                  from: pageStart + 1,
                  to: Math.min(pageEnd, filtered.length),
                  total: filtered.length,
                })}
        </span>
      </div>

      {showAddForm ? (
        <div>
          <h2 className="text-sm font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>{t('chordLibrary.newCustomChord')}</h2>
          <ChordForm instrument={instrument} onSave={addCustomChord} onCancel={() => setShowAddForm(false)} />
        </div>
      ) : (
      <>
        <div ref={gridTopRef} style={{ scrollMarginTop: 16 }} />
        <div className="flex flex-wrap gap-3">
          {paged.map(([name, { diagrams }]) => (
            <div key={name}
              className="rounded-lg cursor-pointer transition-colors hover:border-[var(--accent)] flex flex-col items-center justify-between"
              // `min-height` not a fixed `height`: ukulele diagrams are
              // taller for the same width (4 strings → wider, taller
              // cells than guitar's 6), so a hard 140px clipped the
              // "N var" caption beyond the card border. Let the card
              // grow to fit its SVG + caption; cards stay uniform
              // within one instrument (rows wrap, not a CSS grid).
              style={{ background: 'var(--surface)', border: '1px solid var(--border)', position: 'relative', width: 110, minHeight: 140, padding: '4px 6px 8px' }}
              onClick={() => setSelectedChord(name)}>
              {hasCustom(name) && (
                <span className="absolute top-0.5 right-0.5" style={{ color: 'var(--accent)', fontSize: 12 }} title={t('chordLibrary.hasCustomVariations')}>★</span>
              )}
              <div style={{ flex: 1, display: 'flex', alignItems: 'center' }}>
                <ChordDiagramSVG diagram={diagrams[0]!} width={90}
                  lineColor={svs.lyrics.color || undefined} chordColor={svs.chords.color || undefined}
                  displayName={formatChord(name, settings.chordNotation ?? 'letter')} />
              </div>
              {diagrams.length > 1 ? (
                <p className="text-center text-[10px]" style={{ color: 'var(--text-muted)' }}>{t('chordLibrary.variationCount', { count: diagrams.length })}</p>
              ) : <div style={{ height: 14 }} />}
            </div>
          ))}
        </div>
        {filtered.length === 0 && (
          <p className="text-center py-12 text-sm" style={{ color: 'var(--text-muted)' }}>
            {isCustomInstrument(instrument) && customInstruments[instrument] && !Object.values(customChords).some((l) => l.some((d) => d.instrument === instrument))
              ? t('chordLibrary.customInstrument.empty', { name: customInstruments[instrument]!.name })
              : t('chordLibrary.emptyState')}
          </p>
        )}
        {totalPages > 1 && (
          <Pager page={page} totalPages={totalPages} onGoto={goToPage} />
        )}
      </>
      )}

      {showInstrumentManager && (
        <CustomInstrumentManager
          instruments={customInstruments}
          customChords={customChords}
          onSave={saveInstrument}
          onDelete={(id) => { void deleteInstrument(id); }}
          onClose={() => setShowInstrumentManager(false)}
        />
      )}

      {/* Chord detail modal */}
      {selectedChord && allChords[selectedChord] && (
        <ChordDetailModal
          chordName={selectedChord}
          diagrams={allChords[selectedChord].diagrams}
          builtinCount={allChords[selectedChord].builtinCount}
          customChords={customChords}
          instrument={instrument}
          svs={svs}
          // Global default for this instrument+chord (if any). When the
          // user clicks "Set as default for all songs" we save the
          // currently-shown variation index here; songs with no
          // per-song override for the chord then render this voicing.
          // Songs that DO have a per-song override (via the song view's
          // "Remember for this song" button) keep winning — the
          // resolver always prefers per-song > global.
          globalDefaultIdx={settings.defaultChordVariations?.[instrument]?.[selectedChord]}
          onSetGlobalDefault={(idx) => {
            const all = { ...(settings.defaultChordVariations ?? {}) };
            const forInst: Record<string, number> = { ...(all[instrument] ?? {}) };
            forInst[selectedChord] = idx;
            all[instrument] = forInst;
            void updateSetting(db, 'defaultChordVariations', all);
          }}
          onClearGlobalDefault={() => {
            const all = { ...(settings.defaultChordVariations ?? {}) };
            const forInst: Record<string, number> = { ...(all[instrument] ?? {}) };
            delete forInst[selectedChord];
            all[instrument] = forInst;
            void updateSetting(db, 'defaultChordVariations', all);
          }}
          onClose={() => setSelectedChord(null)}
          onAddVariation={addCustomChord}
          onUpdateCustom={updateCustomChord}
          onDeleteCustom={deleteCustomChord}
        />
      )}

      <style>{`
        .setting-select {
          padding: 6px 10px; border-radius: 8px; border: 1px solid var(--border);
          background: var(--surface-elevated); color: var(--text-primary); font-size: 13px; outline: none; min-width: 100px;
        }
        .setting-select:focus { border-color: var(--accent); }
      `}</style>
    </div>
  );
}

/* ── Pager ──────────────────────────────────────────────────────────────── */

/** Compact numbered pager. Always shows first + last page, the current
 *  page ±1, and inserts a `…` gap wherever the sequence skips. Prev /
 *  Next buttons flank the numbers and disable at the ends. */
function Pager({ page, totalPages, onGoto }: {
  page: number;
  totalPages: number;
  onGoto: (p: number) => void;
}): React.ReactElement {
  const t = useT();
  const items: Array<number | 'gap'> = [];
  const push = (n: number) => { if (items[items.length - 1] !== n) items.push(n); };
  const gap = () => { if (items[items.length - 1] !== 'gap') items.push('gap'); };
  const window = [page - 1, page, page + 1].filter((n) => n >= 1 && n <= totalPages);
  push(1);
  if (window[0]! > 2) gap();
  for (const n of window) if (n !== 1 && n !== totalPages) push(n);
  if (window[window.length - 1]! < totalPages - 1) gap();
  if (totalPages > 1) push(totalPages);

  const btnBase = 'text-xs px-2.5 py-1 rounded-md transition-colors min-w-[28px]';
  return (
    <div className="flex items-center justify-center gap-1 mt-6">
      <button
        onClick={() => onGoto(page - 1)}
        disabled={page <= 1}
        className={btnBase}
        style={{
          background: 'var(--surface-elevated)',
          color: page <= 1 ? 'var(--text-muted)' : 'var(--text-secondary)',
          opacity: page <= 1 ? 0.4 : 1,
          cursor: page <= 1 ? 'not-allowed' : 'pointer',
        }}
        aria-label={t('chordLibrary.pager.previousPage')}
      >
        ‹ {t('common.previous')}
      </button>
      {items.map((it, i) => (
        it === 'gap'
          ? (
            <span key={`gap-${i}`} className="text-xs px-1" style={{ color: 'var(--text-muted)' }}>…</span>
          ) : (
            <button
              key={it}
              onClick={() => onGoto(it)}
              className={btnBase}
              style={{
                background: it === page ? 'var(--accent)' : 'var(--surface-elevated)',
                color: it === page ? 'white' : 'var(--text-secondary)',
                fontWeight: it === page ? 600 : 400,
              }}
              aria-current={it === page ? 'page' : undefined}
              aria-label={t('chordLibrary.pager.page', { page: it })}
            >
              {it}
            </button>
          )
      ))}
      <button
        onClick={() => onGoto(page + 1)}
        disabled={page >= totalPages}
        className={btnBase}
        style={{
          background: 'var(--surface-elevated)',
          color: page >= totalPages ? 'var(--text-muted)' : 'var(--text-secondary)',
          opacity: page >= totalPages ? 0.4 : 1,
          cursor: page >= totalPages ? 'not-allowed' : 'pointer',
        }}
        aria-label={t('chordLibrary.pager.nextPage')}
      >
        {t('common.next')} ›
      </button>
    </div>
  );
}

/* ── Chord Detail Modal ─────────────────────────────────────────────────── */

function ChordDetailModal({ chordName, diagrams, builtinCount, customChords, instrument, svs, globalDefaultIdx, onSetGlobalDefault, onClearGlobalDefault, onClose, onAddVariation, onUpdateCustom, onDeleteCustom }: {
  chordName: string;
  diagrams: ChordDiagram[];
  builtinCount: number;
  customChords: Record<string, ChordDiagram[]>;
  instrument: InstrumentType;
  svs: { lyrics: { color: string }; chords: { color: string } };
  /** Currently-saved global default voicing index for this instrument
   *  + chord, or undefined when no default has been set. */
  globalDefaultIdx?: number;
  /** Save `idx` as the global default voicing for this chord. */
  onSetGlobalDefault: (idx: number) => void;
  /** Drop the saved global default for this chord (revert to 0). */
  onClearGlobalDefault: () => void;
  onClose: () => void;
  onAddVariation: (d: ChordDiagram) => void;
  onUpdateCustom: (name: string, customIdx: number, d: ChordDiagram) => void;
  onDeleteCustom: (name: string, customIdx: number) => void;
}): React.ReactElement {
  const t = useT();
  // Open the slider on the user's saved global default so they
  // can see / un-set it directly without scrolling to find it.
  const initialIdx = typeof globalDefaultIdx === 'number'
    ? Math.min(globalDefaultIdx, Math.max(0, diagrams.length - 1))
    : 0;
  const [currentIdx, setCurrentIdx] = useState(initialIdx);
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const notation = useSettingsStore((s) => s.settings.chordNotation ?? 'letter');
  const isCurrentTheDefault =
    typeof globalDefaultIdx === 'number' && globalDefaultIdx === currentIdx;

  const isCustomVariation = (idx: number) => idx >= builtinCount;
  const customIdx = (idx: number) => idx - builtinCount;
  const diag = diagrams[currentIdx] ?? diagrams[0]!;
  const custom = isCustomVariation(currentIdx);
  const prev = () => setCurrentIdx((i) => (i > 0 ? i - 1 : diagrams.length - 1));
  const next = () => setCurrentIdx((i) => (i < diagrams.length - 1 ? i + 1 : 0));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.5)' }} onClick={onClose}>
      <div className="rounded-xl shadow-2xl p-6" style={{ background: 'var(--surface)', border: '1px solid var(--border)', minWidth: 280, maxWidth: 860 }}
        onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>{formatChord(chordName, notation)}</h2>
          <div className="flex items-center gap-2">
            <button onClick={() => { setShowAdd((v) => !v); setEditingIdx(null); }}
              className="text-xs px-2 py-1 rounded" style={{ background: showAdd ? 'var(--surface-elevated)' : 'var(--accent)', color: showAdd ? 'var(--text-muted)' : 'white' }}>
              {showAdd ? t('common.cancel') : '+ ' + t('common.add')}
            </button>
            <button onClick={onClose} className="text-sm px-2 py-1 rounded hover:bg-[var(--surface-elevated)]" style={{ color: 'var(--text-muted)' }}>✕</button>
          </div>
        </div>

        {/* Add form */}
        {showAdd && (
          <ChordForm instrument={instrument} initialName={chordName} nameDisabled hideNameInPreview
            onSave={(d) => { onAddVariation(d); setShowAdd(false); }}
            onCancel={() => setShowAdd(false)} />
        )}

        {/* Edit form */}
        {editingIdx !== null && isCustomVariation(editingIdx) && (
          <ChordForm instrument={instrument} initialName={chordName} nameDisabled hideNameInPreview
            initialDiagram={diagrams[editingIdx]}
            onSave={(d) => { onUpdateCustom(chordName, customIdx(editingIdx), d); setEditingIdx(null); }}
            onCancel={() => setEditingIdx(null)} />
        )}

        {/* Slider */}
        <div className="flex items-center gap-3">
          {diagrams.length > 1 && (
            <button onClick={prev} className="p-2 rounded-lg hover:bg-[var(--surface-elevated)]" style={{ color: 'var(--text-secondary)', fontSize: 20 }}>‹</button>
          )}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <div key={currentIdx} className="chord-slide" style={{ position: 'relative' }}>
              {custom && (
                <span className="absolute top-0 right-0" style={{ color: 'var(--accent)', fontSize: 12 }} title={t('chordLibrary.customVariation')}>★</span>
              )}
              <ChordDiagramSVG diagram={diag} width={showAdd || editingIdx !== null ? 100 : 150}
                lineColor={svs.lyrics.color || undefined} chordColor={svs.chords.color || undefined} hideName />
            </div>
          </div>
          {diagrams.length > 1 && (
            <button onClick={next} className="p-2 rounded-lg hover:bg-[var(--surface-elevated)]" style={{ color: 'var(--text-secondary)', fontSize: 20 }}>›</button>
          )}
        </div>

        {/* Dots + info */}
        <div className="flex flex-col items-center gap-2 mt-3">
          {diagrams.length > 1 && (
            <div className="flex gap-1.5">
              {diagrams.map((_, i) => (
                <button key={i} onClick={() => setCurrentIdx(i)}
                  style={{ width: 8, height: 8, borderRadius: '50%', background: i === currentIdx ? 'var(--accent)' : 'var(--border)', border: 'none', cursor: 'pointer' }} />
              ))}
            </div>
          )}
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
            {custom ? t('chordLibrary.variationSource.custom') : t('chordLibrary.variationSource.builtin')} — {t('chordLibrary.variationOf', { current: currentIdx + 1, total: diagrams.length })}
          </span>
          {/* Edit/Delete for custom */}
          {custom && editingIdx !== currentIdx && (
            <div className="flex gap-2">
              <button onClick={() => { setEditingIdx(currentIdx); setShowAdd(false); }}
                className="text-xs px-3 py-1 rounded" style={{ color: 'var(--text-secondary)', background: 'var(--surface-elevated)' }}>{t('common.edit')}</button>
              <button onClick={() => { onDeleteCustom(chordName, customIdx(currentIdx)); setCurrentIdx(Math.max(0, currentIdx - 1)); }}
                className="text-xs px-3 py-1 rounded" style={{ color: 'var(--danger, #ef4444)', background: 'var(--surface-elevated)' }}>{t('common.delete')}</button>
            </div>
          )}
          {/* Set / clear the global default voicing for this chord on
              this instrument. Per-song "Remember for this song" still
              overrides this default for the song that saved it — see
              resolveChordVariation (per-song > global > 0). */}
          {diagrams.length > 1 && (
            <div className="flex flex-col items-center gap-1.5 mt-1">
              <button
                onClick={() => {
                  if (isCurrentTheDefault) onClearGlobalDefault();
                  else onSetGlobalDefault(currentIdx);
                }}
                className="text-xs px-3 py-1 rounded transition-colors"
                style={{
                  background: isCurrentTheDefault ? 'var(--surface-elevated)' : 'var(--accent)',
                  color: isCurrentTheDefault ? 'var(--text-muted)' : 'white',
                }}
                title={
                  isCurrentTheDefault
                    ? t('chordLibrary.defaultForAllSongs.clearTitle')
                    : t('chordLibrary.defaultForAllSongs.setTitle')
                }
              >
                {isCurrentTheDefault ? t('chordLibrary.defaultForAllSongs.active') : t('chordLibrary.defaultForAllSongs.set')}
              </button>
              {typeof globalDefaultIdx === 'number' && !isCurrentTheDefault && (
                <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                  {t('chordLibrary.defaultForAllSongs.currentDefault', { variation: globalDefaultIdx + 1 })}
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

