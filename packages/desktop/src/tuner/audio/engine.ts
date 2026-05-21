/**
 * Audio engine for the tuner: microphone capture, device enumeration,
 * a high-pass filter to reject DC + rumble (40 Hz cutoff), and a
 * realtime time-domain buffer that the YIN detector consumes.
 *
 * Lifecycle:
 *   const engine = new TunerAudioEngine();
 *   await engine.start({ deviceId });            // permissions + open
 *   const samples = engine.getTimeDomainBuffer(); // poll each frame
 *   await engine.switchDevice(otherDeviceId);     // swap mic live
 *   await engine.stop();                          // release everything
 *
 * The engine owns ONE `AudioContext` for the lifetime of the page —
 * iOS / Chromium both penalise contexts that are repeatedly destroyed,
 * and the context is needed for reference-note playback too. Mic
 * input nodes (stream → source → high-pass → analyser) are torn down
 * and rebuilt on device switch; the AudioContext itself is suspended
 * but kept warm.
 */

export interface AudioInputDevice {
  deviceId: string;
  label: string;
}

export interface EngineStartOptions {
  /** Specific input device id to open. Defaults to "default". */
  deviceId?: string;
  /** FFT/analyser size — must be a power of 2 in [256, 32768]. The
   *  time-domain buffer length we hand to YIN matches this. Larger
   *  = lower minimum detectable frequency + better resolution but
   *  more CPU. 4096 at 48 kHz lets us go down to ~24 Hz pre-filter,
   *  comfortably covering low B (31 Hz) on a 5-string bass. */
  fftSize?: number;
  /** Cutoff of the high-pass filter applied before analysis, in Hz.
   *  Defaults to 40 Hz to kill mains hum / mic rumble without
   *  attacking the bass strings (E1 ≈ 41 Hz, low B ≈ 31 Hz — push
   *  to 25 Hz if you tune a 5-string). */
  highPassHz?: number;
}

export class TunerAudioEngine {
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private highpass: BiquadFilterNode | null = null;
  private analyser: AnalyserNode | null = null;
  private buffer: Float32Array | null = null;
  private currentDeviceId: string | undefined;
  private currentFftSize = 4096;

  /** Whether the engine is currently capturing. */
  get running(): boolean {
    return this.stream !== null && this.analyser !== null;
  }

  /** Active mic device id, or undefined when not running. */
  get deviceId(): string | undefined {
    return this.currentDeviceId;
  }

  /** Sample rate of the current AudioContext, or 48000 as a sane
   *  default before `start()` has been called. */
  get sampleRate(): number {
    return this.ctx?.sampleRate ?? 48000;
  }

  /**
   * List available audio input devices. The labels are populated by
   * the browser only AFTER the user has granted microphone permission
   * — call once on engine start, then again after `start()` resolves
   * to refresh labels.
   */
  async listInputDevices(): Promise<AudioInputDevice[]> {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.enumerateDevices) {
      return [];
    }
    const all = await navigator.mediaDevices.enumerateDevices();
    return all
      .filter((d) => d.kind === 'audioinput')
      .map((d, i) => ({
        deviceId: d.deviceId,
        label: d.label || `Microphone ${i + 1}`,
      }));
  }

  /** Open the mic and start streaming. Idempotent — calling again
   *  while already running is a no-op unless the device id changes. */
  async start(opts: EngineStartOptions = {}): Promise<void> {
    if (this.running && opts.deviceId === this.currentDeviceId) return;
    if (this.running) {
      await this.switchDevice(opts.deviceId);
      return;
    }

    this.currentFftSize = opts.fftSize ?? 4096;

    // One AudioContext for the page lifetime.
    if (!this.ctx) {
      const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      // latencyHint:'interactive' is the lowest-latency mode browsers
      // honour for non-pro audio. We don't ask for sampleRate — let
      // the device's native rate through so getUserMedia can avoid
      // an extra resample.
      this.ctx = new Ctor({ latencyHint: 'interactive' });
    }
    if (this.ctx.state === 'suspended') await this.ctx.resume();

    // getUserMedia constraints: kill the browser's voice-DSP defaults.
    // Echo cancel / noise suppression / AGC mangle pitch — they're
    // tuned for speech, not instruments, and produce wrong YIN reads.
    const constraints: MediaStreamConstraints = {
      audio: {
        deviceId: opts.deviceId ? { exact: opts.deviceId } : undefined,
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: 1,
      },
      video: false,
    };
    this.stream = await navigator.mediaDevices.getUserMedia(constraints);
    this.currentDeviceId = this.stream.getAudioTracks()[0]?.getSettings().deviceId ?? opts.deviceId;

    this.buildGraph(opts.highPassHz ?? 40);
  }

  /** Swap the mic without dropping the AudioContext. */
  async switchDevice(deviceId?: string): Promise<void> {
    if (!this.ctx) {
      await this.start({ deviceId });
      return;
    }
    this.tearDownInputGraph();
    const constraints: MediaStreamConstraints = {
      audio: {
        deviceId: deviceId ? { exact: deviceId } : undefined,
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: 1,
      },
      video: false,
    };
    this.stream = await navigator.mediaDevices.getUserMedia(constraints);
    this.currentDeviceId = this.stream.getAudioTracks()[0]?.getSettings().deviceId ?? deviceId;
    this.buildGraph(40);
  }

  /** Stop capture and release the mic. Keeps the AudioContext alive
   *  for reference-note playback. */
  async stop(): Promise<void> {
    this.tearDownInputGraph();
    this.currentDeviceId = undefined;
  }

  /** Fully tear down — call on component unmount. */
  async dispose(): Promise<void> {
    await this.stop();
    if (this.ctx) {
      try { await this.ctx.close(); } catch { /* already closed */ }
      this.ctx = null;
    }
  }

  /** Returns the same Float32Array each call (filled in place) with
   *  the latest time-domain samples from the analyser. The caller
   *  should treat this as an immutable snapshot and not keep refs. */
  getTimeDomainBuffer(): Float32Array | null {
    if (!this.analyser || !this.buffer) return null;
    this.analyser.getFloatTimeDomainData(this.buffer);
    return this.buffer;
  }

  /** The shared AudioContext, so other modules (reference-note
   *  player) can attach to the same audio graph. */
  get audioContext(): AudioContext | null {
    return this.ctx;
  }

  private buildGraph(highPassHz: number): void {
    if (!this.ctx || !this.stream) return;
    this.source = this.ctx.createMediaStreamSource(this.stream);
    this.highpass = this.ctx.createBiquadFilter();
    this.highpass.type = 'highpass';
    this.highpass.frequency.value = highPassHz;
    this.highpass.Q.value = 0.707; // Butterworth-ish, no resonant peak.
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = this.currentFftSize;
    // Smoothing on the analyser only affects the frequency-domain
    // bins, not the time-domain data we read for YIN — leave default.
    this.buffer = new Float32Array(this.analyser.fftSize);
    this.source.connect(this.highpass);
    this.highpass.connect(this.analyser);
    // No connection to the destination — we don't want to monitor
    // the mic through the speakers (would feed back).
  }

  private tearDownInputGraph(): void {
    try { this.analyser?.disconnect(); } catch { /* ignore */ }
    try { this.highpass?.disconnect(); } catch { /* ignore */ }
    try { this.source?.disconnect(); } catch { /* ignore */ }
    this.analyser = null;
    this.highpass = null;
    this.source = null;
    this.buffer = null;
    if (this.stream) {
      for (const track of this.stream.getTracks()) track.stop();
      this.stream = null;
    }
  }
}
