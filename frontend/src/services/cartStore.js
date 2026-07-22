/**
 * cartStore.js
 *
 * Persistence orchestration for the cart (Task 10, §2). Thin — no cart
 * business logic lives here (that's cartModel.js); this module only knows
 * how to read/write the cart to Dexie (always) and the server (authenticated
 * accounts only, best-effort).
 *
 * Guest (`account == null`): Dexie only.
 * Authenticated: Dexie + `GET/PUT /api/cart`, reconciled — server is the
 * source of truth for a signed-in device on load; a non-empty local guest
 * cart present at first authed load triggers the login-time merge via
 * `POST /api/cart?action=merge` (see mergeAndLoad below).
 *
 * All server calls are best-effort: a failed sync never throws and never
 * clears/blocks the local Dexie cart — the cart must always be usable
 * offline. See docs/TASK_10_CART_SPEC.md §2.
 */

import { db } from "../db.js";
import { emptyCart } from "./cartModel.js";

const API_BASE = import.meta.env.VITE_API_BASE || "/api";
const LOCAL_MERGE_FLAG_KEY = "aquadex_cart_merged_accounts";

// ─── Session token bridge (mirrors shipping.js / stripePayments.js) ────────

let _sessionTokenGetter = null;

/** Register the session-token getter (e.g. Privy's getAccessToken). Pass null to clear. */
export function setSessionTokenGetter(getter) {
  _sessionTokenGetter = typeof getter === "function" ? getter : null;
}

async function getSessionToken() {
  if (!_sessionTokenGetter) return null;
  try {
    return (await _sessionTokenGetter()) || null;
  } catch (err) {
    console.warn("[CartStore] Could not resolve session token:", err.message);
    return null;
  }
}

async function authedFetch(method, body) {
  const token = await getSessionToken();
  if (!token) return { ok: false, error: "not_authenticated" };
  try {
    const res = await fetch(`${API_BASE}/cart`, {
      method,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: body != null ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: data.error || `Request failed (${res.status})` };
    return { ok: true, data };
  } catch (err) {
    console.warn("[CartStore] Server cart request failed:", err.message);
    return { ok: false, error: err.message };
  }
}

async function mergeOnServer(guestCart) {
  const token = await getSessionToken();
  if (!token) return { ok: false, error: "not_authenticated" };
  try {
    const res = await fetch(`${API_BASE}/cart?action=merge`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        items: guestCart.items,
        sellerWallet: guestCart.seller,
        updatedAt: guestCart.updatedAt,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: data.error || `Merge failed (${res.status})` };
    return { ok: true, data };
  } catch (err) {
    console.warn("[CartStore] Server cart merge failed:", err.message);
    return { ok: false, error: err.message };
  }
}

// ─── Dexie ↔ Cart shape mapping ──────────────────────────────────────────────
// The Dexie `cart` table stores one row PER ITEM (per db.js v22: `id, seller,
// listingKey, addedAt`); cartModel.js's Cart shape is `{ seller, items[],
// updatedAt }`. These helpers translate between the two.

async function readDexieCart() {
  const rows = await db.cart.toArray();
  if (rows.length === 0) return emptyCart();
  const seller = rows[0].seller || null;
  const updatedAt = rows.reduce((max, r) => Math.max(max, r.addedAt || 0), 0);
  return { seller, items: rows, updatedAt };
}

async function writeDexieCart(cart) {
  const safe = cart && Array.isArray(cart.items) ? cart : emptyCart();
  await db.transaction("rw", db.cart, async () => {
    await db.cart.clear();
    if (safe.items.length > 0) {
      await db.cart.bulkPut(safe.items.map((item) => ({ ...item, seller: safe.seller || item.seller })));
    }
  });
}

// ─── Merge-once bookkeeping ──────────────────────────────────────────────────
// Guards against re-running the guest→account merge on every load for the
// same account within this browser (e.g. a page refresh right after login).
// Scoped to localStorage (not Dexie) since it's UI-session bookkeeping, not
// cart data.

function hasMergedFor(account) {
  try {
    const raw = localStorage.getItem(LOCAL_MERGE_FLAG_KEY);
    const merged = raw ? JSON.parse(raw) : {};
    return !!merged[account];
  } catch {
    return false;
  }
}

function markMergedFor(account) {
  try {
    const raw = localStorage.getItem(LOCAL_MERGE_FLAG_KEY);
    const merged = raw ? JSON.parse(raw) : {};
    merged[account] = Date.now();
    localStorage.setItem(LOCAL_MERGE_FLAG_KEY, JSON.stringify(merged));
  } catch {
    // non-fatal — worst case the merge runs again next load
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Load the cart for the current identity.
 *
 * - Guest (`account == null`): returns the Dexie cart as-is.
 * - Authenticated, first load this session with a non-empty local guest
 *   cart and no merge recorded yet: merges the local cart into the server
 *   cart (server is authoritative for conflicts), writes the merged result
 *   back to Dexie, and returns it.
 * - Authenticated, otherwise: server is the source of truth when reachable;
 *   Dexie is the fallback when the server call fails (offline-first).
 *
 * @param {{ account: string|null }} ctx
 * @returns {Promise<Object>} a Cart (see cartModel.js)
 */
export async function loadCart({ account } = {}) {
  const localCart = await readDexieCart();

  if (!account) {
    return localCart;
  }

  const shouldMerge = localCart.items.length > 0 && !hasMergedFor(account);
  if (shouldMerge) {
    const result = await mergeOnServer(localCart);
    if (result.ok) {
      markMergedFor(account);
      const merged = { seller: result.data.sellerWallet, items: result.data.items || [], updatedAt: new Date(result.data.updatedAt || Date.now()).getTime() };
      await writeDexieCart(merged);
      return merged;
    }
    // Merge failed (offline, etc.) — fall through to a normal load; the
    // local cart is still usable, and the merge will be retried next load
    // since markMergedFor was never called.
  }

  const result = await authedFetch("GET");
  if (result.ok) {
    const serverCart = { seller: result.data.sellerWallet, items: result.data.items || [], updatedAt: result.data.updatedAt ? new Date(result.data.updatedAt).getTime() : Date.now() };
    await writeDexieCart(serverCart);
    return serverCart;
  }

  // Server unreachable/unauthenticated — degrade to the local cart so the
  // buyer is never blocked from seeing/using their cart offline.
  return localCart;
}

/**
 * Persist the cart. Always writes Dexie; if authenticated, also PUTs to the
 * server (best-effort — never throws, never blocks on a failed sync).
 * @param {Object} cart
 * @param {{ account: string|null }} ctx
 */
export async function saveCart(cart, { account } = {}) {
  await writeDexieCart(cart);
  if (!account) return;

  const safe = cart && Array.isArray(cart.items) ? cart : emptyCart();
  const result = await authedFetch("PUT", { items: safe.items });
  if (!result.ok) {
    console.warn("[CartStore] Server cart sync failed (non-fatal):", result.error);
  }
}

/**
 * Clear the cart. Always clears Dexie; if authenticated, also clears the
 * server cart (best-effort).
 * @param {{ account: string|null }} ctx
 */
export async function clearCart({ account } = {}) {
  await writeDexieCart(emptyCart());
  if (!account) return;

  const result = await authedFetch("PUT", { items: [] });
  if (!result.ok) {
    console.warn("[CartStore] Server cart clear failed (non-fatal):", result.error);
  }
}
