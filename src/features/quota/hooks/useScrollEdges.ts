/**
 * Which ends of a horizontal scroller hide content — drives the quota page's
 * tab-row fade, so it only says "scroll for more" where there is more.
 *
 * The scroller is the first child of the observed row (the shared
 * `ProviderTabs` strip), so the shared component needs no changes and keeps
 * its behaviour on every other page.
 */

import { useLayoutEffect, useState, type RefObject } from 'react';

export interface ScrollEdges {
  /** Content is hidden before the visible area. */
  start: boolean;
  /** Content is hidden past the visible area. */
  end: boolean;
}

export interface ScrollMetrics {
  scrollLeft: number;
  clientWidth: number;
  scrollWidth: number;
}

const NO_EDGES: ScrollEdges = { start: false, end: false };

/** Sub-pixel layout (zoom, fractional widths) must not leave a sliver of fade. */
const EDGE_TOLERANCE_PX = 1;

export function resolveScrollEdges({
  scrollLeft,
  clientWidth,
  scrollWidth,
}: ScrollMetrics): ScrollEdges {
  const maxScroll = scrollWidth - clientWidth;
  if (!(maxScroll > EDGE_TOLERANCE_PX)) return NO_EDGES;
  return {
    start: scrollLeft > EDGE_TOLERANCE_PX,
    end: scrollLeft < maxScroll - EDGE_TOLERANCE_PX,
  };
}

/** `data-fade` value for the edges: which side(s) to fade, if any. */
export function scrollFadeAttribute(edges: ScrollEdges): 'start' | 'end' | 'both' | undefined {
  if (edges.start && edges.end) return 'both';
  if (edges.start) return 'start';
  if (edges.end) return 'end';
  return undefined;
}

/**
 * Tracks the scroll edges of `rowRef`'s first child. `contentKey` should
 * change whenever the scroller's children change (e.g. the visible tab ids),
 * so newly added children are observed for size changes too.
 */
export function useScrollEdges(
  rowRef: RefObject<HTMLElement | null>,
  contentKey: string
): ScrollEdges {
  const [edges, setEdges] = useState<ScrollEdges>(NO_EDGES);

  useLayoutEffect(() => {
    const scroller = rowRef.current?.firstElementChild;
    if (!(scroller instanceof HTMLElement)) return;

    const update = () => {
      const next = resolveScrollEdges(scroller);
      setEdges((current) =>
        current.start === next.start && current.end === next.end ? current : next
      );
    };
    update();

    scroller.addEventListener('scroll', update, { passive: true });
    // The strip's own box and each tab (label, count, font load) change what overflows.
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    observer?.observe(scroller);
    Array.from(scroller.children).forEach((child) => observer?.observe(child));

    return () => {
      scroller.removeEventListener('scroll', update);
      observer?.disconnect();
    };
  }, [rowRef, contentKey]);

  return edges;
}
