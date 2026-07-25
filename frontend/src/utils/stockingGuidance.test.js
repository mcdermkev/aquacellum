import { describe, it, expect } from "vitest";
import { assessStocking, stockingHeadline } from "./stockingGuidance";

// fishbase-style records carrying adult size (maxLengthCm).
const NEON = { speciesId: 1, commonName: "Neon Tetra", maxLengthCm: 3 };
const ANGEL = { speciesId: 2, commonName: "Angelfish", maxLengthCm: 15 };
const fb = [NEON, ANGEL];

const specimen = (speciesId, commonName) => ({ speciesId, commonName, status: 0 });

// ~40 US gallons → 151.4 L; guideline capacity = 40 * 2.54 = 101.6 cm.
const tank40 = (specimens) => ({ id: 1, volumeLiters: 151.4, specimens });

describe("assessStocking", () => {
  it("is not applicable with no fish or no volume", () => {
    expect(assessStocking({ volumeLiters: 100, specimens: [] }).applicable).toBe(false);
    expect(assessStocking({ volumeLiters: 0, specimens: [specimen(1, "Neon Tetra")] }).applicable).toBe(false);
  });

  it("computes a comfortable band for a lightly-stocked tank", () => {
    // 5 neons × 3cm = 15cm vs 101.6cm capacity → ratio ~0.15
    const specimens = Array.from({ length: 5 }, () => specimen(1, "Neon Tetra"));
    const a = assessStocking(tank40(specimens), { fishbaseData: fb });
    expect(a.applicable).toBe(true);
    expect(a.totalAdultLengthCm).toBe(15);
    expect(a.band).toBe("comfortable");
    expect(a.ratio).toBeLessThan(0.7);
  });

  it("flags overstocking when adult length exceeds the guideline", () => {
    // 10 angelfish × 15cm = 150cm vs 101.6cm → ratio ~1.48 → over
    const specimens = Array.from({ length: 10 }, () => specimen(2, "Angelfish"));
    const a = assessStocking(tank40(specimens), { fishbaseData: fb });
    expect(a.band).toBe("over");
    expect(a.ratio).toBeGreaterThan(1.3);
  });

  it("excludes fish with unknown adult size and discloses it (never guesses)", () => {
    const specimens = [
      specimen(1, "Neon Tetra"),           // known 3cm
      specimen(99, "Mystery Fish"),         // unknown → excluded
      specimen(99, "Mystery Fish"),
    ];
    const a = assessStocking(tank40(specimens), { fishbaseData: fb });
    expect(a.fishCount).toBe(3);
    expect(a.knownCount).toBe(1);
    expect(a.unknownCount).toBe(2);
    expect(a.totalAdultLengthCm).toBe(3);
    expect(a.assumptions.some((s) => /excluded/i.test(s))).toBe(true);
  });

  it("reports counts but no ratio when nothing has a known adult size", () => {
    const specimens = [specimen(99, "Mystery Fish"), specimen(98, "Other Unknown")];
    const a = assessStocking(tank40(specimens), { fishbaseData: fb });
    expect(a.applicable).toBe(true);
    expect(a.ratio).toBeNull();
    expect(a.band).toBeNull();
  });

  it("always includes the rough-guideline disclaimer", () => {
    const a = assessStocking(tank40([specimen(1, "Neon Tetra")]), { fishbaseData: fb });
    expect(a.assumptions[0]).toMatch(/rough guide/i);
  });

  it("stockingHeadline maps bands to tones", () => {
    expect(stockingHeadline("comfortable").tone).toBe("ok");
    expect(stockingHeadline("full").tone).toBe("warn");
    expect(stockingHeadline("over").tone).toBe("alert");
  });
});
