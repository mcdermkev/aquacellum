/**
 * Component-level guards for the Task 25 `?action=pickup-locations` /
 * `pickup-for-order` / `pickup-arrange` / `pickup-confirm` routes added to
 * frontend/api/storefront-detail.js
 * (docs/TASK_25_PICKUP_COORDINATION_SPEC.md §6 acceptance criteria 6-8:
 * every write derives the wallet from the session, never the body;
 * unauthenticated -> 401; pickup-for-order enforces the caller is the buyer
 * or seller on the order before revealing exact coordinates; the
 * arrange/confirm endpoints contain no settlement/inventory calls).
 *
 * storefront-detail.js pulls in @supabase/supabase-js and other server-only
 * deps, so — matching the established source-guard convention
 * (sectionsEndpoint.catalog.test.js, promotionsEndpoint.catalog.test.js) —
 * this asserts the contract statically over the comment-stripped source.
 * Lives under src/__tests__/ (not api/) because vite.config.js's vitest
 * `include` only scans `src/**\/*.test.{js,jsx}`.
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
  readFileSync(fileURLToPath(new URL("../../api/storefront-detail.js", import.meta.url)), "utf8")
);

describe("pickup actions — registered distinctly from the existing storefront actions", () => {
  it("routes all four pickup actions to their handlers", () => {
    expect(SOURCE).toContain('case "pickup-locations":');
    expect(SOURCE).toContain("return handlePickupLocations(req, res);");
    expect(SOURCE).toContain('case "pickup-for-order":');
    expect(SOURCE).toContain("return handlePickupForOrder(req, res);");
    expect(SOURCE).toContain('case "pickup-arrange":');
    expect(SOURCE).toContain("return handlePickupArrange(req, res);");
    expect(SOURCE).toContain('case "pickup-confirm":');
    expect(SOURCE).toContain("return handlePickupConfirm(req, res);");
  });
});

// ─── Acceptance criterion 6: wallet from session only, unauthenticated -> 401 ─

describe("every pickup handler derives the wallet from the session, never the body", () => {
  const handlerNames = [
    "handlePickupLocations",
    "handlePickupForOrder",
    "handlePickupArrange",
    "handlePickupConfirm",
  ];

  it.each(handlerNames)("%s calls requireWalletFromSession before any read/write", (name) => {
    const idx = SOURCE.indexOf(`async function ${name}(req, res) {`);
    expect(idx).toBeGreaterThan(-1);
    const block = SOURCE.slice(idx, idx + 1200);
    expect(block).toContain("await requireWalletFromSession(req, res)");
    expect(block).toContain("if (!wallet) return;");
  });

  it("none of the pickup handlers read a wallet from req.body or req.query", () => {
    const idx = SOURCE.indexOf("async function handlePickupLocations(req, res) {");
    const endIdx = SOURCE.indexOf("// ═", SOURCE.indexOf("async function handlePickupConfirm(req, res) {"));
    const block = SOURCE.slice(idx, endIdx > -1 ? endIdx : idx + 12000);
    expect(block).not.toMatch(/req\.body\??\.\s*wallet(?!Address\s*:\s*wallet)/i);
    expect(block).not.toMatch(/req\.query\??\.\s*wallet\b/i);
  });

  it("requireWalletFromSession (reused from Task 21A) verifies the Privy token and 401s on failure", () => {
    const idx = SOURCE.indexOf("async function requireWalletFromSession(req, res) {");
    expect(idx).toBeGreaterThan(-1);
    const block = SOURCE.slice(idx, idx + 700);
    expect(block).toContain("await verifyPrivyToken(req)");
    expect(block).toMatch(/res\.status\(401\)/);
    expect(block).toContain("return walletAddress.toLowerCase()");
  });
});

// ─── Acceptance criterion 7: order-scoped reveal gate ───────────────────────

describe("handlePickupForOrder — enforces the caller is the buyer or seller on the order", () => {
  it("resolves the order via loadOrderForPickup before revealing anything", () => {
    const idx = SOURCE.indexOf("async function handlePickupForOrder(req, res) {");
    expect(idx).toBeGreaterThan(-1);
    const block = SOURCE.slice(idx, idx + 1600);
    expect(block).toContain("await loadOrderForPickup(");
    expect(block).toMatch(/res\.status\(404\)/);
  });

  it("403s when the caller's wallet is neither the order's buyer nor seller", () => {
    const idx = SOURCE.indexOf("async function handlePickupForOrder(req, res) {");
    const block = SOURCE.slice(idx, idx + 1600);
    expect(block).toContain("orderRow.buyer_wallet");
    expect(block).toContain("orderRow.seller_wallet");
    expect(block).toMatch(/wallet !== buyerWallet && wallet !== sellerWallet/);
    expect(block).toMatch(/res\.status\(403\)/);
  });

  it("resolveOrderByRef routes each ref to a type-compatible column, never a non-uuid into id.eq", () => {
    const idx = SOURCE.indexOf("async function resolveOrderByRef(");
    expect(idx).toBeGreaterThan(-1);
    const block = SOURCE.slice(idx, idx + 1000);
    expect(block).toContain('.from("orders")');
    // Resolves across all three identity columns (uuid id / numeric local_key
    // / text stripe_session_id) via type-appropriate single-column lookups...
    expect(block).toMatch(/\.eq\("id",/);
    expect(block).toMatch(/\.eq\("local_key",/);
    expect(block).toMatch(/\.eq\("stripe_session_id",/);
    // ...but guards the uuid column so a non-uuid ref (a Dexie local_key or a
    // stripe session id) never lands in an id.eq comparison. PostgREST 400s
    // "invalid input syntax for type uuid/integer" on a mixed query otherwise,
    // which would 404 every legacy-ref lookup (verified against the live DB).
    expect(block).toMatch(/ORDER_UUID_RE/);
  });

  it("loadOrderForPickup delegates to the shared type-routed resolveOrderByRef", () => {
    const idx = SOURCE.indexOf("async function loadOrderForPickup(");
    expect(idx).toBeGreaterThan(-1);
    const block = SOURCE.slice(idx, idx + 160);
    expect(block).toMatch(/resolveOrderByRef\(/);
  });
});

describe("handlePickupArrange / handlePickupConfirm — role-scoped, not just order-scoped", () => {
  it("handlePickupArrange rejects a caller who is not the order's buyer", () => {
    const idx = SOURCE.indexOf("async function handlePickupArrange(req, res) {");
    expect(idx).toBeGreaterThan(-1);
    const block = SOURCE.slice(idx, idx + 2500);
    expect(block).toMatch(/wallet !== buyerWallet/);
    expect(block).toMatch(/res\.status\(403\)/);
  });

  it("handlePickupConfirm rejects a caller who is not the order's seller", () => {
    const idx = SOURCE.indexOf("async function handlePickupConfirm(req, res) {");
    expect(idx).toBeGreaterThan(-1);
    const block = SOURCE.slice(idx, idx + 2500);
    expect(block).toMatch(/wallet !== sellerWallet/);
    expect(block).toMatch(/res\.status\(403\)/);
  });

  it("handlePickupArrange re-validates the proposed time server-side via validateProposedTime (never trusts the client)", () => {
    const idx = SOURCE.indexOf("async function handlePickupArrange(req, res) {");
    const block = SOURCE.slice(idx, idx + 3500);
    expect(block).toContain("validateProposedTime(");
    expect(block).toMatch(/res\.status\(422\)/);
  });

  it("handlePickupConfirm re-validates a seller counter-time the same way", () => {
    const idx = SOURCE.indexOf("async function handlePickupConfirm(req, res) {");
    const block = SOURCE.slice(idx, idx + 3500);
    expect(block).toContain("validateProposedTime(");
  });
});

// ─── Acceptance criterion 8: no settlement/inventory calls in this section ──

describe("Task 25 pickup section — Guardrail 1 (no settlement/inventory/escrow writes)", () => {
  it("contains none of the forbidden settlement/reservation/refund/escrow call patterns", () => {
    // Comments (including the section's own header banner) are stripped by
    // stripComments() above, so anchor on the first actual code symbol of
    // the section (the pickupLocationRowToClient helper) through to the
    // last pickup handler, rather than the (now-removed) comment banner.
    const startIdx = SOURCE.indexOf("function pickupLocationRowToClient(row) {");
    expect(startIdx).toBeGreaterThan(-1);
    const helpersIdx = SOURCE.indexOf("function truncateAddr(addr) {");
    const endIdx = helpersIdx > -1 ? helpersIdx : SOURCE.length;
    const section = SOURCE.slice(startIdx, endIdx);

    // Grep-guard: none of these settlement/inventory verbs appear as calls
    // anywhere in the pickup section (comments describing the guardrail are
    // fine — they're stripped above — but no actual invocation is allowed).
    expect(section).not.toMatch(/\brelease[A-Za-z]*\s*\(/);
    expect(section).not.toMatch(/\bsettle[A-Za-z]*\s*\(/);
    expect(section).not.toMatch(/\breserve[A-Za-z]*\s*\(/);
    expect(section).not.toMatch(/\brefund[A-Za-z]*\s*\(/);
    expect(section).not.toMatch(/\bescrow[A-Za-z]*\s*\(/);
    expect(section).not.toContain('.from("canonical_orders")');
    expect(section).not.toContain('.from("canonical_reservations")');
    expect(section).not.toContain('.from("fiat_settlements")');

    // The only write to `orders` allowed in this section is a READ (select)
    // to resolve identity/authorization — never an update/insert/delete.
    const ordersWriteMatches = section.match(/\.from\("orders"\)[^;]*?\.(update|insert|delete)\(/g) || [];
    expect(ordersWriteMatches).toHaveLength(0);
  });

  it("imports pickupCoordination.js's pure validators rather than re-deriving the logic inline", () => {
    const normalized = SOURCE.replace(/\s+/g, " ");
    expect(normalized).toMatch(/import\s*\{\s*normalizePickupLocation,\s*validatePickupLocationDraft,\s*validateProposedTime,?\s*\}\s*from\s*"\.\.\/src\/services\/pickupCoordination\.js"/);
  });
});

describe("handlePickupLocations — owner-scoped CRUD, ownership re-checked before every mutation", () => {
  it("PUT and DELETE both re-check the target row's wallet_address before writing", () => {
    const idx = SOURCE.indexOf("async function handlePickupLocations(req, res) {");
    expect(idx).toBeGreaterThan(-1);
    const block = SOURCE.slice(idx, idx + 4500);
    const ownershipChecks = block.match(/existing\.wallet_address !== wallet/g) || [];
    expect(ownershipChecks.length).toBeGreaterThanOrEqual(2); // PUT + DELETE
  });

  it("validates every write via validatePickupLocationDraft before insert/update", () => {
    const idx = SOURCE.indexOf("async function handlePickupLocations(req, res) {");
    const block = SOURCE.slice(idx, idx + 4500);
    const validationCalls = block.match(/validatePickupLocationDraft\(draft\)/g) || [];
    expect(validationCalls.length).toBeGreaterThanOrEqual(2); // POST + PUT
  });
});
