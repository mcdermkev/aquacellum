/**
 * auction_lifecycle.test.mjs
 *
 * Proves the auction money path end to end against a REAL Postgres (PGlite is
 * Postgres compiled to WASM, so plpgsql, triggers and constraints behave as they
 * do in Supabase).
 *
 * WHY THIS EXISTS AS A CHECKED-IN TEST. These invariants were originally verified
 * by hand in rolled-back transactions against production. That proved they worked
 * once; it does not stop the next migration quietly undoing them. Everything here
 * decides who owes money or who owns a fish, so it belongs in a file that can be
 * re-run.
 *
 * The cases worth keeping honest are the ones a reviewer cannot eyeball:
 *   - a LOWER bid placed after a higher one must not win the lot (getHighestBid
 *     originally ordered by created_at, so the most RECENT bid won — a $1 bid took
 *     a $5,000 lot)
 *   - bidding without a saved card is refused, AND a Stripe customer row with no
 *     completed card is still refused
 *   - a non-paying winner does not deadlock the lot: the next-highest bid is
 *     promoted, including a bid that was demoted to 'outbid' by the winner who
 *     then failed to pay
 *   - ownership cannot move before money does
 *   - settling twice does not duplicate anything (it did: unsold lots piled up a
 *     row per attempt, because the skip check and the partial unique index shared
 *     the same blind spot)
 *   - a duplicate Stripe webhook does not pay twice
 *
 * HOW TO RUN. PGlite is deliberately NOT a project dependency — a 30MB WASM
 * Postgres has no business in the frontend install for migration tests — so
 * install it out-of-tree and point PGLITE_PATH at it:
 *
 *   mkdir %TEMP%\pglite-verify && cd %TEMP%\pglite-verify
 *   npm init -y && npm install @electric-sql/pglite
 *   set PGLITE_PATH=%TEMP%\pglite-verify\node_modules\@electric-sql\pglite\dist\index.js
 *   node <repo>\supabase\tests\auction_lifecycle.test.mjs
 *
 * Exits 0 when every check passes, 1 otherwise.
 */

import { readFileSync } from "fs";
import { fileURLToPath, pathToFileURL } from "url";
import { dirname, join } from "path";

const here = dirname(fileURLToPath(import.meta.url));
const migrations = join(here, "..", "migrations");

const { PGlite } = await import(
  process.env.PGLITE_PATH ? pathToFileURL(process.env.PGLITE_PATH).href : "@electric-sql/pglite"
);

const db = await PGlite.create();
let failures = 0;

function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) console.log(`        expected ${JSON.stringify(expected)}  got ${JSON.stringify(actual)}`);
}

/** Run SQL expecting it to RAISE. Returns the message, or null if it succeeded. */
async function expectRaise(name, sql) {
  try {
    await db.exec(sql);
    failures++;
    console.log(`FAIL  ${name}  (statement was accepted, expected a rejection)`);
    return null;
  } catch (e) {
    console.log(`PASS  ${name}`);
    return e.message;
  }
}

const one = async (sql) => (await db.query(sql)).rows[0];
const all = async (sql) => (await db.query(sql)).rows;

// ── Stub the pieces of the real database these migrations depend on ──────────
// Only the shape matters: columns the auction code actually reads.
await db.exec(`
  CREATE TABLE profiles (
    wallet_address TEXT PRIMARY KEY,
    display_name   TEXT,
    avatar_url     TEXT,
    companion_tier TEXT,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  CREATE TABLE tides (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title       TEXT NOT NULL,
    tide_type   TEXT NOT NULL,
    status      TEXT NOT NULL DEFAULT 'upcoming',
    start_time  TIMESTAMPTZ NOT NULL,
    end_time    TIMESTAMPTZ NOT NULL,
    host_wallet TEXT REFERENCES profiles(wallet_address),
    settings    JSONB NOT NULL DEFAULT '{}'::jsonb
  );

  CREATE TABLE auction_bids (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tide_id       UUID REFERENCES tides(id) ON DELETE CASCADE,
    token_id      INTEGER NOT NULL,
    bidder_wallet TEXT REFERENCES profiles(wallet_address),
    amount_cents  INTEGER NOT NULL,
    status        TEXT DEFAULT 'active',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  ALTER TABLE auction_bids ADD CONSTRAINT auction_bids_amount_cents_sane
    CHECK (amount_cents > 0 AND amount_cents <= 100000000);

  CREATE TABLE seller_stripe_accounts (
    wallet_address      TEXT PRIMARY KEY REFERENCES profiles(wallet_address),
    stripe_account_id   TEXT,
    onboarding_complete BOOLEAN DEFAULT false,
    charges_enabled     BOOLEAN DEFAULT false,
    payouts_enabled     BOOLEAN DEFAULT false
  );

  CREATE TABLE aquadex_specimens (
    id              TEXT PRIMARY KEY,
    owner_address   TEXT,
    current_tank_id TEXT,
    species_id      INTEGER,
    status          INTEGER DEFAULT 0,
    updated_at      TIMESTAMPTZ,
    data            JSONB
  );

  -- Supplied by 20260817180000 in the real database.
  CREATE FUNCTION current_wallet() RETURNS TEXT LANGUAGE sql STABLE AS $$
    SELECT NULL::text;
  $$;
`);

