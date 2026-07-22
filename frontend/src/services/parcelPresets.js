/**
 * parcelPresets.js
 *
 * Client-side service for the seller's parcel-preset editor (Task 9
 * Increment 2 §2.4). Thin — every write goes through the authenticated
 * `?action=parcel-presets` action on the consolidated `/api/stripe`
 * function (kept on that function, not a new one, to stay within Vercel
 * Hobby's 12 serverless function limit — see stripe.js's file header).
 *
 * Auth mirrors shipping.js: register a Privy `getAccessToken`-like getter
 * via `setSessionTokenGetter`; every request sends it as a bearer token.
 * The server derives the wallet from that token, never from the request
 * body (see stripe.js `requireWalletFromSession`).
 *
 * Every preset returned here is exactly what round-trips through
 * `packingEngine.normalizeParcelPreset` — camelCase capacity fields, no
 * legacy dimension columns.
 */

const API_BASE = import.meta.env.VITE_API_BASE || "/api";

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
    console.warn("[ParcelPresets] Could not resolve session token:", err.message);
    return null;
  }
}

async function authedFetch(path, { method = "GET", body } = {}) {
  const headers = { "Content-Type": "application/json" };
  const token = await getSessionToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}/stripe?action=parcel-presets${path}`, {
    method,
    headers,
    body: body != null ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return { success: false, error: data.error || `Request failed (${res.status})` };
  }
  return { success: true, ...data };
}

/**
 * List the authenticated seller's parcel presets.
 * @returns {Promise<{success:boolean, presets?:Object[], error?:string}>}
 */
export async function listParcelPresets() {
  return authedFetch("");
}

/**
 * Create or update a parcel preset for the authenticated seller.
 * Updates when `preset.id` is present; creates otherwise.
 *
 * @param {Object} preset - { id?, label, usableWeightOz, maxBags,
 *   usableVolumeIn3, thermalPackSpaceIn3, maxLivestock, isDefault? }
 * @returns {Promise<{success:boolean, preset?:Object, error?:string}>}
 */
export async function saveParcelPreset(preset) {
  const { id, ...body } = preset || {};
  if (id != null) {
    return authedFetch(`&id=${encodeURIComponent(id)}`, { method: "PUT", body });
  }
  return authedFetch("", { method: "POST", body });
}

/**
 * Delete a parcel preset by id (must belong to the authenticated seller).
 * @param {number|string} id
 * @returns {Promise<{success:boolean, error?:string}>}
 */
export async function deleteParcelPreset(id) {
  return authedFetch(`&id=${encodeURIComponent(id)}`, { method: "DELETE" });
}
