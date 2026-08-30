import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Mic, MicOff, Volume2, Star, Pencil, Trash2, Activity } from 'lucide-react';
import TuningForkIcon from '../components/common/TuningForkIcon';
import { useSettingsStore, toLatin } from '@song-chords/shared';
import { useT } from '../i18n';
import type { TKey } from '../i18n';

import { TunerAudioEngine, type AudioInputDevice } from '../tuner/audio/engine';
import { ReferenceTonePlayer, voiceForInstrument } from '../tuner/audio/reference-tone';
import { YinDetector, rms } from '../tuner/dsp/yin';
import { PitchSmoother } from '../tuner/dsp/smoothing';
import {
  centsBetween,
  formatNote,
  frequencyToNote,
  nearestStringIndex,
  noteNameToFrequency,
} from '../tuner/dsp/note';
import {
  INSTRUMENT_PRESETS,
  getInstrument,
  type InstrumentPreset,
  type TunerInstrument,
  type TuningPreset,
} from '../tuner/tunings/presets';
import {
  A4_PRESETS,
  clampA4,
  useTunerStore,
  type CustomTuning,
} from '../tuner/tunings/store';

import CircularTuner from '../tuner/ui/CircularTuner';
import CustomTuningEditor, { type CustomTuningDraft } from '../tuner/ui/CustomTuningEditor';

/**
 * Professional musical tuner — see the modules under `src/tuner/` for
 * the audio engine (`audio/engine.ts`), the YIN pitch detector
 * (`dsp/yin.ts`), note math (`dsp/note.ts`), the silence + smoothing
 * layer (`dsp/smoothing.ts`), tuning presets (`tunings/presets.ts`)
 * and the persistent settings store (`tunings/store.ts`).
 *
 * This file is the integration point: it owns the AudioContext-bound
 * engine + a requestAnimationFrame loop that pulls audio buffers,
 * runs YIN, and drives all the visual state. The UI itself is split
 * into smaller components — the centre is intentionally simple so
 * the audio path is auditable.
 */

// 27 Hz floor: a 5-string bass's low B is 30.9 Hz and a 4-string's E1
// is 41.2 Hz. The previous 60 Hz floor could not see either
// fundamental, so the detector locked onto the 2nd harmonic and the
// string picker then chose the WRONG string (E1 read as E2 ≈ D2's
// neighbourhood). With a 4096-sample window at 48 kHz the longest
// searchable period is 2047 samples ≈ 23 Hz, so 27 Hz fits.
const MIN_DETECT_HZ = 27;
const MAX_DETECT_HZ = 1500; // covers a violin's high E (≈ 660 Hz) comfortably
// Analyser buffer (fine spectral stage) and the coarse YIN window
// within it. 8192 samples ≈ 170 ms at 48 kHz gives the low B of a
// 5-string bass enough spectral resolution to read true; the coarse
// stage only looks at the latest 4096 (≈ 85 ms) so a new note is
// identified just as quickly as before and the CPU cost is unchanged.
const ANALYSIS_BUFFER = 8192;
const COARSE_WINDOW = 4096;

interface LiveReading {
  /** Raw, unfiltered YIN frequency for the current frame. */
  rawHz: number | null;
  /** Smoothed frequency the needle tracks. */
  smoothHz: number | null;
  /** Detected note + cents off — null when no signal. */
  note: ReturnType<typeof frequencyToNote>;
  /** Cents relative to whichever target the current mode picks
   *  (chromatic = nearest note, instrument = nearest tuning string,
   *  single-string = the selected note). */
  targetCents: number | null;
  /** The target frequency (for the readout next to detected freq). */
  targetHz: number | null;
  /** What the sub-label describes — render decides the visible
   *  string (and applies solfège translation to the note name if the
   *  user picked Latin notation). */
  targetLabelKind: 'none' | 'closest-string' | 'target' | 'nearest';
  /** English note name the label refers to (always English so the
   *  renderer can `toLatin` it consistently). */
  targetNoteName: string | null;
  /** Index of the active string in the current tuning, or -1. */
  activeStringIdx: number;
  /** Mic input level in [0, 1]. Drives the level meter. */
  level: number;
  /** True once the latched note has been stable for a few frames. */
  stable: boolean;
  /** Stability progress in [0, 1] — fraction of consecutive
   *  same-pitch frames the latch needs (real value, not fabricated).
   *  UI shows it as a "Stability: XX%" readout. */
  stability: number;
  /** YIN clarity 0..1. */
  clarity: number;
}

const SILENT_READING: LiveReading = {
  rawHz: null, smoothHz: null, note: null,
  targetCents: null, targetHz: null,
  targetLabelKind: 'none', targetNoteName: null,
  activeStringIdx: -1,
  level: 0, stable: false, stability: 0, clarity: 0,
};

