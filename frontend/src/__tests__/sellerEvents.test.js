/**
 * Seller event mode (AQUASHELLA_FEEDBACK.md §8, decided 2026-09-29):
 *   - a manual "at an event" toggle; while on, ALL the seller's card sales get
 *     the event rate (2%), decided server-side from the seller;
 *   - a live report of what sold in person vs online during the event.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  buildEventReport,
  cardOrderMetadata,
  eventWindow,
  findActiveSellerEvent,
  isEventActive,
  normalizeSalesChannel,
  orderChannel,
  orderGoodsCents,
  orderListingId,
  validateEventInput,
} from "../../api/_lib/sellerEvents.js";
import { currentSalesChannel, rememberSalesChannelFromUrl } from "../services/stripePayments.js";
import { boothProductPath } from "../services/boothInventory.js";
import { endEvent, fetchEventReport, listEvents, setSessionTokenGetter, startEvent } from "../services/boothApi.js";
import { defaultEventEnd, toLocalInputValue } from "../components/breeder/BoothEvents.jsx";

const read = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const SQL = read("../../supabase/migrations/20260929_seller_events.sql");
const ORDER = JSON.stringify(JSON.parse(read("../../../supabase/migration-order.json")));
const STRIPE = strip(read("../../api/stripe.js"));
const API = strip(read("../../api/storefront-detail.js"));
const TANK = read("../../tank.html");

function fn(src, name) {
  const start = src.indexOf(`async function ${name}(`);
  expect(start, `${name} exists`).toBeGreaterThan(-1);
  const next = src.slice(start + 1).search(/\n(?:async\s+)?function\s/);
  return src.slice(start, next > -1 ? start + 1 + next : undefined);
}

const HOUR = 3600 * 1000;
const NOW = Date.parse("2026-10-03T15:00:00Z");

describe("migration", () => {
  it("is registered", () => {
    expect(ORDER).toContain("frontend/supabase/migrations/20260929_seller_events.sql");
  });
  it("caps an event at 4 days and allows one open event per seller", () => {
    expect(SQL).toMatch(/check \(ends_at <= started_at \+ interval '4 days'\)/);
    expect(SQL).toMatch(/create unique index if not exists uq_seller_events_open\s+on public\.seller_events \(seller_wallet\) where ended_at is null;/);
  });
  it("is server-only", () => {
    expect(SQL).toMatch(/alter table public\.seller_events enable row level security;/);
    expect(SQL).toMatch(/revoke all on public\.seller_events from anon, authenticated;/);
  });
});

describe("validateEventInput", () => {
  it("accepts a name and an end between 15 minutes and 4 days out", () => {
    const r = validateEventInput({ name: "  Aquashella  ", location: "Edison, NJ", endsAt: new Date(NOW + 8 * HOUR).toISOString() }, NOW);
    expect(r).toEqual({ ok: true, value: { name: "Aquashella", location: "Edison, NJ", endsAt: new Date(NOW + 8 * HOUR).toISOString() } });
  });
  it("refuses a missing name, a past/too-soon end, and more than 4 days", () => {
    expect(validateEventInput({ name: "", endsAt: new Date(NOW + HOUR).toISOString() }, NOW).code).toBe("EVENT_NAME_REQUIRED");
    expect(validateEventInput({ name: "x", endsAt: "nope" }, NOW).code).toBe("EVENT_END_REQUIRED");
    expect(validateEventInput({ name: "x", endsAt: new Date(NOW + 5 * 60 * 1000).toISOString() }, NOW).code).toBe("EVENT_END_TOO_SOON");
    expect(validateEventInput({ name: "x", endsAt: new Date(NOW + 97 * HOUR).toISOString() }, NOW).code).toBe("EVENT_TOO_LONG");
    expect(validateEventInput({ name: "x".repeat(81), endsAt: new Date(NOW + HOUR).toISOString() }, NOW).code).toBe("EVENT_NAME_TOO_LONG");
  });
});

describe("event activity and window", () => {
  const ev = { started_at: new Date(NOW - HOUR).toISOString(), ends_at: new Date(NOW + HOUR).toISOString(), ended_at: null };
  it("is active only between start and end, and not once ended", () => {
    expect(isEventActive(ev, NOW)).toBe(true);
    expect(isEventActive(ev, NOW + 2 * HOUR)).toBe(false);
    expect(isEventActive({ ...ev, ended_at: new Date(NOW).toISOString() }, NOW)).toBe(false);
  });
  it("reports up to now, or to when it was ended early", () => {
    expect(eventWindow(ev, NOW)).toEqual({ startMs: NOW - HOUR, endMs: NOW });
    expect(eventWindow({ ...ev, ended_at: new Date(NOW - 30 * 60 * 1000).toISOString() }, NOW + 5 * HOUR).endMs).toBe(NOW - 30 * 60 * 1000);
  });
});

describe("findActiveSellerEvent", () => {
  const client = (result) => {
    const q = { select: () => q, eq: () => q, is: () => q, maybeSingle: async () => result };
    return { from: vi.fn(() => q) };
  };
  it("returns the running event", async () => {
    const row = { id: "e1", started_at: new Date(NOW - HOUR).toISOString(), ends_at: new Date(NOW + HOUR).toISOString(), ended_at: null };
    expect(await findActiveSellerEvent(client({ data: row, error: null }), "0xABC", NOW)).toBe(row);
  });
  it("fails closed: expired, missing, or errored lookups give no discount", async () => {
    const past = { id: "e1", started_at: new Date(NOW - 3 * HOUR).toISOString(), ends_at: new Date(NOW - HOUR).toISOString(), ended_at: null };
    expect(await findActiveSellerEvent(client({ data: past, error: null }), "0xabc", NOW)).toBeNull();
    expect(await findActiveSellerEvent(client({ data: null, error: { message: "x" } }), "0xabc", NOW)).toBeNull();
    expect(await findActiveSellerEvent({ from: () => { throw new Error("down"); } }, "0xabc", NOW)).toBeNull();
    expect(await findActiveSellerEvent(client({ data: null, error: null }), "", NOW)).toBeNull();
  });
});

describe("sales channel", () => {
  it("booth and tank are in person; anything else is online", () => {
    expect(normalizeSalesChannel("booth")).toEqual({ channel: "in_person", source: "booth" });
    expect(normalizeSalesChannel("TANK")).toEqual({ channel: "in_person", source: "tank" });
    expect(normalizeSalesChannel("in_person")).toEqual({ channel: "online", source: "web" });
    expect(normalizeSalesChannel(undefined)).toEqual({ channel: "online", source: "web" });
  });

  it("card order metadata carries channel, event, listing and goods value", () => {
    expect(cardOrderMetadata({ salesChannel: "in_person", channelSource: "tank", eventId: "e1", listingId: "8000007", goodsTotalCents: "2000" }))
      .toEqual({ rail: "card", salesChannel: "in_person", channelSource: "tank", eventId: "e1", listingId: "8000007", goodsCents: 2000 });
    expect(cardOrderMetadata({ tokenId: "5" })).toEqual({ rail: "card", salesChannel: "online", channelSource: "web", tokenId: "5" });
  });

  it("classifies orders, including cash rows from before the stamp", () => {
    expect(orderChannel({ order_type: "cash_handshake", metadata: { source: "booth" } })).toBe("in_person");
    expect(orderChannel({ order_type: "batch", metadata: { salesChannel: "in_person" } })).toBe("in_person");
    expect(orderChannel({ order_type: "batch", metadata: {} })).toBe("online");
  });

  it("finds the listing and goods value on every order shape", () => {
    expect(orderListingId({ metadata: { listingId: 9 } })).toBe("9");
    expect(orderListingId({ items: [{ listingId: "8000001" }] })).toBe("8000001");
    expect(orderListingId({ items: [{ tokenId: 12 }] })).toBe("12");
    expect(orderListingId({ items: [{}] })).toBeNull();
    expect(orderGoodsCents({ metadata: { goodsCents: 1500 }, total_paid_cents: 1600 })).toBe(1500);
    expect(orderGoodsCents({ subtotal_cents: 900, total_paid_cents: 900 })).toBe(900);
  });
});

describe("buildEventReport", () => {
  const orders = [
    { order_type: "cash_handshake", status: "completed", quantity: 2, items: [{ listingId: "1" }], metadata: { source: "booth", goodsCents: 4000 } },
    { order_type: "batch", status: "locked", quantity: 1, metadata: { salesChannel: "in_person", listingId: "1", goodsCents: 2000 } },
    { order_type: "batch", status: "locked", quantity: 1, metadata: { salesChannel: "online", listingId: "2", goodsCents: 3000 } },
    { order_type: "batch", status: "refunded", quantity: 5, metadata: { salesChannel: "online", listingId: "2", goodsCents: 9999 } },
  ];
  const listings = { 1: { name: "Pink Saffire", remaining: 1 }, 2: { name: "Gradio", remaining: 3 } };

  it("splits in person vs online per fish, best sellers first, ignoring refunds", () => {
    const r = buildEventReport({ orders, listings });
    expect(r.totals.inPerson).toEqual({ orders: 2, quantity: 3, cents: 6000 });
    expect(r.totals.online).toEqual({ orders: 1, quantity: 1, cents: 3000 });
    expect(r.lines.map((l) => l.name)).toEqual(["Pink Saffire", "Gradio"]);
    expect(r.lines[0]).toMatchObject({ listingId: "1", remaining: 1, inPerson: { quantity: 3 }, online: { quantity: 0 } });
  });

  it("is empty for no sales", () => {
    expect(buildEventReport({ orders: [] })).toEqual({ totals: { inPerson: { orders: 0, quantity: 0, cents: 0 }, online: { orders: 0, quantity: 0, cents: 0 } }, lines: [] });
  });
});

describe("checkout: event rate comes from the seller, not the buyer", () => {
  const f = fn(STRIPE, "handleCreateCheckout");

  it("looks up the seller's running event and feeds it to the fee policy", () => {
    expect(f).toMatch(/const sellerEvent = verifiedEventTideId \? null : await findActiveSellerEvent\(supabase, sellerWallet\);/);
    expect(f).toMatch(/rail: eventId \? FEE_RAIL\.CARD_EVENT : FEE_RAIL\.CARD,/);
  });

  it("the channel hint is stamped for reporting only, after the charge is computed", () => {
    const charge = f.indexOf("computeCheckoutCharge(");
    const channel = f.indexOf("normalizeSalesChannel(req.body.salesChannel)");
    expect(channel).toBeGreaterThan(charge);
    expect(f.slice(0, charge)).not.toMatch(/salesChannel/);
  });

  it("both webhook order inserts record the sale's metadata", () => {
    const succeeded = STRIPE.slice(STRIPE.indexOf('case "payment_intent.succeeded"'), STRIPE.indexOf('case "charge.dispute.created"'));
    expect(succeeded.match(/metadata: cardOrderMetadata\(metadata\),/g)).toHaveLength(2);
  });
});

describe("event endpoints", () => {
  it("are routed and seller-only (session wallet)", () => {
    for (const [action, handler] of [
      ["booth-events", "handleBoothEvents"],
      ["booth-event-start", "handleBoothEventStart"],
      ["booth-event-end", "handleBoothEventEnd"],
      ["booth-event-report", "handleBoothEventReport"],
    ]) {
      expect(API).toMatch(new RegExp(`case "${action}":\\s*return ${handler}\\(req, res\\);`));
      const f = fn(API, handler);
      expect(f).toMatch(/const sellerWallet = await requireWalletFromSession\(req, res\);/);
      expect(f).not.toMatch(/forSeller|isActiveBoothStaff/);
    }
  });

  it("start validates, then closes any open event before inserting", () => {
    const f = fn(API, "handleBoothEventStart");
    const validate = f.indexOf("validateEventInput(");
    const close = f.indexOf('.update({ ended_at: nowIso })');
    const insert = f.indexOf(".insert(");
    expect(validate).toBeGreaterThan(-1);
    expect(close).toBeGreaterThan(validate);
    expect(insert).toBeGreaterThan(close);
    expect(f).toMatch(/EVENT_ALREADY_ON/);
  });

  it("the report only reads this seller's event and orders", () => {
    const f = fn(API, "handleBoothEventReport");
    expect(f).toMatch(/\.eq\("seller_wallet", sellerWallet\)/);
    expect(f).toMatch(/\.ilike\("seller_wallet", sellerWallet\)/);
    expect(f).toMatch(/\/\^\[0-9a-f-\]\{36\}\$\/i/);
  });

  it("booth cash sales are stamped in person", () => {
    const f = fn(API, "handleRecordSale");
    expect(f).toMatch(/salesChannel: SALES_CHANNEL\.IN_PERSON,/);
    expect(f).toMatch(/channelSource: "booth",/);
  });
});

describe("in-person tagging on the client", () => {
  it("tank labels send the tank channel", () => {
    expect(TANK).toMatch(/salesChannel: 'tank',/);
  });

  it("the booth Card button opens the product with ?via=booth", () => {
    expect(boothProductPath({ listingKey: "batch-8000007" })).toBe("/app/products/batch-8000007?via=booth");
  });

  it("the hint is remembered for an hour in this tab, and only for known values", () => {
    const store = new Map();
    const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
    expect(rememberSalesChannelFromUrl("?via=evil", storage, NOW)).toBeNull();
    expect(currentSalesChannel(storage, NOW)).toBeNull();
    expect(rememberSalesChannelFromUrl("?via=booth", storage, NOW)).toBe("booth");
    expect(currentSalesChannel(storage, NOW + 30 * 60 * 1000)).toBe("booth");
    expect(currentSalesChannel(storage, NOW + 61 * 60 * 1000)).toBeNull();
  });
});

describe("boothApi event calls", () => {
  afterEach(() => setSessionTokenGetter(null));
  const okFetch = (body = { ok: true }) => vi.fn(async () => ({ ok: true, json: async () => body }));

  it("refuse without a session", async () => {
    const fetchImpl = vi.fn();
    expect(await listEvents({ fetchImpl })).toMatchObject({ success: false, code: "NO_SESSION" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("hit the right actions", async () => {
    setSessionTokenGetter(async () => "tok");
    const fetchImpl = okFetch();
    await listEvents({ fetchImpl });
    await startEvent({ name: "Aquashella", location: "NJ", endsAt: "2026-10-04T03:59:00.000Z" }, { fetchImpl });
    await endEvent({ fetchImpl });
    await fetchEventReport("11111111-2222-3333-4444-555555555555", { fetchImpl });
    const urls = fetchImpl.mock.calls.map((c) => c[0]);
    expect(urls[0]).toMatch(/action=booth-events$/);
    expect(urls[1]).toMatch(/action=booth-event-start$/);
    expect(JSON.parse(fetchImpl.mock.calls[1][1].body)).toEqual({ name: "Aquashella", location: "NJ", endsAt: "2026-10-04T03:59:00.000Z" });
    expect(urls[2]).toMatch(/action=booth-event-end$/);
    expect(urls[3]).toMatch(/action=booth-event-report&id=11111111-2222-3333-4444-555555555555$/);
    for (const c of fetchImpl.mock.calls) expect(c[1].headers.Authorization).toBe("Bearer tok");
  });
});

describe("event form defaults", () => {
  it("ends tonight at 11:59 pm, or tomorrow night if tonight is under an hour away", () => {
    const afternoon = new Date(2026, 9, 3, 14, 0);
    expect(toLocalInputValue(defaultEventEnd(afternoon))).toBe("2026-10-03T23:59");
    const late = new Date(2026, 9, 3, 23, 30);
    expect(toLocalInputValue(defaultEventEnd(late))).toBe("2026-10-04T23:59");
  });
});
