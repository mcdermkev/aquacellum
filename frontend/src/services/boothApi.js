/**
 * boothApi.js
 *
 * Client-side service for the booth cash-sale write
 * (`POST /api/storefront-detail?action=record-sale`, BOOTH_BUILD_SPEC.md §4 C1).
 * Folded onto the storefront-detail router like the pickup routes, because
 * `frontend/api/` is at Vercel Hobby's 12-function limit.
 *
 * Auth is the same bridge every other authed seller service uses:
 * `setSessionTokenGetter` takes Privy's `getAccessToken` (registered from
 * AuthContext), and the token rides as a bearer header. The server derives the
 * selling wallet from that token and never from the body — see
 * `requireWalletFromSession` in the handler.
 *
 * MONEY BOUNDARY: no fee, no total, no Stripe. A cash sale moved money in person;
 * this call only records it and decrements real stock. Card sales deliberately
 * cannot go through here — the server rejects `rail !== "cash"` — because a card
 * sale must run through `?action=create-checkout` so the fee policy applies.
 *
 * Failures are classified `permanent` vs not, because the offline outbox needs to
 * know the difference between "the wifi is gone, keep this" and "the server has
 * ruled on this, stop asking".
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
    console.warn("[BoothApi] Could not resolve session token:", err.message);
    return null;
  }
}

/**
 * Record an in-person cash sale.
 *
 * `saleId` MUST be generated once per sale (see `newSaleId` in boothOutbox.js)
 * and reused on every retry. The server is idempotent on it, which is what makes
 * replaying the offline queue safe.
 *
 * @param {object} sale
 * @param {string} sale.saleId
 * @param {string|number} sale.listingId
 * @param {number} sale.quantity
 * @param {number} sale.unitPriceCents - what the seller charged per fish
 * @param {string|null} [sale.note]
 * @param {typeof fetch} [sale.fetchImpl] - injectable for tests
 * @returns {Promise<{ok?:boolean, success:boolean, orderRecorded?:boolean, orderId?:string,
 *   quantityRemaining?:number, warning?:string, error?:string, code?:string,
 *   status?:number, permanent?:boolean, offline?:boolean}>}
 */
export async function recordCashSale({
  saleId,
  listingId,
  quantity = 1,
  unitPriceCents,
  note = null,
  forSeller = null,
  fetchImpl = fetch,
} = {}) {
  const headers = { "Content-Type": "application/json" };
  const token = await getSessionToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;

  let res;
  try {
    res = await fetchImpl(`${API_BASE}/storefront-detail?action=record-sale`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        saleId,
        listingId: String(listingId),
        quantity,
        unitPriceCents,
        // Hardcoded, not a parameter. This module can only record cash.
        rail: "cash",
        note,
        // A helper ringing up a sale for someone else's booth. The server only
        // honours it for an active booth_staff membership; omitted otherwise so
        // the seller's own sale request is unchanged.
        ...(forSeller ? { forSeller: String(forSeller).toLowerCase() } : {}),
      }),
    });
  } catch (err) {
    // No response at all — the classic bad-expo-wifi case. Explicitly NOT
    // permanent: the outbox keeps the row and replays it on reconnect.
    return { success: false, offline: true, permanent: false, error: err?.message || "offline" };
  }

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    return {
      success: false,
      status: res.status,
      code: data.code || null,
      error: data.error || `Request failed (${res.status})`,
      // 4xx is the server ruling on this sale; 5xx is worth retrying.
      permanent: res.status >= 400 && res.status < 500,
    };
  }

  return { success: true, ...data };
}

/**
 * Nudge a line's stock up or down by `delta` (a miscount or a restock — not a
 * sale). `POST /api/storefront-detail?action=adjust-inventory`.
 *
 * Online-only on purpose: unlike a cash sale, a correction is not something that
 * already happened in the physical world and must be kept, and replaying stale
 * taps later would fight whatever the seller has since done. The server applies
 * the delta under the sale lock and returns the authoritative count.
 *
 * @param {object} params
 * @param {string|number} params.listingId
 * @param {number} params.delta - non-zero integer, e.g. +1 / -1
 * @param {typeof fetch} [params.fetchImpl]
 * @returns {Promise<{success:boolean, quantityRemaining?:number, error?:string, code?:string, status?:number, offline?:boolean}>}
 */
export async function adjustInventory({ listingId, delta, fetchImpl = fetch } = {}) {
  const token = await getSessionToken();
  if (!token) return { success: false, error: "Sign in again to change stock.", code: "NO_SESSION" };

  let res;
  try {
    res = await fetchImpl(`${API_BASE}/storefront-detail?action=adjust-inventory`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ listingId: String(listingId), delta }),
    });
  } catch (err) {
    return { success: false, offline: true, error: err?.message || "offline" };
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return { success: false, status: res.status, code: data.code || null, error: data.error || `Request failed (${res.status})` };
  }
  return { success: true, quantityRemaining: Number(data.quantityRemaining) };
}

