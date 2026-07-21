/**
 * Unit tests for assembleProductDetailView (Task 8, Tier B).
 *
 * Covers §4.3 (normalized pricing renders identically regardless of shape)
 * and general composition correctness: care requirements, the compatibility
 * explanation (composing evaluateTankFit via compatibilityExplanation.js),
 * seller policies incl. the DOA window floor, fulfillment options with a
 * local-delivery estimate (composing evaluateDeliveryEligibility), and the
 * reviews display-only slot.
 *
 * Run with: npx vitest --run src/__tests__/productDetailView.test.js
 */

import { describe, it, expect } from "vitest";
import { assembleProductDetailView } from "../services/productDetailView.js";
import { DEFAULT_CLAIM_WINDOW_MS } from "../services/doaClaims.js";

const NEON_LISTING = {
  tokenId: 1,
  isBatch: false,
  active: true,
  commonName: "Neon Tetra",
  scientificName: "Paracheirodon innesi",
  speciesId: 101,
  careLevel: 0,
  priceUsd: "12.50",
  isShipping: true,
  minTemp: 22,
  maxTemp: 26,
  minPh: 6,
  maxPh: 7,
  doaGuarantee: true,
  healthStatus: "healthy",
};

const DISCUS_BATCH_LISTING = {
  listingId: 5,
  isBatch: true,
  isActive: true,
  commonName: "Discus Fry Batch",
  scientificName: "Symphysodon aequifasciatus",
  speciesId: 202,
  careLevel: 3,
  pricePerFishCents: 8000,
  isShipping: false,
  quantity: 10,
};

const NEON_SPECIES_RECORD = {
  scientificName: "Paracheirodon innesi",
  commonName: "Neon Tetra",
  careLevel: 0,
  maxLengthCm: 4,
  tankMetrics: { tempRangeCelsius: [22, 26], phRange: [6, 7], minVolumeGallons: 10 },
  behavior: { temperament: "peaceful" },
  diet: { fooditems: "Micro-pellets, flakes" },
};

describe("assembleProductDetailView — normalized pricing (§4.3)", () => {
  it("normalizes priceUsd (decimal-dollar string) to cents and a display string", () => {
    const view = assembleProductDetailView(NEON_LISTING, NEON_SPECIES_RECORD, {});
    expect(view.price.cents).toBe(1250);
    expect(view.price.display).toBe("$12.50");
    expect(view.price.isPerFish).toBe(false);
  });

  it("normalizes pricePerFishCents (batch shape) identically to an equivalent priceUsd listing", () => {
    const equivalentSingle = { ...NEON_LISTING, priceUsd: "80.00", priceCentsUSD: undefined };
    const viewBatch = assembleProductDetailView(DISCUS_BATCH_LISTING, null, {});
    const viewSingle = assembleProductDetailView(equivalentSingle, NEON_SPECIES_RECORD, {});
    expect(viewBatch.price.cents).toBe(viewSingle.price.cents);
    expect(viewBatch.price.display).toBe(viewSingle.price.display);
    expect(viewBatch.price.isPerFish).toBe(true);
  });
});

describe("assembleProductDetailView — identity and listingId", () => {
  it("uses tokenId for single listings", () => {
    const view = assembleProductDetailView(NEON_LISTING, NEON_SPECIES_RECORD, {});
    expect(view.listingId).toBe(1);
    expect(view.isBatch).toBe(false);
    expect(view.identity.commonName).toBe("Neon Tetra");
    expect(view.identity.scientificName).toBe("Paracheirodon innesi");
  });

  it("uses listingId for batch listings", () => {
    const view = assembleProductDetailView(DISCUS_BATCH_LISTING, null, {});
    expect(view.listingId).toBe(5);
    expect(view.isBatch).toBe(true);
  });

  it("falls back to listing fields when no species record is matched", () => {
    const view = assembleProductDetailView(DISCUS_BATCH_LISTING, undefined, {});
    expect(view.identity.commonName).toBe("Discus Fry Batch");
    expect(view.identity.scientificName).toBe("Symphysodon aequifasciatus");
  });
});

describe("assembleProductDetailView — care requirements", () => {
  it("derives care requirements from the merged species profile", () => {
    const view = assembleProductDetailView(NEON_LISTING, NEON_SPECIES_RECORD, {});
    expect(view.careRequirements.minTankSizeGallons).toBe(10);
    expect(view.careRequirements.temperatureRangeCelsius).toEqual([22, 26]);
    expect(view.careRequirements.phRange).toEqual([6, 7]);
    expect(view.careRequirements.temperament).toBe("peaceful");
    expect(view.careRequirements.careLevel).toBe(0);
    expect(view.careRequirements.diet).toBe("Micro-pellets, flakes");
  });

  it("still produces a usable (if less confident) profile with no species record", () => {
    const view = assembleProductDetailView(DISCUS_BATCH_LISTING, undefined, {});
    // minTemp/maxTemp/minPh/maxPh aren't on the batch listing fixture, so the
    // range comes back null — but the assembler must not throw.
    expect(view.careRequirements).toBeTruthy();
    expect(view.careRequirements.dataConfidence).toBeTruthy();
  });
});

