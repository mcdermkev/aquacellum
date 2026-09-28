/**
 * Booth staff (Aquashella §5.6) — the permission boundary.
 *
 * Decided 2026-09-26: a helper joins by scanning the seller's QR and can ring up
 * CASH sales and start card sales. Only the seller can change counts, confirm a
 * card pickup (releases money), publish tanks, or manage helpers.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  createHelperInvite,
  joinBooth,
  listBoothsIHelp,
  fetchHelperInventory,
  recordCashSale,
  sendQueuedSale,
  setSessionTokenGetter,
} from "../services/boothApi.js";
import { buildQueuedSale, isPermanentFailure } from "../services/boothOutbox.js";
import { normalizeBoothLine } from "../services/boothInventory.js";

const read = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const API = strip(read("../../api/storefront-detail.js"));
const STRIPE = strip(read("../../api/stripe.js"));
const SQL = read("../../supabase/migrations/20260927_booth_staff.sql");
const BOOTH = strip(read("../components/breeder/BoothInventory.jsx"));

function fn(src, name) {
  const start = src.indexOf(`async function ${name}(`);
  expect(start, `${name} exists`).toBeGreaterThan(-1);
  const rest = src.slice(start + 1);
  const next = rest.search(/\n(?:async\s+)?function\s/);
  return src.slice(start, next > -1 ? start + 1 + next : undefined);
}

// ─── Database ────────────────────────────────────────────────────────────────
describe("booth staff migration", () => {
  it("stores only a SHA-256 of the invite token, never the token", () => {
    expect(SQL).toMatch(/token_hash\s+text primary key check \(char_length\(token_hash\) = 64\)/);
    expect(SQL).not.toMatch(/\btoken\s+text/);
  });

  it("is server-only: RLS on, service-role policy, browser roles revoked", () => {
    for (const t of ["booth_staff_invites", "booth_staff"]) {
      expect(SQL).toMatch(new RegExp(`alter table public\\.${t} enable row level security`));
      expect(SQL).toMatch(new RegExp(`on public\\.${t} for all using \\(auth\\.role\\(\\) = 'service_role'\\)`));
      expect(SQL).toMatch(new RegExp(`revoke all on public\\.${t} from anon, authenticated`));
    }
    expect(SQL).toMatch(/revoke all on function public\.redeem_booth_staff_invite\(text, text\) from public, anon, authenticated/);
    expect(SQL).toMatch(/grant execute on function public\.redeem_booth_staff_invite\(text, text\) to service_role/);
  });

  it("redeems an invite once, only while unexpired and unrevoked", () => {
    expect(SQL).toMatch(/used_at is null\s+and revoked_at is null\s+and expires_at > now\(\)/);
    expect(SQL).toMatch(/set used_at = now\(\), used_by_wallet = v_staff/);
  });

  it("refuses to make a seller their own helper", () => {
    expect(SQL).toMatch(/check \(lower\(seller_wallet\) <> lower\(staff_wallet\)\)/);
    expect(SQL).toMatch(/cannot add yourself as a helper/);
  });

  it("allows one active membership per seller+helper", () => {
    expect(SQL).toMatch(/create unique index if not exists uq_booth_staff_active[\s\S]*where revoked_at is null/);
  });
});

// ─── Server ──────────────────────────────────────────────────────────────────
describe("booth staff endpoints", () => {
  it("are routed", () => {
    for (const [action, handler] of [
      ["booth-staff-invite", "handleBoothStaffInvite"],
      ["booth-staff-list", "handleBoothStaffList"],
      ["booth-staff-remove", "handleBoothStaffRemove"],
      ["booth-staff-join", "handleBoothStaffJoin"],
      ["booth-staff-context", "handleBoothStaffContext"],
      ["booth-staff-inventory", "handleBoothStaffInventory"],
    ]) {
      expect(API).toMatch(new RegExp(`case "${action}":\\s*return ${handler}\\(req, res\\);`));
    }
  });

  it("every one requires a verified session", () => {
    for (const h of ["handleBoothStaffInvite", "handleBoothStaffList", "handleBoothStaffRemove", "handleBoothStaffJoin", "handleBoothStaffContext", "handleBoothStaffInventory"]) {
      expect(fn(API, h)).toMatch(/await requireWalletFromSession\(req, res\)/);
    }
  });

  it("invite: 32 random bytes, only the hash is stored, 15-minute expiry, QR opens the booth", () => {
    const f = fn(API, "handleBoothStaffInvite");
    expect(f).toMatch(/crypto\.randomBytes\(32\)/);
    expect(f).toMatch(/token_hash: hashInviteToken\(token\)/);
    expect(f).not.toMatch(/token:\s*token|\btoken,\s*\n/);
    expect(API).toMatch(/const BOOTH_INVITE_TTL_MS = 15 \* 60 \* 1000;/);
    expect(f).toMatch(/section=booth&join=/);
    expect(f).toMatch(/seller_wallet: sellerWallet/);
  });

  it("join: redeems by hash through the atomic RPC, as the signed-in helper", () => {
    const f = fn(API, "handleBoothStaffJoin");
    expect(f).toMatch(/rpc\("redeem_booth_staff_invite", \{\s*p_token_hash: hashInviteToken\(token\),\s*p_staff_wallet: staffWallet,/);
  });

  it("list/remove act only on the caller's own booth", () => {
    expect(fn(API, "handleBoothStaffList")).toMatch(/\.ilike\("seller_wallet", sellerWallet\)/);
    expect(fn(API, "handleBoothStaffRemove")).toMatch(/\.ilike\("seller_wallet", sellerWallet\)/);
  });

  it("membership check never grants on error (returns null = unknown → 503)", () => {
    const f = fn(API, "isActiveBoothStaff");
    expect(f).toMatch(/\.is\("revoked_at", null\)/);
    expect(f).toMatch(/if \(error\) \{[\s\S]*return null;/);
    expect(f).toMatch(/seller === staff\) return false/);
  });

  it("helper inventory requires membership and returns display fields only", () => {
    const f = fn(API, "handleBoothStaffInventory");
    expect(f.indexOf("isActiveBoothStaff(seller, staffWallet)")).toBeLessThan(f.indexOf('.from("aquadex_listings")'));
    const data = f.slice(f.indexOf("data: {"), f.indexOf("},", f.indexOf("data: {")));
    expect(data).toMatch(/commonName/);
    expect(data).not.toMatch(/packingProfile|description|doaGuarantee|healthStatus/);
  });
});

describe("record-sale: helper acting for a seller", () => {
  const f = fn(API, "handleRecordSale");

  it("defaults to the caller's own booth, exactly as before", () => {
    expect(f).toMatch(/let sellerWallet = sessionWallet;/);
    expect(f).toMatch(/p_seller: sellerWallet/);
    expect(f).toMatch(/seller_wallet: sellerWallet/);
  });

  it("only switches seller after an active-membership check", () => {
    const check = f.indexOf("isActiveBoothStaff(target, sessionWallet)");
    const assign = f.indexOf("sellerWallet = target;");
    expect(check).toBeGreaterThan(-1);
    expect(assign).toBeGreaterThan(check);
    expect(f).toMatch(/NOT_BOOTH_STAFF/);
  });

  it("records who rang it up", () => {
    expect(f).toMatch(/recordedBy = sessionWallet;/);
    expect(f).toMatch(/\.\.\.\(recordedBy \? \{ recordedBy \} : \{\}\)/);
  });

  it("is still cash-only", () => {
    expect(f).toMatch(/if \(rail !== "cash"\)/);
  });
});

describe("seller sees who rang up what", () => {
  it("helper totals come from the seller's own booth cash orders only", () => {
    const f = fn(API, "boothHelperCashSales");
    expect(f).toMatch(/\.from\("orders"\)/);
    expect(f).toMatch(/\.ilike\("seller_wallet", sellerWallet\)/);
    expect(f).toMatch(/\.eq\("metadata->>source", "booth"\)/);
    expect(f).toMatch(/\.eq\("metadata->>rail", "cash"\)/);
    expect(f).toMatch(/if \(error\) \{[\s\S]*return null;/);
  });

  it("the list attaches totals per helper and never fakes a zero on error", () => {
    const f = fn(API, "handleBoothStaffList");
    expect(f).toMatch(/await boothHelperCashSales\(sellerWallet\)/);
    expect(f).toMatch(/const s = sales \? sales\[w\] \|\| \{ count: 0, totalCents: 0 \} : null;/);
  });

  it("formats the line plainly", async () => {
    const { formatHelperSales } = await import("../components/breeder/BoothHelpers.jsx");
    expect(formatHelperSales(null)).toBeNull();
    expect(formatHelperSales({ count: 0, totalCents: 0 })).toBe("No cash sales in the last 24 hours");
    expect(formatHelperSales({ count: 1, totalCents: 1500 })).toBe("1 cash sale · $15.00 in the last 24 hours");
    expect(formatHelperSales({ count: 3, totalCents: 4500 }, 24)).toBe("3 cash sales · $45.00 in the last 24 hours");
  });
});

describe("seller-only actions stay seller-only", () => {
  it("adjust-inventory uses the session wallet as the owner, with no forSeller path", () => {
    const f = fn(API, "handleAdjustInventory");
    expect(f).toMatch(/p_seller: sellerWallet/);
    expect(f).not.toMatch(/forSeller|isActiveBoothStaff/);
  });

  it("publish-tank has no helper path", () => {
    expect(fn(API, "handlePublishTank")).not.toMatch(/forSeller|isActiveBoothStaff|booth_staff/);
  });

  it("confirming a card pickup (money release) still requires the order's seller", () => {
    const f = fn(STRIPE, "handleGuestHandoffConfirm");
    expect(f).toMatch(/String\(order\.seller_wallet\)\.toLowerCase\(\) !== sellerWallet/);
    expect(f).not.toMatch(/booth_staff|isActiveBoothStaff/);
  });
});

// ─── Client ──────────────────────────────────────────────────────────────────
describe("boothApi staff calls", () => {
  afterEach(() => setSessionTokenGetter(null));
  const ok = (body) => vi.fn(async () => ({ ok: true, json: async () => body }));

  it("refuse without a session", async () => {
    const fetchImpl = vi.fn();
    expect(await createHelperInvite({ fetchImpl })).toMatchObject({ success: false, code: "NO_SESSION" });
    expect(await joinBooth("x".repeat(43), { fetchImpl })).toMatchObject({ success: false, code: "NO_SESSION" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("join sends the scanned code with the bearer token", async () => {
    setSessionTokenGetter(async () => "tok");
    const fetchImpl = ok({ ok: true, seller: { wallet: "0xef09", name: "Steve" } });
    const r = await joinBooth("abc", { fetchImpl });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toMatch(/action=booth-staff-join$/);
    expect(init.headers.Authorization).toBe("Bearer tok");
    expect(JSON.parse(init.body)).toEqual({ token: "abc" });
    expect(r).toMatchObject({ success: true, seller: { name: "Steve" } });
  });

  it("helper inventory is scoped to the requested seller and throws on refusal", async () => {
    setSessionTokenGetter(async () => "tok");
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 403, json: async () => ({ error: "You're not a helper for this booth.", code: "NOT_BOOTH_STAFF" }) }));
    await expect(fetchHelperInventory("0xABC", { fetchImpl })).rejects.toThrow(/not a helper/);
    expect(fetchImpl.mock.calls[0][0]).toMatch(/action=booth-staff-inventory&seller=0xabc$/);
  });

  it("booths I help at", async () => {
    setSessionTokenGetter(async () => "tok");
    const r = await listBoothsIHelp({ fetchImpl: ok({ ok: true, booths: [{ wallet: "0xef09", name: "Steve" }] }) });
    expect(r.booths).toHaveLength(1);
  });
});

describe("cash sales for another booth", () => {
  afterEach(() => setSessionTokenGetter(null));

  it("sends forSeller only when helping", async () => {
    setSessionTokenGetter(async () => "tok");
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({ ok: true }) }));
    await recordCashSale({ saleId: "s1", listingId: 1, unitPriceCents: 100, fetchImpl });
    await recordCashSale({ saleId: "s2", listingId: 1, unitPriceCents: 100, forSeller: "0xEF09", fetchImpl });
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).not.toHaveProperty("forSeller");
    expect(JSON.parse(fetchImpl.mock.calls[1][1].body).forSeller).toBe("0xef09");
  });

  it("an offline helper sale replays against the same booth", () => {
    const row = buildQueuedSale({ saleId: "s", listingId: "8000007", sellerAddress: "0xHELPER", forSeller: "0xEF09" });
    expect(row.forSeller).toBe("0xef09");
    expect(buildQueuedSale({ saleId: "t", listingId: "1" }).forSeller).toBeNull();
  });

  it("a removed helper's queued sale stops retrying", () => {
    expect(isPermanentFailure({ code: "NOT_BOOTH_STAFF" })).toBe(true);
  });

  it("sendQueuedSale forwards the stored forSeller", async () => {
    setSessionTokenGetter(async () => "tok");
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    await sendQueuedSale({ saleId: "q", listingId: "1", quantity: 1, unitPriceCents: 1, forSeller: "0xef09" });
    expect(JSON.parse(spy.mock.calls[0][1].body).forSeller).toBe("0xef09");
    spy.mockRestore();
  });
});

describe("booth screen", () => {
  it("hides seller-only controls while helping", () => {
    expect(BOOTH).toMatch(/\{!helping && \(\s*<button[\s\S]*?aria-label="Booth helpers"/);
    expect(BOOTH).toMatch(/\{!helping && \(\s*<button[\s\S]*?aria-label="Publish tank for QR label"/);
    expect(BOOTH).toMatch(/onAdjust=\{helping \? null :/);
    expect(BOOTH).toMatch(/if \(helping \|\| !online \|\| adjustingId\) return;/);
  });

  it("redeems a scanned code once the session is ready, then strips it from the URL", () => {
    expect(BOOTH).toMatch(/if \(!walletAccount \|\| !sessionBridgeReady\) return/);
    const del = BOOTH.indexOf('params.delete("join")');
    const join = BOOTH.indexOf("await joinBooth(code)");
    expect(del).toBeGreaterThan(-1);
    expect(join).toBeGreaterThan(del);
  });

  it("rings up a helper's cash sale against the booth they're helping at", () => {
    expect(BOOTH).toMatch(/forSeller: actingFor,\s*(?:respectHolds: true,\s*)?\}\);/);
  });
});

describe("normalizeBoothLine handles string blobs (helper inventory and seeded listings)", () => {
  it("parses a JSON-string data blob", () => {
    const line = normalizeBoothLine({ id: 1, is_batch: true, data: JSON.stringify({ scientificName: "Oryzias latipes", photoUrl: "/p.jpg", priceCentsUSD: 1000 }) });
    expect(line).toMatchObject({ scientificName: "Oryzias latipes", photoUrl: "/p.jpg", priceCents: 1000 });
  });
});
