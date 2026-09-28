/**
 * auctionLots.js — pure rules for public auctions (docs/AUCTIONS_SPEC.md).
 *
 * The database (20260929_auctions_v2.sql) is the authority: place_lot_bid and
 * create_auction_lot enforce every rule under a row lock. This module validates
 * input early with friendly messages, mirrors the minimum-bid formula for the UI,
 * and maps database errors to HTTP answers. No I/O.
 */

export const MIN_LOT_DURATION_MS = 60 * 60 * 1000; // 1 hour
export const MAX_LOT_DURATION_MS = 14 * 24 * 60 * 60 * 1000; // 14 days
export const MIN_BID_CENTS = 100;
export const MAX_BID_CENTS = 10_000_000; // $100,000
export const MAX_PHOTOS = 8;

/** Same formula as public.auction_min_next_bid. */
export function minNextBidCents(highBidCents, startingBidCents) {
  if (highBidCents == null) return startingBidCents;
  return highBidCents + Math.max(100, Math.ceil(highBidCents * 0.05));
}

function cleanText(value, max) {
  const s = String(value ?? "").trim().replace(/[ \t]+/g, " ");
  return s.length > max ? null : s;
}

function wholeCents(value) {
  const n = Number(value);
  return Number.isInteger(n) ? n : NaN;
}

/** https (or same-origin path) image URLs only, at most MAX_PHOTOS. */
export function cleanPhotos(photos) {
  if (photos == null) return [];
  if (!Array.isArray(photos)) return null;
  const out = [];
  for (const p of photos) {
    const s = String(p ?? "").trim();
    if (!s) continue;
    if (s.length > 600 || /\s/.test(s)) return null;
    if (s.startsWith("/") && !s.startsWith("//")) { out.push(s); continue; }
    try {
      if (new URL(s).protocol !== "https:") return null;
    } catch {
      return null;
    }
    out.push(s);
  }
  return out.length > MAX_PHOTOS ? null : out;
}

/**
 * Validate "new lot" input.
 * @returns {{ ok: true, value: object } | { ok: false, error: string, code: string }}
 */
export function validateLotInput(body = {}, now = Date.now()) {
  const fail = (error, code) => ({ ok: false, error, code });

  const title = cleanText(body.title, 120);
  if (!title) return fail(title === null ? "Keep the title under 120 characters." : "Give the lot a title.", "LOT_TITLE");
  const description = cleanText(body.description, 4000);
  if (description === null) return fail("Keep the description under 4,000 characters.", "LOT_DESCRIPTION");

  const photos = cleanPhotos(body.photos);
  if (photos === null) return fail(`Use up to ${MAX_PHOTOS} photos with https links.`, "LOT_PHOTOS");

  const source = body.source === "batch_listing" ? "batch_listing" : body.source === "freeform" ? "freeform" : null;
  if (!source) return fail("Choose what you're auctioning.", "LOT_SOURCE");
  const listingId = source === "batch_listing" ? String(body.listingId ?? "").trim() : null;
  if (source === "batch_listing" && !listingId) return fail("Pick the listing the fish come from.", "LOT_LISTING");
  const quantity = source === "batch_listing" ? wholeCents(body.quantity ?? 1) : 1;
  if (!(quantity >= 1 && quantity <= 1000)) return fail("Quantity must be between 1 and 1,000.", "LOT_QUANTITY");

  const startingBidCents = wholeCents(body.startingBidCents);
  if (!(startingBidCents >= MIN_BID_CENTS && startingBidCents <= MAX_BID_CENTS)) {
    return fail("The starting bid must be between $1 and $100,000.", "LOT_STARTING_BID");
  }
  let reserveCents = null;
  if (body.reserveCents != null && body.reserveCents !== "") {
    reserveCents = wholeCents(body.reserveCents);
    if (!(reserveCents >= startingBidCents && reserveCents <= MAX_BID_CENTS)) {
      return fail("The reserve must be at least the starting bid.", "LOT_RESERVE");
    }
  }

  const endsMs = Date.parse(String(body.endsAt ?? ""));
  if (!Number.isFinite(endsMs)) return fail("Pick when bidding ends.", "LOT_END");
  // A small grace so a form submitted exactly at "1 hour" isn't refused by the
  // database a few hundred ms later.
  if (endsMs < now + MIN_LOT_DURATION_MS + 60_000) return fail("Bidding needs to run at least an hour.", "LOT_END_TOO_SOON");
  if (endsMs > now + MAX_LOT_DURATION_MS) return fail("Bidding can run up to 14 days.", "LOT_END_TOO_LATE");

  const pickupLocation = cleanText(body.pickupLocation, 200);
  if (!pickupLocation) return fail(pickupLocation === null ? "Keep the pickup location under 200 characters." : "Say where the winner picks up.", "LOT_PICKUP");
  const pickupNotes = cleanText(body.pickupNotes, 1000);
  if (pickupNotes === null) return fail("Keep the pickup notes under 1,000 characters.", "LOT_PICKUP_NOTES");

  return {
    ok: true,
    value: {
      title,
      description: description || null,
      photos,
      source,
      listingId,
      quantity,
      startingBidCents,
      reserveCents,
      endsAt: new Date(endsMs).toISOString(),
      pickupLocation,
      pickupNotes: pickupNotes || null,
    },
  };
}

