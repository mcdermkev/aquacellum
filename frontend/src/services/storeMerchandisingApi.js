/**
 * storeMerchandisingApi.js
 *
 * Client-side service for storefront merchandising (Task 21A). Talks to the
 * `?action=sections` route consolidated onto `/api/storefront-detail`
 * (kept on that existing router rather than a new `/api/sections` function
 * — `frontend/api/` is already at Vercel Hobby's 12-function limit; see
 * storefront-detail.js's file header).
 *
 * Reads are public. The write (save) requires a Privy session token,
 * registered via `setSessionTokenGetter` — the same bridge pattern used by
 * shipping.js/stripePayments.js/parcelPresets.js/reviewsApi.js. The server
 * derives the wallet from that token, never from the request body.
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
    console.warn("[StoreMerchandisingApi] Could not resolve session token:", err.message);
    return null;
  }
}

async function request(params, { method = "GET", body, auth = false } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (auth) {
    const token = await getSessionToken();
    if (token) headers["Authorization"] = `Bearer ${token}`;
  }

  const query = new URLSearchParams({ action: "sections", ...(params || {}) });
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
 * Fetch a seller's visible storefront sections. Public — no auth.
 * @param {string} sellerWallet
 * @returns {Promise<{success:boolean, sections?:Object[], error?:string}>}
 */
export async function fetchStoreSections(sellerWallet) {
  return request({ seller: sellerWallet });
}

/**
 * Save (replace) the authenticated seller's full sections list. Requires an
 * authenticated session — the server derives the owner wallet from it.
 * @param {Object[]} sections - drafts in camelCase (type, title, listingRefs,
 *   sortOrder, visible)
 * @returns {Promise<{success:boolean, sections?:Object[], error?:string}>}
 */
export async function saveStoreSections(sections) {
  return request(undefined, { method: "PUT", body: { sections }, auth: true });
}
