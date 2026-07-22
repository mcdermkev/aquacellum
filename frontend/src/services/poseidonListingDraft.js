/**
 * poseidonListingDraft.js
 *
 * Client for the "Draft with Poseidon" listing-description assist (Task 9
 * Increment 2 §2.3). Deliberately separate from `usePoseidon` — this call
 * must send ONLY the sanitized `groundingFacts` whitelist produced by
 * `listingDraft.js`'s `buildListingDraftFromSpecies`, never free-form seller
 * text, chat history, or session context. Reusing the conversational
 * `sendMessage`/`messages` state would risk leaking prior chat context into
 * the grounded prompt, so this posts directly to the same endpoint with the
 * `listing_description` intent instead.
 *
 * REVIEW GATE (Opus): this module's request shape is one half of the
 * grounding contract; the server-side system prompt + whitelist enforcement
 * in `api/ai.js handleListingDescriptionDraft` is the other half. Do not
 * widen what this module sends without re-reviewing both sides together.
 *
 * Graceful by design: any failure (offline, not configured, network error)
 * resolves to `{ description: null, error }` rather than throwing, so the
 * listing form's description field is never blocked on AI — the seller can
 * always write their own copy.
 */

const POSEIDON_API_URL = "/api/ai?action=poseidon";

/**
 * Request a grounded listing-description draft from Poseidon.
 *
 * @param {Object} groundingFacts - the whitelist from
 *   `buildListingDraftFromSpecies(...).groundingFacts` (or an equivalently
 *   sanitized object). Only whitelisted keys are ever forwarded server-side
 *   regardless of what's passed here — the server re-sanitizes.
 * @param {{ mode?: ('casual'|'pro') }} [opts]
 * @returns {Promise<{ description: (string|null), error?: string, offline?: boolean }>}
 */
export async function draftListingDescription(groundingFacts, opts = {}) {
  if (!groundingFacts || typeof groundingFacts !== "object") {
    return { description: null, error: "No species care data available to draft from yet." };
  }

  try {
    const response = await fetch(POSEIDON_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        intent: "listing_description",
        groundingFacts,
        mode: opts.mode === "pro" ? "pro" : "casual",
      }),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      return { description: null, error: data.error || `Request failed (${response.status})` };
    }
    return { description: data.description || null, error: data.error, offline: !!data.offline };
  } catch (err) {
    console.warn("[poseidonListingDraft] Draft request failed:", err.message);
    return { description: null, error: "Couldn't reach the drafting assistant — write your own description." };
  }
}
