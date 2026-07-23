/**
 * promotionsApi.js
 *
 * Client-side service for seller promotions & customer segments (Task 21B).
 * Talks to the `?action=promotions` / `?action=segments` routes
 * consolidated onto `/api/storefront-detail` (kept on that existing router
 * rather than a new function — `frontend/api/` is already at Vercel
 * Hobby's 12-function limit; see storefront-detail.js's file header).
 *
 * Every call requires a Privy session token, registered via
 * `setSessionTokenGetter` — the same bridge pattern used by
 * shipping.js/parcelPresets.js/reviewsApi.js/storeMerchandisingApi.js. The
 * server derives the wallet from that token, never from the request body.
 *
 * MONEY BOUNDARY: this file is authoring/read-only. It never applies a
 * promotion to a real checkout — see promotionEngine.js's documented seam.
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
    console.warn("[PromotionsApi] Could not resolve session token:", err.message);
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

/**
 * List the authenticated seller's own promotions (all — active, paused, expired).
 * @returns {Promise<{success:boolean, promotions?:Object[], error?:string}>}
 */
export async function listPromotions() {
  return request("promotions");
}

/**
 * Create or update a promotion for the authenticated seller. Updates when
 * `promotion.id` is present; creates otherwise.
 * @param {Object} promotion - camelCase draft (code?, type, value, scope,
 *   scopeRefs?, minSubtotalCents?, startsAt?, endsAt?, usageLimit?, funding, active?)
 * @returns {Promise<{success:boolean, promotion?:Object, error?:string}>}
 */
export async function savePromotion(promotion) {
  const { id, ...body } = promotion || {};
  if (id != null) {
    return request("promotions", { method: "PUT", params: { id }, body });
  }
  return request("promotions", { method: "POST", body });
}

/**
 * Delete a promotion by id (must belong to the authenticated seller).
 * @param {string} id
 * @returns {Promise<{success:boolean, error?:string}>}
 */
export async function deletePromotion(id) {
  return request("promotions", { method: "DELETE", params: { id } });
}

/**
 * Fetch the authenticated seller's privacy-conscious customer segments
 * (repeat buyers / high-value buyers / at-risk buyers, alias-only).
 * @returns {Promise<{success:boolean, segments?:Object, error?:string}>}
 */
export async function fetchCustomerSegments() {
  return request("segments");
}
