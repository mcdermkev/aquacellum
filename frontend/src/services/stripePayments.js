/**
 * stripePayments.js
 *
 * Client-side service for Stripe-based fiat payments on Aquadex.
 * Provides a clean API for:
 *   - Initiating checkout (buyer pays with card / Apple Pay / Google Pay)
 *   - Managing seller Stripe Connect onboarding
 *   - Checking payment and seller account status
 *
 * This service talks to the Vercel serverless API endpoints:
 *   /api/stripe?action=create-checkout  → creates a Stripe Checkout session
 *   /api/stripe?action=connect-onboard  → seller onboarding & status
 *
 * After payment, the webhook (/api/stripe?action=webhook) handles on-chain
 * settlement automatically — the frontend just needs to poll or listen for confirmation.
 */

import { db } from "../db";
import { signPersonalMessage } from "./smartAccountClient";

// ─── Configuration ─────────────────────────────────────────────────────────
const API_BASE = import.meta.env.VITE_API_BASE || "/api";

// ─── Session token (web2-masked auth) ───────────────────────────────────────
// The Privy access-token getter, registered once by AuthContext (mirroring how
// smartAccountClient registers the signer). Sending this token as a Bearer lets
// the backend authorize checkout + release from the logged-in session — no
// wallet-signature popup. Falls back to null for logged-out / self-custody
// flows, where releaseFiatOrder signs with the wallet instead.
let _sessionTokenGetter = null;

/**
 * Register the session-token getter (e.g. Privy's getAccessToken). Pass null to
 * clear on logout.
 */
export function setSessionTokenGetter(getter) {
  _sessionTokenGetter = typeof getter === "function" ? getter : null;
}

/**
 * Resolve the current session token, or null if unavailable. Never throws.
 */
async function getSessionToken() {
  if (!_sessionTokenGetter) return null;
  try {
    return (await _sessionTokenGetter()) || null;
  } catch (err) {
    console.warn("[StripePayments] Could not resolve session token:", err.message);
    return null;
  }
}

/**
 * Canonical release-authorization message. MUST match the server builder in
 * frontend/api/stripe.js byte-for-byte, or the recovered signer won't match and
 * the release will be rejected.
 */
function buildReleaseAuthMessage({ tokenId, paymentRef, issuedAt }) {
  return [
    "Aquacellum: authorize order release",
    `token:${tokenId ?? ""}`,
    `ref:${paymentRef}`,
    `issued:${issuedAt}`,
  ].join("\n");
}

/**
 * Canonical cash-pickup confirmation message the SELLER signs to prove control
 * of the listing's seller wallet. MUST match the server builder in
 * frontend/api/stripe.js byte-for-byte, or the recovered signer won't match and
 * the handoff is rejected. Bound to the challenge nonce so it can't be reused.
 */
function buildCashConfirmMessage({ nonce, issuedAt }) {
  return [
    "Aquacellum: confirm cash pickup handoff",
    `nonce:${nonce}`,
    `issued:${issuedAt}`,
  ].join("\n");
}

/**
 * Extract the challenge nonce from a scanned handoff token, WITHOUT verifying
 * (the server does the authoritative verification). Returns null if unreadable.
 * The seller needs the nonce to sign the confirmation over the code they just
 * scanned from the buyer.
 */
function parseHandoffNonce(token) {
  try {
    let b64 = String(token).split(".")[0].replace(/-/g, "+").replace(/_/g, "/");
    while (b64.length % 4) b64 += "=";
    const json = decodeURIComponent(escape(atob(b64)));
    return JSON.parse(json).nonce || null;
  } catch {
    return null;
  }
}

// ─── Buyer: Purchase Flow ──────────────────────────────────────────────────

/**
 * Initiate a single specimen purchase via Stripe Checkout.
 * Opens the Stripe-hosted payment page in the current window.
 *
 * @param {Object} params
 * @param {number} params.tokenId - The specimen token ID
 * @param {string} params.commonName - Display name of the fish
 * @param {string} [params.scientificName] - Scientific name
 * @param {number} params.priceCentsUSD - Price in USD cents (e.g., 4999 = $49.99)
 * @param {string} [params.imageUrl] - Product image URL
 * @param {string} params.buyerWallet - Buyer's on-chain wallet address
 * @param {string} params.sellerWallet - Seller's on-chain wallet address
 * @returns {Promise<{success: boolean, checkoutUrl?: string, error?: string}>}
 */
