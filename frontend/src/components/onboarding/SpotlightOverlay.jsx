import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import {
  SPOTLIGHT_PADDING,
  expandRect,
  rectFromDomRect,
  rectsEqual,
} from "./spotlightGeometry.js";

/**
 * SpotlightOverlay.jsx
 *
 * The dimming + cutout layer of the guided spotlight tour (onboarding-revamp
 * spec, task 7.1). It darkens the live dashboard and punches a bright "cutout"
 * around a real control so the user's attention is drawn to the thing they need
 * to interact with next (Req 3.1, 3.2).
 *
 * Targeting:
 *   - Pass an explicit `target` DOM element, OR a `targetId` which is resolved
 *     via `document.querySelector('[data-tour-id="…"]')`. Real controls are
 *     tagged with `data-tour-id` attributes by task 1.4 (e.g. "aquariums-tab",
 *     "add-fish-tab", "profile-widget").
 *
 * Behavior:
 *   - Measures the target's bounding rect with `getBoundingClientRect`.
 *   - Recomputes the rect on window `resize` and `scroll` (capture phase, so
 *     scrolls inside nested scroll containers are caught) and on each animation
 *     frame while mounted is avoided — instead we re-measure on the events that
 *     can actually move the target, plus a short rAF settle after mount.
 *   - Scrolls the target into view on mount / when the target changes so the
 *     spotlight is never pointed off-screen (Req error-handling: "scroll into
 *     view").
 *   - Renders a full-screen `.tour-overlay` plus a `.tour-spotlight` cutout
 *     positioned over the (padded) target rect. The cutout uses the big
 *     box-shadow defined in index.css to dim everything outside it.
 *
 * Operability:
 *   - The overlay and the spotlight ring are `pointer-events: none` (set in CSS)
 *     so the real target underneath stays fully clickable — the user performs
 *     the real action through the highlight (Req 3.2 / "target stays operable").
 *
 * Composition:
 *   - The resolved rect is surfaced via `onRectChange(rect)` and, when provided,
 *     a render-prop `children(rect)` — so a sibling `TourCoachmark` (or the
 *     `SpotlightTour` orchestrator built in later tasks) can anchor itself to
 *     the same rect.
 *   - If the target can't be found, `onTargetMissing()` fires so the caller can
 *     fall back to an in-card guided form (Req 3.5) or skip the step.
 *
 * Validates: Requirements 3.1, 3.2, 9.2
 *
 * @param {object} props
 * @param {Element} [props.target]            Explicit target element (wins over targetId).
 * @param {string}  [props.targetId]          `data-tour-id` of the target control.
 * @param {number}  [props.padding]           Cutout padding around the target (px).
 * @param {boolean} [props.scrollIntoView]    Scroll the target into view (default true).
 * @param {(rect:object|null)=>void} [props.onRectChange]  Notified when the rect changes.
 * @param {()=>void} [props.onTargetMissing]  Fired when the target cannot be resolved.
 * @param {React.ReactNode|((rect:object|null)=>React.ReactNode)} [props.children]
 */
export function SpotlightOverlay({
  target,
  targetId,
  padding = SPOTLIGHT_PADDING,
  scrollIntoView = true,
  onRectChange,
  onTargetMissing,
  children,
}) {
  const [rect, setRect] = useState(null);
  const rectRef = useRef(null);
  const missingFiredRef = useRef(false);
  const onRectChangeRef = useRef(onRectChange);
  const onTargetMissingRef = useRef(onTargetMissing);

  // Keep callback refs current without making the measurement effect depend on
  // unstable inline callbacks.
  useEffect(() => {
    onRectChangeRef.current = onRectChange;
    onTargetMissingRef.current = onTargetMissing;
  }, [onRectChange, onTargetMissing]);

  /** Resolve the live target element from the explicit prop or the data-tour-id. */
  const resolveTarget = useCallback(() => {
    if (target) return target;
    if (targetId && typeof document !== "undefined") {
      return document.querySelector(`[data-tour-id="${targetId}"]`);
    }
    return null;
  }, [target, targetId]);

  /** Measure the target and push the rect into state when it actually changed. */
  const measure = useCallback(() => {
    const el = resolveTarget();
    if (!el || typeof el.getBoundingClientRect !== "function") {
      if (!missingFiredRef.current) {
        missingFiredRef.current = true;
        onTargetMissingRef.current?.();
      }
      if (rectRef.current !== null) {
        rectRef.current = null;
        setRect(null);
        onRectChangeRef.current?.(null);
      }
      return;
    }

    missingFiredRef.current = false;
    const next = rectFromDomRect(el.getBoundingClientRect());
    if (!rectsEqual(rectRef.current, next)) {
      rectRef.current = next;
      setRect(next);
      onRectChangeRef.current?.(next);
    }
  }, [resolveTarget]);

  // Initial measure + scroll-into-view, and re-measure whenever the target changes.
  useEffect(() => {
    const el = resolveTarget();
    if (el && scrollIntoView && typeof el.scrollIntoView === "function") {
      el.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
    }

    // Measure now, then again on the next frames to settle after any scroll /
    // layout caused by the dashboard mounting underneath.
    measure();
    let raf1 = 0;
    let raf2 = 0;
    if (typeof requestAnimationFrame === "function") {
      raf1 = requestAnimationFrame(() => {
        measure();
        raf2 = requestAnimationFrame(measure);
      });
    }

    return () => {
      if (raf1) cancelAnimationFrame(raf1);
      if (raf2) cancelAnimationFrame(raf2);
    };
  }, [resolveTarget, scrollIntoView, measure]);

  // Recompute on resize / scroll (capture catches nested scroll containers).
  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const onResize = () => measure();
    const onScroll = () => measure();
    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [measure]);

  // Render the dim layer always; render the bright cutout only once we have a rect.
  const cutout = rect ? expandRect(rect, padding) : null;

  const renderedChildren =
    typeof children === "function" ? children(rect) : children;

  return (
    <div className="tour-overlay" aria-hidden="true">
      {cutout && (
        <div
          className="tour-spotlight"
          style={{
            top: `${cutout.top}px`,
            left: `${cutout.left}px`,
            width: `${cutout.width}px`,
            height: `${cutout.height}px`,
          }}
        />
      )}
      {renderedChildren}
    </div>
  );
}

export default SpotlightOverlay;
