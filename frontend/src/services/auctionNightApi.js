/**
 * auctionNightApi.js — client for club auction night (docs/AUCTIONS_SPEC.md §9).
 *
 * Organizer calls send the Privy session token; the server derives the wallet
 * from it and the database checks the wallet is a club organizer. The room
 * screen read is public. Uses the token getter registered for auctionsApi.js.
 */

import { getSessionTokenForApi } from "./auctionsApi";

const API_BASE = "/api";

async function call(path, { method = "GET", body, auth = "required", fetchImpl = fetch } = {}) {
  const token = auth === "none" ? null : await getSessionTokenForApi();
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

const post = (action, body) => call(`storefront-detail?action=${action}`, { method: "POST", body });

// ─── Home ──────────────────────────────────────────────────────────────────
export const getNightHome = () => call("storefront-detail?action=club-auction-home");
export const createClub = (name) => post("club-create", { name });
export const createClubAuction = (fields) => post("club-auction-create", fields);

// ─── Console ───────────────────────────────────────────────────────────────
export const getNightConsole = (auctionId) =>
  call(`storefront-detail?action=club-auction&id=${encodeURIComponent(auctionId)}`);
export const addLots = (auctionId, lots) => post("club-lot-add", { auctionId, lots });
export const updateLot = (fields) => post("club-lot-update", fields);
export const removeLot = (lotId) => post("club-lot-remove", { lotId });
export const addBidder = (auctionId, fields) => post("club-bidder-add", { auctionId, ...fields });
export const setCurrentLot = (lotId) => post("club-current-lot", { lotId });
export const recordResult = (lotId, outcome, { bidderNumber, hammerCents } = {}) =>
  post("club-lot-result", { lotId, outcome, bidderNumber, hammerCents });
export const undoResult = (lotId) => post("club-lot-undo", { lotId });

// ─── Checkout desk ─────────────────────────────────────────────────────────
export const deskCash = (bidderId) => post("club-desk-cash", { bidderId });
/** mode 'checkout' → { checkoutUrl } for a QR; 'saved' → { paid: true } */
export const deskCard = (bidderId, mode) =>
  call("stripe?action=club-desk-card", { method: "POST", body: { bidderId, mode } });
export const deskCancel = (bidderId) =>
  call("stripe?action=club-desk-cancel", { method: "POST", body: { bidderId } });

// ─── Public room screen ────────────────────────────────────────────────────
export const getRoom = (auctionId) =>
  call(`storefront-detail?action=auction-room&id=${encodeURIComponent(auctionId)}`, { auth: "none" });

// ─── Paths ─────────────────────────────────────────────────────────────────
export const nightHomePath = () => "/app/auction-night";
export const nightConsolePath = (id) => `/app/auction-night/${encodeURIComponent(String(id || ""))}`;
export const nightRoomPath = (id) => `/app/auction-night/${encodeURIComponent(String(id || ""))}/room`;
