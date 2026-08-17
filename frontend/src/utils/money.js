/**
 * money.js — USD amounts as integer cents.
 *
 * Aquadex settles in dollars and stores every amount as an integer number of
 * cents (orders.subtotal_cents, canonical_order_ledger.amount_cents,
 * auction_bids.amount_cents). Never store money as a float: 0.1 + 0.2 is not 0.3,
 * and a cent lost per row is a ledger that does not reconcile.
 *
 * The parsing direction is the one that actually bites. `parseFloat("19.99") * 100`
 * is 1998.9999999999998, so a naive `Math.floor` turns $19.99 into $19.98. Every
 * dollars→cents conversion in the app should come through parseUsdToCents.
 */

/** Largest amount we accept anywhere. Matches the DB sanity CHECKs ($1,000,000). */
export const MAX_USD_CENTS = 100_000_000;

/**
 * Format integer cents as a dollar string.
 *
 * @param {number|string|null|undefined} cents
 * @param {{ showCents?: boolean }} [opts] - showCents false drops a trailing ".00"
 *   for round amounts, which reads better on auction lots ("$75" not "$75.00").
 * @returns {string} e.g. "$19.99", or "—" for a missing amount
 */
export function formatUsdCents(cents, { showCents = true } = {}) {
  if (cents === null || cents === undefined || cents === "") return "—";

  const n = Number(cents);
  if (!Number.isFinite(n)) return "—";

  const dollars = n / 100;
  const isRound = n % 100 === 0;

  return dollars.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: !showCents && isRound ? 0 : 2,
    maximumFractionDigits: 2,
  });
}

/**
 * Parse a user-entered dollar amount into integer cents.
 *
 * Accepts "19.99", "$19.99", "1,299", " 20 ". Rejects negatives, more than two
 * decimal places, anything non-numeric, and amounts over MAX_USD_CENTS.
 *
 * @param {string|number} input
 * @returns {{ cents: number, error: null } | { cents: null, error: string }}
 */
export function parseUsdToCents(input) {
  if (input === null || input === undefined) return { cents: null, error: "Enter an amount." };

  const raw = String(input).trim().replace(/^\$/, "").replace(/,/g, "");
  if (!raw) return { cents: null, error: "Enter an amount." };

  if (!/^\d+(\.\d{1,2})?$/.test(raw)) {
    if (/^\d+\.\d{3,}$/.test(raw)) return { cents: null, error: "Use at most two decimal places." };
    return { cents: null, error: "Enter a dollar amount, like 24.99." };
  }

  // Round rather than truncate: parseFloat("19.99") * 100 is 1998.999…
  const cents = Math.round(parseFloat(raw) * 100);

  if (cents <= 0) return { cents: null, error: "Amount must be more than $0." };
  if (cents > MAX_USD_CENTS) {
    return { cents: null, error: `Amount can't exceed ${formatUsdCents(MAX_USD_CENTS, { showCents: false })}.` };
  }

  return { cents, error: null };
}

/**
 * The next acceptable bid on a lot, in cents.
 *
 * With a standing bid this is that bid plus a 5% increment (rounded up to the
 * next whole cent, and always at least +$1 so cheap lots still move). With no
 * bids it is the reserve, or $1 if the host set none.
 *
 * This mirrors, but is not the authority for, the DB rule that a bid must
 * strictly beat the standing bid — enforce_auction_bid_rules is.
 */
export function minimumNextBidCents({ standingBidCents = null, reserveCents = null } = {}) {
  if (standingBidCents) {
    const increment = Math.max(100, Math.ceil(standingBidCents * 0.05));
    return standingBidCents + increment;
  }
  return reserveCents && reserveCents > 0 ? reserveCents : 100;
}
