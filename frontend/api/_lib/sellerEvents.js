/**
 * sellerEvents.js — "I'm at an event" for sellers, and the live event report.
 *
 * Decided (AQUASHELLA_FEEDBACK.md §8): an event sale is a manual toggle based on
 * location. While a seller's event is on, ALL their card sales get the reduced
 * event fee, and the booth shows what sold in person vs online during it, so the
 * seller can see which inventory moves at events.
 *
 * Everything here except `findActiveSellerEvent` is pure (no I/O) so the rules
 * and the report math are unit-testable.
 */

/** Longest an event can run. Mirrors the CHECK in 20260929_seller_events.sql. */
export const MAX_EVENT_MS = 4 * 24 * 60 * 60 * 1000;
/** An event must end at least this far in the future when started. */
export const MIN_EVENT_MS = 15 * 60 * 1000;

export const SALES_CHANNEL = Object.freeze({ IN_PERSON: "in_person", ONLINE: "online" });

/**
 * Where a card checkout started. `booth` (the booth's Card button) and `tank`
 * (a printed tank QR label) are in person; anything else is online.
 *
 * This is a client hint and only ever used for reporting. It never changes a
 * fee or a payout (the event rate is seller-level, see findActiveSellerEvent).
 *
 * @param {unknown} raw
 * @returns {{ channel: "in_person"|"online", source: "booth"|"tank"|"web" }}
 */
export function normalizeSalesChannel(raw) {
  const v = String(raw || "").trim().toLowerCase();
  if (v === "booth" || v === "tank") return { channel: SALES_CHANNEL.IN_PERSON, source: v };
  return { channel: SALES_CHANNEL.ONLINE, source: "web" };
}

/** True when the event is running at `now` (epoch ms). */
export function isEventActive(event, now = Date.now()) {
  if (!event || event.ended_at) return false;
  const start = Date.parse(event.started_at);
  const end = Date.parse(event.ends_at);
  return Number.isFinite(start) && Number.isFinite(end) && start <= now && now < end;
}

/** The window a report covers: start → (ended early ? ended_at : ends_at), capped at now. */
export function eventWindow(event, now = Date.now()) {
  const start = Date.parse(event.started_at);
  const planned = Date.parse(event.ends_at);
  const ended = event.ended_at ? Date.parse(event.ended_at) : NaN;
  const end = Math.min(Number.isFinite(ended) ? ended : planned, now);
  return { startMs: start, endMs: Math.max(start, end) };
}

/**
 * Validate "start an event" input.
 * @param {{ name?: unknown, location?: unknown, endsAt?: unknown }} input
 * @param {number} now - epoch ms
 * @returns {{ ok: true, value: { name: string, location: string|null, endsAt: string } } | { ok: false, error: string, code: string }}
 */
export function validateEventInput(input = {}, now = Date.now()) {
  const name = String(input.name ?? "").trim().replace(/\s+/g, " ");
  if (!name) return { ok: false, error: "Give the event a name.", code: "EVENT_NAME_REQUIRED" };
  if (name.length > 80) return { ok: false, error: "Keep the event name under 80 characters.", code: "EVENT_NAME_TOO_LONG" };

  const rawLocation = String(input.location ?? "").trim().replace(/\s+/g, " ");
  if (rawLocation.length > 120) return { ok: false, error: "Keep the location under 120 characters.", code: "EVENT_LOCATION_TOO_LONG" };
  const location = rawLocation || null;

  const endsMs = Date.parse(String(input.endsAt ?? ""));
  if (!Number.isFinite(endsMs)) return { ok: false, error: "Pick when the event ends.", code: "EVENT_END_REQUIRED" };
  if (endsMs < now + MIN_EVENT_MS) return { ok: false, error: "The end time needs to be at least 15 minutes from now.", code: "EVENT_END_TOO_SOON" };
  if (endsMs > now + MAX_EVENT_MS) return { ok: false, error: "Events can run up to 4 days.", code: "EVENT_TOO_LONG" };

  return { ok: true, value: { name, location, endsAt: new Date(endsMs).toISOString() } };
}

/**
 * The seller's running event, or null. Fails CLOSED (null) on any error: a
 * lookup problem must never grant the reduced rate.
 *
 * @param {object} supabase - service-role client
 * @param {string} sellerWallet
 * @param {number} [now]
 */
export async function findActiveSellerEvent(supabase, sellerWallet, now = Date.now()) {
  const seller = String(sellerWallet || "").toLowerCase();
  if (!seller) return null;
  try {
    const { data, error } = await supabase
      .from("seller_events")
      .select("id, name, location, started_at, ends_at, ended_at")
      .eq("seller_wallet", seller)
      .is("ended_at", null)
      .maybeSingle();
    if (error || !data) return null;
    return isEventActive(data, now) ? data : null;
  } catch {
    return null;
  }
}

