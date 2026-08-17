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
import { useAuction } from "../../hooks/useTides";
import { getAuctionItems } from "../../services/tidesApi";
import { getCurrentWallet } from "../../services/supabaseClient";
import { sameWallet } from "../../utils/wallet";
import { formatUsdCents, parseUsdToCents, minimumNextBidCents } from "../../utils/money";
import { ProfileCard } from "./ProfileCard";

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

function AuctionItemCard({ tideId, item, endTime, isLive }) {
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
              disabled={submitting || isWinning}
              aria-label={`Bid amount in US dollars, minimum ${formatUsdCents(minimumBid)}`}
            />
            <button
              type="submit"
              className="btn btn--primary"
              disabled={submitting || !bidInput || isWinning}
            >
              {submitting ? "Bidding…" : "Place Bid"}
            </button>
          </div>
          <p className="auction-item__hint">
            {isWinning
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

export function AuctionPanel({ tideId, isLive = false, endTime }) {
  const [auctionItems, setAuctionItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

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
        <h3>🔨 Live Auction</h3>
        {!isLive && <p className="text-muted">Bidding opens when the tide goes live.</p>}
      </header>

      <div className="auction-panel__items">
        {auctionItems.map((item) => (
          <AuctionItemCard
            key={item.token_id}
            tideId={tideId}
            item={item}
            endTime={endTime}
            isLive={isLive}
          />
        ))}
      </div>
    </section>
  );
}

export default AuctionPanel;
