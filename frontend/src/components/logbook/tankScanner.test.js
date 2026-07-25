import { describe, it, expect } from "vitest";
import { parseTankIdFromScan } from "./TankScanner";

describe("parseTankIdFromScan", () => {
  it("parses the app deep link with a hash fragment", () => {
    expect(parseTankIdFromScan("https://aquacellum.com/app#tank=123")).toBe(123);
  });

  it("parses a query-style tank param too", () => {
    expect(parseTankIdFromScan("https://aquacellum.com/app?tank=45")).toBe(45);
  });

  it("parses a bare number (manual entry)", () => {
    expect(parseTankIdFromScan("700001")).toBe(700001);
    expect(parseTankIdFromScan("  42 ")).toBe(42);
  });

  it("is case-insensitive on the param name", () => {
    expect(parseTankIdFromScan("https://x/app#TANK=7")).toBe(7);
  });

  it("returns null for unrelated / malformed payloads", () => {
    expect(parseTankIdFromScan("https://example.com")).toBeNull();
    expect(parseTankIdFromScan("hello world")).toBeNull();
    expect(parseTankIdFromScan("")).toBeNull();
    expect(parseTankIdFromScan(null)).toBeNull();
    expect(parseTankIdFromScan(undefined)).toBeNull();
  });

  it("ignores non-numeric tank values", () => {
    expect(parseTankIdFromScan("app#tank=abc")).toBeNull();
  });
});
