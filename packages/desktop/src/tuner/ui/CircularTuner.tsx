import React, { useEffect, useRef } from 'react';

/**
 * Circular tuning display — concentric rings + a rotating needle
 * that sweeps the top arc from -50 ¢ (left, 9 o'clock) through 0 ¢
 * (12 o'clock) to +50 ¢ (right, 3 o'clock). Inspired by hi-end
 * hardware tuner UIs and the user-supplied reference.
 *
 * Pure presentational SVG — every visual property comes from props
 * so the parent owns timing / smoothing / colour decisions. The
 * needle uses a CSS rotate transform on a sub-group so we get a
 * GPU-accelerated transition between frames (no full re-render of
 * the SVG geometry per rAF).
 *
 * Visual rules (matched to commercial tuners + the reference):
 *   - Big letter dominates the centre.
 *   - Detected frequency under the letter, status text under that.
 *   - Three tick labels:  -50  0  +50  positioned at 9 / 12 / 3.
 *   - Needle colour: green ≤ ±5 ¢, amber ≤ ±15 ¢, red beyond.
 *   - Soft accent glow when the latched note is stable + in tune.
 */

const SPAN_CENTS = 50;
/** The needle sweeps across the top half: -90° (left) to +90° (right),
 *  with 0 ¢ at -90° + 90° = straight up. */
const ARC_START_DEG = -90;
const ARC_END_DEG = 90;

export interface CircularTunerProps {
  /** Big-letter (without octave). e.g. "E", "A♯", "B♭". */
  noteLetter: string;
  /** Octave shown as a small superscript next to the letter, or null. */
  octave: number | null;
  /** Smoothed cents in [-50, 50], or null when there's no signal.
   *  Drives the colours / labels (updated at the page's ~30 Hz UI
   *  rate). */
  cents: number | null;
  /**
   * Optional LIVE cents source for the needle — a ref the page
   * updates every detection frame (60 Hz) without a React render.
   * The needle is animated by a critically-damped spring toward
   * whatever this holds, so it moves at full frame rate with no
   * CSS-transition lag and no render-throttle stepping. Falls back
   * to `cents` when not provided.
   */
  liveCents?: React.RefObject<number | null>;
  /** Detected frequency in Hz for the readout under the letter. */
  hz: number | null;
  /** Status line ("Perfect calibration", "Tune down", …) */
  statusText: string;
  /** Optional status colour override (e.g. green when locked). */
  statusColor?: string;
  /** True once the latched note is stable AND within ±5 ¢. */
  locked: boolean;
  /** Renders dimmed when there's no current pitch reading. */
  active: boolean;
  /** Accent colour used for the rings + needle when in tune. */
  accent?: string;
  /** Diameter in pixels. The component is square. */
  size?: number;
}

