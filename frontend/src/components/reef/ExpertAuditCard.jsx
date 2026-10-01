/**
 * ExpertAuditCard.jsx
 * 
 * Amber-edged card displaying an Expert Audit scorecard.
 * Shows: 4 score rows, the auditor, and their commentary.
 */

import React from "react";
import { Drop, FishSimple, House, Palette, Star } from "@phosphor-icons/react";
import "./ProfileDaylight.css";

const SCORE_LABELS = [
  { key: "water_quality_score", Icon: Drop, label: "Water" },
  { key: "stocking_score", Icon: FishSimple, label: "Stocking" },
  { key: "husbandry_score", Icon: House, label: "Husbandry" },
  { key: "aesthetics_score", Icon: Palette, label: "Aesthetics" },
];

function Stars({ score }) {
  const value = Number(score) || 0;
  return (
    <span className="pf-stars" role="img" aria-label={`${value} out of 5`}>
      {[1, 2, 3, 4, 5].map((s) => (
        <Star
          key={s}
          size={14}
          weight={s <= value ? "fill" : "regular"}
          className={s <= value ? undefined : "pf-star--off"}
          aria-hidden="true"
        />
      ))}
    </span>
  );
}

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
        borderRadius: "12px",
        border: "1px solid rgba(180, 83, 9, 0.28)",
        background: "#fff8eb",
        display: "flex",
        alignItems: "center",
        gap: "0.75rem",
      }}>
        <Star size={20} weight="fill" color="#b45309" aria-hidden="true" />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: "0.86rem", color: "var(--text-primary)" }}>
            Expert audit: <span style={{ color: "var(--accent-amber)", fontWeight: "600" }}>{overallScore}/5.0</span>
          </div>
          <div style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>
            by {auditor?.display_name || `${audit.auditor_wallet?.slice(0, 6)}...`} · {formatTime(audit.created_at)}
          </div>
        </div>
      </div>
    );
  }

  const auditorName = auditor
    ? auditor.display_name || `${auditor.wallet_address.slice(0, 6)}...${auditor.wallet_address.slice(-4)}`
    : null;

  return (
    <article className="pf-audit expert-audit-card" aria-label={`Expert audit, ${overallScore} out of 5`}>
      {/* Header */}
      <div className="pf-audit-head">
        {auditor ? (
          <button
            type="button"
            className="pf-person"
            onClick={() => onViewProfile?.(auditor.wallet_address)}
          >
            <span
              className="pf-person-avatar"
              aria-hidden="true"
              style={auditor.avatar_url ? { backgroundImage: `url(${auditor.avatar_url})` } : undefined}
            />
            <span className="pf-person-text">
              <span className="pf-person-name">{auditorName}</span>
              <span className="pf-person-meta pf-person-meta--amber">Expert auditor</span>
            </span>
          </button>
        ) : (
          <span />
        )}

        <div className="pf-audit-overall">
          <strong>{overallScore}</strong>
          <span>/ 5.0 overall</span>
        </div>
      </div>

      {/* Scorecard */}
      <ul className="pf-scores">
        {SCORE_LABELS.map((cat) => (
          <li key={cat.key} className="pf-score">
            <span className="pf-score-label">
              <cat.Icon size={16} weight="bold" aria-hidden="true" />
              {cat.label}
            </span>
            <Stars score={audit[cat.key]} />
          </li>
        ))}
      </ul>

      {/* Commentary */}
      {audit.commentary && (
        <blockquote className="pf-quote">{audit.commentary}</blockquote>
      )}

      {/* Footer */}
      <div className="pf-audit-foot">
        <span>{formatTime(audit.created_at)}</span>
        <span>Expert audit</span>
      </div>
    </article>
  );
}
