/**
 * finderPresentation.test.js — snapshot coverage for what a Fish Finder card
 * and species detail actually SAY (Fish Finder Rework, Task 11).
 *
 * ── Why these are data snapshots, not DOM snapshots ─────────────────────────
 * This project's vitest runs in the default `node` environment: there is no
 * jsdom/happy-dom and no @testing-library in package.json, and vite.config.js
 * declares no test environment. All 113 existing test files are built on that
 * assumption (see __tests__/localBreederMapPickups.catalog.test.js for the
 * established source-guard convention). Rendering SpeciesCardPremium /
 * CasualSpeciesDetail would mean adding two dependencies and a second testing
 * paradigm to the repo — a scope decision, not a mechanical one.
 *
 * So this snapshots the card's CONTENT CONTRACT instead: the resolved object a
 * card is handed and renders directly — verdict, chip label, headline, reasons,
 * availability line. That is where the regressions people care about actually
 * live (a fit rule flipping "Good fit" to "Not a fit", an availability string
 * losing its price, a chip label changing). A DOM snapshot of the same change
 * would tell us less, and mostly re-assert JSX structure.
 *
 * Snapshots alone can be rubber-stamped with `-u`, so each honesty-critical
 * rule ALSO has an explicit assertion below: those fail with a real message,
 * not a diff.
 */
import { describe, it, expect } from "vitest";
import { assessSpeciesFit, fitPresentationKind } from "../../services/speciesFit.js";
import {
  buildSpeciesAvailability,
  getAvailabilityFor,
  summarizeAvailability,
} from "../../services/speciesAvailability.js";
import { VERDICT_CHIP } from "../../services/speciesFit.js";
import { DETAIL_COPY, FINDER_COPY } from "./finderCopy.js";
import {
  ALL_RECORDS,
  ALL_AQUARIUMS,
  NEON,
  BETTA,
  OSCAR,
  GOLDFISH,
  SPARSE,
  LISTINGS,
} from "./__fixtures__/finderFixtures.js";

const availabilityIndex = buildSpeciesAvailability(LISTINGS);

/**
 * The exact presentation a card resolves for one species in one aquarium —
 * assembled from the same functions FishFinder/SpeciesCardPremium call, so this
 * can't drift from the real render path.
 */
function describeCard(entry, aquarium) {
  const fit = assessSpeciesFit(entry, aquarium, { fishbaseData: ALL_RECORDS });
  const kind = fitPresentationKind(fit);
  const chip = VERDICT_CHIP[kind] || null;
  return {
    commonName: entry.commonName,
    verdict: fit.verdict,
    presentationKind: kind,
    chipLabel: chip ? chip.label : null,
    headline: fit.headline,
    reasons: fit.reasons,
    availability: summarizeAvailability(getAvailabilityFor(availabilityIndex, entry)),
  };
}

const SPECIES = [
  ["Neon Tetra", NEON],
  ["Betta", BETTA],
  ["Oscar", OSCAR],
  ["Goldfish", GOLDFISH],
  ["Mystery Fish (sparse data)", SPARSE],
];

describe("Fish Finder card presentation — snapshots across the species × aquarium matrix", () => {
  for (const [aquariumName, aquarium] of Object.entries(ALL_AQUARIUMS)) {
    it(`resolves consistent card content for every species in the ${aquariumName} aquarium`, () => {
      const rendered = {};
      for (const [label, entry] of SPECIES) {
        rendered[label] = describeCard(entry, aquarium);
      }
      expect(rendered).toMatchSnapshot();
    });
  }

  it("resolves the no-aquarium state (nothing selected yet)", () => {
    const rendered = {};
    for (const [label, entry] of SPECIES) {
      rendered[label] = describeCard(entry, null);
    }
    expect(rendered).toMatchSnapshot();
  });
});

// ─── Explicit invariants (a flipped verdict must fail loudly, not silently) ──

