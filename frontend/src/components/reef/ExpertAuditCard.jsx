/**
 * ExpertAuditCard.jsx
 * 
 * Gold-bordered card displaying an Expert Audit scorecard.
 * Shows: 4 score indicators, auditor ProfileCard, commentary.
 */

import React from "react";
import { ProfileCard } from "./ProfileCard";

const SCORE_LABELS = [
  { key: "water_quality_score", emoji: "💧", label: "Water" },
  { key: "stocking_score", emoji: "🐟", label: "Stocking" },
  { key: "husbandry_score", emoji: "🏠", label: "Husbandry" },
  { key: "aesthetics_score", emoji: "🎨", label: "Aesthetics" },
];

export function ExpertAuditCard({ audit, onViewProfile, compact = false }) {
  if (!audit) return null;

  const auditor = audit.auditor;
  const overallScore = (
    (audit.water_quality_score + audit.stocking_score + audit.husbandry_score + audit.aesthetics_score) / 4
  ).toFixed(1);

  const formatTime = (dateStr) => {
    if (!dateStr) return "";
    const d = new Date(dateStr);
    const now = new Date();
    const diff = now - d;
    const minutes = Math.floor(diff / 60000);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d ago`;
    return d.toLocaleDateString([], { month: "short", day: "numeric" });
  };

  if (compact) {
    return (
      <div style={{
        padding: "0.6rem 0.8rem",
        borderRadius: "var(--radius-sm)",
        border: "1px solid rgba(251, 191, 36, 0.25)",
        background: "rgba(251, 191, 36, 0.04)",
        display: "flex",
        alignItems: "center",
        gap: "0.75rem",
      }}>
        <span style={{ fontSize: "1.2rem" }}>⭐</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: "0.7rem", color: "#fff" }}>
            Expert Audit — <span style={{ color: "var(--accent-amber)", fontWeight: "600" }}>{overallScore}/5.0</span>
          </div>
          <div style={{ fontSize: "0.6rem", color: "var(--text-muted)" }}>
            by {auditor?.display_name || `${audit.auditor_wallet?.slice(0, 6)}...`} · {formatTime(audit.created_at)}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="glass-card expert-audit-card"
      style={{
        padding: "1.25rem",
        borderRadius: "var(--radius-md)",
        border: "1px solid rgba(251, 191, 36, 0.25)",
        background: "rgba(251, 191, 36, 0.03)",
        boxShadow: "0 0 20px rgba(251, 191, 36, 0.05), inset 0 0 20px rgba(251, 191, 36, 0.02)",
      }}
    >
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "1rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
          {auditor && (
            <div
              style={{ cursor: "pointer" }}
              onClick={() => onViewProfile?.(auditor.wallet_address)}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <div style={{
                  width: "32px",
                  height: "32px",
                  borderRadius: "50%",
                  background: auditor.avatar_url
                    ? `url(${auditor.avatar_url}) center/cover`
                    : "linear-gradient(135deg, #fbbf24 0%, #f59e0b 100%)",
                  border: "2px solid rgba(251, 191, 36, 0.4)",
                  flexShrink: 0,
                }} />
                <div>
                  <div style={{ fontSize: "0.8rem", color: "#fff", fontWeight: "500" }}>
                    {auditor.display_name || `${auditor.wallet_address.slice(0, 6)}...${auditor.wallet_address.slice(-4)}`}
                  </div>
                  <div style={{ fontSize: "0.6rem", color: "var(--accent-amber)", fontWeight: "600" }}>
                    ⭐ Verified {auditor.companion_tier || "Master"} Breeder
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: "1.4rem", fontWeight: "700", color: "var(--accent-amber)", lineHeight: "1" }}>
            {overallScore}
          </div>
          <div style={{ fontSize: "0.55rem", color: "var(--text-muted)" }}>/ 5.0 overall</div>
        </div>
      </div>

      {/* Scorecard */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: "0.5rem",
        marginBottom: "1rem",
      }}>
        {SCORE_LABELS.map((cat) => {
          const score = audit[cat.key];
          return (
            <div key={cat.key} style={{
              padding: "0.5rem 0.75rem",
              borderRadius: "var(--radius-sm)",
              background: "rgba(0,0,0,0.2)",
              border: "1px solid rgba(255,255,255,0.06)",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}>
              <span style={{ fontSize: "0.7rem", color: "var(--text-secondary)" }}>
                {cat.emoji} {cat.label}
              </span>
              <div style={{ display: "flex", gap: "2px" }}>
                {[1, 2, 3, 4, 5].map((s) => (
                  <span
                    key={s}
                    style={{
                      fontSize: "0.6rem",
                      color: s <= score ? "var(--accent-amber)" : "rgba(255,255,255,0.15)",
                    }}
                  >
                    ★
                  </span>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* Commentary */}
      {audit.commentary && (
        <div style={{
          padding: "0.75rem 1rem",
          background: "rgba(0,0,0,0.15)",
          borderRadius: "var(--radius-sm)",
          borderLeft: "3px solid rgba(251, 191, 36, 0.3)",
          marginBottom: "0.75rem",
        }}>
          <p style={{
            margin: 0,
            fontSize: "0.8rem",
            color: "var(--text-secondary)",
            lineHeight: "1.5",
            fontStyle: "italic",
          }}>
            "{audit.commentary}"
          </p>
        </div>
      )}

      {/* Footer */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: "0.6rem", color: "var(--text-muted)" }}>
          {formatTime(audit.created_at)}
        </span>
        <span style={{ fontSize: "0.6rem", color: "rgba(251, 191, 36, 0.6)" }}>
          ⭐ Expert Audit
        </span>
      </div>
    </div>
  );
}
