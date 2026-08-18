/**
 * AuctionPanel.jsx
 *
 * Real-time bidding UI for Auction Tides.
 * - Current high bid display + countdown timer
 * - Bid input with minimum increment enforcement
 * - Bid history list
 * - Real-time updates via Supabase Realtime
 *
 * MONEY: every amount here is an integer number of US cents, formatted through
 * utils/money. This panel used to quote wei and ETH, which was left over from
 * when Aquadex was an on-chain protocol — no part of the product settles in
 * crypto. See utils/money.js for why dollars→cents never goes through a float.
 */

import { useState, useEffect, useMemo } from "react";
import {
  useAuction,
  useAuctionPaymentMethod,
  useAddPaymentMethod,
  useAuctionSettlements,
  useSettleAuction,
  useChargeAuctionLot,
} from "../../hooks/useTides";
import { getAuctionItems } from "../../services/tidesApi";
import { isSellerFiatReady, startSellerOnboarding } from "../../services/stripePayments";
import { getCurrentWallet } from "../../services/supabaseClient";
import { sameWallet } from "../../utils/wallet";
import { formatUsdCents, parseUsdToCents, minimumNextBidCents } from "../../utils/money";
import { ProfileCard } from "./ProfileCard";

/**
 * "Add a card before you bid" gate.
 *
 * Bidding requires a saved payment method, and the winning bid is charged
 * automatically when the lot closes. That is the anti-gaming design: it removes
 * the moment where a winner decides whether to pay, rather than penalising
 * non-payment after the fact.
 *
 * Shown BEFORE the bid form. The database rejects a card-less bid regardless
 * (enforce_bidder_has_payment_method), but discovering that after typing an amount
 * is a bad way to learn the rule.
 */
function PaymentMethodGate({ card, onAdd, adding, error }) {
  if (card?.hasCard) {
    return (
      <p className="auction-panel__card-ok">
        💳 {card.brand ? `${card.brand} ending ${card.last4}` : "Card on file"} — the
        winning bid is charged automatically when a lot closes.
      </p>
    );
  }

  return (
    <div className="auction-panel__card-gate">
      <h4>💳 Add a card to bid</h4>
      <p className="text-muted">
        A bid is a commitment: if you win, the amount is charged automatically when
        the lot closes. Nothing is charged now, and your card details go straight to
        Stripe.
      </p>
      <button className="btn btn--primary btn--sm" onClick={onAdd} disabled={adding}>
        {adding ? "Opening Stripe…" : "Add payment method"}
      </button>
      {error && <p className="auction-item__error" role="alert">{error}</p>}
    </div>
  );
}

/** Human copy for a settlement state. */
function settlementSummary(s) {
  switch (s.status) {
    case "awaiting_payment":
      return { tone: "due", text: "Payment due" };
    case "payment_failed":
      return { tone: "due", text: s.last_error || "Payment failed" };
    case "paid":
      return { tone: "ok", text: "Paid — transfer pending" };
    case "transferred":
      return { tone: "ok", text: "Paid and transferred" };
    case "forfeited":
      return { tone: "off", text: "Forfeited — offered to the next bidder" };
    case "unsold":
      return { tone: "off", text: "Unsold — no bids" };
    default:
      return { tone: "off", text: s.status };
  }
}

function AuctionCountdown({ endTime }) {
  const [timeStr, setTimeStr] = useState("");

  useEffect(() => {
    function update() {
      const diff = new Date(endTime).getTime() - Date.now();
      if (diff <= 0) {
        setTimeStr("Ended");
        return;
      }
      const h = Math.floor(diff / 3600000);
      const m = Math.floor((diff / 60000) % 60);
      const s = Math.floor((diff / 1000) % 60);
      setTimeStr(`${h}h ${m}m ${s}s`);
    }
    update();
    const iv = setInterval(update, 1000);
    return () => clearInterval(iv);
  }, [endTime]);

  return <span className="auction-countdown">{timeStr}</span>;
}

