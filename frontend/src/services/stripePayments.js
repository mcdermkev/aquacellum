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
}) {
  return _createCheckout({
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
  });
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
}) {
  return _createCheckout({
    purchaseType: "shipping",
    buyerWallet,
    sellerWallet,
    // Buyer destination — stamped into order metadata for the seller's label buy.
    ...(shipTo ? { shipTo } : {}),
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
  });
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
}) {
  return _createCheckout({
    purchaseType: "batch",
    buyerWallet,
    sellerWallet,
    items: [{
      listingId,
      commonName,
      pricePerFishCents,
      quantity,
      imageUrl,
    }],
  });
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
export async function purchaseMultiple({ items, buyerWallet, sellerWallet }) {
  return _createCheckout({
    purchaseType: "multi",
    buyerWallet,
    sellerWallet,
    items,
  });
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
}) {
  return _createCheckout({
    purchaseType: "pickup",
    buyerWallet,
    sellerWallet,
    items: [{ tokenId, commonName, scientificName, priceCentsUSD, imageUrl }],
  });
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
 * Core checkout creator. Calls the backend, gets a Stripe Checkout URL,
 * and optionally redirects the user or returns the URL.
 *
 * @param {Object} payload - The request body for /api/stripe?action=create-checkout
 * @param {boolean} [autoRedirect=true] - If true, redirects the browser to Stripe
 * @returns {Promise<Object>} Response from the checkout endpoint
 */
async function _createCheckout(payload, autoRedirect = true) {
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
    await _recordPendingPurchase(payload, data.sessionId);

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
async function _recordPendingPurchase(payload, sessionId) {
  try {
    const order = {
      orderType: "fiat_pending",
      stripeSessionId: sessionId,
      purchaseType: payload.purchaseType,
      buyer: payload.buyerWallet,
      seller: payload.sellerWallet,
      items: JSON.stringify(payload.items),
      status: "pending", // pending → settled | failed
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
