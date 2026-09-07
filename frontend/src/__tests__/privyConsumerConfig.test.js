import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const consumerFiles = [
  "../../api/cart.js",
  "../../api/_lib/speciesCuration.js",
  "../../api/_lib/aiAccess.js",
  "../../api/_lib/attestPedigree.js",
  "../../api/validate-xp.js",
  "../../api/relay-transaction.js",
  "../../api/storefront-detail.js",
  "../../api/stripe.js",
  "../../api/_lib/showcaseAuth.js",
];

function source(relativePath) {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

function count(text, pattern) {
  return [...text.matchAll(pattern)].length;
}

describe("shared Privy consumers preserve configuration failures", () => {
  for (const relativePath of consumerFiles) {
    it(`${relativePath} guards every verifier call before continuing`, () => {
      const text = source(relativePath);
      const verifierCalls = count(text, /await verifyPrivyToken\(/g);
      const configurationGuards =
        count(text, /respondToPrivyConfigurationFailure\(/g)
        + count(text, /isPrivyConfigurationFailure\(/g);

      expect(verifierCalls, `${relativePath} must use the shared verifier`).toBeGreaterThan(0);
      expect(
        configurationGuards,
        `${relativePath} has an unguarded Privy verifier call`,
      ).toBe(verifierCalls);
    });
  }

  it("guards checkout and both release paths before money or inventory effects", () => {
    const stripe = source("../../api/stripe.js");

    expect(stripe).toMatch(
      /const checkoutAuth = await verifyPrivyToken\(req\);\s+if \(respondToPrivyConfigurationFailure\(checkoutAuth, res\)\) return;/,
    );
    expect(stripe).toMatch(
      /const releaseAuth = await verifyPrivyToken\(req\);\s+if \(respondToPrivyConfigurationFailure\(releaseAuth, res\)\) return;/,
    );
    expect(stripe).toMatch(
      /const releaseV2Auth = await verifyPrivyToken\(req\);\s+if \(respondToPrivyConfigurationFailure\(releaseV2Auth, res\)\) return;/,
    );
  });

  it("keeps mint-session's pre-verification configuration gate", () => {
    const mint = source("../../api/mint-session.js");
    expect(mint).toMatch(
      /const privyConfig = getPrivyAuthConfiguration\(\);\s+if \(!privyConfig\.configured\)/,
    );
    expect(mint).toContain('authResult.code === "PRIVY_APP_ID_MISSING"');
    expect(mint).toContain('authResult.code === "PRIVY_APP_ID_INVALID"');
  });
});
