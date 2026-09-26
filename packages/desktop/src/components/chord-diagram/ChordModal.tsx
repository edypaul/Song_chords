import React, { useEffect, useState } from 'react';
import {
  useSettingsStore,
  useSongStore,
  usePlayerStore,
  getDiagramVariations,
  formatChord,
  resolveChordVariation,
  emptyDiagramFor,
  canonicalChordKey,
} from '@song-chords/shared';
import type { ChordDiagram, SongPreferences } from '@song-chords/shared';
import ChordDiagramSVG from './ChordDiagramSVG';
import ChordForm from './ChordForm';
import { db } from '../../ipc/ipc-client';
import { useT } from '../../i18n';

interface Props {
  chord: string;
  onClose: () => void;
  songId?: string;
  songPrefs?: SongPreferences;
  /** Called right before closing on the native-Escape path while the
   *  document is in fullscreen. Lets the host re-assert fullscreen so
   *  closing the modal doesn't drop the song out of performance mode.
   *  No-op (undefined) for the non-fullscreen song view. */
  onKeepFullscreen?: () => void;
}

/**
 * Chord-diagram modal: shows a chord's voicing(s) with a slider to
 * page through variations, a "remember for this song" pin, and a
 * fallback "create custom diagram" path when no diagram exists.
 *
 * Shared by both the standard song view and the fullscreen perform
 * page so a chord click behaves identically in either context.
 */
