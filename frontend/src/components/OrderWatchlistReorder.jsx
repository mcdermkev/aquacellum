import React, { useState, useEffect, useCallback } from "react";
import { ORDER_FEATURES } from "../utils/orderFeatureGates";
import { hasEntitlement } from "../services/entitlements";
import { useActivityFacts } from "../hooks/useActivityFacts";
import { addToWatchlist, getWatchlist, removeFromWatchlist } from "../services/ordersSync";
import { db } from "../db";
import { generateAlias } from "../utils/generateAlias";

/**
 * OrderWatchlistReorder — XP-gated components for:
 *   1. Species Watchlist (Pelagic / 2,500 XP) — price alerts
 *   2. Smart Reorder (Abyssal / 5,000 XP) — reorder from completed orders
 *
 * Props:
 *   - walletAccount: current wallet
 *   - userTier: XP tier string
 *   - totalXp: user's total XP
 *   - casualModeActive: language mode
 *   - onReorder: callback when reorder is initiated (tokenIds or species)
 */
export function OrderWatchlistReorder({ walletAccount, userTier, totalXp, casualModeActive = false, onReorder }) {
  // Gating sourced from the centralized entitlement map (Task 6/18) rather
  // than the legacy per-component isFeatureUnlocked check; ORDER_FEATURES is
  // kept for its copy/icon/progress-bar metadata below. Same tiers
  // (Pelagic for watchlist, Abyssal for smart reorder).
  // `species_watchlist` is now REQUIRED — watching a species is core discovery and
  // was never a scale tool. `smart_reorder` is ACTIVITY-gated on having ordered
  // more than once, since reordering presupposes a previous order.
  const activity = useActivityFacts(walletAccount);
  const watchlistUnlocked = hasEntitlement("species_watchlist", {});
  const reorderUnlocked = hasEntitlement("smart_reorder", { activity });

  const [activeSection, setActiveSection] = useState(watchlistUnlocked ? "watchlist" : "reorder");
  const [watchlist, setWatchlist] = useState([]);
  const [completedOrders, setCompletedOrders] = useState([]);
  const [loadingWatch, setLoadingWatch] = useState(false);
  const [loadingOrders, setLoadingOrders] = useState(false);

  // Add watchlist entry
  const [addSpecies, setAddSpecies] = useState("");
  const [addMaxPrice, setAddMaxPrice] = useState("");
  const [addLoading, setAddLoading] = useState(false);

  // Load watchlist
  useEffect(() => {
    if (!walletAccount || !watchlistUnlocked) return;
    setLoadingWatch(true);
    getWatchlist(walletAccount)
      .then(setWatchlist)
      .finally(() => setLoadingWatch(false));
  }, [walletAccount, watchlistUnlocked]);

  // Load completed orders for reorder
  useEffect(() => {
    if (!walletAccount || !reorderUnlocked) return;
    setLoadingOrders(true);

    (async () => {
      try {
        const orders = await db.marketOrders.toArray();
        const completed = orders.filter((o) => {
          const isBuyer = (o.buyer || "").toLowerCase() === walletAccount.toLowerCase();
          if (!isBuyer) return false;
          if (o.orderType === "shipping") return o.status === 2; // Released
          if (o.orderType === "batch") return o.state === 1; // Released
          return false;
        });

        // Deduplicate by species name — keep most recent
        const bySpecies = new Map();
        for (const order of completed) {
          const key = (order.commonName || "").toLowerCase();
          if (!key) continue;
          const existing = bySpecies.get(key);
          if (!existing || (order.createdAt || 0) > (existing.createdAt || 0)) {
            bySpecies.set(key, order);
          }
        }

        setCompletedOrders(Array.from(bySpecies.values()));
      } catch (e) {
        console.warn("[Reorder] Failed to load completed orders:", e);
      } finally {
        setLoadingOrders(false);
      }
    })();
  }, [walletAccount, reorderUnlocked]);

  const handleAddToWatchlist = async () => {
    if (!addSpecies.trim()) return;
    setAddLoading(true);

    const maxCents = addMaxPrice ? Math.round(parseFloat(addMaxPrice) * 100) : null;
    const result = await addToWatchlist(walletAccount, addSpecies.trim(), null, maxCents);

    if (result.success) {
      setWatchlist((prev) => [
        { species_name: addSpecies.trim(), max_price_cents: maxCents, is_active: true, created_at: new Date().toISOString() },
        ...prev,
      ]);
      setAddSpecies("");
      setAddMaxPrice("");
    }
    setAddLoading(false);
  };

  const handleRemoveWatch = async (speciesName) => {
    await removeFromWatchlist(walletAccount, speciesName);
    setWatchlist((prev) => prev.filter((w) => w.species_name !== speciesName));
  };

  const handleReorder = useCallback(
    (order) => {
      if (onReorder) {
        onReorder({
          speciesName: order.commonName,
          seller: order.seller,
          orderType: order.orderType,
          quantity: order.quantity || 1,
        });
      }
    },
    [onReorder]
  );

  // If neither feature is unlocked, show preview
  if (!watchlistUnlocked && !reorderUnlocked) {
    const feature = ORDER_FEATURES.SPECIES_WATCHLIST;
    return (
      <LockedFeatureCard feature={feature} totalXp={totalXp} />
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      {/* Section Tabs */}
      <div style={{ display: "flex", gap: "0.5rem" }}>
        {watchlistUnlocked && (
          <button
            onClick={() => setActiveSection("watchlist")}
            style={{
              padding: "0.4rem 0.75rem",
              fontSize: "0.72rem",
              fontWeight: activeSection === "watchlist" ? "700" : "500",
              background: activeSection === "watchlist" ? "rgba(56, 189, 248, 0.1)" : "rgba(255, 255, 255, 0.02)",
              border: activeSection === "watchlist" ? "1px solid rgba(56, 189, 248, 0.3)" : "1px solid rgba(255, 255, 255, 0.06)",
              borderRadius: "20px",
              color: activeSection === "watchlist" ? "var(--accent-blue)" : "var(--text-secondary)",
              cursor: "pointer",
            }}
          >
            👁️ Watchlist ({watchlist.length})
          </button>
        )}
        {reorderUnlocked && (
          <button
            onClick={() => setActiveSection("reorder")}
            style={{
              padding: "0.4rem 0.75rem",
              fontSize: "0.72rem",
              fontWeight: activeSection === "reorder" ? "700" : "500",
              background: activeSection === "reorder" ? "rgba(139, 92, 246, 0.1)" : "rgba(255, 255, 255, 0.02)",
              border: activeSection === "reorder" ? "1px solid rgba(139, 92, 246, 0.3)" : "1px solid rgba(255, 255, 255, 0.06)",
              borderRadius: "20px",
              color: activeSection === "reorder" ? "var(--accent-purple, #a855f7)" : "var(--text-secondary)",
              cursor: "pointer",
            }}
          >
            🔄 Reorder ({completedOrders.length})
          </button>
        )}
      </div>

      {/* Watchlist Section */}
      {activeSection === "watchlist" && watchlistUnlocked && (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          {/* Add to watchlist form */}
          <div
            className="glass-card"
            style={{
              padding: "1rem",
              display: "flex",
              gap: "0.5rem",
              alignItems: "flex-end",
              flexWrap: "wrap",
              border: "1px solid rgba(56, 189, 248, 0.1)",
            }}
          >
            <div style={{ flex: "1 1 180px" }}>
              <label style={{ fontSize: "0.68rem", color: "var(--text-muted)", display: "block", marginBottom: "0.25rem" }}>
                Species Name
              </label>
              <input
                type="text"
                value={addSpecies}
                onChange={(e) => setAddSpecies(e.target.value)}
                placeholder="e.g. Electric Blue Acara"
                style={{
                  width: "100%",
                  padding: "0.45rem 0.6rem",
                  background: "rgba(255,255,255,0.03)",
                  border: "1px solid rgba(255,255,255,0.08)",
                  borderRadius: "4px",
                  color: "#fff",
                  fontSize: "0.78rem",
                }}
              />
            </div>
            <div style={{ flex: "0 0 100px" }}>
              <label style={{ fontSize: "0.68rem", color: "var(--text-muted)", display: "block", marginBottom: "0.25rem" }}>
                Max Price ($)
              </label>
              <input
                type="number"
                value={addMaxPrice}
                onChange={(e) => setAddMaxPrice(e.target.value)}
                placeholder="49.99"
                style={{
                  width: "100%",
                  padding: "0.45rem 0.6rem",
                  background: "rgba(255,255,255,0.03)",
                  border: "1px solid rgba(255,255,255,0.08)",
                  borderRadius: "4px",
                  color: "#fff",
                  fontSize: "0.78rem",
                }}
              />
            </div>
            <button
              onClick={handleAddToWatchlist}
              disabled={!addSpecies.trim() || addLoading}
              className="btn-primary"
              style={{ padding: "0.45rem 0.85rem", fontSize: "0.75rem" }}
            >
              {addLoading ? "Adding..." : "+ Watch"}
            </button>
          </div>

          {/* Watchlist items */}
          {loadingWatch ? (
            <div className="shimmer-placeholder" style={{ height: "80px", borderRadius: "8px" }} />
          ) : watchlist.length === 0 ? (
            <div style={{ textAlign: "center", padding: "1.5rem", color: "var(--text-muted)", fontSize: "0.82rem" }}>
              {casualModeActive
                ? "No species on your watchlist yet. Add one above to get price alerts!"
                : "Watchlist empty. Add species to monitor marketplace price drops."}
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
              {watchlist.map((item) => (
                <div
                  key={item.species_name}
                  className="glass-card"
                  style={{
                    padding: "0.75rem 1rem",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    border: "1px solid rgba(255,255,255,0.04)",
                  }}
                >
                  <div>
                    <div style={{ fontWeight: "600", color: "#fff", fontSize: "0.82rem" }}>
                      👁️ {item.species_name}
                    </div>
                    <div style={{ fontSize: "0.68rem", color: "var(--text-muted)" }}>
                      {item.max_price_cents
                        ? `Alert below $${(item.max_price_cents / 100).toFixed(2)}`
                        : "Alert on any listing"}
                    </div>
                  </div>
                  <button
                    onClick={() => handleRemoveWatch(item.species_name)}
                    style={{
                      background: "none",
                      border: "none",
                      color: "var(--text-muted)",
                      fontSize: "1.1rem",
                      cursor: "pointer",
                      padding: "0.25rem 0.5rem",
                    }}
                    title="Remove from watchlist"
                  >
                    &times;
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Smart Reorder Section */}
      {activeSection === "reorder" && reorderUnlocked && (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          {loadingOrders ? (
            <div className="shimmer-placeholder" style={{ height: "120px", borderRadius: "8px" }} />
          ) : completedOrders.length === 0 ? (
            <div style={{ textAlign: "center", padding: "1.5rem", color: "var(--text-muted)", fontSize: "0.82rem" }}>
              {casualModeActive
                ? "No completed orders to reorder from yet. Buy some fish first!"
                : "Complete purchases to enable smart reorder from history."}
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
              <div style={{ fontSize: "0.7rem", color: "var(--text-muted)", marginBottom: "0.25rem" }}>
                One-tap reorder from your previously purchased species:
              </div>
              {completedOrders.map((order, idx) => (
                <div
                  key={`${order.commonName}-${idx}`}
                  className="glass-card"
                  style={{
                    padding: "0.85rem 1rem",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    border: "1px solid rgba(255,255,255,0.04)",
                  }}
                >
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: "600", color: "#fff", fontSize: "0.82rem" }}>
                      🐠 {order.commonName}
                    </div>
                    <div style={{ fontSize: "0.68rem", color: "var(--text-muted)", display: "flex", gap: "0.75rem", marginTop: "0.2rem" }}>
                      <span>From: {generateAlias(order.seller || "")}</span>
                      <span>•</span>
                      <span>
                        {order.orderType === "batch"
                          ? `${order.quantity || 1} fish`
                          : "Single specimen"}
                      </span>
                      {order.createdAt && (
                        <>
                          <span>•</span>
                          <span>{new Date(order.createdAt * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
                        </>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={() => handleReorder(order)}
                    className="btn-primary"
                    style={{
                      padding: "0.35rem 0.75rem",
                      fontSize: "0.7rem",
                      flexShrink: 0,
                    }}
                  >
                    🔄 Reorder
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* If reorder is still locked but watchlist is unlocked, show teaser */}
      {activeSection === "reorder" && !reorderUnlocked && (
        <LockedFeatureCard feature={ORDER_FEATURES.SMART_REORDER} totalXp={totalXp} />
      )}
    </div>
  );
}

/** Reusable locked feature preview card */
function LockedFeatureCard({ feature, totalXp }) {
  return (
    <div
      className="glass-card"
      style={{
        padding: "1.5rem",
        textAlign: "center",
        border: "1px solid rgba(251, 191, 36, 0.12)",
        background: "rgba(251, 191, 36, 0.02)",
      }}
    >
      <div style={{ fontSize: "2rem", marginBottom: "0.5rem" }}>{feature.icon}</div>
      <h4 style={{ color: "#fff", fontSize: "0.95rem", marginBottom: "0.3rem" }}>{feature.label}</h4>
      <p style={{ color: "var(--text-muted)", fontSize: "0.75rem", margin: "0 auto 1rem", maxWidth: "320px" }}>
        {feature.description}
      </p>
      <div style={{ maxWidth: "240px", margin: "0 auto" }}>
        <div style={{
          height: "5px",
          borderRadius: "3px",
          background: "rgba(255,255,255,0.06)",
          overflow: "hidden",
        }}>
          <div style={{
            height: "100%",
            width: `${Math.min(100, ((totalXp || 0) / feature.unlockXp) * 100)}%`,
            background: "linear-gradient(90deg, #fbbf24, #f59e0b)",
            borderRadius: "3px",
          }} />
        </div>
        <div style={{ fontSize: "0.65rem", color: "var(--accent-amber, #fbbf24)", marginTop: "0.3rem", fontWeight: "600" }}>
          {Math.max(0, feature.unlockXp - (totalXp || 0)).toLocaleString()} XP to unlock ({feature.unlockTier} tier)
        </div>
      </div>
    </div>
  );
}
