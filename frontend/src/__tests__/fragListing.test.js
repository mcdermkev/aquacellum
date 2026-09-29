/**
 * Coral frag listings (saltwater phase 3). Pins the frag shape, the public
 * boundary for it, per-unit packing, and the routing/filter/detail wiring.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import {
  FRAG_LISTING_KIND,
  FRAG_PACKING_PROFILE,
  PUBLIC_FRAG_FIELDS,
  buildFragListing,
  cleanFrag,
  cleanHttpsUrl,
  coralCareFromSpecies,
  fragCareFromSpecies,
  fragFromListing,
  fragSizeLabel,
  isFragListing,
  isFraggableSpecies,
  listingUnitLabel,
  toPublicFrag,
  validateFragForm,
} from "../services/fragListing.js";
import { PUBLIC_FRAG_DATA_FIELDS, toPublicListing } from "../services/publicListingProjection.js";
import { scalePackingProfile, normalizeParcelPreset } from "../services/packingEngine.js";
import { planParcels } from "../services/parcelPlanner.js";
import { resolveCartItemProfile } from "../services/addOnPresenter.js";
import { applyCatalogQuery } from "../services/catalogQuery.js";
import { resolveCommerceRoute } from "../services/commerceRoute.js";
import { assembleProductDetailView } from "../services/productDetailView.js";

const ZOA = {
  specCode: 200020,
  scientificName: "Zoanthus sociatus",
  commonName: "Zoanthid (zoa)",
  type: "coral",
  tankMetrics: { minVolumeGallons: 10, tempRangeCelsius: [24, 27], phRange: [8, 8.4], difficulty: "Beginner" },
  marine: { coralType: "zoanthid", light: "moderate", flow: "moderate", placement: "middle", aggression: "semi-aggressive", feeding: "photosynthetic" },
};

const GOOD_FRAG = { sizeValue: 5, sizeUnit: "polyps", mount: "plug", wysiwyg: false, origin: "aquacultured" };

function frag(overrides = {}) {
  return buildFragListing({
    species: ZOA,
    frag: GOOD_FRAG,
    priceUsd: "25",
    quantity: 4,
    seller: "0xABCDEF",
    photoUrl: "https://cdn.example/frag.jpg",
    care: fragCareFromSpecies(ZOA),
    now: 1_760_000_000_000,
    ...overrides,
  });
}

describe("cleanFrag", () => {
  it("keeps valid values and normalizes case and whitespace", () => {
    expect(
      cleanFrag({ sizeValue: "5", sizeUnit: "Polyps", mount: " PLUG ", wysiwyg: true, origin: "wild", grownUnder: "  Radion   XR30 " })
    ).toEqual({
      sizeValue: 5,
      sizeUnit: "polyps",
      mount: "plug",
      wysiwyg: true,
      origin: "wild",
      grownUnder: "Radion XR30",
      motherPhotoUrl: null,
    });
  });

  it("rounds counts to whole numbers and lengths to one decimal", () => {
    expect(cleanFrag({ sizeValue: 2.6, sizeUnit: "heads" }).sizeValue).toBe(3);
    expect(cleanFrag({ sizeValue: 0.2, sizeUnit: "polyps" }).sizeValue).toBe(1);
    expect(cleanFrag({ sizeValue: 1.26, sizeUnit: "in" }).sizeValue).toBe(1.3);
  });

  it("nulls anything it can't vouch for instead of guessing", () => {
    const f = cleanFrag({ sizeValue: -1, sizeUnit: "handfuls", mount: "glue", wysiwyg: "yes", origin: "store", motherPhotoUrl: "http://x.example/a.jpg" });
    expect(f).toEqual({ sizeValue: null, sizeUnit: null, mount: null, wysiwyg: false, origin: null, grownUnder: null, motherPhotoUrl: null });
    expect(cleanFrag(null).sizeUnit).toBeNull();
    expect(cleanFrag({ sizeValue: 5000, sizeUnit: "cm" }).sizeValue).toBeNull();
  });

  it("caps grown-under text at 80 characters", () => {
    expect(cleanFrag({ grownUnder: "x".repeat(200) }).grownUnder).toHaveLength(80);
  });

  it("only accepts https URLs, never base64 or http", () => {
    expect(cleanHttpsUrl("https://cdn.example/a.jpg")).toBe("https://cdn.example/a.jpg");
    expect(cleanHttpsUrl("http://cdn.example/a.jpg")).toBeNull();
    expect(cleanHttpsUrl("data:image/jpeg;base64,AAAA")).toBeNull();
    expect(cleanHttpsUrl("javascript:alert(1)")).toBeNull();
    expect(cleanHttpsUrl(`https://cdn.example/${"a".repeat(3000)}`)).toBeNull();
  });
});

describe("labels", () => {
  it("formats sizes with singular and plural units", () => {
    expect(fragSizeLabel({ sizeValue: 1, sizeUnit: "polyps" })).toBe("1 polyp");
    expect(fragSizeLabel({ sizeValue: 3, sizeUnit: "polyps" })).toBe("3 polyps");
    expect(fragSizeLabel({ sizeValue: 1, sizeUnit: "heads" })).toBe("1 head");
    expect(fragSizeLabel({ sizeValue: 2.5, sizeUnit: "cm" })).toBe("2.5 cm");
    expect(fragSizeLabel({})).toBe("");
  });

  it("names the stock unit per listing kind", () => {
    expect(listingUnitLabel(frag())).toBe("frag");
    expect(listingUnitLabel({ isBatch: true })).toBe("fish");
    expect(listingUnitLabel({ tokenId: 7 })).toBe("");
  });
});

describe("validateFragForm", () => {
  const ok = { species: ZOA, priceUsd: "25", quantity: 4, frag: GOOD_FRAG };

  it("accepts a complete form", () => {
    expect(validateFragForm(ok)).toBeNull();
  });

  it("requires a coral, a price, a quantity, a size, a mount and an origin", () => {
    expect(validateFragForm({ ...ok, species: { ...ZOA, type: "fish" } })).toMatch(/coral/);
    expect(validateFragForm({ ...ok, priceUsd: "0" })).toMatch(/price/);
    expect(validateFragForm({ ...ok, quantity: 0 })).toMatch(/how many/);
    expect(validateFragForm({ ...ok, quantity: 2.5 })).toMatch(/how many/);
    expect(validateFragForm({ ...ok, frag: { ...GOOD_FRAG, sizeValue: "" } })).toMatch(/size/);
    expect(validateFragForm({ ...ok, frag: { ...GOOD_FRAG, mount: "" } })).toMatch(/mounted/);
    expect(validateFragForm({ ...ok, frag: { ...GOOD_FRAG, origin: "" } })).toMatch(/colony/);
  });

  it("holds a WYSIWYG listing to exactly one frag", () => {
    expect(validateFragForm({ ...ok, frag: { ...GOOD_FRAG, wysiwyg: true } })).toMatch(/WYSIWYG/);
    expect(validateFragForm({ ...ok, quantity: 1, frag: { ...GOOD_FRAG, wysiwyg: true } })).toBeNull();
  });

  it("only lists against coral catalog records", () => {
    expect(isFraggableSpecies(ZOA)).toBe(true);
    expect(isFraggableSpecies({ type: "invertebrate", scientificName: "Lysmata amboinensis" })).toBe(false);
    expect(isFraggableSpecies(null)).toBe(false);
  });
});

describe("buildFragListing", () => {
  it("rides the fry-batch rails with a frag marker", () => {
    const l = frag();
    expect(l).toMatchObject({
      id: 1_760_000_000_000,
      listingId: 1_760_000_000_000,
      isBatch: true,
      active: true,
      listingKind: FRAG_LISTING_KIND,
      speciesId: 200020,
      scientificName: "Zoanthus sociatus",
      commonName: "Zoanthid (zoa) frag",
      quantity: 4,
      price: "25.00",
      priceCentsUSD: 2500,
      seller: "0xabcdef",
      sireId: 0,
      damId: 0,
      photoUrl: "https://cdn.example/frag.jpg",
      createdAt: 1_760_000_000,
    });
    expect(isFragListing(l)).toBe(true);
    expect(l.frag).toEqual(cleanFrag(GOOD_FRAG));
  });

  it("prefills care from the catalog in listing units", () => {
    expect(frag()).toMatchObject({ minTemp: 75, maxTemp: 81, minPh: 8, maxPh: 8.4, tankSizeMin: 10, careLevel: 0 });
  });

  it("forces quantity 1 for WYSIWYG", () => {
    expect(frag({ frag: { ...GOOD_FRAG, wysiwyg: true } }).quantity).toBe(1);
  });

  it("never stores a non-https photo", () => {
    expect(frag({ photoUrl: "data:image/jpeg;base64,AAAA" })).not.toHaveProperty("photoUrl");
    expect(frag({ frag: { ...GOOD_FRAG, motherPhotoUrl: "http://x.example/m.jpg" } }).frag.motherPhotoUrl).toBeNull();
  });

  it("carries a per-unit coral packing profile", () => {
    expect(frag().packingProfile).toEqual({ ...FRAG_PACKING_PROFILE });
    expect(frag().packingProfile.perUnit).toBe(true);
  });

  it("re-cleans the frag when read back off the wire", () => {
    const tampered = { ...frag(), frag: { ...GOOD_FRAG, mount: "<script>", motherPhotoUrl: "http://x" } };
    expect(fragFromListing(tampered)).toMatchObject({ mount: null, motherPhotoUrl: null });
    expect(fragFromListing({ isBatch: true, frag: GOOD_FRAG })).toBeNull();
  });
});

describe("public boundary", () => {
  it("uses the projection's frag allowlist and never exposes grownUnder", () => {
    expect(PUBLIC_FRAG_FIELDS).toBe(PUBLIC_FRAG_DATA_FIELDS);
    expect(PUBLIC_FRAG_FIELDS).not.toContain("grownUnder");
  });

  it("agrees with toPublicListing on a real frag listing", () => {
    const l = frag({ frag: { ...GOOD_FRAG, grownUnder: "Radion", motherPhotoUrl: "https://cdn.example/m.jpg" } });
    const pub = toPublicListing(l);
    expect(pub.listingKind).toBe(FRAG_LISTING_KIND);
    expect(pub.frag).toEqual(toPublicFrag(l.frag));
    expect(pub.frag).toEqual({
      sizeValue: 5, sizeUnit: "polyps", mount: "plug", wysiwyg: false, origin: "aquacultured",
      motherPhotoUrl: "https://cdn.example/m.jpg",
    });
    expect(pub).not.toHaveProperty("packingProfile");
    expect(pub).not.toHaveProperty("description");
  });
});

describe("per-unit packing", () => {
  it("scales a per-unit profile by quantity", () => {
    expect(scalePackingProfile(FRAG_PACKING_PROFILE, 5)).toMatchObject({
      bagCount: 5, packedWeightOz: 20, volumeIn3: 120, livestock: 5, separationRequired: false,
    });
  });

  it("leaves whole-listing profiles alone", () => {
    const whole = { bagCount: 1, packedWeightOz: 13, volumeIn3: 88, livestock: 1 };
    expect(scalePackingProfile(whole, 5)).toBe(whole);
  });

  it("feeds both cart resolvers", () => {
    const preset = normalizeParcelPreset({ max_bags: 8, max_livestock: 10 });
    expect(planParcels([{ packingProfile: FRAG_PACKING_PROFILE, quantity: 6 }], preset).usage.bags).toBe(6);
    expect(resolveCartItemProfile({ packingProfile: FRAG_PACKING_PROFILE, quantity: 3 }).bagCount).toBe(3);
  });
});

describe("marketplace wiring", () => {
  const fry = { listingId: 1, isBatch: true, active: true, speciesId: 5, commonName: "Guppy Fry Batch", priceCentsUSD: 300 };
  const single = { tokenId: 9, isBatch: false, active: true, speciesId: 6, commonName: "Betta", priceCentsUSD: 2000 };
  const coral = { ...frag(), listingId: 2 };

  it("filters frags and fry into separate collections", () => {
    const all = [fry, single, coral];
    expect(applyCatalogQuery(all, { listingType: "frag" }).results).toEqual([coral]);
    expect(applyCatalogQuery(all, { listingType: "batch" }).results).toEqual([fry]);
    expect(applyCatalogQuery(all, { listingType: "single" }).results).toEqual([single]);
  });

  it("routes /app/collections/corals and /frags to the frag collection", () => {
    for (const alias of ["frags", "frag", "corals", "coral"]) {
      expect(resolveCommerceRoute(`/app/collections/${alias}`)).toMatchObject({ kind: "collection", collection: "frags" });
    }
  });

  it("board maps the frag collection to the frag listing type", () => {
    const src = readFileSync(fileURLToPath(new URL("../components/MarketplaceBoard.jsx", import.meta.url)), "utf8");
    expect(src).toMatch(/routeCollection === "frags"\s*\?\s*"frag"/);
    expect(src).toContain("<FragListingModal");
  });
});

describe("product detail", () => {
  it("prices per frag and carries frag facts plus reef care", () => {
    const view = assembleProductDetailView(frag(), ZOA);
    expect(view.price).toMatchObject({ cents: 2500, unit: "frag", isPerFish: false });
    expect(view.frag).toMatchObject({ sizeValue: 5, sizeUnit: "polyps", mount: "plug" });
    expect(view.coralCare).toMatchObject({ coralType: "zoanthid", light: "moderate", flow: "moderate", placement: "middle" });
  });

  it("leaves fish listings unchanged", () => {
    const view = assembleProductDetailView({ listingId: 1, isBatch: true, priceCentsUSD: 300 }, { scientificName: "Poecilia reticulata" });
    expect(view.price).toMatchObject({ isPerFish: true, unit: "fish" });
    expect(view.frag).toBeNull();
    expect(view.coralCare).toBeNull();
  });

  it("reads reef care only from the catalog's marine block", () => {
    expect(coralCareFromSpecies({})).toBeNull();
    expect(coralCareFromSpecies({ marine: { light: "  " } })).toBeNull();
  });
});

describe("FragListingModal", () => {
  const src = readFileSync(fileURLToPath(new URL("../components/FragListingModal.jsx", import.meta.url)), "utf8");

  it("uploads photos to hosted storage before saving", () => {
    expect(src).toContain("uploadSpecimenPhoto(photo");
    expect(src).toContain("uploadSpecimenPhoto(motherPhoto");
    expect(src.indexOf("uploadSpecimenPhoto(photo")).toBeLessThan(src.indexOf("db.localListings.put"));
  });

  it("records the absent pedigree explicitly and syncs like a batch", () => {
    expect(src).toContain("attachPedigreeToListing(listing, null)");
    expect(src).toContain("syncListingToCloud(saved)");
    expect(src).toContain('awardXp("LIST_DIRECTORY")');
  });
});