export default function ChordModal({ chord, onClose, songId, songPrefs, onKeepFullscreen }: Props): React.ReactElement {
  const t = useT();
  const instrument = useSettingsStore((s) => s.settings.defaultInstrument);
  const svs = useSettingsStore((s) => s.settings.songViewStyle);
  const custom = useSettingsStore((s) => s.settings.customChords ?? {});
  const notation = useSettingsStore((s) => s.settings.chordNotation ?? 'letter');
  const { updateSetting } = useSettingsStore();
  const savePrefs = useSongStore((s) => s.savePreferences);
  const customInstruments = useSettingsStore((s) => s.settings.customInstruments);
  const emptyDiag: ChordDiagram = emptyDiagramFor(chord, instrument, customInstruments);

  const variations = getDiagramVariations(chord, instrument, custom);
  const hasDiagram = variations.length > 0;
  const allDiags = hasDiagram ? variations : [emptyDiag];
  // Initial voicing: per-song override > global default for this
  // instrument > 0. Resolved through the shared helper so the modal
  // opens on the same voicing the song actually renders.
  const globalDefaults = useSettingsStore((s) => s.settings.defaultChordVariations);
  const savedIdx = resolveChordVariation(
    chord, instrument, songPrefs?.chordVariations, globalDefaults,
  );
  const [currentIdx, setCurrentIdx] = useState(Math.min(savedIdx, allDiags.length - 1));
  const [creatingCustom, setCreatingCustom] = useState(false);

  const diag = allDiags[currentIdx] ?? allDiags[0]!;
  // "Remembered ✓" still strictly means "this SONG pinned this index"
  // — the per-song layer, not the global default. The label has to
  // stay narrow because clicking the button writes a per-song
  // override regardless of any global default.
  const isRemembered =
    songPrefs?.chordVariations?.[chord] === currentIdx;

  const saveCustomDiagram = (d: ChordDiagram) => {
    const existing = { ...custom };
    // Group under the CANONICAL enharmonic key ("G#m7" saves join the
    // "Abm7" group) — the lookup re-labels for display either way.
    const key = canonicalChordKey(chord);
    existing[key] = [...(existing[key] ?? []), d];
    void updateSetting(db, 'customChords', existing);
    setCreatingCustom(false);
    // Land on the voicing that was just created. Custom voicings are
    // appended after the built-ins in the lookup, so the new one is at
    // the end of the list (index 0 when the chord had no diagram at
    // all — the placeholder is replaced by the real one).
    setCurrentIdx(hasDiagram ? variations.length : 0);
  };

  // Toggle the per-song pin for THIS chord.
  //   • Currently NOT remembered → write the current variation index
  //     into `songPrefs.chordVariations[chord]`. The song will render
  //     this voicing for this chord from now on.
  //   • Currently remembered (this exact variation) → REMOVE the
  //     per-song entry. The chord falls back through the resolver:
  //     global default for this instrument (set via the Chord
  //     Library's "Set as default for all songs"), or variation 0
  //     if no global default is set either. Toggle behavior lets
  //     the user "unpin" a voicing without needing a separate
  //     Reset button.
  const handleRemember = () => {
    if (!songId) return;
    const existing = songPrefs?.chordVariations ?? {};
    let updated: Record<string, number>;
    if (isRemembered) {
      // Toggle OFF: drop the per-song entry so the resolver falls
      // through to the global default (or 0).
      updated = { ...existing };
      delete updated[chord];
    } else {
      updated = { ...existing, [chord]: currentIdx };
    }
    const newPrefs = { ...songPrefs, chordVariations: updated };
    void savePrefs(db, songId, newPrefs);
    // Update the player store's activeSong so the UI refreshes immediately
    const active = usePlayerStore.getState().activeSong;
    if (active && active.id === songId) {
      usePlayerStore.setState({ activeSong: { ...active, preferences: newPrefs } });
    }
  };

  // Global default for this instrument + chord (Chord Library's "Set
  // as default for all songs"). Offered here too so the user doesn't
  // have to leave the song to make a voicing the app-wide default.
  // Per-song "Remember" still wins over it for the song that pinned.
  const globalDefaultIdx = globalDefaults?.[instrument]?.[chord];
  const isGlobalDefault = typeof globalDefaultIdx === 'number' && globalDefaultIdx === currentIdx;
  const handleGlobalDefault = () => {
    const all = { ...(globalDefaults ?? {}) };
    const forInst: Record<string, number> = { ...(all[instrument] ?? {}) };
    if (isGlobalDefault) delete forInst[chord];
    else forInst[chord] = currentIdx;
    all[instrument] = forInst;
    void updateSetting(db, 'defaultChordVariations', all);
  };

  const prev = () => setCurrentIdx((i) => (i > 0 ? i - 1 : allDiags.length - 1));
  const next = () => setCurrentIdx((i) => (i < allDiags.length - 1 ? i + 1 : 0));

  // Escape closes ONLY the modal — not the song. The host pages
  // register a window-level (bubble-phase) Escape listener that
  // navigates away / exits performance mode. Without intercepting it,
  // pressing Escape while this modal is open would both close the
  // modal AND leave the song. We listen in the CAPTURE phase (runs
  // before the host's bubble-phase handler) and stopImmediatePropagation()
  // so the host handler never sees the event.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopImmediatePropagation();
        e.preventDefault();
        // If we're in native fullscreen, the browser will drop out of
        // fullscreen on this Escape no matter what (it's a
        // non-cancelable UA action). Tell the host to re-assert
        // fullscreen so the song stays in performance mode after the
        // modal closes. Calling this synchronously inside the keydown
        // handler keeps the user-gesture context that
        // requestFullscreen() requires.
        if (document.fullscreenElement) onKeepFullscreen?.();
        // While the voicing editor is open, Escape only closes the
        // editor — the user comes back to the chord on the same page
        // instead of being thrown out of the modal entirely.
        if (creatingCustom) { setCreatingCustom(false); return; }
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose, onKeepFullscreen, creatingCustom]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.5)' }}
      onClick={onClose}
    >
      <div
        className="rounded-xl shadow-2xl p-5"
        style={{
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          minWidth: 240,
          maxWidth: 860,
          // Never taller than the window: the voicing editor is a
          // sizeable block, so cap the modal and scroll inside it
          // rather than letting it run off the top and bottom.
          maxHeight: '90vh',
          overflowY: 'auto',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="relative mb-3">
          <span className="block text-lg font-bold text-center" style={{ color: 'var(--text-primary)' }}>{formatChord(chord, notation)}</span>
          {/* Same header controls as the Chord Library's detail modal:
              "+ Add" opens the voicing editor inline (a new variation,
              or the first voicing for a chord that has none); closing
              the editor returns to this modal on the same page. */}
          <button
            onClick={() => setCreatingCustom((v) => !v)}
            className="absolute top-0 left-0 text-xs px-2 py-1 rounded"
            style={{ background: creatingCustom ? 'var(--surface-elevated)' : 'var(--accent)', color: creatingCustom ? 'var(--text-muted)' : 'white' }}
            title={creatingCustom ? t('common.cancel') : t('chordModal.createCustomDiagram')}
          >
            {creatingCustom ? t('common.cancel') : '+ ' + t('common.add')}
          </button>
          <button onClick={onClose} className="absolute top-0 right-0 text-sm px-2 py-1 rounded hover:bg-[var(--surface-elevated)]" style={{ color: 'var(--text-muted)' }}>✕</button>
        </div>

        {/* While adding a voicing, the editor REPLACES the slider: it
            carries its own live preview, and stacking both made the
            modal taller than the window. Saving or cancelling brings
            the slider back on the (new) voicing. */}
        {creatingCustom ? (
          <ChordForm instrument={instrument} initialName={chord} nameDisabled hideNameInPreview
            onSave={saveCustomDiagram} onCancel={() => setCreatingCustom(false)} />
        ) : (<>

        {/* Diagram slider */}
        <div className="flex items-center gap-2">
          {allDiags.length > 1 && (
            <button onClick={prev} className="p-2 rounded-lg hover:bg-[var(--surface-elevated)]" style={{ color: 'var(--text-secondary)' }}>‹</button>
          )}
          <div style={{ flex: 1, display: 'flex', justifyContent: 'center' }}>
            <div key={currentIdx} className="chord-slide">
              <ChordDiagramSVG diagram={diag} width={180}
                lineColor={svs.lyrics.color || undefined} chordColor={svs.chords.color || undefined} hideName />
            </div>
          </div>
          {allDiags.length > 1 && (
            <button onClick={next} className="p-2 rounded-lg hover:bg-[var(--surface-elevated)]" style={{ color: 'var(--text-secondary)' }}>›</button>
          )}
        </div>

        {!hasDiagram && !creatingCustom && (
          <div className="flex flex-col items-center gap-2 mt-3">
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{t('chordModal.noDiagram')}</span>
            <button
              onClick={() => setCreatingCustom(true)}
              className="text-xs px-3 py-1 rounded-md transition-colors"
              style={{ background: 'var(--accent)', color: 'white' }}
            >
              {t('chordModal.createCustomDiagram')}
            </button>
          </div>
        )}

        {/* Dots + controls */}
        {allDiags.length > 1 && (
          <div className="flex flex-col items-center gap-2 mt-3">
            {/* Dot indicators */}
            <div className="flex gap-1.5">
              {allDiags.map((_, i) => (
                <button key={i} onClick={() => setCurrentIdx(i)}
                  style={{ width: 8, height: 8, borderRadius: '50%', background: i === currentIdx ? 'var(--accent)' : 'var(--border)', border: 'none', cursor: 'pointer' }} />
              ))}
            </div>
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
              {t('chordModal.variationOf', { current: currentIdx + 1, total: allDiags.length })}
            </span>
            {/* Remember toggle. Click once to pin this variation for
                this song; click again to unpin. When unpinned, the
                chord falls back to the global default (Chord Library
                → Set as default for all songs) or variation 0 if
                none is set. */}
            <div className="flex items-center gap-2 flex-wrap justify-center">
              {songId && (
                <button
                  onClick={handleRemember}
                  className="text-xs px-3 py-1 rounded-md transition-colors"
                  style={{
                    background: isRemembered ? 'var(--surface-elevated)' : 'var(--accent)',
                    color: isRemembered ? 'var(--text-muted)' : 'white',
                  }}
                  title={isRemembered ? t('chordModal.rememberedTitle') : t('chordModal.rememberForSongTitle')}
                >
                  {isRemembered ? t('chordModal.remembered') : t('chordModal.rememberForSong')}
                </button>
              )}
              {/* App-wide default — same control as the Chord Library. */}
              <button
                onClick={handleGlobalDefault}
                className="text-xs px-3 py-1 rounded-md transition-colors"
                style={{
                  background: isGlobalDefault ? 'var(--surface-elevated)' : 'var(--accent)',
                  color: isGlobalDefault ? 'var(--text-muted)' : 'white',
                }}
                title={isGlobalDefault
                  ? t('chordLibrary.defaultForAllSongs.clearTitle')
                  : t('chordLibrary.defaultForAllSongs.setTitle')}
              >
                {isGlobalDefault ? t('chordLibrary.defaultForAllSongs.active') : t('chordLibrary.defaultForAllSongs.set')}
              </button>
            </div>
            {typeof globalDefaultIdx === 'number' && !isGlobalDefault && (
              <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                {t('chordLibrary.defaultForAllSongs.currentDefault', { variation: globalDefaultIdx + 1 })}
              </span>
            )}
          </div>
        )}
        </>)}
      </div>
    </div>
  );
}
