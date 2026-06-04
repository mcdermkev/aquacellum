/**
 * ExpertAuditForm.jsx
 * 
 * Scorecard form for creating an Expert Audit.
 * 4 sliders (Water Quality, Stocking, Husbandry, Aesthetics) — 1-5 stars each.
 * Free-text commentary. Submit triggers XP award for both parties.
 */

import React, { useState } from "react";
import { useCreateAudit } from "../../hooks/useAudits";

const CATEGORIES = [
  { key: "waterQuality", label: "💧 Water Quality", desc: "Parameters, clarity, maintenance" },
  { key: "stocking", label: "🐟 Stocking", desc: "Species compatibility, density, balance" },
  { key: "husbandry", label: "🏠 Husbandry", desc: "Feeding, routines, health monitoring" },
  { key: "aesthetics", label: "🎨 Aesthetics", desc: "Layout, planting, visual appeal" },
];

export function ExpertAuditForm({ recipientWallet, targetCurrentId, targetTankId, onClose, onSubmitted }) {
  const [scores, setScores] = useState({
    waterQuality: 3,
    stocking: 3,
    husbandry: 3,
    aesthetics: 3,
  });
  const [commentary, setCommentary] = useState("");
  const [error, setError] = useState("");

  const createAuditMutation = useCreateAudit();

  const handleSubmit = async () => {
    setError("");

    // At least one score must be set (all default to 3, so just validate range)
    const allValid = Object.values(scores).every((s) => s >= 1 && s <= 5);
    if (!allValid) {
      setError("All scores must be between 1 and 5.");
      return;
    }

    const result = await createAuditMutation.mutateAsync({
      recipientWallet,
      targetTankId,
      targetCurrentId,
      waterQualityScore: scores.waterQuality,
      stockingScore: scores.stocking,
      husbandryScore: scores.husbandry,
      aestheticsScore: scores.aesthetics,
      commentary,
    });

    if (result.error) {
      setError(result.error.message || "Failed to submit audit.");
    } else {
      onSubmitted?.(result.data);
      onClose?.();
    }
  };

  const overallAvg = (Object.values(scores).reduce((a, b) => a + b, 0) / 4).toFixed(1);

  return (
    <div style={{
      position: "fixed",
      inset: 0,
      zIndex: 1000,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      background: "rgba(0, 0, 0, 0.7)",
      backdropFilter: "blur(8px)",
      padding: "1rem",
    }}>
      <div className="glass-card" style={{
        width: "100%",
        maxWidth: "520px",
        maxHeight: "85vh",
        overflow: "auto",
        padding: "2rem",
        borderRadius: "var(--radius-md)",
        border: "1px solid rgba(251, 191, 36, 0.2)",
        boxShadow: "0 0 40px rgba(251, 191, 36, 0.08)",
      }}>
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem" }}>
          <h2 style={{ margin: 0, fontSize: "1.15rem", color: "#fff" }}>
            ⭐ Expert Audit
          </h2>
          <button
            onClick={onClose}
            style={{ background: "none", border: "none", color: "var(--text-muted)", fontSize: "1.5rem", cursor: "pointer" }}
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <p style={{ fontSize: "0.75rem", color: "var(--text-secondary)", marginBottom: "1.5rem" }}>
          Rate this tank setup. You'll earn +25 Prestige XP, and the recipient earns +50.
        </p>

        {/* Scorecard */}
        <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem", marginBottom: "1.5rem" }}>
          {CATEGORIES.map((cat) => (
            <div key={cat.key}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.4rem" }}>
                <label style={{ fontSize: "0.8rem", color: "#fff", fontWeight: "500" }}>
                  {cat.label}
                </label>
                <span style={{ fontSize: "0.7rem", color: "var(--accent-amber)", fontWeight: "600" }}>
                  {scores[cat.key]}/5
                </span>
              </div>
              <p style={{ fontSize: "0.65rem", color: "var(--text-muted)", margin: "0 0 0.4rem" }}>
                {cat.desc}
              </p>
              {/* Star Rating */}
              <div style={{ display: "flex", gap: "0.3rem" }}>
                {[1, 2, 3, 4, 5].map((star) => (
                  <button
                    key={star}
                    onClick={() => setScores((prev) => ({ ...prev, [cat.key]: star }))}
                    style={{
                      width: "36px",
                      height: "36px",
                      borderRadius: "var(--radius-sm)",
                      border: `1px solid ${scores[cat.key] >= star ? "rgba(251, 191, 36, 0.4)" : "rgba(255,255,255,0.08)"}`,
                      background: scores[cat.key] >= star
                        ? "rgba(251, 191, 36, 0.15)"
                        : "rgba(255,255,255,0.03)",
                      color: scores[cat.key] >= star ? "var(--accent-amber)" : "var(--text-muted)",
                      fontSize: "1rem",
                      cursor: "pointer",
                      transition: "all 0.15s ease",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                    aria-label={`${star} star${star !== 1 ? "s" : ""}`}
                  >
                    ★
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Overall Score Display */}
        <div style={{
          textAlign: "center",
          padding: "0.75rem",
          background: "rgba(251, 191, 36, 0.06)",
          borderRadius: "var(--radius-sm)",
          border: "1px solid rgba(251, 191, 36, 0.15)",
          marginBottom: "1.5rem",
        }}>
          <span style={{ fontSize: "0.7rem", color: "var(--text-muted)" }}>Overall Score</span>
          <div style={{ fontSize: "1.5rem", fontWeight: "700", color: "var(--accent-amber)" }}>
            {overallAvg} <span style={{ fontSize: "0.7rem", fontWeight: "400" }}>/ 5.0</span>
          </div>
        </div>

        {/* Commentary */}
        <div style={{ marginBottom: "1.5rem" }}>
          <label style={{ display: "block", fontSize: "0.8rem", color: "var(--text-secondary)", marginBottom: "0.4rem" }}>
            Commentary (optional)
          </label>
          <textarea
            value={commentary}
            onChange={(e) => setCommentary(e.target.value)}
            placeholder="Share detailed feedback, suggestions, or praise..."
            rows={4}
            style={{
              width: "100%",
              padding: "0.7rem 1rem",
              background: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(255,255,255,0.1)",
              borderRadius: "var(--radius-sm)",
              color: "#fff",
              fontSize: "0.85rem",
              resize: "vertical",
            }}
          />
        </div>

        {/* Error */}
        {error && (
          <div style={{
            marginBottom: "1rem",
            padding: "0.6rem 1rem",
            background: "rgba(248, 113, 113, 0.1)",
            border: "1px solid rgba(248, 113, 113, 0.2)",
            borderRadius: "var(--radius-sm)",
            color: "var(--accent-red)",
            fontSize: "0.8rem",
          }}>
            {error}
          </div>
        )}

        {/* Actions */}
        <div style={{ display: "flex", gap: "1rem", justifyContent: "flex-end" }}>
          <button onClick={onClose} className="btn-secondary" style={{ padding: "0.6rem 1.25rem" }}>
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={createAuditMutation.isPending}
            className="btn-primary"
            style={{
              padding: "0.6rem 1.25rem",
              background: "linear-gradient(135deg, #fbbf24, #f59e0b)",
              border: "1px solid rgba(251, 191, 36, 0.3)",
            }}
          >
            {createAuditMutation.isPending ? "Submitting..." : "⭐ Submit Audit"}
          </button>
        </div>
      </div>
    </div>
  );
}