function dollars(cents) {
  return `$${(cents / 100).toFixed(2)}`;
}

/**
 * Map a database error from place_lot_bid / create_auction_lot / cancel_auction_lot.
 * @returns {{ status: number, code: string, error: string }}
 */
export function mapAuctionDbError(message = "") {
  const msg = String(message);
  const min = msg.match(/minimum bid is (\d+) cents/i);
  if (min) return { status: 409, code: "BID_TOO_LOW", error: `The minimum bid is ${dollars(Number(min[1]))}.` };
  if (/add a card/i.test(msg)) return { status: 409, code: "CARD_REQUIRED", error: "Add a card first. If you win, it's charged automatically." };
  if (/already have the high bid/i.test(msg)) return { status: 409, code: "ALREADY_HIGH_BIDDER", error: "You already have the high bid." };
  if (/own lot/i.test(msg)) return { status: 409, code: "OWN_LOT", error: "You can't bid on your own lot." };
  if (/members only/i.test(msg)) return { status: 403, code: "MEMBERS_ONLY", error: "This auction is for club members only." };
  if (/has ended|not open for bidding/i.test(msg)) return { status: 409, code: "LOT_CLOSED", error: "Bidding on this lot has closed." };
  if (/not started/i.test(msg)) return { status: 409, code: "LOT_NOT_STARTED", error: "Bidding hasn't started yet." };
  if (/maximum bid/i.test(msg)) return { status: 400, code: "BID_TOO_HIGH", error: "The maximum bid is $100,000." };
  if (/oversell/i.test(msg)) return { status: 409, code: "NOT_ENOUGH_STOCK", error: "There aren't that many left in that listing." };
  if (/does not belong/i.test(msg)) return { status: 403, code: "NOT_YOURS", error: "That isn't yours." };
  if (/has bids/i.test(msg)) return { status: 409, code: "LOT_HAS_BIDS", error: "A lot with bids can't be cancelled." };
  if (/already closed/i.test(msg)) return { status: 409, code: "LOT_CLOSED", error: "This lot has already closed." };
  if (/not found/i.test(msg)) return { status: 404, code: "NOT_FOUND", error: "Lot not found." };
  if (/between 1 hour and 14 days/i.test(msg)) return { status: 400, code: "LOT_END", error: "Bidding must run between 1 hour and 14 days." };
  return { status: 500, code: "AUCTION_ERROR", error: "Something went wrong. Try again." };
}

/** Parse the public list query. */
export function parseLotListQuery(query = {}) {
  const status = query.status === "ended" ? "ended" : "live";
  const sort = ["ending", "new", "nobids"].includes(query.sort) ? query.sort : "ending";
  const q = String(query.q ?? "").trim().slice(0, 80);
  const club = /^[a-z0-9-]{1,80}$/i.test(String(query.club ?? "")) ? String(query.club) : null;
  const limit = Math.min(60, Math.max(1, Number.parseInt(query.limit, 10) || 30));
  return { status, sort, q, club, limit };
}