describe("assembleProductDetailView — compatibility explanation composition", () => {
  it("no displayTank yields the neutral no_tank explanation", () => {
    const view = assembleProductDetailView(NEON_LISTING, NEON_SPECIES_RECORD, {});
    expect(view.compatibility.verdict).toBe("no_tank");
    expect(view.compatibility.headline).toBe("Select a tank to check fit");
  });

  it("a good-fit tank yields an ok verdict with reasons", () => {
    const view = assembleProductDetailView(NEON_LISTING, NEON_SPECIES_RECORD, {
      displayTank: { volume: 30, temp: 24, ph: 6.5 },
    });
    expect(view.compatibility.verdict).toBe("ok");
    expect(view.compatibility.reasons.length).toBeGreaterThan(0);
  });

  it("a badly mismatched tank yields a blocked verdict", () => {
    const view = assembleProductDetailView(DISCUS_BATCH_LISTING, {
      tankMetrics: { minVolumeGallons: 55, tempRangeCelsius: [28, 31], phRange: [6, 6.8] },
    }, {
      displayTank: { volume: 10, temp: 24, ph: 7.0 },
    });
    expect(view.compatibility.verdict).toBe("blocked");
  });
});

describe("assembleProductDetailView — seller policies incl. DOA window", () => {
  it("defaults to the platform-minimum DOA window when the seller offers no override", () => {
    const view = assembleProductDetailView(NEON_LISTING, NEON_SPECIES_RECORD, {});
    expect(view.sellerPolicies.doaWindowHours).toBe(DEFAULT_CLAIM_WINDOW_MS / (60 * 60 * 1000));
    expect(view.sellerPolicies.doaGuarantee).toBe(true);
    expect(view.sellerPolicies.healthStatus).toBe("healthy");
  });

  it("honors a seller-offered window longer than the platform minimum", () => {
    const view = assembleProductDetailView(NEON_LISTING, NEON_SPECIES_RECORD, {
      sellerPolicy: { doaWindowHours: 96 },
    });
    expect(view.sellerPolicies.doaWindowHours).toBe(96);
  });

  it("never allows a seller-offered window shorter than the platform minimum", () => {
    const platformMinHours = DEFAULT_CLAIM_WINDOW_MS / (60 * 60 * 1000);
    const view = assembleProductDetailView(NEON_LISTING, NEON_SPECIES_RECORD, {
      sellerPolicy: { doaWindowHours: 1 }, // seller tries to offer only 1 hour
    });
    expect(view.sellerPolicies.doaWindowHours).toBe(platformMinHours);
  });

  it("doaGuarantee is false when the listing explicitly opts out", () => {
    const view = assembleProductDetailView({ ...NEON_LISTING, doaGuarantee: false }, NEON_SPECIES_RECORD, {});
    expect(view.sellerPolicies.doaGuarantee).toBe(false);
  });
});

describe("assembleProductDetailView — fulfillment options + local delivery estimate", () => {
  it("reflects shipping/pickup flags from the listing", () => {
    const view = assembleProductDetailView(NEON_LISTING, NEON_SPECIES_RECORD, {});
    expect(view.fulfillment.shipping).toBe(true);
    expect(view.fulfillment.pickup).toBe(true);
    expect(view.fulfillment.localDelivery).toBeNull();
  });

  it("computes a local-delivery estimate via evaluateDeliveryEligibility when eligible", () => {
    const listingWithLocalDelivery = { ...NEON_LISTING, localDeliveryAvailable: true };
    const view = assembleProductDetailView(listingWithLocalDelivery, NEON_SPECIES_RECORD, {
      deliveryContext: {
        seller: { radiusMiles: 20 },
        distanceMiles: 5,
        etaMinutes: 30,
        provider: { allowsLivestock: true },
        packaging: { sealed: true, insulated: true, leakProof: true },
        conditions: { originTempF: 70, destTempF: 70 },
      },
    });
    expect(view.fulfillment.localDelivery.available).toBe(true);
    expect(view.fulfillment.localDelivery.verdict).toBe("eligible");
    expect(view.fulfillment.localDelivery.summary).toBe("Local delivery available");
  });

  it("falls back to pickup-only when local delivery isn't safe", () => {
    const listingWithLocalDelivery = { ...NEON_LISTING, localDeliveryAvailable: true };
    const view = assembleProductDetailView(listingWithLocalDelivery, NEON_SPECIES_RECORD, {
      deliveryContext: {
        seller: { radiusMiles: 5 },
        distanceMiles: 50, // way out of radius
        packaging: { sealed: true, insulated: true, leakProof: true },
      },
    });
    expect(view.fulfillment.localDelivery.available).toBe(false);
    expect(view.fulfillment.localDelivery.verdict).toBe("pickup_fallback");
    expect(view.fulfillment.localDelivery.summary).toMatch(/pickup only/i);
    expect(view.fulfillment.localDelivery.reasons.length).toBeGreaterThan(0);
  });

  it("localDelivery stays null when the listing doesn't advertise local delivery, even with a deliveryContext", () => {
    const view = assembleProductDetailView(NEON_LISTING, NEON_SPECIES_RECORD, {
      deliveryContext: { seller: { radiusMiles: 20 }, distanceMiles: 5 },
    });
    expect(view.fulfillment.localDelivery).toBeNull();
  });
});

describe("assembleProductDetailView — reviews slot (display-only)", () => {
  it("defaults to an empty slot when no reviews are provided", () => {
    const view = assembleProductDetailView(NEON_LISTING, NEON_SPECIES_RECORD, {});
    expect(view.reviews.count).toBe(0);
    expect(view.reviews.averageRating).toBeNull();
    expect(view.reviews.items).toEqual([]);
  });

  it("passes through and summarizes provided review records without fetching/scoring", () => {
    const reviews = [{ rating: 5, text: "Great!" }, { rating: 3, text: "OK" }];
    const view = assembleProductDetailView(NEON_LISTING, NEON_SPECIES_RECORD, { reviews });
    expect(view.reviews.count).toBe(2);
    expect(view.reviews.averageRating).toBe(4);
    expect(view.reviews.items).toBe(reviews);
  });
});
