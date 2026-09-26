/**
 * Batch listing cards must show the listing's own photo.
 *
 * Reported 2026-09-26: the in-app marketplace showed the generic Oryzias latipes
 * species image on all of Steve's named medaka lines, because MarketplaceBoard
 * only resolved photos for singles and sent every batch to masterPhotoUrl.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { batchCardPhoto } from "../utils/listingCardPhoto.js";

describe("batchCardPhoto", () => {
  it("uses the listing's photoUrl (Steve's hosted line photos)", () => {
    const url = "https://aquacellum.com/showcase-media/steve/lines/pink-saffire/IMG_20260907_165711_303.jpg";
    expect(batchCardPhoto({ photoUrl: url })).toBe(url);
  });

  it("falls back to imageUrl from older writers", () => {
    expect(batchCardPhoto({ photoUrl: "", imageUrl: "/showcase-media/x.jpg" })).toBe("/showcase-media/x.jpg");
  });

  it("keeps legacy inline data:image blobs", () => {
    expect(batchCardPhoto({ photoUrl: "data:image/jpeg;base64,AAAA" })).toBe("data:image/jpeg;base64,AAAA");
  });

  it("returns null when there is no photo, so the species image shows", () => {
    expect(batchCardPhoto({})).toBeNull();
    expect(batchCardPhoto(null)).toBeNull();
    expect(batchCardPhoto({ photoUrl: "   " })).toBeNull();
  });

  it("ignores URLs an img should not load", () => {
    for (const bad of ["javascript:alert(1)", "http://insecure.example/x.jpg", "//evil.example/x.jpg", "data:text/html,hi", 42]) {
      expect(batchCardPhoto({ photoUrl: bad })).toBeNull();
    }
  });
});

describe("MarketplaceBoard wiring", () => {
  const SRC = readFileSync(fileURLToPath(new URL("../components/MarketplaceBoard.jsx", import.meta.url)), "utf8");

  it("gives batch cards their own photo instead of skipping straight to the species image", () => {
    expect(SRC).toMatch(/const customPhoto = item\.isBatch\s*\?\s*batchCardPhoto\(item\)\s*:\s*\(resolvedCardPhotos\[item\.tokenId\] \|\| null\)/);
    expect(SRC).not.toMatch(/const customPhoto = !item\.isBatch \? \(resolvedCardPhotos\[item\.tokenId\] \|\| null\) : null;/);
  });
});
