/**
 * Public auctions UI (docs/AUCTIONS_SPEC.md §1–2): routes, client service, and
 * the pages' key behaviours (source-level, matching this repo's node-env tests).
 */
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect, vi, afterEach } from "vitest";
import { resolveCommerceRoute } from "../services/commerceRoute.js";
import {
  cancelLot,
  clockOffsetMs,
  createLot,
  dollarsToCents,
  formatTimeLeft,
  getLot,
  getSavedCard,
  listLots,
  lotPath,
  myAuctions,
  payNow,
  placeBid,
  setSessionTokenGetter,
  startAddCard,
} from "../services/auctionsApi.js";
import { defaultLotEnd } from "../components/breeder/AuctionSellerSection.jsx";

const read = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const PAGE = strip(read("../components/auctions/AuctionsPage.jsx"));
const SELLER = strip(read("../components/breeder/AuctionSellerSection.jsx"));
const APP = strip(read("../App.jsx"));
const AUTH = strip(read("../contexts/AuthContext.jsx"));
const TERMINAL = strip(read("../components/breeder/BreederTerminal.jsx"));
const VERCEL = JSON.parse(read("../../vercel.json"));
const LOT = "3b363c2d-7898-4aa7-8bff-feefe7081e7a";

describe("routes", () => {
  it("browse and lot pages are public; mine needs a verified session", () => {
    expect(resolveCommerceRoute("/app/auctions")).toMatchObject({ kind: "auctions", tab: "auctions" });
    expect(resolveCommerceRoute(`/app/auctions/${LOT}`)).toMatchObject({ kind: "auction-lot", lotId: LOT });
    expect(resolveCommerceRoute(`/app/auctions/${LOT}`).requiresAuth).toBeFalsy();
    expect(resolveCommerceRoute("/app/auctions/mine")).toMatchObject({ kind: "auctions-mine", requiresAuth: true, requiresVerifiedSession: true });
  });

  it("anything else under /app/auctions is not found", () => {
    expect(resolveCommerceRoute("/app/auctions/not-a-uuid").kind).toBe("not-found");
    expect(resolveCommerceRoute(`/app/auctions/${LOT}/extra`).kind).toBe("not-found");
  });

  it("short links redirect into the app", () => {
    const r = VERCEL.redirects.map((x) => `${x.source}->${x.destination}`);
    expect(r).toContain("/auctions->/app/auctions");
    expect(r).toContain("/auctions/:id->/app/auctions/:id");
  });

  it("App renders the auctions page for all three kinds and adds a nav tab", () => {
    expect(APP).toMatch(/commerceRoute\?\.kind === "auctions" \|\| commerceRoute\?\.kind === "auction-lot" \|\| commerceRoute\?\.kind === "auctions-mine"/);
    expect(APP).toMatch(/id: "auctions",\s+icon: "🔨",\s+label: "Auctions"/);
    expect(APP).toMatch(/signedIn=\{!!account && authenticated\}/);
  });

  it("the Breeder Terminal has an Auctions section", () => {
    expect(TERMINAL).toMatch(/AUCTIONS: "auctions"/);
    expect(TERMINAL).toMatch(/activeSection === SECTIONS\.AUCTIONS && \(\s*<AuctionSellerSection/);
  });

  it("the old Tide auction panel is gone", () => {
    expect(existsSync(fileURLToPath(new URL("../components/reef/AuctionPanel.jsx", import.meta.url)))).toBe(false);
    expect(read("../components/reef/index.js")).not.toMatch(/AuctionPanel/);
    expect(strip(read("../components/reef/CreateTide.jsx"))).not.toMatch(/key: "auction"/);
  });
});

describe("auctionsApi", () => {
  afterEach(() => setSessionTokenGetter(null));
  const ok = (body = {}) => vi.fn(async () => ({ ok: true, json: async () => ({ ok: true, ...body }) }));

  it("is registered with the session bridge", () => {
    expect(AUTH.match(/setAuctionsSessionTokenGetter\((getAccessToken|null)\);/g)).toHaveLength(3);
  });

  it("public reads work without a session and never send one for the list", async () => {
    setSessionTokenGetter(async () => "tok");
    const fetchImpl = ok({ lots: [] });
    await listLots({ status: "ended", sort: "new", q: "medaka" }, { fetchImpl });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toMatch(/action=auctions&status=ended&sort=new&limit=30&q=medaka$/);
    expect(init.headers.Authorization).toBeUndefined();
  });

  it("the lot read sends the session when there is one (to learn where you stand)", async () => {
    setSessionTokenGetter(async () => "tok");
    const fetchImpl = ok({ lot: {} });
    await getLot(LOT, { fetchImpl });
    expect(fetchImpl.mock.calls[0][1].headers.Authorization).toBe("Bearer tok");
    setSessionTokenGetter(null);
    await getLot(LOT, { fetchImpl });
    expect(fetchImpl.mock.calls[1][1].headers.Authorization).toBeUndefined();
  });

  it("writes refuse without a session and never hit the network", async () => {
    const fetchImpl = vi.fn();
    for (const r of [
      await placeBid(LOT, 1000, { fetchImpl }),
      await createLot({}, { fetchImpl }),
      await cancelLot(LOT, { fetchImpl }),
      await myAuctions({ fetchImpl }),
      await getSavedCard({ fetchImpl }),
      await startAddCard("/app/auctions", { fetchImpl }),
      await payNow(LOT, { fetchImpl }),
    ]) expect(r).toMatchObject({ success: false, code: "NO_SESSION" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("bids go to auction-bid with whole cents and a bearer", async () => {
    setSessionTokenGetter(async () => "tok");
    const fetchImpl = ok();
    await placeBid(LOT, 1250, { fetchImpl });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toMatch(/action=auction-bid$/);
    expect(JSON.parse(init.body)).toEqual({ lotId: LOT, amountCents: 1250 });
    expect(init.headers.Authorization).toBe("Bearer tok");
  });

  it("server refusals come back as plain errors with a code", async () => {
    setSessionTokenGetter(async () => "tok");
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 409, json: async () => ({ error: "The minimum bid is $11.00.", code: "BID_TOO_LOW" }) }));
    expect(await placeBid(LOT, 1000, { fetchImpl })).toEqual({ success: false, status: 409, code: "BID_TOO_LOW", error: "The minimum bid is $11.00." });
  });
});

describe("helpers", () => {
  it("formats time left", () => {
    expect(formatTimeLeft(0)).toBe("Ended");
    expect(formatTimeLeft(65_000)).toBe("1m 05s");
    expect(formatTimeLeft(3 * 3600e3 + 12 * 60e3)).toBe("3h 12m");
    expect(formatTimeLeft(2 * 86400e3 + 4 * 3600e3)).toBe("2d 4h");
  });

  it("turns typed dollars into cents", () => {
    expect(dollarsToCents("12")).toBe(1200);
    expect(dollarsToCents("$12.5")).toBe(1250);
    expect(dollarsToCents("1,250.99")).toBe(125099);
    expect(dollarsToCents("12.345")).toBeNull();
    expect(dollarsToCents("abc")).toBeNull();
    expect(dollarsToCents("")).toBeNull();
  });

  it("uses the server clock", () => {
    expect(clockOffsetMs("2026-10-01T12:00:05.000Z", Date.parse("2026-10-01T12:00:00.000Z"))).toBe(5000);
    expect(clockOffsetMs(null, 0)).toBe(0);
  });

  it("lot links and the default end time", () => {
    expect(lotPath(LOT)).toBe(`/app/auctions/${LOT}`);
    const end = defaultLotEnd(new Date(2026, 9, 1, 9, 0));
    expect([end.getDate(), end.getHours(), end.getMinutes()]).toEqual([4, 20, 0]);
  });
});

describe("pages", () => {
  it("say what the winner pays before they bid", () => {
    expect(PAGE).toMatch(/If you win, your card is charged your bid plus a card processing fee/);
    expect(PAGE).toMatch(/The seller is paid only after you pick up\./);
  });

  it("gate bidding: sign in, then a card, then the form", () => {
    const panel = PAGE.slice(PAGE.indexOf("function BidPanel("), PAGE.indexOf("function AuctionLotDetail("));
    const signIn = panel.indexOf("if (!signedIn)");
    const card = panel.indexOf("if (viewer && !viewer.hasCard)");
    const form = panel.indexOf("<form onSubmit={submit}");
    expect(signIn).toBeGreaterThan(-1);
    expect(card).toBeGreaterThan(signIn);
    expect(form).toBeGreaterThan(card);
    expect(panel).toMatch(/viewer\?\.isSeller/);
  });

  it("the card page returns to the lot", () => {
    expect(PAGE).toMatch(/startAddCard\(lotPath\(lot\.id\)\)/);
  });

  it("countdowns use the server clock and live lots poll", () => {
    expect(PAGE).toMatch(/clockOffsetMs\(query\.data\?\.serverTime\)/);
    expect(PAGE).toMatch(/refetchInterval: \(q\) => \(q\.state\.data\?\.lot\?\.status === "live" \? 4_000 : false\)/);
  });

  it("a declined winner can pay again or update the card", () => {
    expect(PAGE).toMatch(/item\.status === "payment_failed"[\s\S]{0,200}pay\(item\.id\)/);
    expect(PAGE).toMatch(/startAddCard\("\/app\/auctions\/mine"\)/);
  });

  it("the seller form requires payouts and sends cents", () => {
    expect(SELLER).toMatch(/!payoutsReady \? \(/);
    expect(SELLER).toMatch(/startingBidCents,\s+reserveCents,/);
    expect(SELLER).toMatch(/dollarsToCents\(form\.startingBid\)/);
  });
});
