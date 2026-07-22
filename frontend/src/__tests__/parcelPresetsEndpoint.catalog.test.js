/**
 * Component-level guards for the parcel-presets endpoint added to
 * frontend/api/stripe.js (Task 9 Increment 2 §2.4, review-gated: this is
 * the "preset feeds the packing engine" server touch).
 *
 * stripe.js pulls in the Stripe SDK, Supabase, and other server-only deps
 * that can't be exercised as a unit test in this repo's node-env vitest
 * setup without a lot of mocking scaffolding, so — matching the established
 * component source-guard convention (BreederTerminal.catalog.test.js,
 * ListSpecimenModal.catalog.test.js) — this asserts the auth and validation
 * contract statically over the comment-stripped source. Lives under
 * src/__tests__/ (not api/) because vite.config.js's vitest `include` only
 * scans `src/**\/*.test.{js,jsx}`.
 *
 * Covers spec §4 acceptance criterion 8: "derives the wallet from the
 * session (not the request body), validates bounds, and rejects
 * unauthenticated with 401."
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
  readFileSync(fileURLToPath(new URL("../../api/stripe.js", import.meta.url)), "utf8")
);

describe("parcel-presets endpoint — wallet derived from session only, never the request body", () => {
  it("requireWalletFromSession calls verifyPrivyToken and returns the token's own walletAddress", () => {
    const idx = SOURCE.indexOf("async function requireWalletFromSession(req, res) {");
    expect(idx).toBeGreaterThan(-1);
    const block = SOURCE.slice(idx, idx + 700);
    expect(block).toContain("await verifyPrivyToken(req)");
    expect(block).toContain("return walletAddress.toLowerCase()");
    // Must not read a client-supplied wallet from the body/query as a
    // fallback or override within this function.
    expect(block).not.toMatch(/req\.body\??\.\s*wallet/i);
    expect(block).not.toMatch(/req\.query\??\.\s*wallet/i);
  });

  it("rejects unauthenticated callers with 401", () => {
    const idx = SOURCE.indexOf("async function requireWalletFromSession(req, res) {");
    const block = SOURCE.slice(idx, idx + 700);
    expect(block).toMatch(/res\.status\(401\)/);
  });

  it("handleParcelPresets calls requireWalletFromSession before any DB read/write", () => {
    const handlerIdx = SOURCE.indexOf("async function handleParcelPresets(req, res) {");
    expect(handlerIdx).toBeGreaterThan(-1);
    const handlerBlock = SOURCE.slice(handlerIdx, handlerIdx + 400);
    expect(handlerBlock).toContain("await requireWalletFromSession(req, res)");
  });

  it("registers the ?action=parcel-presets route distinct from the existing public ?action=parcel-preset", () => {
    expect(SOURCE).toContain('case "parcel-presets":');
    expect(SOURCE).toContain("return handleParcelPresets(req, res);");
    // The original public, singular, read-only action must remain untouched.
    expect(SOURCE).toContain('case "parcel-preset":');
    expect(SOURCE).toContain("return handleParcelPreset(req, res);");
  });
});

describe("parcel-presets endpoint — ownership re-checked on every mutation (defense in depth)", () => {
  it("PUT verifies the existing row's wallet_address matches the session wallet before updating", () => {
    const putIdx = SOURCE.indexOf('if (req.method === "PUT") {');
    expect(putIdx).toBeGreaterThan(-1);
    const block = SOURCE.slice(putIdx, putIdx + 1200);
    expect(block).toContain("existing.wallet_address !== wallet");
    expect(block).toMatch(/res\.status\(404\)/);
  });

  it("DELETE verifies the existing row's wallet_address matches the session wallet before deleting", () => {
    const delIdx = SOURCE.indexOf('if (req.method === "DELETE") {');
    expect(delIdx).toBeGreaterThan(-1);
    const block = SOURCE.slice(delIdx, delIdx + 900);
    expect(block).toContain("existing.wallet_address !== wallet");
  });
});

describe("parcel-presets endpoint — validates bounds before writing (§2.4)", () => {
  it("validateParcelPresetBody rejects non-positive or missing numeric fields", () => {
    const idx = SOURCE.indexOf("function validateParcelPresetBody(body = {}) {");
    expect(idx).toBeGreaterThan(-1);
    const block = SOURCE.slice(idx, idx + 900);
    expect(block).toMatch(/n <= 0/);
    expect(block).toContain("must be a positive number");
  });

  it("POST and PUT both call validateParcelPresetBody before touching the database", () => {
    const postIdx = SOURCE.indexOf('if (req.method === "POST") {');
    const postBlock = SOURCE.slice(postIdx, postIdx + 300);
    expect(postBlock).toContain("validateParcelPresetBody(req.body || {})");

    const putIdx = SOURCE.indexOf('if (req.method === "PUT") {');
    const putBlock = SOURCE.slice(putIdx, putIdx + 300);
    expect(putBlock).toContain("validateParcelPresetBody(req.body || {})");
  });
});

describe("parcel-presets endpoint — round-trips through the NEW capacity columns packingEngine reads (§2.4)", () => {
  it("writes usable_weight_oz/max_bags/usable_volume_in3/thermal_pack_space_in3/max_livestock, not the legacy dimension-only columns", () => {
    const insertIdx = SOURCE.indexOf('async function handleParcelPresets(req, res) {');
    const block = SOURCE.slice(insertIdx, insertIdx + 4000);
    for (const column of [
      "usable_weight_oz",
      "max_bags",
      "usable_volume_in3",
      "thermal_pack_space_in3",
      "max_livestock",
    ]) {
      expect(block).toContain(column);
    }
  });
});
