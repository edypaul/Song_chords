import React, { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { finalizeUntaggedPresets, parseSongAnnotations, pickActiveSet } from '@song-chords/shared';
import type { Annotation, AnnotationViewMode, StrokeAnnotation, LineAnnotation, BoxAnnotation, TextAnnotation } from '@song-chords/shared';

interface Props {
  /** The song's `annotations` field (JSON) or undefined when none. */
  annotationsJson: string | undefined;
  /** The scroll container whose song lines the layer measures against. */
  scrollRef: React.RefObject<HTMLElement>;
  /** Recompute on anything that reflows the song body — zoom, font
   *  size, viewMode toggle, chord-bar visibility, etc. The parent
   *  passes a key built from those values so a change re-triggers the
   *  measurement pass. */
  recomputeKey: string;
  /** Hide the layer entirely without unmounting it — matches the
   *  "annotations visible" toggle. Kept mounted so measurement stays
   *  warm and the pass on re-show is instant. Fades via opacity so
   *  the user sees a smooth show/hide from the Eye button. */
  visible: boolean;
  /** Instant hide, no fade — used by the parent when the draw
   *  surface takes over. */
  suppress?: boolean;
  /** Current view mode. Together with `preset` + `selectedSetId`
   *  decides which annotation SET is rendered — sets are tagged with
   *  a view mode + preset and only appear in matching modes / presets.
   *  See `pickActiveSet` in the shared types for the rules. */
  viewMode: AnnotationViewMode;
  /** Currently-active style preset key (`SongViewStyle.preset`). */
  preset: string;
  /** Explicit user selection from the set-picker dropdown (or null to
   *  fall back to the (viewMode, preset) default). */
  selectedSetId?: string | null;
}

/** Measured position + size of one annotation-anchorable line,
 *  relative to a chosen origin. Every rendered song line (heading,
 *  chord line, lyric, blank spacer) that carries a `data-annot-line`
 *  attribute is one entry.
 *
 *  Coords are in whatever frame the origin's bcr uses (typically
 *  layout px inside the CSS-zoomed subtree). Draw and render always
 *  measure fresh, so they see the same frame at the same moment —
 *  zoom drift is impossible by construction. */
export interface LineBox {
  sectionIndex: number;
  lineIndex: number;
  /** Left edge relative to origin. */
  x: number;
  /** Top edge relative to origin. */
  y: number;
  /** Line's rendered width. */
  width: number;
  /** Line's rendered height. */
  height: number;
}

const KEY = (s: number, l: number): string => `${s}:${l}`;

/** Measure every `[data-annot-line]` inside `scrollRef` and index them
 *  by (sectionIndex, lineIndex). Re-measures on resize, mutation, and
 *  whenever `recomputeKey` changes.
 *
 *  Origin: the wrapper (container's first child) — the same element the
 *  SVG is positioned inside. All boxes are relative to the wrapper's
 *  top-left. */
export function useLineBoxes(
  scrollRef: React.RefObject<HTMLElement>,
  originRef: React.RefObject<Element>,
  recomputeKey: string,
): {
  boxes: Map<string, LineBox>;
  /** SVG box dimensions in the wrapper's (LAYOUT-px) coord frame.
   *  `leftOffset` is the SVG's `left` in layout px — negative when the
   *  SVG extends into the container's left margin. Shape coords are
   *  in the wrapper's frame, so the render path shifts the shape
   *  layer right by `-leftOffset` so shapes still land under their
   *  anchored lines. */
  layerSize: { w: number; h: number; leftOffset: number };
  currentZoom: number;
  measured: boolean;
} {
  const [boxes, setBoxes] = useState<Map<string, LineBox>>(new Map());
  const [layerSize, setLayerSize] = useState<{ w: number; h: number; leftOffset: number }>({ w: 0, h: 0, leftOffset: 0 });
  const [currentZoom, setCurrentZoom] = useState(1);
  const [measured, setMeasured] = useState(false);
  useLayoutEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    const measure = () => {
      const contentEl = container.firstElementChild as HTMLElement | null;
      const originEl = contentEl ?? originRef.current;
      if (!originEl) return;
      const originRect = originEl.getBoundingClientRect();
      const cs = contentEl ? window.getComputedStyle(contentEl) : null;
      const parsedZoom = cs ? parseFloat(cs.zoom) : 1;
      const zoom = Number.isFinite(parsedZoom) && parsedZoom > 0 ? parsedZoom : 1;

      const lines = container.querySelectorAll<HTMLElement>('[data-annot-line]');
      const next = new Map<string, LineBox>();
      lines.forEach((el) => {
        const s = Number(el.dataset.annotSection);
        const l = Number(el.dataset.annotLineIndex);
        if (!Number.isFinite(s) || !Number.isFinite(l)) return;
        const r = el.getBoundingClientRect();
        next.set(KEY(s, l), {
          sectionIndex: s,
          lineIndex: l,
          x: r.left - originRect.left,
          y: r.top - originRect.top,
          width: r.width,
          height: r.height,
        });
      });

      setBoxes(next);
      setCurrentZoom(zoom);
      // SVG sizing has TWO goals:
      //   1. Cover the whole visual width of the CONTAINER so the user
      //      can draw in the left / right margins of the song text
      //      (not just on top of the wrapper's inner content).
      //   2. Its coord frame stays IDENTICAL to the wrapper's, so shape
      //      offsets (measured against the wrapper's origin in
      //      `useLineBoxes` above) render at the right place.
      //
      // Because the SVG is mounted INSIDE the CSS-zoomed wrapper,
      // its CSS width is interpreted as LAYOUT px (before zoom).
      // To make its VISUAL width equal the container's visual width,
      // we set layout-width = container.clientWidth / zoom.
      //
      // Horizontal offset: the wrapper is `fit-content` + auto
      // margins, i.e. centred inside the container. The SVG needs to
      // extend equal amounts to the LEFT and RIGHT of the wrapper's
      // content, so `left = -margin / zoom` in layout px, where
      // `margin` is the visual gap between container.left and
      // wrapper.left. Equivalent formula: SVG's layout-left =
      // (wrapper.layoutWidth - containerLayoutW) / 2, where
      // containerLayoutW = container.clientWidth / zoom. This ends up
      // negative whenever the container is wider than the wrapper,
      // which is exactly when there are margins to draw in.
      // Wrapper's ACTUAL rendered width (visual), from its bcr — NOT
      // scrollWidth. scrollWidth includes any overflowing content
      // (e.g. an annotation shape drawn far to the right stored with
      // an oversized offsetX), which would falsely make the wrapper
      // look as wide as the container and defeat the "extend into
      // the container margins" logic below.
      const wrapperRect = contentEl?.getBoundingClientRect();
      const wrapperVisualW = wrapperRect?.width ?? container.clientWidth;
      const wrapperLayoutW = wrapperVisualW / zoom;
      // Use offsetHeight, NOT scrollHeight, for the wrapper height.
      // The SVG we mount is `position: absolute` but its declared
      // `height` still contributes to the wrapper's `scrollHeight`
      // (Chromium includes out-of-flow descendants when computing
      // scrollable extent). Using scrollHeight would create a
      // positive feedback loop: SVG height = scrollHeight ⇒ next
      // measurement sees an inflated scrollHeight ⇒ SVG grows ⇒
      // scroll container's trailing whitespace grows. offsetHeight
      // measures the wrapper's OWN layout height, which is
      // unaffected by absolutely-positioned children.
      const wrapperH = contentEl?.offsetHeight ?? container.clientHeight;
      const containerVisualW = container.clientWidth;
      const containerLayoutW = containerVisualW / zoom;
      // If container is narrower than wrapper (fully-populated zoom),
      // don't shrink the SVG below the wrapper — some content might
      // still extend to the wrapper's edges.
      const svgLayoutW = Math.max(wrapperLayoutW, containerLayoutW);
      const svgLeft = (wrapperLayoutW - svgLayoutW) / 2;
      setLayerSize({ w: svgLayoutW, h: wrapperH, leftOffset: svgLeft });
    };

    let cancelled = false;
    let committed = false;
    const hasRunningAnimation = (): boolean => {
      const el = container as unknown as { getAnimations?: (opts?: { subtree?: boolean }) => Animation[] };
      if (typeof el.getAnimations !== 'function') return false;
      const anims = el.getAnimations({ subtree: true });
      return anims.some((a) => a.playState === 'running');
    };
    // Detect the perform-page slide-in on THIS effect run, so we can
    // skip the initial synchronous measure and hide the layer until
    // the animation finishes. Purely relying on `getAnimations()`
    // misses the window in useLayoutEffect where a freshly-mounted
    // element's CSS animation is queued but hasn't started (playState
    // is neither 'running' nor 'idle' consistently). To catch that
    // window, look at the slide-carrying element specifically and
    // check its OWN animations. Its `key={activeSong.id}` makes it
    // fresh on every song change; after the animation ends, its
    // Animation objects transition to 'finished' and this check
    // returns false — so the class staying on the element after the
    // animation doesn't keep the layer hidden.
    const hasPendingSlide = (() => {
      const slideEl = container.querySelector('.song-slide-next, .song-slide-prev') as (Element & { getAnimations?: () => Animation[] }) | null;
      if (!slideEl || typeof slideEl.getAnimations !== 'function') return false;
      const anims = slideEl.getAnimations();
      return anims.some((a) => a.playState === 'running' || a.playState === 'idle' || a.playState === 'paused');
    })();
    // Initial synchronous measure — BUT only when no song-slide is
    // pending or running. Perform-mode runs a 260ms slide-in on every
    // song change; measuring during it captures section positions
    // that are offset by the transform and would then "jump" into
    // place at animationend. Skipping the sync measure while a slide
    // is pending, AND resetting `measured` so the visibility gate
    // hides the layer, together produce a clean "layer is hidden for
    // 260ms then appears with correct coords" transition instead of
    // a visible jump.
    if (hasPendingSlide || hasRunningAnimation()) {
      setMeasured(false);
    } else {
      measure();
    }
    const guardedMeasure = () => {
      if (cancelled) return;
      if (!committed) return;
      measure();
    };
    const commitStable = () => {
      if (cancelled || committed) return;
      committed = true;
      measure();
      setMeasured(true);
    };
    const onAnimationEnd = () => {
      commitStable();
      guardedMeasure();
    };
    container.addEventListener('animationend', onAnimationEnd);
    container.addEventListener('transitionend', onAnimationEnd);
    const raf1 = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (cancelled) return;
        if (hasRunningAnimation()) return;
        commitStable();
      });
    });
    const anyDoc = document as Document & { fonts?: { ready?: Promise<unknown> } };
    if (anyDoc.fonts?.ready) {
      void anyDoc.fonts.ready.then(() => {
        if (cancelled) return;
        if (!hasRunningAnimation()) commitStable();
        guardedMeasure();
      });
    }
    const safetyTimer = window.setTimeout(commitStable, 500);
    const onResize = () => guardedMeasure();
    window.addEventListener('resize', onResize);
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(guardedMeasure) : null;
    ro?.observe(container);
    const contentEl = container.firstElementChild as HTMLElement | null;
    if (ro && contentEl) ro.observe(contentEl);
    // MutationObserver: re-measure when line elements are added,
    // removed, or their data-attrs change. Skip mutations INSIDE the
    // SVG (that's our own render firing).
    let moRaf: number | null = null;
    const isRelevantMutation = (mutations: MutationRecord[]): boolean => {
      const svg = originRef.current;
      for (const m of mutations) {
        if (svg && (m.target === svg || svg.contains(m.target as Node))) continue;
        const check = (nodes: NodeList): boolean => {
          for (let i = 0; i < nodes.length; i++) {
            const n = nodes[i];
            if (!(n instanceof Element)) continue;
            if (n.matches?.('[data-annot-line]')) return true;
            if (n.querySelector?.('[data-annot-line]')) return true;
          }
          return false;
        };
        if (check(m.addedNodes) || check(m.removedNodes)) return true;
      }
      return false;
    };
    const mo = typeof MutationObserver !== 'undefined'
      ? new MutationObserver((mutations) => {
          if (!isRelevantMutation(mutations)) return;
          if (moRaf !== null) return;
          moRaf = requestAnimationFrame(() => {
            moRaf = null;
            guardedMeasure();
          });
        })
      : null;
    if (mo && contentEl) mo.observe(contentEl, { childList: true, subtree: true });
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf1);
      if (moRaf !== null) cancelAnimationFrame(moRaf);
      window.clearTimeout(safetyTimer);
      window.removeEventListener('resize', onResize);
      container.removeEventListener('animationend', onAnimationEnd);
      container.removeEventListener('transitionend', onAnimationEnd);
      ro?.disconnect();
      mo?.disconnect();
    };
  }, [scrollRef, originRef, recomputeKey]);
  return { boxes, layerSize, currentZoom, measured };
}

