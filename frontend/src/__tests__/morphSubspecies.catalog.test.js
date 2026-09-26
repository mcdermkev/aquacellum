import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Source-level invariants for the morph → sub-species promotion path. This
// path spends the on-chain curator key, so the checks that keep it safe must not
// silently regress. See docs/MORPH_SUBSPECIES_PROMOTION_SPEC.md.

function source(relativePath) {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}
function stripComments(value) {
  return value
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const API = stripComments(source("../../api/validate-xp.js"));
const CLIENT = stripComments(source("../services/morphSubmissionsApi.js"));
const AUTH = stripComments(source("../contexts/AuthContext.jsx"));
const MIGRATION = stripComments(
  source("../../../supabase/migrations/20260830120000_morph_subspecies.sql")
);
const RESEND = stripComments(source("../../api/_lib/resend.js"));

describe("morph promotion — on-chain safety", () => {
  it("uses the CORRECT int16 temperature ABI, never uint16 (selector must match)", () => {
    // The species-suggestion pipeline declares uint16 here, which is a latent
    // selector mismatch. The morph path must use int16 to actually call addSpecies.
    expect(API).toContain("int16 minTempCelsiusX10, int16 maxTempCelsiusX10");
    // Guard the specific wrong signature from creeping in via copy-paste.
    expect(API).not.toContain("uint16 minTempCelsiusX10");
  });

  it("verifies the signer holds curator rights before spending gas", () => {
    expect(API).toContain("signer.address.toLowerCase()");
    expect(API).toContain("does not hold curator rights");
  });

  it("only promotes a VERIFIED morph and is idempotent once promoted", () => {
    expect(API).toContain('morph.status === "promoted"');
    expect(API).toContain('morph.status !== "verified"');
  });

  it("dedupes strains by (base, name) — NOT by scientific name", () => {
    // Strains deliberately share the base species' scientific name, so a
    // scientific-name dedupe would wrongly reject every strain.
    expect(API).toContain('.from("species_strains")');
    expect(API).toContain(".eq(\"base_species_id\", baseSpeciesId)");
  });
});

describe("morph curation — authorization", () => {
  it("authorizes by Privy token + curation role, not a body-supplied wallet", () => {
    expect(API).toContain("requireVerifiedWallet");
    expect(API).toContain("getActiveRoles");
    expect(API).toContain('CURATION_ROLES = ["founder", "curator"]');
    // The old weak check (trusting body callerWallet vs on-chain curator) is gone.
    expect(API).not.toContain("callerWallet.toLowerCase() !== curator");
  });

  it("review only sets verified/rejected (promotion is a separate gated action)", () => {
    expect(API).toContain('REVIEW_STATUSES = ["verified", "rejected"]');
  });

  it("client sends the Privy bearer token on privileged calls", () => {
    expect(CLIENT).toContain("authHeaders");
    expect(CLIENT).toContain("setSessionTokenGetter");
    expect(CLIENT).not.toContain("callerWallet");
  });

  it("AuthContext registers and clears the morph token getter", () => {
    expect(AUTH).toContain("setMorphSessionTokenGetter(getAccessToken)");
    expect((AUTH.match(/setMorphSessionTokenGetter\(null\)/g) || []).length).toBeGreaterThanOrEqual(2);
  });
});

describe("morph promotion — schema & notifications", () => {
  it("widens the status CHECK to include 'promoted'", () => {
    expect(MIGRATION).toContain("'pending', 'verified', 'rejected', 'promoted'");
  });

  it("creates the off-chain parent link table with a base+name uniqueness guard", () => {
    expect(MIGRATION).toContain("CREATE TABLE IF NOT EXISTS species_strains");
    expect(MIGRATION).toContain("idx_species_strains_base_name");
    expect(MIGRATION).toContain("lower(strain_name)");
  });

  it("grants the curator role to the founder-email reviewers", () => {
    expect(MIGRATION).toContain("'curator'");
    expect(MIGRATION).toContain("founder_emails");
  });

  it("notifies via dispatch_notification but never lets it block the write", () => {
    expect(MIGRATION).toContain("dispatch_notification");
    expect(MIGRATION).toContain("EXCEPTION WHEN OTHERS THEN");
  });

  it("has a transactional email template for every morph lifecycle state", () => {
    expect(RESEND).toContain("export function morphReviewTemplate");
    for (const kind of ["submitted", "verified", "promoted"]) {
      expect(RESEND).toContain(`kind === "${kind}"`);
    }
  });
});
