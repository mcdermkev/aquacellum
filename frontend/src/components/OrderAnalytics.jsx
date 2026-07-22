import React, { useState, useEffect } from "react";
import { fetchSellerAnalytics, fetchBuyerAnalytics, fetchOrderHistory } from "../services/ordersSync";
import { getNextTierUnlocks, ORDER_FEATURES } from "../utils/orderFeatureGates";
import { hasEntitlement } from "../services/entitlements";
import { db } from "../db";

/**
 * OrderAnalytics — XP-gated analytics dashboard for order data.
 * Unlocks at Pelagic tier (2,500 XP).
 *
 * Shows:
 *   - Revenue / spending over time
 *   - Avg fulfillment speed
 *   - Order count by type
 *   - CSV export capability
 *
 * Props:
 *   - walletAccount: current user's wallet
 *   - userTier: current XP tier (from profile)
 *   - totalXp: user's total XP
 *   - casualModeActive: language toggle
 */
export function OrderAnalytics({ walletAccount, userTier, totalXp, casualModeActive = false }) {
  const [sellerStats, setSellerStats] = useState(null);
  const [buyerStats, setBuyerStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("overview"); // "overview" | "selling" | "buying"

  // Gating sourced from the centralized entitlement map (Task 6/18) rather
  // than the legacy per-component isFeatureUnlocked check; ORDER_FEATURES is
  // kept for its copy/icon/progress-bar metadata below. Same tiers (Pelagic).
  const analyticsUnlocked = hasEntitlement("order_analytics", { tier: userTier, xp: totalXp });
  const csvUnlocked = hasEntitlement("csv_export", { tier: userTier, xp: totalXp });

  useEffect(() => {
    if (!walletAccount || !analyticsUnlocked) {
      setLoading(false);
      return;
    }

    (async () => {
      setLoading(true);
      const [seller, buyer] = await Promise.all([
        fetchSellerAnalytics(walletAccount),
        fetchBuyerAnalytics(walletAccount),
      ]);
      setSellerStats(seller);
      setBuyerStats(buyer);
      setLoading(false);
    })();
  }, [walletAccount, analyticsUnlocked]);

  // If feature is locked, show the unlock prompt
  if (!analyticsUnlocked) {
    const nextUnlocks = getNextTierUnlocks(userTier, totalXp);
    const feature = ORDER_FEATURES.ORDER_ANALYTICS;

    return (
      <div
        className="glass-card"
        style={{
          padding: "2rem",
          textAlign: "center",
          border: "1px solid rgba(251, 191, 36, 0.15)",
          background: "rgba(251, 191, 36, 0.02)",
        }}
      >
        <div style={{ fontSize: "2.5rem", marginBottom: "0.75rem" }}>{feature.icon}</div>
        <h4 style={{ color: "#fff", fontSize: "1.1rem", marginBottom: "0.5rem" }}>
          {feature.label}
        </h4>
        <p style={{ color: "var(--text-muted)", fontSize: "0.82rem", maxWidth: "380px", margin: "0 auto 1.25rem", lineHeight: "1.5" }}>
          {feature.description}
        </p>

        {/* XP progress bar */}
        <div style={{ maxWidth: "300px", margin: "0 auto" }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.7rem", color: "var(--text-muted)", marginBottom: "0.3rem" }}>
            <span>Your XP: {(totalXp || 0).toLocaleString()}</span>
            <span>Unlocks at: {feature.unlockXp.toLocaleString()}</span>
          </div>
          <div style={{
            height: "6px",
            borderRadius: "3px",
            background: "rgba(255, 255, 255, 0.06)",
            overflow: "hidden",
          }}>
            <div style={{
              height: "100%",
              width: `${Math.min(100, ((totalXp || 0) / feature.unlockXp) * 100)}%`,
              background: "linear-gradient(90deg, #fbbf24, #f59e0b)",
              borderRadius: "3px",
              transition: "width 0.5s ease",
            }} />
          </div>
          <div style={{ fontSize: "0.68rem", color: "var(--accent-amber, #fbbf24)", marginTop: "0.4rem", fontWeight: "600" }}>
            {Math.max(0, feature.unlockXp - (totalXp || 0)).toLocaleString()} XP to unlock
          </div>
        </div>

        {/* What else unlocks at this tier */}
        {nextUnlocks.features.length > 1 && (
          <div style={{ marginTop: "1.25rem", textAlign: "left", maxWidth: "320px", margin: "1.25rem auto 0" }}>
            <div style={{ fontSize: "0.68rem", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: "0.5rem" }}>
              Also unlocks at {feature.unlockTier}:
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem" }}>
              {nextUnlocks.features
                .filter((f) => f.key !== feature.key)
                .map((f) => (
                  <span
                    key={f.key}
                    style={{
                      padding: "0.2rem 0.5rem",
                      fontSize: "0.65rem",
                      background: "rgba(255,255,255,0.03)",
                      border: "1px solid rgba(255,255,255,0.06)",
                      borderRadius: "12px",
                      color: "var(--text-secondary)",
                    }}
                  >
                    {f.icon} {f.label}
                  </span>
                ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  if (loading) {
    return (
      <div className="glass-card" style={{ padding: "2rem", textAlign: "center" }}>
        <div className="shimmer-placeholder" style={{ height: "200px", borderRadius: "8px" }} />
      </div>
    );
  }

  // Compute local stats as fallback when cloud analytics aren't available
  const localStats = {
    totalOrders: (sellerStats?.total_orders || 0) + (buyerStats?.total_orders || 0),
    completedOrders: (sellerStats?.completed_orders || 0) + (buyerStats?.completed_orders || 0),
    totalRevenue: sellerStats?.total_revenue_cents || 0,
    totalSpent: buyerStats?.total_spent_cents || 0,
    avgDispatchHours: sellerStats?.avg_dispatch_hours || 0,
    avgDeliveryHours: sellerStats?.avg_delivery_hours || 0,
    disputedOrders: sellerStats?.disputed_orders || 0,
  };

  const handleExportCsv = async () => {
    if (!csvUnlocked) return;

    try {
      const orders = await fetchOrderHistory(walletAccount, { limit: 500 });
      if (!orders.length) return;

      const headers = ["Date", "Type", "Species", "Role", "Status", "Total ($)", "Tracking #", "Seller", "Buyer"];
      const rows = orders.map((o) => [
        new Date(o.created_at).toLocaleDateString(),
        o.order_type,
        o.items?.[0]?.commonName || "—",
        o.buyer_wallet === walletAccount.toLowerCase() ? "Buyer" : "Seller",
        o.status,
        (o.total_paid_cents / 100).toFixed(2),
        o.tracking_number || "—",
        o.seller_wallet?.slice(0, 10) || "—",
        o.buyer_wallet?.slice(0, 10) || "—",
      ]);

      const csv = [headers, ...rows].map((r) => r.join(",")).join("\n");
      const blob = new Blob([csv], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `aquadex-orders-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("[OrderAnalytics] CSV export failed:", err);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      {/* Tab Navigation */}
      <div style={{ display: "flex", gap: "0.5rem" }}>
        {[
          { key: "overview", label: "Overview", icon: "📊" },
          { key: "selling", label: "Selling", icon: "💰" },
          { key: "buying", label: "Buying", icon: "🛒" },
        ].map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            style={{
              padding: "0.4rem 0.75rem",
              fontSize: "0.72rem",
              fontWeight: activeTab === tab.key ? "700" : "500",
              background: activeTab === tab.key ? "rgba(139, 92, 246, 0.1)" : "rgba(255, 255, 255, 0.02)",
              border: activeTab === tab.key ? "1px solid rgba(139, 92, 246, 0.3)" : "1px solid rgba(255, 255, 255, 0.06)",
              borderRadius: "20px",
              color: activeTab === tab.key ? "var(--accent-purple, #a855f7)" : "var(--text-secondary)",
              cursor: "pointer",
            }}
          >
            {tab.icon} {tab.label}
          </button>
        ))}

        {/* CSV Export button */}
        {csvUnlocked && (
          <button
            onClick={handleExportCsv}
            style={{
              marginLeft: "auto",
              padding: "0.4rem 0.75rem",
              fontSize: "0.72rem",
              background: "rgba(255, 255, 255, 0.02)",
              border: "1px solid rgba(255, 255, 255, 0.08)",
              borderRadius: "20px",
              color: "var(--text-secondary)",
              cursor: "pointer",
            }}
          >
            📥 Export CSV
          </button>
        )}
      </div>

      {/* Overview Tab */}
      {activeTab === "overview" && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: "0.75rem" }}>
          <StatCard label="Total Orders" value={localStats.totalOrders} icon="📋" />
          <StatCard label="Completed" value={localStats.completedOrders} icon="✅" color="#34d399" />
          <StatCard label="Revenue" value={`$${(localStats.totalRevenue / 100).toFixed(0)}`} icon="💰" color="#fbbf24" />
          <StatCard label="Spent" value={`$${(localStats.totalSpent / 100).toFixed(0)}`} icon="🛒" color="#38bdf8" />
          <StatCard label="Avg Ship Time" value={localStats.avgDispatchHours > 0 ? `${localStats.avgDispatchHours}h` : "—"} icon="🚚" />
          <StatCard label="Disputes" value={localStats.disputedOrders} icon="⚠️" color={localStats.disputedOrders > 0 ? "#f87171" : undefined} />
        </div>
      )}

      {/* Selling Tab */}
      {activeTab === "selling" && sellerStats && (
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: "0.75rem" }}>
            <StatCard label="Total Sales" value={sellerStats.total_orders} icon="🏷️" />
            <StatCard label="Completed" value={sellerStats.completed_orders} icon="✅" color="#34d399" />
            <StatCard label="Revenue" value={`$${(sellerStats.total_revenue_cents / 100).toFixed(2)}`} icon="💰" color="#fbbf24" />
            <StatCard label="Avg Order" value={`$${(sellerStats.avg_order_value_cents / 100).toFixed(2)}`} icon="📐" />
            <StatCard label="Avg Dispatch" value={sellerStats.avg_dispatch_hours > 0 ? `${sellerStats.avg_dispatch_hours}h` : "—"} icon="📦" />
            <StatCard label="Avg Delivery" value={sellerStats.avg_delivery_hours > 0 ? `${sellerStats.avg_delivery_hours}h` : "—"} icon="🏠" />
          </div>

          {/* Fulfillment speed indicator */}
          {sellerStats.avg_dispatch_hours > 0 && (
            <div className="glass-card" style={{ padding: "1rem", border: "1px solid rgba(52, 211, 153, 0.15)" }}>
              <div style={{ fontSize: "0.72rem", color: "var(--text-muted)", marginBottom: "0.4rem" }}>
                {casualModeActive ? "Your Speed Rating" : "Fulfillment Performance"}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                <div style={{ fontSize: "1.5rem" }}>
                  {sellerStats.avg_dispatch_hours <= 24 ? "🚀" : sellerStats.avg_dispatch_hours <= 48 ? "✈️" : "🐢"}
                </div>
                <div>
                  <div style={{ fontWeight: "700", color: "#fff", fontSize: "0.9rem" }}>
                    {sellerStats.avg_dispatch_hours <= 24
                      ? "Lightning Fast"
                      : sellerStats.avg_dispatch_hours <= 48
                      ? "Quick Shipper"
                      : "Steady Pace"}
                  </div>
                  <div style={{ fontSize: "0.7rem", color: "var(--text-muted)" }}>
                    Average {sellerStats.avg_dispatch_hours}h from order to dispatch
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {activeTab === "selling" && !sellerStats && (
        <div style={{ textAlign: "center", padding: "2rem", color: "var(--text-muted)", fontSize: "0.85rem" }}>
          No selling activity yet. List a specimen to get started!
        </div>
      )}

      {/* Buying Tab */}
      {activeTab === "buying" && buyerStats && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: "0.75rem" }}>
          <StatCard label="Total Purchases" value={buyerStats.total_orders} icon="🛒" />
          <StatCard label="Completed" value={buyerStats.completed_orders} icon="✅" color="#34d399" />
          <StatCard label="Total Spent" value={`$${(buyerStats.total_spent_cents / 100).toFixed(2)}`} icon="💸" color="#38bdf8" />
          <StatCard label="XP Earned" value={buyerStats.total_xp_earned?.toLocaleString() || "0"} icon="⭐" color="#fbbf24" />
          <StatCard label="Unique Sellers" value={buyerStats.unique_sellers} icon="👥" />
          <StatCard label="Shipped Orders" value={buyerStats.shipping_orders} icon="📦" />
          <StatCard label="Batch Orders" value={buyerStats.batch_orders} icon="🐟" />
          <StatCard label="Handshakes" value={buyerStats.handshake_orders} icon="🤝" />
        </div>
      )}

      {activeTab === "buying" && !buyerStats && (
        <div style={{ textAlign: "center", padding: "2rem", color: "var(--text-muted)", fontSize: "0.85rem" }}>
          No purchases yet. Browse the marketplace to find your first fish!
        </div>
      )}
    </div>
  );
}

/** Small stat tile used in the analytics grid */
function StatCard({ label, value, icon, color }) {
  return (
    <div
      className="glass-card"
      style={{
        padding: "0.85rem",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "0.3rem",
        border: "1px solid rgba(255, 255, 255, 0.04)",
      }}
    >
      <span style={{ fontSize: "1.25rem" }}>{icon}</span>
      <span style={{ fontSize: "1.1rem", fontWeight: "700", color: color || "#fff", fontFamily: "monospace" }}>
        {value}
      </span>
      <span style={{ fontSize: "0.62rem", color: "var(--text-muted)", textAlign: "center" }}>{label}</span>
    </div>
  );
}