export async function purchaseSpecimen({
  tokenId,
  commonName,
  scientificName,
  priceCentsUSD,
  imageUrl,
  buyerWallet,
  sellerWallet,
  /** Local-only. See `purchaseBatch` for why this is captured at checkout. */
  pedigreeDocument = null,
  pedigreeHash = null,
  pedigreeChain = [],
}) {
  return _createCheckout(
    {
      purchaseType: "specimen",
      buyerWallet,
      sellerWallet,
      items: [{
        tokenId,
        commonName,
        scientificName,
        priceCentsUSD,
        imageUrl,
      }],
    },
    true,
    _localPedigree({ tokenId, pedigreeDocument, pedigreeHash, pedigreeChain })
  );
}

/**
 * Shape the local-only pedigree stash for a single-specimen checkout.
 *
 * `tokenId` is recorded as `listingId` too, because that is the id
 * `lotIntake.resolvePurchasePedigree` matches a sibling row on — an individual
 * listing's `id` and `tokenId` are the same number, and keeping one field name for
 * the match means the resolver needs one lookup rule rather than one per purchase type.
 */
function _localPedigree({ tokenId, pedigreeDocument, pedigreeHash, pedigreeChain }) {
  if (!pedigreeDocument && !pedigreeHash) return null;
  return {
    listingId: Number(tokenId),
    tokenId: Number(tokenId),
    pedigreeDocument: pedigreeDocument || null,
    pedigreeHash: pedigreeHash || pedigreeDocument?.hash || null,
    // The generations above, so the buyer can verify the chain rather than just read
    // the root, and republish it if they sell the fish on (§9.31).
    pedigreeChain: Array.isArray(pedigreeChain) ? pedigreeChain : [],
  };
}

/**
 * Initiate a shipping-enabled specimen purchase via Stripe Checkout.
 *
 * @param {Object} params
 * @param {number} params.tokenId - The specimen token ID
 * @param {string} params.commonName - Display name
 * @param {string} [params.scientificName] - Scientific name
 * @param {number} params.priceCentsUSD - Specimen price in cents
 * @param {number} params.shippingFeeCents - Shipping fee in cents
 * @param {string} [params.imageUrl] - Product image URL
 * @param {string} params.buyerWallet - Buyer's wallet
 * @param {string} params.sellerWallet - Seller's wallet
 * @returns {Promise<{success: boolean, checkoutUrl?: string, error?: string}>}
 */
export async function purchaseShippingSpecimen({
  tokenId,
  commonName,
  scientificName,
  priceCentsUSD,
  shippingFeeCents,
  imageUrl,
  buyerWallet,
  sellerWallet,
  // Buyer-paid live-rate selection (from the ShipEngine quote at checkout).
  shipServiceCode,
  shipCarrierId,
  shipTo,
  promoCode,
  /** Local-only. See `purchaseBatch`. */
  pedigreeDocument = null,
  pedigreeHash = null,
  pedigreeChain = [],
}) {
  return _createCheckout(
    {
      purchaseType: "shipping",
      buyerWallet,
      sellerWallet,
      // Buyer destination — stamped into order metadata for the seller's label buy.
      ...(shipTo ? { shipTo } : {}),
      // Optional promotion code — the server re-validates + applies it (Task 21B).
      ...(promoCode ? { promoCode } : {}),
      items: [{
        tokenId,
        commonName,
        scientificName,
        priceCentsUSD,
        shippingFeeCents,
        imageUrl,
        // The service the buyer picked, so the seller re-rates the same one.
        ...(shipServiceCode ? { shipServiceCode } : {}),
        ...(shipCarrierId ? { shipCarrierId } : {}),
      }],
    },
    true,
    _localPedigree({ tokenId, pedigreeDocument, pedigreeHash, pedigreeChain })
  );
}

