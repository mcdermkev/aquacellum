/**
 * pickupInquiryInbox.test.js
 *
 * The seller "Pickup Requests" inbox (P3, Tier B):
 *   - the service wrapper listPickupInquiries() hits the seller-authed
 *     `pickup-inquiries` action on storefront-detail with a bearer token
 *   - the inbox component + BreederTerminal are wired to it (source contract)
 *
 * The endpoint's authorization/behaviour is covered by pickupInquiryEndpoint.test.js;
 * this locks the client wiring without pulling in a DOM renderer (this repo's
 * component tests are source/catalog style, not RTL).
 *
 * Run: npx vitest --run src/__tests__/pickupInquiryInbox.test.js
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { listPickupInquiries, setSessionTokenGetter } from "../services/pickupCoordinationApi.js";

describe("listPickupInquiries service wrapper", () => {
  let calls;
  beforeEach(() => {
    calls = [];
    setSessionTokenGetter(async () => "test-bearer-token");
    vi.stubGlobal("fetch", async (url, opts) => {
      calls.push({ url: String(url), opts });
      return { ok: true, json: async () => ({ inquiries: [{ id: "1", guest_name: "Casey" }] }) };
    });
  });
  afterEach(() => {
    setSessionTokenGetter(null);
    vi.unstubAllGlobals();
  });

  it("GETs the pickup-inquiries action with a limit and a bearer token", async () => {
    const res = await listPickupInquiries();
    expect(res.success).toBe(true);
    expect(res.inquiries).toHaveLength(1);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain("/storefront-detail?");
    expect(calls[0].url).toContain("action=pickup-inquiries");
    expect(calls[0].url).toContain("limit=50");
    expect(calls[0].opts.headers.Authorization).toBe("Bearer test-bearer-token");
  });

  it("passes a custom limit through", async () => {
    await listPickupInquiries(10);
    expect(calls[0].url).toContain("limit=10");
  });

  it("surfaces a failure without throwing", async () => {
    vi.stubGlobal("fetch", async () => ({ ok: false, status: 500, json: async () => ({ error: "Failed to load inquiries" }) }));
    const res = await listPickupInquiries();
    expect(res.success).toBe(false);
    expect(res.error).toBe("Failed to load inquiries");
  });
});

describe("inbox wiring (source contract)", () => {
  const inbox = readFileSync(fileURLToPath(new URL("../components/breeder/PickupRequestsInbox.jsx", import.meta.url)), "utf8");
  const terminal = readFileSync(fileURLToPath(new URL("../components/breeder/BreederTerminal.jsx", import.meta.url)), "utf8");

  it("the inbox fetches via listPickupInquiries and is read-only (no settlement calls)", () => {
    expect(inbox).toContain("listPickupInquiries");
    expect(inbox).not.toMatch(/settle|escrow|release|payout|purchase/i);
  });

  it("BreederTerminal registers the Pickup Requests section, nav item, and render", () => {
    expect(terminal).toContain('PICKUP_REQUESTS: "pickup-requests"');
    expect(terminal).toMatch(/id:\s*SECTIONS\.PICKUP_REQUESTS/);
    expect(terminal).toContain("<PickupRequestsInbox");
    expect(terminal).toContain('import { PickupRequestsInbox }');
  });
});
