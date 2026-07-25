import { describe, it, expect } from "vitest";
import { inferCarePayload } from "./carePayload";

describe("carePayload — inferCarePayload", () => {
  it("parses water-change percent from details", () => {
    expect(inferCarePayload("Water Change", "40% water change performed")).toEqual({ kind: "waterChange", percent: 40 });
    expect(inferCarePayload("Water Change", "Partial water change performed")).toEqual({ kind: "waterChange" });
    expect(inferCarePayload("Log Immediate Water Change", "did a 25 % change")).toEqual({ kind: "waterChange", percent: 25 });
  });

  it("parses temp/pH from water-test details", () => {
    expect(inferCarePayload("Quick Water Test", "Baseline Water Test (Temp: 24.5°C, pH: 7.2)")).toEqual({
      kind: "test", temp: 24.5, ph: 7.2,
    });
    expect(inferCarePayload("Detailed Test", "no numbers here")).toEqual({ kind: "test" });
  });

  it("maps simple care types", () => {
    expect(inferCarePayload("Feed")).toEqual({ kind: "feed" });
    expect(inferCarePayload("Scraped Algae")).toEqual({ kind: "clean" });
    expect(inferCarePayload("Treatment")).toEqual({ kind: "treatment" });
    expect(inferCarePayload("Observation")).toEqual({ kind: "observation" });
  });

  it("falls back to other for unknown types", () => {
    expect(inferCarePayload("Something Else")).toEqual({ kind: "other" });
  });
});