/**
 * Initiate a batch (juvenile) purchase via Stripe Checkout.
 *
 * @param {Object} params
 * @param {number} params.listingId - The batch listing ID
 * @param {string} params.commonName - Species display name
 * @param {number} params.pricePerFishCents - Price per fish in cents
 * @param {number} params.quantity - Number of juveniles to buy
 * @param {string} [params.imageUrl] - Product image URL
 * @param {string} params.buyerWallet - Buyer's wallet
 * @param {string} params.sellerWallet - Seller's wallet
 * @returns {Promise<{success: boolean, checkoutUrl?: string, error?: string}>}
 */
export async function purchaseBatch({
  listingId,
  commonName,
  pricePerFishCents,
  quantity,
  imageUrl,
  buyerWallet,
  sellerWallet,
  promoCode,
  /**
   * The pedigree the seller sealed at listing time, plus the life stage
   * (services/listingPedigree.js, BREEDER_STATE_MODEL §9.25, T3 §2.6).
   *
   * ⚠️ LOCAL ONLY. These are NOT sent to Stripe or to the checkout endpoint — a
   * payment request has no business carrying a provenance document, and the server
   * does nothing with it. They are stashed on the local pending-purchase row so the
   * document is still on this device days later when the fry actually arrive, which
   * is when `lotIntake.receivePurchasedLot` needs it.
   *
   * Why it has to be captured HERE: the buyer receives the document by browsing
   * (`aquadex_listings.data`), but `useMarketplaceListings` clears and refills
   * `db.listings` from on-chain data, which carries none, and the seller's
   * `localListings` row does not exist on this device. Checkout is the last moment
   * the buyer holds it.
   */
  pedigreeDocument = null,
  pedigreeHash = null,
  pedigreeChain = [],
  lifeStage = null,
}) {
  return _createCheckout(
    {
      purchaseType: "batch",
      buyerWallet,
      sellerWallet,
      ...(promoCode ? { promoCode } : {}),
      items: [{
        listingId,
        commonName,
        pricePerFishCents,
        quantity,
        imageUrl,
      }],
    },
    true,
    {
      listingId: Number(listingId),
      quantity: Number(quantity) || 0,
      pedigreeDocument: pedigreeDocument || null,
      pedigreeHash: pedigreeHash || pedigreeDocument?.hash || null,
      // The generations above the lot document (§9.31).
      pedigreeChain: Array.isArray(pedigreeChain) ? pedigreeChain : [],
      lifeStage: lifeStage || null,
    }
  );
}

/**
 * Initiate a multi-specimen cart checkout via Stripe Checkout.
 *
 * @param {Object} params
 * @param {Array} params.items - Array of { tokenId, commonName, priceCentsUSD, imageUrl?, shippingFeeCents? }
 * @param {string} params.buyerWallet - Buyer's wallet
 * @param {string} params.sellerWallet - Seller's wallet (all items must be same seller)
 * @returns {Promise<{success: boolean, checkoutUrl?: string, error?: string}>}
 */
export async function purchaseMultiple({
  items,
  buyerWallet,
  sellerWallet,
  promoCode,
  pedigreeDocuments = null,
  pedigreeChains = null,
}) {
  return _createCheckout(
    {
      purchaseType: "multi",
      buyerWallet,
      sellerWallet,
      ...(promoCode ? { promoCode } : {}),
      items,
    },
    true,
    // A cart of several specimens needs one document PER token, so this row carries a
    // map rather than a single field. `resolvePurchasePedigree` reads both shapes; a
    // flat field would silently give every fish in the cart the first one's pedigree,
    // which is a fabrication rather than a missing value. `pedigreeChains` is the same
    // map shape for the ancestor documents (§9.31).
    pedigreeDocuments && Object.keys(pedigreeDocuments).length > 0
      ? { pedigreeDocuments, ...(pedigreeChains ? { pedigreeChains } : {}) }
      : null
  );
}