export default function TunerPage(): React.ReactElement {
  const t = useT();
  const a4Hz = useTunerStore((s) => s.a4Hz);
  const setA4Hz = useTunerStore((s) => s.setA4Hz);
  const instrument = useTunerStore((s) => s.instrument);
  const setInstrument = useTunerStore((s) => s.setInstrument);
  const tuningId = useTunerStore((s) => s.tuningId);
  const setTuningId = useTunerStore((s) => s.setTuningId);
  const mode = useTunerStore((s) => s.mode);
  const setMode = useTunerStore((s) => s.setMode);
  const singleString = useTunerStore((s) => s.singleString);
  const setSingleString = useTunerStore((s) => s.setSingleString);
  const deviceId = useTunerStore((s) => s.deviceId);
  const setDeviceId = useTunerStore((s) => s.setDeviceId);
  const preferFlats = useTunerStore((s) => s.preferFlats);
  const setPreferFlats = useTunerStore((s) => s.setPreferFlats);
  const sensitivity = useTunerStore((s) => s.sensitivity);
  const setSensitivity = useTunerStore((s) => s.setSensitivity);
  const toneStyle = useTunerStore((s) => s.toneStyle);
  const setToneStyle = useTunerStore((s) => s.setToneStyle);
  const customTunings = useTunerStore((s) => s.customTunings);
  const addCustomTuning = useTunerStore((s) => s.addCustomTuning);
  const updateCustomTuning = useTunerStore((s) => s.updateCustomTuning);
  const removeCustomTuning = useTunerStore((s) => s.removeCustomTuning);
  const toggleFavoriteTuning = useTunerStore((s) => s.toggleFavoriteTuning);

  // Sensitivity → silence-RMS gate. Lower threshold = picks up
  // softer playing; higher = ignores quiet ambient noise. The values
  // come from real experimentation with the PitchSmoother default
  // (0.008) — Low backs off, High dips below the default.
  const sensitivityRms = sensitivity === 'low' ? 0.020
                       : sensitivity === 'high' ? 0.004
                       : 0.008;

  // Honour the global chord-notation setting (Settings → General →
  // Chord notation): when set to 'latin', everywhere the tuner shows
  // a note name (the big display, the cents-meter sub-label, the
  // string chips, the single-string input, the custom-tuning chips)
  // we re-spell via `toLatin` for display only. The engine still
  // uses plain English internally — `E2`, `A4`, etc. — because the
  // pitch math, note parsers, and persistent tuning store all key
  // on that. This is the same pattern the rest of the app uses
  // (`formatChord`/`formatKey`) so notation stays consistent
  // app-wide and storage never sees solfège.
  const chordNotation = useSettingsStore((s) => s.settings.chordNotation ?? 'letter');
  const showLatin = chordNotation === 'latin';
  /** Translate a single English note token (e.g. "E2", "A#4", "Bb3")
   *  for display. Safe to call with the empty string or "—". */
  const dn = (n: string): string => (showLatin && n ? toLatin(n) : n);

  // ── Audio engine + DSP ────────────────────────────────────────────
  // Kept in refs so re-renders never tear down the audio graph.
  const engineRef = useRef<TunerAudioEngine | null>(null);
  const detectorRef = useRef<YinDetector | null>(null);
  const smootherRef = useRef<PitchSmoother | null>(null);
  const tonePlayerRef = useRef<ReferenceTonePlayer | null>(null);
  // Standalone AudioContext for the reference-tone player so Play
  // works WITHOUT the user having clicked Start first. The mic engine
  // owns a separate context for capture; mixing them on one context
  // is unnecessary (oscillator → destination doesn't need the input
  // graph) and creating the tone context lazily lets us defer it
  // until the first user-gesture click — which is exactly when
  // Chromium's autoplay policy allows context creation + resume.
  const toneCtxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);

  const [running, setRunning] = useState(false);
  const [permissionError, setPermissionError] = useState<string | null>(null);
  const [devices, setDevices] = useState<AudioInputDevice[]>([]);
  const [showEditor, setShowEditor] = useState<{ open: boolean; draft: CustomTuningDraft } | null>(null);
  const [reading, setReading] = useState<LiveReading>(SILENT_READING);
  const [tonePlayingNote, setTonePlayingNote] = useState<string | null>(null);
  /** Snapshot of engine timing — set when start() succeeds. The
   *  analysis latency is `bufferLength / sampleRate * 1000` ms; this
   *  is the REAL one-frame latency, not a fabricated number. */
  const [engineInfo, setEngineInfo] = useState<{ sampleRate: number; latencyMs: number } | null>(null);

  // ── Resolved current tuning (built-in + custom merged) ────────────
  const instrumentPreset: InstrumentPreset = useMemo(() => getInstrument(instrument), [instrument]);
  const customForInstrument = useMemo(
    () => Object.values(customTunings).filter((t) => t.instrument === instrument),
    [customTunings, instrument],
  );
  const activeTuning: TuningPreset | CustomTuning = useMemo(() => {
    const fromCustom = customTunings[tuningId];
    if (fromCustom && fromCustom.instrument === instrument) return fromCustom;
    const fromBuiltin = instrumentPreset.tunings.find((t) => t.id === tuningId);
    return fromBuiltin ?? instrumentPreset.tunings[0]!;
  }, [customTunings, tuningId, instrumentPreset, instrument]);

  // String frequencies for the active tuning, derived from A4.
  const stringFrequencies = useMemo(() => {
    return activeTuning.notes
      .map((n) => noteNameToFrequency(n, a4Hz))
      .filter((f): f is number => f !== null);
  }, [activeTuning, a4Hz]);

  // Detection floor for the current tuning. YIN's cost is
  // proportional to the longest period it searches, so searching
  // down to 27 Hz for a ukulele (lowest string 261 Hz) burns ~10 ms
  // per frame for nothing. Use 70 % of the tuning's lowest string —
  // enough headroom to catch a badly flat string — and the global
  // floor for chromatic / voice, which have no strings.
  const minDetectHz = useMemo(() => {
    if (stringFrequencies.length === 0) return MIN_DETECT_HZ;
    return Math.max(MIN_DETECT_HZ, Math.min(...stringFrequencies) * 0.7);
  }, [stringFrequencies]);
  const minDetectHzRef = useRef(minDetectHz);
  useEffect(() => {
    minDetectHzRef.current = minDetectHz;
    // Rebuild the detector live when the floor changes mid-session
    // (instrument / tuning switch). The rAF loop reads detectorRef
    // every frame, so swapping the instance is safe.
    const engine = engineRef.current;
    if (!engine || !engine.running) return;
    const buf = engine.getTimeDomainBuffer();
    detectorRef.current = new YinDetector(buf?.length ?? ANALYSIS_BUFFER, {
      sampleRate: engine.sampleRate,
      minFrequency: minDetectHz,
      maxFrequency: MAX_DETECT_HZ,
      coarseLength: COARSE_WINDOW,
    });
  }, [minDetectHz]);

  // ── rAF loop body — has to read everything that affects targeting
  // (mode, tuning, A4) from refs so we can update them without
  // resubscribing the listener every frame. ─────────────────────────
  const modeRef = useRef(mode);
  const a4Ref = useRef(a4Hz);
  const stringsRef = useRef<number[]>([]);
  const stringNotesRef = useRef<string[]>([]);
  const singleStringRef = useRef(singleString);
  const preferFlatsRef = useRef(preferFlats);
  useEffect(() => { modeRef.current = mode; }, [mode]);
  useEffect(() => { a4Ref.current = a4Hz; }, [a4Hz]);
  useEffect(() => { stringsRef.current = stringFrequencies; }, [stringFrequencies]);
  useEffect(() => { stringNotesRef.current = [...activeTuning.notes]; }, [activeTuning]);
  useEffect(() => { singleStringRef.current = singleString; }, [singleString]);
  useEffect(() => { preferFlatsRef.current = preferFlats; }, [preferFlats]);

  // Switching instrument away from chromatic resets the tuning to
  // the new instrument's default (otherwise we'd keep e.g. a guitar
  // tuning id while the user has just clicked Ukulele).
  useEffect(() => {
    const inst = getInstrument(instrument);
    const validBuiltin = inst.tunings.some((t) => t.id === tuningId);
    const validCustom = customTunings[tuningId]?.instrument === instrument;
    if (!validBuiltin && !validCustom) {
      setTuningId(inst.defaultTuningId);
    }
    smootherRef.current?.reset();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instrument]);

  // Force a smoother reset when mode / tuning changes too, so the
  // latched note from the previous configuration doesn't bleed
  // through.
  useEffect(() => { smootherRef.current?.reset(); }, [mode, tuningId]);

  // Push the sensitivity threshold into the smoother whenever the
  // user changes it. Resetting the latched note alongside keeps the
  // UI from showing a stale "stable" badge based on the old gate.
  useEffect(() => {
    smootherRef.current?.setSilenceRms(sensitivityRms);
    smootherRef.current?.reset();
  }, [sensitivityRms]);

  // ── Start / stop the engine ──────────────────────────────────────
  const start = async () => {
    setPermissionError(null);
    try {
      if (!engineRef.current) engineRef.current = new TunerAudioEngine();
      await engineRef.current.start({ deviceId, fftSize: ANALYSIS_BUFFER, highPassHz: 20 });
      // Device labels are only populated after permission is granted.
      const list = await engineRef.current.listInputDevices();
      setDevices(list);
      if (!deviceId && engineRef.current.deviceId) {
        setDeviceId(engineRef.current.deviceId);
      }
      // Rebuild detector + smoother for this sample rate / buffer size.
      const sr = engineRef.current.sampleRate;
      const buf = engineRef.current.getTimeDomainBuffer();
      const bufLen = buf?.length ?? ANALYSIS_BUFFER;
      detectorRef.current = new YinDetector(bufLen, {
        sampleRate: sr,
        minFrequency: minDetectHzRef.current,
        maxFrequency: MAX_DETECT_HZ,
        coarseLength: COARSE_WINDOW,
      });
      smootherRef.current = new PitchSmoother({ silenceRms: sensitivityRms });
      // NOTE: the reference-tone player is NOT created here — it
      // owns a separate AudioContext, lazily built in `playNote()` so
      // Play works without first clicking Start.
      // Real note-identification latency: the coarse window at sr Hz
      // (the fine stage's longer buffer only sharpens the reading).
      setEngineInfo({ sampleRate: sr, latencyMs: (Math.min(bufLen, COARSE_WINDOW) / sr) * 1000 });
      setRunning(true);
      runLoop();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // Common case: user denied permission in the browser dialog.
      setPermissionError(
        /denied|not allowed|permission/i.test(msg)
          ? t('tuner.error.permissionDenied')
          : t('tuner.error.startFailed', { error: msg }),
      );
      setRunning(false);
    }
  };

  const stop = async () => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    await engineRef.current?.stop();
    tonePlayerRef.current?.stop();
    setTonePlayingNote(null);
    setRunning(false);
    setReading(SILENT_READING);
    liveCentsRef.current = null;
    setEngineInfo(null);
  };

  // A playing reference tone is voiced for the CURRENT instrument and
  // sound style; when either changes, stop it rather than keep a
  // guitar pluck ringing under the ukulele preset.
  useEffect(() => {
    if (tonePlayerRef.current?.playing) {
      tonePlayerRef.current.stop();
      setTonePlayingNote(null);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instrument, toneStyle]);

  // Clean up on unmount.
  useEffect(() => {
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      void engineRef.current?.dispose();
      tonePlayerRef.current?.stop();
      if (toneCtxRef.current) {
        void toneCtxRef.current.close().catch(() => { /* already closed */ });
        toneCtxRef.current = null;
      }
    };
  }, []);

  // Live mic switch.
  const onPickDevice = async (id: string) => {
    setDeviceId(id);
    if (engineRef.current && running) {
      try {
        await engineRef.current.switchDevice(id);
      } catch (e) {
        setPermissionError(t('tuner.error.switchFailed', { error: e instanceof Error ? e.message : String(e) }));
      }
    }
  };

  // ── Cents-space adaptive smoothing for the needle ────────────────
  // The upstream PitchSmoother filters in Hz, but the needle reads
  // CENTS — and small Hz wobble around a target produces visibly
  // exaggerated cents jitter because the cents-from-Hz relationship
  // is logarithmic. So we keep a second-layer median + EMA on the
  // cents output, with adaptive alpha: snappy when the player is
  // far off (so the needle catches up fast), heavy when within
  // ±15 ¢ (so it settles instead of dancing around zero).
  // Kept in refs so the loop doesn't trigger re-renders.
  const centsMedianRef = useRef<number[]>([]);
  const centsEmaRef = useRef<number | null>(null);
  /** Track the latched frequency from the previous frame so we can
   *  detect a latched-note CHANGE and reset the cents smoother. */
  const lastLatchedRef = useRef<number | null>(null);
  /** Window of cents medians for the outlier filter. 5 frames
   *  (≈ 80 ms): enough to drop a single glitched frame, short enough
   *  that the reading tracks a string being tuned in real time. */
  const CENTS_MEDIAN_WINDOW = 5;
  /** Live cents for the needle, written every detection frame
   *  (60 Hz) and read by CircularTuner's spring loop — the needle
   *  never waits for a React render. */
  const liveCentsRef = useRef<number | null>(null);

  /** Apply the adaptive cents-space smoother and return the value
   *  the needle should track. Pass `null` for silence — that resets
   *  the smoother so the next note doesn't appear to "slide in"
   *  from the previous value.
   *
   *  `latchHz` is the current latched frequency — when it changes
   *  (a genuine pitch change has committed), we RESET the cents
   *  smoother. Otherwise the EMA carries the previous note's cents
   *  value into the new note and the needle drifts through hundreds
   *  of cents before settling on the new target. */
  const smoothCents = (raw: number | null, latchHz: number | null): number | null => {
    // Detect latch change (different note now displayed) — reset
    // history so the needle snaps to the new target instead of
    // exponentially decaying from the old note's reading.
    if (latchHz !== lastLatchedRef.current) {
      centsMedianRef.current = [];
      centsEmaRef.current = null;
      lastLatchedRef.current = latchHz;
    }
    if (raw === null || !Number.isFinite(raw)) {
      centsMedianRef.current = [];
      centsEmaRef.current = null;
      return null;
    }
    // 1) Median window — kills single-frame outliers from a brief
    //    octave error in YIN or a transient pluck artefact.
    const hist = centsMedianRef.current;
    hist.push(raw);
    if (hist.length > CENTS_MEDIAN_WINDOW) hist.shift();
    const sorted = [...hist].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)]!;
    // 2) Adaptive EMA. Alpha varies with the absolute cents value:
    //      |c| > 25  → 0.6   (catch up fast when far off)
    //      |c| > 10  → 0.4   (mid response)
    //      |c| ≤ 10  → 0.25  (extra damping near the target)
    //    Much lighter than before (0.45 / 0.22 / 0.10): the detector
    //    now measures the isolated fundamental over many periods, so
    //    frame-to-frame noise is well under a cent and the needle's
    //    own spring provides the visual damping. Heavy data filtering
    //    on top only added lag between the string and the needle.
    const abs = Math.abs(median);
    const alpha = abs > 25 ? 0.6 : abs > 10 ? 0.4 : 0.25;
    const prev = centsEmaRef.current;
    const next = prev === null ? median : prev + alpha * (median - prev);
    centsEmaRef.current = next;
    return next;
  };

  // ── The rAF loop ─────────────────────────────────────────────────
  // Pulls one buffer per frame, runs YIN, applies smoothing, and
  // pushes a new reading into React state.
  //
  // Throttling: detection runs at full ~60 Hz so we don't miss
  // notes, but `setReading` (which triggers a React render + the
  // CSS transition on the needle) is gated to ~30 Hz. That gives
  // the 90 ms CSS transition time to actually COMPLETE between
  // updates — otherwise rapid prop changes chain transitions and
  // the needle motion looks chaotic even when the underlying value
  // is steady.
  const DISPLAY_INTERVAL_MS = 33; // ≈ 30 Hz UI refresh
  const lastEmitRef = useRef(0);

  const runLoop = () => {
    const engine = engineRef.current;
    const detector = detectorRef.current;
    const smoother = smootherRef.current;
    if (!engine || !detector || !smoother) return;

    const buf = engine.getTimeDomainBuffer();
    if (buf) {
      const level = rms(buf);
      const r = detector.detect(buf);
      const smoothed = smoother.push(r.frequency, r.clarity, level);
      const next = computeReading(
        r.frequency,
        smoothed.frequency,
        smoothed.latched,
        smoothed.level,
        smoothed.stable,
        smoothed.stability,
        smoothed.clarity,
        a4Ref.current,
        modeRef.current,
        stringsRef.current,
        stringNotesRef.current,
        singleStringRef.current,
        preferFlatsRef.current,
      );
      // Second-layer smoothing on the cents output specifically.
      // Pass the latched freq so the smoother can reset on a real
      // pitch change (otherwise the needle drifts through the old
      // note's cents value).
      next.targetCents = smoothCents(next.targetCents, smoothed.latched);
      // The needle reads this every frame; text / colours update at
      // the throttled rate below.
      liveCentsRef.current = next.targetCents;
      // UI refresh throttle.
      const now = performance.now();
      if (now - lastEmitRef.current >= DISPLAY_INTERVAL_MS) {
        lastEmitRef.current = now;
        setReading(next);
      }
    }
    rafRef.current = requestAnimationFrame(runLoop);
  };

  // ── Custom-tuning editor handlers ────────────────────────────────
  const openCreate = () => {
    setShowEditor({
      open: true,
      draft: {
        name: '',
        instrument,
        notes: activeTuning.notes.length ? [...activeTuning.notes] : ['E2'],
      },
    });
  };
  const openEdit = (t: CustomTuning) => {
    setShowEditor({
      open: true,
      draft: { id: t.id, name: t.name, instrument: t.instrument, notes: [...t.notes] },
    });
  };
  const onSaveDraft = (d: CustomTuningDraft) => {
    if (d.id) {
      updateCustomTuning(d.id, { name: d.name, notes: d.notes });
    } else {
      const id = addCustomTuning({ name: d.name, instrument: d.instrument, notes: d.notes });
      setTuningId(id);
    }
    setShowEditor(null);
  };

  // ── Reference-tone playback ──────────────────────────────────────
  // Works WITHOUT the mic engine being started: the tone player owns
  // its own AudioContext (`toneCtxRef`), created lazily on the first
  // click so the user-gesture satisfies Chromium's autoplay policy.
  // Without this, clicking Play before Start silently returned (the
  // previous code only built a player if `engineRef.current.audioContext`
  // existed, which it doesn't until Start has run).
  const playNote = (noteName: string) => {
    const f = noteNameToFrequency(noteName, a4Hz);
    if (!f) return;
    // Lazy-init the tone-only AudioContext + player on first click.
    if (!toneCtxRef.current) {
      const Ctor: typeof AudioContext | undefined =
        window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      toneCtxRef.current = new Ctor();
    }
    if (!tonePlayerRef.current) {
      tonePlayerRef.current = new ReferenceTonePlayer(toneCtxRef.current);
    }
    // Autoplay-policy: a fresh context starts `suspended` until a
    // user gesture resumes it. The click that landed here IS that
    // gesture — kick the resume off synchronously every time so a
    // context that auto-suspended (e.g. tab backgrounded) wakes up.
    if (toneCtxRef.current.state === 'suspended') {
      void toneCtxRef.current.resume();
    }
    if (tonePlayingNote === noteName) {
      tonePlayerRef.current.stop();
      setTonePlayingNote(null);
    } else {
      // Voice follows the selected instrument (plucked string, bowed
      // string) unless the user prefers the pure reference tone.
      tonePlayerRef.current.play(f, voiceForInstrument(instrument, toneStyle));
      setTonePlayingNote(noteName);
    }
  };

  // ── Render ───────────────────────────────────────────────────────
  // `reading.note` is the wrapper { note, cents, targetHz }; the
  // ParsedNote with `.name` / `.octave` is `reading.note.note`. The
  // wrapper was being passed straight to `formatNote`, which did
  // `n.name + n.octave` over two `undefined`s — JS coerces that to
  // NaN, hence the "NaN" big display while the rest of the readout
  // (cents, Hz) looked correct.
  const centsText = reading.targetCents !== null
    ? `${reading.targetCents > 0 ? '+' : ''}${reading.targetCents.toFixed(1)} ¢`
    : '';
  const hzText = reading.smoothHz !== null ? `${reading.smoothHz.toFixed(2)} Hz` : '';
  const targetHzText = reading.targetHz !== null ? `→ ${reading.targetHz.toFixed(2)} Hz` : '';

  // Status text under the big note. Always short (matches the
  // reference design's "PERFECT CALIBRATION" line). Localised in
  // English; could be moved to i18n later.
  const absC = Math.abs(reading.targetCents ?? 99);
  const active = reading.note !== null;
  const locked = reading.stable && absC <= 5;
  const statusText = !running
    ? t('tuner.status.awaiting')
    : !active
      ? t('tuner.status.listening')
      : locked
        ? t('tuner.status.perfect')
        : absC <= 15
          ? (reading.targetCents! > 0 ? t('tuner.status.slightlySharp') : t('tuner.status.slightlyFlat'))
          : (reading.targetCents! > 0 ? t('tuner.status.tuneDown') : t('tuner.status.tuneUp'));
  const statusColor = !active
    ? undefined
    : locked
      ? '#22c55e'
      : absC <= 15
        ? '#f59e0b'
        : '#ef4444';

  // Decompose the big-display note for the circle. The big letter
  // is the pitch class (`E`, `A#`, …); the octave sits as a small
  // superscript next to it. `frequencyToNote` already gives us
  // `name` + `octave` separately.
  const bigLetter = reading.note ? dn(reading.note.note.name) : '';
  const bigOctave = reading.note ? reading.note.note.octave : null;

  // Compose the cents-meter sub-label here so the notation setting
  // (English vs solfège) is applied at render time. `computeReading`
  // already gave us the label KIND + the underlying English note
  // name; we localise just the note token.
  const subLabel = (() => {
    if (!reading.targetNoteName) return '';
    const n = dn(reading.targetNoteName);
    switch (reading.targetLabelKind) {
      case 'closest-string': return t('tuner.subLabel.closestString', { note: n });
      case 'target':         return t('tuner.subLabel.target', { note: n });
      case 'nearest':        return t('tuner.subLabel.nearest', { note: n });
      default:               return '';
    }
  })();

  return (
    <div
      className="flex flex-col h-full overflow-hidden"
      style={{
        // Slightly cooler than the default app bg so the page feels
        // distinctly "instrument-y". The radial highlight behind
        // the circle echoes the reference design.
        background:
          'radial-gradient(ellipse at 50% 30%, color-mix(in srgb, var(--accent) 6%, transparent), transparent 60%), var(--bg)',
      }}
    >
      {/* ── Top bar ────────────────────────────────────────────── */}
      <div
        className="flex items-center gap-4 px-6 py-4 shrink-0"
        style={{ borderBottom: '1px solid var(--border)' }}
      >
        <div className="flex items-center gap-3">
          <TuningForkIcon size={22} style={{ color: 'var(--accent)' }} />
          <div className="flex flex-col leading-tight">
            <h1
              className="font-bold tracking-wider"
              style={{
                color: 'var(--text-primary)',
                fontSize: 22,
                letterSpacing: '0.08em',
              }}
            >
              {t('tuner.title')}
            </h1>
            <span className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-muted)', letterSpacing: '0.12em' }}>
              {t('tuner.subtitle')}
            </span>
          </div>
        </div>

        <div className="flex-1" />

        {/* Mini-cards: live reference + analysis latency. Latency
            is the REAL one-frame analysis latency, not fabricated. */}
        <MiniStat label={t('tuner.reference')} value={`${a4Hz} Hz`} accent />
        <MiniStat
          label={t('tuner.latency')}
          value={engineInfo ? `${engineInfo.latencyMs.toFixed(0)} ms` : '—'}
          accent
        />

        {!running ? (
          <button
            onClick={() => void start()}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold shrink-0 whitespace-nowrap"
            style={{ background: 'var(--accent)', color: 'white' }}
            title={t('tuner.startTitle')}
          >
            <Mic size={14} /> {t('tuner.start')}
          </button>
        ) : (
          <button
            onClick={() => void stop()}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold shrink-0 whitespace-nowrap"
            style={{ background: 'var(--surface-elevated)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}
            title={t('tuner.stopTitle')}
          >
            <MicOff size={14} /> {t('tuner.stop')}
          </button>
        )}
      </div>

      {permissionError && (
        <div className="px-6 py-2 text-xs" style={{ background: 'color-mix(in srgb, #ef4444 14%, transparent)', color: '#fecaca' }}>
          {permissionError}
        </div>
      )}

      {/* ── Body: three-column grid ───────────────────────────── */}
      <div
        className="flex-1 min-h-0 overflow-y-auto"
        style={{ padding: 20 }}
      >
        <div
          className="mx-auto"
          style={{
            maxWidth: 1280,
            display: 'grid',
            gridTemplateColumns: 'minmax(220px, 240px) 1fr minmax(220px, 240px)',
            gap: 16,
            alignItems: 'start',
          }}
        >
          {/* ────────── LEFT COLUMN ────────── */}
          <div className="flex flex-col gap-4">
            <Card
              title={t('tuner.instrument.label')}
              dotColor={running ? '#22c55e' : 'var(--text-muted)'}
            >
              <div className="flex flex-col gap-1.5">
                {INSTRUMENT_PRESETS.map((p) => {
                  const key = `tuner.instrument.${p.id}` as TKey;
                  return (
                    <PillButton
                      key={p.id}
                      active={instrument === p.id}
                      onClick={() => {
                        setInstrument(p.id);
                        if (p.id === 'chromatic' || p.id === 'voice') setMode('auto');
                        else setMode('instrument');
                      }}
                    >
                      {t(key).toUpperCase()}
                    </PillButton>
                  );
                })}
              </div>
            </Card>

            {instrumentPreset.id !== 'chromatic' && instrumentPreset.id !== 'voice' && (
              <Card
                title={t('tuner.customTunings.title')}
                right={
                  <button
                    onClick={openCreate}
                    className="text-[10px] uppercase tracking-wider hover:underline"
                    style={{ color: 'var(--accent)', letterSpacing: '0.08em', background: 'transparent', border: 0, cursor: 'pointer' }}
                    title={t('tuner.customTunings.createTitle')}
                  >
                    {t('tuner.customTunings.add')}
                  </button>
                }
              >
                <div className="flex flex-col gap-1.5">
                  {[...instrumentPreset.tunings, ...customForInstrument].map((t) => {
                    const isCustom = 'createdAt' in t;
                    const isActive = tuningId === t.id;
                    return (
                      <TuningRow
                        key={t.id}
                        name={t.name}
                        notes={t.notes.map(dn).join(' ')}
                        active={isActive}
                        onClick={() => setTuningId(t.id)}
                        custom={isCustom}
                        favorite={isCustom ? (t as CustomTuning).favorite : false}
                        onFavorite={isCustom ? () => toggleFavoriteTuning(t.id) : undefined}
                        onEdit={isCustom ? () => openEdit(t as CustomTuning) : undefined}
                        onDelete={isCustom ? () => removeCustomTuning(t.id) : undefined}
                      />
                    );
                  })}
                </div>
              </Card>
            )}
          </div>

          {/* ────────── CENTRE COLUMN ────────── */}
          <div className="flex flex-col gap-4">
            <Card noPadding>
              <div
                className="flex items-center justify-center"
                style={{ padding: '24px 12px 12px' }}
              >
                <CircularTuner
                  noteLetter={bigLetter}
                  octave={bigOctave}
                  cents={reading.targetCents}
                  liveCents={liveCentsRef}
                  hz={reading.smoothHz}
                  statusText={statusText.toUpperCase()}
                  statusColor={statusColor}
                  locked={locked}
                  active={active}
                  size={420}
                />
              </div>
              <div
                className="flex items-center justify-between px-5 py-3 text-[11px] font-mono"
                style={{
                  color: 'var(--text-muted)',
                  borderTop: '1px solid var(--border)',
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                <span>{hzText || '—'}</span>
                <span style={{ color: statusColor }}>{centsText}</span>
                <span>{targetHzText || '—'}</span>
              </div>
              {/* Sub-label (which string/note is being tracked).
                  Fixed height so the panel doesn't pulse vertically
                  as notes come and go. */}
              <div
                className="text-center text-[11px] truncate"
                style={{
                  color: 'var(--text-secondary)',
                  height: 22,
                  lineHeight: '22px',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  padding: '0 16px 8px',
                }}
                title={subLabel}
              >
                {subLabel || ' '}
              </div>
            </Card>

            {/* Bottom metrics strip — Input level / Stability /
                Sensitivity. All three values are REAL: level = RMS
                from rms(); stability = consecutive-frames-latched
                fraction from the smoother; sensitivity is the user
                preset (Low/Medium/High) driving the silence gate. */}
            <Card noPadding>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr 1fr',
                  gap: 0,
                }}
              >
                <BottomMetric label={t('tuner.metrics.inputLevel')}>
                  <LevelBar level={reading.level} active={running} />
                </BottomMetric>
                <BottomMetric label={t('tuner.metrics.stability')} divider>
                  <span
                    className="font-bold"
                    style={{
                      fontSize: 22,
                      color: reading.stability >= 0.99
                        ? '#22c55e'
                        : reading.stability >= 0.5
                          ? '#f59e0b'
                          : 'var(--text-muted)',
                      fontVariantNumeric: 'tabular-nums',
                    }}
                  >
                    {running ? `${Math.round(reading.stability * 100)}%` : '—'}
                  </span>
                </BottomMetric>
                <BottomMetric label={t('tuner.metrics.sensitivity')} divider>
                  <span
                    className="font-bold uppercase tracking-wider"
                    style={{
                      fontSize: 18,
                      color: sensitivity === 'high'
                        ? '#f59e0b'
                        : sensitivity === 'low'
                          ? 'var(--text-muted)'
                          : 'var(--accent)',
                      letterSpacing: '0.08em',
                    }}
                  >
                    {t(`tuner.sensitivity.${sensitivity}` as TKey)}
                  </span>
                </BottomMetric>
              </div>
            </Card>

            {/* Strings ribbon for the active tuning. Sits below the
                main display in the centre column so the player can
                click directly without crossing the page. */}
            {instrumentPreset.id !== 'chromatic' && instrumentPreset.id !== 'voice'
              && activeTuning.notes.length > 0 && (
              <Card title={t('tuner.strings.title')} right={<ModePicker mode={mode} onChange={setMode} />}>
                <div className="flex flex-wrap gap-2">
                  {activeTuning.notes.map((noteName, idx) => {
                    const isActive = reading.activeStringIdx === idx;
                    const isSelected = mode === 'single-string' && singleString === noteName;
                    const playing = tonePlayingNote === noteName;
                    return (
                      <div
                        key={`${noteName}-${idx}`}
                        className="flex flex-col items-stretch rounded-lg overflow-hidden"
                        style={{
                          background: isActive
                            ? 'color-mix(in srgb, var(--accent) 22%, transparent)'
                            : isSelected ? 'var(--surface-elevated)' : 'var(--surface)',
                          border: `1px solid ${isActive ? 'var(--accent)' : isSelected ? 'var(--accent)' : 'var(--border)'}`,
                          minWidth: 70,
                          transition: 'background-color 200ms, border-color 200ms',
                        }}
                      >
                        <button
                          onClick={() => {
                            setMode('single-string');
                            setSingleString(noteName);
                          }}
                          className="px-2 pt-2 pb-1 font-mono font-bold text-center"
                          style={{
                            fontSize: 17,
                            color: isActive ? 'var(--accent)' : 'var(--text-primary)',
                            background: 'transparent', border: 0, cursor: 'pointer',
                          }}
                          title={t('tuner.tuneNoteOnly', { note: dn(noteName) })}
                        >
                          {dn(noteName)}
                        </button>
                        <button
                          onClick={() => playNote(noteName)}
                          className="text-[10px] py-1 hover:bg-[var(--surface-elevated)]"
                          style={{
                            color: playing ? 'var(--accent)' : 'var(--text-muted)',
                            background: 'transparent', border: 0,
                            borderTop: '1px solid var(--border)',
                            cursor: 'pointer',
                          }}
                          title={t('tuner.playReferenceTone')}
                        >
                          <Volume2 size={11} style={{ display: 'inline', marginRight: 4 }} />
                          {playing ? t('tuner.stopShort') : t('tuner.playShort')}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </Card>
            )}

            {/* Single-string note picker for chromatic / voice instruments. */}
            {(instrumentPreset.id === 'chromatic' || instrumentPreset.id === 'voice') && (
              <Card title={t('tuner.targetNote')} right={<ModePicker mode={mode} onChange={setMode} />}>
                {mode === 'single-string' ? (
                  <div className="flex items-center gap-2">
                    <input
                      value={singleString}
                      onChange={(e) => setSingleString(e.target.value)}
                      placeholder={t('tuner.notePlaceholder')}
                      className="rounded px-2 py-1.5 text-sm font-mono"
                      style={{ background: 'var(--surface-elevated)', color: 'var(--text-primary)', border: '1px solid var(--border)', width: 110 }}
                    />
                    <button
                      onClick={() => playNote(singleString)}
                      className="flex items-center gap-1 px-2 py-1.5 rounded text-xs"
                      style={{ background: 'var(--surface-elevated)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}
                    >
                      <Volume2 size={11} /> {tonePlayingNote === singleString ? t('tuner.stopShort') : t('tuner.playShort')}
                    </button>
                  </div>
                ) : (
                  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                    {t('tuner.autoDetectHint')}
                  </p>
                )}
              </Card>
            )}
          </div>

          {/* ────────── RIGHT COLUMN ────────── */}
          <div className="flex flex-col gap-4">
            <Card title={t('tuner.calibration.title')}>
              <div className="grid grid-cols-2 gap-1.5 mb-2">
                {A4_PRESETS.map((hz) => (
                  <PillButton
                    key={hz}
                    active={a4Hz === hz}
                    onClick={() => setA4Hz(hz)}
                  >
                    {hz}
                  </PillButton>
                ))}
              </div>
              <div className="flex items-center gap-2 mb-2">
                <input
                  type="number"
                  value={a4Hz}
                  onChange={(e) => setA4Hz(clampA4(parseFloat(e.target.value)))}
                  step="0.1"
                  min={300}
                  max={500}
                  className="rounded text-xs font-mono px-2 py-1.5 flex-1"
                  style={{ background: 'var(--surface-elevated)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
                  title={t('tuner.calibration.customA4')}
                />
                <span className="text-[10px] uppercase" style={{ color: 'var(--text-muted)', letterSpacing: '0.1em' }}>Hz</span>
              </div>
              <label className="flex items-center gap-2 text-[11px]" style={{ color: 'var(--text-secondary)' }}>
                <input
                  type="checkbox"
                  checked={preferFlats}
                  onChange={(e) => setPreferFlats(e.target.checked)}
                />
                {t('tuner.calibration.showFlats')}
              </label>
            </Card>

            <Card title={t('tuner.systemControls.title')}>
              <div className="flex flex-col gap-1.5">
                {/* Reference tone — plays the current single-string
                    target so the user can match it by ear. */}
                <PillButton
                  outline
                  onClick={() => {
                    const noteName = mode === 'single-string'
                      ? singleString
                      : (reading.targetNoteName ?? activeTuning.notes[0] ?? 'A4');
                    if (noteName) playNote(noteName);
                  }}
                >
                  <Volume2 size={12} className="inline-block mr-1.5" />
                  {tonePlayingNote ? t('tuner.stopTone') : t('tuner.referenceTone')}
                </PillButton>

                {/* Reference-sound style: a synthesised instrument
                    voice (plucked / bowed string matching the preset)
                    or the plain sine tone. */}
                <div
                  className="rounded-lg overflow-hidden"
                  style={{ border: '1px solid var(--border)', background: 'var(--surface-elevated)' }}
                >
                  <div className="px-3 pt-2 pb-1 text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-muted)', letterSpacing: '0.1em' }}>
                    {t('tuner.toneStyle.label')}
                  </div>
                  <div className="flex gap-1 px-2 pb-2">
                    {(['instrument', 'pure'] as const).map((s) => {
                      const key = `tuner.toneStyle.${s}` as TKey;
                      return (
                        <button
                          key={s}
                          onClick={() => setToneStyle(s)}
                          className="flex-1 py-1 rounded text-[10px] uppercase font-semibold"
                          style={{
                            background: toneStyle === s ? 'var(--accent)' : 'transparent',
                            color: toneStyle === s ? 'white' : 'var(--text-secondary)',
                            border: '1px solid var(--border)',
                            letterSpacing: '0.08em',
                            cursor: 'pointer',
                          }}
                        >
                          {t(key)}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Audio device picker. Replaces the "AUDIO SETTINGS"
                    placeholder in the reference design with the real
                    thing — there's no separate audio-settings panel
                    to defer to. */}
                <div
                  className="rounded-lg overflow-hidden"
                  style={{ border: '1px solid var(--border)', background: 'var(--surface-elevated)' }}
                >
                  <div className="px-3 pt-2 pb-1 text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-muted)', letterSpacing: '0.1em' }}>
                    {t('tuner.microphone')}
                  </div>
                  {/* Native <select> opens a browser-drawn list whose
                      items inherit `color` / `background` from the
                      select and the <option> elements. Setting only
                      `background: transparent` on the select made the
                      open menu render dark-on-dark and unreadable.
                      Give the select AND each option explicit
                      high-contrast colours — that's the only way to
                      style the OS popup list reliably across Chromium
                      versions. */}
                  <select
                    value={deviceId ?? ''}
                    onChange={(e) => void onPickDevice(e.target.value)}
                    disabled={devices.length === 0}
                    className="w-full px-3 pb-2 text-xs"
                    style={{
                      background: 'var(--surface-elevated)',
                      color: 'var(--text-primary)',
                      border: 0,
                      outline: 'none',
                      // The popup adopts these colours too.
                      colorScheme: 'dark',
                    }}
                  >
                    {devices.length === 0 && (
                      <option
                        value=""
                        style={{ background: 'var(--surface-elevated)', color: 'var(--text-muted)' }}
                      >
                        {t('tuner.startToEnumerate')}
                      </option>
                    )}
                    {devices.map((d) => (
                      <option
                        key={d.deviceId}
                        value={d.deviceId}
                        style={{ background: 'var(--surface-elevated)', color: 'var(--text-primary)' }}
                      >
                        {d.label}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Sensitivity preset — drives the silence-RMS gate. */}
                <div
                  className="rounded-lg overflow-hidden"
                  style={{ border: '1px solid var(--border)', background: 'var(--surface-elevated)' }}
                >
                  <div className="px-3 pt-2 pb-1 text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-muted)', letterSpacing: '0.1em' }}>
                    {t('tuner.sensitivity.label')}
                  </div>
                  <div className="flex gap-1 px-2 pb-2">
                    {(['low', 'medium', 'high'] as const).map((s) => {
                      const key = `tuner.sensitivity.${s}` as TKey;
                      return (
                        <button
                          key={s}
                          onClick={() => setSensitivity(s)}
                          className="flex-1 py-1 rounded text-[10px] uppercase font-semibold"
                          style={{
                            background: sensitivity === s ? 'var(--accent)' : 'transparent',
                            color: sensitivity === s ? 'white' : 'var(--text-secondary)',
                            border: '1px solid var(--border)',
                            letterSpacing: '0.08em',
                            cursor: 'pointer',
                          }}
                        >
                          {t(key)}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Engine info readout — shows the real audio details
                    once running. Not interactive; the reference's
                    "DSP SETTINGS" panel is folded into this. */}
                <div
                  className="rounded-lg overflow-hidden px-3 py-2 text-[11px]"
                  style={{ border: '1px solid var(--border)', background: 'var(--surface-elevated)', color: 'var(--text-secondary)' }}
                >
                  <div className="uppercase tracking-wider text-[10px] mb-1" style={{ color: 'var(--text-muted)', letterSpacing: '0.1em' }}>
                    {t('tuner.engine')}
                  </div>
                  <div className="flex items-center justify-between font-mono">
                    <span><Activity size={10} className="inline-block mr-1" />YIN + DFT · {ANALYSIS_BUFFER}</span>
                    <span>{engineInfo ? `${(engineInfo.sampleRate / 1000).toFixed(1)} kHz` : '—'}</span>
                  </div>
                </div>
              </div>
            </Card>
          </div>
        </div>
      </div>

      {showEditor && (
        <CustomTuningEditor
          draft={showEditor.draft}
          onCancel={() => setShowEditor(null)}
          onSave={onSaveDraft}
        />
      )}
    </div>
  );
}

/* ────────────────────────── helpers ────────────────────────── */

/**
 * Card wrapper used by every cell of the three-column layout.
 * `noPadding` lets the centre column's main display attach a custom
 * border-divided footer without an unwanted inner gap.
 */
function Card({
  title, right, dotColor, children, noPadding,
}: {
  title?: string;
  right?: React.ReactNode;
  /** Small status dot rendered next to the title (matches the "live"
   *  indicator in the reference design). */
  dotColor?: string;
  children: React.ReactNode;
  noPadding?: boolean;
}): React.ReactElement {
  return (
    <div
      className="rounded-xl overflow-hidden"
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        // Subtle inner highlight so cards lift off the page background.
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.03)',
      }}
    >
      {(title || right) && (
        <div
          className="flex items-center justify-between"
          style={{
            padding: '10px 14px',
            borderBottom: '1px solid var(--border)',
          }}
        >
          <div className="flex items-center gap-2 min-w-0">
            {dotColor !== undefined && (
              <span
                aria-hidden="true"
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: '50%',
                  background: dotColor,
                  boxShadow: `0 0 6px ${dotColor}`,
                  flexShrink: 0,
                }}
              />
            )}
            {title && (
              <span
                className="text-[10px] uppercase tracking-wider truncate"
                style={{ color: 'var(--text-muted)', letterSpacing: '0.12em' }}
              >
                {title}
              </span>
            )}
          </div>
          {right}
        </div>
      )}
      <div style={{ padding: noPadding ? 0 : 12 }}>{children}</div>
    </div>
  );
}

/** Top-bar mini card — small label above a bold value. */
function MiniStat({
  label, value, accent,
}: { label: string; value: string; accent?: boolean }): React.ReactElement {
  return (
    <div
      className="flex flex-col items-center justify-center"
      style={{
        padding: '6px 14px',
        borderRadius: 10,
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        minWidth: 92,
      }}
    >
      <span
        className="text-[9px] uppercase tracking-wider"
        style={{ color: 'var(--text-muted)', letterSpacing: '0.12em' }}
      >
        {label}
      </span>
      <span
        className="font-bold"
        style={{
          fontSize: 15,
          color: accent ? 'var(--accent)' : 'var(--text-primary)',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {value}
      </span>
    </div>
  );
}

/** Full-width pill button used in the left + right sidebars. */
function PillButton({
  active, outline, onClick, children,
}: {
  active?: boolean;
  outline?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <button
      onClick={onClick}
      className="rounded-lg text-[11px] font-semibold transition-colors w-full"
      style={{
        padding: '9px 12px',
        background: active ? 'var(--accent)' : 'var(--surface-elevated)',
        color: active ? 'white' : 'var(--text-secondary)',
        border: `1px solid ${active ? 'var(--accent)' : outline ? 'var(--border)' : 'transparent'}`,
        letterSpacing: '0.06em',
        cursor: 'pointer',
        textAlign: 'center',
      }}
    >
      {children}
    </button>
  );
}

/** Tuning row in the left sidebar — name + ACTIVE/LOAD pill +
 *  custom-tuning actions when applicable. */
function TuningRow({
  name, notes, active, onClick, custom, favorite, onFavorite, onEdit, onDelete,
}: {
  name: string;
  notes: string;
  active: boolean;
  onClick: () => void;
  custom?: boolean;
  favorite?: boolean;
  onFavorite?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
}): React.ReactElement {
  const t = useT();
  return (
    <div
      className="rounded-lg"
      style={{
        background: active ? 'color-mix(in srgb, var(--accent) 14%, transparent)' : 'var(--surface-elevated)',
        border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
        padding: '8px 10px',
        transition: 'background-color 200ms, border-color 200ms',
      }}
    >
      <div className="flex items-center gap-2">
        <button
          onClick={onClick}
          className="flex-1 text-left"
          style={{ background: 'transparent', border: 0, cursor: 'pointer', padding: 0, minWidth: 0 }}
        >
          <div
            className="font-semibold truncate"
            style={{ fontSize: 12, color: active ? 'var(--accent)' : 'var(--text-primary)' }}
            title={name}
          >
            {name}
          </div>
        </button>
        {active ? (
          <span
            className="text-[9px] font-bold uppercase tracking-wider"
            style={{ color: 'var(--accent)', letterSpacing: '0.1em' }}
          >
            {t('tuner.tuningRow.active')}
          </span>
        ) : (
          <button
            onClick={onClick}
            className="text-[9px] font-bold uppercase tracking-wider hover:underline"
            style={{ color: 'var(--text-muted)', background: 'transparent', border: 0, cursor: 'pointer', letterSpacing: '0.1em' }}
          >
            {t('tuner.tuningRow.load')}
          </button>
        )}
      </div>
      <div
        className="text-[10px] font-mono truncate mt-0.5"
        style={{ color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}
        title={notes}
      >
        {notes}
      </div>
      {custom && (
        <div className="flex items-center gap-1 mt-1.5">
          <button
            onClick={onFavorite}
            className="p-1 rounded hover:bg-[var(--surface-elevated)]"
            style={{
              color: favorite ? '#f59e0b' : 'var(--text-muted)',
              background: 'transparent', border: 0, cursor: 'pointer',
            }}
            title={favorite ? t('tuner.tuningRow.removeFavorite') : t('tuner.tuningRow.favorite')}
          >
            <Star size={10} fill={favorite ? '#f59e0b' : 'none'} />
          </button>
          <button
            onClick={onEdit}
            className="p-1 rounded hover:bg-[var(--surface-elevated)]"
            style={{ color: 'var(--text-muted)', background: 'transparent', border: 0, cursor: 'pointer' }}
            title={t('common.edit')}
          >
            <Pencil size={10} />
          </button>
          <button
            onClick={onDelete}
            className="p-1 rounded hover:bg-[var(--surface-elevated)]"
            style={{ color: 'var(--danger, #ef4444)', background: 'transparent', border: 0, cursor: 'pointer' }}
            title={t('common.delete')}
          >
            <Trash2 size={10} />
          </button>
        </div>
      )}
    </div>
  );
}

/** A bottom-strip metric cell. */
function BottomMetric({
  label, divider, children,
}: { label: string; divider?: boolean; children: React.ReactNode }): React.ReactElement {
  return (
    <div
      className="flex flex-col items-center justify-center gap-1"
      style={{
        padding: '14px 12px',
        borderLeft: divider ? '1px solid var(--border)' : undefined,
      }}
    >
      <span
        className="text-[9px] uppercase tracking-wider"
        style={{ color: 'var(--text-muted)', letterSpacing: '0.12em' }}
      >
        {label}
      </span>
      {children}
    </div>
  );
}

/** RMS bar used in the bottom Input Level cell. */
function LevelBar({ level, active }: { level: number; active: boolean }): React.ReactElement {
  // Linear RMS is roughly logarithmic in perception — sqrt curve
  // so soft notes don't look like silence.
  const pct = active ? Math.min(100, Math.sqrt(level) * 180) : 0;
  return (
    <div
      style={{
        width: '100%',
        height: 8,
        borderRadius: 4,
        background: 'var(--surface-elevated)',
        marginTop: 4,
      }}
    >
      <div
        style={{
          width: `${pct}%`,
          height: '100%',
          borderRadius: 4,
          background: pct > 80 ? '#ef4444' : pct > 5 ? 'var(--accent)' : 'var(--text-muted)',
          transition: 'width 80ms linear, background-color 200ms',
        }}
      />
    </div>
  );
}

function ModePicker({ mode, onChange }: {
  mode: ReturnType<typeof useTunerStore.getState>['mode'];
  onChange: (m: ReturnType<typeof useTunerStore.getState>['mode']) => void;
}): React.ReactElement {
  const t = useT();
  const opts: Array<[typeof mode, string]> = [
    ['auto',          t('tuner.mode.auto')],
    ['instrument',    t('tuner.mode.instrument')],
    ['single-string', t('tuner.mode.single')],
  ];
  return (
    <div className="inline-flex rounded overflow-hidden" style={{ border: '1px solid var(--border)' }}>
      {opts.map(([id, label]) => (
        <button
          key={id}
          type="button"
          onClick={() => onChange(id)}
          className="px-2 py-0.5 text-[10px] font-semibold uppercase"
          style={{
            background: mode === id ? 'var(--accent)' : 'var(--surface)',
            color: mode === id ? 'white' : 'var(--text-secondary)',
            borderRight: id !== 'single-string' ? '1px solid var(--border)' : undefined,
            letterSpacing: '0.08em',
            cursor: 'pointer',
          }}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

/* ─────────────────── reading derivation ─────────────────── */

/**
 * Build the live reading the UI renders from one (rawFreq, smoothFreq,
 * level, stable, clarity) frame. Mode-aware: the cents/target the
 * meter shows depend on whether the user wants auto-chromatic, the
 * nearest tuning string, or a fixed single-string target.
 */
function computeReading(
  rawFreq: number | null,
  smoothFreq: number | null,
  latchedFreq: number | null,
  level: number,
  stable: boolean,
  stability: number,
  clarity: number,
  a4Hz: number,
  mode: ReturnType<typeof useTunerStore.getState>['mode'],
  strings: number[],
  stringNotes: string[],
  singleString: string,
  preferFlats: boolean,
): LiveReading {
  if (smoothFreq === null) {
    return { ...SILENT_READING, level };
  }

  // ── Identity vs. needle: a critical separation ────────────────
  // The big LETTER displayed and the cents TARGET are decided from
  // the LATCHED frequency (the pitch that's been stable for ≥
  // stabilityFrames). A single-frame YIN octave error can't change
  // that. The needle's cents value is still measured from the live
  // EMA against the latched target — so the needle moves smoothly
  // within the displayed note's ±50 ¢ window but the note name
  // itself doesn't flash.
  //
  // Before this fix, `note` came from `frequencyToNote(smoothFreq…)`
  // every frame and the cents target was the nearest note to the
  // EMA — when YIN flicked to a wrong octave, BOTH flipped, and the
  // user saw all the note names flashing.
  const identityFreq = latchedFreq ?? smoothFreq;
  const note = frequencyToNote(identityFreq, a4Hz, preferFlats);

  // Resolve which target the meter should track for this mode. We
  // record the LABEL KIND + the underlying English note name; the
  // renderer composes the visible string and applies the chord-
  // notation setting (English vs solfège) at display time, so the
  // rAF loop stays format-agnostic.
  let targetHz: number | null = null;
  let targetLabelKind: LiveReading['targetLabelKind'] = 'none';
  let targetNoteName: string | null = null;
  let activeStringIdx = -1;
  if ((mode === 'instrument' || mode === 'custom') && strings.length > 0) {
    // Use the latched freq to pick the string — so the active
    // string doesn't flip between two strings just because the EMA
    // momentarily wandered.
    const nearest = nearestStringIndex(identityFreq, strings);
    if (nearest) {
      activeStringIdx = nearest.index;
      targetHz = strings[nearest.index]!;
      targetNoteName = stringNotes[nearest.index] ?? null;
      targetLabelKind = 'closest-string';
    }
  } else if (mode === 'single-string') {
    targetHz = noteNameToFrequency(singleString, a4Hz);
    targetNoteName = singleString;
    targetLabelKind = 'target';
  } else {
    // Auto / chromatic: target = the nearest equal-tempered note to
    // the LATCHED pitch (same anti-flicker rationale).
    if (note) {
      targetHz = note.targetHz;
      targetNoteName = formatNote(note.note);
      targetLabelKind = 'nearest';
    }
  }

  // Cents reading uses the LIVE EMA against the LATCHED target. So
  // the needle moves with your playing in real time but it's always
  // measured against a stable reference, not a target that flips
  // mid-strum.
  const targetCents = targetHz !== null
    ? centsBetween(smoothFreq, targetHz)
    : null;

  return {
    rawHz: rawFreq,
    smoothHz: smoothFreq,
    note,
    targetCents,
    targetHz,
    targetLabelKind,
    targetNoteName,
    activeStringIdx,
    level,
    stable,
    stability,
    clarity,
  };
}

