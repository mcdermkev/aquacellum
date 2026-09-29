/**
 * Account purge (/api/retention?action=purge-deletions, api/_lib/accountPurge.js).
 *
 * Runs the real purge logic against an in-memory fake Supabase client. Never
 * touches a live database. Covers: only due requests are purged, matching is
 * case-insensitive and scoped to the one wallet, accounting records are left
 * alone, the profile is kept as an anonymized marker, the run is idempotent,
 * a cancel during the run wins, a failed step leaves the request for the next
 * run, and Fish Room owners are held for manual review.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import {
  PURGE_PLAN,
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

function fakeSupabase(seed, { failTable = null, storage = {} } = {}) {
  const tables = structuredClone(seed);
  const files = structuredClone(storage); // { bucket: ["path/a.jpg", ...] }
  const calls = [];

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

  it("never deletes accounting, payment, auction or moderation records", () => {
    for (const t of [
      "orders", "canonical_orders", "canonical_order_line_items", "canonical_order_ledger", "canonical_order_transitions",
      "fiat_settlements", "auction_settlements", "auction_desk_payments", "auction_bids", "auction_lot_bids",
      "auction_lots", "auctions", "auction_bidders", "shipping_label_purchases", "inventory_sale_events",
      "promotion_redemptions", "pickup_arrangements", "canonical_doa_claims", "credit_transactions",
      "reward_distributions", "reward_pool_ledger", "moderation_flags", "review_reports", "marketplace_offers",
    ]) {
      expect(touched.has(t), `${t} must not be in the purge plan`).toBe(false);
    }
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
