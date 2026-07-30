/**
 * foundersAnalytics.js
 *
 * Analytics service for the Founders Dashboard.
 * Aggregates platform metrics from Supabase and API health checks.
 *
 * ─── `null` MEANS UNKNOWN. IT IS NOT ZERO. ───────────────────────────────────
 *
 * Every metric here returns `null` when it cannot be measured, and the dashboard
 * renders that as "—". This is the central rule of this module, because the
 * previous version broke it in three separate ways
 * (docs/BREEDER_STATE_MODEL.md §9.22):
 *
 *   1. WRONG TABLES. It queried `specimens`, `spawns`, `market_orders`, and
 *      `protocol_fees`. None of those exist. The real ones are
 *      `aquadex_specimens`, `aquadex_spawns`, and `orders` — and the protocol fee
 *      is a COLUMN (`orders.platform_fee_cents`), never a table.
 *   2. ZEROS PRESENTED AS MEASUREMENTS. Each of those queries sat behind a
 *      `return 0` fallback, so the dashboard confidently reported **$0 marketplace
 *      GMV and $0 protocol fees** — indistinguishable from "we made no money".
 *   3. RANDOM NUMBERS PRESENTED AS CHARTS. Both time series fell back to
 *      `Math.random()` generators. Since the underlying tables didn't exist, that
 *      fallback was the normal path, so User Growth and Protocol Activity were
 *      plotting random walks.
 *
 * An empty result is a finding and is returned as such — a flat line at zero is a
 * real answer. Only an unreadable source yields `null`.
 */

import { supabase, isSupabaseConfigured } from "./supabaseClient";

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString();
}

function startOfDay(date = new Date()) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

/**
 * Safe Supabase query wrapper — returns null on error instead of throwing.
 *
 * `null` means "could not be measured" and must be rendered as such. It is NOT
 * interchangeable with 0. See the module header.
 */
async function safeQuery(queryFn) {
  if (!isSupabaseConfigured()) return null;
  try {
    const { data, error } = await queryFn();
    if (error) {
      console.warn("[FoundersAnalytics] Query error:", error.message);
      return null;
    }
    return data;
  } catch (e) {
    console.warn("[FoundersAnalytics] Query exception:", e.message);
    return null;
  }
}

/**
 * Exact row count for a table, or `{ count: null }` when it can't be read.
 * A missing table now yields null — an unknown — rather than a confident 0.
 */
async function safeCount(table, applyFilters = (q) => q) {
  if (!isSupabaseConfigured()) return { count: null };
  try {
    const { count, error } = await applyFilters(
      supabase.from(table).select("*", { count: "exact", head: true })
    );
    if (error) {
      console.warn(`[FoundersAnalytics] count(${table}) failed:`, error.message);
      return { count: null };
    }
    return { count: count ?? 0 };
  } catch (e) {
    console.warn(`[FoundersAnalytics] count(${table}) threw:`, e.message);
    return { count: null };
  }
}

/**
 * Order statuses in which money has actually moved.
 *
 * Copied from the project's own `buyer_order_analytics` view
 * (20260720_canonical_commerce.sql) so revenue figures agree across surfaces
 * rather than each one inventing its own definition of "counts as a sale".
 */
export const SETTLED_ORDER_STATUSES = Object.freeze(["released", "completed", "settled"]);

