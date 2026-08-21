import { useEffect } from "react";
import { echoAttend, echoRelease } from "../services/echoGaze";

/**
 * useEchoAttend — ask Echo to look at something while it matters.
 *
 * Step 4 of docs/ECHO_CHARACTER_SPEC.md. The ergonomic front door to the gaze
 * protocol for React components:
 *
 *   const panelRef = useRef(null);
 *   useEchoAttend(panelRef, isOpen);
 *
 * She looks at the element while `active` is true and lets go when it goes false
 * or the component unmounts. Deliberately tiny: it dispatches two events and owns
 * nothing. All the geometry, the re-measuring on scroll, and the staleness
 * handling live in the mount (`attachGazeTracking`), because only the mount knows
 * where Echo is — and she drifts, so an offset computed here would already be
 * wrong.
 *
 * SAFE WHEN ECHO IS ABSENT. If she is switched off in Settings or simply not
 * mounted, the events go nowhere. A component asking for her attention must never
 * be able to break by asking, which is why this returns nothing and reports no
 * errors.
 *
 * @param {{current: Element|null}} ref  element she should look at
 * @param {boolean} active               whether it currently deserves attention
 */
export function useEchoAttend(ref, active = true) {
  useEffect(() => {
    if (!active || !ref?.current) return;

    echoAttend(ref.current);

    // Release on the way out. Without this she would keep looking at a panel
    // after it closed — the element is gone, so the mount would eventually notice
    // and let go, but "eventually" means on the next scroll or resize, and until
    // then she stares at a hole.
    return () => echoRelease();
    // `ref` is a stable object; `ref.current` deliberately is NOT a dependency.
    // Re-running on every render would re-dispatch attend continuously, and the
    // mount re-measures on scroll and resize anyway.
  }, [active, ref]);
}

export default useEchoAttend;
