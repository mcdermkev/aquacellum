/**
 * Component-level guards for the `listing_description` Poseidon intent added
 * to frontend/api/ai.js handlePoseidon (Task 9 Increment 2 §2.3). This is
 * the primary Opus review-gate item for this increment: the grounding
 * contract that keeps AI-drafted listing copy from fabricating care/health/
 * guarantee/lineage/price claims.
 *
 * ai.js pulls in Vertex AI client + rate limiter server-only deps, so —
 * matching the established source-guard convention — this asserts the
 * contract statically over the comment-stripped source. Lives under
 * src/__tests__/ because vite.config.js's vitest `include` only scans
 * `src/**\/*.test.{js,jsx}`, not `api/`.
 *
 * Covers spec §4 acceptance criterion 7 (component/integration guard for
 * "If an intent:'listing_description' branch is added to api/ai.js, assert
 * its system prompt forbids fabricated care/health/guarantee/lineage/price
 * claims").
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
  readFileSync(fileURLToPath(new URL("../../api/ai.js", import.meta.url)), "utf8")
);

describe("listing_description intent — routes to a dedicated handler before the conversational path", () => {
  it("checks intent === 'listing_description' and delegates before the message-required check", () => {
    const intentCheckIdx = SOURCE.indexOf("if (intent === 'listing_description') {");
    const messageCheckIdx = SOURCE.indexOf("if (!message || typeof message !== 'string')");
    expect(intentCheckIdx).toBeGreaterThan(-1);
    expect(messageCheckIdx).toBeGreaterThan(-1);
    expect(intentCheckIdx).toBeLessThan(messageCheckIdx);
    expect(SOURCE).toContain("return handleListingDescriptionDraft(req, res);");
  });
});

describe("listing_description intent — server re-sanitizes groundingFacts, never trusts the client (§2.3)", () => {
  it("defines an explicit allowed-keys whitelist", () => {
    expect(SOURCE).toContain("LISTING_DESCRIPTION_ALLOWED_KEYS");
    for (const key of [
      "commonName", "scientificName", "adultSizeCm", "temperament",
      "tempRangeCelsius", "phRange", "minVolumeGallons", "careLevel", "diet", "origin",
    ]) {
      expect(SOURCE).toContain(`"${key}"`);
    }
  });

  it("sanitizeGroundingFacts iterates ONLY the allowed-keys whitelist, dropping anything else", () => {
    const idx = SOURCE.indexOf("function sanitizeGroundingFacts(raw = {}) {");
    expect(idx).toBeGreaterThan(-1);
    const block = SOURCE.slice(idx, idx + 600);
    expect(block).toContain("for (const key of LISTING_DESCRIPTION_ALLOWED_KEYS)");
  });

  it("the request handler calls sanitizeGroundingFacts on the raw client payload before building the prompt", () => {
    const idx = SOURCE.indexOf("async function handleListingDescriptionDraft(req, res) {");
    expect(idx).toBeGreaterThan(-1);
    const block = SOURCE.slice(idx, idx + 2500);
    expect(block).toContain("sanitizeGroundingFacts(rawFacts)");
    // The prompt is built from the sanitized `facts`, not the raw body.
    expect(block).toMatch(/renderGroundingFactSheet\(facts\)/);
  });
});

describe("listing_description intent — system prompt forbids fabricated health/safety/guarantee/lineage/price claims", () => {
  it("LISTING_DESCRIPTION_SYSTEM_PROMPT explicitly forbids each fabrication category", () => {
    const idx = SOURCE.indexOf("const LISTING_DESCRIPTION_SYSTEM_PROMPT");
    expect(idx).toBeGreaterThan(-1);
    const promptBlock = SOURCE.slice(idx, idx + 2500);

    // Health status claims about the specific specimen.
    expect(promptBlock).toMatch(/Health status/i);
    // Safety/beginner-friendliness guarantees.
    expect(promptBlock).toMatch(/beginner-safe|hardy/i);
    // Live-arrival / DOA guarantees.
    expect(promptBlock).toMatch(/live-arrival|DOA/i);
    // Lineage/pedigree claims.
    expect(promptBlock).toMatch(/[Ll]ineage|pedigree/i);
    // Pricing/value claims.
    expect(promptBlock).toMatch(/price|discount|value claim/i);
    // Grounding restriction to only the supplied facts.
    expect(promptBlock).toMatch(/ONLY describe the facts given/i);
  });

  it("the request handler builds its prompt from LISTING_DESCRIPTION_SYSTEM_PROMPT, not the general POSEIDON_SYSTEM_PROMPT", () => {
    const idx = SOURCE.indexOf("async function handleListingDescriptionDraft(req, res) {");
    const block = SOURCE.slice(idx, idx + 2500);
    expect(block).toContain("LISTING_DESCRIPTION_SYSTEM_PROMPT");
    expect(block).not.toContain("POSEIDON_SYSTEM_PROMPT");
  });
});

describe("listing_description intent — graceful degradation, never blocks on AI unavailability", () => {
  it("returns a null description with an error/offline flag when Vertex isn't configured, rather than throwing", () => {
    const idx = SOURCE.indexOf("async function handleListingDescriptionDraft(req, res) {");
    const block = SOURCE.slice(idx, idx + 1500);
    expect(block).toMatch(/if \(!isVertexConfigured\(\)\) \{/);
    expect(block).toMatch(/description: null, offline: true/);
  });

  it("catches Gemini/network failures and responds 200 with description:null rather than a 5xx", () => {
    const idx = SOURCE.indexOf("async function handleListingDescriptionDraft(req, res) {");
    const block = SOURCE.slice(idx, idx + 4000);
    expect(block).toMatch(/catch \(error\) \{/);
    expect(block).toMatch(/res\.status\(200\)\.json\(\{ description: null/);
  });
});

describe("listing_description intent — rate limited independently from the conversational endpoint", () => {
  it("uses a distinct rate-limit key so drafting can't be starved by/starve chat traffic", () => {
    expect(SOURCE).toContain("poseidon-listing-desc:");
  });
});
