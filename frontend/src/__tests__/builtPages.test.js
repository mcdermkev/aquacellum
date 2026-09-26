/**
 * Every page the site routes to must actually be built.
 *
 * Found 2026-09-26: checkout-success.html — Stripe's success_url for every guest
 * checkout (marketplace.html, tank.html) and the target of the /checkout/success
 * rewrite — was never a Vite rollup input, so it was not in dist/ and every buyer
 * landed on a Vercel 404 right after paying.
 */
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

const FRONTEND = fileURLToPath(new URL("../../", import.meta.url));
const VITE = readFileSync(`${FRONTEND}vite.config.js`, "utf8");
const VERCEL = JSON.parse(readFileSync(`${FRONTEND}vercel.json`, "utf8"));

const inputs = new Set([...VITE.matchAll(/resolve\(__dirname,\s*'([\w-]+\.html)'\)/g)].map((m) => m[1]));

describe("built pages", () => {
  it("builds every .html page a vercel.json rewrite points at", () => {
    const targets = (VERCEL.rewrites || [])
      .map((r) => r.destination)
      .filter((d) => /^\/[\w-]+\.html$/.test(d))
      .map((d) => d.slice(1));
    expect(targets.length).toBeGreaterThan(0);
    for (const page of targets) {
      expect(existsSync(`${FRONTEND}${page}`), `${page} is missing from frontend/`).toBe(true);
      expect(inputs.has(page), `${page} is routed in vercel.json but not a Vite input`).toBe(true);
    }
  });

  it("builds the pages Stripe and guest checkout send buyers to", () => {
    for (const page of ["checkout-success.html", "order.html", "tank.html"]) {
      expect(inputs.has(page), `${page} must be a Vite input`).toBe(true);
    }
  });
});
