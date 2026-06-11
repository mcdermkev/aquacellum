/**
 * spotlightGeometry.js — pure, DOM-free geometry helpers for the spotlight tour.
 *
 * The spotlight overlay and coachmark need to measure a real DOM element and
 * position themselves relative to its bounding rect. That measurement is
 * inherently DOM-dependent, but the *math* that decides where the cutout and
 * the coachmark bubble land is pure. Following the established pattern in this
 * folder (`nextEchoState`, `nameConfirmCopy`, `identityCopy`), that pure math is
 * extracted here so it can be unit-tested in the project's `node` vitest
 * environment without jsdom.
 *
 * All functions operate on plain `{ top, left, width, height }` rect-likes and
 * `{ width, height }` size/viewport objects — never on live DOM nodes.
 *
 * Validates: Requirements 3.1, 3.2 (spotlight positioning around the target),
 * 9.2 (keyboard-operable coachmark needs a deterministic on-screen position).
 */

/** Padding (px) added around the target rect for the spotlight cutout. */
export const SPOTLIGHT_PADDING = 8;

/** Gap (px) between the target rect and the coachmark bubble. */
export const COACHMARK_GAP = 14;

/** Minimum margin (px) kept between the coachmark and the viewport edges. */
export const VIEWPORT_MARGIN = 12;

/** Preferred order in which the coachmark tries to sit relative to the target. */
export const PLACEMENT_ORDER = Object.freeze(["bottom", "top", "right", "left"]);

/**
 * clamp — constrain `value` to the inclusive range [min, max].
 *
 * When the range is degenerate (min > max, i.e. the element is larger than the
 * available space) the lower bound wins so the element stays anchored to the
 * top/left edge rather than disappearing past the far edge.
 *
 * @param {number} value
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
export function clamp(value, min, max) {
  if (max < min) return min;
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

/**
 * expandRect — grow a target rect by `padding` on every side to form the
 * spotlight cutout. Width/height never go negative.
 *
 * @param {{top:number,left:number,width:number,height:number}} rect
 * @param {number} [padding=SPOTLIGHT_PADDING]
 * @returns {{top:number,left:number,width:number,height:number}}
 */
export function expandRect(rect, padding = SPOTLIGHT_PADDING) {
  if (!rect) return null;
  return {
    top: rect.top - padding,
    left: rect.left - padding,
    width: Math.max(0, rect.width + padding * 2),
    height: Math.max(0, rect.height + padding * 2),
  };
}

/**
 * choosePlacement — decide which side of the target the coachmark should sit on.
 *
 * Walks `PLACEMENT_ORDER` (bottom → top → right → left) and returns the first
 * side with enough room to fit the coachmark plus the gap. If nothing fits
 * cleanly it falls back to the side with the most available space so the bubble
 * is always rendered somewhere sensible.
 *
 * @param {{top:number,left:number,width:number,height:number}} rect  Target rect.
 * @param {{width:number,height:number}} viewport
 * @param {{width:number,height:number}} coachmark
 * @param {number} [gap=COACHMARK_GAP]
 * @returns {"bottom"|"top"|"right"|"left"}
 */
export function choosePlacement(rect, viewport, coachmark, gap = COACHMARK_GAP) {
  const space = {
    bottom: viewport.height - (rect.top + rect.height),
    top: rect.top,
    right: viewport.width - (rect.left + rect.width),
    left: rect.left,
  };
  const need = {
    bottom: coachmark.height + gap,
    top: coachmark.height + gap,
    right: coachmark.width + gap,
    left: coachmark.width + gap,
  };

  for (const side of PLACEMENT_ORDER) {
    if (space[side] >= need[side]) return side;
  }

  // Nothing fits — pick the side with the most room.
  return PLACEMENT_ORDER.reduce(
    (best, side) => (space[side] > space[best] ? side : best),
    PLACEMENT_ORDER[0]
  );
}

/**
 * computeCoachmarkPlacement — compute the on-screen position of the coachmark
 * bubble for a given target rect.
 *
 * Returns viewport-relative `top`/`left` coordinates (suitable for a
 * `position: fixed` element) plus the chosen `placement` side. The coordinates
 * are clamped so the bubble always stays within `margin` of the viewport edges
 * (Req 9.2 — the keyboard-focusable coachmark must remain reachable on screen).
 *
 * @param {{top:number,left:number,width:number,height:number}} rect  Target rect.
 * @param {{width:number,height:number}} viewport
 * @param {{width:number,height:number}} coachmark
 * @param {object} [opts]
 * @param {number} [opts.gap=COACHMARK_GAP]
 * @param {number} [opts.margin=VIEWPORT_MARGIN]
 * @param {"bottom"|"top"|"right"|"left"} [opts.placement]  Force a side.
 * @returns {{placement:string, top:number, left:number}}
 */
export function computeCoachmarkPlacement(rect, viewport, coachmark, opts = {}) {
  const gap = opts.gap ?? COACHMARK_GAP;
  const margin = opts.margin ?? VIEWPORT_MARGIN;
  const placement =
    opts.placement && PLACEMENT_ORDER.includes(opts.placement)
      ? opts.placement
      : choosePlacement(rect, viewport, coachmark, gap);

  const targetCenterX = rect.left + rect.width / 2;
  const targetCenterY = rect.top + rect.height / 2;

  let top;
  let left;

  switch (placement) {
    case "top":
      top = rect.top - coachmark.height - gap;
      left = targetCenterX - coachmark.width / 2;
      break;
    case "right":
      top = targetCenterY - coachmark.height / 2;
      left = rect.left + rect.width + gap;
      break;
    case "left":
      top = targetCenterY - coachmark.height / 2;
      left = rect.left - coachmark.width - gap;
      break;
    case "bottom":
    default:
      top = rect.top + rect.height + gap;
      left = targetCenterX - coachmark.width / 2;
      break;
  }

  // Keep the bubble fully on screen.
  left = clamp(left, margin, viewport.width - coachmark.width - margin);
  top = clamp(top, margin, viewport.height - coachmark.height - margin);

  return { placement, top, left };
}

/**
 * rectFromDomRect — normalize a `DOMRect` (or null) into the plain shape these
 * helpers use. Kept here so the (DOM-touching) overlay can convert once and
 * everything downstream stays pure.
 *
 * @param {DOMRect|null|undefined} domRect
 * @returns {{top:number,left:number,width:number,height:number}|null}
 */
export function rectFromDomRect(domRect) {
  if (!domRect) return null;
  return {
    top: domRect.top,
    left: domRect.left,
    width: domRect.width,
    height: domRect.height,
  };
}

/**
 * rectsEqual — shallow compare two rect-likes within a 0.5px tolerance so we can
 * skip redundant state updates on scroll/resize churn.
 *
 * @param {object|null} a
 * @param {object|null} b
 * @returns {boolean}
 */
export function rectsEqual(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    Math.abs(a.top - b.top) < 0.5 &&
    Math.abs(a.left - b.left) < 0.5 &&
    Math.abs(a.width - b.width) < 0.5 &&
    Math.abs(a.height - b.height) < 0.5
  );
}
