import { describe, it, expect } from "vitest";
import { unwrap } from "./unwrapEnvelope";

describe("unwrap — a failed query must look failed", () => {
  it("returns data when there is no error", async () => {
    await expect(unwrap(Promise.resolve({ data: [1, 2], error: null }))).resolves.toEqual([1, 2]);
  });

  it("THROWS on an error instead of yielding an empty result", async () => {
    // The regression this guards. `select: (res) => res.data` returned undefined
    // here, React Query reported success, and the component rendered its empty
    // state — which is how a Postgres 42703 became "No RSVPs yet" for weeks.
    await expect(
      unwrap(Promise.resolve({ data: [], error: { message: "column does not exist", code: "42703" } }))
    ).rejects.toThrow(/column does not exist/);
  });

  it("keeps the label so the failing call is identifiable in logs", async () => {
    await expect(
      unwrap(Promise.resolve({ data: null, error: "boom" }), "getTideAttendees")
    ).rejects.toThrow(/^getTideAttendees: boom$/);
  });

  it("preserves the Postgres code on the thrown error", async () => {
    try {
      await unwrap(Promise.resolve({ error: { message: "nope", code: "42703" } }), "x");
      throw new Error("should have thrown");
    } catch (e) {
      expect(e.code).toBe("42703");
      expect(e.cause).toEqual({ message: "nope", code: "42703" });
    }
  });

  it("handles a bare string error", async () => {
    await expect(unwrap(Promise.resolve({ error: "Not connected" }))).rejects.toThrow(/Not connected/);
  });

  it("falls back to a code, then to JSON, when there is no message", async () => {
    await expect(unwrap(Promise.resolve({ error: { code: "PGRST116" } }))).rejects.toThrow(/PGRST116/);
    await expect(unwrap(Promise.resolve({ error: { weird: true } }))).rejects.toThrow(/weird/);
  });

  it("passes through a bare value that is not an envelope", async () => {
    // A few services return the row directly rather than { data, error }.
    await expect(unwrap(Promise.resolve({ rsvp_status: "going" }))).resolves.toEqual({ rsvp_status: "going" });
    await expect(unwrap(Promise.resolve("plain"))).resolves.toBe("plain");
    await expect(unwrap(Promise.resolve(42))).resolves.toBe(42);
  });

  it("normalises absent data to null rather than undefined", async () => {
    // React Query treats an undefined queryFn result as an error, so a successful
    // empty response has to be null.
    await expect(unwrap(Promise.resolve({ error: null }))).resolves.toBeNull();
    await expect(unwrap(Promise.resolve(null))).resolves.toBeNull();
    await expect(unwrap(Promise.resolve(undefined))).resolves.toBeNull();
  });

  it("does not treat falsy-but-valid data as missing", async () => {
    // `?? null` deliberately only rewrites null/undefined. 0, false and "" are all
    // legitimate values a service can return and must survive unchanged — an
    // aggressive `|| null` here would turn a real zero into "no data".
    await expect(unwrap(Promise.resolve({ data: 0, error: null }))).resolves.toBe(0);
    await expect(unwrap(Promise.resolve({ data: false, error: null }))).resolves.toBe(false);
    await expect(unwrap(Promise.resolve({ data: "", error: null }))).resolves.toBe("");
  });
});
