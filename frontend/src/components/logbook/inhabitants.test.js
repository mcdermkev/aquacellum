import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import {
  speciesRecordFor, inhabitantKind, countInhabitants, inhabitantSummary, swimmingInhabitants,
  speciesSlug, speciesCarePath, speciesPhotoFor, coralCare, reefPlacement,
} from "./inhabitants";

const CATALOG = JSON.parse(readFileSync(fileURLToPath(new URL("../../../public/fishbase_master.json", import.meta.url)), "utf8"));

const reefTank = {
  tankType: 1,
  marineStyle: "reef",
  specimens: [
    { id: 1, speciesId: 6509, commonName: "Ocellaris clownfish", scientificName: "Amphiprion ocellaris", status: 0 },
    { id: 2, speciesId: 6509, commonName: "Ocellaris clownfish", scientificName: "Amphiprion ocellaris", status: 0 },
    // Seeded the way a keeper names things: not the catalog's exact common name.
    { id: 3, speciesId: 200020, commonName: "Zoanthid", scientificName: "Zoanthus sociatus", status: 0 },
    { id: 4, speciesId: 200008, commonName: "Hammer coral", scientificName: "Fimbriaphyllia ancora", status: 0 },
    { id: 5, speciesId: 200030, commonName: "Trochus snail", scientificName: "Trochus histrio", status: 0 },
    { id: 6, isBatchPlaceholder: true, commonName: "Juvenile Fry" },
  ],
};

describe("tank inhabitants", () => {
  it("finds the catalog record by scientific name even when the common name differs", () => {
    const rec = speciesRecordFor(reefTank.specimens[2], CATALOG);
    expect(rec?.specCode).toBe(200020);
    expect(speciesPhotoFor(reefTank.specimens[2], CATALOG)).toBe("/species-images/zoanthus-sociatus.jpg");
  });

  it("tells fish, corals and inverts apart and counts them", () => {
    expect(inhabitantKind(reefTank.specimens[0], CATALOG)).toBe("fish");
    expect(inhabitantKind(reefTank.specimens[3], CATALOG)).toBe("coral");
    expect(inhabitantKind(reefTank.specimens[4], CATALOG)).toBe("invertebrate");
    const counts = countInhabitants(reefTank, CATALOG);
    expect(counts).toMatchObject({ fish: 2, coral: 2, invertebrate: 1, total: 5 });
    expect(inhabitantSummary(counts)).toBe("2 fish · 2 corals · 1 invert");
    expect(inhabitantSummary({})).toBe("No fish yet");
  });

  it("only swims the fish", () => {
    const swimmers = swimmingInhabitants(reefTank.specimens.slice(0, 5), CATALOG);
    expect(swimmers.map((s) => s.id)).toEqual([1, 2]);
  });

  it("links to the public care page with the species.html slug rule", () => {
    expect(speciesSlug("Neritina spp.")).toBe("neritina-spp");
    expect(speciesCarePath(reefTank.specimens[3], CATALOG)).toBe("/species/fimbriaphyllia-ancora");
    expect(speciesCarePath({ commonName: "Mystery fish", scientificName: "Unknown" }, CATALOG)).toBe("");
  });

  it("reads coral care from the catalog and nothing for fish", () => {
    expect(coralCare(reefTank.specimens[3], CATALOG)).toMatchObject({ coralType: "LPS", light: "Medium", flow: "Medium", placement: "Middle" });
    expect(coralCare(reefTank.specimens[0], CATALOG)).toBeNull();
  });

  it("blocks corals in a fish-only tank and allows them in a reef", () => {
    const coral = CATALOG.find((r) => r.specCode === 200008);
    expect(reefPlacement(coral, { tankType: 1, marineStyle: "fish_only" }).verdict).toBe("blocked");
    expect(reefPlacement(coral, { tankType: 1, marineStyle: "reef" }).verdict).toBe("ok");
    expect(reefPlacement(coral, { tankType: 0 }).verdict).toBe("ok");
  });
});
