import React, { useState, useEffect } from "react";

/**
 * ModeSegmentedControl — Premium segmented toggle for Casual/Pro mode switching.
 * Renders as a pill-shaped control with two segments. The active segment gets
 * a solid gradient fill; the inactive segment is ghost/transparent.
 * 
 * Quick Win 9: Shows a one-time explanation tooltip on first mode switch.
 */
export function ModeSegmentedControl({ casualModeActive, onToggle }) {
  const [showHint, setShowHint] = useState(false);
  const [hintText, setHintText] = useState("");

  const handleToggle = (newCasualVal) => {
    const hasSeenHint = localStorage.getItem("aquadex_mode_hint_seen");
    
    if (!hasSeenHint) {
      localStorage.setItem("aquadex_mode_hint_seen", "true");
      const text = newCasualVal
        ? "Casual mode: simplified labels, fewer tabs. Perfect for hobbyists."
        : "Pro mode: full breeder tools including Lineage and Spawning tabs.";
      setHintText(text);
      setShowHint(true);
      setTimeout(() => setShowHint(false), 4500);
    }

    onToggle(newCasualVal);
  };

  return (
    <div style={{ position: "relative", width: "100%", maxWidth: "380px" }}>
      <div 
        className="mode-segmented-control"
        role="radiogroup"
        aria-label="Interface mode"
        style={{
          display: "flex",
          alignItems: "center",
          background: "rgba(255, 255, 255, 0.02)",
          border: casualModeActive 
            ? "1px solid rgba(56, 189, 248, 0.2)" 
            : "1px solid rgba(168, 85, 247, 0.25)",
          borderRadius: "50px",
          padding: "3px",
          position: "relative",
          width: "100%",
          boxShadow: casualModeActive
            ? "0 0 20px rgba(56, 189, 248, 0.06), inset 0 1px 2px rgba(0,0,0,0.3)"
            : "0 0 20px rgba(168, 85, 247, 0.08), inset 0 1px 2px rgba(0,0,0,0.3)",
          transition: "border-color 0.35s ease, box-shadow 0.35s ease",
          backdropFilter: "blur(8px)",
        }}
      >
        {/* Casual Segment */}
        <button
          role="radio"
          aria-checked={casualModeActive}
          aria-label="Casual Hobbyist mode"
          onClick={() => { if (!casualModeActive) handleToggle(true); }}
          className={`mode-segment ${casualModeActive ? "mode-segment--active mode-segment--casual" : ""}`}
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "0.5rem",
            padding: "0.6rem 1.25rem",
            borderRadius: "50px",
            border: "none",
            cursor: "pointer",
            fontSize: "0.8rem",
            fontWeight: casualModeActive ? "700" : "500",
            fontFamily: "'Plus Jakarta Sans', sans-serif",
            color: casualModeActive ? "#fff" : "var(--text-muted)",
            background: casualModeActive 
              ? "linear-gradient(135deg, rgba(56, 189, 248, 0.25) 0%, rgba(14, 165, 233, 0.15) 100%)"
              : "transparent",
            boxShadow: casualModeActive 
              ? "0 2px 12px rgba(56, 189, 248, 0.2), inset 0 0 0 1px rgba(56, 189, 248, 0.3)"
              : "none",
            transition: "all 0.35s cubic-bezier(0.4, 0, 0.2, 1)",
            position: "relative",
            overflow: "hidden",
            minHeight: "44px",
          }}
        >
          <span style={{ fontSize: "1rem" }}>🐠</span>
          <span className="mode-segment-label">Casual</span>
        </button>

        {/* Pro Segment */}
        <button
          role="radio"
          aria-checked={!casualModeActive}
          aria-label="Professional Breeder mode"
          onClick={() => { if (casualModeActive) handleToggle(false); }}
          className={`mode-segment ${!casualModeActive ? "mode-segment--active mode-segment--pro" : ""}`}
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "0.5rem",
            padding: "0.6rem 1.25rem",
            borderRadius: "50px",
            border: "none",
            cursor: "pointer",
            fontSize: "0.8rem",
            fontWeight: !casualModeActive ? "700" : "500",
            fontFamily: "'Plus Jakarta Sans', sans-serif",
            color: !casualModeActive ? "#fff" : "var(--text-muted)",
            background: !casualModeActive 
              ? "linear-gradient(135deg, rgba(168, 85, 247, 0.25) 0%, rgba(139, 92, 246, 0.15) 100%)"
              : "transparent",
            boxShadow: !casualModeActive 
              ? "0 2px 12px rgba(168, 85, 247, 0.2), inset 0 0 0 1px rgba(168, 85, 247, 0.3)"
              : "none",
            transition: "all 0.35s cubic-bezier(0.4, 0, 0.2, 1)",
            position: "relative",
            overflow: "hidden",
            minHeight: "44px",
          }}
        >
          <span style={{ fontSize: "1rem" }}>🧬</span>
          <span className="mode-segment-label">Pro</span>
        </button>
      </div>

      {/* First-time mode switch hint */}
      {showHint && (
        <div style={{
          position: "absolute",
          top: "calc(100% + 8px)",
          left: "50%",
          transform: "translateX(-50%)",
          background: "rgba(14, 20, 36, 0.95)",
          border: "1px solid rgba(255, 255, 255, 0.12)",
          borderRadius: "8px",
          padding: "0.6rem 1rem",
          fontSize: "0.75rem",
          color: "var(--text-secondary)",
          whiteSpace: "nowrap",
          zIndex: 100,
          boxShadow: "0 8px 24px rgba(0, 0, 0, 0.5)",
          animation: "fadeInBadge 0.3s ease-out forwards",
        }}>
          {hintText}
        </div>
      )}
    </div>
  );
}