/**
 * Initiate a LOCAL PICKUP (in-person) specimen purchase via Stripe Checkout.
 * Funds are held in escrow until the in-person handshake at handoff.
 */
export async function purchasePickupSpecimen({
  tokenId,
  commonName,
  scientificName,
  priceCentsUSD,
  imageUrl,
  buyerWallet,
  sellerWallet,
  promoCode,
  /** Local-only. See `purchaseBatch`. */
  pedigreeDocument = null,
  pedigreeHash = null,
  pedigreeChain = [],
}) {
  return _createCheckout(
    {
      purchaseType: "pickup",
      buyerWallet,
      sellerWallet,
      ...(promoCode ? { promoCode } : {}),
      items: [{ tokenId, commonName, scientificName, priceCentsUSD, imageUrl }],
    },
    true,
    _localPedigree({ tokenId, pedigreeDocument, pedigreeHash, pedigreeChain })
  );
}

/**
 * Read-only promo-code preview for the buyer's checkout UI. Asks the server to
 * resolve + evaluate a seller's promotion against the current cart WITHOUT
 * creating a checkout — so the buyer sees "code applied − $X" or an "invalid
 * code" message before paying. The authoritative discount is still applied
 * server-side at create-checkout; this is display-only.
 *
 * @param {Object} params
 * @param {string} params.sellerWallet
 * @param {string} [params.promoCode]
 * @param {string} [params.promotionId]
 * @param {Array} params.items - the cart items (tokenId/listingId + price fields)
 * @param {string} params.purchaseType - "batch" switches the cart shape; else single/multi
 * @returns {Promise<{applicable:boolean, discountCents:number, reason?:string, promotion?:Object|null}>}
 */
export async function previewPromotion({ sellerWallet, promoCode, promotionId, items, purchaseType }) {
  try {
    if (!sellerWallet || (!promoCode && !promotionId)) {
      return { applicable: false, discountCents: 0, reason: "Enter a code to check." };
    }
    const response = await fetch(`${API_BASE}/stripe?action=preview-promo`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sellerWallet, promoCode, promotionId, items, purchaseType }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      return { applicable: false, discountCents: 0, reason: data.error || "Could not check that code." };
    }
    return data;
  } catch (err) {
    console.error("[StripePayments] previewPromotion failed:", err);
    return { applicable: false, discountCents: 0, reason: "Network error checking the code." };
  }
}

/**
 * Finalize a HELD order at handoff (shipping arrival OR pickup handshake).
 * Calls the backend release action, which transfers the held funds to the
 * seller and settles the NFT on-chain. Pass the order's Stripe session id (or
 * paymentIntentId); tokenId is optional context.
 *
 * Authorization is popup-free for logged-in (Privy) buyers: the session token is
 * sent as a Bearer and the server matches it to the buyer identity captured at
 * checkout. Only self-custody / logged-out flows fall back to a wallet signature.
 *
 * @returns {Promise<{success: boolean, txHash?: string, transferId?: string, error?: string}>}
 */
export async function releaseFiatOrder({ tokenId, sessionId, paymentIntentId } = {}) {
  try {
    const paymentRef = sessionId || paymentIntentId;
    if (!paymentRef) {
      return { success: false, error: "Missing order reference (sessionId or paymentIntentId)" };
    }

    const headers = { "Content-Type": "application/json" };
    const body = { tokenId, sessionId, paymentIntentId };

    // Primary path (web2-masked, no popup): authorize with the logged-in Privy
    // session token. The backend verifies it and matches the buyer identity
    // captured at checkout — nothing to sign, no crypto prompt.
    const token = await getSessionToken();
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    } else {
      // Fallback for self-custody (MetaMask) users with no Privy session: sign
      // the canonical release authorization with the wallet.
      const issuedAt = Date.now();
      let signature;
      try {
        signature = await signPersonalMessage(
          buildReleaseAuthMessage({ tokenId, paymentRef, issuedAt })
        );
      } catch (err) {
        return {
          success: false,
          error: err.message || "Could not authorize the release",
        };
      }
      body.signature = signature;
      body.issuedAt = issuedAt;
      body.paymentRef = paymentRef;
    }

    const response = await fetch(`${API_BASE}/stripe?action=release`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    const data = await response.json();
    if (!response.ok) {
      return { success: false, error: data.error || "Release failed" };
    }
    return { success: data.success !== false, ...data };
  } catch (err) {
    console.error("[StripePayments] Release failed:", err);
    return { success: false, error: err.message || "Network error releasing order" };
  }
}

