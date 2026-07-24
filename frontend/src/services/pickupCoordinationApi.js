/**
 * pickupCoordinationApi.js
 *
 * Client-side service for Task 25 (Local Pickup Coordination). Talks to the
 * `?action=pickup-locations` / `pickup-for-order` / `pickup-arrange` /
 * `pickup-confirm` routes consolidated onto `/api/storefront-detail` (kept
 * on that existing router rather than a new function — `frontend/api/` is
 * already at Vercel Hobby's 12-function limit; see storefront-detail.js's
 * file header).
 *
 * Every call requires a Privy session token, registered via
 * `setSessionTokenGetter` — the same bridge pattern used by
 * shipping.js/promotionsApi.js/storeMerchandisingApi.js. The server derives
 * the wallet from that token, never from the request body. None of these
 * calls touch settlement/payment — they only read/write pickup logistics
 * metadata (Guardrail 1, docs/TASK_25_PICKUP_COORDINATION_SPEC.md §0.1).
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
    console.warn("[PickupCoordinationApi] Could not resolve session token:", err.message);
    return null;
  }
}

async function request(action, { method = "GET", params, body } = {}) {
  const headers = { "Content-Type": "application/json" };
  const token = await getSessionToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const query = new URLSearchParams({ action, ...(params || {}) });
  const res = await fetch(`${API_BASE}/storefront-detail?${query.toString()}`, {
    method,
    headers,
    body: body != null ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return { success: false, error: data.error || `Request failed (${res.status})`, status: res.status };
  }
  return { success: true, ...data };
}

// ─── Seller: pickup-spot CRUD ───────────────────────────────────────────────

/**
 * List the authenticated seller's own pickup spots (including inactive).
 * @returns {Promise<{success:boolean, locations?:Object[], error?:string}>}
 */
export async function listPickupLocations() {
  return request("pickup-locations");
}

/**
 * Create or update a pickup spot for the authenticated seller. Updates when
 * `location.id` is present; creates otherwise.
 * @param {Object} location - camelCase draft (label, lat?, lng?, addressText?,
 *   notes?, availability?, active?, sortOrder?)
 * @returns {Promise<{success:boolean, location?:Object, error?:string}>}
 */
export async function savePickupLocation(location) {
  const { id, ...body } = location || {};
  if (id != null) {
    return request("pickup-locations", { method: "PUT", params: { id }, body });
  }
  return request("pickup-locations", { method: "POST", body });
}

/**
 * Delete a pickup spot by id (must belong to the authenticated seller).
 * @param {string} id
 * @returns {Promise<{success:boolean, error?:string}>}
 */
export async function deletePickupLocation(id) {
  return request("pickup-locations", { method: "DELETE", params: { id } });
}

// ─── Buyer/seller: order-scoped reveal + scheduling ─────────────────────────

/**
 * Fetch the resolved pickup spot + arrangement for one order. Only
 * succeeds if the caller is the buyer or seller on that order (server-side
 * reveal gate) — exact coordinates never appear otherwise.
 * @param {string} orderRef - the canonical order id, or a legacy
 *   local_key/stripe_session_id reference
 * @returns {Promise<{success:boolean, location?:Object, arrangement?:Object, error?:string}>}
 */
export async function fetchPickupForOrder(orderRef) {
  return request("pickup-for-order", { params: { order: orderRef } });
}

/**
 * Buyer proposes a pickup time for an order they own. The server
 * re-validates the time against the seller's availability windows.
 * @param {{ orderId?:string, orderRef?:string, pickupLocationId?:string, proposedTime:string }} params
 * @returns {Promise<{success:boolean, arrangement?:Object, error?:string}>}
 */
export async function proposePickupTime({ orderId, orderRef, pickupLocationId, proposedTime }) {
  return request("pickup-arrange", { method: "POST", body: { orderId, orderRef, pickupLocationId, proposedTime } });
}

/**
 * Seller confirms (or counters) the proposed pickup time for an order they
 * are selling.
 * @param {{ orderId?:string, orderRef?:string, confirmedTime?:string }} params
 * @returns {Promise<{success:boolean, arrangement?:Object, error?:string}>}
 */
export async function confirmPickupTime({ orderId, orderRef, confirmedTime }) {
  return request("pickup-confirm", { method: "POST", body: { orderId, orderRef, confirmedTime } });
}
