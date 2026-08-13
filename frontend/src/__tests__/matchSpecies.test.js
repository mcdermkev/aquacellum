import { describe, it, expect } from "vitest";
import { buildSpeciesMatcher, matchDistinctSpecies } from "../utils/matchSpecies";

const CATALOG = [
  { speciesId: 1, commonName: "Guppy", scientificName: "Poecilia reticulata" },
  { speciesId: 2, commonName: "Neon Tetra", scientificName: "Paracheirodon innesi" },
  { speciesId: 3, commonName: "Betta", scientificName: "Betta splendens" },
  { speciesId: 4, commonName: "Endler's Livebearer", scientificName: "Poecilia wingei" },
];

describe("buildSpeciesMatcher.match", () => {
  const { match } = buildSpeciesMatcher(CATALOG);

  it("resolves an exact common-name match (case-insensitive)", () => {
    const r = match("guppy");
    expect(r.status).toBe("exact");
    expect(r.speciesId).toBe(1);
    expect(r.entry.commonName).toBe("Guppy");
  });

  it("resolves an exact scientific-name match", () => {
    const r = match("Poecilia reticulata");
    expect(r.status).toBe("exact");
    expect(r.speciesId).toBe(1);
  });

  it("trims surrounding whitespace before matching", () => {
    expect(match("  Betta  ").status).toBe("exact");
  });

  it("returns suggestions (never an auto id) for a near-miss", () => {
    const r = match("Guppyy");
    expect(r.status).toBe("suggested");
    expect(r.speciesId).toBeNull();
    expect(r.candidates.length).toBeGreaterThan(0);
    // The true species should be among the ranked candidates.
    expect(r.candidates.map((c) => c.speciesId)).toContain(1);
  });

  it("suggests on a partial scientific name without auto-resolving", () => {
    const r = match("Paracheirodon");
    expect(r.status).toBe("suggested");
    expect(r.speciesId).toBeNull();
    expect(r.candidates.map((c) => c.speciesId)).toContain(2);
  });

  it("returns none for gibberish", () => {
    const r = match("zzzqxwv");
    expect(r.status).toBe("none");
    expect(r.candidates).toHaveLength(0);
  });

  it("returns none for an empty name", () => {
    expect(match("").status).toBe("none");
    expect(match("   ").status).toBe("none");
  });
});

describe("matchDistinctSpecies", () => {
  it("resolves each distinct name once", () => {
    const map = matchDistinctSpecies(["Guppy", "guppy", "Betta", "  Betta  "], CATALOG);
    // "Guppy" and "guppy" collapse (trim only, not case for the key) → 3 keys:
    // "Guppy", "guppy", "Betta" — but both guppy variants resolve to exact id 1.
    expect(map.get("Guppy").speciesId).toBe(1);
    expect(map.get("Betta").speciesId).toBe(3);
  });

  it("skips blank names", () => {
    const map = matchDistinctSpecies(["", "  ", "Guppy"], CATALOG);
    expect(map.size).toBe(1);
    expect(map.has("Guppy")).toBe(true);
  });
});
