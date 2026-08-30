/**
 * shipping.js
 *
 * Client-side service for ShipEngine-backed live shipping on Aquacellum.
 * Buyer-paid model: rates are quoted at checkout from the seller's private
 * origin to the buyer's destination; the seller later buys the label in-app and
 * the tracking number auto-populates the dispatch.
 *
 * Talks to the consolidated commerce function:
 *   /api/stripe?action=ship-from      seller origin address CRUD (auth)
 *   /api/stripe?action=ship-validate  address validation
 *   /api/stripe?action=ship-rates     live expedited rates seller→buyer (public)
 *   /api/stripe?action=ship-label     seller buys label → tracking auto-fills (auth)
 */

const API_BASE = import.meta.env.VITE_API_BASE || "/api";

// Reuse the same session-token bridge shape as stripePayments.js so the seller
// origin + label actions can authorize from the logged-in Privy session.
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
    console.warn("[Shipping] Could not resolve session token:", err.message);
    return null;
  }
}

async function postJson(action, body, { auth = false } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (auth) {
    const token = await getSessionToken();
    if (token) headers["Authorization"] = `Bearer ${token}`;
  }
  const res = await fetch(`${API_BASE}/stripe?action=${action}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return { success: false, error: data.error || `Request failed (${res.status})`, code: data.code, ...data };
  }
  return { success: true, ...data };
}

// ─── Buyer: live rate quote at checkout ─────────────────────────────────────

/**
 * Get live expedited shipping rates from a seller's origin to a buyer's address.
 * Never exposes the seller's precise origin — only rates + coarse advice.
 *
 * @param {Object} params
 * @param {string} params.sellerWallet
 * @param {Object} params.shipTo - { name?, addressLine1, addressLine2?, city, state, postalCode, countryCode?, residential? }
 * @param {number} [params.parcelPresetId]
 * @returns {Promise<{success, rates?, advice?, code?, error?}>}
 *   rate = { rateId, carrierFriendlyName, serviceCode, amountCents, deliveryDays, estimatedDeliveryDate }
 */
export async function getShippingRates({ sellerWallet, shipTo, parcelPresetId }) {
  return postJson("ship-rates", { sellerWallet, shipTo, parcelPresetId });
}

/** Validate an address via ShipEngine → { success, status, normalized, messages }. */
export async function validateShippingAddress(address) {
  return postJson("ship-validate", { address });
}

/**
 * Platform shipping P&L (admin/curator only). Returns all-time totals + recent
 * monthly rollups: shipping collected, postage paid, and realized margin.
 * @returns {Promise<{success, totals?, monthly?, error?}>}
 */
export async function getShippingMargin() {
  const headers = {};
  const token = await getSessionToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`${API_BASE}/stripe?action=ship-margin`, { method: "GET", headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { success: false, error: data.error || `Request failed (${res.status})` };
  return { success: true, ...data };
}

// ─── Seller: private origin address ─────────────────────────────────────────

/**
 * Fetch the seller's stored ship-from origin. Requires the seller's session.
 * @returns {Promise<{configured:boolean, shipFrom?:Object}>}
 */
export async function getSellerShipFrom(_walletAddress) {
  const headers = {};
  const token = await getSessionToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(
    `${API_BASE}/stripe?action=ship-from`,
    { method: "GET", headers }
  );
  if (!res.ok) return { configured: false };
  return res.json();
}

/**
 * Save/replace the seller's private origin address. Validated by ShipEngine.
 * @param {Object} shipFrom - { walletAddress, name, phone?, companyName?, addressLine1, addressLine2?, city, state, postalCode, countryCode?, residential? }
 */
export async function saveSellerShipFrom(shipFrom) {
  return postJson("ship-from", shipFrom, { auth: true });
}

// ─── Seller: buy label (auto-dispatch) ──────────────────────────────────────

/**
 * Buy a shipping label in-app for a dispatched order. On success the tracking
 * number is recorded on-chain (dispatchShipping) and on the order row — the
 * seller never types a tracking number.
 *
 * @param {Object} params
 * @param {string} params.sellerWallet
 * @param {number} params.tokenId
 * @param {string} params.serviceCode - the service the buyer paid for at checkout
 * @param {string} [params.carrierId]
 * @param {Object} [params.shipTo] - buyer destination (falls back to the order row)
 * @param {string} [params.orderId] | {string} [params.paymentIntentId]
 * @param {number} [params.parcelPresetId]
 * @param {string} [params.shipDate] - ISO date (YYYY-MM-DD)
 * @returns {Promise<{success, trackingNumber?, carrier?, labelUrl?, labelCostCents?, estimatedDeliveryDate?, onChain?, error?}>}
 */
export async function buyShippingLabel(params) {
  return postJson("ship-label", params, { auth: true });
}

// ─── Public: seller's parcel preset (box capacity, Task 11 UI) ─────────────

/**
 * Fetch a seller's default (or specified) parcel preset row. Public — box
 * dimensions/capacity aren't sensitive, unlike the ship-from address. Feeds
 * `packingEngine.normalizeParcelPreset` for the cart's box-capacity meter and
 * add-on recommendations. Never blocks the UI: callers should treat a
 * failure the same as "use PACKING_DEFAULTS" (normalizeParcelPreset already
 * does this for a null/missing row).
 *
 * @param {string} sellerWallet
 * @param {number} [presetId]
 * @returns {Promise<{success:boolean, preset?:Object, error?:string}>}
 */
export async function getSellerParcelPreset(sellerWallet, presetId) {
  try {
    const params = new URLSearchParams({ sellerWallet });
    if (presetId != null) params.set("presetId", String(presetId));
    const res = await fetch(`${API_BASE}/stripe?action=parcel-preset&${params.toString()}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { success: false, error: data.error || `Request failed (${res.status})` };
    return { success: true, preset: data.preset };
  } catch (err) {
    console.warn("[Shipping] getSellerParcelPreset failed:", err.message);
    return { success: false, error: err.message };
  }
}

// ─── Utilities ──────────────────────────────────────────────────────────────

export function formatUSD(cents) {
  return `$${(Number(cents) / 100).toFixed(2)}`;
}

/** Friendly one-liner for a rate row in the selector UI. */
export function describeRate(rate) {
  const eta = rate.deliveryDays ? `${rate.deliveryDays}-day` : "expedited";
  return `${rate.carrierFriendlyName} · ${eta} · ${formatUSD(rate.amountCents)}`;
}