/** Resolve the anchor line for a stored annotation. Tries the exact
 *  (section, line) first, then falls back progressively so an
 *  annotation whose line disappeared under a view-mode change still
 *  lands somewhere sensible. */
export function resolveAnchorBox(
  boxes: Map<string, LineBox>,
  sectionIndex: number,
  lineIndex: number,
): LineBox | null {
  // Exact match.
  const exact = boxes.get(KEY(sectionIndex, lineIndex));
  if (exact) return exact;
  // Nearest smaller lineIndex in the same section (the line above
  // where we drew still exists).
  let bestPrev: LineBox | null = null;
  let bestNext: LineBox | null = null;
  for (const b of boxes.values()) {
    if (b.sectionIndex !== sectionIndex) continue;
    if (b.lineIndex < lineIndex && (!bestPrev || b.lineIndex > bestPrev.lineIndex)) bestPrev = b;
    if (b.lineIndex > lineIndex && (!bestNext || b.lineIndex < bestNext.lineIndex)) bestNext = b;
  }
  if (bestPrev) return bestPrev;
  if (bestNext) return bestNext;
  // Section heading (lineIndex 0).
  const heading = boxes.get(KEY(sectionIndex, 0));
  if (heading) return heading;
  // First box in ANY section, as a last resort — the shape lands
  // near the top of the song rather than being silently dropped.
  const first = boxes.values().next();
  return first.done ? null : first.value;
}

