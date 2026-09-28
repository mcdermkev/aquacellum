/**
 * Public auctions v2 — phase 2: charging winners, holding the money, paying out
 * at pickup, refunds (docs/AUCTIONS_SPEC.md §3, §5).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import {
  AUCTION_PAYMENT_PURPOSE,
  auctionChargeMetadata,
  chargeFailureMessage,
  planAuctionCharge,
  planClubSplit,
} from "../../api/_lib/auctionMoney.js";

const read = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const SQL = read("../../supabase/migrations/20260929_auctions_v2_money.sql");
const ORDER = JSON.stringify(JSON.parse(read("../../../supabase/migration-order.json")));
const STRIPE = strip(read("../../api/stripe.js"));
const VERCEL = JSON.parse(read("../../vercel.json"));

function fn(src, name) {
  const start = src.indexOf(`async function ${name}(`) > -1 ? src.indexOf(`async function ${name}(`) : src.indexOf(`function ${name}(`);
  expect(start, `${name} exists`).toBeGreaterThan(-1);
  const next = src.slice(start + 1).search(/\n(?:async\s+)?function\s/);
  return src.slice(start, next > -1 ? start + 1 + next : undefined);
}
function sqlFn(name) {
  const start = SQL.indexOf(`create or replace function public.${name}(`);
  expect(start, `${name} exists`).toBeGreaterThan(-1);
  return SQL.slice(start, SQL.indexOf("$$;", start));
}

const RATE = 0.029;
const FIXED = 30;

describe("planAuctionCharge", () => {
  it("winner pays hammer + processing; seller gets hammer − platform fee", () => {
    const p = planAuctionCharge({ hammerCents: 5000, feePercent: 4, stripeRate: RATE, stripeFixedCents: FIXED });
    expect(p.hammerCents).toBe(5000);
    expect(p.platformFeeCents).toBe(200);
    expect(p.sellerPayoutCents).toBe(4800);
    expect(p.buyerTotalCents).toBe(p.hammerCents + p.processingFeeCents);
    // Grossed up so Stripe's cut comes out of the processing fee, not the hammer.
    expect(p.buyerTotalCents - Math.round(p.buyerTotalCents * RATE) - FIXED).toBeGreaterThanOrEqual(5000);
  });

  it("event mode halves the platform fee; the winner's processing fee is the same", () => {
    const std = planAuctionCharge({ hammerCents: 5000, feePercent: 4, stripeRate: RATE, stripeFixedCents: FIXED });
    const ev = planAuctionCharge({ hammerCents: 5000, feePercent: 2, stripeRate: RATE, stripeFixedCents: FIXED });
    expect(ev.platformFeeCents).toBe(100);
    expect(ev.sellerPayoutCents).toBe(4900);
    expect(ev.buyerTotalCents).toBe(std.buyerTotalCents);
  });

  it("refuses a nonsense hammer price", () => {
    expect(() => planAuctionCharge({ hammerCents: 50, feePercent: 4, stripeRate: RATE, stripeFixedCents: FIXED })).toThrow();
  });
});

describe("planClubSplit (phase 4)", () => {
  it("always adds up to the hammer price", () => {
    for (const split of [0, 20, 50, 100]) {
      const s = planClubSplit({ hammerCents: 5000, platformFeeCents: 200, clubSplitPercent: split });
      expect(s.sellerCents + s.clubCents + s.platformCents).toBe(5000);
    }
  });
  it("a donated lot pays the seller nothing; the club gets the split plus 25% of our fee", () => {
    // $50 hammer, $2 fee: donated → club gets $48 + $0.50, we keep $1.50.
    expect(planClubSplit({ hammerCents: 5000, platformFeeCents: 200, clubSplitPercent: 100 })).toEqual({ sellerCents: 0, clubCents: 4850, platformCents: 150 });
    // 20% split of the $48 left after our fee.
    expect(planClubSplit({ hammerCents: 5000, platformFeeCents: 200, clubSplitPercent: 20 })).toEqual({ sellerCents: 3840, clubCents: 1010, platformCents: 150 });
  });
});

describe("auctionChargeMetadata", () => {
  const md = auctionChargeMetadata({
    claim: { lotId: "L1", sellerWallet: "0xS", winnerWallet: "0xW", listingId: "8000007", quantity: 2 },
    plan: { hammerCents: 5000, platformFeeCents: 200, sellerPayoutCents: 4800, processingFeeCents: 181 },
    feePolicy: { feePercent: 4, reason: "standard" },
    sellerStripeAccountId: "acct_1",
    transferGroup: "auc_L1",
  });

  it("carries what the pickup payout needs", () => {
    expect(md).toMatchObject({ purpose: AUCTION_PAYMENT_PURPOSE, sellerPayoutCents: "4800", sellerStripeAccountId: "acct_1", transferGroup: "auc_L1", lotId: "L1" });
  });

  it("is not a batch card sale (the lot's stock already moved at listing time)", () => {
    expect(md.purchaseType).toBe("auction");
    expect(md).not.toHaveProperty("buyerWallet");
  });

  it("every value is a string (Stripe metadata)", () => {
    for (const v of Object.values(md)) expect(typeof v).toBe("string");
  });
});

describe("chargeFailureMessage", () => {
  it("tells the winner what to do", () => {
    expect(chargeFailureMessage({ code: "authentication_required" })).toMatch(/confirm/);
    expect(chargeFailureMessage({ raw: { code: "card_declined", message: "Your card was declined." } })).toMatch(/declined\..*Pay now/);
  });
});

describe("migration", () => {
  it("is registered after the v2 schema", () => {
    expect(ORDER.indexOf("20260929_auctions_v2_money.sql")).toBeGreaterThan(ORDER.indexOf("20260929_auctions_v2.sql"));
  });

  it("only one caller can claim a lot for charging", () => {
    const f = sqlFn("claim_auction_lot_for_charge");
    expect(f).toMatch(/for update;/);
    expect(f).toMatch(/l\.status in \('ended', 'payment_failed'\)\s+or \(l\.status = 'charging' and l\.updated_at < now\(\) - interval '10 minutes'\)/);
    expect(f).toMatch(/charge_attempts = charge_attempts \+ 1/);
    expect(f).toMatch(/payment_deadline < now\(\)/);
  });

  it("paid only from charging (idempotent for the same PaymentIntent)", () => {
    const f = sqlFn("mark_auction_lot_paid");
    expect(f).toMatch(/l\.status in \('paid', 'handed_off'\) and l\.payment_intent = p_payment_intent/);
    expect(f).toMatch(/if l\.status <> 'charging' then/);
  });

  it("a refund before pickup returns stock; after pickup it doesn't", () => {
    const f = sqlFn("mark_auction_lot_refunded");
    expect(f).toMatch(/if l\.status = 'paid' then\s+perform public\.auction_lot_return_stock\(l\.id\);/);
  });

  it("the sweep is pinged only when something is due, with a Vault secret", () => {
    const f = sqlFn("auction_ping_charge_sweep");
    expect(f).toMatch(/if not exists \(select 1 from public\.auction_lots_due_for_charge\(1\)\)/);
    expect(f).toMatch(/vault\.decrypted_secrets where name = 'auction_sweep_secret'/);
    expect(f).toMatch(/action=auction-sweep/);
    expect(SQL).toMatch(/'select public\.close_ended_auction_lots\(\); select public\.auction_ping_charge_sweep\(\);'/);
  });

  it("everything is server-only", () => {
    for (const f of ["claim_auction_lot_for_charge", "mark_auction_lot_paid", "record_auction_lot_charge_failure", "mark_auction_lot_handed_off", "mark_auction_lot_refunded", "auction_lots_due_for_charge", "auction_ping_charge_sweep"]) {
      expect(SQL).toMatch(new RegExp(`revoke execute on function public\\.${f}\\([^)]*\\)\\s+from public, anon, authenticated;`));
    }
    expect(SQL).toMatch(/check \(purchase_type in \('specimen', 'shipping', 'batch', 'multi', 'pickup', 'auction'\)\)/);
  });
});

describe("charging a winner", () => {
  const f = fn(STRIPE, "chargeAuctionLotV2");

  it("claims first, then charges, then records paid", () => {
    const claim = f.indexOf('rpc("claim_auction_lot_for_charge"');
    const charge = f.indexOf("stripe.paymentIntents.create(");
    const paid = f.indexOf('rpc("mark_auction_lot_paid"');
    expect(claim).toBeGreaterThan(-1);
    expect(charge).toBeGreaterThan(claim);
    expect(paid).toBeGreaterThan(charge);
    expect(f).toMatch(/if \(!claim\) return \{ lotId, skipped: "not_claimable" \};/);
  });

  it("charges the saved card off-session, held on the platform, idempotent per attempt", () => {
    const create = f.slice(f.indexOf("stripe.paymentIntents.create("), f.indexOf("catch (err)"));
    expect(create).toMatch(/off_session: true,/);
    expect(create).toMatch(/confirm: true,/);
    expect(create).toMatch(/amount: plan\.buyerTotalCents,/);
    expect(create).not.toMatch(/transfer_data|application_fee/);
    expect(create).toMatch(/idempotencyKey: `auction-lot-\$\{claim\.lotId\}-\$\{claim\.attempt\}`/);
  });

  it("the amount comes from the database claim, never the request", () => {
    expect(f).toMatch(/hammerCents: claim\.hammerCents,/);
    expect(f).not.toMatch(/req\.body/);
  });

  it("fee: 4%, or the event rate when the seller has event mode on", () => {
    expect(f).toMatch(/const event = await findActiveSellerEvent\(supabase, claim\.sellerWallet\);/);
    expect(f).toMatch(/rail: event \? FEE_RAIL\.CARD_EVENT : FEE_RAIL\.CARD,/);
  });

  it("creates a pickup order the existing handoff can release", () => {
    expect(f).toMatch(/guest_ref: guestRef,/);
    expect(f).toMatch(/status: "locked",/);
    expect(f).toMatch(/fulfillment_type: "in_person",/);
    expect(f).toMatch(/purchase_type: "auction",/);
  });

  it("a decline is recorded as payment_failed and the winner is told", () => {
    expect(f).toMatch(/rpc\("record_auction_lot_charge_failure"/);
    expect(f).toMatch(/notifyAuctionWinner\(claim, "failed"/);
  });
});

describe("endpoints and webhook", () => {
  it("routes the sweep and pay-now", () => {
    expect(STRIPE).toMatch(/case "auction-sweep":\s*return handleAuctionSweep\(req, res\);/);
    expect(STRIPE).toMatch(/case "auction-pay":\s*return handleAuctionPay\(req, res\);/);
  });

  it("the sweep needs a cron secret, compared in constant time", () => {
    expect(fn(STRIPE, "handleAuctionSweep")).toMatch(/if \(!isAuctionSweepRequest\(req\)\) return res\.status\(401\)/);
    const s = fn(STRIPE, "isAuctionSweepRequest");
    expect(s).toMatch(/crypto\.timingSafeEqual/);
    expect(s).toMatch(/secret\.length < 32/);
  });

  it("pay-now: only the signed-in winner", () => {
    const f = fn(STRIPE, "handleAuctionPay");
    expect(f).toMatch(/const wallet = await requireWalletFromSession\(req, res\);/);
    expect(f).toMatch(/lot\.winner_wallet !== wallet/);
  });

  it("card on file is session-authed now", () => {
    const f = fn(STRIPE, "handleAuctionPaymentMethod");
    expect(f).toMatch(/const wallet = await requireWalletFromSession\(req, res\);/);
    expect(f).not.toMatch(/req\.query\.wallet : req\.body\?\.walletAddress \|\| ""\)\.toLowerCase\(\)/);
  });

  it("the retired Tide charge answers 410", () => {
    expect(fn(STRIPE, "handleAuctionCharge")).toMatch(/status\(410\)/);
  });

  it("webhook: auction charges are skipped on succeeded, refunds update the lot", () => {
    const succeeded = STRIPE.slice(STRIPE.indexOf('case "payment_intent.succeeded"'));
    expect(succeeded.indexOf("metadata?.purpose === AUCTION_PAYMENT_PURPOSE")).toBeLessThan(succeeded.indexOf("isGuestPurchase"));
    const refunded = STRIPE.slice(STRIPE.indexOf('case "charge.refunded"'), STRIPE.indexOf('case "account.updated"'));
    expect(refunded).toMatch(/rpc\("mark_auction_lot_refunded", \{ p_payment_intent: paymentIntentId \}\)/);
  });

  it("handoff confirm marks the lot handed off after the payout", () => {
    const f = fn(STRIPE, "handleGuestHandoffConfirm");
    expect(f.indexOf('rpc("mark_auction_lot_handed_off"')).toBeGreaterThan(f.indexOf("transferToSeller("));
  });

  it("a daily Vercel cron backs up the pg_cron sweep", () => {
    expect(VERCEL.crons.map((c) => c.path)).toContain("/api/stripe?action=auction-sweep");
  });
});
