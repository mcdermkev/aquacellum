/**
 * AuctionPanel.jsx
 * 
 * Real-time bidding UI for Auction Tides.
 * - Current high bid display + countdown timer
 * - Bid input with minimum increment enforcement
 * - Bid history list
 * - Real-time updates via Supabase Realtime
 */

import { useState, useEffect, useMemo } from "react";
import { useAuction } from "../../hooks/useTides";
import { getAuctionItems } from "../../services/tidesApi";
import { getCurrentWallet } from "../../services/supabaseClient";
import { ProfileCard } from "./ProfileCard";

/**
 * Format wei to a readable ETH amount.
 */
function formatEth(weiStr) {
  if (!weiStr) return "0";
  try {
    const eth = parseFloat(weiStr) / 1e18;
    return eth.toFixed(4);
  } catch {
    return "0";
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

function AuctionItemCard({ tideId, item, endTime, isLive }) {
  const { highestBid, bidHistory, submitBid } = useAuction(tideId, item.token_id, isLive);
  const [bidInput, setBidInput] = useState("");
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const walletAddress = getCurrentWallet();

  // Minimum bid: current highest + 5% increment (or reserve price)
  const minimumBid = useMemo(() => {
    if (highestBid?.amount_wei) {
      const current = BigInt(highestBid.amount_wei);
      const increment = current / 20n; // 5%
      return current + increment;
    }
    return BigInt(item.reserve_wei || "0");
  }, [highestBid, item.reserve_wei]);

  const handleBid = async (e) => {
    e.preventDefault();
    setError(null);

    if (!bidInput || isNaN(bidInput)) {
      setError("Enter a valid ETH amount.");
      return;
    }

    const amountWei = BigInt(Math.floor(parseFloat(bidInput) * 1e18)).toString();

    if (BigInt(amountWei) < minimumBid) {
      setError(`Minimum bid: ${formatEth(minimumBid.toString())} ETH`);
      return;
    }

    setSubmitting(true);
    const { error: bidError } = await submitBid(amountWei);
    if (bidError) {
      setError(typeof bidError === "string" ? bidError : bidError.message || "Bid failed");
    } else {
      setBidInput("");
    }
    setSubmitting(false);
  };

  const isWinning = highestBid?.bidder_wallet === walletAddress;

  return (
    <article className="auction-item" aria-label={`Auction item: Token #${item.token_id}`}>
      <div className="auction-item__header">
        <h4>Token #{item.token_id}</h4>
        {item.species_name && <span className="auction-item__species">{item.species_name}</span>}
        <AuctionCountdown endTime={endTime} />
      </div>

      {/* Current highest bid */}
      <div className="auction-item__current-bid">
        <span className="auction-item__label">Current Bid</span>
        <span className="auction-item__amount">
          {highestBid ? `${formatEth(highestBid.amount_wei)} ETH` : "No bids yet"}
        </span>
        {highestBid?.bidder_profile && (
          <div className="auction-item__bidder">
            <ProfileCard profile={highestBid.bidder_profile} compact />
            {isWinning && <span className="auction-item__winning">✓ You're winning!</span>}
          </div>
        )}
      </div>

      {/* Bid input (only when live) */}
      {isLive && (
        <form className="auction-item__bid-form" onSubmit={handleBid}>
          <div className="auction-item__bid-input-group">
            <input
              type="number"
              step="0.0001"
              min="0"
              value={bidInput}
              onChange={(e) => setBidInput(e.target.value)}
              placeholder={`Min: ${formatEth(minimumBid.toString())} ETH`}
              className="auction-item__bid-input"
              disabled={submitting}
              aria-label="Bid amount in ETH"
            />
            <button
              type="submit"
              className="btn btn--primary"
              disabled={submitting || !bidInput}
            >
              {submitting ? "Bidding…" : "Place Bid"}
            </button>
          </div>
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
                <span>{bid.bidder_wallet?.slice(0, 8)}…</span>
                <span>{formatEth(bid.amount_wei)} ETH</span>
                <time>
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

  useEffect(() => {
    async function loadItems() {
      const { data } = await getAuctionItems(tideId);
      setAuctionItems(data || []);
      setLoading(false);
    }
    loadItems();
  }, [tideId]);

  if (loading) {
    return (
      <div className="auction-panel auction-panel--loading">
        <p className="text-muted">Loading auction items…</p>
      </div>
    );
  }

  if (auctionItems.length === 0) {
    return (
      <div className="auction-panel auction-panel--empty">
        <h3>🔨 Auction</h3>
        <p className="text-muted">No auction items configured for this tide.</p>
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
