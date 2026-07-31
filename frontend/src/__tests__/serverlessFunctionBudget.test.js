/**
 * The Vercel serverless function budget (§9.35).
 *
 * WHAT HAPPENED. T3 shipped two new API routes, `api/attest-pedigree.js` and
 * `api/pedigree-keys.js`. That took `api/*.js` from 12 files to 14, and the production
 * deploy failed:
 *
 *     No more than 12 Serverless Functions can be added to a Deployment on the
 *     Hobby plan.
 *
 * **The build succeeded.** So did `vitest`, `eslint`, and `npm run build` — locally and
 * in CI. Nothing in the repository expressed the limit, so nothing could catch it, and
 * the handoff spent two sessions recording that the routes "404 in production" and
 * attributing it to not having deployed yet. They 404'd because the deployment that
 * would have contained them never succeeded.
 *
 * This test is the missing expression of that constraint. It is deliberately a
 * hard-coded number rather than something clever: the limit is a property of the
 * hosting plan, not of the code, and the only way it becomes visible before a deploy
 * is if somebody writes it down.
 *
 * `stripe.js`'s own header already said this ("Combines stripe-webhook and
 * stripe-connect-onboard into a single function to stay within Vercel Hobby plan's 12
 * serverless function limit"), and `services/parcelPresets.js` repeated it. The
 * knowledge existed in comments. Comments do not fail builds.
 */
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

/** Vercel Hobby's per-deployment limit. Raise this ONLY by changing plan. */
const HOBBY_FUNCTION_LIMIT = 12;

const apiDir = fileURLToPath(new URL("../../api", import.meta.url));

/**
 * Files Vercel turns into serverless functions.
 *
 * Only top-level `.js` in `api/`. Anything beginning with `_` is ignored by Vercel's
 * routing — which is what makes `api/_lib/` the place to put a handler that must not
 * cost a function slot.
 */
function functionFiles() {
  return readdirSync(apiDir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith(".js") && !e.name.startsWith("_"))
    .map((e) => e.name)
    .sort();
}

describe("the deployment fits on the hosting plan", () => {
  it(`ships no more than ${HOBBY_FUNCTION_LIMIT} serverless functions`, () => {
    const files = functionFiles();
    // The failure message lists them, because "you are over by one" is useless without
    // knowing what is in the budget.
    expect(
      files.length,
      `api/ has ${files.length} function files, limit is ${HOBBY_FUNCTION_LIMIT}:\n  ${files.join("\n  ")}\n\n` +
        `Fold the new one onto an existing function as an ?action= (see api/stripe.js's ` +
        `dispatcher) and move its handler to api/_lib/, which Vercel does not count.`
    ).toBeLessThanOrEqual(HOBBY_FUNCTION_LIMIT);
  });

  it("counts the same way Vercel does — top-level only, underscore excluded", () => {
    // If this assumption is wrong the budget above is meaningless, so it is asserted
    // rather than assumed: `_lib` holds more files than the entire budget, and the
    // project deployed fine at 12 top-level files, which is the proof.
    const libCount = readdirSync(fileURLToPath(new URL("../../api/_lib", import.meta.url)))
      .filter((n) => n.endsWith(".js")).length;
    expect(libCount).toBeGreaterThan(HOBBY_FUNCTION_LIMIT);
    expect(functionFiles().some((n) => n.startsWith("_"))).toBe(false);
  });

  it("keeps the pedigree handlers OUT of the function budget", () => {
    const files = functionFiles();
    expect(files).not.toContain("attest-pedigree.js");
    expect(files).not.toContain("pedigree-keys.js");
    // And they still exist, in the uncounted directory.
    const lib = readdirSync(fileURLToPath(new URL("../../api/_lib", import.meta.url)));
    expect(lib).toContain("attestPedigree.js");
    expect(lib).toContain("pedigreeKeys.js");
  });
});

describe("the moved handlers are actually reachable", () => {
  const stripe = readFileSync(fileURLToPath(new URL("../../api/stripe.js", import.meta.url)), "utf8");

  it("dispatches both pedigree actions from the stripe function", () => {
    // A handler in `_lib` with no dispatcher is worse than no handler: it looks
    // present, passes its own unit tests, and 404s in production.
    expect(stripe).toContain('case "attest-pedigree"');
    expect(stripe).toContain('case "pedigree-keys"');
    expect(stripe).toContain("./_lib/attestPedigree.js");
    expect(stripe).toContain("./_lib/pedigreeKeys.js");
  });

  it("has the client pointing at the action URLs, not the retired routes", () => {
    const transfer = readFileSync(
      fileURLToPath(new URL("../services/certificateTransfer.js", import.meta.url)), "utf8"
    );
    const attestation = readFileSync(
      fileURLToPath(new URL("../services/pedigreeAttestation.js", import.meta.url)), "utf8"
    );
    expect(transfer).toContain('ATTEST_URL = "/api/stripe?action=attest-pedigree"');
    expect(attestation).toContain('PEDIGREE_KEYS_URL = "/api/stripe?action=pedigree-keys"');
  });

  it("imports them dynamically, so a webhook does not pay jose's cold start", () => {
    // `api/stripe.js` is the busiest function in the project; the pedigree handlers
    // pull in `jose`. Static imports would load it on every Stripe webhook.
    expect(stripe).toMatch(/await import\("\.\/_lib\/attestPedigree\.js"\)/);
    expect(stripe).toMatch(/await import\("\.\/_lib\/pedigreeKeys\.js"\)/);
  });
});
