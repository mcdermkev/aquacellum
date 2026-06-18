/**
 * RewardCreditsCard.jsx
 * 
 * Dashboard widget showing the user's reward credit balance,
 * tier discount, next distribution date, and recent credit history.
 * 
 * Props:
 *   - casualModeActive {boolean} - Label style
 *   - compact {boolean} - Smaller rendering for sidebar
 */

import React, { useState } from "react";
import { useRewardCredits, useCreditHistory, usePoolStatus } from "../hooks/useRewardsPool";
import { getNextDistributionInfo, TIER_DISCOUNTS } from "../services/rewardsPoolApi";
import { getPointsSuffix } from "../utils/xp";

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const TRANSACTION_ICONS = {
  distribution: "🎁",
  checkout_applied: "🛒",
  expired: "⏰",
  manual_adjustment: "⚙️",
};

const TRANSACTION_COLORS = {
  distribution: "var(--accent-green, #34d399)",
  checkout_applied: "var(--accent-cyan, #22d3ee)",
  expired: "var(--text-muted, #64748b)",
  manual_adjustment: "var(--accent-purple, #a855f7)",
};

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export function RewardCreditsCard({ casualModeActive = true, compact = false }) {
  const [showHistory, setShowHistory] = useState(false);

  const { data: creditData, isLoading } = useRewardCredits();
  const { data: history } = useCreditHistory({ limit: 5 });
  const { data: poolStatus } = usePoolStatus();

  const nextDistribution = getNextDistributionInfo();
  const credits = creditData?.credits || 0;
  const tier = creditData?.tier || "Shallow";
  const tierDiscount = creditData?.tierDiscount || 0;

  const rewardsLabel = casualModeActive ? "Loyalty Credits" : "Reward Credits";

  // ─── Loading state ─────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div
        className="glass-card"
        style={{
          padding: compact ? "0.75rem" : "1rem 1.25rem",
          borderRadius: "var(--radius-sm)",
          border: "1px solid rgba(255,255,255,0.06)",
          background: "rgba(255,255,255,0.02)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
          <span style={{ fontSize: "1rem" }}>⭐</span>
          <span style={{ fontSize: "0.8rem", fontWeight: "700", color: "#fff" }}>{rewardsLabel}</span>
        </div>
        <div style={{ padding: "0.75rem 0", fontSize: "0.7rem", color: "var(--text-muted)" }}>
          Loading...
        </div>
      </div>
    );
  }

  return (
    <div
      className="glass-card"
      style={{
        padding: compact ? "0.75rem" : "1rem 1.25rem",
        borderRadius: "var(--radius-sm)",
        border: "1px solid rgba(139, 92, 246, 0.1)",
        background: "rgba(139, 92, 246, 0.02)",
      }}
    >
      {/* Header */}
      <div style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        marginBottom: "0.6rem",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
          <span style={{ fontSize: "1rem" }}>⭐</span>
          <h4 style={{ margin: 0, fontSize: "0.8rem", fontWeight: "700", color: "#fff" }}>
            {rewardsLabel}
          </h4>
        </div>
        {!compact && (
          <button
            onClick={() => setShowHistory(!showHistory)}
            style={{
              background: "none",
              border: "none",
              fontSize: "0.6rem",
              color: "var(--text-muted)",
              cursor: "pointer",
              padding: "0.2rem 0.4rem",
              borderRadius: "4px",
            }}
          >
            {showHistory ? "Hide" : "History"}
          </button>
        )}
      </div>

      {/* Credit Balance */}
      <div style={{
        display: "flex",
        alignItems: "baseline",
        gap: "0.4rem",
        marginBottom: "0.5rem",
      }}>
        <span style={{
          fontSize: compact ? "1.3rem" : "1.6rem",
          fontWeight: "900",
          fontFamily: "'Outfit', sans-serif",
          color: credits > 0 ? "#a855f7" : "var(--text-muted)",
        }}>
          ${credits.toFixed(2)}
        </span>
        <span style={{ fontSize: "0.65rem", color: "var(--text-muted)" }}>
          available
        </span>
      </div>

      {/* Tier Discount Badge */}
      {tierDiscount > 0 && (
        <div style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "0.3rem",
          padding: "0.25rem 0.5rem",
          borderRadius: "50px",
          background: "rgba(251, 191, 36, 0.08)",
          border: "1px solid rgba(251, 191, 36, 0.15)",
          fontSize: "0.65rem",
          color: "var(--accent-amber, #fbbf24)",
          fontWeight: "600",
          marginBottom: "0.6rem",
        }}>
          🏷️ {Math.round(tierDiscount * 100)}% tier discount ({tier})
        </div>
      )}

      {/* Next Distribution */}
      <div style={{
        padding: "0.4rem 0.6rem",
        borderRadius: "6px",
        background: "rgba(255,255,255,0.02)",
        border: "1px solid rgba(255,255,255,0.05)",
        fontSize: "0.65rem",
        color: "var(--text-muted)",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        marginBottom: showHistory ? "0.6rem" : 0,
      }}>
        <span>Next distribution</span>
        <span style={{ fontWeight: "600", color: "var(--text-secondary)" }}>
          {nextDistribution.daysUntil === 0 ? "Today" : `${nextDistribution.daysUntil}d`}
        </span>
      </div>

      {/* Pool balance (optional, non-compact) */}
      {!compact && poolStatus && (
        <div style={{
          marginTop: "0.5rem",
          padding: "0.35rem 0.6rem",
          borderRadius: "6px",
          background: "rgba(20, 184, 166, 0.04)",
          border: "1px solid rgba(20, 184, 166, 0.1)",
          fontSize: "0.6rem",
          color: "var(--text-muted)",
          display: "flex",
          justifyContent: "space-between",
        }}>
          <span>Pool balance</span>
          <span style={{ color: "var(--accent-teal, #14b8a6)", fontWeight: "600" }}>
            ${Number(poolStatus.current_balance || 0).toFixed(2)}
          </span>
        </div>
      )}

      {/* Transaction History */}
      {showHistory && history && history.length > 0 && (
        <div style={{ marginTop: "0.5rem" }}>
          <div style={{
            fontSize: "0.6rem",
            color: "var(--text-muted)",
            fontWeight: "600",
            marginBottom: "0.3rem",
            textTransform: "uppercase",
            letterSpacing: "0.5px",
          }}>
            Recent
          </div>
          {history.map((tx) => (
            <div
              key={tx.id}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "0.3rem 0",
                borderBottom: "1px solid rgba(255,255,255,0.03)",
                fontSize: "0.68rem",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "0.3rem", minWidth: 0, flex: 1 }}>
                <span style={{ fontSize: "0.75rem" }}>
                  {TRANSACTION_ICONS[tx.transaction_type] || "💰"}
                </span>
                <span style={{
                  color: "var(--text-secondary)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}>
                  {tx.description || tx.transaction_type}
                </span>
              </div>
              <span style={{
                fontFamily: "monospace",
                fontWeight: "600",
                color: tx.amount > 0
                  ? TRANSACTION_COLORS[tx.transaction_type] || "var(--accent-green)"
                  : "var(--text-muted)",
                flexShrink: 0,
                marginLeft: "0.5rem",
              }}>
                {tx.amount > 0 ? "+" : ""}{Number(tx.amount).toFixed(2)}
              </span>
            </div>
          ))}
        </div>
      )}

      {showHistory && (!history || history.length === 0) && (
        <div style={{ marginTop: "0.5rem", fontSize: "0.65rem", color: "var(--text-muted)", textAlign: "center", padding: "0.5rem 0" }}>
          No credit activity yet. Earn {casualModeActive ? "Loyalty Points" : "XP"} and complete marketplace transactions to qualify for monthly distributions.
        </div>
      )}
    </div>
  );
}

export default RewardCreditsCard;
