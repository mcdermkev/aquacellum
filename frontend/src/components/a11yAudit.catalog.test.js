/**
 * Component-level guards for the Task 21D a11y-sweep fixes to two modal-like
 * surfaces that predated the shared accessible `Modal` component
 * (`ShippingRateModal.jsx`, `HandshakeVerification.jsx`): each now carries
 * dialog semantics (role="dialog"/aria-modal), an Escape-to-close handler,
 * initial focus into the dialog, and a labeled close button — matching
 * `Modal.jsx`'s own contract without a structural rewrite of either
 * form/camera-heavy component.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const SHIPPING_RATE_MODAL = stripComments(
  readFileSync(fileURLToPath(new URL("./ShippingRateModal.jsx", import.meta.url)), "utf8")
);
const HANDSHAKE_VERIFICATION = stripComments(
  readFileSync(fileURLToPath(new URL("./HandshakeVerification.jsx", import.meta.url)), "utf8")
);

describe("ShippingRateModal — dialog semantics + Escape-to-close (Task 21D)", () => {
  it("carries role=dialog, aria-modal, and an aria-label on the dialog element", () => {
    expect(SHIPPING_RATE_MODAL).toContain('role="dialog"');
    expect(SHIPPING_RATE_MODAL).toContain('aria-modal="true"');
    expect(SHIPPING_RATE_MODAL).toContain("aria-label={`Shipping options for");
  });

  it("closes on Escape via a keydown listener scoped to isOpen", () => {
    expect(SHIPPING_RATE_MODAL).toMatch(/e\.key === "Escape"/);
    expect(SHIPPING_RATE_MODAL).toContain('document.addEventListener("keydown", handleKeyDown)');
  });

  it("focuses the dialog on open", () => {
    expect(SHIPPING_RATE_MODAL).toContain("dialogRef.current?.focus()");
  });

  it("the close button is labeled, not icon-only", () => {
    expect(SHIPPING_RATE_MODAL).toContain('aria-label="Close shipping options"');
  });
});

describe("HandshakeVerification — dialog semantics + Escape-to-close (Task 21D)", () => {
  it("carries role=dialog, aria-modal, and an aria-label on the outer dialog element", () => {
    expect(HANDSHAKE_VERIFICATION).toContain('role="dialog"');
    expect(HANDSHAKE_VERIFICATION).toContain('aria-modal="true"');
    expect(HANDSHAKE_VERIFICATION).toContain('aria-label="In-person handshake verification"');
  });

  it("closes on Escape via a keydown listener scoped to isOpen", () => {
    expect(HANDSHAKE_VERIFICATION).toMatch(/e\.key === "Escape"/);
    expect(HANDSHAKE_VERIFICATION).toContain('document.addEventListener("keydown", handleKeyDown)');
  });

  it("focuses the dialog on open", () => {
    expect(HANDSHAKE_VERIFICATION).toContain("dialogRef.current?.focus()");
  });

  it("the close button is labeled, not icon-only", () => {
    expect(HANDSHAKE_VERIFICATION).toContain('aria-label="Close handshake verification"');
  });
});
