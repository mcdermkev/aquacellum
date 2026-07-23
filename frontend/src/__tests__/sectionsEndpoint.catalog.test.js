/**
 * Component-level guards for the Task 21A `?action=sections` route added to
 * frontend/api/storefront-detail.js (docs/TASK_21A_MERCHANDISING_SPEC.md §6
 * acceptance criterion 5: "the `?action=sections` write path derives the
 * wallet from the session (`verifyPrivyToken`/`requireWalletFromSession`),
 * never the request body, and rejects unauthenticated").
 *
 * storefront-detail.js pulls in @supabase/supabase-js and other server-only
 * deps, so — matching the established source-guard convention
 * (parcelPresetsEndpoint.catalog.test.js, reviewsEndpoint.catalog.test.js) —
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

describe("sections action — registered distinctly from the existing storefront actions", () => {
  it("routes ?action=sections to handleSections", () => {
    expect(SOURCE).toContain('case "sections":');
    expect(SOURCE).toContain("return handleSections(req, res);");
  });
});

describe("handleSections — write path derives the wallet from the session, never the request body", () => {
  it("requireWalletFromSession calls verifyPrivyToken and returns the token's own walletAddress", () => {
    const idx = SOURCE.indexOf("async function requireWalletFromSession(req, res) {");
    expect(idx).toBeGreaterThan(-1);
    const block = SOURCE.slice(idx, idx + 700);
    expect(block).toContain("await verifyPrivyToken(req)");
    expect(block).toContain("return walletAddress.toLowerCase()");
    expect(block).not.toMatch(/req\.body\??\.\s*wallet/i);
    expect(block).not.toMatch(/req\.query\??\.\s*wallet/i);
  });

  it("rejects unauthenticated callers with 401", () => {
    const idx = SOURCE.indexOf("async function requireWalletFromSession(req, res) {");
    const block = SOURCE.slice(idx, idx + 700);
    expect(block).toMatch(/res\.status\(401\)/);
  });

  it("handleSections calls requireWalletFromSession before any write, for both POST and PUT", () => {
    const idx = SOURCE.indexOf("async function handleSections(req, res) {");
    expect(idx).toBeGreaterThan(-1);
    const block = SOURCE.slice(idx, idx + 2500);
    expect(block).toMatch(/req\.method === "POST" \|\| req\.method === "PUT"/);
    expect(block).toContain("await requireWalletFromSession(req, res)");
  });

  it("the delete-before-replace and insert are both scoped to the session-derived wallet, not a client-supplied id", () => {
    const idx = SOURCE.indexOf("async function handleSections(req, res) {");
    const block = SOURCE.slice(idx, idx + 3000);
    expect(block).toContain('.eq("wallet_address", wallet)');
    expect(block).toContain("wallet_address: wallet");
  });
});

describe("handleSections — validates the payload via validateSectionsPayload before writing", () => {
  it("imports validateSectionsPayload/normalizeSection from storeMerchandising.js", () => {
    const normalized = SOURCE.replace(/\s+/g, " ");
    expect(normalized).toMatch(/import\s*\{\s*normalizeSection,\s*validateSectionsPayload,\s*assembleStorefrontLayout,?\s*\}\s*from\s*"\.\.\/src\/services\/storeMerchandising\.js"/);
  });

  it("handleSections calls validateSectionsPayload and returns 400 on failure", () => {
    const idx = SOURCE.indexOf("async function handleSections(req, res) {");
    const block = SOURCE.slice(idx, idx + 2500);
    expect(block).toContain("validateSectionsPayload(sections)");
    expect(block).toMatch(/res\.status\(400\)/);
  });
});

describe("sections read — public, no auth required (storefronts are public)", () => {
  it("the GET branch of handleSections never calls requireWalletFromSession", () => {
    const idx = SOURCE.indexOf("async function handleSections(req, res) {");
    const getIdx = SOURCE.indexOf('if (req.method === "GET") {', idx);
    expect(getIdx).toBeGreaterThan(-1);
    const postIdx = SOURCE.indexOf('if (req.method === "POST"', idx);
    const getBlock = SOURCE.slice(getIdx, postIdx > -1 ? postIdx : getIdx + 800);
    expect(getBlock).not.toContain("requireWalletFromSession");
  });
});

describe("handleStorefrontDetail — folds pre-arranged sections into the default response", () => {
  it("fetches store_sections filtered to visible=true, ordered by sort_order", () => {
    const idx = SOURCE.indexOf("async function handleStorefrontDetail(req, res) {");
    expect(idx).toBeGreaterThan(-1);
    const block = SOURCE.slice(idx, idx + 3000);
    expect(block).toContain('.from("store_sections")');
    expect(block).toContain('.eq("visible", true)');
    expect(block).toContain('.order("sort_order"');
  });

  it("passes rawSections through assembleStorefrontLayout rather than re-deriving order/emptiness itself", () => {
    const idx = SOURCE.indexOf("async function handleStorefrontDetail(req, res) {");
    const block = SOURCE.slice(idx, idx + 6000);
    expect(block).toContain("assembleStorefrontLayout(null, listings, rawSections)");
  });
});
