import React from 'react';

/**
 * Horizontal cents meter — the "needle" the user watches while
 * tuning. ±50 cents covers exactly half a semitone, which is the
 * universal convention (beyond ±50 the closest note flips).
 *
 * Visual rules:
 *   - centred tick is the target.
 *   - colour is red beyond ±15 ¢, amber between 5 and 15 ¢, green
 *     within ±5 ¢ (the band a trained ear can't distinguish from
 *     true). Matches every commercial tuner.
 *   - the needle is rendered as a vertical line; we DON'T animate
 *     by re-rendering — the parent passes the smoothed value each
 *     frame from rAF, and CSS transitions add the final glide.
 */

const SPAN_CENTS = 50;

export default function CentsMeter({
  cents,
  active,
  stable,
}: {
  /** Smoothed cents in [-SPAN_CENTS, SPAN_CENTS], or null for "no signal". */
  cents: number | null;
  /** True when there's a current pitch reading (controls dimming). */
  active: boolean;
  /** True when the latched note is stable (boosts the green glow). */
  stable: boolean;
}): React.ReactElement {
  const clamped = cents === null ? 0 : Math.max(-SPAN_CENTS, Math.min(SPAN_CENTS, cents));
  // Map -50..+50 → 0..100% of the meter width.
  const xPct = ((clamped + SPAN_CENTS) / (2 * SPAN_CENTS)) * 100;
  const absC = Math.abs(clamped);

  const inTune = absC <= 5;
  const closeIsh = absC <= 15;
  const color = !active
    ? 'var(--text-muted)'
    : inTune ? '#22c55e'      // green
    : closeIsh ? '#f59e0b'    // amber
    : '#ef4444';              // red

  return (
    <div
      role="img"
      aria-label={
        cents === null ? 'No signal'
        : `${clamped > 0 ? '+' : ''}${clamped.toFixed(0)} cents`
      }
      style={{ width: '100%', height: 92, position: 'relative', userSelect: 'none' }}
    >
      {/* Tick rail with major ticks at -50, -25, 0, +25, +50 and
          minor ticks every 5 cents. Drawn as SVG so it scales
          crisply across desktop resolutions. */}
      <svg width="100%" height="100%" viewBox="0 0 1000 92" preserveAspectRatio="none">
        {/* Background rail */}
        <rect x="0" y="58" width="1000" height="6" rx="3"
          fill="var(--surface-elevated)" />
        {/* Green centre band (±5 ¢) — gives the eye a clear target. */}
        <rect
          x={(1000 / 2) - (5 / SPAN_CENTS) * (1000 / 2)}
          y="56" width={(5 / SPAN_CENTS) * 1000} height="10" rx="2"
          fill="color-mix(in srgb, #22c55e 28%, transparent)"
        />
        {/* Minor ticks every 5 ¢. */}
        {Array.from({ length: 21 }, (_, i) => {
          const c = -50 + i * 5;
          const x = ((c + SPAN_CENTS) / (2 * SPAN_CENTS)) * 1000;
          const major = c % 25 === 0;
          return (
            <line
              key={i}
              x1={x} x2={x}
              y1={major ? 40 : 50}
              y2={major ? 82 : 76}
              stroke="var(--text-muted)"
              strokeWidth={major ? 2 : 1}
              opacity={major ? 0.85 : 0.45}
            />
          );
        })}
        {/* Major labels */}
        {[-50, -25, 0, 25, 50].map((c) => {
          const x = ((c + SPAN_CENTS) / (2 * SPAN_CENTS)) * 1000;
          return (
            <text
              key={c}
              x={x} y={22}
              textAnchor="middle"
              fontSize={14}
              fill="var(--text-muted)"
            >
              {c > 0 ? `+${c}` : c}
            </text>
          );
        })}
      </svg>

      {/* The needle. Absolutely positioned so we can transition its
          left% smoothly between frames. */}
      <div
        aria-hidden="true"
        style={{
          position: 'absolute',
          top: 30,
          bottom: 4,
          left: `${xPct}%`,
          width: 4,
          marginLeft: -2,
          borderRadius: 2,
          background: color,
          opacity: active ? 1 : 0.35,
          boxShadow: active
            ? (inTune
                ? `0 0 ${stable ? 16 : 8}px ${color}`
                : `0 0 6px ${color}`)
            : 'none',
          transition: 'left 90ms linear, background-color 120ms, box-shadow 200ms',
        }}
      />
    </div>
  );
}
