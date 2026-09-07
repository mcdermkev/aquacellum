import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const retiredRoute = fileURLToPath(new URL("../../api/ensure-profile.js", import.meta.url));
const reefApi = fileURLToPath(new URL("../services/reefApi.js", import.meta.url));

describe("R1.1 profile service-role retirement", () => {
  it("does not expose the body-selected service-role route", () => {
    expect(existsSync(retiredRoute)).toBe(false);
  });

  it("does not call the retired route as a browser fallback", () => {
    const source = readFileSync(reefApi, "utf8");
    expect(source).not.toContain("/api/ensure-profile");
  });
});
