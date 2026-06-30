/**
 * EchoRareMomentOverlay.jsx
 *
 * Full-screen animation overlay that appears when a rare moment triggers.
 * Displays for 5–8 seconds with a particle/light show, Echo's message,
 * and a "screenshot this!" hint. Auto-dismisses or tap to dismiss.
 *
 * Props:
 *   - moment {object} The RARE_MOMENTS entry that triggered
 *   - dna {object} Echo DNA for color theming
 *   - onComplete {function} Called when the moment ends
 */

import React, { useState, useEffect, useCallback } from "react";

export function EchoRareMomentOverlay({ moment, dna, onComplete }) {
  const [phase, setPhase] = useState("entering"); // entering → active → exiting
  const [dismissed, setDismissed] = useState(false);

  const baseHue = dna?.baseHue || 200;
  const secondaryHue = dna?.secondaryHue || 280;

  // Phase transitions
  useEffect(() => {
    // Enter → Active
    const enterTimer = setTimeout(() => setPhase("active"), 600);

    // Active → Exiting → Complete
    const exitTimer = setTimeout(() => {
      setPhase("exiting");
    }, moment.durationMs - 800);

    const completeTimer = setTimeout(() => {
      if (onComplete) onComplete();
    }, moment.durationMs);

    return () => {
      clearTimeout(enterTimer);
      clearTimeout(exitTimer);
      clearTimeout(completeTimer);
    };
  }, [moment.durationMs, onComplete]);

  // Dismiss on tap
  const handleDismiss = useCallback(() => {
    if (dismissed) return;
    setDismissed(true);
    setPhase("exiting");
    setTimeout(() => {
      if (onComplete) onComplete();
    }, 500);
  }, [dismissed, onComplete]);

  // Determine visual theme based on moment type
  const getThemeColors = () => {
    switch (moment.id) {
      case "shootingStar":
        return { bg: "rgba(10, 5, 30, 0.95)", accent: "#fbbf24", glow: "rgba(251, 191, 36, 0.3)" };
      case "rainbowShimmer":
        return { bg: "rgba(10, 15, 30, 0.9)", accent: "#34d399", glow: "rgba(52, 211, 153, 0.2)" };
      case "bioluminescence":
        return { bg: "rgba(0, 5, 15, 0.97)", accent: "#38bdf8", glow: "rgba(56, 189, 248, 0.4)" };
      case "auroraDrift":
        return { bg: "rgba(5, 0, 20, 0.95)", accent: "#a78bfa", glow: "rgba(167, 139, 250, 0.3)" };
      case "echoDream":
        return { bg: "rgba(15, 10, 30, 0.95)", accent: "#c4b5fd", glow: "rgba(196, 181, 253, 0.2)" };
      case "constellation":
        return { bg: "rgba(2, 2, 15, 0.97)", accent: "#fef3c7", glow: "rgba(254, 243, 199, 0.2)" };
      case "deepSong":
        return { bg: "rgba(0, 10, 25, 0.95)", accent: "#06b6d4", glow: "rgba(6, 182, 212, 0.3)" };
      case "tidalBloom":
        return { bg: "rgba(15, 5, 15, 0.93)", accent: "#f472b6", glow: "rgba(244, 114, 182, 0.2)" };
      default:
        return { bg: "rgba(10, 15, 30, 0.95)", accent: `hsl(${baseHue}, 70%, 60%)`, glow: `hsla(${baseHue}, 70%, 60%, 0.3)` };
    }
  };

  const theme = getThemeColors();

  return (
    <div
      onClick={handleDismiss}
      onKeyDown={(e) => (e.key === "Escape" || e.key === "Enter") && handleDismiss()}
      role="dialog"
      aria-label={`Rare moment: ${moment.name}`}
      tabIndex={0}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 99999,
        background: theme.bg,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        cursor: "pointer",
        opacity: phase === "entering" ? 0 : phase === "exiting" ? 0 : 1,
        transition: "opacity 0.6s ease",
        overflow: "hidden",
      }}
    >
      {/* Particle field */}
      <div style={{ position: "absolute", inset: 0, pointerEvents: "none", overflow: "hidden" }}>
        {[...Array(20)].map((_, i) => (
          <div
            key={i}
            style={{
              position: "absolute",
              left: `${Math.random() * 100}%`,
              top: `${Math.random() * 100}%`,
              width: `${2 + Math.random() * 4}px`,
              height: `${2 + Math.random() * 4}px`,
              borderRadius: "50%",
              background: i % 3 === 0 ? theme.accent : `hsl(${secondaryHue}, 60%, 70%)`,
              opacity: 0,
              animation: `echo-rare-particle ${2 + Math.random() * 3}s ease-in-out ${Math.random() * 2}s infinite`,
            }}
          />
        ))}
      </div>

      {/* Central glow */}
      <div
        style={{
          position: "absolute",
          width: "300px",
          height: "300px",
          borderRadius: "50%",
          background: `radial-gradient(circle, ${theme.glow} 0%, transparent 70%)`,
          animation: "echo-rare-glow-pulse 3s ease-in-out infinite",
          pointerEvents: "none",
        }}
      />

      {/* Moment emoji (large, animated) */}
      <div
        style={{
          fontSize: "4rem",
          marginBottom: "1.5rem",
          animation: "echo-rare-emoji-float 3s ease-in-out infinite",
          filter: `drop-shadow(0 0 20px ${theme.glow})`,
        }}
      >
        {moment.emoji}
      </div>

      {/* Moment name */}
      <h2
        style={{
          margin: 0,
          fontSize: "1.4rem",
          fontWeight: "700",
          color: theme.accent,
          textAlign: "center",
          textShadow: `0 0 20px ${theme.glow}`,
          animation: "echo-rare-text-in 0.8s ease 0.3s both",
        }}
      >
        {moment.name}
      </h2>

      {/* Message */}
      <p
        style={{
          margin: "0.75rem 2rem 0",
          fontSize: "0.9rem",
          color: "rgba(255, 255, 255, 0.8)",
          textAlign: "center",
          lineHeight: 1.5,
          maxWidth: "320px",
          animation: "echo-rare-text-in 0.8s ease 0.6s both",
        }}
      >
        {moment.message}
      </p>

      {/* Rare badge */}
      <div
        style={{
          marginTop: "2rem",
          padding: "0.3rem 0.8rem",
          borderRadius: "20px",
          background: "rgba(255, 255, 255, 0.05)",
          border: `1px solid ${theme.accent}40`,
          fontSize: "0.65rem",
          color: theme.accent,
          fontWeight: "600",
          letterSpacing: "0.5px",
          textTransform: "uppercase",
          animation: "echo-rare-text-in 0.8s ease 0.9s both",
        }}
      >
        ✦ Rare Moment ✦
      </div>

      {/* Dismiss hint */}
      <div
        style={{
          position: "absolute",
          bottom: "2rem",
          fontSize: "0.6rem",
          color: "rgba(255, 255, 255, 0.3)",
          animation: "echo-rare-text-in 0.8s ease 1.2s both",
        }}
      >
        tap anywhere to dismiss
      </div>

      {/* CSS Animations */}
      <style>{`
        @keyframes echo-rare-particle {
          0%, 100% { opacity: 0; transform: translateY(0) scale(0.5); }
          50% { opacity: 0.8; transform: translateY(-30px) scale(1); }
        }
        @keyframes echo-rare-glow-pulse {
          0%, 100% { transform: scale(1); opacity: 0.6; }
          50% { transform: scale(1.2); opacity: 1; }
        }
        @keyframes echo-rare-emoji-float {
          0%, 100% { transform: translateY(0) scale(1); }
          50% { transform: translateY(-10px) scale(1.05); }
        }
        @keyframes echo-rare-text-in {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}

export default EchoRareMomentOverlay;