// ── Load the auction migrations under test, in order ─────────────────────────
for (const file of [
  "20260817200000_auction_settlement.sql",
  "20260817201000_auction_money_message_format.sql",
  "20260817202000_settle_idempotence_fix.sql",
  "20260817210000_auction_payment_method_required.sql",
  // Attaches both bid-rule triggers. Without it every rule silently did nothing
  // here, which is how the function/trigger split was found — see that file.
  "20260817231000_ensure_bid_rules_trigger.sql",
]) {
  await db.exec(readFileSync(join(migrations, file), "utf8"));
}

// ── Fixtures ─────────────────────────────────────────────────────────────────
await db.exec(`
  INSERT INTO profiles (wallet_address) VALUES
    ('0xhost'), ('0xalice'), ('0xbob'), ('0xcarol');

  INSERT INTO seller_stripe_accounts (wallet_address, stripe_account_id, onboarding_complete, charges_enabled, payouts_enabled)
  VALUES ('0xhost', 'acct_1', true, true, true);

  -- The lot being auctioned, held by the host.
  INSERT INTO aquadex_specimens (id, owner_address, species_id) VALUES ('7', '0xhost', 1);

  INSERT INTO tides (id, title, tide_type, status, start_time, end_time, host_wallet, settings)
  VALUES (
    '00000000-0000-4000-8000-000000000001', 'Rare cichlid auction', 'auction', 'live',
    now() - interval '1 hour', now() + interval '1 hour', '0xhost',
    '{"auction_items":[{"token_id":7,"reserve_cents":2000},{"token_id":8,"reserve_cents":1000}]}'::jsonb
  );
`);

const TIDE = "'00000000-0000-4000-8000-000000000001'";

// ── Card on file is required to bid ──────────────────────────────────────────
await expectRaise(
  "bidding with no payment method is refused",
  `INSERT INTO auction_bids (tide_id, token_id, bidder_wallet, amount_cents)
   VALUES (${TIDE}, 7, '0xalice', 3000);`
);

// A SetupIntent that was started but never completed leaves a customer row with
// no payment_method_id. That must NOT unlock bidding.
await db.exec(`INSERT INTO buyer_payment_methods (wallet_address, stripe_customer_id) VALUES ('0xalice', 'cus_a');`);
await expectRaise(
  "bidding with an incomplete card setup is refused",
  `INSERT INTO auction_bids (tide_id, token_id, bidder_wallet, amount_cents)
   VALUES (${TIDE}, 7, '0xalice', 3000);`
);

await db.exec(`
  UPDATE buyer_payment_methods SET payment_method_id='pm_a', brand='visa', last4='4242'
   WHERE wallet_address='0xalice';
  INSERT INTO buyer_payment_methods (wallet_address, stripe_customer_id, payment_method_id, brand, last4)
  VALUES ('0xbob', 'cus_b', 'pm_b', 'mastercard', '5555'),
         ('0xcarol', 'cus_c', 'pm_c', 'amex', '0005');
`);

await expectRaise(
  "a malformed last4 is refused",
  `UPDATE buyer_payment_methods SET last4='42' WHERE wallet_address='0xalice';`
);

// ── Ascending-price rule ─────────────────────────────────────────────────────
await db.exec(`INSERT INTO auction_bids (tide_id, token_id, bidder_wallet, amount_cents) VALUES (${TIDE}, 7, '0xalice', 3000);`);

