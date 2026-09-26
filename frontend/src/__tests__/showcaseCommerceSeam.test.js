/**
 * showcaseCommerceSeam.test.js
 *
 * Fish Room R1.4 (P2) — the tank -> listing commerce seam, JS side.
 *
 * The DB authorization invariant (a linked listing's seller must be an active verified wallet of the
 * room owner) and the read-time snapshot are validated on a disposable postgres:16 harness; these
 * tests lock the request-validation contract and the route wiring that reaches those RPCs.
 *
 * Run: npx vitest --run src/__tests__/showcaseCommerceSeam.test.js
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

import { validateAction, ACTIONS } from "../../api/_lib/showcaseValidation.js";

const UUID = "11111111-1111-4111-8111-111111111111";
const TANK = "tank_22222222-2222-4222-8222-222222222222";

describe("commerce-set validation", () => {
  it("is a registered action", () => {
    expect(ACTIONS).toContain("commerce-set");
  });

  it("accepts a single/batch listing key and a null clear, normalizing the tank UUID", () => {
    const linkBatch = validateAction("commerce-set", { roomId: UUID, tankId: TANK, expectedRevision: 3, listingKey: "batch-500" });
    expect(linkBatch.ok).toBe(true);
    expect(linkBatch.value).toEqual({
      roomId: UUID, tankUuid: "22222222-2222-4222-8222-222222222222", expectedRevision: 3, listingKey: "batch-500",
    });
    expect(validateAction("commerce-set", { roomId: UUID, tankId: TANK, expectedRevision: 0, listingKey: "single-1" }).ok).toBe(true);
    expect(validateAction("commerce-set", { roomId: UUID, tankId: TANK, expectedRevision: 2, listingKey: null }).ok).toBe(true);
  });

  it("rejects a malformed listing key", () => {
    for (const bad of ["single-0", "single-", "batch-01", "SINGLE-1", "single-1.5", "pair-2", "single-abc", ""]) {
      const r = validateAction("commerce-set", { roomId: UUID, tankId: TANK, expectedRevision: 1, listingKey: bad });
      expect(r.ok, `expected reject for ${JSON.stringify(bad)}`).toBe(false);
      expect(r.code).toBe("invalid_field");
    }
  });

  it("rejects a non-tank id, bad room id, and missing/extra keys", () => {
    expect(validateAction("commerce-set", { roomId: UUID, tankId: "spec_" + UUID, expectedRevision: 1, listingKey: null }).code).toBe("invalid_entity_id");
    expect(validateAction("commerce-set", { roomId: "not-a-uuid", tankId: TANK, expectedRevision: 1, listingKey: null }).code).toBe("invalid_field");
    expect(validateAction("commerce-set", { roomId: UUID, tankId: TANK, listingKey: null }).code).toBe("invalid_request");
    expect(validateAction("commerce-set", { roomId: UUID, tankId: TANK, expectedRevision: 1, listingKey: null, extra: 1 }).code).toBe("invalid_request");
  });

  it("requires a non-negative integer expectedRevision (commerce always targets an existing placement)", () => {
    expect(validateAction("commerce-set", { roomId: UUID, tankId: TANK, expectedRevision: null, listingKey: null }).code).toBe("invalid_field");
    expect(validateAction("commerce-set", { roomId: UUID, tankId: TANK, expectedRevision: -1, listingKey: null }).code).toBe("invalid_field");
  });
});

describe("commerce-set route wiring (source contract)", () => {
  const route = readFileSync(fileURLToPath(new URL("../../api/showcase-owner.js", import.meta.url)), "utf8");

  it("maps commerce-set to the allowlisted RPC", () => {
    expect(route).toMatch(/"commerce-set"[\s\S]*showcase_set_room_tank_commerce/);
  });

  it("carries the closed commerce_listing_unavailable code and maps the SQL signal to it", () => {
    expect(route).toMatch(/commerce_listing_unavailable:\s*"/);
    expect(route).toMatch(/SHOWCASE_COMMERCE_LISTING_UNAVAILABLE[\s\S]*commerce_listing_unavailable/);
  });
});
