/**
 * Founders dashboard analytics (docs/BREEDER_STATE_MODEL.md §9.22).
 *
 * THE BUG, IN THREE LAYERS:
 *   1. It queried `specimens`, `spawns`, `market_orders`, `protocol_fees` — none
 *      of which exist. The real sources are `aquadex_specimens`, `aquadex_spawns`,
 *      and `orders` (the protocol fee is a COLUMN, never a table).
 *   2. Each of those sat behind a `return 0`, so the dashboard reported **$0 GMV
 *      and $0 protocol fees as measurements**.
 *   3. Both charts fell back to `Math.random()` generators. Since the tables
 *      didn't exist, that fallback was the NORMAL path — User Growth and Protocol
 *      Activity were plotting random walks labelled as platform metrics.
 *
 * The rule these tests enforce: `null` means unknown and is never 0, an empty
 * window is a real reading, and nothing is ever invented.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect, beforeEach, vi } from "vitest";

/** Per-table fixtures. `null` marks a table as nonexistent (query errors). */
let tables = {};
const queried = [];

function makeBuilder(table) {
  const rows = tables[table];
  const builder = {
    _filtered: rows,
    select(_cols, opts) {
      queried.push(table);
      // Must be BOTH chainable and awaitable: callers apply `.eq()`/`.gte()`
      // before awaiting, including on count queries.
      if (rows === null || rows === undefined) {
        const err = { message: `relation "${table}" does not exist` };
        return thenable(opts?.count ? { count: null, error: err } : { data: null, error: err });
      }
      return thenable(
        opts?.count ? { count: rows.length, error: null } : { data: rows, error: null }
      );
    },
  };
  return builder;
}

/** A chainable object that resolves to `result` and ignores every filter. */
function thenable(result) {
  const chain = {
    eq: () => chain,
    gte: () => chain,
    in: () => chain,
    order: () => chain,
    limit: () => chain,
    then: (resolve) => Promise.resolve(result).then(resolve),
    catch: () => chain,
  };
  return chain;
}

vi.mock("../services/supabaseClient", () => ({
  isSupabaseConfigured: () => true,
  supabase: { from: (table) => makeBuilder(table) },
}));

const analytics = await import("../services/foundersAnalytics");

beforeEach(() => {
  tables = {};
  queried.length = 0;
});

describe("it reads the tables that actually exist", () => {
  it("counts specimens from aquadex_specimens, not a bare `specimens`", async () => {
    tables["aquadex_specimens"] = [{}, {}, {}];
    expect(await analytics.getTotalSpecimens()).toBe(3);
    expect(queried).toContain("aquadex_specimens");
    expect(queried).not.toContain("specimens");
  });

  it("sums GMV from orders.total_paid_cents", async () => {
    tables["orders"] = [{ total_paid_cents: 2500 }, { total_paid_cents: 7500 }];
    expect(await analytics.getMarketplaceGMV()).toBe(100); // cents → dollars
    expect(queried).toContain("orders");
    expect(queried).not.toContain("market_orders");
  });

  it("sums protocol fees from orders.platform_fee_cents — there is no fees table", async () => {
    tables["orders"] = [{ platform_fee_cents: 400 }, { platform_fee_cents: 600 }];
    expect(await analytics.getProtocolFees()).toBe(10);
    expect(queried).not.toContain("protocol_fees");
  });

  it("uses the project's own settled-status definition", () => {
    // Must match buyer_order_analytics in 20260720_canonical_commerce.sql so
    // revenue figures agree across surfaces.
    expect([...analytics.SETTLED_ORDER_STATUSES]).toEqual(["released", "completed", "settled"]);
  });
});

