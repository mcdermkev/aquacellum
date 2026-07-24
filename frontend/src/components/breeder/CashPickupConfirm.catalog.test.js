/**
 * Component-level guards for CashPickupConfirm.jsx (Task 15, seller surface).
 *
 * This project's vitest runs in a `node` environment (no jsdom /
 * testing-library) — see vite.config.js `test.environment: 'node'`.
 * Following the established pattern for component tests in this codebase
 * (BreederTerminal.catalog.test.js, ListSpecimenModal.catalog.test.js), we
 * verify the behavioral contract via static source guards over the
 * comment-stripped source.
 *
 * Covers docs/TASK_15_CASH_PICKUP_UI_SPEC.md §7 (seller acceptance criteria)
 * and §8 (seller CashPickupConfirm source-guard).
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
  readFileSync(fileURLToPath(new URL("./CashPickupConfirm.jsx", import.meta.url)), "utf8")
);

describe("CashPickupConfirm — calls only the existing verified confirmCashPickup service", () => {
  it("imports confirmCashPickup from stripePayments and calls it with the opaque token", () => {
    expect(SOURCE).toContain('import { confirmCashPickup } from "../../services/stripePayments"');
    expect(SOURCE).toContain("confirmCashPickup({ token })");
  });

  it("does not build its own fetch, sign anything, or touch the contract", () => {
    expect(SOURCE).not.toMatch(/\bfetch\(/);
    expect(SOURCE).not.toContain("signPersonalMessage");
  });
});

describe("CashPickupConfirm — must NOT use the legacy forgeable event-cash flow", () => {
  it("does not import or call relaySettleHandshake", () => {
    expect(SOURCE).not.toContain("relaySettleHandshake");
  });

  it("does not import the legacy HandshakeVerification component", () => {
    expect(SOURCE).not.toMatch(/from ["']\.\.\/HandshakeVerification["']/);
  });
});

describe("CashPickupConfirm — both a scan affordance and a manual paste path", () => {
  it("offers a camera scan affordance", () => {
    expect(SOURCE).toMatch(/getUserMedia|videoRef/);
  });

  it("offers a first-class manual paste field feeding confirmCashPickup", () => {
    expect(SOURCE).toContain("<textarea");
    expect(SOURCE).toContain("pastedToken");
  });

  it("treats the pasted value as an opaque token string, not JSON", () => {
    expect(SOURCE).not.toMatch(/JSON\.parse\(pastedToken/);
  });
});

describe("CashPickupConfirm — success and error handling", () => {
  it("shows an ownership-transferred confirmation on success with no payout AMOUNT/status copy", () => {
    expect(SOURCE).toMatch(/[Oo]wnership transferred/);
    // The component may clarify that cash sales carry no payout (a negative
    // statement), but must never show payout amount/status copy of the kind
    // shipping/prepaid-pickup surfaces use (e.g. "$X released", "paid out").
    expect(SOURCE).not.toMatch(/\$\{?\w*(amount|proceeds|cents)/i);
    expect(SOURCE).not.toMatch(/paid out to you|payout available|payout releases/i);
  });

  it("surfaces the server error message and allows retry", () => {
    expect(SOURCE).toContain("result.error");
    expect(SOURCE).toMatch(/disabled=\{loading \|\| !pastedToken\.trim\(\)\}/);
  });

  it("shows the shared no-protection reminder before confirming", () => {
    expect(SOURCE).toContain('import { cashNoProtectionDisclosure } from "../../services/orderCopy"');
    expect(SOURCE).toContain("cashNoProtectionDisclosure({ casual })");
  });
});

describe("CashPickupConfirm — never entitlement-gated (Task 6/15 §5, REQUIRED capability)", () => {
  it("contains no hasEntitlement gate anywhere in the component", () => {
    expect(SOURCE).not.toMatch(/hasEntitlement/);
  });
});

describe("CashPickupConfirm — accessible dialog via the shared Modal component", () => {
  it("composes the shared Modal rather than reimplementing dialog semantics", () => {
    expect(SOURCE).toContain('import { Modal } from "../Modal"');
    expect(SOURCE).toContain("<Modal isOpen={isOpen} onClose={onClose}");
  });

  it("respects prefers-reduced-motion for the scan animation", () => {
    expect(SOURCE).toContain('import { prefersReducedMotion } from "../../utils/a11y"');
    expect(SOURCE).toMatch(/!reducedMotion &&/);
  });
});
