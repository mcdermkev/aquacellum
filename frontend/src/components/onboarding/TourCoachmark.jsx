import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { trapFocus } from "../../utils/a11y.js";
import { computeCoachmarkPlacement } from "./spotlightGeometry.js";

// Poseidon's avatar lives in /public so it is served from the site root.
const POSEIDON_AVATAR = "/poseidon-avatar.jpg";

// Fallback coachmark size used for the first placement pass, before the bubble
// has been measured. Roughly matches the `.tour-coachmark` max-width in CSS.
const DEFAULT_COACHMARK_SIZE = Object.freeze({ width: 320, height: 150 });

/**
 * resolveCoachmarkCopy — pick the persona-aware variant of a copy value.
 *
 * Pure helper so the coachmark can take either an already-resolved string or a
 * `{ casual, pro }` entry plus the persona. Accepts the `casualMode` boolean
 * (true ⇒ casual, false ⇒ pro) or the persona strings ("casual"/"pro"). Defaults
 * to the casual tone when the persona is unknown so copy is always friendly.
 *
 * @param {string|{casual?:string,pro?:string}|null|undefined} copy
 * @param {boolean|"casual"|"pro"|null} persona
 * @returns {string}
 */
export function resolveCoachmarkCopy(copy, persona) {
  if (copy == null) return "";
  if (typeof copy === "string") return copy;

  let mode;
  if (persona === true || persona === "casual") mode = "casual";
  else if (persona === false || persona === "pro") mode = "pro";
  else mode = "casual";

  return copy[mode] ?? copy.casual ?? copy.pro ?? "";
}

/**
 * TourCoachmark.jsx
 *
 * The Poseidon-styled instruction bubble of the guided spotlight tour
 * (onboarding-revamp spec, task 7.1). It anchors next to the spotlighted target
 * and delivers contextual, persona-aware guidance plus an optional "Skip"
 * affordance (Req 3.2).
 *
 * Positioning:
 *   - Given the target's `targetRect` (supplied by `SpotlightOverlay`), the
 *     bubble computes its own on-screen position via the pure
 *     `computeCoachmarkPlacement` helper, preferring below → above → right →
 *     left and clamping to stay within the viewport (Req 9.2 — always reachable).
 *   - It re-positions on window resize/scroll and whenever the target rect or
 *     its own measured size changes.
 *
 * Copy:
 *   - `message`/`copy` may be a plain string or a `{ casual, pro }` entry that
 *     is resolved against `casualMode`/`persona` for persona-aware wording
 *     (Req 4.3 wording carries through the tour steps). `children` may be used
 *     for richer content instead.
 *
 * Accessibility (Req 9.2):
 *   - Rendered as a `role="dialog"` with `aria-live="polite"` so the instruction
 *     is announced.
 *   - Focus is trapped within the bubble while active; focus is restored to the
 *     previously focused element on unmount.
 *   - `Esc` triggers Skip where the step allows it (`skippable`); otherwise it is
 *     a no-op so the user can't accidentally dismiss a required step.
 *   - The spotlighted target underneath stays fully operable — the bubble only
 *     captures pointer/keyboard for its own controls (it does not cover the
 *     target), so the user can still perform the real action.
 *
 * Validates: Requirements 3.1, 3.2, 9.2
 *
 * @param {object} props
 * @param {{top:number,left:number,width:number,height:number}|null} props.targetRect
 * @param {string|{casual?:string,pro?:string}} [props.message]  Instruction copy.
 * @param {string|{casual?:string,pro?:string}} [props.copy]     Alias for `message`.
 * @param {string|{casual?:string,pro?:string}} [props.title]    Optional heading.
 * @param {boolean|"casual"|"pro"|null} [props.casualMode]       Persona for copy.
 * @param {boolean|"casual"|"pro"|null} [props.persona]          Alias for `casualMode`.
 * @param {boolean} [props.skippable]        Whether the step can be skipped.
 * @param {()=>void} [props.onSkip]          Skip handler (also bound to Esc).
 * @param {string} [props.skipLabel]         Skip control label (default "Skip for now").
 * @param {boolean} [props.autoFocus=true]   Trap + move focus into the bubble on mount.
 * @param {React.ReactNode} [props.children] Custom body content (overrides message).
 */
