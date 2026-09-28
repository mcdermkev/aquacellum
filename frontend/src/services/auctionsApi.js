/**
 * auctionsApi.js — client for public auctions (docs/AUCTIONS_SPEC.md).
 *
 * Reads are public (no sign-in). Writes and "my auctions" send the Privy session
 * token as a bearer; the server derives the wallet from it, never from the body.
 * Same setSessionTokenGetter bridge as boothApi.js, registered in AuthContext.
 */

const API_BASE = "/api";

let _sessionTokenGetter = null;

/** Register the session-token getter (e.g. Privy getAccessToken). Pass null to clear. */
export function setSessionTokenGetter(getter) {
  _sessionTokenGetter = typeof getter === "function" ? getter : null;
}

async function getSessionToken() {
  if (!_sessionTokenGetter) return null;
  try {
    return (await _sessionTokenGetter()) || null;
  } catch {
    return null;
  }
}

async function call(path, { method = "GET", body, auth = "optional", fetchImpl = fetch } = {}) {
  const token = auth === "none" ? null : await getSessionToken();
  if (auth === "required" && !token) return { success: false, code: "NO_SESSION", error: "Sign in to continue." };
  let res;
  try {
    res = await fetchImpl(`${API_BASE}/${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  } catch (err) {
    return { success: false, offline: true, error: err?.message || "You're offline." };
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return { success: false, status: res.status, code: data.code || null, error: data.error || `Request failed (${res.status})` };
  }
  return { success: true, ...data };
}

// ─── Public reads ──────────────────────────────────────────────────────────

/** → { lots, serverTime } */
export function listLots({ status = "live", sort = "ending", q = "", club = "", limit = 30 } = {}, opts = {}) {
  const params = new URLSearchParams({ action: "auctions", status, sort, limit: String(limit) });
  if (q) params.set("q", q);
  if (club) params.set("club", club);
  return call(`storefront-detail?${params.toString()}`, { auth: "none", ...opts });
}

/** → { lot, bids, viewer (signed in only), serverTime } */
export function getLot(lotId, opts = {}) {
  return call(`storefront-detail?action=auction-lot&id=${encodeURIComponent(lotId)}`, opts);
}

// ─── Signed-in actions ─────────────────────────────────────────────────────

export function placeBid(lotId, amountCents, opts = {}) {
  return call("storefront-detail?action=auction-bid", { method: "POST", body: { lotId, amountCents }, auth: "required", ...opts });
}

export function createLot(lot, opts = {}) {
  return call("storefront-detail?action=auction-create-lot", { method: "POST", body: lot, auth: "required", ...opts });
}

export function cancelLot(lotId, opts = {}) {
  return call("storefront-detail?action=auction-cancel-lot", { method: "POST", body: { lotId }, auth: "required", ...opts });
}

/** → { selling, bidding } */
export function myAuctions(opts = {}) {
  return call("storefront-detail?action=my-auctions", { auth: "required", ...opts });
}

/** → { hasCard, brand, last4 } */
export function getSavedCard(opts = {}) {
  return call("stripe?action=auction-payment-method", { auth: "required", ...opts });
}

/**
 * Save a card on Stripe's hosted page. → { checkoutUrl } to redirect to, or
 * { alreadySaved: true } when one is on file. Stripe returns to `returnPath`
 * with ?card_saved=1 (or 0).
 */
export function startAddCard(returnPath, opts = {}) {
  return call("stripe?action=auction-payment-method", { method: "POST", body: { returnUrl: returnPath }, auth: "required", ...opts });
}

/** The winner retries a declined payment. */
export function payNow(lotId, opts = {}) {
  return call("stripe?action=auction-pay", { method: "POST", body: { lotId }, auth: "required", ...opts });
}

// ─── Pure helpers (shared by the pages) ────────────────────────────────────

export function lotPath(lotId) {
  return `/app/auctions/${encodeURIComponent(String(lotId || ""))}`;
}

/** "2d 4h", "3h 12m", "4m 05s", "Ended" */
export function formatTimeLeft(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return "Ended";
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${String(sec).padStart(2, "0")}s`;
}

/** Dollars typed by a person → whole cents, or null. "12", "12.5", "$12.50" all work. */
export function dollarsToCents(input) {
  const s = String(input ?? "").trim().replace(/^\$/, "").replace(/,/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const cents = Math.round(Number(s) * 100);
  return Number.isSafeInteger(cents) ? cents : null;
}

export function centsToDollars(cents) {
  return `$${(Number(cents || 0) / 100).toFixed(2)}`;
}

/** Offset between the server clock and this device, so every countdown agrees. */
export function clockOffsetMs(serverTime, now = Date.now()) {
  const t = Date.parse(serverTime || "");
  return Number.isFinite(t) ? t - now : 0;
}
