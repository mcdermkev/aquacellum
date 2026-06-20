import React from "react";

/**
 * IncomingBadge — Small numeric badge for navigation items.
 * Shows the count of specimens/batches in transit.
 * Pulses when any item has an active nudge (past threshold).
 */

function IncomingBadge({ count = 0, hasNudge = false }) {
  if (count === 0) return null;

  return (
    <span
      className={hasNudge ? "incoming-badge incoming-badge--nudge" : "incoming-badge"}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        minWidth: "18px",
        height: "18px",
        borderRadius: "9px",
        padding: "0 5px",
        fontSize: "0.6rem",
        fontWeight: 700,
        lineHeight: 1,
        background: hasNudge
          ? "var(--accent-amber, #fbbf24)"
          : "var(--accent-cyan, #22d3ee)",
        color: hasNudge ? "#1a1a2e" : "#0f172a",
        animation: hasNudge ? "incomingPulse 2s ease-in-out infinite" : "none",
      }}
      aria-label={`${count} incoming`}
    >
      {count}
    </span>
  );
}

export { IncomingBadge };
export default IncomingBadge;
