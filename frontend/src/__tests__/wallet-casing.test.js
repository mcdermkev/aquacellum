/**
 * wallet-casing.test.js
 *
 * Regression tests for the class of SILENT social-write failures caused by
 * wallet-address casing mismatches against the case-sensitive foreign keys to
 * profiles(wallet_address).
 *
 * The original bug: the app sends lowercase wallets, but profiles were stored
 * checksummed, so every FK insert (follow / join school / invite / RSVP / DM /
 * notification) failed with a 23503 foreign-key violation that the UI swallowed.
 * Nothing visibly happened and no test caught it.
 *
 * These tests assert the two invariants that make that bug impossible to ship
 * silently again:
 *   1. FK writes resolve the wallet to the casing stored in profiles
 *      (so the insert actually satisfies the FK instead of failing).
 *   2. Errors from the data layer PROPAGATE out of the API functions — they are
 *      never swallowed — and the UI surfaces them instead of failing silently.
 *
 * The Supabase client is mocked at the @supabase/supabase-js boundary so the
 * REAL resolveProfileWallet + REAL api functions run against a simulated DB
 * (a profiles table that holds checksummed rows, exactly like production did).
 *
 * Run: npx vitest --run src/__tests__/wallet-casing.test.js
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve as pathResolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVICES = pathResolve(__dirname, "../services");
const COMPONENTS = pathResolve(__dirname, "../components/reef");

// ── Shared mock state + a controllable fake Supabase client ─────────────────
const H = vi.hoisted(() => {
  const state = {
    profiles: [],        // wallet strings as STORED (e.g. checksummed)
    insertResult: null,  // override result for inserts: { data, error }
    queries: [],         // recorded queries for assertions
    inserts: [],         // recorded insert/upsert payloads
  };

  function makeBuilder(table) {
    const q = { table, op: "select", payload: null, filters: [], count: false };

    function settle(mode) {
      state.queries.push({ ...q, filters: [...q.filters] });

      if (q.op === "insert" || q.op === "upsert") {
        state.inserts.push({ table, payload: q.payload });
        return state.insertResult || { data: q.payload, error: null };
      }

      // resolveProfileWallet reads against the profiles table
      if (table === "profiles" && q.op === "select") {
        const eqF = q.filters.find((f) => f.t === "eq" && f.c === "wallet_address");
        const ilikeF = q.filters.find((f) => f.t === "ilike" && f.c === "wallet_address");
        if (eqF) {
          const hit = state.profiles.find((w) => w === eqF.v); // exact match
          return { data: hit ? { wallet_address: hit } : null, error: null };
        }
        if (ilikeF) {
          const hit = state.profiles.find(
            (w) => w.toLowerCase() === String(ilikeF.v).toLowerCase()
          );
          return { data: hit ? { wallet_address: hit } : null, error: null };
        }
        return { data: null, error: null };
      }

      if (q.count) return { count: 0, error: null };
      if (mode === "single") return { data: null, error: { code: "PGRST116" } };
      if (mode === "maybe") return { data: null, error: null };
      return { data: [], error: null };
    }

    const api = {
      select: (_sel, opts) => { if (opts && opts.count) q.count = true; return api; },
      insert: (payload) => { q.op = "insert"; q.payload = payload; return api; },
      upsert: (payload) => { q.op = "upsert"; q.payload = payload; return api; },
      update: (payload) => { q.op = "update"; q.payload = payload; return api; },
      delete: () => { q.op = "delete"; return api; },
      eq: (c, v) => { q.filters.push({ t: "eq", c, v }); return api; },
      ilike: (c, v) => { q.filters.push({ t: "ilike", c, v }); return api; },
      in: (c, v) => { q.filters.push({ t: "in", c, v }); return api; },
      neq: () => api, order: () => api, limit: () => api,
      not: () => api, or: () => api, gt: () => api, lt: () => api, gte: () => api,
      single: () => Promise.resolve(settle("single")),
      maybeSingle: () => Promise.resolve(settle("maybe")),
      then: (onF, onR) => Promise.resolve(settle("list")).then(onF, onR),
    };
    return api;
  }

  const client = {
    from: (table) => makeBuilder(table),
    auth: {
      signOut: async () => ({ error: null }),
      setSession: async () => ({ error: null }),
    },
  };

  return { state, client };
});

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => H.client,
}));

// Modules are imported dynamically AFTER env is stubbed, so the real
// supabaseClient sees a configured project at module-load time.
let supabaseClient, reefApi, schoolsApi;

beforeAll(async () => {
  vi.stubEnv("VITE_SUPABASE_URL", "https://test-project.supabase.co");
  vi.stubEnv("VITE_SUPABASE_ANON_KEY", "test-anon-key");
  supabaseClient = await import("../services/supabaseClient");
  reefApi = await import("../services/reefApi");
  schoolsApi = await import("../services/schoolsApi");
});

afterAll(() => {
  vi.unstubAllEnvs();
});

beforeEach(() => {
  H.state.profiles = [];
  H.state.insertResult = null;
  H.state.queries = [];
  H.state.inserts = [];
});

describe("wallet casing — FK writes resolve to stored profile casing", () => {
  it("followUser writes the CHECKSUMMED casing stored in profiles, not raw lowercase", async () => {
    // Unique wallets per test to avoid the resolveProfileWallet module cache.
    const FOLLOWER = "0xFollowerAa11111111111111111111111111A001";
    const TARGET = "0xTargetBb22222222222222222222222222220B02";
    H.state.profiles = [FOLLOWER, TARGET]; // both stored checksummed

    await supabaseClient.authenticateWithWallet(FOLLOWER); // sets current wallet (lowercased)

    // UI passes a lowercase target (what actually happens in the app)
    const { error } = await reefApi.followUser(TARGET.toLowerCase());
    expect(error).toBeFalsy();

    const insert = H.state.inserts.find((i) => i.table === "follows");
    expect(insert).toBeTruthy();
    // The regression guard: payload must use the stored casing so the FK passes.
    expect(insert.payload.follower_wallet).toBe(FOLLOWER);
    expect(insert.payload.target_wallet).toBe(TARGET);
    expect(insert.payload.follow_type).toBe("follow");
  });

  it("inviteToSchool resolves BOTH invited_by and invited_wallet to stored casing", async () => {
    const FOUNDER = "0xFounderCc33333333333333333333333333330C03";
    const INVITEE = "0xInviteeDd44444444444444444444444444440D04";
    H.state.profiles = [FOUNDER, INVITEE];

    await supabaseClient.authenticateWithWallet(FOUNDER);

    const { error } = await schoolsApi.inviteToSchool("school-123", INVITEE.toLowerCase());
    expect(error).toBeFalsy();

    const insert = H.state.inserts.find((i) => i.table === "school_invites");
    expect(insert).toBeTruthy();
    expect(insert.payload.invited_by).toBe(FOUNDER);
    expect(insert.payload.invited_wallet).toBe(INVITEE);
  });
});

describe("wallet casing — errors propagate instead of being swallowed", () => {
  it("followUser returns the FK violation error to the caller", async () => {
    const FOLLOWER = "0xFollowerEe55555555555555555555555555550E05";
    const TARGET = "0xTargetFf66666666666666666666666666660F06";
    H.state.profiles = [FOLLOWER, TARGET];
    // Simulate the historical failure: the insert is rejected by the FK.
    H.state.insertResult = {
      data: null,
      error: { code: "23503", message: "violates foreign key constraint" },
    };

    await supabaseClient.authenticateWithWallet(FOLLOWER);
    const { error } = await reefApi.followUser(TARGET.toLowerCase());

    // The API MUST surface the error (the UI was what swallowed it before).
    expect(error).toBeTruthy();
    expect(error.code).toBe("23503");
  });
});

describe("wallet casing — reads are case-insensitive", () => {
  it("getFollowerCount filters target_wallet with ilike, never a case-sensitive eq", async () => {
    await reefApi.getFollowerCount("0xSomeWallet7777777777777777777777777770777");

    const q = H.state.queries.find((x) => x.table === "follows");
    expect(q).toBeTruthy();
    const targetFilters = q.filters.filter((f) => f.c === "target_wallet");
    expect(targetFilters.length).toBeGreaterThan(0);
    // Must be ilike (case-insensitive); a plain eq would miss mixed-case rows.
    expect(targetFilters.every((f) => f.t === "ilike")).toBe(true);
    expect(targetFilters.some((f) => f.t === "eq")).toBe(false);
  });
});

describe("source guardrails — the silent-failure anti-patterns must not return", () => {
  it("FollowButton surfaces errors (no empty catch that hides FK failures)", () => {
    const src = readFileSync(pathResolve(COMPONENTS, "FollowButton.jsx"), "utf8");
    // The original bug was an empty `} catch {` that silently reverted state.
    expect(src).not.toMatch(/}\s*catch\s*\{/);
    // It must log the real reason so failures are visible.
    expect(src).toMatch(/catch\s*\(\s*err\s*\)/);
    expect(src).toMatch(/console\.(error|warn)/);
  });

  it("social FK inserts never use a raw unresolved wallet value", () => {
    // After the fix, no social write should insert `*_wallet: walletAddress`
    // (the raw lowercased value). They must go through resolveProfileWallet
    // (stored in a resolved variable or awaited inline).
    const files = ["reefApi.js", "schoolsApi.js", "tidesApi.js", "messagesApi.js", "auditsApi.js"];
    const offenders = [];
    for (const f of files) {
      const src = readFileSync(pathResolve(SERVICES, f), "utf8");
      // e.g. "follower_wallet: walletAddress," or "wallet_address: walletAddress"
      const re = /(?:_wallet|wallet_address|participant_[ab]|invited_by|_address)\s*:\s*walletAddress\b/g;
      const matches = src.match(re);
      if (matches) offenders.push(`${f}: ${matches.join(", ")}`);
    }
    expect(offenders).toEqual([]);
  });

  it("resolveProfileWallet is exported and used by the social services", () => {
    const client = readFileSync(pathResolve(SERVICES, "supabaseClient.js"), "utf8");
    expect(client).toMatch(/export\s+async\s+function\s+resolveProfileWallet/);
    for (const f of ["reefApi.js", "schoolsApi.js", "tidesApi.js", "messagesApi.js", "auditsApi.js"]) {
      const src = readFileSync(pathResolve(SERVICES, f), "utf8");
      expect(src).toMatch(/resolveProfileWallet/);
    }
  });
});
