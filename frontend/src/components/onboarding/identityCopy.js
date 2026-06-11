/**
 * identityCopy.js — pure, dependency-free copy + helper for the IdentityStep.
 *
 * Extracted from `IdentityStep.jsx` so the persona-aware wording and selection
 * logic can be unit-tested in the project's `node` vitest environment without
 * pulling in React contexts (AuthContext transitively touches `window` at
 * module load).
 *
 * Casual mode keeps blockchain terminology abstracted ("secure logbook"); pro
 * mode may reference the embedded node/key (Req 5.5).
 *
 * Validates: Requirements 5.1, 5.4, 5.5
 */

// Persona-aware copy for the identity step.
export const IDENTITY_COPY = Object.freeze({
  // Primary CTA label.
  cta: { casual: "Create My Logbook", pro: "Initialize Node" },
  // Disabled label while the embedded wallet is being provisioned.
  ctaBusy: { casual: "Setting up your logbook…", pro: "Provisioning node…" },
  // Friendly retry line shown when Privy login fails / is cancelled (5.4).
  retry: {
    casual:
      "Hmm, the tide pulled that one back before we finished. No harm done — tap to try again whenever you're ready.",
    pro: "Node provisioning was interrupted. Re-attempt initialization when ready.",
  },
});

/**
 * resolveCopy — pick persona-aware copy for an IDENTITY_COPY entry.
 *
 * Pure helper (no React) so it can be unit-tested in isolation. Accepts the
 * `casualMode` boolean (true ⇒ casual, false ⇒ pro). A null/undefined mode
 * defaults to casual so copy is always friendly when the persona is unknown.
 *
 * @param {{casual:string, pro:string}} entry
 * @param {boolean|null} casualMode
 * @returns {string}
 */
export function resolveCopy(entry, casualMode) {
  if (!entry) return "";
  return casualMode === false ? entry.pro : entry.casual;
}