/**
 * Read-only SVG overlay that paints a song's annotations, each shape
 * anchored to a specific rendered line by (sectionIndex, lineIndex).
 *
 * Placement: for every shape, look up its anchor line's current bcr,
 * translate to that box, then render the shape's stored offsets
 * verbatim in the anchor line's local frame. Both draw and render
 * measure at the current instant, so zoom / reflow doesn't cause
 * drift — the anchor line's position is always live.
 */
export default function AnnotationLayer({
  annotationsJson,
  scrollRef,
  recomputeKey,
  visible,
  suppress = false,
  viewMode,
  preset,
  selectedSetId,
}: Props): React.ReactElement | null {
  const parsed = useMemo(() => {
    const raw = parseSongAnnotations(annotationsJson);
    return raw ? finalizeUntaggedPresets(raw, preset) : raw;
  }, [annotationsJson, preset]);
  const svgRef = useRef<SVGSVGElement>(null);
  const { boxes, layerSize, measured } = useLineBoxes(scrollRef, svgRef, recomputeKey);

  const activeSet = useMemo(
    () => pickActiveSet(parsed, viewMode, preset, selectedSetId),
    [parsed, viewMode, preset, selectedSetId],
  );
  if (!activeSet || activeSet.shapes.length === 0) return null;

  return (
    <svg
      ref={svgRef}
      // No viewBox — SVG stays 1:1 with CSS px so numbers we plug into
      // transforms don't get rescaled by an implicit viewBox stretch.
      width={layerSize.w}
      height={layerSize.h}
      style={{
        position: 'absolute',
        left: layerSize.leftOffset,
        top: 0,
        width: layerSize.w,
        height: layerSize.h,
        // See AnnotationDrawSurface for the two-gate visibility model:
        //   • `measured` (visibility) — atomic hide until layout stable
        //   • `suppress` (visibility) — atomic hide when draw surface active
        //   • `visible`  (opacity)    — user's Eye toggle, with fade
        // `overflow: visible` so shapes drawn in the margins (negative
        // offsetX, or larger than anchor line's width) don't get
        // clipped by the SVG box.
        overflow: 'visible',
        visibility: (measured && !suppress) ? 'visible' : 'hidden',
        opacity: visible ? 1 : 0,
        transition: 'opacity 150ms ease',
        pointerEvents: 'none',
      }}
      aria-hidden={!visible}
    >
      {/* Coord-frame shift: `box.x` / `box.y` are wrapper-relative,
          but the SVG's own origin sits at `leftOffset` layout-px left
          of the wrapper (so the SVG can catch pointer events in the
          container's left margin). Shifting the shape group by
          `-leftOffset` puts each shape at its true wrapper-frame
          position regardless of the SVG's leftward extension. */}
      <g transform={`translate(${-layerSize.leftOffset}, 0)`}>
        {activeSet.shapes.map((shape) => {
          const box = resolveAnchorBox(boxes, shape.anchor.sectionIndex, shape.anchor.lineIndex);
          if (!box) return null;
          return (
            <g key={shape.id} transform={`translate(${box.x}, ${box.y})`}>
              {renderShape(shape)}
            </g>
          );
        })}
      </g>
    </svg>
  );
}