export function TourCoachmark({
  targetRect,
  message,
  copy,
  title,
  casualMode,
  persona,
  skippable = false,
  onSkip,
  skipLabel = "Skip for now",
  autoFocus = true,
  children,
}) {
  const bubbleRef = useRef(null);
  const [size, setSize] = useState(DEFAULT_COACHMARK_SIZE);
  const [pos, setPos] = useState(null);

  const personaValue = casualMode ?? persona ?? null;
  const bodyText = resolveCoachmarkCopy(copy ?? message, personaValue);
  const titleText = resolveCoachmarkCopy(title, personaValue);

  // Measure the bubble's actual size so placement accounts for real content.
  useLayoutEffect(() => {
    const el = bubbleRef.current;
    if (!el || typeof el.getBoundingClientRect !== "function") return;
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) {
      setSize((prev) =>
        Math.abs(prev.width - r.width) < 0.5 && Math.abs(prev.height - r.height) < 0.5
          ? prev
          : { width: r.width, height: r.height }
      );
    }
  }, [bodyText, titleText, children, targetRect]);

  // Compute the bubble position from the target rect + measured size.
  const reposition = useCallback(() => {
    if (!targetRect || typeof window === "undefined") {
      setPos(null);
      return;
    }
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    setPos(computeCoachmarkPlacement(targetRect, viewport, size));
  }, [targetRect, size]);

  useEffect(() => {
    reposition();
  }, [reposition]);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const onChange = () => reposition();
    window.addEventListener("resize", onChange);
    window.addEventListener("scroll", onChange, true);
    return () => {
      window.removeEventListener("resize", onChange);
      window.removeEventListener("scroll", onChange, true);
    };
  }, [reposition]);

  // Trap focus within the coachmark while active; restore focus on unmount.
  useEffect(() => {
    if (!autoFocus) return undefined;
    const el = bubbleRef.current;
    if (!el) return undefined;
    const previouslyFocused =
      typeof document !== "undefined" ? document.activeElement : null;
    const release = trapFocus(el);
    return () => {
      release();
      if (previouslyFocused && typeof previouslyFocused.focus === "function") {
        previouslyFocused.focus();
      }
    };
  }, [autoFocus]);

  // Esc = skip where allowed; otherwise a deliberate no-op (can't dismiss a
  // required step accidentally).
  useEffect(() => {
    if (typeof document === "undefined") return undefined;
    const onKeyDown = (e) => {
      if (e.key === "Escape" && skippable && typeof onSkip === "function") {
        e.preventDefault();
        onSkip();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [skippable, onSkip]);

  // Hidden until we have a position (avoids a flash at 0,0 before measuring).
  const style = pos
    ? { top: `${pos.top}px`, left: `${pos.left}px` }
    : { top: 0, left: 0, visibility: "hidden" };

  return (
    <div
      ref={bubbleRef}
      className="tour-coachmark"
      role="dialog"
      aria-modal="false"
      aria-live="polite"
      aria-label={titleText || "Tour guidance"}
      data-placement={pos?.placement}
      style={style}
    >
      <div
        className="tour-coachmark__header"
        style={{ display: "flex", alignItems: "center", gap: "0.6rem", marginBottom: "0.5rem" }}
      >
        <img
          className="poseidon-avatar"
          src={POSEIDON_AVATAR}
          alt="Poseidon"
          draggable={false}
        />
        {titleText && (
          <strong className="tour-coachmark__title" style={{ fontSize: "0.95rem" }}>
            {titleText}
          </strong>
        )}
      </div>

      <div className="tour-coachmark__body">
        {children ?? <p style={{ margin: 0 }}>{bodyText}</p>}
      </div>

      {skippable && (
        <div className="tour-coachmark__actions" style={{ marginTop: "0.75rem", textAlign: "right" }}>
          <button type="button" className="tour-skip" onClick={onSkip}>
            {skipLabel}
          </button>
        </div>
      )}
    </div>
  );
}

export default TourCoachmark;