/** Sum a cents column on `orders` across settled statuses. Null when unreadable. */
async function sumCents(table, column) {
  const rows = await safeQuery(() =>
    supabase.from(table).select(column).in("status", SETTLED_ORDER_STATUSES)
  );
  if (!rows) return null;
  return rows.reduce((sum, r) => sum + (Number(r[column]) || 0), 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// KPI METRICS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Total registered users (profiles count).
 */
export async function getTotalUsers() {
  // Previously ran the same query twice — once through safeQuery, discarding the
  // result, then again inline.
  const { count } = await safeCount("profiles");
  return count;
}

/**
 * Daily Active Users — profiles that have been active today.
 * Falls back to counting profiles updated in the last 24h.
 */
export async function getDAU() {
  const { count } = await safeCount("profiles", (q) => q.gte("updated_at", startOfDay()));
  return count;
}

/**
 * Total specimens registered.
 *
 * Reads `aquadex_specimens` — the cloud mirror of the local-first specimens
 * table. This previously queried a bare `specimens` table that does not exist,
 * then silently fell back to summing `profiles.species_count`, which is a count
 * of distinct SPECIES per user, not specimens. So the "Specimens Minted" KPI was
 * showing a different quantity entirely.
 */
export async function getTotalSpecimens() {
  const { count } = await safeCount("aquadex_specimens");
  return count;
}

/**
 * Marketplace GMV in whole dollars.
 *
 * Reads `orders.total_paid_cents`, filtered to the same settled statuses the
 * project's own `buyer_order_analytics` view uses, so this figure agrees with
 * every other revenue surface.
 *
 * This previously queried `market_orders` (no such table) for an `amount` column
 * (no such column) with `status = 'completed'`, behind a `return 0` fallback — so
 * the dashboard reported **$0 GMV as though it were a measurement**.
 */
export async function getMarketplaceGMV() {
  const cents = await sumCents("orders", "total_paid_cents");
  return cents == null ? null : Math.round(cents / 100);
}

/**
 * Protocol fees collected, in whole dollars.
 *
 * Reads `orders.platform_fee_cents` over the same settled statuses. There is no
 * `protocol_fees` table and never was — the fee is a column on the order.
 */
export async function getProtocolFees() {
  const cents = await sumCents("orders", "platform_fee_cents");
  return cents == null ? null : Math.round(cents / 100);
}

/**
 * Live activity — count of active tank cams and tide streams.
 */
export async function getLiveActivity() {
  const [cams, tides] = await Promise.all([
    safeCount("tank_cams", (q) => q.eq("status", "active")),
    safeCount("tide_streams", (q) => q.eq("status", "live")),
  ]);
  // Unknown only when NEITHER source could be read. If one works, its count is a
  // real partial figure rather than a reason to show nothing.
  if (cams.count == null && tides.count == null) return null;
  return (cams.count || 0) + (tides.count || 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// TIME SERIES DATA (Charts)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * User growth over the last N days — returns array of { date, users }.
 */
export async function getUserGrowth(days = 30) {
  const rows = await safeQuery(() =>
    supabase
      .from("profiles")
      .select("created_at")
      .gte("created_at", daysAgo(days))
      .order("created_at", { ascending: true })
  );
  // Unreadable → null, so the chart renders "no data" instead of noise.
  if (!rows) return null;

  const grouped = {};
  for (const row of rows) {
    if (!row.created_at) continue;
    const date = String(row.created_at).slice(0, 10);
    grouped[date] = (grouped[date] || 0) + 1;
  }

  // A genuinely empty window is a real answer — a flat line at zero — not a
  // reason to invent a curve.
  const series = [];
  let cumulative = 0;
  for (let i = days; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    cumulative += grouped[key] || 0;
    series.push({ date: key, users: cumulative });
  }
  return series;
}

/**
 * Protocol activity over the last N days — specimens, spawns, and user operations.
 */
export async function getProtocolActivity(days = 30) {
  const sinceIso = daysAgo(days);
  const sinceEpoch = Math.floor(new Date(sinceIso).getTime() / 1000);

  const [specRows, spawnRows, orderRows] = await Promise.all([
    // The cloud mirror has no `created_at` column — only `updated_at` — so the
    // registration time lives inside the synced blob as `data.createdAt`.
    // Selected via PostgREST's json operator; if that path ever changes shape,
    // safeQuery degrades this series to null rather than to a fabricated one.
    safeQuery(() =>
      supabase.from("aquadex_specimens").select("createdAt:data->>createdAt")
    ),
    // `aquadex_spawns.event_timestamp` is unix SECONDS (bigint), not a timestamptz,
    // so it is filtered numerically. The old code compared it to an ISO string.
    safeQuery(() =>
      supabase.from("aquadex_spawns").select("event_timestamp").gte("event_timestamp", sinceEpoch)
    ),
    safeQuery(() =>
      supabase.from("orders").select("created_at").gte("created_at", sinceIso)
    ),
  ]);

  // Every source unreadable → unknown. One working source is a real partial view.
  if (!specRows && !spawnRows && !orderRows) return null;

  const weeks = {};
  const bucket = (epochSeconds, field) => {
    if (!Number.isFinite(epochSeconds) || epochSeconds <= 0) return;
    if (epochSeconds < sinceEpoch) return;
    const d = new Date(epochSeconds * 1000);
    const weekStart = new Date(d);
    weekStart.setDate(d.getDate() - d.getDay());
    const key = weekStart.toISOString().slice(0, 10);
    if (!weeks[key]) weeks[key] = { week: key, specimens: 0, spawns: 0, userOps: 0 };
    weeks[key][field] += 1;
  };

  for (const row of specRows || []) bucket(Number(row.createdAt), "specimens");
  for (const row of spawnRows || []) bucket(Number(row.event_timestamp), "spawns");
  for (const row of orderRows || []) {
    bucket(Math.floor(new Date(row.created_at).getTime() / 1000), "userOps");
  }

  // An empty result means no activity in the window. That's a finding.
  return Object.values(weeks).sort((a, b) => a.week.localeCompare(b.week));
}

/**
 * Social engagement stats for The Reef.
 */
export async function getSocialEngagement() {
  const [posts, reactions, comments, activeUsers] = await Promise.all([
    safeCount("currents"),
    safeCount("reactions"),
    safeCount("comments"),
    safeCount("currents", (q) => q.gte("created_at", daysAgo(7))),
  ]);

  return {
    posts: posts.count,
    reactions: reactions.count,
    comments: comments.count,
    activeUsers: activeUsers.count,
  };
}

/**
 * AI Poseidon query breakdown — counts by intent type.
 */
export async function getPoseidonStats() {
  // NOT TRACKED. There is no `poseidon_queries` table anywhere in the schema, and
  // `api/ai.js` does not log query intents, so this metric has no source at all.
  //
  // This used to return a hardcoded `{ identify: 42, husbandry: 67, diet: 23,
  // general: 31, total: 163 }` whenever Supabase was unconfigured, and zeros
  // otherwise — invented figures on a founders dashboard. Returning null makes the
  // absence visible so it either gets instrumented or gets removed from the UI,
  // rather than quietly reading as data.
  const rows = await safeQuery(() => supabase.from("poseidon_queries").select("intent"));
  if (!rows) return null;

  const counts = { identify: 0, husbandry: 0, diet: 0, general: 0 };
  for (const row of rows) {
    const intent = String(row.intent || "general").toLowerCase();
    if (counts[intent] !== undefined) counts[intent] += 1;
    else counts.general += 1;
  }
  return { ...counts, total: rows.length };
}

// ─────────────────────────────────────────────────────────────────────────────
// OPERATIONAL HEALTH
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Check health of backend services.
 * Returns array of { name, status: "healthy"|"degraded"|"down" }.
 */
export async function getOperationalHealth() {
  const checks = [
    { name: "Poseidon AI", endpoint: "/api/ai?action=poseidon" },
    { name: "Supabase", check: checkSupabaseHealth },
    { name: "Mux Video", endpoint: "/api/tank-cams" },
    { name: "Stripe Connect", endpoint: "/api/stripe?action=create-checkout" },
    { name: "Smart Contracts", check: checkContractHealth },
  ];

  const results = await Promise.all(
    checks.map(async (c) => {
      try {
        if (c.check) {
          const status = await c.check();
          return { name: c.name, status };
        }
        const res = await fetch(c.endpoint, { method: "HEAD", signal: AbortSignal.timeout(5000) });
        return { name: c.name, status: res.ok ? "healthy" : "degraded" };
      } catch {
        return { name: c.name, status: "down" };
      }
    })
  );

  return results;
}

async function checkSupabaseHealth() {
  if (!isSupabaseConfigured()) return "down";
  try {
    const { error } = await supabase.from("profiles").select("wallet_address").limit(1);
    return error ? "degraded" : "healthy";
  } catch {
    return "down";
  }
}

async function checkContractHealth() {
  try {
    const res = await fetch(
      `https://sepolia.basescan.org/api?module=proxy&action=eth_blockNumber`
    );
    return res.ok ? "healthy" : "degraded";
  } catch {
    return "down";
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// (The mock data generators that used to live here were DELETED.)
//
// `generateMockTimeSeries` and `generateMockActivitySeries` produced random
// numbers — `Math.random() * 80 + 10` and similar — which were returned whenever
// a query failed or a window came back empty. Because three of the tables being
// queried did not exist, that fallback was the NORMAL path: the Founders
// dashboard's User Growth and Protocol Activity charts were plotting random walks
// and relabelling them as platform metrics.
//
// Fabricated analytics are worse than absent ones — they can't be noticed. This
// is the same call the project already made when it removed fabricated proximity
// discovery from the Local Sellers map (Decision D3, see the retired nav entry in
// App.jsx). Every function here now returns `null` for "could not measure", and
// the dashboard renders that as "—".
// ─────────────────────────────────────────────────────────────────────────────
// AGGREGATE FETCH (single call for the dashboard)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fetch all dashboard data in parallel. Returns a complete state object
 * ready to be consumed by the FoundersDashboard component.
 */
export async function fetchAllDashboardData() {
  const [
    totalUsers,
    dau,
    totalSpecimens,
    marketplaceGMV,
    protocolFees,
    liveActivity,
    userGrowth,
    protocolActivity,
    socialEngagement,
    poseidonStats,
    operationalHealth,
  ] = await Promise.all([
    getTotalUsers(),
    getDAU(),
    getTotalSpecimens(),
    getMarketplaceGMV(),
    getProtocolFees(),
    getLiveActivity(),
    getUserGrowth(30),
    getProtocolActivity(30),
    getSocialEngagement(),
    getPoseidonStats(),
    getOperationalHealth(),
  ]);

  return {
    kpis: {
      totalUsers,
      dau,
      totalSpecimens,
      marketplaceGMV,
      protocolFees,
      liveActivity,
    },
    charts: {
      userGrowth,
      protocolActivity,
    },
    social: socialEngagement,
    poseidon: poseidonStats,
    health: operationalHealth,
  };
}
