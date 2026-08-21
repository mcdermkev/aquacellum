/**
 * echoVision.js — Echo's eyes. Step 6 of docs/ECHO_CHARACTER_SPEC.md.
 *
 * "Poseidon is the brain, Echo is the body." So this module does not decide what a
 * fish is; it hands a photo to the model and drives Echo's EXAMINING state while it
 * waits. The determination comes back from `POST /api/ai?action=identify-fish`.
 *
 * ── The visible part ─────────────────────────────────────────────────────────
 * `identifyFish()` dispatches `echo:vision-start` before the request and
 * `echo:vision-end` after it, in a `finally`, so she cannot get stuck squinting if
 * the call throws. Both mounts listen for those two events — the React one in the
 * app and the vanilla one on `database.html` — which is the whole reason the
 * protocol is a DOM event rather than a React context: the static pages have no
 * React, and Echo lives on them too.
 *
 * That pairing is the feature. The behaviour core has modelled EXAMINING since the
 * rework, with nothing to trigger it; this is what makes her concentrate while the
 * brain looks, which is the moment she stops being decoration.
 *
 * ── Auth ─────────────────────────────────────────────────────────────────────
 * Identification is a paid vision call, so the endpoint requires a signed-in
 * account. Same bridge as every other authed service here: `setSessionTokenGetter`
 * takes Privy's `getAccessToken`, and the token rides as a bearer header. The
 * server derives identity from the token and never from the body.
 *
 * A 401 comes back as `needsAuth: true` rather than a generic failure, so the UI
 * can offer a sign-in prompt instead of a retry that will never succeed.
 */

import { compressImage } from "../utils/imageCompression";

const API_BASE = import.meta.env.VITE_API_BASE || "/api";

export const ECHO_VISION_START_EVENT = "echo:vision-start";
export const ECHO_VISION_END_EVENT = "echo:vision-end";

/**
 * Identification wants more detail than a thumbnail — fin rays and pattern edges
 * are the evidence. Still far below the endpoint's 3 MB cap: 1024px at q0.82 lands
 * in the low hundreds of KB, and sending a raw phone photo would risk the Vercel
 * request body limit for no accuracy gain.
 */
const CAPTURE_MAX_EDGE = 1024;
const CAPTURE_QUALITY = 0.82;

let _sessionTokenGetter = null;

/** Register the session-token getter (e.g. Privy getAccessToken). Pass null to clear. */
export function setSessionTokenGetter(getter) {
  _sessionTokenGetter = typeof getter === "function" ? getter : null;
}

async function getSessionToken() {
  if (!_sessionTokenGetter) return null;
  try {
    return (await _sessionTokenGetter()) || null;
  } catch (err) {
    console.warn("[EchoVision] Could not resolve session token:", err.message);
    return null;
  }
}

/**
 * The two dispatchers, written out rather than funnelled through one helper taking
 * the name as an argument.
 *
 * That is not styling. `scripts/seams/analyzeSeams.mjs` resolves an event name from
 * a literal or a module constant at the `new CustomEvent(...)` site, but a function
 * PARAMETER is not statically resolvable — so a shared `dispatch(name)` helper made
 * both of these look like listeners that nothing fires, and `seamInventory.test.js`
 * correctly failed. Same shape as `echoGaze.js` for the same reason.
 */
function dispatchVisionStart() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(ECHO_VISION_START_EVENT));
}

function dispatchVisionEnd() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(ECHO_VISION_END_EVENT));
}

/**
 * Identify the fish in a photo.
 *
 * @param {File|string} input A File from a camera/file input, or a base64 data URL.
 * @param {{ mode?: "casual"|"pro" }} [options]
 * @returns {Promise<{
 *   success: boolean,
 *   isFish?: boolean,
 *   candidates?: Array<{scientificName: string, commonName: string, confidence: number,
 *                       specCode: number|null, inCatalog: boolean, catalogCommonName: string|null}>,
 *   observation?: string|null,
 *   needsAuth?: boolean,
 *   rateLimited?: boolean,
 *   error?: string,
 * }>}
 */
export async function identifyFish(input, options = {}) {
  if (!input) return { success: false, error: "No photo provided" };

  const token = await getSessionToken();
  if (!token) {
    // Fail before spending a round trip, and before Echo visibly starts examining
    // something she is not going to get an answer about.
    return {
      success: false,
      needsAuth: true,
      error: "Sign in to have Echo take a look at your fish.",
    };
  }

  let imageBase64;
  try {
    imageBase64 = typeof input === "string"
      ? input
      : await compressImage(input, CAPTURE_MAX_EDGE, CAPTURE_MAX_EDGE, CAPTURE_QUALITY);
  } catch (err) {
    return { success: false, error: err?.message || "Could not read that image" };
  }

  dispatchVisionStart();
  try {
    const res = await fetch(`${API_BASE}/ai?action=identify-fish`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ imageBase64, mode: options.mode || "casual" }),
    });

    const data = await res.json().catch(() => ({}));

    if (res.status === 401) {
      return { success: false, needsAuth: true, error: data.error || "Please sign in again." };
    }
    if (res.status === 429) {
      return { success: false, rateLimited: true, error: data.error || "Daily limit reached." };
    }
    if (!res.ok) {
      return { success: false, error: data.error || `Request failed (${res.status})` };
    }
    if (data.error) {
      return { success: false, error: data.error };
    }

    return {
      success: true,
      isFish: data.isFish,
      candidates: Array.isArray(data.candidates) ? data.candidates : [],
      observation: data.observation ?? null,
    };
  } catch (err) {
    console.warn("[EchoVision] Identification failed:", err);
    return { success: false, error: "Could not reach the identifier. Check your connection." };
  } finally {
    // In `finally` deliberately: an exception must not leave her examining forever.
    dispatchVisionEnd();
  }
}
