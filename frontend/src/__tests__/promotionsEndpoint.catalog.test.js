/**
 * Component-level guards for the Task 21B `?action=promotions` /
 * `?action=segments` routes added to frontend/api/storefront-detail.js
 * (docs/TASK_21B_PROMOTIONS_SPEC.md §5/§6). Covers:
 *   - wallet derived from session, never the body (criterion 6)
 *   - ownership re-checked on mutations
 *   - money-safety: this router never touches stripe.js/checkout charge math
 *     (criterion 5, applied to the endpoint layer as well as the engine)
 *
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

const RAW_SOURCE = readFileSync(fileURLToPath(new URL("../../api/storefront-detail.js", import.meta.url)), "utf8");
const SOURCE = stripComments(RAW_SOURCE);

describe("promotions/segments actions — registered distinctly from the existing storefront actions", () => {
  it("routes ?action=promotions to handlePromotions and ?action=segments to handleSegments", () => {
    expect(SOURCE).toContain('case "promotions":');
    expect(SOURCE).toContain("return handlePromotions(req, res);");
    expect(SOURCE).toContain('case "segments":');
    expect(SOURCE).toContain("return handleSegments(req, res);");
  });
});

describe("handlePromotions — wallet derived from session, never the request body", () => {
  it("calls requireWalletFromSession before any read/write", () => {
    const idx = SOURCE.indexOf("async function handlePromotions(req, res) {");
    expect(idx).toBeGreaterThan(-1);
    const block = SOURCE.slice(idx, idx + 500);
    expect(block).toContain("await requireWalletFromSession(req, res)");
  });

  it("rejects unauthenticated callers with 401 (via the shared requireWalletFromSession)", () => {
    const idx = SOURCE.indexOf("async function requireWalletFromSession(req, res) {");
    expect(idx).toBeGreaterThan(-1);
    const block = SOURCE.slice(idx, idx + 700);
    expect(block).toMatch(/res\.status\(401\)/);
    expect(block).not.toMatch(/req\.body\??\.\s*wallet/i);
  });

  it("GET/POST/PUT/DELETE all read/write scoped to the session-derived wallet, not a client-supplied one", () => {
    const idx = SOURCE.indexOf("async function handlePromotions(req, res) {");
    const rowMapperIdx = SOURCE.indexOf("function promotionDraftToRow(draft, wallet) {", idx);
    const block = SOURCE.slice(idx, rowMapperIdx > -1 ? rowMapperIdx + 300 : idx + 6000);
    expect(block).toContain('.eq("wallet_address", wallet)');
    expect(block).toContain("wallet_address: wallet");
  });
});

describe("handlePromotions — ownership re-checked on every mutation (defense in depth)", () => {
  it("PUT verifies the existing row's wallet_address matches the session wallet before updating", () => {
    const idx = SOURCE.indexOf("async function handlePromotions(req, res) {");
    const putIdx = SOURCE.indexOf('if (req.method === "PUT") {', idx);
    expect(putIdx).toBeGreaterThan(-1);
    const block = SOURCE.slice(putIdx, putIdx + 1200);
    expect(block).toContain("existing.wallet_address !== wallet");
    expect(block).toMatch(/res\.status\(404\)/);
  });

  it("DELETE verifies the existing row's wallet_address matches the session wallet before deleting", () => {
    const idx = SOURCE.indexOf("async function handlePromotions(req, res) {");
    const delIdx = SOURCE.indexOf('if (req.method === "DELETE") {', idx);
    expect(delIdx).toBeGreaterThan(-1);
    const block = SOURCE.slice(delIdx, delIdx + 900);
    expect(block).toContain("existing.wallet_address !== wallet");
  });
});

describe("handlePromotions — validates the payload via validatePromotionDraft before writing", () => {
  it("imports validatePromotionDraft/normalizePromotion from promotionEngine.js", () => {
    expect(SOURCE).toContain('from "../src/services/promotionEngine.js"');
    expect(SOURCE).toContain("validatePromotionDraft");
    expect(SOURCE).toContain("normalizePromotion");
  });

  it("POST and PUT both call validatePromotionDraft and return 400 on failure", () => {
    const idx = SOURCE.indexOf("async function handlePromotions(req, res) {");
    const postIdx = SOURCE.indexOf('if (req.method === "POST") {', idx);
    const postBlock = SOURCE.slice(postIdx, postIdx + 400);
    expect(postBlock).toContain("validatePromotionDraft(draft)");

    const putIdx = SOURCE.indexOf('if (req.method === "PUT") {', idx);
    const putBlock = SOURCE.slice(putIdx, putIdx + 400);
    expect(putBlock).toContain("validatePromotionDraft(draft)");

    expect(postBlock + putBlock).toMatch(/res\.status\(400\)/);
  });
});

describe("handleSegments — public reads are never allowed (seller-scoped, session-authed)", () => {
  it("requires requireWalletFromSession before querying orders", () => {
    const idx = SOURCE.indexOf("async function handleSegments(req, res) {");
    expect(idx).toBeGreaterThan(-1);
    const block = SOURCE.slice(idx, idx + 700);
    expect(block).toContain("await requireWalletFromSession(req, res)");
  });

  it("scopes the orders query to the session wallet as seller_wallet, and delegates to buildCustomerSegments", () => {
    const idx = SOURCE.indexOf("async function handleSegments(req, res) {");
    const block = SOURCE.slice(idx, idx + 1200);
    expect(block).toContain('.eq("seller_wallet", wallet)');
    expect(block).toContain("buildCustomerSegments(");
  });

  it("imports buildCustomerSegments from customerSegments.js (no re-derived aggregation)", () => {
    expect(SOURCE).toContain('from "../src/services/customerSegments.js"');
  });
});

describe("storefront-detail.js — money-safety guard: promotions/segments code never touches checkout/charge math", () => {
  // Scoped to the Task 21B section specifically — the file's PRE-EXISTING
  // storefront-detail response legitimately links to
  // /api/stripe?action=create-checkout as a purchase-action URL (unrelated
  // to promotions), so the whole-file text "stripe" is not itself a signal.
  // Section markers live inside comments, so this operates on RAW_SOURCE
  // directly rather than the comment-stripped SOURCE.
  function promotionsSection() {
    const startIdx = RAW_SOURCE.indexOf("TASK 21B: PROMOTIONS & CUSTOMER SEGMENTS");
    expect(startIdx).toBeGreaterThan(-1);
    const endIdx = RAW_SOURCE.indexOf("Helpers", startIdx + 1000);
    return RAW_SOURCE.slice(startIdx, endIdx > -1 ? endIdx : undefined);
  }

  it("the Task 21B section never imports/calls into stripe.js or invokes handleCreateCheckout (prose mentions of either name, documenting the boundary, are fine)", () => {
    const section = promotionsSection();
    expect(section).not.toMatch(/from\s+["'].*stripe/i);
    expect(section).not.toMatch(/handleCreateCheckout\s*\(/);
  });

  it("the promotions section never writes used_count (that increment is a Tier A checkout-time concern)", () => {
    const section = promotionsSection();
    expect(section).not.toMatch(/used_count\s*(=|:)/);
  });
});
