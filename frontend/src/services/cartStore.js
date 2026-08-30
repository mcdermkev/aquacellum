/**
 * Identity-scoped cart persistence and verified-session server sync.
 *
 * Guest carts stay on this device. Authenticated carts are mirrored to the
 * verified caller's server row; request bodies never select an account. The
 * existing Dexie table is shared, so rows carry a non-indexed cartIdentity and
 * a storage-only primary key. Legacy unscoped rows are treated as guest rows.
 */

import { db } from "../db.js";
import { emptyCart } from "./cartModel.js";

const API_BASE = import.meta.env.VITE_API_BASE || "/api";
const GUEST_IDENTITY = "__guest__";
const MERGE_OPERATION_KEY = "aquadex_cart_merge_operations";
const SERVER_REVISION_KEY = "aquadex_cart_server_revisions";
const SYNC_CONFLICT_KEY = "aquadex_cart_sync_conflicts";

function readServerRevisions() {
  try {
    return JSON.parse(sessionStorage.getItem(SERVER_REVISION_KEY) || "{}");
  } catch {
    return {};
  }
}

function getServerRevision(account) {
  const revision = Number(readServerRevisions()[cartIdentity(account)]);
  return Number.isSafeInteger(revision) && revision >= 0 ? revision : 0;
}

function setServerRevision(account, revision) {
  if (!account || !Number.isSafeInteger(Number(revision)) || Number(revision) < 0) return;
  const revisions = readServerRevisions();
  revisions[cartIdentity(account)] = Number(revision);
  sessionStorage.setItem(SERVER_REVISION_KEY, JSON.stringify(revisions));
}

function readSyncConflicts() {
  try {
    return JSON.parse(localStorage.getItem(SYNC_CONFLICT_KEY) || "{}");
  } catch {
    return {};
  }
}

function getSyncConflict(account) {
  return readSyncConflicts()[cartIdentity(account)] || null;
}

function setSyncConflict(account, conflict) {
  const conflicts = readSyncConflicts();
  conflicts[cartIdentity(account)] = conflict;
  localStorage.setItem(SYNC_CONFLICT_KEY, JSON.stringify(conflicts));
}

function clearSyncConflict(account) {
  const conflicts = readSyncConflicts();
  delete conflicts[cartIdentity(account)];
  localStorage.setItem(SYNC_CONFLICT_KEY, JSON.stringify(conflicts));
}

let _sessionTokenGetter = null;
const serverMutationQueues = new Map();

/** Register the session-token getter (for example Privy's getAccessToken). */
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

