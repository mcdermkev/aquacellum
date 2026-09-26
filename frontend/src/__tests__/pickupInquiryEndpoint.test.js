/**
 * pickupInquiryEndpoint.test.js
 *
 * Guest Pickup Inquiry (P3) — the anon `pickup-inquiry` POST and the seller `pickup-inquiries` GET
 * on the consolidated storefront router. The Supabase client is mocked at the @supabase/supabase-js
 * boundary and Privy at ./_lib/verifyPrivyToken.js, so the real handler runs without a DB.
 *
 * Locks the security-critical contract:
 *   - the seller is resolved SERVER-SIDE from the listing; the client never supplies it
 *   - PII (contact value) is never echoed in the response
 *   - validation rejects bad key/contact/name; unknown/inactive listing → 404
 *   - rate limiting returns 429
 *   - the seller read is filtered to the caller's own wallet
 *
 * Run: npx vitest --run src/__tests__/pickupInquiryEndpoint.test.js
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";

const H = vi.hoisted(() => {
  const state = {
    listingResult: { data: { seller_address: "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" }, error: null },
    inquiries: [],
    inserts: [],
    selectFilters: [],
    rpcCalls: [],
  };
  function makeBuilder(table) {
    const q = { table, op: "select", filters: [] };
    const api = {
      select: () => api,
      insert: (payload) => { q.op = "insert"; state.inserts.push({ table, payload }); return api; },
      eq: (c, v) => { q.filters.push([c, v]); return api; },
      order: () => api,
      limit: () => api,
      maybeSingle: () => Promise.resolve(state.listingResult),
      then: (onF, onR) => {
        let result;
        if (q.op === "insert") result = { error: null };
        else if (table === "marketplace_pickup_inquiries") { state.selectFilters.push(q.filters); result = { data: state.inquiries, error: null }; }
        else result = { data: [], error: null };
        return Promise.resolve(result).then(onF, onR);
      },
    };
    return api;
  }
  const client = {
    from: (t) => makeBuilder(t),
    rpc: (name, args) => { state.rpcCalls.push({ name, args }); return Promise.resolve({ error: null }); },
  };
  return { state, client };
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
  H.state.listingResult = { data: { seller_address: "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" }, error: null };
  H.state.inquiries = [];
  H.state.inserts = [];
  H.state.selectFilters = [];
  H.state.rpcCalls = [];
});

function mockReq({ method = "POST", query = {}, headers = {}, body = {} } = {}) {
  return { method, query: { action: "pickup-inquiry", ...query }, headers: { origin: "https://aquacellum.com", "x-forwarded-for": "203.0.113.1", ...headers }, body };
}
function mockRes() {
  const res = { statusCode: null, headers: {}, body: undefined, ended: false };
  res.setHeader = (k, v) => { res.headers[String(k).toLowerCase()] = v; };
  res.getHeader = (k) => res.headers[String(k).toLowerCase()];
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; res.ended = true; return res; };
  res.end = () => { res.ended = true; return res; };
  return res;
}
const validBody = { listingKey: "batch-500", guestName: "Casey", contactKind: "email", contactValue: "casey@example.com", message: "Saturday?" };

describe("POST pickup-inquiry", () => {
  it("stores a lead and returns 201 with no PII echoed; seller is server-resolved + lowercased", async () => {
    const res = mockRes();
    await handler(mockReq({ headers: { "x-forwarded-for": "203.0.113.10" }, body: { ...validBody } }), res);
    expect(res.statusCode).toBe(201);
    expect(res.body).toEqual({ ok: true });
    // no PII in the response
    expect(JSON.stringify(res.body)).not.toContain("casey@example.com");
    // exactly one insert into the inquiries table, seller from the LISTING (lowercased), not the body
    const ins = H.state.inserts.find((i) => i.table === "marketplace_pickup_inquiries");
    expect(ins).toBeTruthy();
    expect(ins.payload.seller_address).toBe("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    expect(ins.payload.listing_key).toBe("batch-500");
    expect(ins.payload.contact_value).toBe("casey@example.com");
    // best-effort seller notification fired
    expect(H.state.rpcCalls.some((c) => c.name === "dispatch_notification")).toBe(true);
  });

  it("rejects a malformed listing key with 400 and never inserts", async () => {
    const res = mockRes();
    await handler(mockReq({ headers: { "x-forwarded-for": "203.0.113.11" }, body: { ...validBody, listingKey: "pair-9" } }), res);
    expect(res.statusCode).toBe(400);
    expect(res.body.code).toBe("listing_key");
    expect(H.state.inserts.length).toBe(0);
  });

  it("rejects a bad contact kind and a malformed email", async () => {
    const r1 = mockRes();
    await handler(mockReq({ headers: { "x-forwarded-for": "203.0.113.12" }, body: { ...validBody, contactKind: "fax" } }), r1);
    expect(r1.statusCode).toBe(400);
    expect(r1.body.code).toBe("contact_kind");
    const r2 = mockRes();
    await handler(mockReq({ headers: { "x-forwarded-for": "203.0.113.13" }, body: { ...validBody, contactValue: "not-an-email" } }), r2);
    expect(r2.statusCode).toBe(400);
    expect(r2.body.code).toBe("contact_value");
  });

  it("rejects a missing name", async () => {
    const res = mockRes();
    await handler(mockReq({ headers: { "x-forwarded-for": "203.0.113.14" }, body: { ...validBody, guestName: "   " } }), res);
    expect(res.statusCode).toBe(400);
    expect(res.body.code).toBe("guest_name");
  });

  it("returns a non-committal 404 for an unknown/inactive listing", async () => {
    H.state.listingResult = { data: null, error: null };
    const res = mockRes();
    await handler(mockReq({ headers: { "x-forwarded-for": "203.0.113.15" }, body: { ...validBody } }), res);
    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({ error: "listing_unavailable" });
    expect(H.state.inserts.length).toBe(0);
  });

  it("rate-limits a bursting IP with 429 + Retry-After", async () => {
    const ip = "203.0.113.99";
    let last;
    for (let i = 0; i < 10; i++) {
      last = mockRes();
      await handler(mockReq({ headers: { "x-forwarded-for": ip }, body: { ...validBody } }), last);
    }
    expect(last.statusCode).toBe(429);
    expect(last.body.error).toBe("rate_limited");
    expect(last.getHeader("Retry-After")).toBeTruthy();
  });

  it("rejects non-POST with 405", async () => {
    const res = mockRes();
    await handler(mockReq({ method: "GET", headers: { "x-forwarded-for": "203.0.113.16" }, body: {} }), res);
    expect(res.statusCode).toBe(405);
  });
});

describe("GET pickup-inquiries (seller)", () => {
  it("returns the caller's own inquiries, filtered by their wallet", async () => {
    H.state.inquiries = [{ id: "1", listing_key: "batch-500", guest_name: "Casey", contact_kind: "email", contact_value: "casey@example.com", status: "new" }];
    const res = mockRes();
    await handler({ method: "GET", query: { action: "pickup-inquiries" }, headers: { origin: "https://aquacellum.com" }, body: {} }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.inquiries).toHaveLength(1);
    // the read was scoped to the session wallet (lowercased)
    const filters = H.state.selectFilters.flat();
    expect(filters).toContainEqual(["seller_address", "0xsellerwallet1111111111111111111111111111"]);
  });
});