/**
 * Report a problem with a HELD order — the "arrived dead or sick" (DOA) path.
 * Opens a dispute so a curator can resolve it; this does NOT move money and does
 * NOT release the order to the seller. Authorized from the logged-in buyer's
 * Privy session (no wallet popup); the server confirms the caller is the buyer.
 *
 * @param {Object} params
 * @param {number} [params.tokenId] - Specimen token id (shipping/pickup context)
 * @param {string} [params.sessionId] - Stripe Checkout session id
 * @param {string} [params.paymentIntentId] - Stripe PaymentIntent id
 * @param {string} [params.reason] - Short reason code (e.g. "dead_on_arrival")
 * @param {string} [params.note] - Optional free-text detail from the buyer
 * @returns {Promise<{success: boolean, action?: string, error?: string}>}
 */
export async function disputeFiatOrder({ tokenId, sessionId, paymentIntentId, reason, note } = {}) {
  try {
    if (!sessionId && !paymentIntentId) {
      return { success: false, error: "Missing order reference (sessionId or paymentIntentId)" };
    }

    const token = await getSessionToken();
    if (!token) {
      // Reporting a problem requires the logged-in buyer's session so the server
      // can confirm ownership of the order.
      return { success: false, error: "Please sign in again to report a problem with this order." };
    }

    const response = await fetch(`${API_BASE}/stripe?action=dispute`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ tokenId, sessionId, paymentIntentId, reason, note }),
    });
    const data = await response.json();
    if (!response.ok) {
      return { success: false, error: data.error || "Could not report the problem" };
    }
    return { success: data.success !== false, ...data };
  } catch (err) {
    console.error("[StripePayments] Dispute failed:", err);
    return { success: false, error: err.message || "Network error reporting the problem" };
  }
}

/**
 * Open a dead-on-arrival (DOA) claim on a delivered order via the canonical
 * claim workflow (Task 17/18). This is the flagged, additive counterpart to
 * `disputeFiatOrder` — it calls `POST /api/stripe?action=doa-open`, which only
 * succeeds once a canonical order exists for this payment AND has reached a
 * claim-eligible state (delivered / review_window / non_delivery). That
 * precondition depends on the Task 16 delivery-event plumbing (advancing
 * canonical orders to `delivered`), which is not wired yet as of this task —
 * so today this will typically fail with "order not found" or a state error,
 * and callers MUST fall back to `disputeFiatOrder` (see ArrivalModal). Once
 * Task 16 lands, this becomes the primary buyer-facing claim path with no
 * caller changes needed here.
 *
 * Authorization mirrors `releaseFiatOrder`/`disputeFiatOrder`: sends the
 * logged-in Privy session token as a Bearer. The server confirms the caller
 * is the order's buyer.
 *
 * @param {Object} params
 * @param {string} [params.orderId] - canonical order id, if already known
 * @param {string} [params.paymentIntentId] - Stripe PaymentIntent id
 * @param {string} [params.sessionId] - Stripe Checkout Session id
 * @param {string[]} params.affectedLineItemIds - canonical line item ids being claimed
 * @param {{ photos?: string[], description?: string }} params.evidence
 * @param {string} [params.claimId]
 * @returns {Promise<{success: boolean, claim?: Object, error?: string}>}
 */
