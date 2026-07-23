/**
 * BuyerInsights.jsx — Buyer-facing order insights + XP progress (Task 21C).
 *
 * Renders the buyer-side `buyer_order_analytics` view (already fetched
 * elsewhere via `fetchBuyerAnalytics` — this is the first UI over it) plus
 * an XP-progress hero element sourced from the same tier ladder
 * `entitlements.js`/`utils/xp.js` already use elsewhere (no forked tier
 * math). Basic order history/insights are universal here — nothing in this
 * component is XP-gated; deeper analytics stay in the existing
 * `OrderAnalytics` (Pelagic-gated `order_analytics`/`csv_export`).
 *
 * Mounted in CheckoutSummary.jsx (the buyer's order-history surface),
 * alongside the existing OrderAnalytics/OrderWatchlistReorder sections.
 */
import React, { useEffect, useMemo, useState } from "react";
import { ChartLineUp, ShoppingCart, Users, Star, Package, Handshake } from "@phosphor-icons/react";
import { fetchBuyerAnalytics } from "../services/ordersSync";
import { formatPriceCents } from "../services/catalogQuery";
import { TIER_LADDER } from "../utils/xp";

/**
 * Resolve XP-progress display fields for a given XP total, reusing
 * TIER_LADDER (the same tier ladder entitlements.js/getNextTierUnlocks
 * read) rather than a locally re-derived threshold table.
 * @param {number} totalXp
 * @returns {{ currentTier:Object, nextTier:(Object|null), progressPct:number, xpToNext:number }}
 */
export function resolveXpProgress(totalXp = 0) {
  const xp = Number(totalXp) || 0;
  let currentIndex = 0;
  for (let i = 0; i < TIER_LADDER.length; i++) {
    if (xp >= TIER_LADDER[i].min) currentIndex = i;
  }
  const currentTier = TIER_LADDER[currentIndex];
  const nextTier = TIER_LADDER[currentIndex + 1] || null;

  if (!nextTier) {
    return { currentTier, nextTier: null, progressPct: 100, xpToNext: 0 };
  }

  const span = nextTier.min - currentTier.min;
  const progress = span > 0 ? (xp - currentTier.min) / span : 1;
  return {
    currentTier,
    nextTier,
    progressPct: Math.max(0, Math.min(100, Math.round(progress * 100))),
    xpToNext: Math.max(0, nextTier.min - xp),
  };
}

export function BuyerInsights({ walletAccount, totalXp = 0, casualModeActive = false }) {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!walletAccount) { setLoading(false); return; }
    let cancelled = false;
    (async () => {
      setLoading(true);
      const data = await fetchBuyerAnalytics(walletAccount);
      if (!cancelled) {
        setStats(data);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [walletAccount]);

  const xpProgress = useMemo(() => resolveXpProgress(totalXp), [totalXp]);

  if (loading) {
    return (
      <div className="buyer-insights">
        <div className="shimmer-placeholder" style={{ height: "160px", borderRadius: "14px" }} />
      </div>
    );
  }

  const hasOrders = !!stats && stats.total_orders > 0;

  return (
    <section className="buyer-insights" aria-label="Your buying activity">
      <h3 className="buyer-insights__title">
        <ChartLineUp weight="duotone" size={20} style={{ color: "var(--accent-blue)" }} />
        {casualModeActive ? "Your Activity" : "Buying Insights"}
      </h3>

      {!hasOrders ? (
        <div className="glass-card" style={{ padding: "1.5rem", textAlign: "center" }}>
          <p style={{ color: "var(--text-muted)", fontSize: "0.82rem", margin: 0 }}>
            {casualModeActive
              ? "Once you place your first order, your activity and rewards progress will show up here."
              : "No purchases yet. Insights populate after your first completed order."}
          </p>
        </div>
      ) : (
        <div className="buyer-insights__kpis">
          <InsightTile
            icon={<ShoppingCart weight="duotone" size={18} />}
            color="#38bdf8"
            label="Orders"
            value={stats.total_orders.toLocaleString()}
          />
          <InsightTile
            icon={<Package weight="duotone" size={18} />}
            color="#a78bfa"
            label="Spent"
            value={formatPriceCents(stats.total_spent_cents || 0)}
          />
          <InsightTile
            icon={<Users weight="duotone" size={18} />}
            color="#34d399"
            label="Sellers"
            value={(stats.unique_sellers || 0).toLocaleString()}
          />
          <InsightTile
            icon={<Star weight="duotone" size={18} />}
            color="#fbbf24"
            label="XP Earned"
            value={(stats.total_xp_earned || 0).toLocaleString()}
          />
        </div>
      )}

      {/* XP-progress hero element — the one warm/achievement-gradient
          element in this view (per docs/BRAND_KIT.md, used sparingly).
          Encouraging framing, never a nag: shown regardless of order
          history, since XP accrues from more than just purchases. */}
      <div className="buyer-insights__xp-progress glass-card">
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.25rem" }}>
          <Handshake weight="duotone" size={18} style={{ color: "var(--amber-400, #fbbf24)" }} />
          <strong style={{ fontFamily: "Outfit, sans-serif", fontSize: "0.85rem", color: "#fff" }}>
            {xpProgress.currentTier.breederLabel || xpProgress.currentTier.key}
          </strong>
        </div>
        <div
          className="buyer-insights__xp-bar-track"
          role="progressbar"
          aria-valuenow={xpProgress.progressPct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={xpProgress.nextTier ? `Progress toward ${xpProgress.nextTier.key}` : "Highest tier reached"}
        >
          <div className="buyer-insights__xp-bar-fill" style={{ width: `${xpProgress.progressPct}%` }} />
        </div>
        <p style={{ fontSize: "0.72rem", color: "var(--text-muted)", margin: "0.4rem 0 0" }}>
          {xpProgress.nextTier
            ? `${xpProgress.xpToNext.toLocaleString()} XP to ${xpProgress.nextTier.key}`
            : "You've reached the highest tier."}
        </p>
      </div>
    </section>
  );
}

function InsightTile({ icon, color, label, value }) {
  return (
    <div className="glass-card" style={{ padding: "0.85rem", display: "flex", flexDirection: "column", alignItems: "center", gap: "0.3rem", borderTop: `2px solid ${color}` }}>
      <span style={{ color, display: "flex" }}>{icon}</span>
      <span style={{ fontFamily: "Outfit, sans-serif", fontSize: "1.05rem", fontWeight: 700, color: "#fff" }}>{value}</span>
      <span style={{ fontSize: "0.62rem", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.03em" }}>{label}</span>
    </div>
  );
}