describe("Fish Finder card presentation — honesty invariants", () => {
  it("never claims a positive fit for a species with no curated data", () => {
    for (const aquarium of Object.values(ALL_AQUARIUMS)) {
      const card = describeCard(SPARSE, aquarium);
      expect(card.verdict, "sparse species must not be a confident fit").not.toBe("ok");
      expect(card.presentationKind).toBe("caution_data");
      expect(card.chipLabel).toBe("Limited data");
    }
  });

  it("distinguishes a real mismatch from missing data", () => {
    // Goldfish in a 24°C tropical aquarium is a genuine, known conflict.
    const goldfish = describeCard(GOLDFISH, ALL_AQUARIUMS.community);
    expect(goldfish.presentationKind).not.toBe("caution_data");
    // Sparse data is never presented as a mismatch.
    expect(describeCard(SPARSE, ALL_AQUARIUMS.community).presentationKind).toBe("caution_data");
  });

  it("blocks a species that cannot physically fit, and clears it when the aquarium can house it", () => {
    expect(describeCard(OSCAR, ALL_AQUARIUMS.nano).presentationKind).toBe("blocked");
    expect(describeCard(OSCAR, ALL_AQUARIUMS.large).presentationKind).not.toBe("blocked");
  });

  it("reports a good fit for an appropriate species in an appropriate aquarium", () => {
    const neon = describeCard(NEON, ALL_AQUARIUMS.community);
    expect(neon.presentationKind).toBe("ok");
    expect(neon.chipLabel).toBe("Good fit");
  });

  it("shows no verdict chip until an aquarium is chosen", () => {
    for (const [, entry] of SPECIES) {
      const card = describeCard(entry, null);
      expect(card.presentationKind).toBe("no_tank");
      // VERDICT_CHIP has no no_tank entry — the card renders no chip at all.
      expect(card.chipLabel).toBeNull();
    }
  });
});

describe("Fish Finder card presentation — availability line", () => {
  it("pluralizes sellers and shows the lowest price", () => {
    // Two sellers on Neon at $4.99 and $3.50 → the cheaper one leads.
    expect(describeCard(NEON, ALL_AQUARIUMS.community).availability).toBe(
      "Available from 2 sellers · from $3.50"
    );
  });

  it("uses the singular for a lone seller", () => {
    expect(describeCard(BETTA, ALL_AQUARIUMS.community).availability).toBe(
      "Available from 1 seller · from $25.00"
    );
  });

  it("returns null (not a fabricated 0) when nothing is for sale", () => {
    expect(describeCard(OSCAR, ALL_AQUARIUMS.large).availability).toBeNull();
    expect(describeCard(GOLDFISH, ALL_AQUARIUMS.coldwater).availability).toBeNull();
  });

  it("is independent of the aquarium — availability is a market fact, not a fit result", () => {
    const inNano = describeCard(NEON, ALL_AQUARIUMS.nano).availability;
    const inLarge = describeCard(NEON, ALL_AQUARIUMS.large).availability;
    expect(inNano).toBe(inLarge);
  });
});

describe("Casual species detail presentation — copy snapshots", () => {
  it("renders the detail's aquarium-facing copy for a known species", () => {
    expect({
      fitTitle: DETAIL_COPY.fitTitle,
      careTitle: DETAIL_COPY.careTitle,
      stockingTitle: DETAIL_COPY.stockingTitle,
      emptyFit: DETAIL_COPY.emptyFit("the Neon Tetra"),
      emptyFitCta: DETAIL_COPY.emptyFitCta,
      stocking: DETAIL_COPY.stockingImpact("the Neon Tetra", "The Living Room", 68, 41),
      stockingUnknown: DETAIL_COPY.stockingUnknown,
    }).toMatchSnapshot();
  });

  it("renders the finder's empty and loading states", () => {
    expect({
      contextBarEmpty: FINDER_COPY.contextBar.emptyText,
      contextBarCta: FINDER_COPY.contextBar.emptyCta,
      homeNeedAquarium: FINDER_COPY.home.needAquarium,
      homeEmpty: FINDER_COPY.home.empty,
      resultsEmpty: FINDER_COPY.results.empty,
      dexEmpty: FINDER_COPY.dex.emptyHint,
    }).toMatchSnapshot();
  });
});