export async function openDoaClaim({ orderId, paymentIntentId, sessionId, affectedLineItemIds, evidence, claimId } = {}) {
  try {
    if (!orderId && !paymentIntentId && !sessionId) {
      return { success: false, error: "Missing order reference (orderId, sessionId, or paymentIntentId)" };
    }
    if (!Array.isArray(affectedLineItemIds) || affectedLineItemIds.length === 0) {
      return { success: false, error: "No affected items specified" };
    }

    const token = await getSessionToken();
    if (!token) {
      return { success: false, error: "Please sign in again to report a problem with this order." };
    }

    const response = await fetch(`${API_BASE}/stripe?action=doa-open`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ orderId, paymentIntentId, sessionId, affectedLineItemIds, evidence, claimId }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      return { success: false, error: data.error || `Could not open claim (${response.status})` };
    }
    return { success: data.success !== false, claim: data.claim };
  } catch (err) {
    console.error("[StripePayments] openDoaClaim failed:", err);
    return { success: false, error: err.message || "Network error opening claim" };
  }
}

// ─── Cash pickup handoff (in-person, no money movement) ─────────────────────

/**
 * BUYER: request a one-time cash-pickup handoff code for an active specimen
 * listing. Renders as a QR the buyer presents to the seller in person. The
 * server binds the code to the listing's on-chain seller and the buyer's
 * account address, signs it, and short-expires it. Authorized from the buyer's
 * Privy session.
 *
 * @param {Object} params
 * @param {number|string} params.tokenId - specimen token id being picked up
 * @param {string} params.buyerWallet - the buyer's account address (NFT recipient)
 * @returns {Promise<{success:boolean, token?:string, expiresAt?:number, seller?:string, error?:string}>}
 */
export async function issueCashHandoff({ tokenId, buyerWallet } = {}) {
  try {
    if (tokenId == null) return { success: false, error: "Missing item reference" };
    if (!buyerWallet) return { success: false, error: "Missing your account address" };

    const sessionToken = await getSessionToken();
    if (!sessionToken) {
      return { success: false, error: "Please sign in again to get your pickup code." };
    }

    const response = await fetch(`${API_BASE}/stripe?action=handoff-issue`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${sessionToken}`,
      },
      body: JSON.stringify({ tokenId, buyerWallet }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      return { success: false, error: data.error || `Could not create pickup code (${response.status})` };
    }
    return { success: true, token: data.token, expiresAt: data.expiresAt, seller: data.seller };
  } catch (err) {
    console.error("[StripePayments] issueCashHandoff failed:", err);
    return { success: false, error: err.message || "Network error creating pickup code" };
  }
}

/**
 * SELLER: confirm an in-person cash pickup by submitting the buyer's scanned
 * handoff code. Signs the challenge nonce with the seller wallet (proving
 * control of the listing's seller address), then the relayer transfers the
 * specimen to the buyer. No money moves. Authorized from the seller's Privy
 * session plus the wallet signature.
 *
 * @param {Object} params
 * @param {string} params.token - the scanned handoff code (challenge token)
 * @returns {Promise<{success:boolean, txHash?:string, tokenId?:number, error?:string}>}
 */
export async function confirmCashPickup({ token } = {}) {
  try {
    if (!token) return { success: false, error: "Missing handoff code" };

    const sessionToken = await getSessionToken();
    if (!sessionToken) {
      return { success: false, error: "Please sign in again to confirm this handoff." };
    }

    const nonce = parseHandoffNonce(token);
    if (!nonce) return { success: false, error: "Unreadable handoff code" };

    const issuedAt = Date.now();
    let signature;
    try {
      signature = await signPersonalMessage(buildCashConfirmMessage({ nonce, issuedAt }));
    } catch (err) {
      return { success: false, error: err.message || "Could not confirm the handoff" };
    }

    const response = await fetch(`${API_BASE}/stripe?action=cash-confirm`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${sessionToken}`,
      },
      body: JSON.stringify({ token, signature, issuedAt }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      return { success: false, error: data.error || `Handoff failed (${response.status})` };
    }
    return { success: data.success !== false, ...data };
  } catch (err) {
    console.error("[StripePayments] confirmCashPickup failed:", err);
    return { success: false, error: err.message || "Network error confirming handoff" };
  }
}

