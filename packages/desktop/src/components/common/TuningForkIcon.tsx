import React from 'react';

/**
 * Tuning-fork icon matching the user-supplied reference: two
 * vertical prongs joined by a short stem and finished with a small
 * round weight at the bottom — the universal musician's symbol for
 * pitch reference. Drawn from scratch as a single SVG so it scales
 * crisply at any nav-icon or header-icon size, and inherits the
 * surrounding text colour via `currentColor` (so the cyan accent in
 * the sidebar / page header is picked up automatically).
 *
 * Stroke geometry is deliberately uniform with rounded caps + joins
 * so the icon reads cleanly at 16px (sidebar) and 22px+ (page header).
 */
export default function TuningForkIcon({
  size = 16,
  style,
  className,
  strokeWidth = 1.75,
}: {
  size?: number;
  style?: React.CSSProperties;
  className?: string;
  /** Stroke width in viewBox units (the SVG viewBox is 24×24, so
   *  default 1.75 reads at the same weight as lucide's icons). */
  strokeWidth?: number;
}): React.ReactElement {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      style={style}
      className={className}
    >
      {/* Left prong — vertical line from the top down to where the
          stem starts to taper inward. */}
      <line x1="8" y1="3" x2="8" y2="11" />
      {/* Right prong */}
      <line x1="16" y1="3" x2="16" y2="11" />
      {/* Left taper of the Y-shaped stem */}
      <line x1="8"  y1="11" x2="12" y2="15" />
      {/* Right taper of the Y-shaped stem */}
      <line x1="16" y1="11" x2="12" y2="15" />
      {/* Stem proper */}
      <line x1="12" y1="15" x2="12" y2="19" />
      {/* Round weight at the base — solid dot in the same colour as
          the strokes (so it pops on top of the stem). */}
      <circle cx="12" cy="20.5" r="1.4" fill="currentColor" stroke="none" />
    </svg>
  );
}