await expectRaise(
  "a bid below the opening bid is refused",
  `INSERT INTO auction_bids (tide_id, token_id, bidder_wallet, amount_cents) VALUES (${TIDE}, 7, '0xbob', 1500);`
);

await expectRaise(
  "a bid that does not beat the standing bid is refused",
  `INSERT INTO auction_bids (tide_id, token_id, bidder_wallet, amount_cents) VALUES (${TIDE}, 7, '0xbob', 3000);`
);

// THE ORIGINAL BUG: a lower bid placed later must never take the lot.
await expectRaise(
  "a LOWER bid placed after a higher one is refused (the $1-beats-$5000 bug)",
  `INSERT INTO auction_bids (tide_id, token_id, bidder_wallet, amount_cents) VALUES (${TIDE}, 7, '0xbob', 100);`
);

await db.exec(`INSERT INTO auction_bids (tide_id, token_id, bidder_wallet, amount_cents) VALUES (${TIDE}, 7, '0xbob', 4000);`);

await expectRaise(
  "bidding against yourself while winning is refused",
  `INSERT INTO auction_bids (tide_id, token_id, bidder_wallet, amount_cents) VALUES (${TIDE}, 7, '0xbob', 5000);`
);

await db.exec(`INSERT INTO auction_bids (tide_id, token_id, bidder_wallet, amount_cents) VALUES (${TIDE}, 7, '0xcarol', 5000);`);

// Money is compared numerically, not as text — the column was TEXT wei once, where
// '9' sorted above '10'.
check(
  "the highest bid is the largest AMOUNT, not the newest row",
  (await one(`SELECT amount_cents::int AS a FROM auction_bids
               WHERE tide_id=${TIDE} AND token_id=7 AND status='active'
               ORDER BY amount_cents DESC LIMIT 1`)).a,
  5000
);

// ── Settling ────────────────────────────────────────────────────────────────
await expectRaise(
  "settling while the auction is still running is refused",
  `SELECT settle_tide_auction(${TIDE}, '0xhost');`
);

await db.exec(`UPDATE tides SET end_time = now() - interval '1 minute', status='ended' WHERE id=${TIDE};`);

await expectRaise(
  "settling as someone other than the host is refused",
  `SELECT settle_tide_auction(${TIDE}, '0xalice');`
);

await db.exec(`UPDATE seller_stripe_accounts SET payouts_enabled=false WHERE wallet_address='0xhost';`);
await expectRaise(
  "settling is refused while the host cannot receive payouts",
  `SELECT settle_tide_auction(${TIDE}, '0xhost');`
);
await db.exec(`UPDATE seller_stripe_accounts SET payouts_enabled=true WHERE wallet_address='0xhost';`);

await db.exec(`SELECT settle_tide_auction(${TIDE}, '0xhost');`);

check(
  "lot 7 settles to the highest bidder, lot 8 is unsold with no bids",
  await all(`SELECT token_id::int AS token_id, status, coalesce(winner_wallet,'-') AS winner, coalesce(amount_cents,0)::int AS amount
               FROM auction_settlements WHERE tide_id=${TIDE} ORDER BY token_id`),
  [
    { token_id: 7, status: "awaiting_payment", winner: "0xcarol", amount: 5000 },
    { token_id: 8, status: "unsold", winner: "-", amount: 0 },
  ]
);

check(
  "the winning bid is marked won and the rest outbid",
  await all(`SELECT amount_cents::int AS amount, status FROM auction_bids
               WHERE tide_id=${TIDE} AND token_id=7 ORDER BY amount_cents`),
  [
    { amount: 3000, status: "outbid" },
    { amount: 4000, status: "outbid" },
    { amount: 5000, status: "won" },
  ]
);

// Settling again must be a no-op. It was not: unsold lots gained a row per call,
// because the skip check and the partial unique index covered the same statuses.
await db.exec(`SELECT settle_tide_auction(${TIDE}, '0xhost');`);
check(
  "settling twice does not duplicate a settlement",
  (await one(`SELECT count(*)::int AS n FROM auction_settlements WHERE tide_id=${TIDE}`)).n,
  2
);