/**
 * Core checkout creator. Calls the backend, gets a Stripe Checkout URL,
 * and optionally redirects the user or returns the URL.
 *
 * @param {Object} payload - The request body for /api/stripe?action=create-checkout
 * @param {boolean} [autoRedirect=true] - If true, redirects the browser to Stripe
 * @param {Object|null} [localOnly=null] - fields recorded on the LOCAL pending row and
 *   deliberately never sent to the server. See `purchaseBatch`.
 * @returns {Promise<Object>} Response from the checkout endpoint
 */
async function _createCheckout(payload, autoRedirect = true, localOnly = null) {
  try {
    // Attach the logged-in session token so the backend can stamp the buyer's
    // verified identity onto the order — this is what enables popup-free release
    // later. Omitted for guests / logged-out buyers (they sign at release).
    const token = await getSessionToken();
    const response = await fetch(`${API_BASE}/stripe?action=create-checkout`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json();

    if (!response.ok) {
      return {
        success: false,
        error: data.error || "Failed to create checkout session",
        code: data.code || "CHECKOUT_FAILED",
      };
    }

    // Record pending purchase locally for optimistic UI
    await _recordPendingPurchase(payload, data.sessionId, localOnly);

    // Redirect to Stripe Checkout
    if (autoRedirect && data.checkoutUrl) {
      window.location.href = data.checkoutUrl;
    }

    return {
      success: true,
      checkoutUrl: data.checkoutUrl,
      sessionId: data.sessionId,
      totalAmountCents: data.totalAmountCents,
      platformFeeCents: data.platformFeeCents,
      sellerReceivesCents: data.sellerReceivesCents,
    };
  } catch (err) {
    console.error("[StripePayments] Checkout creation failed:", err);
    return {
      success: false,
      error: err.message || "Network error creating checkout",
    };
  }
}

/**
 * Record a pending purchase locally so the UI can show "Payment Processing..."
 * until the webhook confirms settlement.
 */
async function _recordPendingPurchase(payload, sessionId, localOnly = null) {
  try {
    const order = {
      orderType: "fiat_pending",
      stripeSessionId: sessionId,
      purchaseType: payload.purchaseType,
      buyer: payload.buyerWallet,
      seller: payload.sellerWallet,
      items: JSON.stringify(payload.items),
      status: "pending", // pending → settled | failed
      // Local-only extras (never sent to the server). Currently the sealed pedigree
      // a batch purchase must not lose between checkout and arrival — see
      // `purchaseBatch` and `services/lotIntake.js`.
      ...(localOnly || {}),
      createdAt: Math.floor(Date.now() / 1000),
    };
    await db.marketOrders.put(order);
  } catch (err) {
    // Non-critical — local tracking only
    console.warn("[StripePayments] Failed to record pending purchase locally:", err);
  }
}

// ─── Seller: Stripe Connect Onboarding ─────────────────────────────────────

/**
 * Check if a seller has completed Stripe Connect onboarding.
 *
 * @param {string} walletAddress - Seller's on-chain wallet
 * @returns {Promise<{connected: boolean, onboardingComplete: boolean, chargesEnabled?: boolean, payoutsEnabled?: boolean}>}
 */
export async function checkSellerStatus(walletAddress) {
  try {
    const response = await fetch(
      `${API_BASE}/stripe?action=connect-onboard&wallet=${encodeURIComponent(walletAddress)}`,
      { method: "GET" }
    );

    if (!response.ok) {
      return { connected: false, onboardingComplete: false };
    }

    return await response.json();
  } catch (err) {
    console.error("[StripePayments] Seller status check failed:", err);
    return { connected: false, onboardingComplete: false };
  }
}

/**
 * Start or resume seller Stripe Connect onboarding.
 * Returns an onboarding URL that the seller should be redirected to.
 *
 * @param {Object} params
 * @param {string} params.walletAddress - Seller's on-chain wallet
 * @param {string} [params.email] - Seller's email (pre-fills Stripe form)
 * @param {string} [params.displayName] - Seller's display name
 * @returns {Promise<{success: boolean, onboardingUrl?: string, error?: string}>}
 */
export async function startSellerOnboarding({ walletAddress, email, displayName }) {
  try {
    const response = await fetch(`${API_BASE}/stripe?action=connect-onboard`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ walletAddress, email, displayName }),
    });

    const data = await response.json();

    if (!response.ok) {
      return { success: false, error: data.error || "Onboarding failed" };
    }

    return {
      success: true,
      onboardingUrl: data.onboardingUrl,
      stripeAccountId: data.stripeAccountId,
    };
  } catch (err) {
    console.error("[StripePayments] Seller onboarding failed:", err);
    return { success: false, error: err.message || "Network error" };
  }
}

