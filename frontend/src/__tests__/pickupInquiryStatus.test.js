/**
 * pickupInquiryStatus.test.js
 *
 * Seller lead triage (P3): POST pickup-inquiry-status moves a lead through
 * new → seen → contacted → closed. Ownership is enforced in the query
 * (WHERE seller_address = session wallet), never from the body.
 *
 * Run: npx vitest --run src/__tests__/pickupInquiryStatus.test.js
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";

const H = vi.hoisted(() => {
  const state = { updateResult: { data: { id: "i1", status: "contacted" }, error: null }, updates: [], updateFilters: [] };
  function makeBuilder(table) {
    const q = { table, filters: [], payload: null };
    const api = {
      update: (p) => { q.payload = p; state.updates.push({ table, payload: p }); return api; },
      select: () => api,
      eq: (c, v) => { q.filters.push([c, v]); return api; },
      maybeSingle: () => { state.updateFilters.push(q.filters); return Promise.resolve(state.updateResult); },
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
beforeEach(() => {
  H.state.updateResult = { data: { id: "i1", status: "contacted" }, error: null };
  H.state.updates = [];
  H.state.updateFilters = [];
});

function req(body, method = "POST") {
  return { method, query: { action: "pickup-inquiry-status" }, headers: { origin: "https://aquacellum.com" }, body };
}
function mockRes() {
  const res = { statusCode: null, body: undefined, headers: {} };
  res.setHeader = (k, v) => { res.headers[String(k).toLowerCase()] = v; };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  res.end = () => res;
  return res;
}

describe("POST pickup-inquiry-status", () => {
  it("updates a lead, scoped to the caller's wallet, and echoes the new status", async () => {
    const res = mockRes();
    await handler(req({ id: "i1", status: "contacted" }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true, id: "i1", status: "contacted" });
    expect(H.state.updates[0].payload).toEqual({ status: "contacted" });
    // ownership + target enforced in the query
    const filters = H.state.updateFilters[0];
    expect(filters).toContainEqual(["id", "i1"]);
    expect(filters).toContainEqual(["seller_address", "0xsellerwallet1111111111111111111111111111"]);
  });

  it("rejects an invalid status with 400 and does not update", async () => {
    const res = mockRes();
    await handler(req({ id: "i1", status: "archived" }), res);
    expect(res.statusCode).toBe(400);
    expect(res.body.code).toBe("status");
    expect(H.state.updates.length).toBe(0);
  });

  it("rejects a missing id with 400", async () => {
    const res = mockRes();
    await handler(req({ status: "closed" }), res);
    expect(res.statusCode).toBe(400);
    expect(res.body.code).toBe("id");
  });

  it("returns 404 when the lead is not found or not owned", async () => {
    H.state.updateResult = { data: null, error: null };
    const res = mockRes();
    await handler(req({ id: "someone-elses", status: "closed" }), res);
    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({ error: "not_found" });
  });

  it("rejects non-POST with 405", async () => {
    const res = mockRes();
    await handler(req({ id: "i1", status: "seen" }, "GET"), res);
    expect(res.statusCode).toBe(405);
  });
});

describe("setPickupInquiryStatus service wrapper", () => {
  it("POSTs the action with id+status and a bearer token", async () => {
    const svc = await import("../services/pickupCoordinationApi.js");
    svc.setSessionTokenGetter(async () => "tok");
    const calls = [];
    vi.stubGlobal("fetch", async (url, opts) => { calls.push({ url: String(url), opts }); return { ok: true, json: async () => ({ ok: true, id: "i1", status: "closed" }) }; });
    const res = await svc.setPickupInquiryStatus("i1", "closed");
    expect(res.success).toBe(true);
    expect(calls[0].url).toContain("action=pickup-inquiry-status");
    expect(calls[0].opts.method).toBe("POST");
    expect(JSON.parse(calls[0].opts.body)).toEqual({ id: "i1", status: "closed" });
    expect(calls[0].opts.headers.Authorization).toBe("Bearer tok");
    svc.setSessionTokenGetter(null);
    vi.unstubAllGlobals();
  });
});