async function authedFetch(method, body, query = "") {
  const token = await getSessionToken();
  if (!token) return { ok: false, status: 401, error: "not_authenticated" };
  try {
    const res = await fetch(`${API_BASE}/cart${query}`, {
      method,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: body != null ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { ok: false, status: res.status, error: data.error || `Request failed (${res.status})`, data };
    }
    return { ok: true, status: res.status, data };
  } catch (err) {
    console.warn("[CartStore] Server cart request failed:", err.message);
    return { ok: false, status: 0, error: err.message };
  }
}

function cartIdentity(account) {
  return account ? String(account).toLowerCase() : GUEST_IDENTITY;
}

/**
 * Advance only descendants of this tab's queued mutation lineage. The queue is
 * module-local (one browser tab), so another tab/device can never lend a stale
 * snapshot its revision. A snapshot from any other base revision remains stale
 * and must receive the server's normal 409 reconciliation response.
 */
export function resolveQueuedMutationRevision(snapshotRevision, predecessor = null) {
  const predecessorRevision = Number(predecessor?.response?.data?.revision);
  const followsPredecessor = predecessor?.snapshotRevision === snapshotRevision
    || predecessor?.submittedRevision === snapshotRevision;
  const canAdvance = predecessor?.response?.ok
    && Number.isSafeInteger(predecessorRevision)
    && predecessorRevision >= 0
    && followsPredecessor;
  return {
    expectedRevision: canAdvance ? predecessorRevision : snapshotRevision,
    snapshotRevision,
  };
}

function enqueueServerMutation(account, mutation) {
  const key = cartIdentity(account);
  const previous = serverMutationQueues.get(key) || Promise.resolve(null);
  const next = previous.catch(() => null).then(mutation);
  serverMutationQueues.set(key, next);
  return next.finally(() => {
    if (serverMutationQueues.get(key) === next) serverMutationQueues.delete(key);
  });
}

function storageId(identity, item, index) {
  const listingKey = item?.listingKey || item?.id || `row-${index}`;
  return `${identity}|${listingKey}`;
}

async function readDexieCart(account) {
  const identity = cartIdentity(account);
  const allRows = await db.cart.toArray();
  const rows = allRows.filter((row) => (
    row.cartIdentity === identity
    || (identity === GUEST_IDENTITY && !row.cartIdentity)
  ));
  if (rows.length === 0) {
    const cart = emptyCart();
    return account ? { ...cart, serverRevision: getServerRevision(account) } : cart;
  }

  const items = rows.map((row) => {
    const {
      id: persistedId,
      cartIdentity: _cartIdentity,
      cartItemId,
      cartUpdatedAt: _cartUpdatedAt,
      cartServerRevision: _cartServerRevision,
      ...item
    } = row;
    return { ...item, id: cartItemId || item.listingKey || persistedId };
  });
  const seller = rows[0].seller || null;
  const updatedAt = rows.reduce(
    (max, row) => Math.max(max, Number(row.cartUpdatedAt || row.addedAt) || 0),
    0,
  );
  const rowRevision = rows.reduce(
    (max, row) => Math.max(max, Number(row.cartServerRevision) || 0),
    0,
  );
  return {
    seller,
    items,
    updatedAt,
    ...(account ? { serverRevision: Math.max(rowRevision, getServerRevision(account)) } : {}),
  };
}

async function writeScopedDexieCart(cart, account) {
  const identity = cartIdentity(account);
  const safe = cart && Array.isArray(cart.items) ? cart : emptyCart();
  if (account && Number.isSafeInteger(Number(safe.serverRevision))) {
    setServerRevision(account, Number(safe.serverRevision));
  }
  await db.transaction("rw", db.cart, async () => {
    const rows = await db.cart.toArray();
    const keysToDelete = rows
      .filter((row) => row.cartIdentity === identity || (identity === GUEST_IDENTITY && !row.cartIdentity))
      .map((row) => row.id);
    if (keysToDelete.length > 0) await db.cart.bulkDelete(keysToDelete);
    if (safe.items.length > 0) {
      await db.cart.bulkPut(safe.items.map((item, index) => ({
        ...item,
        cartItemId: item.id || item.listingKey,
        id: storageId(identity, item, index),
        cartIdentity: identity,
        cartUpdatedAt: safe.updatedAt || Date.now(),
        cartServerRevision: Number.isSafeInteger(Number(safe.serverRevision))
          ? Number(safe.serverRevision)
          : undefined,
        seller: safe.seller || item.seller,
      })));
    }
  });
}

function normalizeServerCart(data) {
  return {
    seller: data?.sellerWallet || null,
    items: Array.isArray(data?.items) ? data.items : [],
    updatedAt: data?.updatedAt ? new Date(data.updatedAt).getTime() : Date.now(),
    serverRevision: Number.isSafeInteger(Number(data?.revision)) ? Number(data.revision) : 0,
  };
}

function mergeFingerprint(cart) {
  const items = (cart?.items || [])
    .map((item) => ({
      listingKey: String(item?.listingKey || ""),
      quantity: Number(item?.quantity),
    }))
    .sort((a, b) => (a.listingKey < b.listingKey ? -1 : a.listingKey > b.listingKey ? 1 : 0));
  return JSON.stringify({ items, updatedAt: Number(cart?.updatedAt) });
}

function readMergeOperations() {
  try {
    return JSON.parse(localStorage.getItem(MERGE_OPERATION_KEY) || "{}");
  } catch {
    return {};
  }
}

function pendingMergeOperation(account, guestCart) {
  const key = cartIdentity(account);
  const operations = readMergeOperations();
  const fingerprint = mergeFingerprint(guestCart);
  if (operations[key]?.fingerprint === fingerprint && operations[key]?.operationId) {
    return operations[key].operationId;
  }
  const operationId = typeof crypto?.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  operations[key] = { operationId, fingerprint, createdAt: Date.now() };
  localStorage.setItem(MERGE_OPERATION_KEY, JSON.stringify(operations));
  return operationId;
}

function clearMergeOperation(account) {
  try {
    const key = cartIdentity(account);
    const operations = readMergeOperations();
    delete operations[key];
    localStorage.setItem(MERGE_OPERATION_KEY, JSON.stringify(operations));
  } catch {
    // Best effort only. A stable retry ID is safe to retain.
  }
}

async function mergeOnServer(guestCart, operationId, resolution = null, reviewedAccountRevision = null) {
  return authedFetch("POST", {
    items: guestCart.items,
    sellerWallet: guestCart.seller,
    updatedAt: guestCart.updatedAt,
    operationId,
    resolution,
    reviewedAccountRevision,
  }, "?action=merge");
}

async function completeMerge(account, result) {
  const merged = normalizeServerCart(result.data);
  await Promise.all([
    writeScopedDexieCart(merged, account),
    writeScopedDexieCart(emptyCart(), null),
  ]);
  clearMergeOperation(account);
  return merged;
}

/**
 * Load the current identity's cart. Server sync is attempted only after
 * AuthContext has registered a verified-session token bridge.
 */
export async function loadCart({ account, canSync = false } = {}) {
  const localCart = await readDexieCart(account);
  if (!account || !canSync) return localCart;

  // A rejected stale write is durable recovery state, not a log message. On
  // reload, refresh only the account side and keep the rejected device cart
  // until the buyer explicitly chooses which snapshot should survive.
  const pendingSyncConflict = getSyncConflict(account);
  if (pendingSyncConflict?.localCart) {
    const accountResult = await authedFetch("GET");
    const accountCart = accountResult.ok
      ? normalizeServerCart(accountResult.data)
      : pendingSyncConflict.accountCart;
    return {
      ...accountCart,
      mergeConflict: {
        ...pendingSyncConflict,
        type: "sync_conflict",
        accountCart,
      },
    };
  }

  const guestCart = await readDexieCart(null);
  if (guestCart.items.length > 0) {
    const operationId = pendingMergeOperation(account, guestCart);
    const mergeResult = await mergeOnServer(guestCart, operationId);
    if (mergeResult.ok) return completeMerge(account, mergeResult);

    if (mergeResult.status === 409 && mergeResult.data?.code === "seller_conflict") {
      const accountCart = normalizeServerCart(mergeResult.data.accountCart);
      await writeScopedDexieCart(accountCart, account);
      return {
        ...accountCart,
        mergeConflict: {
          type: "account_merge",
          operationId,
          accountCart,
          guestCart,
          currentSeller: accountCart.seller,
          incomingSeller: guestCart.seller,
        },
      };
    }

    if (mergeResult.status === 409 && mergeResult.data?.code === "operation_mismatch") {
      // This operation ID can never complete the current immutable request.
      // Retire it so an explicit retry receives a new ID, preserve the guest
      // cart, and surface the failure instead of silently showing account data.
      clearMergeOperation(account);
      const accountResult = await authedFetch("GET");
      const accountCart = accountResult.ok ? normalizeServerCart(accountResult.data) : localCart;
      if (accountResult.ok) await writeScopedDexieCart(accountCart, account);
      return {
        ...accountCart,
        mergeConflict: {
          type: "merge_error",
          code: "operation_mismatch",
          error: mergeResult.error || "This cart merge could not be safely retried. Try again with a fresh merge request.",
          accountCart,
          guestCart,
        },
      };
    }

    // A failed merge is never equivalent to a successful account-cart load.
    // Keep the stable operation ID for ambiguous/network/server failures (the
    // server may have committed) and preserve the guest cart for explicit retry.
    const accountResult = await authedFetch("GET");
    const accountCart = accountResult.ok ? normalizeServerCart(accountResult.data) : localCart;
    if (accountResult.ok) await writeScopedDexieCart(accountCart, account);
    return {
      ...accountCart,
      mergeConflict: {
        type: "merge_error",
        code: mergeResult.data?.code || "merge_failed",
        error: mergeResult.error || "Your device cart has not been merged yet. Please try again.",
        accountCart,
        guestCart,
      },
    };
  }

  const result = await authedFetch("GET");
  if (result.ok) {
    const serverCart = normalizeServerCart(result.data);
    await writeScopedDexieCart(serverCart, account);
    return serverCart;
  }
  return localCart;
}

/** Resolve an explicit different-seller account-linking choice. */
export async function resolveCartMerge({ account, conflict, resolution, canSync = false } = {}) {
  if (!account || !canSync || conflict?.type !== "account_merge") {
    return { ok: false, error: "A verified session is required to resolve this cart conflict." };
  }
  if (resolution !== "account" && resolution !== "guest") {
    return { ok: false, error: "Choose which cart to keep." };
  }
  const reviewedAccountRevision = Number(conflict.accountCart?.serverRevision);
  if (!Number.isSafeInteger(reviewedAccountRevision) || reviewedAccountRevision < 0) {
    return { ok: false, error: "Refresh the account cart before choosing which cart to keep." };
  }
  const result = await mergeOnServer(
    conflict.guestCart,
    conflict.operationId,
    resolution,
    reviewedAccountRevision,
  );
  if (!result.ok) {
    if (result.status === 409 && result.data?.code === "seller_conflict" && result.data?.accountCart) {
      const accountCart = normalizeServerCart(result.data.accountCart);
      await writeScopedDexieCart(accountCart, account);
      return {
        ok: false,
        code: "seller_conflict",
        error: result.error || "Your account cart changed. Review both carts again.",
        conflict: {
          ...conflict,
          type: "account_merge",
          accountCart,
          currentSeller: accountCart.seller,
          error: result.error || "Your account cart changed. Review both carts again.",
        },
      };
    }
    if (result.status === 409 && result.data?.code === "operation_mismatch") {
      clearMergeOperation(account);
      return {
        ok: false,
        code: "operation_mismatch",
        error: result.error || "This cart merge needs a fresh retry.",
      };
    }
    return { ok: false, error: result.error || "Could not merge carts." };
  }
  const cart = await completeMerge(account, result);
  return { ok: true, cart };
}

/** Persist locally and, for a verified session, mirror to the server. */
export async function saveCart(cart, { account, canSync = false } = {}) {
  const safe = cart && Array.isArray(cart.items) ? cart : emptyCart();
  await writeScopedDexieCart(safe, account);
  if (!account || !canSync) return { ok: true, cart: safe };

  // Bind CAS to the snapshot being saved. The sessionStorage fallback is
  // tab-scoped and only advances from this tab's own acknowledged mutations;
  // another tab cannot lend a stale snapshot its newer revision.
  const snapshotRevision = Number.isSafeInteger(Number(safe.serverRevision))
    ? Number(safe.serverRevision)
    : getServerRevision(account);
  const queuedResult = await enqueueServerMutation(account, async (predecessor) => {
    const { expectedRevision } = resolveQueuedMutationRevision(
      snapshotRevision,
      predecessor,
    );
    const response = await authedFetch("PUT", {
      items: safe.items,
      expectedRevision,
    });
    if (response.ok) setServerRevision(account, response.data?.revision);
    return {
      response,
      snapshotRevision,
      submittedRevision: expectedRevision,
    };
  });
  const result = queuedResult.response;

  if (result.ok) return { ok: true, cart: normalizeServerCart(result.data) };
  if (result.status === 409 && result.data?.code === "revision_conflict") {
    const conflict = {
      type: "sync_conflict",
      error: result.error,
      localCart: safe,
      accountCart: normalizeServerCart(result.data),
    };
    setSyncConflict(account, conflict);
    return {
      ok: false,
      code: "revision_conflict",
      error: result.error,
      conflict,
    };
  }
  console.warn("[CartStore] Server cart sync failed (non-fatal):", result.error);
  return { ok: false, error: result.error };
}

/** Clear only the current identity's local cart and its verified server mirror. */
export async function clearCart({ account, canSync = false, serverRevision = null } = {}) {
  const revision = Number.isSafeInteger(Number(serverRevision))
    ? Number(serverRevision)
    : getServerRevision(account);
  return saveCart(
    { ...emptyCart(), serverRevision: revision },
    { account, canSync },
  );
}

/** Resolve a stale-write conflict only after an explicit account/device choice. */
export async function resolveCartRevisionConflict({ account, conflict, resolution, canSync = false } = {}) {
  if (!account || !canSync || conflict?.type !== "sync_conflict") {
    return { ok: false, error: "A verified session is required to resolve this cart conflict." };
  }
  if (resolution === "account") {
    const accountResult = await authedFetch("GET");
    if (!accountResult.ok) {
      return { ok: false, error: accountResult.error || "Could not refresh the account cart." };
    }
    const accountCart = normalizeServerCart(accountResult.data);
    await writeScopedDexieCart(accountCart, account);
    clearSyncConflict(account);
    return { ok: true, cart: accountCart };
  }
  if (resolution !== "local") return { ok: false, error: "Choose which cart to keep." };

  const retryCart = {
    ...conflict.localCart,
    serverRevision: conflict.accountCart.serverRevision,
  };
  const result = await saveCart(retryCart, { account, canSync });
  if (result.ok) clearSyncConflict(account);
  return result;
}
