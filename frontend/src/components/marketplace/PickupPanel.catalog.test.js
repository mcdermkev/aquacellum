/**
 * Component-level guards for PickupPanel.jsx (Task 25, buyer surface).
 *
 * This project's vitest runs in a `node` environment (no jsdom /
 * testing-library) — see vite.config.js `test.environment: 'node'` — and
 * this component transitively touches browser-only APIs (Mapbox GL JS via
 * a dynamically injected script tag). Following the established pattern for
 * component tests in this codebase (PickupCode.catalog.test.js), we verify
 * the behavioral contract via static source guards over the
 * comment-stripped source.
 *
 * Covers docs/TASK_25_PICKUP_COORDINATION_SPEC.md §6 acceptance criteria 9
 * (reveals exact coordinates only in the paid-pickup-order context) and 11
 * (Mapbox component reads VITE_MAPBOX_TOKEN and degrades gracefully).
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
  readFileSync(fileURLToPath(new URL("./PickupPanel.jsx", import.meta.url)), "utf8")
);

const CHECKOUT_SUMMARY_SOURCE = stripComments(
  readFileSync(fileURLToPath(new URL("../CheckoutSummary.jsx", import.meta.url)), "utf8")
);

describe("PickupPanel — calls only the pickupCoordinationApi service functions", () => {
  it("imports and calls fetchPickupForOrder/proposePickupTime (no bespoke fetch)", () => {
    expect(SOURCE).toContain(
      'import { fetchPickupForOrder, proposePickupTime } from "../../services/pickupCoordinationApi"'
    );
    expect(SOURCE).toContain("await fetchPickupForOrder(orderRef)");
    expect(SOURCE).toContain("await proposePickupTime(");
    expect(SOURCE).not.toMatch(/\bfetch\(/);
  });

  it("composes resolveAvailableSlots/arrangementStatusView rather than re-deriving scheduling logic", () => {
    expect(SOURCE).toContain(
      'import { resolveAvailableSlots, arrangementStatusView } from "../../services/pickupCoordination"'
    );
    expect(SOURCE).toContain("resolveAvailableSlots(location");
    expect(SOURCE).toContain("arrangementStatusView(arrangement");
  });
});

describe("PickupPanel — no settlement/inventory calls (Guardrail 1)", () => {
  it("contains none of the forbidden settlement/reservation/refund/escrow call patterns", () => {
    expect(SOURCE).not.toMatch(/\brelease[A-Za-z]*\s*\(/);
    expect(SOURCE).not.toMatch(/\bsettle[A-Za-z]*\s*\(/);
    expect(SOURCE).not.toMatch(/\breserve[A-Za-z]*\s*\(/);
    expect(SOURCE).not.toMatch(/\brefund[A-Za-z]*\s*\(/);
    expect(SOURCE).not.toMatch(/\bescrow[A-Za-z]*\s*\(/);
  });
});

describe("PickupPanel — reuses the existing messaging channel and handshake surface, no new implementations", () => {
  it("composes getOrCreateConversation + the aquadex_open_conversation event (no new messaging system)", () => {
    expect(SOURCE).toContain('import { getOrCreateConversation } from "../../services/messagesApi"');
    expect(SOURCE).toContain("aquadex_open_conversation");
  });

  it("delegates the handshake QR/PIN to the caller via onOpenHandoff, never reimplementing it", () => {
    expect(SOURCE).toContain("onOpenHandoff");
    expect(SOURCE).not.toMatch(/generateCommitment|relaySettleHandshake/);
  });
});

describe("PickupPanel — Mapbox map mirrors TideMap.jsx's pattern, degrades gracefully", () => {
  it("reads VITE_MAPBOX_TOKEN and reuses the dark-v11 style", () => {
    expect(SOURCE).toContain("import.meta.env.VITE_MAPBOX_TOKEN");
    expect(SOURCE).toContain("mapbox://styles/mapbox/dark-v11");
  });

  it("degrades to address-text + an Open-in-Maps link when the token/coords are absent", () => {
    expect(SOURCE).toContain("!MAPBOX_TOKEN");
    expect(SOURCE).toContain("Open in Maps");
    expect(SOURCE).toContain("google.com/maps/dir");
  });

  it("does not import a third-party mapbox-gl npm package (loads via CDN script)", () => {
    expect(SOURCE).not.toMatch(/from\s+["']mapbox-gl["']/);
    expect(SOURCE).toContain("api.mapbox.com/mapbox-gl-js");
  });
});

describe("PickupPanel — includes the safety line (public meet, inspect before handoff)", () => {
  it("renders a non-dismissible safety banner", () => {
    expect(SOURCE).toMatch(/public place|public location/i);
    expect(SOURCE).toMatch(/inspect|take a look/i);
  });
});

describe("PickupPanel — never entitlement-gated (REQUIRED capability, spec §0)", () => {
  it("contains no hasEntitlement gate anywhere in the component", () => {
    expect(SOURCE).not.toMatch(/hasEntitlement/);
  });
});

describe("CheckoutSummary — mounts PickupPanel only for PREPAID_PICKUP orders, distinct from cash pickup's PickupCode", () => {
  it("imports PickupPanel and gates its render on FULFILLMENT_METHODS.PREPAID_PICKUP", () => {
    expect(CHECKOUT_SUMMARY_SOURCE).toContain('import { PickupPanel } from "./marketplace/PickupPanel"');
    expect(CHECKOUT_SUMMARY_SOURCE).toContain("view.method !== FULFILLMENT_METHODS.PREPAID_PICKUP");
    expect(CHECKOUT_SUMMARY_SOURCE).toContain("<PickupPanel");
  });

  it("passes the order's Dexie key as orderRef (matches orders.local_key server-side)", () => {
    expect(CHECKOUT_SUMMARY_SOURCE).toContain("orderRef={order.key}");
  });
});
