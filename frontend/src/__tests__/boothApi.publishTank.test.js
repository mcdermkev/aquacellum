/**
 * publishTank — the booth's QR-label publish call rides the AuthContext session
 * bridge. The original modal read `window.privy`, which nothing ever sets, so it
 * always sent no token and every publish 401'd. These pin the fixed contract.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { publishTank, setSessionTokenGetter } from "../services/boothApi.js";

function okFetch(body = { ok: true, token: "abc", publicUrl: "https://x/t/abc", sellableLines: 1 }) {
  return vi.fn(async () => ({ ok: true, status: 200, json: async () => body }));
}

afterEach(() => setSessionTokenGetter(null));

describe("publishTank", () => {
  it("sends the bridged session token as a bearer header", async () => {
    setSessionTokenGetter(async () => "privy-token");
    const fetchImpl = okFetch();
    await publishTank({ tankRef: "tank-1", listingIds: [7], fetchImpl });

    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toMatch(/\/storefront-detail\?action=publish-tank$/);
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer privy-token");
  });

  it("refuses before the network when there is no session", async () => {
    const fetchImpl = okFetch();
    await expect(publishTank({ tankRef: "tank-1", listingIds: [7], fetchImpl })).rejects.toThrow(
      /sign in/i
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("sends only listing ids — never prices, stock, or an owner wallet", async () => {
    setSessionTokenGetter(async () => "t");
    const fetchImpl = okFetch();
    await publishTank({
      tankRef: "tank-1",
      title: "Nano",
      caption: "cherry shrimp",
      listingIds: [7, "8"],
      fetchImpl,
    });

    const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(body).toEqual({
      tankRef: "tank-1",
      title: "Nano",
      caption: "cherry shrimp",
      listingIds: ["7", "8"],
      isPublic: true,
    });
  });

  it("surfaces the server's error message", async () => {
    setSessionTokenGetter(async () => "t");
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 400,
      json: async () => ({ error: "tankRef is required" }),
    }));
    await expect(publishTank({ tankRef: "", fetchImpl })).rejects.toThrow("tankRef is required");
  });
});
