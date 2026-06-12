/**
 * tankTourCopy.js — pure, dependency-free copy for the tank-registration tour
 * step (onboarding-revamp spec, task 8.1).
 *
 * Extracted from `TankTourStep.jsx` so the persona-aware wording can be
 * unit-tested in the project's `node` vitest environment without pulling in
 * React contexts (OnboardingContext → AuthContext transitively touches
 * `window`/Privy at module load).
 *
 * Casual mode keeps the framing friendly and jargon-free ("set up your tank");
 * pro mode uses operational language ("register a containment unit") per the
 * established persona split (Req 3.2, and the casual/pro tone of Req 8.2).
 *
 * Validates: Requirements 3.1, 3.2, 3.5, 3.6
 */

/**
 * Persona-aware copy for the tank tour step. Each entry is a `{ casual, pro }`
 * pair resolved via `resolveTankCopy`. Plain strings are returned as-is.
 */
export const TANK_TOUR_COPY = Object.freeze({
  // Coachmark heading shown beside Poseidon's avatar.
  title: {
    casual: "Let's set up your first tank",
    pro: "Register your first containment unit",
  },
  // Spotlight instruction anchored to the highlighted control.
  instruction: {
    casual:
      "Tap the highlighted Aquariums area to add your very first tank. Give it a name and you're off — Echo needs a home!",
    pro: "Open the highlighted Aquariums panel and register a containment unit. Set a designation and volume to initialise the facility.",
  },
  // Header for the in-card guided-form fallback (Req 3.5).
  fallbackTitle: {
    casual: "Set up your first tank",
    pro: "Register a containment unit",
  },
  // Lead-in shown above the fallback form.
  fallbackLead: {
    casual:
      "No worries — we'll set it up right here. Just give your tank a name and Echo will move right in.",
    pro: "We'll register the unit inline. Provide a designation and volume to commit it to your facility.",
  },
  // Field labels for the fallback form.
  nameLabel: { casual: "Tank name", pro: "Unit designation" },
  volumeLabel: { casual: "Size (gallons)", pro: "Volume (gallons)" },
  // Submit button on the fallback form.
  submit: { casual: "Create my tank", pro: "Register unit" },
  submitBusy: { casual: "Setting it up…", pro: "Registering…" },
  // Friendly Poseidon line shown when registration fails (Req 3.6).
  error: {
    casual:
      "Ah — the current swept that one away before it landed. Nothing lost. Give it another try, or we can carry on and set the tank up later.",
    pro: "Registration failed to commit. Retry the operation, or continue onboarding and register the unit later.",
  },
  // Retry control after a failure (Req 3.6).
  retry: { casual: "Try again", pro: "Retry" },
  // Allow-continue control so a failure never blocks onboarding (Req 3.6).
  continueAnyway: { casual: "Continue for now", pro: "Continue, register later" },
  // Offered when the spotlight step times out — lets the user proceed (Req 3.6).
  timeoutHelp: {
    casual:
      "Taking a moment? No rush at all. You can set your tank up right here, or carry on and come back to it.",
    pro: "No completion detected yet. Register inline below, or continue and complete this later.",
  },
});

/** Default name pre-filled in the fallback form, persona-aware. */
export const DEFAULT_TANK_NAME = Object.freeze({
  casual: "My First Tank",
  pro: "Primary Unit",
});

/**
 * resolveTankCopy — pick the persona-aware variant of a copy value.
 *
 * Pure helper (no React) mirroring `resolveCoachmarkCopy`/`resolveCopy` used
 * elsewhere in the onboarding module. Accepts either an already-resolved string
 * or a `{ casual, pro }` entry plus the persona, expressed as the `casualMode`
 * boolean (true ⇒ casual, false ⇒ pro) or the persona strings ("casual"/"pro").
 * A null/unknown persona defaults to the casual tone so copy stays friendly.
 *
 * @param {string|{casual?:string,pro?:string}|null|undefined} copy
 * @param {boolean|"casual"|"pro"|null} [persona]
 * @returns {string}
 */
export function resolveTankCopy(copy, persona) {
  if (copy == null) return "";
  if (typeof copy === "string") return copy;

  let mode;
  if (persona === false || persona === "pro") mode = "pro";
  else mode = "casual"; // true | "casual" | null | undefined

  return copy[mode] ?? copy.casual ?? copy.pro ?? "";
}