describe("null means unknown — never zero", () => {
  it("returns null for GMV when orders can't be read", async () => {
    tables["orders"] = null;
    const gmv = await analytics.getMarketplaceGMV();
    expect(gmv).toBeNull();
    expect(gmv).not.toBe(0);
  });

  it("returns null for protocol fees when unreadable", async () => {
    tables["orders"] = null;
    expect(await analytics.getProtocolFees()).toBeNull();
  });

  it("returns null for specimen and user counts when unreadable", async () => {
    tables["aquadex_specimens"] = null;
    tables["profiles"] = null;
    expect(await analytics.getTotalSpecimens()).toBeNull();
    expect(await analytics.getTotalUsers()).toBeNull();
    expect(await analytics.getDAU()).toBeNull();
  });

  it("distinguishes a genuine zero from an unreadable source", async () => {
    tables["orders"] = [];
    expect(await analytics.getMarketplaceGMV()).toBe(0);
    tables["orders"] = null;
    expect(await analytics.getMarketplaceGMV()).toBeNull();
  });

  it("live activity survives one dead source but reports null when both fail", async () => {
    tables["tank_cams"] = [{}, {}];
    tables["tide_streams"] = null;
    expect(await analytics.getLiveActivity()).toBe(2);

    tables["tank_cams"] = null;
    expect(await analytics.getLiveActivity()).toBeNull();
  });

  it("social counts are individually nullable", async () => {
    tables["currents"] = [{}];
    tables["reactions"] = null;
    tables["comments"] = [{}, {}];
    const social = await analytics.getSocialEngagement();
    expect(social.posts).toBe(1);
    expect(social.reactions).toBeNull();
    expect(social.comments).toBe(2);
  });
});

describe("nothing is fabricated", () => {
  it("user growth returns null rather than a random walk", async () => {
    tables["profiles"] = null;
    expect(await analytics.getUserGrowth(7)).toBeNull();
  });

  it("an empty sign-up window yields a real flat series, not an invented curve", async () => {
    tables["profiles"] = [];
    const series = await analytics.getUserGrowth(7);
    expect(Array.isArray(series)).toBe(true);
    expect(series.every((p) => p.users === 0)).toBe(true);
  });

  it("protocol activity returns null when every source is unreadable", async () => {
    tables["aquadex_specimens"] = null;
    tables["aquadex_spawns"] = null;
    tables["orders"] = null;
    expect(await analytics.getProtocolActivity(30)).toBeNull();
  });

  it("protocol activity buckets real rows, reading spawn times as epoch seconds", async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    tables["aquadex_specimens"] = [{ createdAt: String(nowSec) }];
    tables["aquadex_spawns"] = [{ event_timestamp: nowSec }];
    tables["orders"] = [{ created_at: new Date().toISOString() }];

    const series = await analytics.getProtocolActivity(30);
    expect(series).toHaveLength(1);
    expect(series[0].specimens).toBe(1);
    expect(series[0].spawns).toBe(1);
    expect(series[0].userOps).toBe(1);
  });

  it("poseidon stats are null — the metric has no source at all", async () => {
    tables["poseidon_queries"] = null;
    expect(await analytics.getPoseidonStats()).toBeNull();
  });
});

describe("source guards — the fabrication paths are gone", () => {
  // Comments are stripped: this file documents what it removed, and those notes
  // name the very strings being guarded against.
  function code(relativePath) {
    return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");
  }
  const SERVICE = code("../services/foundersAnalytics.js");
  const DASHBOARD = code("../components/FoundersDashboard.jsx");

  it("the mock generators are deleted, not just unused", () => {
    expect(SERVICE).not.toContain("function generateMockTimeSeries");
    expect(SERVICE).not.toContain("function generateMockActivitySeries");
    expect(SERVICE).not.toContain("Math.random");
  });

  it("no hardcoded Poseidon breakdown remains", () => {
    expect(SERVICE).not.toMatch(/identify:\s*42/);
    expect(SERVICE).not.toMatch(/husbandry:\s*67/);
  });

  it("no query targets a nonexistent table", () => {
    for (const bad of ['from("specimens")', 'from("spawns")', 'from("market_orders")', 'from("protocol_fees")']) {
      expect(SERVICE, bad).not.toContain(bad);
    }
  });

  it("an unreadable currency figure renders as '—', not '$0'", () => {
    const idx = DASHBOARD.indexOf("function formatCurrency");
    expect(idx).toBeGreaterThan(-1);
    const body = DASHBOARD.slice(idx, idx + 320);
    expect(body).toContain('return "—"');
    expect(body).not.toContain('return "$0"');
  });

  it("the fabricated trend badges are removed", () => {
    expect(DASHBOARD).not.toContain('trend="+18%"');
    expect(DASHBOARD).not.toContain('trend="+15%"');
  });

  it("charts and the Poseidon panel have an explicit no-data state", () => {
    expect(DASHBOARD).toContain("NoDataPanel");
    expect(DASHBOARD).toContain("!charts.userGrowth");
    expect(DASHBOARD).toContain("!charts.protocolActivity");
    expect(DASHBOARD).toContain("{poseidon ? (");
  });
});