export default function CircularTuner({
  noteLetter,
  octave,
  cents,
  liveCents,
  hz,
  statusText,
  statusColor,
  locked,
  active,
  accent = 'var(--accent)',
  size = 360,
}: CircularTunerProps): React.ReactElement {
  const r = size / 2;
  // SVG uses a viewBox of 1000 × 1000 so all the magic numbers below
  // are unit-less and scale with `size`.
  const VB = 1000;
  const cx = VB / 2;
  const cy = VB / 2;
  // Three nested ring radii, working in from the outside.
  const ringRadii = [480, 410, 340];
  /** Centre disc the letter sits inside. */
  const coreRadius = 250;

  // Needle math. Clamp cents to the visible span; map -50..+50 → -90°..+90°.
  const clampedCents = cents === null ? 0 : Math.max(-SPAN_CENTS, Math.min(SPAN_CENTS, cents));

  // ── Spring-driven needle ────────────────────────────────────────
  // A real meter needle has mass and damping; that is what makes it
  // read as "accurate" — it neither twitches with every frame nor
  // lags behind the string. We integrate a critically-damped spring
  // (no overshoot, fastest settle) toward the live cents value every
  // animation frame and write the rotation straight to the DOM node,
  // bypassing React state and CSS transitions. Natural frequency
  // 3.2 Hz ⇒ settles within ~1 % in ≈ 300 ms.
  const needleRef = useRef<SVGGElement>(null);
  const centsPropRef = useRef<number | null>(cents);
  centsPropRef.current = cents;
  const springRef = useRef({ angle: 0, vel: 0, last: 0 });
  useEffect(() => {
    let raf = 0;
    const OMEGA = 2 * Math.PI * 3.2;
    const tick = (now: number): void => {
      const st = springRef.current;
      const dt = st.last > 0 ? Math.min(0.05, (now - st.last) / 1000) : 1 / 60;
      st.last = now;
      const c = liveCents ? liveCents.current : centsPropRef.current;
      const clamped = c === null ? 0 : Math.max(-SPAN_CENTS, Math.min(SPAN_CENTS, c));
      const target = (clamped / SPAN_CENTS) * 90;
      const accel = OMEGA * OMEGA * (target - st.angle) - 2 * OMEGA * st.vel;
      st.vel += accel * dt;
      st.angle += st.vel * dt;
      if (needleRef.current) {
        needleRef.current.style.transform = `rotate(${st.angle.toFixed(3)}deg)`;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [liveCents]);

  // Colour state for the needle and the inner-most ring's stroke
  // gradient — matches the cents-meter convention.
  const absC = Math.abs(clampedCents);
  const inTune = absC <= 5;
  const closeIsh = absC <= 15;
  const stateColor = !active
    ? 'rgba(255,255,255,0.18)'
    : inTune ? '#22c55e'    // green
    : closeIsh ? '#f59e0b'  // amber
    : '#ef4444';            // red

  // Build the three tick positions (-50, 0, +50) — used both for
  // the tick marks and the labels.
  const tickAngles = [-90, 0, 90]; // degrees from straight up (12 o'clock)

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${VB} ${VB}`}
      role="img"
      aria-label={
        cents === null
          ? 'No signal'
          : `${noteLetter}${octave ?? ''} ${clampedCents > 0 ? '+' : ''}${clampedCents.toFixed(0)} cents`
      }
    >
      <defs>
        {/* Subtle radial gradient inside the core so the letter
            floats over a soft glow rather than a flat disc. */}
        <radialGradient id="ct-core" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="rgba(255,255,255,0.06)" />
          <stop offset="60%" stopColor="rgba(255,255,255,0.02)" />
          <stop offset="100%" stopColor="rgba(0,0,0,0)" />
        </radialGradient>
        {/* Inner ring stroke gradient: tinted to the current state
            colour so the whole thing reads green/amber/red at a
            glance even before the user looks at the needle. */}
        <linearGradient id="ct-ring" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor={stateColor} stopOpacity={active ? 0.55 : 0.15} />
          <stop offset="100%" stopColor={stateColor} stopOpacity={active ? 0.15 : 0.05} />
        </linearGradient>
      </defs>

      {/* Outer faint rings — purely decorative depth. */}
      {ringRadii.map((rr, i) => (
        <circle
          key={i}
          cx={cx} cy={cy} r={rr}
          fill="none"
          stroke="rgba(255,255,255,0.05)"
          strokeWidth={1.5}
        />
      ))}

      {/* Inner accent ring — picks up the state colour. */}
      <circle
        cx={cx} cy={cy} r={ringRadii[ringRadii.length - 1]!}
        fill="none"
        stroke="url(#ct-ring)"
        strokeWidth={2}
      />

      {/* Tick arc backdrop: a faint dashed circle at the same radius
          as the labels so the eye reads "this is the cents scale". */}
      <circle
        cx={cx} cy={cy} r={ringRadii[0]! - 30}
        fill="none"
        stroke="rgba(255,255,255,0.06)"
        strokeWidth={1}
        strokeDasharray="2 6"
      />

      {/* Tick labels at -50, 0, +50. Positioned in polar coords
          relative to the outermost ring. */}
      {tickAngles.map((deg) => {
        const labelR = ringRadii[0]! - 70;
        const rad = (deg - 90) * (Math.PI / 180); // -90 so 0° is up
        const x = cx + labelR * Math.cos(rad);
        const y = cy + labelR * Math.sin(rad);
        const label = deg === -90 ? '−50' : deg === 90 ? '+50' : '0';
        return (
          <text
            key={deg}
            x={x} y={y}
            textAnchor="middle"
            dominantBaseline="middle"
            fontSize={30}
            fill={deg === 0 ? stateColor : 'rgba(255,255,255,0.45)'}
            opacity={active || deg === 0 ? 1 : 0.6}
            style={{ fontVariantNumeric: 'tabular-nums', transition: 'fill 200ms' }}
          >
            {label}
          </text>
        );
      })}

      {/* Tick marks every 10 ¢ across the top arc (eleven marks
          from -50 to +50). Major every 25 ¢. */}
      {Array.from({ length: 11 }, (_, i) => {
        const c = -50 + i * 10;
        const deg = ARC_START_DEG + ((c + 50) / 100) * (ARC_END_DEG - ARC_START_DEG);
        const major = c % 25 === 0;
        const rad = (deg - 90) * (Math.PI / 180);
        const r1 = ringRadii[1]! + 4;
        const r2 = ringRadii[1]! + (major ? 24 : 14);
        return (
          <line
            key={i}
            x1={cx + r1 * Math.cos(rad)}
            y1={cy + r1 * Math.sin(rad)}
            x2={cx + r2 * Math.cos(rad)}
            y2={cy + r2 * Math.sin(rad)}
            stroke={c === 0 ? stateColor : 'rgba(255,255,255,0.35)'}
            strokeWidth={major ? 3 : 1.5}
            opacity={active ? 1 : 0.45}
            style={{ transition: 'stroke 200ms' }}
          />
        );
      })}

      {/* The needle. Drawn as a thin tapered triangle running from
          the centre to just beyond the tick ring. Rotated via a
          transform on the group so we get a CSS-smooth transition
          between frames. */}
      <g
        ref={needleRef}
        style={{
          // Rotation is written by the spring loop above every frame;
          // no CSS transition — the spring IS the motion model.
          transformOrigin: `${cx}px ${cy}px`,
        }}
      >
        {/* Soft glow */}
        <line
          x1={cx} y1={cy}
          x2={cx} y2={cy - (ringRadii[1]! + 24)}
          stroke={stateColor}
          strokeWidth={14}
          strokeLinecap="round"
          opacity={active ? (locked ? 0.35 : 0.18) : 0}
          style={{ transition: 'opacity 200ms, stroke 200ms' }}
        />
        {/* Needle body */}
        <line
          x1={cx} y1={cy + 20}
          x2={cx} y2={cy - (ringRadii[1]! + 24)}
          stroke={stateColor}
          strokeWidth={4}
          strokeLinecap="round"
          opacity={active ? 1 : 0.3}
          style={{ transition: 'stroke 200ms' }}
        />
      </g>

      {/* Centre core */}
      <circle cx={cx} cy={cy} r={coreRadius} fill="url(#ct-core)" />
      <circle
        cx={cx} cy={cy} r={coreRadius}
        fill="none"
        stroke={stateColor}
        strokeOpacity={active ? (locked ? 0.5 : 0.2) : 0.08}
        strokeWidth={2}
        style={{ transition: 'stroke 200ms, stroke-opacity 200ms' }}
      />
      {/* Pivot dot */}
      <circle cx={cx} cy={cy} r={8} fill={stateColor} opacity={active ? 1 : 0.3} />

      {/* The big letter. We use SVG <text> at a huge font-size so it
          scales with the SVG itself; the parent doesn't need to
          measure anything. */}
      <text
        x={cx} y={cy - 30}
        textAnchor="middle"
        dominantBaseline="middle"
        fontSize={260}
        fontWeight={700}
        fill={active ? (inTune ? stateColor : accent) : 'rgba(255,255,255,0.25)'}
        style={{
          fontVariantNumeric: 'tabular-nums',
          transition: 'fill 200ms',
          filter: locked ? `drop-shadow(0 0 18px ${stateColor})` : undefined,
        }}
      >
        {noteLetter || '—'}
      </text>

      {/* Octave superscript */}
      {octave !== null && noteLetter && (
        <text
          x={cx + 110} y={cy - 100}
          textAnchor="start"
          dominantBaseline="middle"
          fontSize={56}
          fontWeight={500}
          fill={active ? 'rgba(255,255,255,0.55)' : 'rgba(255,255,255,0.2)'}
          style={{ transition: 'fill 200ms' }}
        >
          {octave}
        </text>
      )}

      {/* Detected frequency, large but smaller than the letter. */}
      <text
        x={cx} y={cy + 110}
        textAnchor="middle"
        dominantBaseline="middle"
        fontSize={42}
        fontWeight={600}
        fill="rgba(255,255,255,0.85)"
        style={{ fontVariantNumeric: 'tabular-nums' }}
      >
        {hz !== null ? `${hz.toFixed(2)} Hz` : '— Hz'}
      </text>

      {/* Status text — colour follows whichever the parent chose
          (green when in tune, muted otherwise). */}
      <text
        x={cx} y={cy + 158}
        textAnchor="middle"
        dominantBaseline="middle"
        fontSize={26}
        fontWeight={500}
        fill={statusColor ?? (inTune && active ? '#22c55e' : 'rgba(255,255,255,0.55)')}
        style={{ letterSpacing: '0.06em', textTransform: 'uppercase', transition: 'fill 200ms' }}
      >
        {statusText}
      </text>
    </svg>
  );
}
