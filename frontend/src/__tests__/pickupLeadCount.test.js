/**
 * pickupLeadCount.test.js
 *
 * The Breeder Terminal nav badge counts NEW (untriaged) pickup leads via the
 * lightweight count mode of the seller-authed pickup-inquiries action
 * (countOnly=1&status=new), and returns only a number (no rows / no PII).
 *
 * Run: npx vitest --run src/__tests__/pickupLeadCount.test.js
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";

const H = vi.hoisted(() => {
  const state = { count: 3, calls: [] };
  function makeBuilder(table) {
    const q = { table, head: false, filters: [] };
    const api = {
      select: (_sel, opts) => { if (opts && opts.head) q.head = true; return api; },
      eq: (c, v) => { q.filters.push([c, v]); return api; },
      order: () => api,
      limit: () => api,
      then: (onF, onR) => {
        state.calls.push({ table, head: q.head, filters: q.filters });
        const r = q.head ? { count: state.count, error: null } : { data: [], error: null };
        return Promise.resolve(r).then(onF, onR);
      },
    };
    return api;
  }
  return { state, client: { from: (t) => makeBuilder(t) } };
});

vi.mock("@supabase/supabase-js", () => ({ createClient: () => H.client }));
vi.mock("../../api/_lib/verifyPrivyToken.js", () => ({
  verifyPrivyToken: async () => ({ verified: true, walletAddress: "0xSELLerWALLET1111111111111111111111111111" }),
  isPrivyConfigurationFailure: () => false,
  respondToPrivyConfigurationFailure: () => false,
}));

let handler;
beforeAll(async () => {
  vi.stubEnv("SUPABASE_URL", "https://test.supabase.co");
  vi.stubEnv("SUPABASE_SERVICE_KEY", "test-service-key");
  ({ default: handler } = await import("../../api/storefront-detail.js"));
});
afterAll(() => vi.unstubAllEnvs());
beforeEach(() => { H.state.count = 3; H.state.calls = []; });

function mockRes() {
  const res = { statusCode: null, body: undefined, headers: {} };
  res.setHeader = (k, v) => { res.headers[String(k).toLowerCase()] = v; };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  res.end = () => res;
  return res;
}

describe("pickup-inquiries count mode", () => {
  it("returns just a count, scoped to the caller's wallet and the requested status", async () => {
    const res = mockRes();
    await handler({ method: "GET", query: { action: "pickup-inquiries", countOnly: "1", status: "new" }, headers: {}, body: {} }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ count: 3 });
    const headCall = H.state.calls.find((c) => c.head);
    expect(headCall).toBeTruthy();
    expect(headCall.filters).toContainEqual(["seller_address", "0xsellerwallet1111111111111111111111111111"]);
    expect(headCall.filters).toContainEqual(["status", "new"]);
  });

  it("ignores an invalid status filter (counts all of the seller's leads)", async () => {
    const res = mockRes();
    await handler({ method: "GET", query: { action: "pickup-inquiries", countOnly: "1", status: "bogus" }, headers: {}, body: {} }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ count: 3 });
    const headCall = H.state.calls.find((c) => c.head);
    expect(headCall.filters.some(([c]) => c === "status")).toBe(false);
  });
});

describe("countNewPickupInquiries service wrapper", () => {
  it("GETs countOnly=1&status=new with a bearer token", async () => {
    const svc = await import("../services/pickupCoordinationApi.js");
    svc.setSessionTokenGetter(async () => "tok");
    const calls = [];
    vi.stubGlobal("fetch", async (url, opts) => { calls.push({ url: String(url), opts }); return { ok: true, json: async () => ({ count: 5 }) }; });
    const res = await svc.countNewPickupInquiries();
    expect(res.success).toBe(true);
    expect(res.count).toBe(5);
    expect(calls[0].url).toContain("action=pickup-inquiries");
    expect(calls[0].url).toContain("countOnly=1");
    expect(calls[0].url).toContain("status=new");
    expect(calls[0].opts.headers.Authorization).toBe("Bearer tok");
    svc.setSessionTokenGetter(null);
    vi.unstubAllGlobals();
  });
});

describe("badge wiring (source contract)", () => {
  const badge = readFileSync(fileURLToPath(new URL("../components/PickupLeadBadge.jsx", import.meta.url)), "utf8");
  const hook = readFileSync(fileURLToPath(new URL("../hooks/usePickupLeadCount.js", import.meta.url)), "utf8");
  const app = readFileSync(fileURLToPath(new URL("../App.jsx", import.meta.url)), "utf8");

  it("the badge hides itself when the count is zero", () => {
    expect(badge).toMatch(/if \(!count \|\| count < 1\) return null/);
  });

  it("the hook only fetches when enabled and uses the count service", () => {
    expect(hook).toContain("countNewPickupInquiries");
    expect(hook).toMatch(/if \(!enabled\)/);
  });

  it("App gates the count on an authenticated seller and badges the breeder-terminal tab", () => {
    expect(app).toMatch(/usePickupLeadCount\(!!account && authenticated && isStorefrontBeta && !casualModeActive\)/);
    expect(app).toContain("pickupBadge: true");
    expect(app).toContain("<PickupLeadBadge count={tab.pickupCount}");
  });
});
