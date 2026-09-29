import React, { useState } from "react";

/**
 * ModeSegmentedControl — segmented toggle for Casual/Pro mode switching.
 * Renders as a pill-shaped control with two segments; the active segment is
 * filled, the inactive one is ghost.
 *
 * `compact` is the top-bar size (AppTopBar): short, content-width, sized to sit
 * beside the cart and account chip the way a control sits in the public nav.
 * The full size is used in the phone menu and anywhere with room.
 *
 * Quick Win 9: Shows a one-time explanation tooltip on first mode switch.
 */
export function ModeSegmentedControl({ casualModeActive, onToggle, compact = false }) {
  const [showHint, setShowHint] = useState(false);
  const [hintText, setHintText] = useState("");

  const handleToggle = (newCasualVal) => {
    const hasSeenHint = localStorage.getItem("aquadex_mode_hint_seen");

    if (!hasSeenHint) {
      localStorage.setItem("aquadex_mode_hint_seen", "true");
      // Keep this honest: casual hides exactly one tab (Breeder Tools), and the
      // old copy named Register / Lineage / Spawning as tabs — they stopped being
      // tabs when Breeder Tools was consolidated. Nothing is locked either way;
      // mode is a display preference, not an entitlement (entitlements.js).
      const text = newCasualVal
        ? "Casual mode: friendlier wording and gamified progress. Nothing is locked."
        : "Pro mode: operational wording, lineage detail, and the Breeder Tools tab.";
      setHintText(text);
      setShowHint(true);
      setTimeout(() => setShowHint(false), 4500);
    }

    onToggle(newCasualVal);
  };

  const segmentStyle = (active, tone) => ({
    flex: compact ? "0 0 auto" : 1,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: compact ? "0.35rem" : "0.5rem",
    padding: compact ? "0.3rem 0.75rem" : "0.6rem 1.25rem",
    borderRadius: "50px",
    border: "none",
    cursor: "pointer",
    fontSize: compact ? "0.78rem" : "0.8rem",
    fontWeight: active ? "600" : "500",
    fontFamily: "inherit",
    color: active ? "var(--text-primary)" : "var(--text-muted)",
    background: active
      ? tone === "casual"
        ? "linear-gradient(135deg, rgba(56, 189, 248, 0.25) 0%, rgba(14, 165, 233, 0.15) 100%)"
        : "linear-gradient(135deg, rgba(168, 85, 247, 0.25) 0%, rgba(139, 92, 246, 0.15) 100%)"
      : "transparent",
    boxShadow: active
      ? tone === "casual"
        ? "inset 0 0 0 1px rgba(56, 189, 248, 0.3)"
        : "inset 0 0 0 1px rgba(168, 85, 247, 0.3)"
      : "none",
    transition: "all 0.35s cubic-bezier(0.4, 0, 0.2, 1)",
    position: "relative",
    overflow: "hidden",
    minHeight: compact ? "32px" : "44px",
  });

  return (
    <div style={{ position: "relative", width: compact ? "auto" : "100%", maxWidth: compact ? "none" : "380px" }}>
      <div
        className={`mode-segmented-control${compact ? " mode-segmented-control--compact" : ""}`}
        role="radiogroup"
        aria-label="Interface mode"
        style={{
          display: "flex",
          alignItems: "center",
          background: "rgba(var(--ink-rgb), 0.03)",
          border: "1px solid var(--glass-border)",
          borderRadius: "50px",
          padding: compact ? "2px" : "3px",
          position: "relative",
          width: compact ? "auto" : "100%",
          transition: "border-color 0.35s ease",
        }}
      >
        {/* Casual Segment */}
        <button
          type="button"
          role="radio"
          aria-checked={casualModeActive}
          aria-label="Casual Hobbyist mode"
          onClick={() => { if (!casualModeActive) handleToggle(true); }}
          className={`mode-segment ${casualModeActive ? "mode-segment--active mode-segment--casual" : ""}`}
          style={segmentStyle(casualModeActive, "casual")}
        >
          <span style={{ fontSize: compact ? "0.85rem" : "1rem" }} aria-hidden="true">🐠</span>
          <span className="mode-segment-label">Casual</span>
        </button>

        {/* Pro Segment */}
        <button
          type="button"
          role="radio"
          aria-checked={!casualModeActive}
          aria-label="Professional Breeder mode"
          onClick={() => { if (casualModeActive) handleToggle(false); }}
          className={`mode-segment ${!casualModeActive ? "mode-segment--active mode-segment--pro" : ""}`}
          style={segmentStyle(!casualModeActive, "pro")}
        >
          <span style={{ fontSize: compact ? "0.85rem" : "1rem" }} aria-hidden="true">🧬</span>
          <span className="mode-segment-label">Pro</span>
        </button>
      </div>

      {/* First-time mode switch hint */}
      {showHint && (
        <div role="status" style={{
          position: "absolute",
          top: "calc(100% + 8px)",
          // In the top bar the control sits right of centre; anchor the hint to
          // its right edge so it can't run off the viewport.
          ...(compact
            ? { right: 0 }
            : { left: "50%", transform: "translateX(-50%)" }),
          background: "#ffffff",
          border: "1px solid rgba(var(--ink-rgb), 0.17)",
          borderRadius: "8px",
          padding: "0.6rem 1rem",
          fontSize: "0.75rem",
          color: "var(--text-secondary)",
          whiteSpace: compact ? "normal" : "nowrap",
          width: compact ? "260px" : "auto",
          zIndex: 100,
          boxShadow: "var(--shadow-lg)",
          animation: "fadeInBadge 0.3s ease-out forwards",
        }}>
          {hintText}
        </div>
      )}
    </div>
  );
}
