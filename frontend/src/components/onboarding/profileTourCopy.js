/**
 * profileTourCopy.js — pure, dependency-free copy for the profile-picture nudge
 * tour step (onboarding-revamp spec, task 8.3).
 *
 * Extracted from `ProfileTourStep.jsx` (mirroring `fishTourCopy.js`/`tankTourCopy.js`
 * from tasks 8.1/8.2) so the persona-aware wording can be unit-tested in the
 * project's `node` vitest environment without pulling in React contexts
 * (OnboardingContext → AuthContext transitively touches `window`/Privy at module
 * load).
 *
 * Casual mode keeps the framing friendly and jargon-free ("add a profile
 * picture"); pro mode uses operational language ("set your operator avatar") per
 * the established persona split. Setting a picture is OPTIONAL — the default
 * avatar remains if the user skips (Req 7.5), so every "skip"/"later" affordance
 * is phrased to reassure rather than pressure.
 *
 * Validates: Requirements 7.3, 7.4, 7.5
 */

/**
 * Persona-aware copy for the profile-picture nudge step. Each entry is a
 * `{ casual, pro }` pair resolved via `resolveProfileCopy`. Plain strings are
 * returned as-is.
 */
export const PROFILE_TOUR_COPY = Object.freeze({
  // Coachmark heading shown beside Poseidon's avatar.
  title: {
    casual: "Make it yours",
    pro: "Set your operator avatar",
  },
  // Spotlight instruction anchored to the highlighted profile widget (Req 7.3, 7.4).
  instruction: {
    casual:
      "Tap your profile in the corner and choose View Profile to add a photo — give your reef presence a friendly face!",
    pro: "Open the highlighted profile widget and select View Profile to upload an operator avatar for your facility identity.",
  },
  // Skip affordance label — setting a picture is optional (Req 7.5).
  skip: {
    casual: "Maybe later",
    pro: "Skip, set later",
  },
  // Offered when the step times out — lets the user proceed with the default
  // avatar (Req 7.5).
  timeoutHelp: {
    casual:
      "No worries — your default avatar looks great too. You can add a photo any time from your profile. Shall we wrap up?",
    pro: "No avatar uploaded yet. The default identity stands; you can set an avatar later from your profile. Continue?",
  },
  // Heading for the graceful timeout / skip card.
  timeoutTitle: {
    casual: "Add a photo whenever you like",
    pro: "Avatar upload optional",
  },
  // Explicit continue control on the timeout card (Req 7.5).
  continueAnyway: {
    casual: "Finish up",
    pro: "Continue, set later",
  },
});

/**
 * resolveProfileCopy — pick the persona-aware variant of a copy value.
 *
 * Pure helper (no React) mirroring `resolveFishCopy`/`resolveTankCopy` used
 * elsewhere in the onboarding module. Accepts either an already-resolved string
 * or a `{ casual, pro }` entry plus the persona, expressed as the `casualMode`
 * boolean (true ⇒ casual, false ⇒ pro) or the persona strings ("casual"/"pro").
 * A null/unknown persona defaults to the casual tone so copy stays friendly.
 *
 * @param {string|{casual?:string,pro?:string}|null|undefined} copy
 * @param {boolean|"casual"|"pro"|null} [persona]
 * @returns {string}
 */
export function resolveProfileCopy(copy, persona) {
  if (copy == null) return "";
  if (typeof copy === "string") return copy;

  let mode;
  if (persona === false || persona === "pro") mode = "pro";
  else mode = "casual"; // true | "casual" | null | undefined

  return copy[mode] ?? copy.casual ?? copy.pro ?? "";
}
