/**
 * Component-level guards for the Task 25 "My Pickups" layer added to
 * LocalBreederMap.jsx (docs/TASK_25_PICKUP_COORDINATION_SPEC.md §4).
 *
 * This project's vitest runs in a `node` environment (no jsdom /
 * testing-library) — LocalBreederMap.jsx transitively touches
 * browser-only APIs (canvas, Leaflet via CDN script, geolocation).
 * Following the established source-guard convention, this asserts the
 * contract statically over the comment-stripped source.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const SOURCE = stripComments(
  readFileSync(fileURLToPath(new URL("../components/LocalBreederMap.jsx", import.meta.url)), "utf8")
);

describe("LocalBreederMap — My Pickups reveal goes through the order-scoped gate, never a direct table read", () => {
  it("resolves each pin via fetchPickupForOrder (the reveal-gated endpoint), not a direct pickup_locations read", () => {
    expect(SOURCE).toContain('import { fetchPickupForOrder } from "../services/pickupCoordinationApi"');
    expect(SOURCE).toContain("await fetchPickupForOrder(order.key)");
    expect(SOURCE).not.toContain('.from("pickup_locations")');
  });

  it("filters to the buyer's own active PREPAID_PICKUP orders using the shared resolveMethod/resolveCanonicalState (not a forked check)", () => {
    expect(SOURCE).toContain(
      'import { resolveMethod, resolveCanonicalState } from "../services/buyerOrderView"'
    );
    expect(SOURCE).toContain("resolveMethod(o) !== FULFILLMENT_METHODS.PREPAID_PICKUP");
    expect(SOURCE).toContain('o.role !== "Buyer"');
  });
});

describe("LocalBreederMap — no fabricated discovery data (Decision D3 / T15)", () => {
  it("preserves the honest My Pickups layer: real lat/lng converted to miles", () => {
    expect(SOURCE).toContain("latOffset * 69");
    expect(SOURCE).toContain("lngOffset * 55");
  });

  it("does NOT fabricate seller locations from a wallet-hash fuzz offset", () => {
    // D3: the old radar placed every seller at a charCodeAt-hash offset from
    // the buyer — pure fiction. The fabrication is removed; the radar plots no
    // seller dots until the real opt-in discovery feature (T15) lands.
    expect(SOURCE).not.toContain("sellerAddr.charCodeAt(i)");
    expect(SOURCE).not.toContain("fuzzedLocation");
    expect(SOURCE).toContain("setListings([])");
  });

  it("does NOT ship hardcoded fake swap-meets / public drop points", () => {
    expect(SOURCE).not.toContain("Silicon Valley Aqua Swap Meet");
    expect(SOURCE).not.toContain("Downtown Guppy Public Drop Point");
    expect(SOURCE).toContain("const mockEvents = []");
  });

  it("My Pickups pins render as a visually distinct marker, drawn independently from the fuzzed `listings` dots", () => {
    expect(SOURCE).toContain("isMyPickup: true");
    expect(SOURCE).toContain("showMyPickups");
  });
});

describe("LocalBreederMap — a My Pickups pin round-trips into the order (My Orders deep link)", () => {
  it("clicking a My Pickups pin navigates to the orders tab with the order's deep-link key", () => {
    expect(SOURCE).toContain('navigate(`/app/orders?order=${encodeURIComponent(pickup.orderKey)}`)');
    expect(SOURCE).toContain("handleOpenPickupOrder(clickedDot.listing)");
  });
});

describe("LocalBreederMap — never entitlement-gated (REQUIRED capability, spec §0)", () => {
  it("contains no hasEntitlement gate on the My Pickups layer", () => {
    expect(SOURCE).not.toMatch(/hasEntitlement/);
  });
});
