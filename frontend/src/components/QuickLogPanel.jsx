import React, { useState } from "react";
import { db } from "../db";
import { addXp, XP_ACTIONS } from "../utils/xp";

/**
 * QuickLogPanel — Multi-tank rapid logging for breeders with many tanks.
 * 
 * Shows all active tanks in a compact list with checkboxes for common
 * care actions. One-tap "Log All" submits actions across multiple tanks
 * simultaneously. Designed for the "fish room workflow" where a breeder
 * walks through 20+ tanks doing water changes in sequence.
 * 
 * Props:
 *   tanks — array of tank objects (from useUserTanks)
 *   casualModeActive — display mode toggle
 *   onComplete — callback after logging (to refresh parent)
 */
export function QuickLogPanel({ tanks = [], casualModeActive = false, onComplete }) {
  const [selectedTanks, setSelectedTanks] = useState(() => {
    // Default: all tanks selected
    return new Set(tanks.map(t => t.id));
  });
  const [action, setAction] = useState("Water Change");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null);

  const ACTIONS = [
    { key: "Water Change", icon: "💧", xp: XP_ACTIONS.LOG_WATER?.points || 10 },
    { key: "Fed", icon: "🐟", xp: XP_ACTIONS.LOG_FEEDING?.points || 5 },
    { key: "Quick Water Test", icon: "🧪", xp: XP_ACTIONS.LOG_PARAMETERS?.points || 8 },
    { key: "Scraped Algae", icon: "🧽", xp: 5 },
  ];

  const toggleTank = (id) => {
    setSelectedTanks(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => setSelectedTanks(new Set(tanks.map(t => t.id)));
  const selectNone = () => setSelectedTanks(new Set());

  const handleSubmit = async () => {
    if (selectedTanks.size === 0) return;
    setSubmitting(true);
    setResult(null);

    const timestamp = Date.now();
    const logs = [];

    for (const tankId of selectedTanks) {
      logs.push({
        tankId,
        actionType: action,
        timestamp,
        details: `Quick-logged via batch panel`,
      });
    }

    try {
      await db.actionLogs.bulkAdd(logs);

      // XP is awarded per-tank by the Dexie hook in useXPSync,
      // but for bulk we also fire a summary event
      const selectedAction = ACTIONS.find(a => a.key === action);
      const totalXp = (selectedAction?.xp || 5) * selectedTanks.size;

      // Trigger XP tracking (useXPSync listens for actionLogs.creating hook)
      // The bulk add above triggers the hook for each entry automatically.

      setResult({
        count: selectedTanks.size,
        action,
        totalXp,
      });
    } catch (_e) {
      setResult({ count: 0, action, error: true });
    } finally {
      setSubmitting(false);
    }
  };

  const handleDone = () => {
    setResult(null);
    if (onComplete) onComplete();
  };

  // Success state
  if (result && result.count > 0) {
    return (
      <div className="glass-card" style={{
        padding: "2rem",
        textAlign: "center",
        border: "1px solid rgba(34, 197, 94, 0.2)",
      }}>
        <span style={{ fontSize: "2.5rem", display: "block", marginBottom: "0.75rem" }}>✅</span>
        <h3 style={{ color: "#34d399", margin: "0 0 0.5rem", fontSize: "1.1rem" }}>
          {casualModeActive ? "All Done!" : "Batch Log Complete"}
        </h3>
        <p style={{ color: "var(--text-secondary)", fontSize: "0.85rem", margin: "0 0 0.25rem" }}>
          Logged <strong>{result.action}</strong> across <strong>{result.count}</strong> tank{result.count > 1 ? "s" : ""}
        </p>
        <p style={{ color: "var(--text-muted)", fontSize: "0.75rem", margin: 0 }}>
          +{result.totalXp} {casualModeActive ? "pts" : "XP"} earned
        </p>
        <button
          onClick={handleDone}
          className="btn-primary"
          style={{ marginTop: "1.25rem", fontSize: "0.8rem", padding: "0.5rem 1.5rem" }}
        >
          Done
        </button>
      </div>
    );
  }

  return (
    <div className="glass-card" style={{
      padding: "1.25rem",
      border: casualModeActive
        ? "1px solid rgba(56, 189, 248, 0.12)"
        : "1px solid rgba(168, 85, 247, 0.15)",
    }}>
      {/* Header */}
      <div style={{ marginBottom: "1rem" }}>
        <h3 style={{ margin: 0, fontSize: "1rem", color: "#fff" }}>
          {casualModeActive ? "Quick Log" : "Batch Care Log"}
        </h3>
        <p style={{ margin: "0.2rem 0 0", fontSize: "0.75rem", color: "var(--text-muted)" }}>
          {casualModeActive
            ? "Log the same action across multiple tanks at once."
            : "Rack-walk batch logging. Select tanks, pick action, submit."}
        </p>
      </div>

      {/* Action Selector */}
      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginBottom: "1rem" }}>
        {ACTIONS.map(a => (
          <button
            key={a.key}
            onClick={() => setAction(a.key)}
            style={{
              padding: "0.45rem 0.85rem",
              borderRadius: "20px",
              border: action === a.key
                ? "1px solid rgba(56, 189, 248, 0.5)"
                : "1px solid rgba(255,255,255,0.1)",
              background: action === a.key
                ? "rgba(56, 189, 248, 0.12)"
                : "rgba(255,255,255,0.03)",
              color: action === a.key ? "#7dd3fc" : "var(--text-secondary)",
              fontSize: "0.78rem",
              cursor: "pointer",
              transition: "all 0.15s ease",
            }}
          >
            {a.icon} {a.key}
          </button>
        ))}
      </div>

      {/* Tank Selection */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
        <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
          {selectedTanks.size}/{tanks.length} tanks selected
        </span>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <button
            onClick={selectAll}
            style={{
              background: "none", border: "none", color: "var(--accent-blue)",
              fontSize: "0.7rem", cursor: "pointer", textDecoration: "underline",
            }}
          >All</button>
          <button
            onClick={selectNone}
            style={{
              background: "none", border: "none", color: "var(--text-muted)",
              fontSize: "0.7rem", cursor: "pointer", textDecoration: "underline",
            }}
          >None</button>
        </div>
      </div>

      {/* Tank List (compact) */}
      <div style={{
        display: "flex",
        flexDirection: "column",
        gap: "0.35rem",
        maxHeight: "280px",
        overflowY: "auto",
        marginBottom: "1rem",
      }}>
        {tanks.map(tank => {
          const isSelected = selectedTanks.has(tank.id);
          return (
            <label
              key={tank.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.6rem",
                padding: "0.5rem 0.75rem",
                borderRadius: "8px",
                background: isSelected ? "rgba(56, 189, 248, 0.05)" : "transparent",
                border: isSelected
                  ? "1px solid rgba(56, 189, 248, 0.15)"
                  : "1px solid rgba(255,255,255,0.04)",
                cursor: "pointer",
                transition: "all 0.15s ease",
              }}
            >
              <input
                type="checkbox"
                checked={isSelected}
                onChange={() => toggleTank(tank.id)}
                style={{ accentColor: "var(--accent-blue)", width: "16px", height: "16px" }}
              />
              <span style={{ fontSize: "0.82rem", color: isSelected ? "#fff" : "var(--text-secondary)" }}>
                {tank.name || `Tank #${tank.id}`}
              </span>
              {tank.type && (
                <span style={{
                  fontSize: "0.6rem",
                  color: "var(--text-muted)",
                  marginLeft: "auto",
                }}>
                  {tank.type}
                </span>
              )}
            </label>
          );
        })}
      </div>

      {/* Submit */}
      <button
        onClick={handleSubmit}
        disabled={submitting || selectedTanks.size === 0}
        className="btn-primary"
        style={{
          width: "100%",
          fontSize: "0.85rem",
          padding: "0.65rem",
          opacity: selectedTanks.size === 0 ? 0.5 : 1,
        }}
      >
        {submitting
          ? "Logging..."
          : `Log "${action}" → ${selectedTanks.size} tank${selectedTanks.size !== 1 ? "s" : ""}`}
      </button>
    </div>
  );
}