/**
 * Redirect the seller to their Stripe Express Dashboard (for viewing payouts, etc.)
 * This creates a login link to Stripe's hosted dashboard for the connected account.
 *
 * @param {string} walletAddress - Seller's on-chain wallet
 * @returns {Promise<{success: boolean, dashboardUrl?: string, error?: string}>}
 */
export async function getSellerDashboardLink(walletAddress) {
  try {
    // First get their status (which includes the stripeAccountId)
    const status = await checkSellerStatus(walletAddress);
    if (!status.connected || !status.stripeAccountId) {
      return { success: false, error: "Seller not connected to Stripe" };
    }

    // The dashboard link needs to be generated server-side
    // For now, direct sellers to Stripe Express dashboard via onboarding endpoint
    // In production, add a dedicated /api/stripe-dashboard-link endpoint
    return {
      success: true,
      dashboardUrl: `https://connect.stripe.com/express/${status.stripeAccountId}`,
    };
  } catch (err) {
    console.error("[StripePayments] Dashboard link failed:", err);
    return { success: false, error: err.message };
  }
}

// ─── Payment Status & History ──────────────────────────────────────────────

/**
 * Check the settlement status of a Stripe Checkout session.
 * Polls local Dexie for the pending order → checks if webhook has updated it.
 *
 * @param {string} sessionId - The Stripe Checkout Session ID
 * @returns {Promise<{status: string, txHash?: string}>}
 */
export async function checkPaymentStatus(sessionId) {
  try {
    const orders = await db.marketOrders
      .where("stripeSessionId")
      .equals(sessionId)
      .toArray();

    if (orders.length === 0) {
      return { status: "unknown" };
    }

    const order = orders[0];
    return {
      status: order.status, // "pending" | "settled" | "failed"
      txHash: order.txHash || null,
    };
  } catch (err) {
    return { status: "unknown" };
  }
}

/**
 * Get all fiat purchase orders for a given buyer wallet.
 *
 * @param {string} buyerWallet - The buyer's wallet address
 * @returns {Promise<Array>} Array of fiat purchase order records
 */
export async function getFiatPurchaseHistory(buyerWallet) {
  try {
    const orders = await db.marketOrders
      .where("buyer")
      .equals(buyerWallet.toLowerCase())
      .and((order) => order.orderType === "fiat_pending" || order.orderType === "fiat_settled")
      .toArray();

    return orders.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  } catch (err) {
    console.warn("[StripePayments] Failed to load fiat history:", err);
    return [];
  }
}

// ─── Utilities ─────────────────────────────────────────────────────────────

/**
 * Convert a USD dollar amount to cents (for API calls).
 * Handles floating point safely.
 *
 * @param {number} dollars - Amount in dollars (e.g., 49.99)
 * @returns {number} Amount in cents (e.g., 4999)
 */
export function dollarsToCents(dollars) {
  return Math.round(Number(dollars) * 100);
}

/**
 * Convert cents to a formatted USD display string.
 *
 * @param {number} cents - Amount in cents
 * @returns {string} Formatted string (e.g., "$49.99")
 */
export function formatUSD(cents) {
  return `$${(cents / 100).toFixed(2)}`;
}

/**
 * Check if a listing's seller is ready to receive fiat payments.
 * Useful for conditionally showing "Buy with Card" vs "Contact Seller" buttons.
 *
 * @param {string} sellerWallet - The seller's wallet address
 * @returns {Promise<boolean>} True if the seller can receive card payments
 */
export async function isSellerFiatReady(sellerWallet) {
  const status = await checkSellerStatus(sellerWallet);
  return status.connected && status.onboardingComplete;
}
