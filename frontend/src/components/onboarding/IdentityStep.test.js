/**
 * Component tests for the Privy-only IdentityStep (onboarding-revamp task 6.3).
 *
 * This project's vitest runs in a `node` environment (no jsdom / testing-library),
 * and `IdentityStep.jsx` transitively imports AuthContext → @privy-io/react-auth →
 * the `window.ethers` shim, which cannot be imported under node. So we verify the
 * "no MetaMask control renders — only the Privy CTA" requirement (Req 5.1) two
 * complementary ways:
 *   1. The persona-aware copy surface (`IDENTITY_COPY` / `resolveCopy`, the pure
 *      module the component renders from) exposes ONLY a Privy logbook/node CTA
 *      and contains no MetaMask / external-wallet wording.
 *   2. A static guard over the component source asserts the JSX renders a single
 *      Privy CTA and references neither MetaMask nor an external-wallet link.
 *
 * Validates: Requirements 5.1
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

import { IDENTITY_COPY, resolveCopy } from "./identityCopy.js";

/** Strip block and line comments so source assertions inspect real code, not
 * documentation (the component's docs intentionally mention MetaMask to explain
 * its deliberate absence). */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const IDENTITY_STEP_SOURCE = readFileSync(
  fileURLToPath(new URL("./IdentityStep.jsx", import.meta.url)),
  "utf8"
);
const IDENTITY_STEP_CODE = stripComments(IDENTITY_STEP_SOURCE);

describe("IdentityStep copy surface — Privy only (Req 5.1)", () => {
  it("exposes a single Privy CTA with persona-aware logbook/node wording", () => {
    expect(resolveCopy(IDENTITY_COPY.cta, true)).toBe("Create My Logbook");
    expect(resolveCopy(IDENTITY_COPY.cta, false)).toBe("Initialize Node");
  });

  it("never surfaces MetaMask or external-wallet wording in any copy entry", () => {
    const allCopy = JSON.stringify(IDENTITY_COPY).toLowerCase();
    expect(allCopy).not.toContain("metamask");
    expect(allCopy).not.toContain("external wallet");
    expect(allCopy).not.toContain("link wallet");
    expect(allCopy).not.toContain("seed phrase");
  });

  it("defaults to the casual (friendly) tone when persona is unknown", () => {
    expect(resolveCopy(IDENTITY_COPY.cta, null)).toBe("Create My Logbook");
    expect(resolveCopy(IDENTITY_COPY.ctaBusy, null)).toBe(
      "Setting up your logbook…"
    );
  });
});

describe("IdentityStep render surface — no MetaMask control (Req 5.1)", () => {
  it("renders exactly one auth button (the Privy CTA)", () => {
    const buttonCount = (IDENTITY_STEP_CODE.match(/<button/g) || []).length;
    expect(buttonCount).toBe(1);
    expect(IDENTITY_STEP_CODE).toContain("onboarding-privy-btn");
    expect(IDENTITY_STEP_CODE).toContain("connectPrivy");
  });

  it("does not render a MetaMask or external-wallet control", () => {
    expect(IDENTITY_STEP_CODE).not.toMatch(/connectMetaMask/);
    expect(IDENTITY_STEP_CODE).not.toMatch(/metamask/i);
    expect(IDENTITY_STEP_CODE).not.toMatch(/external.*wallet/i);
  });
});
