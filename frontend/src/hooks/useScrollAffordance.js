/**
 * useScrollAffordance.js
 *
 * Tells a horizontally scrollable container which of its edges have content
 * hidden beyond them, by setting `data-scroll-edges` to one of:
 *
 *   "none"  — everything fits, no scrolling possible
 *   "end"   — at the start, more content to the right
 *   "start" — at the end, more content to the left
 *   "both"  — scrolled somewhere in the middle
 *
 * `.scroll-fade` in styles/index.css turns that into an edge fade.
 *
 * ── Why this exists ────────────────────────────────────────────────────────
 * Beta feedback (384px viewport): tab bars with more tabs than fit gave no hint
 * that sideways scrolling was possible. The cause was self-inflicted — the main
 * app tab bar, `.breeder-sub-nav` and `.locgroup-chips` all set
 * `scrollbar-width: none` plus `::-webkit-scrollbar { display: none }`, deleting
 * the only native affordance and putting nothing back. And on iOS/Android
 * scrollbars are overlay-only anyway: they appear *while* scrolling, so they can
 * never announce that scrolling is possible in the first place.
 *
 * ── Why the state must be dynamic ─────────────────────────────────────────
 * A permanently-faded edge is worse than no fade: it lies at the ends, so
 * reaching the last tab never confirms you have seen everything. The fade has to
 * clear on the side you have run out of content on.
 *
 * ── Why a callback ref ────────────────────────────────────────────────────
 * Most of these containers live inside modals and conditionally-rendered tabs.
 * An object ref plus `useEffect(…, [])` would run once, on a mount where
 * `ref.current` is still null for anything that appears later, and silently do
 * nothing. A callback ref attaches whenever the node does, and re-attaches
 * across remounts.
 *
 * Usage:
 *   const scrollRef = useScrollAffordance();
 *   <div ref={scrollRef} className="scroll-fade" style={{ overflowX: "auto" }}>
 *
 * NOTE: assumes left-to-right. `scrollLeft` is negative or mirrored in RTL
 * depending on the engine; this app is LTR-only, so that is not handled.
 */

import { useCallback, useEffect, useRef } from "react";

// Subpixel slack. Fractional layout and browser zoom mean scrollLeft rarely hits
// an exact 0 or an exact scrollWidth - clientWidth, so a strict comparison leaves
// a fade stuck on at the very end of a scroll.
export const EDGE_TOLERANCE = 2;

/**
 * The whole decision, as a pure function so it can be tested without a DOM.
 *
 * Extracted deliberately: the defect this feature exists to fix was a one-line
 * inverted comparison living inside an inline ref where nothing could reach it.
 * The direction of each branch is the part worth pinning down, so it is the part
 * that is unit-tested — see hooks/__tests__ or scrollAffordance.test.js.
 *
 * Returns which edges have content hidden BEYOND them:
 *   "none"  nothing to scroll
 *   "end"   at the start, more to the right
 *   "start" at the end, more to the left
 *   "both"  somewhere in the middle
 *
 * @param {{scrollLeft:number, scrollWidth:number, clientWidth:number}} metrics
 * @returns {"none"|"start"|"end"|"both"}
 */
export function resolveScrollEdges({ scrollLeft, scrollWidth, clientWidth }) {
  const maxScroll = scrollWidth - clientWidth;

  // Not scrollable. Treated with the same tolerance as the edges, so a container
  // overflowing by a rounding error does not advertise a scroll that cannot happen.
  if (maxScroll <= EDGE_TOLERANCE) return "none";

  const atStart = scrollLeft <= EDGE_TOLERANCE;
  const atEnd = scrollLeft >= maxScroll - EDGE_TOLERANCE;

  // Note the direction: at the START, the hidden content is to the END. Getting
  // this backwards is precisely the bug that shipped — the old code showed the
  // right-hand fade only once you had REACHED the right-hand end.
  return atStart ? "end" : atEnd ? "start" : "both";
}

export function useScrollAffordance() {
  const cleanupRef = useRef(null);

  const attach = useCallback((el) => {
    // Detach from any previous node first (remount, or ref going null).
    if (cleanupRef.current) {
      cleanupRef.current();
      cleanupRef.current = null;
    }
    if (!el) return;

    let frame = 0;

    const measure = () => {
      frame = 0;
      el.setAttribute(
        "data-scroll-edges",
        resolveScrollEdges({
          scrollLeft: el.scrollLeft,
          scrollWidth: el.scrollWidth,
          clientWidth: el.clientWidth,
        })
      );
    };

    // Coalesce to one measurement per frame. A scroll gesture fires continuously
    // and each measure() reads layout, so unthrottled this is a guaranteed
    // forced-reflow per event.
    const schedule = () => {
      if (frame) return;
      frame = requestAnimationFrame(measure);
    };

    measure();
    el.addEventListener("scroll", schedule, { passive: true });

    // Three separate triggers, because each catches something the others miss:
    //   container resize  — viewport rotation, drawer opening
    //   children resize   — a web font swapping in, a chip label changing;
    //                       scrollWidth moves while the container does not
    //   childList         — tabs or table rows added/removed after fetch
    const observer = new ResizeObserver(schedule);
    observer.observe(el);
    for (const child of el.children) observer.observe(child);

    const mutations = new MutationObserver(() => {
      // Re-observe children so nodes added after mount are covered too.
      for (const child of el.children) observer.observe(child);
      schedule();
    });
    mutations.observe(el, { childList: true, subtree: true, characterData: true });

    cleanupRef.current = () => {
      if (frame) cancelAnimationFrame(frame);
      el.removeEventListener("scroll", schedule);
      observer.disconnect();
      mutations.disconnect();
    };
  }, []);

  // Unmount safety: the callback ref is invoked with null on unmount in React 18,
  // but this guards against a container removed without that happening.
  useEffect(() => () => {
    if (cleanupRef.current) {
      cleanupRef.current();
      cleanupRef.current = null;
    }
  }, []);

  return attach;
}
