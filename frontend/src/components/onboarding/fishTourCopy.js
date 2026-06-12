/**
 * fishTourCopy.js — pure, dependency-free copy for the add-fish tour step
 * (onboarding-revamp spec, task 8.2).
 *
 * Extracted from `FishTourStep.jsx` (mirroring `tankTourCopy.js` from task 8.1)
 * so the persona-aware wording can be unit-tested in the project's `node` vitest
 * environment without pulling in React contexts (OnboardingContext →
 * AuthContext transitively touches `window`/Privy at module load).
 *
 * Casual mode keeps the framing friendly and jargon-free ("add your first
 * fish"); pro mode uses operational language ("register your first specimen")
 * per the established persona split (Req 4.3 — Poseidon guidance appropriate to
 * the selected persona).
 *
 * Validates: Requirements 4.1, 4.3, 4.4, 4.5
 */

/**
 * Persona-aware copy for the add-fish tour step. Each entry is a `{ casual, pro }`
 * pair resolved via `resolveFishCopy`. Plain strings are returned as-is.
 */
export const FISH_TOUR_COPY = Object.freeze({
  // Coachmark heading shown beside Poseidon's avatar.
  title: {
    casual: "Add your first fish",
    pro: "Register your first specimen",
  },
  // Spotlight instruction anchored to the highlighted "Add a Fish" control.
  instruction: {
    casual:
      "Go to your My Aquariums tab, select a tank, and add a fish to it — Echo's been waiting for a tank-mate!",
    pro: "Open the highlighted specimen panel, select a species from the catalog, and register the birth certificate to populate your facility.",
  },
  // Non-blocking note shown WHILE the species catalog is still hydrating in the
  // background (Req 4.4 — never block the user on full hydration).
  catalogPreparing: {
    casual:
      "I'm still gathering the full fish encyclopedia in the background — no need to wait, you can start adding right now.",
    pro: "Species catalog is still hydrating in the background. Registration is available now; the catalog fills in as it loads.",
  },
  // Skip affordance label (Req 4.5 — adding a fish is optional).
  skip: {
    casual: "Skip for now",
    pro: "Skip, add later",
  },
  // Offered when the step times out — lets the user proceed (Req 4.5).
  timeoutHelp: {
    casual:
      "No rush at all — you can add a fish any time from your Aquariums list. Shall we carry on for now?",
    pro: "No specimen detected yet. You can register one later from the specimen panel — continue for now?",
  },
  // Heading for the graceful timeout / skip card.
  timeoutTitle: {
    casual: "Add a fish whenever you're ready",
    pro: "Specimen registration pending",
  },
  // Explicit continue control on the timeout card (Req 4.5).
  continueAnyway: {
    casual: "Continue for now",
    pro: "Continue, register later",
  },
});

/**
 * resolveFishCopy — pick the persona-aware variant of a copy value.
 *
 * Pure helper (no React) mirroring `resolveTankCopy`/`resolveCoachmarkCopy` used
 * elsewhere in the onboarding module. Accepts either an already-resolved string
 * or a `{ casual, pro }` entry plus the persona, expressed as the `casualMode`
 * boolean (true ⇒ casual, false ⇒ pro) or the persona strings ("casual"/"pro").
 * A null/unknown persona defaults to the casual tone so copy stays friendly.
 *
 * @param {string|{casual?:string,pro?:string}|null|undefined} copy
 * @param {boolean|"casual"|"pro"|null} [persona]
 * @returns {string}
 */
export function resolveFishCopy(copy, persona) {
  if (copy == null) return "";
  if (typeof copy === "string") return copy;

  let mode;
  if (persona === false || persona === "pro") mode = "pro";
  else mode = "casual"; // true | "casual" | null | undefined

  return copy[mode] ?? copy.casual ?? copy.pro ?? "";
}