function AuctionItemCard({ tideId, item, endTime, isLive, canBid = true }) {
  const { highestBid, bidHistory, submitBid } = useAuction(tideId, item.token_id, isLive);
  const [bidInput, setBidInput] = useState("");
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const walletAddress = getCurrentWallet();

  const minimumBid = useMemo(
    () =>
      minimumNextBidCents({
        standingBidCents: highestBid?.amount_cents ?? null,
        reserveCents: item.reserve_cents ?? null,
      }),
    [highestBid?.amount_cents, item.reserve_cents]
  );

  const isWinning = sameWallet(highestBid?.bidder_wallet, walletAddress);

  const handleBid = async (e) => {
    e.preventDefault();
    setError(null);

    const { cents, error: parseError } = parseUsdToCents(bidInput);
    if (parseError) {
      setError(parseError);
      return;
    }

    if (cents < minimumBid) {
      setError(`Minimum bid is ${formatUsdCents(minimumBid)}.`);
      return;
    }

    setSubmitting(true);
    const { error: bidError } = await submitBid(cents);
    if (bidError) {
      // The DB trigger owns the real rules (reserve, must-beat-standing, no
      // self-outbid, tide must be live) and writes its messages for the bidder,
      // so surface them rather than a generic failure.
      setError(typeof bidError === "string" ? bidError : bidError.message || "Bid failed");
    } else {
      setBidInput("");
    }
    setSubmitting(false);
  };

  const lotName = item.title || item.species_name || `Lot #${item.token_id}`;

  return (
    <article className="auction-item" aria-label={`Auction lot: ${lotName}`}>
      <div className="auction-item__header">
        <h4>{lotName}</h4>
        {item.species_name && item.title && (
          <span className="auction-item__species">{item.species_name}</span>
        )}
        <AuctionCountdown endTime={endTime} />
      </div>

      {item.notes && <p className="auction-item__notes">{item.notes}</p>}

      {/* Current highest bid */}
      <div className="auction-item__current-bid">
        <span className="auction-item__label">Current Bid</span>
        <span className="auction-item__amount">
          {highestBid ? formatUsdCents(highestBid.amount_cents, { showCents: false }) : "No bids yet"}
        </span>
        {!highestBid && item.reserve_cents > 0 && (
          <span className="auction-item__reserve">
            Opening at {formatUsdCents(item.reserve_cents, { showCents: false })}
          </span>
        )}
        {highestBid?.bidder_profile && (
          <div className="auction-item__bidder">
            <ProfileCard
              walletAddress={highestBid.bidder_profile.wallet_address}
              displayName={highestBid.bidder_profile.display_name}
              avatarUrl={highestBid.bidder_profile.avatar_url}
              companionTier={highestBid.bidder_profile.companion_tier}
              size="small"
            />
            {isWinning && <span className="auction-item__winning">✓ You're winning!</span>}
          </div>
        )}
      </div>

      {/* Bid input (only when live) */}
      {isLive && (
        <form className="auction-item__bid-form" onSubmit={handleBid}>
          <div className="auction-item__bid-input-group">
            <span className="auction-item__currency" aria-hidden="true">$</span>
            <input
              type="text"
              inputMode="decimal"
              value={bidInput}
              onChange={(e) => setBidInput(e.target.value)}
              placeholder={formatUsdCents(minimumBid, { showCents: false }).replace("$", "")}
              className="auction-item__bid-input"
              disabled={submitting || isWinning || !canBid}
              aria-label={`Bid amount in US dollars, minimum ${formatUsdCents(minimumBid)}`}
            />
            <button
              type="submit"
              className="btn btn--primary"
              disabled={submitting || !bidInput || isWinning || !canBid}
            >
              {submitting ? "Bidding…" : "Place Bid"}
            </button>
          </div>
          <p className="auction-item__hint">
            {!canBid
              ? "Add a payment method above to bid on this lot."
              : isWinning
                ? "You hold the high bid — sit tight."
                : `Next bid: ${formatUsdCents(minimumBid)} or more`}
          </p>
          {error && <p className="auction-item__error" role="alert">{error}</p>}
        </form>
      )}

      {/* Bid history */}
      {bidHistory.length > 0 && (
        <details className="auction-item__history">
          <summary>Bid History ({bidHistory.length})</summary>
          <ul>
            {bidHistory.slice(0, 10).map((bid) => (
              <li key={bid.id} className="auction-item__history-row">
                <span>
                  {bid.bidder_profile?.display_name || `${bid.bidder_wallet?.slice(0, 8)}…`}
                </span>
                <span>{formatUsdCents(bid.amount_cents, { showCents: false })}</span>
                <time dateTime={bid.created_at}>
                  {new Date(bid.created_at).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </time>
                {bid.status === "outbid" && <span className="bid-status--outbid">Outbid</span>}
                {bid.status === "won" && <span className="bid-status--won">Winner!</span>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </article>
  );
}

export function AuctionPanel({ tideId, isLive = false, endTime, isHost = false, isEnded = false }) {
  const [auctionItems, setAuctionItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [actionError, setActionError] = useState(null);

  const walletAddress = getCurrentWallet();

  const { data: card } = useAuctionPaymentMethod(!!walletAddress);
  const addCard = useAddPaymentMethod();

  // Results only exist once the host settles, so only fetch them then.
  const { data: settlements = [] } = useAuctionSettlements(tideId, isEnded);
  const settleAuction = useSettleAuction(tideId);
  const chargeLot = useChargeAuctionLot(tideId);

  const mySettlements = settlements.filter((s) => sameWallet(s.winner_wallet, walletAddress));
  const settled = settlements.length > 0;

  // null = still checking, so the settle button can say so rather than flashing
  // the wrong state on first paint.
  const [payoutsReady, setPayoutsReady] = useState(null);
  const [startingPayouts, setStartingPayouts] = useState(false);

  useEffect(() => {
    if (!isHost || !isEnded || !walletAddress) return;
    let cancelled = false;

    isSellerFiatReady(walletAddress)
      .then((ready) => { if (!cancelled) setPayoutsReady(!!ready); })
      .catch(() => { if (!cancelled) setPayoutsReady(false); });

    return () => { cancelled = true; };
  }, [isHost, isEnded, walletAddress]);

  const handleStartPayouts = async () => {
    setActionError(null);
    setStartingPayouts(true);
    const { success, onboardingUrl, error } = await startSellerOnboarding({ walletAddress });
    if (success && onboardingUrl) {
      window.location.href = onboardingUrl;
      return;
    }
    setActionError(error || "Couldn't open Stripe onboarding.");
    setStartingPayouts(false);
  };

  const run = (mutation, args) => {
    setActionError(null);
    mutation.mutate(args, {
      onSuccess: (res) => {
        // The DB functions and the charge endpoint both return their own messages
        // ("Finish Stripe payout setup before settling", a card decline). Surface
        // those rather than a generic failure.
        if (res?.error) {
          setActionError(typeof res.error === "string" ? res.error : res.error.message);
        } else if (res?.transferError) {
          setActionError(
            `Paid, but the fish couldn't be transferred automatically: ${res.transferError}. The host has been notified.`
          );
        }
      },
      onError: (err) => setActionError(err?.message || "That didn't work."),
    });
  };

  useEffect(() => {
    let cancelled = false;

    async function loadItems() {
      const { data, error } = await getAuctionItems(tideId);
      if (cancelled) return;
      if (error) {
        console.error("[AuctionPanel] failed to load lots:", error);
        setLoadError(typeof error === "string" ? error : error.message || "Could not load lots");
      } else {
        setLoadError(null);
        setAuctionItems(data || []);
      }
      setLoading(false);
    }

    loadItems();
    return () => { cancelled = true; };
  }, [tideId]);

  if (loading) {
    return (
      <div className="auction-panel auction-panel--loading">
        <p className="text-muted">Loading auction lots…</p>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="auction-panel auction-panel--empty">
        <h3>🔨 Auction</h3>
        <p className="text-muted" role="alert">Couldn't load the lots. {loadError}</p>
      </div>
    );
  }

  if (auctionItems.length === 0) {
    return (
      <div className="auction-panel auction-panel--empty">
        <h3>🔨 Auction</h3>
        <p className="text-muted">
          No lots have been listed for this auction yet. The host adds them when
          setting up the tide.
        </p>
      </div>
    );
  }

  return (
    <section className="auction-panel" aria-label="Live Auction">
      <header className="auction-panel__header">
        <h3>🔨 {isEnded ? "Auction Results" : "Live Auction"}</h3>
        {!isLive && !isEnded && <p className="text-muted">Bidding opens when the tide goes live.</p>}
      </header>

      {/* The card requirement, stated before the bid form rather than after. */}
      {isLive && walletAddress && !isHost && (
        <PaymentMethodGate
          card={card}
          adding={addCard.isPending}
          error={addCard.error?.message}
          onAdd={() => addCard.mutate()}
        />
      )}

      {/* ── Host: close the auction ─────────────────────────────────────── */}
      {isHost && isEnded && !settled && (
        <div className="auction-panel__host">
          {payoutsReady === false ? (
            // settle_tide_auction refuses unless the host can actually receive
            // payouts — better than telling someone they sold a fish with nowhere
            // to send the money. But the onboarding flow lives in the Breeder
            // Terminal, so the bare refusal was a dead end: a message about Stripe
            // setup with no way to do it. The action goes here instead.
            <>
              <p className="text-muted">
                Set up Stripe payouts before settling. Winners are charged
                automatically, so the money needs somewhere to land.
              </p>
              <button
                className="btn btn--primary btn--sm"
                onClick={handleStartPayouts}
                disabled={startingPayouts}
              >
                {startingPayouts ? "Opening Stripe…" : "Set up payouts"}
              </button>
            </>
          ) : (
            <>
              <p className="text-muted">
                The auction has ended. Settling picks the winner for each lot, charges
                nothing yet, and can't be undone.
              </p>
              <button
                className="btn btn--primary btn--sm"
                onClick={() => {
                  if (!confirm("Settle this auction? Winners are locked in for every lot.")) return;
                  run(settleAuction);
                }}
                disabled={settleAuction.isPending || payoutsReady === null}
              >
                {settleAuction.isPending
                  ? "Settling…"
                  : payoutsReady === null
                    ? "Checking payouts…"
                    : "🏁 Settle auction"}
              </button>
            </>
          )}
        </div>
      )}

      {/* ── Winner: pay for what you won ────────────────────────────────── */}
      {mySettlements.length > 0 && (
        <div className="auction-panel__mine">
          <h4>Your lots</h4>
          {mySettlements.map((s) => {
            const summary = settlementSummary(s);
            const owes = s.status === "awaiting_payment" || s.status === "payment_failed";

            return (
              <div key={s.id} className="auction-settlement">
                <div className="auction-settlement__info">
                  <strong>Lot #{s.token_id}</strong>
                  <span>{formatUsdCents(s.amount_cents, { showCents: false })}</span>
                  <span className={`auction-settlement__state auction-settlement__state--${summary.tone}`}>
                    {summary.text}
                  </span>
                  {owes && s.payment_deadline && (
                    <span className="text-muted">
                      Pay by {new Date(s.payment_deadline).toLocaleString(undefined, {
                        month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
                      })}
                      {/* Said plainly, because it is the consequence that makes the
                          deadline mean anything. */}
                      {" — after that the lot goes to the next bidder."}
                    </span>
                  )}
                </div>

                {owes && (
                  <button
                    className="btn btn--primary btn--sm"
                    onClick={() => run(chargeLot, { settlementId: s.id })}
                    disabled={chargeLot.isPending}
                  >
                    {chargeLot.isPending
                      ? "Charging…"
                      : `Pay ${formatUsdCents(s.amount_cents, { showCents: false })}`}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {actionError && <p className="auction-item__error" role="alert">{actionError}</p>}

      {/* ── All lot outcomes, once settled ──────────────────────────────── */}
      {settled ? (
        <div className="auction-panel__results">
          {settlements.map((s) => {
            const summary = settlementSummary(s);
            return (
              <div key={s.id} className="auction-settlement">
                <div className="auction-settlement__info">
                  <strong>Lot #{s.token_id}</strong>
                  {s.winner_profile ? (
                    <ProfileCard
                      walletAddress={s.winner_profile.wallet_address}
                      displayName={s.winner_profile.display_name}
                      avatarUrl={s.winner_profile.avatar_url}
                      companionTier={s.winner_profile.companion_tier}
                      size="small"
                    />
                  ) : (
                    <span className="text-muted">No winner</span>
                  )}
                  {s.amount_cents > 0 && (
                    <span>{formatUsdCents(s.amount_cents, { showCents: false })}</span>
                  )}
                  <span className={`auction-settlement__state auction-settlement__state--${summary.tone}`}>
                    {summary.text}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="auction-panel__items">
          {auctionItems.map((item) => (
            <AuctionItemCard
              key={item.token_id}
              tideId={tideId}
              item={item}
              endTime={endTime}
              isLive={isLive}
              canBid={!!card?.hasCard}
            />
          ))}
        </div>
      )}
    </section>
  );
}

export default AuctionPanel;
