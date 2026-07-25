import { describe, it, expect } from "vitest";
import { getSpeciesCare } from "./SpeciesCareGuide";

const CONTRACT = [
  { speciesId: 1, commonName: "Neon Tetra", careLevel: 1, minTemp: 22, maxTemp: 26, minPh: 6.0, maxPh: 7.0 },
];
const FISHBASE = [
  { speciesId: 1, specCode: 1, commonName: "Neon Tetra", family: "Characidae", maxLengthCm: 3,
    diet: { trophicLevel: "Omnivore" }, ecology: { comments: "Peaceful nano schooler.", phMin: 5.5, phMax: 7.0 } },
];

describe("SpeciesCareGuide — getSpeciesCare", () => {
  it("prefers on-chain temp/pH/care level and fills size/temperament/diet/tip from fishbase", () => {
    const c = getSpeciesCare({ speciesId: 1, commonName: "Neon Tetra" }, FISHBASE, CONTRACT);
    expect(c.tempMin).toBe(22);
    expect(c.tempMax).toBe(26);
    expect(c.phMin).toBe(6.0); // contract preferred over fishbase 5.5
    expect(c.careLevelLabel).toBe("Easy");
    expect(c.maxLengthCm).toBe(3);
    expect(c.temperament).toBe("Peaceful schooler"); // characidae
    expect(c.diet).toBe("Omnivore");
    expect(c.tip).toBe("Peaceful nano schooler.");
  });

  it("falls back to fishbase pH when no contract entry", () => {
    const c = getSpeciesCare({ speciesId: 1, commonName: "Neon Tetra" }, FISHBASE, []);
    expect(c.phMin).toBe(5.5);
    expect(c.phMax).toBe(7.0);
    expect(c.careLevelLabel).toBeNull();
  });

  it("matches by common name when id differs", () => {
    const c = getSpeciesCare({ speciesId: 999, commonName: "Neon Tetra" }, FISHBASE, CONTRACT);
    expect(c.tempMin).toBe(22);
  });

  it("drops the 'Information arriving soon' placeholders", () => {
    const fb = [{ speciesId: 2, commonName: "X", diet: { trophicLevel: "Information arriving soon" }, ecology: { comments: "Information arriving soon" } }];
    const c = getSpeciesCare({ speciesId: 2, commonName: "X" }, fb, []);
    expect(c.diet).toBeNull();
    expect(c.tip).toBeNull();
  });
});
