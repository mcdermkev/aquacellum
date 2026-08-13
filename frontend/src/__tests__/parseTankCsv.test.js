import { describe, it, expect } from "vitest";
import {
  parseDelimited,
  autoMapColumns,
  hasRecognizableHeader,
  rowToTankSpec,
  parseTankCsv,
  revalidateRows,
  buildEmptyMapping,
  importableSpecs,
} from "../utils/parseTankCsv";

// 10 gal → 38 L (rounded); used across volume assertions.
const GAL10_L = Math.round(10 * 3.78541);

describe("parseDelimited", () => {
  it("splits comma-delimited rows", () => {
    expect(parseDelimited("a,b,c\n1,2,3")).toEqual([
      ["a", "b", "c"],
      ["1", "2", "3"],
    ]);
  });

  it("splits tab-delimited rows when tabs are present in the first line", () => {
    expect(parseDelimited("a\tb\tc\n1\t2\t3")).toEqual([
      ["a", "b", "c"],
      ["1", "2", "3"],
    ]);
  });

  it("keeps commas inside quoted fields", () => {
    expect(parseDelimited('name,note\n"Tank, big","hello, world"')).toEqual([
      ["name", "note"],
      ["Tank, big", "hello, world"],
    ]);
  });

  it("treats doubled quotes as a literal quote", () => {
    expect(parseDelimited('a\n"He said ""hi"""')).toEqual([["a"], ['He said "hi"']]);
  });

  it("keeps newlines inside quoted fields", () => {
    expect(parseDelimited('a\n"line1\nline2"')).toEqual([["a"], ["line1\nline2"]]);
  });

  it("handles \\r\\n line endings and drops trailing blank lines", () => {
    expect(parseDelimited("a,b\r\n1,2\r\n\r\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("returns [] for empty input", () => {
    expect(parseDelimited("")).toEqual([]);
    expect(parseDelimited("   \n  ")).toEqual([]);
  });
});

describe("autoMapColumns", () => {
  it("maps common headers regardless of case/spacing/punctuation", () => {
    const m = autoMapColumns(["Tank Name", "Volume (gal)", "Water Type", "Group", "Room", "Rack"]);
    expect(m.name).toBe(0);
    expect(m.volumeLiters).toBe(1);
    expect(m.tankType).toBe(2);
    expect(m.facility).toBe(3);
    expect(m.room).toBe(4);
    expect(m.rack).toBe(5);
  });

  it("returns -1 for fields with no matching header", () => {
    const m = autoMapColumns(["name", "notes"]);
    expect(m.name).toBe(0);
    expect(m.volumeLiters).toBe(-1);
    expect(m.rack).toBe(-1);
  });

  it("does not assign the same column to two fields", () => {
    const m = autoMapColumns(["name", "name"]);
    expect(m.name).toBe(0);
    // second "name" column is not double-claimed by another field
    const counts = Object.values(m).filter((i) => i === 1).length;
    expect(counts).toBeLessThanOrEqual(1);
  });
});

describe("hasRecognizableHeader", () => {
  it("is true when any alias matches", () => {
    expect(hasRecognizableHeader(["Tank Name", "Volume"])).toBe(true);
  });
  it("is false for pure data rows", () => {
    expect(hasRecognizableHeader(["Betta Rack 1", "10"])).toBe(false);
  });
});

describe("rowToTankSpec", () => {
  const mapping = { name: 0, volumeLiters: 1, tankType: 2, containment: 3, facility: 4, room: 5, rack: 6 };

  it("errors (not importable) when name is missing", () => {
    const { errors } = rowToTankSpec(["", "10"], mapping);
    expect(errors).toContain("Missing tank name");
  });

  it("converts gallons to liters", () => {
    const { spec, errors } = rowToTankSpec(["A", "20"], mapping);
    expect(errors).toHaveLength(0);
    expect(spec.volumeLiters).toBe(Math.round(20 * 3.78541));
  });

  it("defaults + warns on blank volume when a volume column is mapped", () => {
    const { spec, warnings } = rowToTankSpec(["A", ""], mapping);
    expect(spec.volumeLiters).toBe(GAL10_L);
    expect(warnings.join(" ")).toMatch(/defaulted/i);
  });

  it("defaults + warns on non-numeric volume", () => {
    const { spec, warnings } = rowToTankSpec(["A", "big"], mapping);
    expect(spec.volumeLiters).toBe(GAL10_L);
    expect(warnings.join(" ")).toMatch(/not understood/i);
  });

  it("maps Brackish and Pond water types to their codes", () => {
    expect(rowToTankSpec(["A", "10", "Brackish"], mapping).spec.tankType).toBe(2);
    expect(rowToTankSpec(["A", "10", "Pond"], mapping).spec.tankType).toBe(3);
    expect(rowToTankSpec(["A", "10", "Freshwater"], mapping).spec.tankType).toBe(0);
  });

  it("maps saltwater to Freshwater WITH a warning (never silently mislabels)", () => {
    const { spec, warnings } = rowToTankSpec(["A", "10", "Saltwater"], mapping);
    expect(spec.tankType).toBe(0);
    expect(warnings.join(" ")).toMatch(/saltwater/i);
  });

  it("maps containment strings to codes", () => {
    expect(rowToTankSpec(["A", "10", "", "tub"], mapping).spec.containment).toBe(1);
    expect(rowToTankSpec(["A", "10", "", "Basket"], mapping).spec.containment).toBe(2);
    expect(rowToTankSpec(["A", "10", "", "whatever"], mapping).spec.containment).toBe(0);
  });

  it("trims location fields", () => {
    const { spec } = rowToTankSpec(["A", "10", "", "", " Fish Room ", " Room B ", " Rack 3 "], mapping);
    expect(spec.facility).toBe("Fish Room");
    expect(spec.room).toBe("Room B");
    expect(spec.rack).toBe("Rack 3");
  });
});

describe("parseTankCsv", () => {
  it("detects a header row and validates data rows", () => {
    const text = "Name,Volume,Water\nBetta 1,5,Freshwater\nBetta 2,5,Freshwater";
    const res = parseTankCsv(text);
    expect(res.hasHeader).toBe(true);
    expect(res.rows).toHaveLength(2);
    expect(res.rows[0].spec.name).toBe("Betta 1");
    expect(res.rows[0].spec.volumeLiters).toBe(Math.round(5 * 3.78541));
  });

  it("treats input with no recognizable header as all data", () => {
    const text = "Betta 1,5\nBetta 2,5";
    const res = parseTankCsv(text);
    expect(res.hasHeader).toBe(false);
    expect(res.rows).toHaveLength(2);
    // No mapping yet → names blank → rows carry errors until user maps columns.
    expect(res.rows[0].errors.length).toBeGreaterThan(0);
  });

  it("returns an empty result for empty input", () => {
    const res = parseTankCsv("");
    expect(res.rows).toHaveLength(0);
    expect(res.headers).toHaveLength(0);
  });
});

describe("revalidateRows + importableSpecs", () => {
  it("re-maps raw rows under an edited mapping", () => {
    const data = [
      ["Betta 1", "5"],
      ["Betta 2", "5"],
    ];
    const rows = revalidateRows(data, { ...buildEmptyMapping(), name: 0, volumeLiters: 1 });
    expect(rows.every((r) => r.errors.length === 0)).toBe(true);
    expect(importableSpecs(rows)).toHaveLength(2);
  });

  it("excludes error rows from importableSpecs", () => {
    const data = [
      ["Betta 1", "5"],
      ["", "5"],
    ];
    const rows = revalidateRows(data, { ...buildEmptyMapping(), name: 0, volumeLiters: 1 });
    expect(importableSpecs(rows)).toHaveLength(1);
  });
});
