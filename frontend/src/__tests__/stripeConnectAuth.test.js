/**
 * Stripe Connect onboarding / dashboard link — the payout-account boundary.
 *
 * Before 2026-09-29 both endpoints took the wallet from the request body with no
 * session check. connect-onboard could attach a Stripe account to any wallet that
 * had none yet (payouts to the wrong person); connect-dashboard could issue a
 * login link into any connected seller's Express dashboard.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect, vi, afterEach } from "vitest";
import { startSellerOnboarding, getSellerDashboardLink, setSessionTokenGetter } from "../services/stripePayments.js";

const read = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const STRIPE = strip(read("../../api/stripe.js"));

function fn(src, name) {
  const start = src.indexOf(`async function ${name}(`);
  expect(start, `${name} exists`).toBeGreaterThan(-1);
  const rest = src.slice(start + 1);
  const next = rest.search(/\n(?:async\s+)?function\s/);
  return src.slice(start, next > -1 ? start + 1 + next : undefined);
}

describe("connect-onboard (server)", () => {
  const f = fn(STRIPE, "handleConnectOnboard");
  const post = f.slice(f.indexOf('req.method !== "POST"'));

  it("derives the wallet from the verified session before touching Stripe or the DB", () => {
    const auth = post.indexOf("await requireWalletFromSession(req, res)");
    expect(auth).toBeGreaterThan(-1);
    expect(auth).toBeLessThan(post.indexOf('.from("seller_stripe_accounts")'));
    expect(auth).toBeLessThan(post.indexOf("stripe.accounts.create"));
    expect(post).toMatch(/const walletAddress = sessionWallet;/);
  });

  it("refuses a body wallet that differs from the session", () => {
    expect(post).toMatch(/String\(bodyWallet\)\.toLowerCase\(\) !== sessionWallet/);
    expect(post).toMatch(/WALLET_MISMATCH/);
  });

  it("returns sellers to a live page, not the dead aquadex.fish domain", () => {
    expect(STRIPE).not.toMatch(/aquadex\.fish\/seller\/onboarding/);
    expect(STRIPE).toMatch(/\/app\/breeder-terminal\?section=payouts/);
  });

  it("the unauthenticated status GET does not expose the Stripe account id", () => {
    const get = f.slice(0, f.indexOf('req.method !== "POST"'));
    expect(get).not.toMatch(/stripeAccountId:/);
  });
});

describe("connect-dashboard (server)", () => {
  const f = fn(STRIPE, "handleConnectDashboard");

  it("requires a session and uses its wallet for the login link", () => {
    const auth = f.indexOf("await requireWalletFromSession(req, res)");
    expect(auth).toBeGreaterThan(-1);
    expect(auth).toBeLessThan(f.indexOf("createLoginLink"));
    expect(f).toMatch(/WALLET_MISMATCH/);
  });
});

describe("client sends the session", () => {
  afterEach(() => {
    setSessionTokenGetter(null);
    vi.restoreAllMocks();
  });

  it("refuses without a session, without calling the server", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    expect((await startSellerOnboarding({ walletAddress: "0xabc" })).success).toBe(false);
    expect((await getSellerDashboardLink("0xabc")).success).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });

  it("attaches the bearer token", async () => {
    setSessionTokenGetter(async () => "tok");
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue({ ok: true, json: async () => ({ onboardingUrl: "https://connect.stripe.com/x", url: "https://connect.stripe.com/y" }) });
    await startSellerOnboarding({ walletAddress: "0xabc" });
    await getSellerDashboardLink("0xabc");
    for (const [, init] of spy.mock.calls) expect(init.headers.Authorization).toBe("Bearer tok");
  });
});
