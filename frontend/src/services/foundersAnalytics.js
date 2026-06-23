/**
 * foundersAnalytics.js
 *
 * Analytics service for the Founders Dashboard.
 * Aggregates platform metrics from Supabase, on-chain data, and API health checks.
 *
 * All functions are designed to degrade gracefully — if Supabase isn't configured
 * or a table doesn't exist yet, they return sensible defaults so the dashboard
 * renders without errors.
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

// ─────────────────────────────────────────────────────────────────────────────
// KPI METRICS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Total registered users (profiles count).
 */
export async function getTotalUsers() {
  const data = await safeQuery(() =>
    supabase.from("profiles").select("*", { count: "exact", head: true })
  );
  // When using head: true, count comes from the response headers
  if (!isSupabaseConfigured()) return 0;
  try {
    const { count, error } = await supabase
      .from("profiles")
      .select("*", { count: "exact", head: true });
    if (error) return 0;
    return count || 0;
  } catch {
    return 0;
  }
}

/**
 * Daily Active Users — profiles that have been active today.
 * Falls back to counting profiles updated in the last 24h.
 */
export async function getDAU() {
  if (!isSupabaseConfigured()) return 0;
  try {
    const { count, error } = await supabase
      .from("profiles")
      .select("*", { count: "exact", head: true })
      .gte("updated_at", startOfDay());
    if (error) return 0;
    return count || 0;
  } catch {
    return 0;
  }
}

/**
 * Total specimens minted (from specimens or profiles aggregate).
 */
export async function getTotalSpecimens() {
  if (!isSupabaseConfigured()) return 0;
  try {
    const { count, error } = await supabase
      .from("specimens")
      .select("*", { count: "exact", head: true });
    if (error) {
      // Fallback: sum species_count from profiles
      const { data } = await supabase
        .from("profiles")
        .select("species_count");
      if (data) {
        return data.reduce((sum, p) => sum + (p.species_count || 0), 0);
      }
      return 0;
    }
    return count || 0;
  } catch {
    return 0;
  }
}

/**
 * Marketplace GMV — sum of completed order amounts.
 */
export async function getMarketplaceGMV() {
  if (!isSupabaseConfigured()) return 0;
  try {
    const { data, error } = await supabase
      .from("market_orders")
      .select("amount")
      .eq("status", "completed");
    if (error || !data) return 0;
    return data.reduce((sum, o) => sum + (parseFloat(o.amount) || 0), 0);
  } catch {
    return 0;
  }
}

/**
 * Protocol fees collected (from a protocol_fees table or contract reads).
 */
export async function getProtocolFees() {
  if (!isSupabaseConfigured()) return 0;
  try {
    const { data, error } = await supabase
      .from("protocol_fees")
      .select("amount");
    if (error || !data) return 0;
    return data.reduce((sum, f) => sum + (parseFloat(f.amount) || 0), 0);
  } catch {
    return 0;
  }
}

/**
 * Live activity — count of active tank cams and tide streams.
 */