// ── Ownership cannot move before money ──────────────────────────────────────
const settlement = (await one(`SELECT id FROM auction_settlements WHERE tide_id=${TIDE} AND token_id=7`)).id;

await expectRaise(
  "transferring the fish before payment is refused",
  `SELECT transfer_auction_lot('${settlement}');`
);

// ── A decline is recoverable, not a forfeit ─────────────────────────────────
await db.exec(`SELECT record_auction_payment_failure('${settlement}', 'Your card was declined.');`);
check(
  "a decline records payment_failed with the reason, not forfeited",
  await one(`SELECT status, attempts::int AS attempts, last_error FROM auction_settlements WHERE id='${settlement}'`),
  { status: "payment_failed", attempts: 1, last_error: "Your card was declined." }
);

// ── The forfeit chain ───────────────────────────────────────────────────────
// Carol never pays. The lot must fall to Bob at $40 — a bid that was demoted to
// 'outbid' at settlement, which must not cost him the lot.
await db.exec(`SELECT forfeit_auction_settlement('${settlement}', 'Payment window expired');`);

check(
  "a non-paying winner is retired and the next-highest bid is promoted",
  await all(`SELECT status, coalesce(winner_wallet,'-') AS winner, coalesce(amount_cents,0)::int AS amount
               FROM auction_settlements WHERE tide_id=${TIDE} AND token_id=7 ORDER BY created_at`),
  [
    { status: "forfeited", winner: "0xcarol", amount: 5000 },
    { status: "awaiting_payment", winner: "0xbob", amount: 4000 },
  ]
);

check(
  "the forfeited bid cannot be promoted again",
  (await one(`SELECT status FROM auction_bids WHERE tide_id=${TIDE} AND token_id=7 AND amount_cents=5000`)).status,
  "forfeited"
);

// ── Payment, and webhook retries ────────────────────────────────────────────
const live = (await one(`SELECT id FROM auction_settlements
                          WHERE tide_id=${TIDE} AND token_id=7 AND status='awaiting_payment'`)).id;

await db.exec(`SELECT mark_auction_settlement_paid('${live}', 'pi_123');`);
check(
  "payment records paid with the payment intent",
  await one(`SELECT status, stripe_payment_intent, (paid_at IS NOT NULL) AS stamped
               FROM auction_settlements WHERE id='${live}'`),
  { status: "paid", stripe_payment_intent: "pi_123", stamped: true }
);

// Stripe retries webhooks. A duplicate must not look like a second payment.
check(
  "a duplicate webhook reports already_paid rather than paying twice",
  (await one(`SELECT mark_auction_settlement_paid('${live}', 'pi_123') -> 'already_paid' AS dup`)).dup,
  true
);

await expectRaise(
  "recording a failure against a paid lot is refused",
  `SELECT record_auction_payment_failure('${live}', 'late decline');`
);

await expectRaise(
  "forfeiting a paid lot is refused",
  `SELECT forfeit_auction_settlement('${live}', 'nope');`
);

// ── Transfer ────────────────────────────────────────────────────────────────
await db.exec(`SELECT transfer_auction_lot('${live}');`);
check(
  "the specimen moves to the winner once paid",
  await one(`SELECT owner_address FROM aquadex_specimens WHERE id='7'`),
  { owner_address: "0xbob" }
);
check(
  "the settlement is marked transferred",
  (await one(`SELECT status FROM auction_settlements WHERE id='${live}'`)).status,
  "transferred"
);

// A lot the seller no longer holds must RAISE rather than report a move that did
// not happen — the buyer has paid, so it needs a human.
await db.exec(`
  UPDATE auction_settlements SET status='paid' WHERE id='${live}';
  UPDATE aquadex_specimens SET owner_address='0xsomeone_else' WHERE id='7';
  INSERT INTO profiles (wallet_address) VALUES ('0xsomeone_else') ON CONFLICT DO NOTHING;
`);
await expectRaise(
  "transferring a lot the seller no longer holds raises instead of silently passing",
  `SELECT transfer_auction_lot('${live}');`
);

// ── The overdue sweep ───────────────────────────────────────────────────────
check(
  "the sweep leaves settlements inside their window alone",
  (await one(`SELECT jsonb_array_length(sweep_overdue_auction_settlements()) AS n`)).n,
  0
);

console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 1 * 0 : 1);
