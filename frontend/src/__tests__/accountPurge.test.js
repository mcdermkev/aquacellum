/**
 * Account purge (/api/retention?action=purge-deletions, api/_lib/accountPurge.js).
 *
 * Runs the real purge logic against an in-memory fake Supabase client. Never
 * touches a live database. Covers: only due requests are purged, matching is
 * case-insensitive and scoped to the one wallet, accounting records are left
 * alone, the profile is kept as an anonymized marker, the run is idempotent,
 * a cancel during the run wins, a failed step leaves the request for the next
 * run, and Fish Room owners are held for manual review. Open offers are
 * withdrawn/declined (never deleted), unbid auction lots are cancelled through
 * cancel_auction_lot, and anything with money or a binding bid in flight
 * defers the account without writing anything.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import {
  PURGE_PLAN,
  PURGE_HOLDS,
  PURGE_GRACE_DAYS,
  purgeDueAccounts,
  likeExact,
} from "../../api/_lib/accountPurge.js";
import { DELETION_GRACE_DAYS, DELETION_KEPT, DELETION_REMOVED } from "../services/gdprService.js";

const NOW = new Date("2026-11-15T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n) => new Date(NOW.getTime() - n * DAY).toISOString();

// Stored in checksum casing, as legacy profiles are.
const ALICE = "0xAbCdEf0123456789abcdef0123456789ABCDEF01";
const BOB = "0x9999999999999999999999999999999999999999";

// ── Fake Supabase ────────────────────────────────────────────────────────────

function likeToRegex(pattern) {
  let out = "";
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === "\\" && i + 1 < pattern.length) { out += pattern[++i].replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); continue; }
    if (c === "%") out += ".*";
    else if (c === "_") out += ".";
    else out += c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${out}$`, "i");
}

function fakeSupabase(seed, { failTable = null, storage = {}, onWrite = null, onRpc = null } = {}) {
  const tables = structuredClone(seed);
  const files = structuredClone(storage); // { bucket: ["path/a.jpg", ...] }
  const calls = [];

  // Mirrors cancel_auction_lot (20260929_auctions_v2.sql): re-checks under the
  // row lock, cancels, and returns batch stock (which switches the listing on).
  const rpcs = {
    cancel_auction_lot({ p_lot, p_seller }) {
      const lot = (tables.auction_lots || []).find((l) => l.id === p_lot);
      if (!lot) return { data: null, error: { message: "lot not found", code: "P0002" } };
      if (lot.seller_wallet !== String(p_seller).toLowerCase()) return { data: null, error: { message: "not yours", code: "42501" } };
      if (!["live", "pending_approval"].includes(lot.status)) return { data: null, error: { message: "cancel refused: this lot has already closed", code: "23514" } };
      if (lot.bid_count > 0) return { data: null, error: { message: "cancel refused: this lot has bids", code: "23514" } };
      lot.status = "cancelled";
      lot.closed_at = "db-now";
      if (lot.source === "batch_listing" && lot.stock_moved) {
        const listing = (tables.aquadex_listings || []).find((x) => x.id === lot.listing_id);
        if (listing) listing.is_active = true;
        lot.stock_moved = false;
      }
      return { data: { lotId: lot.id, status: "cancelled" }, error: null };
    },
  };

  function builder(table) {
    const state = { table, op: "select", filters: [], values: null, limit: null, order: null, single: false };
    const apply = () => {
      if (failTable === table && state.op !== "select") {
        return { data: null, error: { message: `boom on ${table}`, code: "XX000" }, count: null };
      }
      const rows = tables[table] || (tables[table] = []);
      const match = (row) => state.filters.every((f) => f(row));
      if (state.op === "select") {
        let out = rows.filter(match);
        if (state.order) {
          const { col, asc } = state.order;
          out = [...out].sort((a, b) => (a[col] < b[col] ? -1 : 1) * (asc ? 1 : -1));
        }
        if (state.limit != null) out = out.slice(0, state.limit);
        out = out.map((r) => ({ ...r }));
        return { data: state.single ? out[0] || null : out, error: null };
      }
      calls.push({ table, op: state.op, values: state.values });
      onWrite?.({ table, op: state.op, tables });
      if (state.op === "delete") {
        const keep = rows.filter((r) => !match(r));
        const count = rows.length - keep.length;
        tables[table] = keep;
        return { data: null, error: null, count };
      }
      let count = 0;
      for (const r of rows) if (match(r)) { Object.assign(r, state.values); count++; }
      return { data: null, error: null, count };
    };
    const api = {
      select() { return api; },
      delete() { state.op = "delete"; return api; },
      update(values) { state.op = "update"; state.values = values; return api; },
      eq(col, v) { state.filters.push((r) => r[col] === v); return api; },
      in(col, vs) { state.filters.push((r) => vs.includes(r[col])); return api; },
      gt(col, v) { state.filters.push((r) => r[col] != null && r[col] > v); return api; },
      ilike(col, pattern) { const re = likeToRegex(pattern); state.filters.push((r) => r[col] != null && re.test(String(r[col]))); return api; },
      not(col, op, v) { if (op === "is" && v === null) state.filters.push((r) => r[col] != null); return api; },
      lte(col, v) { state.filters.push((r) => r[col] != null && r[col] <= v); return api; },
      order(col, { ascending = true } = {}) { state.order = { col, asc: ascending }; return api; },
      limit(n) { state.limit = n; return api; },
      maybeSingle() { state.single = true; return Promise.resolve(apply()); },
      then(resolve, reject) { return Promise.resolve(apply()).then(resolve, reject); },
    };
    return api;
  }

  return {
    tables,
    files,
    calls,
    from: (t) => builder(t),
    async rpc(name, args) {
      calls.push({ op: "rpc", rpc: name, args });
      onRpc?.({ name, args, tables });
      if (!rpcs[name]) return { data: null, error: { message: `no function ${name}`, code: "PGRST202" } };
      return rpcs[name](args);
    },
    storage: {
      from(bucket) {
        return {
          async list(prefix) {
            const all = files[bucket] || [];
            const inFolder = all.filter((p) => p.startsWith(`${prefix}/`) && !p.slice(prefix.length + 1).includes("/"));
            return { data: inFolder.slice(0, 100).map((p) => ({ id: p, name: p.slice(prefix.length + 1) })), error: null };
          },
          async remove(paths) {
            files[bucket] = (files[bucket] || []).filter((p) => !paths.includes(p));
            calls.push({ bucket, op: "remove", paths });
            return { data: paths, error: null };
          },
        };
      },
    },
  };
}

const quietLog = { info() {}, error() {} };

function seed({ requestedDaysAgo = 31 } = {}) {
  return {
    profiles: [
      { wallet_address: ALICE, email: "alice@example.com", display_name: "Alice", bio: "hi", avatar_url: "a.jpg",
        deletion_requested_at: requestedDaysAgo == null ? null : daysAgo(requestedDaysAgo), account_deleted_at: null,
        is_banned: false, reward_credits: 5 },
      { wallet_address: BOB, email: "bob@example.com", display_name: "Bob", deletion_requested_at: null, account_deleted_at: null },
    ],
    currents: [
      { id: 1, author_wallet: ALICE.toLowerCase() },
      { id: 2, author_wallet: BOB },
    ],
    comments: [{ id: 1, author_wallet: ALICE }, { id: 2, author_wallet: BOB }],
    follows: [
      { follower_wallet: ALICE, target_wallet: BOB },
      { follower_wallet: BOB, target_wallet: ALICE.toLowerCase() },
      { follower_wallet: BOB, target_wallet: "0x1234567890123456789012345678901234567890" },
    ],
    aquadex_tanks: [{ id: "t1", owner_address: ALICE.toLowerCase() }, { id: "t2", owner_address: BOB }],
    aquadex_listings: [{ id: 1, seller_address: ALICE.toLowerCase(), is_active: true }, { id: 2, seller_address: BOB, is_active: true }],
    tides: [{ id: "tide1", host_wallet: ALICE }],
    seller_stripe_accounts: [{ wallet_address: ALICE.toLowerCase(), stripe_account_id: "acct_1", email: "alice@example.com" }],
    api_keys: [{ id: 1, owner_email: "ALICE@example.com" }, { id: 2, owner_email: "bob@example.com" }],
    // Accounting records: must survive untouched.
    orders: [{ id: "o1", buyer_wallet: ALICE.toLowerCase(), buyer_email: "alice@example.com" }],
    auction_settlements: [{ id: "s1", seller_wallet: ALICE.toLowerCase() }],
    credit_transactions: [{ id: 1, wallet_address: ALICE }],
    showcase_owner_wallets: [],
  };
}

const storageSeed = () => ({
  "reef-media": [
    `reef/${ALICE.slice(0, 10)}/1-post.jpg`,
    `reef/${ALICE.slice(0, 10).toLowerCase()}/2-avatar.jpg`,
    `reef/${BOB.slice(0, 10)}/3-bob.jpg`,
  ],
  "specimen-photos": [`${ALICE.slice(0, 10).toLowerCase()}/7_1.jpg`],
  "specimen-metadata": [`${ALICE.toLowerCase()}/7.json`, `${BOB}/8.json`],
});

// ── The plan itself ──────────────────────────────────────────────────────────

describe("PURGE_PLAN is a conservative, reviewed list", () => {
  const touched = new Set(PURGE_PLAN.map((s) => s.table));
  const deleted = new Set(PURGE_PLAN.filter((s) => s.op === "delete").map((s) => s.table));

  it("never touches accounting, payment, auction-result or moderation records", () => {
    for (const t of [
      "orders", "canonical_orders", "canonical_order_line_items", "canonical_order_ledger", "canonical_order_transitions",
      "fiat_settlements", "auction_settlements", "auction_desk_payments", "auction_bids", "auction_lot_bids",
      "auctions", "auction_bidders", "shipping_label_purchases", "inventory_sale_events",
      "promotion_redemptions", "pickup_arrangements", "canonical_doa_claims", "credit_transactions",
      "reward_distributions", "reward_pool_ledger", "moderation_flags", "review_reports",
    ]) {
      expect(touched.has(t), `${t} must not be in the purge plan`).toBe(false);
    }
  });

  it("only moves offers and auction lots out of an open status, never deletes them", () => {
    const steps = PURGE_PLAN.filter((s) => s.table === "marketplace_offers" || s.table === "auction_lots");
    expect(steps).toHaveLength(3);
    for (const s of steps) {
      expect(s.op).not.toBe("delete");
      // Every step is narrowed to open statuses, so closed/accepted/sold rows are never rewritten.
      expect(Array.isArray(s.where?.status) && s.where.status.length > 0).toBe(true);
    }
    const byColumn = Object.fromEntries(steps.map((s) => [`${s.table}.${s.column}`, s]));
    expect(byColumn["marketplace_offers.buyer_wallet"]).toMatchObject({
      op: "update", where: { status: ["pending", "countered"] }, set: { status: "withdrawn" },
    });
    expect(byColumn["marketplace_offers.seller_wallet"]).toMatchObject({
      op: "update", where: { status: ["pending", "countered"] }, set: { status: "declined" }, stampNow: ["responded_at"],
    });
    // Lots go through the owner's own cancel function, and only lots nobody bid on.
    expect(byColumn["auction_lots.seller_wallet"]).toMatchObject({
      op: "rpc", rpc: "cancel_auction_lot", where: { status: ["live", "pending_approval"], bid_count: 0 },
    });
  });

  it("cancels lots before switching listings off (returned stock would switch them back on)", () => {
    const cancel = PURGE_PLAN.findIndex((s) => s.rpc === "cancel_auction_lot");
    const listings = PURGE_PLAN.findIndex((s) => s.table === "aquadex_listings");
    expect(cancel).toBeGreaterThan(-1);
    expect(cancel).toBeLessThan(listings);
  });

  it("defers, rather than acts on, every case with money or a binding bid in flight", () => {
    const holds = PURGE_HOLDS.map((h) => `${h.table}.${h.column}`);
    for (const key of [
      "auctions.host_wallet", "auction_lots.seller_wallet", "auction_lots.high_bidder_wallet", "auction_lots.winner_wallet",
      "auction_settlements.winner_wallet", "auction_settlements.seller_wallet", "auction_bids.bidder_wallet", "tides.host_wallet",
    ]) {
      expect(holds, key).toContain(key);
    }
    for (const h of PURGE_HOLDS) expect(h.reason.length).toBeGreaterThan(10);
  });

  it("never deletes rows whose delete would cascade into records we keep", () => {
    // profiles -> auction_settlements CASCADE; tides -> auction_bids/settlements CASCADE;
    // seller_promotions -> promotion_redemptions CASCADE.
    expect(deleted.has("profiles")).toBe(false);
    expect(deleted.has("tides")).toBe(false);
    expect(deleted.has("seller_promotions")).toBe(false);
    expect(deleted.has("aquadex_listings")).toBe(false);
  });

  it("switches listings off instead of deleting them", () => {
    const step = PURGE_PLAN.find((s) => s.table === "aquadex_listings");
    expect(step).toMatchObject({ op: "update", set: { is_active: false } });
  });

  it("uses the same grace period as the Settings copy", () => {
    expect(PURGE_GRACE_DAYS).toBe(30);
    expect(DELETION_GRACE_DAYS).toBe(PURGE_GRACE_DAYS);
    expect(DELETION_KEPT.join(" ")).toMatch(/Orders, payments/);
    expect(DELETION_KEPT.join(" ")).toMatch(/listings, switched off/);
    expect(DELETION_REMOVED.join(" ")).toMatch(/email/);
  });

  it("tells the user what happens to offers and auctions", () => {
    const kept = DELETION_KEPT.join(" ");
    // Offers: kept, open ones withdrawn (made) or declined (received).
    expect(kept).toMatch(/Offers you made or received/);
    expect(kept).toMatch(/withdrawn or declined/);
    // Auctions: unbid lots cancelled; anything in flight waits.
    expect(kept).toMatch(/Lots with no bids are cancelled/);
    expect(kept).toMatch(/we wait for it to finish/);
    // Offers and auction data are never promised as deleted.
    expect(DELETION_REMOVED.join(" ")).not.toMatch(/offer|auction|bid/i);
    // House copy style.
    for (const line of [...DELETION_KEPT, ...DELETION_REMOVED]) {
      expect(line).not.toMatch(/[\u2014!]/);
    }
  });

  it("escapes LIKE metacharacters so ilike is an exact match", () => {
    expect(likeExact("a_b%c\\d")).toBe("a\\_b\\%c\\\\d");
  });
});

// ── Behaviour against the fake client ───────────────────────────────────────

describe("purgeDueAccounts", () => {
  it("purges a request older than 30 days and leaves everyone else alone", async () => {
    const sb = fakeSupabase(seed(), { storage: storageSeed() });
    const result = await purgeDueAccounts(sb, { now: NOW, log: quietLog });

    expect(result).toMatchObject({ due: 1, purged: 1, failed: 0, needsManualReview: 0 });
    const t = sb.tables;

    // Alice's social + tank data is gone, matched case-insensitively.
    expect(t.currents.map((r) => r.id)).toEqual([2]);
    expect(t.comments.map((r) => r.id)).toEqual([2]);
    expect(t.follows).toEqual([{ follower_wallet: BOB, target_wallet: "0x1234567890123456789012345678901234567890" }]);
    expect(t.aquadex_tanks.map((r) => r.id)).toEqual(["t2"]);
    expect(t.api_keys.map((r) => r.id)).toEqual([2]);

    // Deactivated / unlinked, not deleted.
    expect(t.aquadex_listings).toEqual([
      { id: 1, seller_address: ALICE.toLowerCase(), is_active: false },
      { id: 2, seller_address: BOB, is_active: true },
    ]);
    expect(t.tides).toEqual([{ id: "tide1", host_wallet: null }]);
    expect(t.seller_stripe_accounts[0]).toMatchObject({ stripe_account_id: "acct_1", email: null });

    // Accounting records untouched.
    expect(t.orders).toEqual(seed().orders);
    expect(t.auction_settlements).toEqual(seed().auction_settlements);
    expect(t.credit_transactions).toEqual(seed().credit_transactions);

    // Profile kept as an anonymized, closed marker; moderation fields kept.
    const alice = t.profiles.find((p) => p.wallet_address === ALICE);
    expect(alice).toMatchObject({
      display_name: null, bio: null, avatar_url: null, email: null,
      deletion_requested_at: null, account_deleted_at: NOW.toISOString(),
      is_banned: false, reward_credits: 5,
    });
    const bob = t.profiles.find((p) => p.wallet_address === BOB);
    expect(bob).toMatchObject({ display_name: "Bob", email: "bob@example.com" });

    // Storage: Alice's folders emptied (both casings), Bob's untouched.
    expect(sb.files["reef-media"]).toEqual([`reef/${BOB.slice(0, 10)}/3-bob.jpg`]);
    expect(sb.files["specimen-photos"]).toEqual([]);
    expect(sb.files["specimen-metadata"]).toEqual([`${BOB}/8.json`]);

    // Summary carries counts, a shortened wallet, and never an email.
    const summary = JSON.stringify(result);
    expect(summary).not.toMatch(/example\.com/);
    expect(summary).not.toContain(ALICE);
    expect(result.accounts[0].filesRemoved).toBe(4);
  });

  it("does nothing for a request inside the grace period", async () => {
    const sb = fakeSupabase(seed({ requestedDaysAgo: PURGE_GRACE_DAYS - 1 }), { storage: storageSeed() });
    const result = await purgeDueAccounts(sb, { now: NOW, log: quietLog });
    expect(result.due).toBe(0);
    expect(sb.calls).toEqual([]);
    expect(sb.tables.currents).toHaveLength(2);
  });

  it("is idempotent: a second run finds nothing to do", async () => {
    const sb = fakeSupabase(seed(), { storage: storageSeed() });
    await purgeDueAccounts(sb, { now: NOW, log: quietLog });
    const snapshot = structuredClone(sb.tables);
    const callsAfterFirst = sb.calls.length;

    const second = await purgeDueAccounts(sb, { now: new Date(NOW.getTime() + DAY), log: quietLog });
    expect(second).toMatchObject({ due: 0, purged: 0 });
    expect(sb.tables).toEqual(snapshot);
    expect(sb.calls.length).toBe(callsAfterFirst);
  });

  it("lets a cancel that lands during the run win", async () => {
    const sb = fakeSupabase(seed(), { storage: storageSeed() });
    // Simulate: the due query saw the request, then the owner cancelled.
    const realFrom = sb.from;
    let dueQueried = false;
    sb.from = (table) => {
      if (table === "profiles" && dueQueried) {
        sb.tables.profiles.find((p) => p.wallet_address === ALICE).deletion_requested_at = null;
      }
      if (table === "profiles") dueQueried = true;
      return realFrom(table);
    };
    const result = await purgeDueAccounts(sb, { now: NOW, log: quietLog });
    expect(result).toMatchObject({ due: 1, purged: 0, skipped: 1 });
    expect(sb.tables.currents).toHaveLength(2);
  });

  it("leaves the request in place when a step fails, so the next run retries", async () => {
    const sb = fakeSupabase(seed(), { failTable: "comments", storage: storageSeed() });
    const result = await purgeDueAccounts(sb, { now: NOW, log: quietLog });
    expect(result).toMatchObject({ due: 1, purged: 0, failed: 1 });
    expect(result.accounts[0].errors.join(" ")).toMatch(/comments\.author_wallet: boom/);
    const alice = sb.tables.profiles.find((p) => p.wallet_address === ALICE);
    expect(alice.deletion_requested_at).not.toBeNull();
    expect(alice.account_deleted_at).toBeNull();
    expect(alice.email).toBe("alice@example.com");
  });

  it("holds Fish Room owners for manual review instead of closing the account", async () => {
    const data = seed();
    data.showcase_owner_wallets = [{ owner_id: "own_1", normalized_wallet_address: ALICE.toLowerCase() }];
    const sb = fakeSupabase(data, { storage: storageSeed() });
    const result = await purgeDueAccounts(sb, { now: NOW, log: quietLog });
    expect(result).toMatchObject({ due: 1, purged: 0, needsManualReview: 1 });
    const alice = sb.tables.profiles.find((p) => p.wallet_address === ALICE);
    expect(alice.deletion_requested_at).not.toBeNull();
    expect(result.accounts[0].manual[0]).toMatch(/showcase/);
  });

  it("never empties a 10-character storage folder another profile shares", async () => {
    const data = seed();
    const twin = `${ALICE.slice(0, 10).toLowerCase()}${"0".repeat(32)}`;
    data.profiles.push({ wallet_address: twin, deletion_requested_at: null });
    const sb = fakeSupabase(data, { storage: storageSeed() });
    const result = await purgeDueAccounts(sb, { now: NOW, log: quietLog });
    expect(result.purged).toBe(1);
    expect(sb.files["reef-media"]).toHaveLength(3);
    expect(sb.files["specimen-photos"]).toHaveLength(1);
    // The full-wallet metadata folder is not shared and is still removed.
    expect(sb.files["specimen-metadata"]).toEqual([`${BOB}/8.json`]);
  });
});

// ── Offers and auctions ─────────────────────────────────────────────────────

const alice = ALICE.toLowerCase(); // offers/auction tables store lowercase (enforce_lower_wallets / check constraints)
const bob = BOB.toLowerCase();

function lot(overrides) {
  return {
    id: "lot", auction_id: "auc", seller_wallet: bob, status: "live", source: "freeform", listing_id: null,
    stock_moved: false, bid_count: 0, high_bidder_wallet: null, winner_wallet: null, hammer_cents: null, closed_at: null,
    ...overrides,
  };
}

const writes = (sb) => sb.calls.filter((c) => c.op !== "remove");

describe("purgeDueAccounts: offers", () => {
  it("withdraws open offers the account made and declines open offers it received, keeping every row", async () => {
    const data = seed();
    data.marketplace_offers = [
      { id: "made-pending", buyer_wallet: alice, seller_wallet: bob, status: "pending", responded_at: null },
      { id: "made-countered", buyer_wallet: alice, seller_wallet: bob, status: "countered", responded_at: "earlier" },
      { id: "made-accepted", buyer_wallet: alice, seller_wallet: bob, status: "accepted", responded_at: "earlier" },
      { id: "got-pending", buyer_wallet: bob, seller_wallet: alice, status: "pending", responded_at: null },
      { id: "got-declined", buyer_wallet: bob, seller_wallet: alice, status: "declined", responded_at: "earlier" },
      { id: "bob-only", buyer_wallet: bob, seller_wallet: "0x1234567890123456789012345678901234567890", status: "pending", responded_at: null },
    ];
    const sb = fakeSupabase(data, { storage: storageSeed() });
    const result = await purgeDueAccounts(sb, { now: NOW, log: quietLog });

    expect(result).toMatchObject({ purged: 1, deferred: 0 });
    const byId = Object.fromEntries(sb.tables.marketplace_offers.map((o) => [o.id, o]));
    expect(sb.tables.marketplace_offers).toHaveLength(6);
    expect(byId["made-pending"]).toMatchObject({ status: "withdrawn", responded_at: null });
    expect(byId["made-countered"]).toMatchObject({ status: "withdrawn", responded_at: "earlier" });
    expect(byId["got-pending"]).toMatchObject({ status: "declined", responded_at: NOW.toISOString() });
    // Settled offers and other people's offers are untouched.
    expect(byId["made-accepted"]).toEqual(data.marketplace_offers[2]);
    expect(byId["got-declined"]).toEqual(data.marketplace_offers[4]);
    expect(byId["bob-only"]).toEqual(data.marketplace_offers[5]);
    expect(result.accounts[0].byTable).toEqual(expect.arrayContaining([
      "update marketplace_offers.buyer_wallet: 2",
      "update marketplace_offers.seller_wallet: 1",
    ]));
  });
});

describe("purgeDueAccounts: auction lots the account sells", () => {
  it("cancels unbid lots through cancel_auction_lot, then switches the restocked listing off", async () => {
    const data = seed();
    data.aquadex_listings.push({ id: "batch1", seller_address: alice, is_active: false });
    data.auction_lots = [
      lot({ id: "live-nobids", seller_wallet: alice, source: "batch_listing", listing_id: "batch1", stock_moved: true }),
      lot({ id: "pending", seller_wallet: alice, status: "pending_approval" }),
      lot({ id: "done-unsold", seller_wallet: alice, status: "unsold", closed_at: "earlier" }),
      lot({ id: "done-handed", seller_wallet: alice, status: "handed_off", winner_wallet: bob, hammer_cents: 500 }),
      lot({ id: "bobs", seller_wallet: bob }),
    ];
    const sb = fakeSupabase(data, { storage: storageSeed() });
    const result = await purgeDueAccounts(sb, { now: NOW, log: quietLog });

    expect(result).toMatchObject({ purged: 1, deferred: 0 });
    const byId = Object.fromEntries(sb.tables.auction_lots.map((l) => [l.id, l]));
    expect(sb.tables.auction_lots).toHaveLength(5);
    expect(byId["live-nobids"]).toMatchObject({ status: "cancelled", stock_moved: false });
    expect(byId.pending.status).toBe("cancelled");
    expect(byId["done-unsold"]).toEqual(data.auction_lots[2]);
    expect(byId["done-handed"]).toEqual(data.auction_lots[3]);
    expect(byId.bobs).toEqual(data.auction_lots[4]);

    // Only through the function, with the lowercase seller it checks against.
    const rpcCalls = sb.calls.filter((c) => c.op === "rpc");
    expect(rpcCalls.map((c) => c.args)).toEqual([
      { p_lot: "live-nobids", p_seller: alice },
      { p_lot: "pending", p_seller: alice },
    ]);
    expect(sb.calls.some((c) => c.table === "auction_lots" && c.op !== "select")).toBe(false);

    // Stock came back to the listing (switching it on); the listings step ran after and switched it off.
    expect(sb.tables.aquadex_listings.find((l) => l.id === "batch1").is_active).toBe(false);
    expect(result.accounts[0].byTable).toContain("rpc auction_lots.seller_wallet: 2");
  });

  it("fails the run and keeps the request when cancel_auction_lot refuses (a bid landed)", async () => {
    const data = seed();
    data.auction_lots = [lot({ id: "l1", seller_wallet: alice })];
    // A bid arrives between the step's select and the cancel call.
    const sb = fakeSupabase(data, {
      storage: storageSeed(),
      onRpc: ({ tables }) => {
        Object.assign(tables.auction_lots[0], { bid_count: 1, high_bidder_wallet: bob, high_bid_cents: 500 });
      },
    });
    const result = await purgeDueAccounts(sb, { now: NOW, log: quietLog });
    expect(result).toMatchObject({ purged: 0, failed: 1 });
    expect(result.accounts[0].errors.join(" ")).toMatch(/cancel_auction_lot\(l1\): cancel refused: this lot has bids/);
    expect(sb.tables.auction_lots[0].status).toBe("live");
    const profile = sb.tables.profiles.find((p) => p.wallet_address === ALICE);
    expect(profile.deletion_requested_at).not.toBeNull();
    expect(profile.account_deleted_at).toBeNull();

    // Next day the hold sees the bid and defers without writing anything.
    const callsBefore = sb.calls.length;
    const next = await purgeDueAccounts(sb, { now: new Date(NOW.getTime() + DAY), log: quietLog });
    expect(next).toMatchObject({ deferred: 1, purged: 0, failed: 0 });
    expect(next.accounts[0].deferred.join(" ")).toMatch(/live auction lot that has bids/);
    expect(sb.calls.length).toBe(callsBefore);
  });
});

describe("purgeDueAccounts: defers accounts with money or a binding bid in flight", () => {
  const cases = [
    ["hosts an open club auction", { auctions: [{ id: "a1", host_type: "club", host_wallet: alice, status: "live" }] }, /open club auction/],
    ["hosts a draft club auction", { auctions: [{ id: "a1", host_type: "club", host_wallet: alice, status: "draft" }] }, /open club auction/],
    ["sells a live lot with bids", { auction_lots: [lot({ seller_wallet: alice, bid_count: 2, high_bidder_wallet: bob })] }, /has bids/],
    ...["awaiting_live", "sold_live", "ended", "charging", "payment_failed", "paid"].map((status) => [
      `sells a lot in status ${status}`,
      { auction_lots: [lot({ seller_wallet: alice, status, winner_wallet: status === "awaiting_live" ? null : bob })] },
      /payment or handoff not finished/,
    ]),
    ["holds the high bid on a live lot", { auction_lots: [lot({ high_bidder_wallet: alice, bid_count: 1 })] }, /standing high bid/],
    ["holds the online high bid on a lot waiting for the room", { auction_lots: [lot({ status: "awaiting_live", high_bidder_wallet: alice, bid_count: 1 })] }, /standing high bid/],
    ...["ended", "charging", "payment_failed", "sold_live", "paid"].map((status) => [
      `won a lot in status ${status}`,
      { auction_lots: [lot({ status, winner_wallet: alice, high_bidder_wallet: alice, hammer_cents: 900 })] },
      /won an auction lot/,
    ]),
    ["won an event auction lot awaiting payment", { auction_settlements: [{ id: "s", seller_wallet: bob, winner_wallet: alice, status: "awaiting_payment" }] }, /awaiting payment/],
    ["sold an event auction lot not yet paid out", { auction_settlements: [{ id: "s", seller_wallet: alice, winner_wallet: bob, status: "paid" }] }, /payout is not finished/],
    ["holds an active event auction bid", { auction_bids: [{ id: "b", bidder_wallet: alice, status: "active" }] }, /active bid in an event auction/],
    ["hosts an upcoming event with auction lots", { tides: [{ id: "t", host_wallet: ALICE, status: "upcoming", settings: { auction_items: [{ token_id: 1 }] } }] }, /open event with auction lots/],
  ];

  for (const [name, extra, reason] of cases) {
    it(`${name}: nothing is written, the request stays, the reason is logged`, async () => {
      const data = { ...seed(), marketplace_offers: [{ id: "o", buyer_wallet: alice, seller_wallet: bob, status: "pending" }], ...extra };
      const sb = fakeSupabase(data, { storage: storageSeed() });
      const lines = [];
      const result = await purgeDueAccounts(sb, { now: NOW, log: { info: (...a) => lines.push(a.join(" ")), error() {} } });

      expect(result).toMatchObject({ due: 1, purged: 0, deferred: 1, failed: 0 });
      expect(result.accounts[0].status).toBe("deferred");
      expect(result.accounts[0].deferred.join(" ")).toMatch(reason);
      expect(writes(sb)).toEqual([]);
      for (const [table, rows] of Object.entries(data)) expect(sb.tables[table], table).toEqual(rows);
      expect(sb.files).toEqual(storageSeed());
      expect(lines.join(" ")).toMatch(reason);
      expect(lines.join(" ")).not.toContain(ALICE);
    });
  }

  it("does not defer for finished auctions or for bids that were outbid", async () => {
    const data = seed();
    data.auctions = [{ id: "a1", host_type: "club", host_wallet: alice, status: "ended" }];
    data.auction_lots = [
      lot({ id: "outbid", bid_count: 2, high_bidder_wallet: bob }), // Alice bid earlier and was outbid
      lot({ id: "won-done", status: "handed_off", winner_wallet: alice, hammer_cents: 900 }),
      lot({ id: "sold-refunded", seller_wallet: alice, status: "refunded", winner_wallet: bob, hammer_cents: 900 }),
    ];
    data.auction_lot_bids = [{ id: "lb", lot_id: "outbid", bidder_wallet: alice, amount_cents: 500 }];
    data.auction_settlements.push({ id: "s2", seller_wallet: alice, winner_wallet: bob, status: "transferred" });
    data.auction_bids = [{ id: "b", bidder_wallet: alice, status: "outbid" }, { id: "b2", bidder_wallet: alice, status: "won" }];
    data.tides[0] = { ...data.tides[0], status: "ended", settings: { auction_items: [{ token_id: 1 }] } };
    const sb = fakeSupabase(data, { storage: storageSeed() });
    const result = await purgeDueAccounts(sb, { now: NOW, log: quietLog });

    expect(result).toMatchObject({ purged: 1, deferred: 0 });
    // Auction records are kept exactly as they were.
    expect(sb.tables.auction_lots).toEqual(data.auction_lots);
    expect(sb.tables.auction_lot_bids).toEqual(data.auction_lot_bids);
    expect(sb.tables.auction_bids).toEqual(data.auction_bids);
    expect(sb.tables.auction_settlements).toEqual(data.auction_settlements);
    expect(sb.tables.auctions).toEqual(data.auctions);
  });

  it("re-checks before closing: a bid on the account's lot during the run keeps the lot live and the account open", async () => {
    const data = seed();
    data.auction_lots = [lot({ id: "l1", seller_wallet: alice })];
    const sb = fakeSupabase(data, {
      storage: storageSeed(),
      onWrite: ({ table, tables }) => {
        if (table === "reactions") Object.assign(tables.auction_lots[0], { bid_count: 1, high_bidder_wallet: bob });
      },
    });
    const result = await purgeDueAccounts(sb, { now: NOW, log: quietLog });
    expect(result).toMatchObject({ purged: 0, deferred: 1, failed: 0 });
    expect(sb.tables.auction_lots[0].status).toBe("live");
    expect(sb.calls.some((c) => c.op === "rpc")).toBe(false);
    expect(sb.tables.profiles.find((p) => p.wallet_address === ALICE).account_deleted_at).toBeNull();
  });

  it("re-checks before closing: a win recorded during the run keeps the account open", async () => {
    const data = seed();
    const sb = fakeSupabase(data, {
      storage: storageSeed(),
      onWrite: ({ table, tables }) => {
        if (table === "api_keys") {
          tables.auction_lots = [lot({ id: "late", status: "ended", winner_wallet: alice, high_bidder_wallet: alice, hammer_cents: 700 })];
        }
      },
    });
    const result = await purgeDueAccounts(sb, { now: NOW, log: quietLog });
    expect(result).toMatchObject({ purged: 0, deferred: 1 });
    expect(result.accounts[0].deferred.join(" ")).toMatch(/won an auction lot/);
    const profile = sb.tables.profiles.find((p) => p.wallet_address === ALICE);
    expect(profile.deletion_requested_at).not.toBeNull();
    expect(profile.account_deleted_at).toBeNull();
  });

  it("closes the account on the first run after the hold clears", async () => {
    const data = seed();
    data.auction_lots = [lot({ id: "w", status: "ended", winner_wallet: alice, high_bidder_wallet: alice, hammer_cents: 700 })];
    const sb = fakeSupabase(data, { storage: storageSeed() });
    expect(await purgeDueAccounts(sb, { now: NOW, log: quietLog })).toMatchObject({ deferred: 1, purged: 0 });

    sb.tables.auction_lots[0].status = "handed_off";
    const next = await purgeDueAccounts(sb, { now: new Date(NOW.getTime() + DAY), log: quietLog });
    expect(next).toMatchObject({ deferred: 0, purged: 1 });
    expect(sb.tables.auction_lots[0]).toMatchObject({ status: "handed_off", winner_wallet: alice });
  });

  it("a deferred account does not use up the per-run cap", async () => {
    const CAROL = "0x7777777777777777777777777777777777777777";
    const data = seed();
    data.profiles.push({ wallet_address: CAROL, email: "carol@example.com", display_name: "Carol",
      deletion_requested_at: daysAgo(31 - 0.5), account_deleted_at: null }); // newer than Alice's
    data.auction_lots = [lot({ high_bidder_wallet: alice, bid_count: 1 })];
    const sb = fakeSupabase(data, { storage: storageSeed() });
    const result = await purgeDueAccounts(sb, { now: NOW, maxAccounts: 1, log: quietLog });
    expect(result).toMatchObject({ due: 2, deferred: 1, purged: 1 });
    expect(sb.tables.profiles.find((p) => p.wallet_address === CAROL).account_deleted_at).toBe(NOW.toISOString());
  });

  it("treats a failed hold check as a failure, not a pass", async () => {
    const data = seed();
    const sb = fakeSupabase(data, { storage: storageSeed() });
    const realFrom = sb.from;
    sb.from = (table) => {
      const b = realFrom(table);
      if (table !== "auction_lots") return b;
      const fail = { data: null, error: { message: "timeout", code: "57014" } };
      const chain = new Proxy(b, {
        get(target, prop) {
          if (prop === "then") return (res, rej) => Promise.resolve(fail).then(res, rej);
          const v = target[prop];
          return typeof v === "function" ? (...args) => { v.apply(target, args); return chain; } : v;
        },
      });
      return chain;
    };
    const result = await purgeDueAccounts(sb, { now: NOW, log: quietLog });
    expect(result).toMatchObject({ purged: 0, failed: 1, deferred: 0 });
    expect(result.accounts[0].errors.join(" ")).toMatch(/hold check auction_lots\.\w+: timeout/);
    expect(writes(sb)).toEqual([]);
  });
});

describe("the purge is wired to a cron-gated action", () => {
  const read = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");

  it("dispatches purge-deletions after the CRON_SECRET gate", () => {
    const retention = read("../../api/retention.js");
    const gate = retention.indexOf("if (!isCronRequest(req))");
    const action = retention.indexOf('req.query?.action === "purge-deletions"');
    expect(gate).toBeGreaterThan(-1);
    expect(action).toBeGreaterThan(gate);
    expect(retention).toMatch(/await import\("\.\/_lib\/accountPurge\.js"\)/);
  });

  it("is scheduled daily in vercel.json", () => {
    const vercel = JSON.parse(read("../../vercel.json"));
    expect(vercel.crons.map((c) => c.path)).toContain("/api/retention?action=purge-deletions");
  });
});