export async function getLiveActivity() {
  if (!isSupabaseConfigured()) return 0;
  try {
    const { count: cams } = await supabase
      .from("tank_cams")
      .select("*", { count: "exact", head: true })
      .eq("status", "active");
    const { count: tides } = await supabase
      .from("tide_streams")
      .select("*", { count: "exact", head: true })
      .eq("status", "live");
    return (cams || 0) + (tides || 0);
  } catch {
    return 0;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// TIME SERIES DATA (Charts)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * User growth over the last N days — returns array of { date, users }.
 */
export async function getUserGrowth(days = 30) {
  if (!isSupabaseConfigured()) return generateMockTimeSeries(days, "users", 50, 200);
  try {
    const { data, error } = await supabase
      .from("profiles")
      .select("created_at")
      .gte("created_at", daysAgo(days))
      .order("created_at", { ascending: true });

    if (error || !data || data.length === 0) {
      return generateMockTimeSeries(days, "users", 50, 200);
    }

    // Group by date
    const grouped = {};
    data.forEach((row) => {
      const date = row.created_at.slice(0, 10);
      grouped[date] = (grouped[date] || 0) + 1;
    });

    // Build cumulative series
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
  } catch {
    return generateMockTimeSeries(days, "users", 50, 200);
  }
}

/**
 * Protocol activity over the last N days — specimens, spawns, and user operations.
 */
export async function getProtocolActivity(days = 30) {
  if (!isSupabaseConfigured()) return generateMockActivitySeries(days);
  try {
    // Specimens minted per day
    const { data: specData } = await supabase
      .from("specimens")
      .select("created_at")
      .gte("created_at", daysAgo(days));

    // Spawns per day
    const { data: spawnData } = await supabase
      .from("spawns")
      .select("created_at")
      .gte("created_at", daysAgo(days));

    // UserOps (market orders as proxy)
    const { data: opsData } = await supabase
      .from("market_orders")
      .select("created_at")
      .gte("created_at", daysAgo(days));

    if (!specData && !spawnData && !opsData) {
      return generateMockActivitySeries(days);
    }

    // Group by week
    const weeks = {};
    const groupByWeek = (rows, field) => {
      (rows || []).forEach((row) => {
        const d = new Date(row.created_at);
        const weekStart = new Date(d);
        weekStart.setDate(d.getDate() - d.getDay());
        const key = weekStart.toISOString().slice(0, 10);
        if (!weeks[key]) weeks[key] = { week: key, specimens: 0, spawns: 0, userOps: 0 };
        weeks[key][field]++;
      });
    };

    groupByWeek(specData, "specimens");
    groupByWeek(spawnData, "spawns");
    groupByWeek(opsData, "userOps");

    const series = Object.values(weeks).sort((a, b) => a.week.localeCompare(b.week));
    return series.length > 0 ? series : generateMockActivitySeries(days);
  } catch {
    return generateMockActivitySeries(days);
  }
}

/**
 * Social engagement stats for The Reef.
 */
export async function getSocialEngagement() {
  if (!isSupabaseConfigured()) {
    return { posts: 0, reactions: 0, comments: 0, activeUsers: 0 };
  }
  try {
    const { count: posts } = await supabase
      .from("currents")
      .select("*", { count: "exact", head: true });
    const { count: reactions } = await supabase
      .from("reactions")
      .select("*", { count: "exact", head: true });
    const { count: comments } = await supabase
      .from("comments")
      .select("*", { count: "exact", head: true });

    // Active social users (posted in last 7 days)
    const { count: activeUsers } = await supabase
      .from("currents")
      .select("*", { count: "exact", head: true })
      .gte("created_at", daysAgo(7));

    return {
      posts: posts || 0,
      reactions: reactions || 0,
      comments: comments || 0,
      activeUsers: activeUsers || 0,
    };
  } catch {
    return { posts: 0, reactions: 0, comments: 0, activeUsers: 0 };
  }
}

/**
 * AI Poseidon query breakdown — counts by intent type.
 */
export async function getPoseidonStats() {
  if (!isSupabaseConfigured()) {
    return { identify: 42, husbandry: 67, diet: 23, general: 31, total: 163 };
  }
  try {
    const { data, error } = await supabase
      .from("poseidon_queries")
      .select("intent");
    if (error || !data) {
      return { identify: 0, husbandry: 0, diet: 0, general: 0, total: 0 };
    }
    const counts = { identify: 0, husbandry: 0, diet: 0, general: 0 };
    data.forEach((row) => {
      const intent = (row.intent || "general").toLowerCase();
      if (counts[intent] !== undefined) counts[intent]++;
      else counts.general++;
    });
    return { ...counts, total: data.length };
  } catch {
    return { identify: 0, husbandry: 0, diet: 0, general: 0, total: 0 };
  }
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
    { name: "Poseidon AI", endpoint: "/api/poseidon" },
    { name: "Supabase", check: checkSupabaseHealth },
    { name: "Mux Video", endpoint: "/api/tank-cams" },
    { name: "Stripe Connect", endpoint: "/api/create-checkout" },
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
// MOCK DATA GENERATORS (used when Supabase isn't connected yet)
// ─────────────────────────────────────────────────────────────────────────────

function generateMockTimeSeries(days, field, min, max) {
  const series = [];
  let value = Math.floor(Math.random() * (max - min) + min);
  for (let i = days; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    value += Math.floor(Math.random() * 15) - 3;
    if (value < min) value = min;
    series.push({ date: d.toISOString().slice(0, 10), [field]: value });
  }
  return series;
}

function generateMockActivitySeries(days) {
  const series = [];
  const weeks = Math.ceil(days / 7);
  for (let i = weeks; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i * 7);
    series.push({
      week: d.toISOString().slice(0, 10),
      specimens: Math.floor(Math.random() * 80) + 10,
      spawns: Math.floor(Math.random() * 60) + 5,
      userOps: Math.floor(Math.random() * 100) + 20,
    });
  }
  return series;
}

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