/** Convert a shape into its SVG element(s). Coordinates are in the
 *  anchor line's local frame — the parent <g> already applies the
 *  translate to the line's position. */
export function renderShape(shape: Annotation): React.ReactElement {
  switch (shape.kind) {
    case 'pen':
    case 'highlighter':
      return renderStroke(shape);
    case 'line':
    case 'arrow':
      return renderLine(shape);
    case 'rect':
    case 'ellipse':
      return renderBox(shape);
    case 'text':
      return renderText(shape);
  }
}

function renderStroke(shape: StrokeAnnotation): React.ReactElement {
  const d = shape.points
    .map(([x, y], i) => `${i === 0 ? 'M' : 'L'} ${x} ${y}`)
    .join(' ');
  return (
    <path
      d={d}
      stroke={shape.color}
      strokeWidth={shape.strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      fill="none"
      opacity={shape.kind === 'highlighter' ? 0.4 : 1}
    />
  );
}

function renderLine(shape: LineAnnotation): React.ReactElement {
  const arrowHead = shape.kind === 'arrow'
    ? drawArrowHead(shape.x1, shape.y1, shape.x2, shape.y2, shape.color, shape.strokeWidth)
    : null;
  return (
    <g>
      <line
        x1={shape.x1} y1={shape.y1}
        x2={shape.x2} y2={shape.y2}
        stroke={shape.color}
        strokeWidth={shape.strokeWidth}
        strokeLinecap="round"
      />
      {arrowHead}
    </g>
  );
}

function renderBox(shape: BoxAnnotation): React.ReactElement {
  if (shape.kind === 'ellipse') {
    return (
      <ellipse
        cx={shape.x + shape.w / 2}
        cy={shape.y + shape.h / 2}
        rx={Math.abs(shape.w / 2)}
        ry={Math.abs(shape.h / 2)}
        stroke={shape.color}
        strokeWidth={shape.strokeWidth}
        fill="none"
      />
    );
  }
  return (
    <rect
      x={Math.min(shape.x, shape.x + shape.w)}
      y={Math.min(shape.y, shape.y + shape.h)}
      width={Math.abs(shape.w)}
      height={Math.abs(shape.h)}
      stroke={shape.color}
      strokeWidth={shape.strokeWidth}
      fill="none"
    />
  );
}

function renderText(shape: TextAnnotation): React.ReactElement {
  return (
    <text
      x={shape.x}
      // Baseline one em below the stored top-left so the annotation
      // reads as top-anchored (matching every other shape).
      y={shape.y + shape.fontSize}
      fill={shape.color}
      fontSize={shape.fontSize}
      fontFamily="-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
      style={{ whiteSpace: 'pre' }}
    >
      {shape.content}
    </text>
  );
}

function drawArrowHead(x1: number, y1: number, x2: number, y2: number, color: string, strokeWidth: number): React.ReactElement {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  if (len < 1) return <g />;
  const ux = dx / len;
  const uy = dy / len;
  const px = -uy;
  const py = ux;
  const size = Math.max(6, strokeWidth * 3);
  const bx = x2 - ux * size;
  const by = y2 - uy * size;
  const w = size * 0.6;
  const p1 = `${x2},${y2}`;
  const p2 = `${bx + px * w},${by + py * w}`;
  const p3 = `${bx - px * w},${by - py * w}`;
  return <polygon points={`${p1} ${p2} ${p3}`} fill={color} />;
}
