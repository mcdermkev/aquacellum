/**
 * Booth build, last two inventory gaps (BOOTH_BUILD_SPEC.md §6, AQUASHELLA §5.1):
 *   1. +/- stock adjust — a delta applied under the sale lock, never an absolute
 *      write that could erase a sale rung up on another phone.
 *   2. Card sales decrement the inventory of record, exactly once, and release
 *      the checkout hold so the same fish is not counted twice.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect, vi, afterEach } from "vitest";
import { recordCardSaleInventory, CARD_SALE_ID_PREFIX } from "../../api/_lib/cardSaleInventory.js";
import { adjustInventory, setSessionTokenGetter } from "../services/boothApi.js";
import { applyAdjustResult, boothCopy, shortWallet } from "../services/boothInventory.js";

const read = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

// ─── 2. Card sale → inventory ────────────────────────────────────────────────
const BATCH_MD = {
  purchaseType: "batch",
  listingId: "8000007",
  quantity: "2",
  sellerWallet: "0xEF0931458159097A62FDDD0CA798F269B5CE98F7",
  reservationGroupId: "rsv_1_abc",
};

function fakeSupabase(result) {
  return { rpc: vi.fn(async () => result) };
}

describe("recordCardSaleInventory", () => {
  it("decrements via record_inventory_sale, idempotent on the PaymentIntent", async () => {
    const supabase = fakeSupabase({ data: 2, error: null });
    const out = await recordCardSaleInventory({ supabase, metadata: BATCH_MD, paymentIntentId: "pi_123" });
    expect(supabase.rpc).toHaveBeenCalledWith("record_inventory_sale", {
      p_sale_id: `${CARD_SALE_ID_PREFIX}pi_123`,
      p_listing_id: "8000007",
      p_quantity: 2,
      p_seller: "0xef0931458159097a62fddd0ca798f269b5ce98f7",
      p_rail: "card",
      p_order_id: null,
    });
    expect(out).toMatchObject({ applied: true, quantityRemaining: 2 });
  });

  it("uses the same sale id on a webhook retry (so the RPC no-ops the replay)", async () => {
    const supabase = fakeSupabase({ data: 2, error: null });
    await recordCardSaleInventory({ supabase, metadata: BATCH_MD, paymentIntentId: "pi_retry" });
    await recordCardSaleInventory({ supabase, metadata: BATCH_MD, paymentIntentId: "pi_retry" });
    const ids = supabase.rpc.mock.calls.map(([, args]) => args.p_sale_id);
    expect(new Set(ids)).toEqual(new Set(["stripe:pi_retry"]));
  });

  it("releases the checkout hold only after a successful decrement", async () => {
    const releaseHolds = vi.fn(async () => {});
    await recordCardSaleInventory({ supabase: fakeSupabase({ data: 1, error: null }), metadata: BATCH_MD, paymentIntentId: "pi_a", releaseHolds });
    expect(releaseHolds).toHaveBeenCalledWith(BATCH_MD);

    const noRelease = vi.fn();
    const failed = await recordCardSaleInventory({
      supabase: fakeSupabase({ data: null, error: { message: "oversell: 0 remaining, 2 requested" } }),
      metadata: BATCH_MD, paymentIntentId: "pi_b", releaseHolds: noRelease,
    });
    expect(noRelease).not.toHaveBeenCalled();
    expect(failed).toMatchObject({ applied: false, oversold: true });
  });

  it("never throws if releasing the hold fails", async () => {
    const out = await recordCardSaleInventory({
      supabase: fakeSupabase({ data: 3, error: null }), metadata: BATCH_MD, paymentIntentId: "pi_c",
      releaseHolds: async () => { throw new Error("db down"); },
    });
    expect(out).toMatchObject({ applied: true, holdsReleased: false });
  });

  it("leaves singles and incomplete metadata alone", async () => {
    const supabase = fakeSupabase({ data: 0, error: null });
    for (const md of [{ ...BATCH_MD, purchaseType: "pickup" }, { ...BATCH_MD, listingId: "" }, { ...BATCH_MD, sellerWallet: "" }]) {
      const out = await recordCardSaleInventory({ supabase, metadata: md, paymentIntentId: "pi_x" });
      expect(out.applied).toBe(false);
    }
    expect((await recordCardSaleInventory({ supabase, metadata: BATCH_MD, paymentIntentId: "" })).applied).toBe(false);
    expect(supabase.rpc).not.toHaveBeenCalled();
  });
});

describe("stripe webhook wiring", () => {
  const CODE = strip(read("../../api/stripe.js"));
  const succeeded = CODE.slice(CODE.indexOf('case "payment_intent.succeeded"'));
  const guestBranch = succeeded.indexOf('metadata.isGuestPurchase === "true"');

  it("decrements card-sale inventory on payment_intent.succeeded, before the guest early return", () => {
    const call = succeeded.indexOf("recordCardSaleInventory(");
    expect(call).toBeGreaterThan(-1);
    expect(guestBranch).toBeGreaterThan(call);
  });

  it("hands the hold release to the helper instead of leaving it committed", () => {
    const block = succeeded.slice(succeeded.indexOf("recordCardSaleInventory("), guestBranch);
    expect(block).toMatch(/releaseCheckoutReservations\(/);
  });
});

// ─── 1. +/- adjust ───────────────────────────────────────────────────────────
describe("adjust_inventory_by migration", () => {
  const SQL = read("../../supabase/migrations/20260926_inventory_adjust_by_delta.sql");

  it("serialises with sales on the same advisory lock key", () => {
    expect(SQL).toMatch(/pg_advisory_xact_lock\(hashtextextended\(p_listing_id, 0\)\)/);
  });
  it("applies a clamped delta, never an absolute write", () => {
    expect(SQL).toMatch(/greatest\(0, coalesce\(v_remaining, 0\) \+ p_delta\)/);
  });
  it("checks ownership and is callable by the server only", () => {
    expect(SQL).toMatch(/insufficient_privilege/);
    expect(SQL).toMatch(/revoke all on function public\.adjust_inventory_by\(text, integer, text\) from public/);
    expect(SQL).toMatch(/grant execute on function public\.adjust_inventory_by\(text, integer, text\) to service_role/);
  });
});

describe("server-only RPC lockdown migration", () => {
  const SQL = read("../../supabase/migrations/20260926_server_only_rpc_lockdown.sql");
  const FNS = [
    "record_inventory_sale(text, text, integer, text, text, uuid)",
    "adjust_inventory_remaining(text, integer, text)",
    "adjust_inventory_by(text, integer, text)",
    "redeem_promotion(uuid, text, integer, text, text, text)",
    "increment_published_tank_views(text)",
  ];

  it("revokes each function from the browser roles directly, not just PUBLIC", () => {
    for (const fn of FNS) {
      const esc = fn.replace(/[()]/g, "\\$&");
      expect(SQL).toMatch(new RegExp(`revoke execute on function public\\.${esc}\\s+from public, anon, authenticated;`));
      expect(SQL).toMatch(new RegExp(`grant execute on function public\\.${esc}\\s+to service_role;`));
    }
  });

  it("fails the migration if anon/authenticated can still execute any of them", () => {
    expect(SQL).toMatch(/has_function_privilege\(r\.rolname, p\.oid, 'execute'\)/);
    expect(SQL).toMatch(/raise exception 'browser roles still have execute/);
  });
});

describe("adjust-inventory endpoint", () => {
  const CODE = strip(read("../../api/storefront-detail.js"));
  const fn = CODE.slice(CODE.indexOf("async function handleAdjustInventory("), CODE.indexOf("async function handlePublishTank("));

  it("is routed", () => {
    expect(CODE).toMatch(/case "adjust-inventory":\s*return handleAdjustInventory\(req, res\);/);
  });
  it("takes the seller from the session and passes it to the RPC", () => {
    expect(fn).toMatch(/const sellerWallet = await requireWalletFromSession\(req, res\);/);
    expect(fn).toMatch(/p_seller: sellerWallet/);
    expect(fn).not.toMatch(/body\.seller|sellerWallet\s*=\s*body/);
  });
  it("rejects non-integer, zero and oversized deltas before touching the database", () => {
    expect(fn).toMatch(/Number\.isInteger\(d\)/);
    expect(fn.indexOf("INVALID_DELTA")).toBeLessThan(fn.indexOf('rpc("adjust_inventory_by"'));
  });
  it("is not a sale: writes no order row and moves no money", () => {
    expect(fn).not.toMatch(/\.from\("orders"\)/);
    expect(fn).not.toMatch(/record_inventory_sale|stripe/i);
  });
});

describe("adjustInventory (client)", () => {
  afterEach(() => setSessionTokenGetter(null));

  it("refuses without a session and never calls the network", async () => {
    const fetchImpl = vi.fn();
    const out = await adjustInventory({ listingId: 8000007, delta: 1, fetchImpl });
    expect(out).toMatchObject({ success: false, code: "NO_SESSION" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("sends the bearer token and only listingId + delta", async () => {
    setSessionTokenGetter(async () => "tok");
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({ ok: true, quantityRemaining: 5 }) }));
    const out = await adjustInventory({ listingId: 8000007, delta: 1, fetchImpl });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toMatch(/action=adjust-inventory$/);
    expect(init.headers.Authorization).toBe("Bearer tok");
    expect(JSON.parse(init.body)).toEqual({ listingId: "8000007", delta: 1 });
    expect(out).toEqual({ success: true, quantityRemaining: 5 });
  });

  it("reports offline without throwing", async () => {
    setSessionTokenGetter(async () => "tok");
    const out = await adjustInventory({ listingId: 1, delta: -1, fetchImpl: async () => { throw new Error("net"); } });
    expect(out).toMatchObject({ success: false, offline: true });
  });
});

describe("which account is selling (duplicate-account guard)", () => {
  it("shortens a wallet so two accounts are easy to tell apart", () => {
    expect(shortWallet("0xEF0931458159097A62FDDD0CA798F269B5CE98F7")).toBe("0xef09…98f7");
    expect(shortWallet("")).toBe("unknown account");
    expect(shortWallet("not-a-wallet")).toBe("not-a-wallet");
  });

  it("the empty-booth hint names the account and the other sign-in method, in both modes", () => {
    for (const casual of [false, true]) {
      const copy = boothCopy(casual);
      expect(copy.sellingAs).toBeTruthy();
      const hint = copy.wrongAccountHint("0xef09…98f7");
      expect(hint).toContain("0xef09…98f7");
      expect(hint).toMatch(/email/i);
      expect(hint).toMatch(/google/i);
    }
  });
});

describe("applyAdjustResult", () => {
  const lines = [
    { id: "1", quantityRemaining: 1, isActive: true },
    { id: "2", quantityRemaining: 0, isActive: false },
    { id: "3", quantityRemaining: 3, isActive: false },
  ];

  it("takes the server count", () => {
    expect(applyAdjustResult(lines, "1", 2, 1)[0]).toMatchObject({ quantityRemaining: 2, isActive: true });
  });
  it("retires a line that reaches zero", () => {
    expect(applyAdjustResult(lines, "1", 0, -1)[0]).toMatchObject({ quantityRemaining: 0, isActive: false });
  });
  it("puts a sold-out line back on sale when restocked", () => {
    expect(applyAdjustResult(lines, "2", 1, 1)[1]).toMatchObject({ quantityRemaining: 1, isActive: true });
  });
  it("never re-activates a paused line on a decrease", () => {
    expect(applyAdjustResult(lines, "3", 2, -1)[2]).toMatchObject({ quantityRemaining: 2, isActive: false });
  });
  it("ignores a missing result", () => {
    expect(applyAdjustResult(lines, "1", null, 1)).toBe(lines);
  });
});