// ─── Report ─────────────────────────────────────────────────────────────────

/** Orders that aren't sales: money went back, or it never went through. */
const NOT_A_SALE = new Set(["refunded", "failed"]);

/** In person or online, for any order row. */
export function orderChannel(order) {
  const md = order?.metadata || {};
  if (md.salesChannel === SALES_CHANNEL.IN_PERSON || md.salesChannel === SALES_CHANNEL.ONLINE) return md.salesChannel;
  // Booth cash sales predate the salesChannel stamp but are in person by definition.
  if (order?.order_type === "cash_handshake" || md.source === "booth") return SALES_CHANNEL.IN_PERSON;
  return SALES_CHANNEL.ONLINE;
}

/** The listing an order sold, as a string id, or null. */
export function orderListingId(order) {
  const md = order?.metadata || {};
  if (md.listingId != null && String(md.listingId) !== "") return String(md.listingId);
  const first = Array.isArray(order?.items) ? order.items[0] : null;
  const id = first?.listingId ?? first?.tokenId ?? null;
  return id == null || String(id) === "" || String(id) === "undefined" ? null : String(id);
}

/** What the fish sold for (goods only, no processing fee or shipping). */
export function orderGoodsCents(order) {
  const md = order?.metadata || {};
  const goods = Number(md.goodsCents);
  if (Number.isFinite(goods) && goods >= 0) return Math.round(goods);
  return Math.max(0, Math.round(Number(order?.subtotal_cents ?? order?.total_paid_cents) || 0));
}

function emptyBucket() {
  return { orders: 0, quantity: 0, cents: 0 };
}

/**
 * Pure: per-fish in-person vs online totals for an event's orders.
 *
 * @param {object} args
 * @param {Array<object>} args.orders - orders rows (id, order_type, status, quantity, items, metadata, subtotal_cents, total_paid_cents)
 * @param {Record<string, { name: string, remaining: number|null }>} [args.listings] - by listing id
 * @returns {{ totals: { inPerson: object, online: object }, lines: Array<object> }}
 */
export function buildEventReport({ orders = [], listings = {} } = {}) {
  const totals = { inPerson: emptyBucket(), online: emptyBucket() };
  const byListing = new Map();

  for (const order of orders) {
    if (!order || NOT_A_SALE.has(order.status)) continue;
    const key = orderListingId(order) || "unknown";
    const qty = Math.max(1, Math.round(Number(order.quantity) || 1));
    const cents = orderGoodsCents(order);
    const side = orderChannel(order) === SALES_CHANNEL.IN_PERSON ? "inPerson" : "online";

    if (!byListing.has(key)) byListing.set(key, { inPerson: emptyBucket(), online: emptyBucket() });
    for (const bucket of [byListing.get(key)[side], totals[side]]) {
      bucket.orders += 1;
      bucket.quantity += qty;
      bucket.cents += cents;
    }
  }

  const lines = [...byListing.entries()]
    .map(([listingId, sides]) => ({
      listingId: listingId === "unknown" ? null : listingId,
      name: listings[listingId]?.name || (listingId === "unknown" ? "Other" : `Listing ${listingId}`),
      remaining: listings[listingId]?.remaining ?? null,
      inPerson: sides.inPerson,
      online: sides.online,
    }))
    // Best sellers first, so "what's being pushed" reads top-down.
    .sort((a, b) => (b.inPerson.quantity + b.online.quantity) - (a.inPerson.quantity + a.online.quantity)
      || String(a.name).localeCompare(String(b.name)));

  return { totals, lines };
}

/**
 * The `orders.metadata` a card sale is recorded with, from its PaymentIntent
 * metadata. Lets the event report attribute the sale (channel, event, listing,
 * goods value) without re-reading Stripe.
 *
 * @param {Record<string,string>} md - PaymentIntent metadata stamped at create-checkout
 */
export function cardOrderMetadata(md = {}) {
  const goods = Number(md.goodsTotalCents);
  return {
    rail: "card",
    salesChannel: md.salesChannel === SALES_CHANNEL.IN_PERSON ? SALES_CHANNEL.IN_PERSON : SALES_CHANNEL.ONLINE,
    channelSource: md.channelSource || "web",
    ...(md.eventId ? { eventId: String(md.eventId) } : {}),
    ...(md.listingId != null && md.listingId !== "" ? { listingId: String(md.listingId) } : {}),
    ...(md.tokenId != null && md.tokenId !== "" ? { tokenId: String(md.tokenId) } : {}),
    ...(Number.isFinite(goods) ? { goodsCents: Math.round(goods) } : {}),
  };
}
