/**
 * showcasePublicRoom.endpoint.test.js
 *
 * Showcase Public Window — P1. The sole anonymous reader for a published Fish
 * Room is the `action=showcase-room` branch of the consolidated storefront
 * router (frontend/api/storefront-detail.js). It delegates every visibility /
 * verification / conflict / bounds decision to the SECURITY DEFINER projection
 * RPC `public.showcase_public_room(text, text)` and adds only slug normalization.
 *
 * These tests exercise the REAL handler with the Supabase client mocked at the
 * @supabase/supabase-js boundary (same technique as wallet-casing.test.js), so
 * we assert the HTTP contract without a database:
 *   - anonymous GET returns the projection with the cache header
 *   - a NULL projection is a NON-ENUMERATING 404 (private == missing == blocked)
 *   - the RPC receives trimmed + lowercased slugs; tank is optional (null)
 *   - method and missing-param handling
 *   - the reader never touches a base table (rpc-only)
 *
 * Run: npx vitest --run src/__tests__/showcasePublicRoom.endpoint.test.js
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";

// ── Controllable fake Supabase client (rpc-only) ────────────────────────────
const H = vi.hoisted(() => {
  const state = { rpcResult: { data: null, error: null }, rpcCalls: [], fromCalls: 0 };
  const client = {
    rpc: (name, params) => {
      state.rpcCalls.push({ name, params });
      return Promise.resolve(state.rpcResult);
    },
    // The public reader must never read a base table. If dispatch ever routed a
    // showcase-room request through a table read, this records it and the
    // rpc-only assertion below fails.
    from: () => {
      state.fromCalls += 1;
      throw new Error("showcase-room must not touch a base table");
    },
  };
  return { state, client };
});

vi.mock("@supabase/supabase-js", () => ({ createClient: () => H.client }));

let handler;

beforeAll(async () => {
  vi.stubEnv("SUPABASE_URL", "https://test-project.supabase.co");
  vi.stubEnv("SUPABASE_SERVICE_KEY", "test-service-key");
  ({ default: handler } = await import("../../api/storefront-detail.js"));
});

afterAll(() => {
  vi.unstubAllEnvs();
});

beforeEach(() => {
  H.state.rpcResult = { data: null, error: null };
  H.state.rpcCalls = [];
  H.state.fromCalls = 0;
});

function mockReq({ method = "GET", query = {}, headers = {} } = {}) {
  return { method, query, headers: { origin: "https://aquacellum.com", ...headers } };
}

function mockRes() {
  const res = { statusCode: null, headers: {}, body: undefined, ended: false };
  res.setHeader = (k, v) => { res.headers[String(k).toLowerCase()] = v; };
  res.getHeader = (k) => res.headers[String(k).toLowerCase()];
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (b) => { res.body = b; res.ended = true; return res; };
  res.end = () => { res.ended = true; return res; };
  return res;
}

const PROJECTION = {
  schemaVersion: 1,
  room: {
    slug: "steve-medaka",
    title: "Steve's Rice Fish Patio",
    visibility: "public",
    keeper: null,
    schematic: { version: 1, zones: null },
    hero: null,
    tanks: [
      {
        tankKey: "tank_11111111-1111-4111-8111-111111111111",
        slug: "patio-tub",
        label: "Patio Tub",
        placement: { x: 0, y: 0, order: 0 },
        facts: { volumeLiters: 80, tankType: "tub", inhabitantCount: 10 },
        media: null,
        specimens: [
          { specimenKey: "spec_22222222-2222-4222-8222-222222222222", media: null, commerce: null,
            publicName: "The School", species: { commonName: "Medaka" }, sex: null, lifeStage: "adult" },
        ],
        caption: "No heater. Pretty from above.",
        // P2 commerce seam: the projection may carry a tank-level commerce snapshot; the endpoint
        // is a pure passthrough, so this must survive verbatim (asserted by toEqual below).
        commerce: { listingKey: "batch-500", isBatch: true, packSize: 10, priceCents: 3500,
          price: null, fulfillment: "pickup", photoUrl: "https://cdn.example.com/medaka.jpg", buyPath: "/app/products/batch-500" },
      },
    ],
  },
};

describe("GET /api/storefront-detail?action=showcase-room", () => {
  it("returns the projection with the public cache header for a published room", async () => {
    H.state.rpcResult = { data: PROJECTION, error: null };
    const res = mockRes();
    await handler(mockReq({ query: { action: "showcase-room", room: "steve-medaka" } }), res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual(PROJECTION);
    expect(res.getHeader("Cache-Control")).toBe("private, no-store, max-age=0");
    expect(H.state.fromCalls).toBe(0);
  });

  it("calls showcase_public_room with a trimmed+lowercased room slug and null tank", async () => {
    H.state.rpcResult = { data: PROJECTION, error: null };
    const res = mockRes();
    await handler(mockReq({ query: { action: "showcase-room", room: "  Steve-Medaka " } }), res);

    expect(H.state.rpcCalls).toHaveLength(1);
    expect(H.state.rpcCalls[0].name).toBe("showcase_public_room");
    expect(H.state.rpcCalls[0].params).toEqual({
      normalized_room_slug: "steve-medaka",
      normalized_tank_slug: null,
    });
  });

  it("passes an optional tank slug through, trimmed + lowercased", async () => {
    H.state.rpcResult = { data: PROJECTION, error: null };
    const res = mockRes();
    await handler(mockReq({ query: { action: "showcase-room", room: "steve-medaka", tank: " Patio-Tub " } }), res);

    expect(H.state.rpcCalls[0].params).toEqual({
      normalized_room_slug: "steve-medaka",
      normalized_tank_slug: "patio-tub",
    });
  });

  it("is a NON-ENUMERATING 404 when the projection is NULL (private == missing == blocked)", async () => {
    H.state.rpcResult = { data: null, error: null };

    const resPrivate = mockRes();
    await handler(mockReq({ query: { action: "showcase-room", room: "a-private-room" } }), resPrivate);
    const resMissing = mockRes();
    await handler(mockReq({ query: { action: "showcase-room", room: "does-not-exist" } }), resMissing);

    expect(resPrivate.statusCode).toBe(404);
    expect(resMissing.statusCode).toBe(404);
    // Identical body — the caller cannot distinguish private from missing from conflict-blocked.
    expect(resPrivate.body).toEqual({ error: "not_found" });
    expect(resMissing.body).toEqual(resPrivate.body);
  });

  it("returns 400 invalid_request when the room slug is missing", async () => {
    const res = mockRes();
    await handler(mockReq({ query: { action: "showcase-room" } }), res);
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: "invalid_request" });
    expect(H.state.rpcCalls).toHaveLength(0);
  });

  it("returns 405 with an Allow header for non-GET methods", async () => {
    const res = mockRes();
    await handler(mockReq({ method: "POST", query: { action: "showcase-room", room: "steve-medaka" } }), res);
    expect(res.statusCode).toBe(405);
    expect(res.getHeader("Allow")).toBe("GET, OPTIONS");
    expect(res.body).toEqual({ error: "method_not_allowed" });
    expect(H.state.rpcCalls).toHaveLength(0);
  });

  it("answers OPTIONS preflight with 204", async () => {
    const res = mockRes();
    await handler(mockReq({ method: "OPTIONS", query: { action: "showcase-room", room: "steve-medaka" } }), res);
    expect(res.statusCode).toBe(204);
    expect(res.ended).toBe(true);
    expect(H.state.rpcCalls).toHaveLength(0);
  });

  it("maps an RPC error to an opaque 500 (no upstream leak)", async () => {
    H.state.rpcResult = { data: null, error: { code: "54000", message: "SHOWCASE_PUBLIC_DTO_TOO_LARGE" } };
    const res = mockRes();
    await handler(mockReq({ query: { action: "showcase-room", room: "steve-medaka" } }), res);
    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ error: "internal_error" });
    // The upstream message must not appear anywhere in the response body.
    expect(JSON.stringify(res.body)).not.toContain("SHOWCASE_PUBLIC_DTO_TOO_LARGE");
  });
});
