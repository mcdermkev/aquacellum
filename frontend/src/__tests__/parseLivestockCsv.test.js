import { describe, it, expect } from "vitest";
import {
  autoMapLivestockColumns,
  hasRecognizableLivestockHeader,
  rowToLivestock,
  parseLivestockCsv,
  revalidateLivestockRows,
  buildEmptyLivestockMapping,
  distinctSpeciesNames,
  MAX_ROW_QTY,
} from "../utils/parseLivestockCsv";

describe("autoMapLivestockColumns", () => {
  it("maps species/quantity/sex/tank headers regardless of case & punctuation", () => {
    const m = autoMapLivestockColumns(["Species", "Qty", "Sex", "Tank"]);
    expect(m.species).toBe(0);
    expect(m.quantity).toBe(1);
    expect(m.sex).toBe(2);
    expect(m.tank).toBe(3);
  });

  it("returns -1 for unmatched fields", () => {
    const m = autoMapLivestockColumns(["Species", "Notes"]);
    expect(m.species).toBe(0);
    expect(m.quantity).toBe(-1);
    expect(m.sex).toBe(-1);
  });
});

describe("hasRecognizableLivestockHeader", () => {
  it("is true when any alias matches", () => {
    expect(hasRecognizableLivestockHeader(["Species", "Count"])).toBe(true);
  });
  it("is false for pure data", () => {
    expect(hasRecognizableLivestockHeader(["Guppy", "6"])).toBe(false);
  });
});

describe("rowToLivestock", () => {
  const mapping = { species: 0, quantity: 1, sex: 2, tank: 3 };

  it("errors when species is missing", () => {
    expect(rowToLivestock(["", "3"], mapping).errors).toContain("Missing species");
  });

  it("parses quantity", () => {
    expect(rowToLivestock(["Guppy", "6"], mapping).quantity).toBe(6);
  });

  it("defaults + warns on non-numeric quantity", () => {
    const r = rowToLivestock(["Guppy", "lots"], mapping);
    expect(r.quantity).toBe(1);
    expect(r.warnings.join(" ")).toMatch(/not understood/i);
  });

  it("defaults quantity to 1 when blank", () => {
    expect(rowToLivestock(["Guppy", ""], mapping).quantity).toBe(1);
  });

  it("caps quantity at MAX_ROW_QTY with a warning", () => {
    const r = rowToLivestock(["Guppy", String(MAX_ROW_QTY + 50)], mapping);
    expect(r.quantity).toBe(MAX_ROW_QTY);
    expect(r.warnings.join(" ")).toMatch(/capped/i);
  });

  it("normalizes sex; mixed/blank/unknown -> Unsexed", () => {
    expect(rowToLivestock(["Guppy", "1", "male"], mapping).sex).toBe("Male");
    expect(rowToLivestock(["Guppy", "1", "F"], mapping).sex).toBe("Female");
    expect(rowToLivestock(["Guppy", "1", "mixed"], mapping).sex).toBe("Unsexed");
    expect(rowToLivestock(["Guppy", "1", ""], mapping).sex).toBe("Unsexed");
  });

  it("trims the tank name", () => {
    expect(rowToLivestock(["Guppy", "1", "", " Rack 1 "], mapping).tankName).toBe("Rack 1");
  });
});

describe("parseLivestockCsv", () => {
  it("detects a header row and validates data rows", () => {
    const text = "Species,Quantity,Sex,Tank\nGuppy,6,Mixed,Grow-out 1\nBetta,1,Male,Grow-out 2";
    const res = parseLivestockCsv(text);
    expect(res.hasHeader).toBe(true);
    expect(res.rows).toHaveLength(2);
    expect(res.rows[0].species).toBe("Guppy");
    expect(res.rows[0].quantity).toBe(6);
    expect(res.rows[0].sex).toBe("Unsexed");
    expect(res.rows[1].sex).toBe("Male");
  });

  it("returns empty for empty input", () => {
    expect(parseLivestockCsv("").rows).toHaveLength(0);
  });
});

describe("revalidateLivestockRows + distinctSpeciesNames", () => {
  it("re-maps raw rows under an edited mapping", () => {
    const data = [
      ["Guppy", "6"],
      ["Betta", "2"],
    ];
    const rows = revalidateLivestockRows(data, { ...buildEmptyLivestockMapping(), species: 0, quantity: 1 });
    expect(rows.every((r) => r.errors.length === 0)).toBe(true);
    expect(rows[0].quantity).toBe(6);
  });

  it("lists distinct species names in first-seen order", () => {
    const rows = [{ species: "Guppy" }, { species: "guppy" }, { species: "Betta" }, { species: "Guppy" }];
    expect(distinctSpeciesNames(rows)).toEqual(["Guppy", "guppy", "Betta"]);
  });
});
