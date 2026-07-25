import React from "react";
import { tankTypeLabel, tankTypeIcon } from "../utils/tankUtils";

/**
 * TankSelector — Reusable tank picker for the Arrival Flow.
 * Displays user's tanks as selectable cards, ordered by most recently interacted.
 * Supports suggested/pre-selected tank and persona-aware labels.
 */

function TankSelector({
  tanks = [],
  selectedTankId = null,
  onSelect,
  suggestedTankId = null,
  casualModeActive = true,
}) {
  // Sort tanks by most recently interacted (latest test or change timestamp)
  const sorted = [...tanks].sort((a, b) => {
    const aTime = Math.max(a.latestTestTimestamp || 0, a.latestChangeTimestamp || 0, a.creationTimestamp || 0);
    const bTime = Math.max(b.latestTestTimestamp || 0, b.latestChangeTimestamp || 0, b.creationTimestamp || 0);
    return bTime - aTime;
  });

  return (
    <div
      className="tank-selector"
      role="listbox"
      aria-label={casualModeActive ? "Choose a tank" : "Select containment unit"}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "0.5rem",
        maxHeight: "240px",
        overflowY: "auto",
        padding: "0.25rem",
      }}
    >
      {sorted.map((tank) => {
        const isSelected = Number(tank.id) === Number(selectedTankId);
        const isSuggested = Number(tank.id) === Number(suggestedTankId);
        const specimenCount = (tank.specimens || []).length;
        const typeIndex = Number(tank.tankType) || 0;

        return (
          <button
            key={tank.id}
            type="button"
            role="option"
            aria-selected={isSelected}
            onClick={() => onSelect(tank.id)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.75rem",
              padding: "0.6rem 0.75rem",
              borderRadius: "8px",
              border: isSelected
                ? "2px solid var(--accent-cyan, #22d3ee)"
                : "1px solid rgba(255,255,255,0.1)",
              background: isSelected
                ? "rgba(34,211,238,0.08)"
                : "rgba(255,255,255,0.03)",
              cursor: "pointer",
              textAlign: "left",
              width: "100%",
              transition: "border-color 0.15s, background 0.15s",
              position: "relative",
            }}
          >
            {/* Tank type icon */}
            <span style={{ fontSize: "1.3rem", flexShrink: 0 }}>
              {tankTypeIcon(typeIndex)}
            </span>

            {/* Tank info */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{
                fontWeight: 600,
                fontSize: "0.85rem",
                color: "var(--text-primary, #f1f5f9)",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}>
                {tank.name || "Unnamed Tank"}
              </div>
              <div style={{
                fontSize: "0.72rem",
                color: "var(--text-muted, #94a3b8)",
                marginTop: "0.15rem",
              }}>
                {tankTypeLabel(typeIndex)} · {tank.volumeLiters || "?"}L · {specimenCount} {casualModeActive ? "fish" : "specimens"}
              </div>
            </div>

            {/* Badges */}
            <div style={{ display: "flex", gap: "0.3rem", alignItems: "center", flexShrink: 0 }}>
              {isSuggested && !isSelected && (
                <span style={{
                  fontSize: "0.6rem",
                  background: "rgba(34,211,238,0.12)",
                  color: "var(--accent-cyan, #22d3ee)",
                  border: "1px solid rgba(34,211,238,0.3)",
                  borderRadius: "12px",
                  padding: "0.1rem 0.4rem",
                  whiteSpace: "nowrap",
                }}>
                  Suggested
                </span>
              )}
              {isSelected && (
                <span style={{
                  fontSize: "0.85rem",
                  color: "var(--accent-cyan, #22d3ee)",
                }}>
                  ✓
                </span>
              )}
            </div>
          </button>
        );
      })}

      {sorted.length === 0 && (
        <p style={{
          color: "var(--text-muted, #94a3b8)",
          fontSize: "0.8rem",
          textAlign: "center",
          padding: "1rem",
        }}>
          {casualModeActive
            ? "No tanks registered yet."
            : "No containment units registered."}
        </p>
      )}
    </div>
  );
}

export { TankSelector };
export default TankSelector;