/**
 * Publish (or re-publish) a tank for its QR label
 * (`POST /api/storefront-detail?action=publish-tank`).
 *
 * Rides the same session bridge as `recordCashSale`: the server derives the
 * owner wallet from the bearer token, keeps only listings that wallet owns, and
 * resolves price/stock itself. The client only says WHICH listings.
 *
 * Throws on failure (unlike the sale path, there is no outbox to classify for).
 *
 * @param {object} params
 * @param {string} params.tankRef - stable per-owner ref; re-publishing keeps the token
 * @param {string} [params.title]
 * @param {string} [params.caption]
 * @param {Array<string|number>} params.listingIds
 * @param {boolean} [params.isPublic]
 * @param {typeof fetch} [params.fetchImpl]
 * @returns {Promise<{ok:boolean, token:string, publicUrl:string, isPublic:boolean, sellableLines:number}>}
 */
export async function publishTank({
  tankRef,
  title = "",
  caption = "",
  listingIds = [],
  isPublic = true,
  fetchImpl = fetch,
} = {}) {
  const token = await getSessionToken();
  if (!token) {
    // Fail before the network: without a session the server can only 401.
    throw new Error("Sign in again to publish this tank.");
  }

  const res = await fetchImpl(`${API_BASE}/storefront-detail?action=publish-tank`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      tankRef,
      title,
      caption,
      listingIds: (Array.isArray(listingIds) ? listingIds : []).map(String),
      isPublic,
    }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Could not publish the tank (${res.status}).`);
  }
  return data;
}

/**
 * Adapter for `replayQueue({ send })`. Takes a stored queue row and reuses its
 * `saleId` verbatim — the one invariant the offline path depends on.
 */
export function sendQueuedSale(row) {
  return recordCashSale({
    saleId: row.saleId,
    listingId: row.listingId,
    quantity: row.quantity,
    unitPriceCents: row.unitPriceCents,
    note: row.note,
    forSeller: row.forSeller || null,
  });
}

// ─── Booth staff (helpers) ──────────────────────────────────────────────────
// Seller-only: createHelperInvite, listHelpers, removeHelper.
// Helper: joinBooth (redeem a scanned code), listBoothsIHelp, fetchHelperInventory.
// Every call rides the same session bridge; the server decides who may do what.

async function staffCall(action, { method = "GET", body, query = "", fetchImpl = fetch } = {}) {
  const token = await getSessionToken();
  if (!token) return { success: false, error: "Sign in to continue.", code: "NO_SESSION" };
  let res;
  try {
    res = await fetchImpl(`${API_BASE}/storefront-detail?action=${action}${query}`, {
      method,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  } catch (err) {
    return { success: false, offline: true, error: err?.message || "offline" };
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { success: false, status: res.status, code: data.code || null, error: data.error || `Request failed (${res.status})` };
  return { success: true, ...data };
}

/** Seller: a single-use, 15-minute code for a helper to scan. → { joinUrl, expiresAt } */
export function createHelperInvite(opts = {}) {
  return staffCall("booth-staff-invite", { method: "POST", body: {}, ...opts });
}

/**
 * Seller: current helpers, with the cash sales each rang up recently.
 * → { salesWindowHours, helpers: [{ wallet, name, addedAt, cashSales: { count, totalCents } | null }] }
 */
export function listHelpers(opts = {}) {
  return staffCall("booth-staff-list", opts);
}

/** Seller: remove a helper. */
export function removeHelper(wallet, opts = {}) {
  return staffCall("booth-staff-remove", { method: "POST", body: { wallet }, ...opts });
}

/** Helper: redeem the code from a scanned QR. → { seller: { wallet, name } } */
export function joinBooth(token, opts = {}) {
  return staffCall("booth-staff-join", { method: "POST", body: { token }, ...opts });
}

/** Helper: booths this account helps at. → { booths: [{ wallet, name }] } */
export function listBoothsIHelp(opts = {}) {
  return staffCall("booth-staff-context", opts);
}

/** Helper: a seller's booth lines (display fields + stock only). Throws on failure, for react-query. */
export async function fetchHelperInventory(sellerWallet, opts = {}) {
  const r = await staffCall("booth-staff-inventory", {
    query: `&seller=${encodeURIComponent(String(sellerWallet).toLowerCase())}`,
    ...opts,
  });
  if (!r.success) throw new Error(r.error || "Could not load inventory.");
  return r.rows || [];
}
