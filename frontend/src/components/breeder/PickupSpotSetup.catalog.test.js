/**
 * Component-level guards for PickupSpotSetup.jsx (Task 25, seller surface).
 *
 * This project's vitest runs in a `node` environment (no jsdom /
 * testing-library) — see vite.config.js `test.environment: 'node'` — and
 * this component transitively touches browser-only APIs (Mapbox GL JS via
 * a dynamically injected script tag). Following the established pattern for
 * component tests in this codebase (PickupCode.catalog.test.js,
 * BreederTerminal.catalog.test.js), we verify the behavioral contract via
 * static source guards over the comment-stripped source.
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
  readFileSync(fileURLToPath(new URL("./PickupSpotSetup.jsx", import.meta.url)), "utf8")
);

const BREEDER_TERMINAL_SOURCE = stripComments(
  readFileSync(fileURLToPath(new URL("./BreederTerminal.jsx", import.meta.url)), "utf8")
);

describe("PickupSpotSetup — CRUD calls only the pickupCoordinationApi service functions", () => {
  it("imports and calls listPickupLocations/savePickupLocation/deletePickupLocation (no bespoke fetch)", () => {
    expect(SOURCE).toContain(
      'import {\n  listPickupLocations,\n  savePickupLocation,\n  deletePickupLocation,\n} from "../../services/pickupCoordinationApi"'
    );
    expect(SOURCE).toContain("await listPickupLocations()");
    expect(SOURCE).toContain("await savePickupLocation(payload)");
    expect(SOURCE).toContain("await deletePickupLocation(id)");
    expect(SOURCE).not.toMatch(/\bfetch\(/);
  });

  it("validates every save via the pure validatePickupLocationDraft before calling the API", () => {
    expect(SOURCE).toContain('import { validatePickupLocationDraft } from "../../services/pickupCoordination"');
    expect(SOURCE).toContain("validatePickupLocationDraft(draft)");
  });
});

describe("PickupSpotSetup — Mapbox pin picker mirrors TideMap.jsx's pattern, degrades gracefully", () => {
  it("reads VITE_MAPBOX_TOKEN and reuses the dark-v11 style", () => {
    expect(SOURCE).toContain("import.meta.env.VITE_MAPBOX_TOKEN");
    expect(SOURCE).toContain("mapbox://styles/mapbox/dark-v11");
  });

  it("degrades to manual lat/lng entry when no Mapbox token is configured", () => {
    expect(SOURCE).toContain("if (!MAPBOX_TOKEN)");
    expect(SOURCE).toMatch(/Latitude/);
    expect(SOURCE).toMatch(/Longitude/);
  });

  it("does not import a third-party mapbox-gl npm package (loads via CDN script, matching TideMap.jsx)", () => {
    expect(SOURCE).not.toMatch(/from\s+["']mapbox-gl["']/);
    expect(SOURCE).toContain("api.mapbox.com/mapbox-gl-js");
  });
});

describe("PickupSpotSetup — availability window editor produces the shape pickupCoordination.js expects", () => {
  it("supports both recurring (dow) and one-off (date) windows with start/end/tz fields", () => {
    expect(SOURCE).toMatch(/dow:\s*5/);
    expect(SOURCE).toMatch(/date:\s*new Date\(\)\.toISOString\(\)\.slice\(0,\s*10\)/);
    expect(SOURCE).toContain('type="time"');
  });
});

describe("PickupSpotSetup — never entitlement-gated (REQUIRED capability, spec §0)", () => {
  it("contains no hasEntitlement gate anywhere in the component", () => {
    expect(SOURCE).not.toMatch(/hasEntitlement/);
  });
});

describe("BreederTerminal — mounts PickupSpotSetup alongside ShipFromSetup", () => {
  it("imports PickupSpotSetup and renders it in the Shipping section", () => {
    expect(BREEDER_TERMINAL_SOURCE).toContain('import { PickupSpotSetup } from "./PickupSpotSetup"');
    expect(BREEDER_TERMINAL_SOURCE).toContain("<PickupSpotSetup walletAccount={walletAccount} />");
  });
});

describe("BreederTerminal — seller pickup-time confirm/counter is layered on the existing order row, not a new queue", () => {
  it("PickupArrangementPanel is rendered inline inside SellerOrderRow, gated on PREPAID_PICKUP method", () => {
    expect(BREEDER_TERMINAL_SOURCE).toContain("FULFILLMENT_METHODS.PREPAID_PICKUP");
    expect(BREEDER_TERMINAL_SOURCE).toContain("<PickupArrangementPanel");
  });

  it("confirm/counter call confirmPickupTime, never a settlement/inventory function", () => {
    expect(BREEDER_TERMINAL_SOURCE).toContain(
      'import { fetchPickupForOrder, confirmPickupTime } from "../../services/pickupCoordinationApi"'
    );
    const idx = BREEDER_TERMINAL_SOURCE.indexOf("const handleConfirmPickupTime = async (view, confirmedTime) => {");
    expect(idx).toBeGreaterThan(-1);
    const block = BREEDER_TERMINAL_SOURCE.slice(idx, idx + 800);
    expect(block).toContain("await confirmPickupTime(");
    expect(block).not.toMatch(/\brelease[A-Za-z]*\s*\(/);
    expect(block).not.toMatch(/\bsettle[A-Za-z]*\s*\(/);
    expect(block).not.toMatch(/\breserve[A-Za-z]*\s*\(/);
  });
});
