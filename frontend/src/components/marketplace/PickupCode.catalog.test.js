/**
 * Component-level guards for PickupCode.jsx (Task 15, buyer surface).
 *
 * This project's vitest runs in a `node` environment (no jsdom /
 * testing-library) — see vite.config.js `test.environment: 'node'` — and
 * PickupCode.jsx transitively imports browser-only APIs (qrcode's canvas
 * rendering, navigator.clipboard). Following the established pattern for
 * component tests in this codebase (ListSpecimenModal.catalog.test.js,
 * BreederTerminal.catalog.test.js), we verify the behavioral contract via
 * static source guards over the comment-stripped source.
 *
 * Covers docs/TASK_15_CASH_PICKUP_UI_SPEC.md §7 (buyer acceptance criteria)
 * and §8 (buyer PickupCode source-guard).
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
  readFileSync(fileURLToPath(new URL("./PickupCode.jsx", import.meta.url)), "utf8")
);

describe("PickupCode — calls only the two existing verified service functions", () => {
  it("imports issueCashHandoff from stripePayments and calls it (no bespoke fetch/signing)", () => {
    expect(SOURCE).toContain('import { issueCashHandoff } from "../../services/stripePayments"');
    expect(SOURCE).toContain("issueCashHandoff({ tokenId, buyerWallet })");
  });

  it("does not build its own fetch, sign anything, or parse a nonce", () => {
    expect(SOURCE).not.toMatch(/\bfetch\(/);
    expect(SOURCE).not.toContain("signPersonalMessage");
    expect(SOURCE).not.toMatch(/parseHandoffNonce|\.nonce\b/);
  });
});

describe("PickupCode — renders the QR locally/offline, never via a third-party image API", () => {
  it("imports QRCode from qrcode and calls QRCode.toCanvas", () => {
    expect(SOURCE).toContain('import QRCode from "qrcode"');
    expect(SOURCE).toContain("QRCode.toCanvas(canvasRef.current, token");
  });

  it("never uses an external QR image service URL", () => {
    expect(SOURCE).not.toContain("api.qrserver.com");
    expect(SOURCE).not.toMatch(/<img[^>]*qrUrl/);
  });
});

describe("PickupCode — expiry countdown + reissue", () => {
  it("derives isExpired from the returned expiresAt and offers a reissue action on expiry", () => {
    expect(SOURCE).toContain("isExpired");
    expect(SOURCE).toMatch(/Get a new code|Reissue code/);
    expect(SOURCE).toContain("onClick={requestCode}");
  });

  it("announces the countdown politely for screen readers", () => {
    expect(SOURCE).toContain('aria-live="polite"');
  });
});

describe("PickupCode — copyable text fallback (accessible, non-camera path)", () => {
  it("renders the raw token in a readonly, selectable text input", () => {
    expect(SOURCE).toMatch(/readOnly[\s\S]{0,40}value=\{token\}/);
  });

  it("offers a copy-to-clipboard action", () => {
    expect(SOURCE).toContain("navigator.clipboard.writeText(token)");
  });
});

describe("PickupCode — no-protection disclosure and Web2 language", () => {
  it("shows the shared cashNoProtectionDisclosure copy rather than inventing parallel text", () => {
    expect(SOURCE).toContain('import { cashNoProtectionDisclosure } from "../../services/orderCopy"');
    expect(SOURCE).toContain("cashNoProtectionDisclosure({ casual })");
  });
});

describe("PickupCode — never entitlement-gated (Task 6/15 §5, REQUIRED capability)", () => {
  it("contains no hasEntitlement gate anywhere in the component", () => {
    expect(SOURCE).not.toMatch(/hasEntitlement/);
  });
});

describe("PickupCode — accessible dialog via the shared Modal component", () => {
  it("composes the shared Modal rather than reimplementing dialog semantics", () => {
    expect(SOURCE).toContain('import { Modal } from "../Modal"');
    expect(SOURCE).toContain("<Modal isOpen={isOpen} onClose={onClose}");
  });
});
