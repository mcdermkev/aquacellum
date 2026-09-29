/**
 * Species photos on a commercial marketplace: every marine photo must exist on
 * disk, carry a credit in ATTRIBUTIONS.json, and use a license that allows
 * commercial use. Entries written by scripts/fetch-marine-images.mjs carry a
 * `sourceUrl`; that marks them as the new, license-checked entries. Older
 * entries (no sourceUrl) are not asserted on here.
 */
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import {
  findPhotoAttribution,
  formatAuthor,
  formatLicense,
  formatPhotoCredit,
} from "../services/speciesPhotoCredits.js";

const PUBLIC = fileURLToPath(new URL("../../public/", import.meta.url));
const catalog = JSON.parse(readFileSync(`${PUBLIC}fishbase_master.json`, "utf8"));
const attributions = JSON.parse(readFileSync(`${PUBLIC}species-images/ATTRIBUTIONS.json`, "utf8"));

/** CC0, public domain, CC BY, CC BY-SA (any version or port). No NC, no ND. */
function isCommercialSafe(license) {
  const n = String(license || "").toLowerCase().replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
  if (!n || /\b(nc|nd)\b|non ?commercial|no ?deriv|rights reserved|proprietary/.test(n)) return false;
  return (
    /^cc0( 1\.0)?( universal)?$/.test(n) ||
    /^(public domain|pd)$/.test(n) ||
    /^cc by( sa)?( \d(\.\d)?)?( [a-z]+)*$/.test(n)
  );
}

const marineWithPhoto = catalog.filter(
  (r) => Array.isArray(r.waterTypes) && r.waterTypes.includes("marine") && r.masterPhotoUrl
);
const newEntries = attributions.filter((e) => e.sourceUrl);

describe("marine species photos", () => {
  it("has marine photos to check", () => {
    expect(marineWithPhoto.length).toBeGreaterThan(0);
  });

  it("every marine masterPhotoUrl points to a file that exists", () => {
    const missing = marineWithPhoto.filter((r) => {
      const rel = String(r.masterPhotoUrl).replace(/^\//, "");
      return !rel.startsWith("species-images/") || !existsSync(`${PUBLIC}${rel}`);
    });
    expect(missing.map((r) => `${r.scientificName} -> ${r.masterPhotoUrl}`)).toEqual([]);
  });

  it("every marine record with a photo has an ATTRIBUTIONS.json entry with a commercial-safe license", () => {
    const problems = [];
    for (const r of marineWithPhoto) {
      const entry = findPhotoAttribution(attributions, r.scientificName);
      if (!entry) problems.push(`${r.scientificName}: no attribution`);
      else if (!isCommercialSafe(entry.license)) problems.push(`${r.scientificName}: ${entry.license}`);
      else if (!entry.attribution || !entry.sourceUrl) problems.push(`${r.scientificName}: missing author or source`);
    }
    expect(problems).toEqual([]);
  });

  it("every new attribution entry uses an allowed license and links its source page", () => {
    expect(newEntries.length).toBeGreaterThan(0);
    const bad = newEntries.filter(
      (e) =>
        !isCommercialSafe(e.license) ||
        !/^https:\/\//.test(e.sourceUrl) ||
        !e.attribution ||
        e.attribution !== e.attribution.trim() ||
        !e.species
    );
    expect(bad).toEqual([]);
  });

  it("the license allowlist rejects NC / ND / all-rights-reserved", () => {
    for (const ok of ["cc0", "CC0", "cc-by", "cc-by-sa", "CC BY 4.0", "CC BY-SA 2.0 de", "Public domain", "pd"]) {
      expect(isCommercialSafe(ok), ok).toBe(true);
    }
    for (const no of ["cc-by-nc", "CC BY-NC-SA 4.0", "cc-by-nd", "cc-by-nc-nd", "proprietary", "all rights reserved", ""]) {
      expect(isCommercialSafe(no), no).toBe(false);
    }
  });

  it("both catalog mirrors are identical", () => {
    const mirror = readFileSync(fileURLToPath(new URL("../../fishbase_master.json", import.meta.url)), "utf8");
    expect(mirror === readFileSync(`${PUBLIC}fishbase_master.json`, "utf8")).toBe(true);
  });
});

describe("photo credit formatting", () => {
  it("formats iNaturalist codes and author lines", () => {
    expect(formatLicense("cc-by-sa")).toBe("CC BY-SA");
    expect(formatLicense("cc0")).toBe("CC0");
    expect(formatLicense("CC BY-SA 4.0")).toBe("CC BY-SA 4.0");
    expect(formatAuthor("(c) Jane Doe, some rights reserved (CC BY)")).toBe("Jane Doe");
    expect(formatAuthor("Jane Doe")).toBe("Jane Doe");
  });

  it("uses the latest entry for a species and only links https sources", () => {
    const entries = [
      { species: "Genus species", source: "inaturalist", license: "cc-by-nc", attribution: "Old" },
      { species: "Genus species", source: "wikimedia", license: "CC BY 4.0", attribution: "New", sourceUrl: "https://commons.wikimedia.org/wiki/File:X.jpg" },
      { species: "Other one", source: "wikimedia", license: "CC0", attribution: "A", sourceUrl: "javascript:alert(1)" },
    ];
    expect(formatPhotoCredit(findPhotoAttribution(entries, "genus SPECIES"))).toEqual({
      author: "New",
      license: "CC BY 4.0",
      sourceLabel: "Wikimedia Commons",
      sourceUrl: "https://commons.wikimedia.org/wiki/File:X.jpg",
    });
    expect(formatPhotoCredit(findPhotoAttribution(entries, "Other one")).sourceUrl).toBe("");
    expect(findPhotoAttribution(entries, "Missing name")).toBeNull();
  });
});
