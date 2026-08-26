/**
 * reviewsApi.js
 *
 * Client-side service for Verified Structured Reviews (Task 20). Talks to
 * the review actions consolidated onto `/api/storefront-detail` (kept on
 * that existing router rather than a new `/api/reviews` function, since
 * `frontend/api/` is already at Vercel Hobby's 12-function limit — see
 * storefront-detail.js's file header).
 *
 * Reads are public. Writes (submit/respond/report) require a Privy session
 * token, registered via `setSessionTokenGetter` — the same bridge pattern
 * used by shipping.js/stripePayments.js/parcelPresets.js. The server derives
 * the wallet from that token, never from the request body.
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
    console.warn("[ReviewsApi] Could not resolve session token:", err.message);
    return null;
  }
}

async function request(action, { method = "GET", params, body, auth = false } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (auth) {
    const token = await getSessionToken();
    if (token) headers["Authorization"] = `Bearer ${token}`;
  }

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
 * Fetch a seller's published reviews (paginated). Public — no auth.
 * @param {string} sellerWallet
 * @param {{ limit?: number, offset?: number }} [opts]
 * @returns {Promise<{success:boolean, reviews?:Object[], total?:number, error?:string}>}
 */
export async function fetchSellerReviews(sellerWallet, opts = {}) {
  return request("reviews", {
    params: { seller: sellerWallet, limit: opts.limit ?? 20, offset: opts.offset ?? 0 },
  });
}

/**
 * Fetch the review already on file for one order, or null. Public.
 * @param {string} orderIdOrRef
 * @returns {Promise<{success:boolean, review?:(Object|null), error?:string}>}
 */
export async function fetchReviewForOrder(orderIdOrRef) {
  return request("review-for-order", { params: { order: orderIdOrRef } });
}

/**
 * Submit a review for a completed order. Requires an authenticated session
 * (the buyer). The server re-verifies eligibility independently — this call
 * can still come back 403/409/422 even if the client's own eligibility
 * check passed, and callers should surface that message rather than assume
 * success.
 *
 * @param {Object} params
 * @param {string} [params.orderId] - canonical orders.id (uuid), when known
 * @param {string} [params.orderRef] - legacy local_key/stripe_session_id fallback
 * @param {number} params.overall - 1-5
 * @param {number} [params.health]
 * @param {number} [params.accuracy]
 * @param {number} [params.packaging]
 * @param {number} [params.communication]
 * @param {number} [params.fulfillment]
 * @param {string} [params.body]
 * @param {string[]} [params.photoUrls]
 * @returns {Promise<{success:boolean, review?:Object, error?:string, status?:number}>}
 */
export async function submitReview(params) {
  return request("submit-review", { method: "POST", body: params, auth: true });
}

/**
 * Add the seller's one response to a review on their own order.
 * @param {string} reviewId
 * @param {string} response
 * @returns {Promise<{success:boolean, review?:Object, error?:string}>}
 */
export async function respondToReview(reviewId, response) {
  return request("respond-review", { method: "POST", body: { reviewId, response }, auth: true });
}
