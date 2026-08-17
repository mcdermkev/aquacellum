/**
 * An unknown birth date must reach the chain as 0, not as "today".
 *
 * THE BUG. Both mint paths in services/relayer.js stored the honest `0` in Dexie
 * but sent something else on-chain:
 *
 *     birthTimestamp: birthTimestamp || Math.floor(Date.now() / 1000),   // single
 *     birthTimestamp: createdAt,                                        // importer
 *
 * So "I don't know when this fish was born" became the permanent claim "born at the
 * moment of registration". The local row and the chain then disagreed forever —
 * AquadexStorage.sol's `Specimen` has no setter, and a certificate is meant to
 * outlive this app. Downstream it surfaced as an adult bought from a shop reading
 * as "0 Days Old (Fry)", which is what the beta report described.
 *
 * The contract never required this: the struct documents the field as
 * `birthTimestamp // 0 if unknown/wild-caught`. Only the client was fabricating.
 * services/cohortPromotion.js already guards the same mistake for hatch dates and
 * says why in a comment.
 *
 * These are source-level assertions for the same reason cohortPromotion.test.js
 * uses one: the value is passed into a fire-and-forget on-chain queue, so there is
 * no return value to inspect, and the failure is silent and permanent.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const here = dirname(fileURLToPath(import.meta.url));
const RELAYER = readFileSync(join(here, "..", "services", "relayer.js"), "utf8");

/** Strip comments so the explanatory notes can quote the old code freely. */
function code(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const RELAYER_CODE = code(RELAYER);

describe("relayer never fabricates a birth date for the chain", () => {
  it("does not fall back to Date.now() for birthTimestamp", () => {
    // The exact shape of the original defect.
    expect(RELAYER_CODE).not.toMatch(/birthTimestamp:\s*birthTimestamp\s*\|\|\s*Math\.floor\(Date\.now/);
    expect(RELAYER_CODE).not.toMatch(/birthTimestamp:\s*Math\.floor\(Date\.now\(\)\s*\/\s*1000\)/);
  });

  it("does not send the import batch's createdAt as a birth date", () => {
    // The importer never asks for ages, so createdAt is "when the CSV was
    // uploaded" — a different fact wearing the same type.
    expect(RELAYER_CODE).not.toMatch(/birthTimestamp:\s*createdAt\b/);
  });

  it("passes an unknown date through as 0 in both mint paths", () => {
    const matches = RELAYER_CODE.match(/birthTimestamp:\s*Number\([^)]*\)\s*\|\|\s*0/g) || [];
    // One in relayMintSpecimen, one in relayImportSpecimens.
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });

  it("still records provenance and life stage on the specimen row", () => {
    // The replacement for a fabricated date is real information, honestly scoped:
    // where the fish came from, and what stage it is at.
    expect(RELAYER_CODE).toMatch(/provenance:\s*normalizeProvenance\(/);
    expect(RELAYER_CODE).toMatch(/lifeStage:\s*normalizeLifeStage\(/);
  });

  it("defaults an imported row to unverified rather than leaving origin blank", () => {
    // An imported row is stock the keeper already had from elsewhere, and the
    // importer deliberately sets sireId/damId to 0 — so unverified is the accurate
    // reading, not a placeholder.
    expect(RELAYER_CODE).toMatch(/normalizeProvenance\(s\.provenance\)\s*\|\|\s*PROVENANCE\.UNVERIFIED/);
  });
});

describe("the honest-unknown rule is not re-broken elsewhere in the relayer", () => {
  it("no birth date anywhere in the relayer is read from the clock", () => {
    // Found a third instance of the habit while writing this: relayCreateSpawn
    // called Math.floor(Date.now()/1000) per offspring INSIDE the mint loop, so
    // siblings from one spawn drifted apart by however long the loop ran. It now
    // stamps the spawn's own timestamp, matching cohortPromotion.js.
    const fabrications = RELAYER_CODE.match(/birthTimestamp:\s*[^,\n]*Date\.now/g) || [];
    expect(fabrications).toEqual([]);
  });

  it("spawn offspring inherit the spawn's timestamp", () => {
    expect(RELAYER_CODE).toMatch(/birthTimestamp:\s*spawn\.timestamp/);
  });
});
