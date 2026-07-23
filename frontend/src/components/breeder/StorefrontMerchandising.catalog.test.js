/**
 * Component-level guards for StorefrontMerchandising.jsx (Task 21A).
 *
 * This project's vitest runs in a `node` environment (no jsdom) and this
 * component transitively imports browser-only dependencies, so — matching
 * the established pattern (CheckoutSummary.orders.test.js,
 * BreederTerminal.catalog.test.js) — the behavioral contract is verified via
 * static source guards over the comment-stripped source, complementing the
 * exhaustive pure-module tests in storeMerchandising.test.js.
 *
 * Covers docs/TASK_21A_MERCHANDISING_SPEC.md §6 criteria 4 (live preview
 * composes assembleStorefrontLayout) and 6 (keyboard reorder alternative).
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
  readFileSync(fileURLToPath(new URL("./StorefrontMerchandising.jsx", import.meta.url)), "utf8")
);

const TERMINAL_SOURCE = stripComments(
  readFileSync(fileURLToPath(new URL("./BreederTerminal.jsx", import.meta.url)), "utf8")
);

describe("StorefrontMerchandising — live preview composes assembleStorefrontLayout (§6.4)", () => {
  it("imports assembleStorefrontLayout from the pure core, not a re-derived ordering", () => {
    expect(SOURCE).toContain(
      'import {\n  assembleStorefrontLayout,'
    );
  });

  it("the preview renders through assembleStorefrontLayout's own output (useMemo over the exact fn)", () => {
    expect(SOURCE).toMatch(/useMemo\(\s*\(\)\s*=>\s*assembleStorefrontLayout\(null, listings, sections\)/);
  });

  it("does not re-sort or re-filter sections itself (no local sort_order comparator in the component)", () => {
    expect(SOURCE).not.toMatch(/\.sort\(\(a,\s*b\)\s*=>\s*a\.sortOrder/);
  });
});

describe("StorefrontMerchandising — keyboard reorder alternative to drag (§6.6, a11y)", () => {
  it("exposes up/down move buttons distinct from the drag handlers", () => {
    expect(SOURCE).toContain("moveSection(index, -1)");
    expect(SOURCE).toContain("moveSection(index, 1)");
  });

  it("the move buttons carry an aria-label (not icon-only, unlabeled)", () => {
    expect(SOURCE).toMatch(/aria-label=\{SECTION_COPY\.moveUp\}/);
    expect(SOURCE).toMatch(/aria-label=\{SECTION_COPY\.moveDown\}/);
  });

  it("disables the boundary move button (can't move the first section up / last section down)", () => {
    expect(SOURCE).toContain("disabled={index === 0}");
    expect(SOURCE).toContain("disabled={index === sections.length - 1}");
  });

  it("announces the reorder result for screen readers (not visual-only feedback)", () => {
    expect(SOURCE).toContain('import { announce, prefersReducedMotion } from "../../utils/a11y.js"');
    expect(SOURCE).toMatch(/announce\(`Moved/);
  });

  it("also supports pointer drag-to-reorder (both paths present, not drag-only)", () => {
    expect(SOURCE).toContain("draggable");
    expect(SOURCE).toContain("onDragStart");
    expect(SOURCE).toContain("onDragOver");
  });

  it("visibility toggle is labeled (not icon-only)", () => {
    expect(SOURCE).toMatch(/aria-label=\{section\.visible \? SECTION_COPY\.visibleLabel : SECTION_COPY\.hiddenLabel\}/);
  });

  it("respects prefersReducedMotion for the section transition", () => {
    expect(SOURCE).toContain("reducedMotion");
    expect(SOURCE).toContain("prefersReducedMotion()");
  });
});

describe("StorefrontMerchandising — write path goes through the authenticated sections API, not a re-implemented fetch", () => {
  it("imports fetchStoreSections/saveStoreSections from storeMerchandisingApi.js", () => {
    expect(SOURCE).toContain(
      'import { fetchStoreSections, saveStoreSections } from "../../services/storeMerchandisingApi";'
    );
  });

  it("blocks save when local validation fails (validateSectionDraft)", () => {
    expect(SOURCE).toContain("validateSectionDraft(section)");
    expect(SOURCE).toMatch(/disabled=\{saving \|\| !!validationError\}/);
  });
});

describe("BreederTerminal — mounts StorefrontMerchandising alongside StorefrontSetup in the Store section", () => {
  it("imports and renders StorefrontMerchandising when SECTIONS.STORE is active", () => {
    expect(TERMINAL_SOURCE).toContain(
      'import { StorefrontMerchandising } from "./StorefrontMerchandising";'
    );
    const idx = TERMINAL_SOURCE.indexOf("activeSection === SECTIONS.STORE");
    expect(idx).toBeGreaterThan(-1);
    const block = TERMINAL_SOURCE.slice(idx, idx + 700);
    expect(block).toContain("<StorefrontSetup");
    expect(block).toContain("<StorefrontMerchandising");
  });

  it("passes the seller's own filtered listings into the merchandising editor (composed, not refetched)", () => {
    const idx = TERMINAL_SOURCE.indexOf("<StorefrontMerchandising");
    const block = TERMINAL_SOURCE.slice(idx, idx + 200);
    expect(block).toContain("listings={sellerListings}");
  });
});
