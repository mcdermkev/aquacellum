/**
 * EchoAmbient.jsx
 *
 * Persistent ambient Echo presence — a small (32px) companion that floats
 * in the bottom-left corner of the app across all pages.
 *
 * Behaviors:
 *   - Idle: gentle bob animation
 *   - Page transition: dart to new position, look around
 *   - User action: quick reaction (bounce, sparkle, nod)
 *   - Long idle (2+ min): falls asleep (zzz)
 *   - Tap: expands to quick-status popover (needs summary, mood, streak)
 *
 * Props:
 *   - dna {object} EchoDNA from on-chain
 *   - stage {number} 0–6
 *   - needs {object} Current calculated needs
 *   - personality {object} Personality axes
 *   - mood {object} Current mood from getMoodFromNeeds
 *   - streak {number} Care streak days
 *   - onOpenFull {function} Handler to open full EchoLivingCompanion screen
 *   - visible {boolean} Whether to show (false in pro mode or during full screen)
 */

import React, { useState, useEffect, useRef, useCallback } from "react";
import { EchoRenderer } from "./EchoRenderer";
import { getMoodFromNeeds, getNeedsSummary, getMostCriticalNeed } from "../utils/echoNeeds";

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const IDLE_SLEEP_MS = 120000; // 2 minutes idle → sleep
const REACTION_DURATION_MS = 2000;
const POPOVER_DISMISS_MS = 6000;
const AMBIENT_SIZE = 32;

// ─────────────────────────────────────────────────────────────────────────────
// Ambient state types
// ─────────────────────────────────────────────────────────────────────────────

const AMBIENT_STATES = {
  idle: "idle",
  sleeping: "sleeping",
  reacting: "reacting",
  darting: "darting",
};

// Quick reaction emojis for XP events
const REACTION_EMOJIS = {
  feed: "🍽️",
  water: "💧",
  params: "🧪",
  scan: "🔍",
  social: "💬",
  xp: "✨",
  streak: "🔥",
  default: "💫",
};

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export function EchoAmbient({
  dna,
  stage = 2,
  needs,
  personality,
  mood,
  streak = 0,
  onOpenFull,
  visible = true,
}) {
  const [ambientState, setAmbientState] = useState(AMBIENT_STATES.idle);
  const [reactionEmoji, setReactionEmoji] = useState(null);
  const [showPopover, setShowPopover] = useState(false);
  const [position, setPosition] = useState({ x: 16, y: 0 }); // bottom-left offset

  const idleTimer = useRef(null);
  const reactionTimer = useRef(null);
  const popoverTimer = useRef(null);
  const lastActivityTime = useRef(Date.now());

  // Reset idle timer on any activity
  const resetIdleTimer = useCallback(() => {
    lastActivityTime.current = Date.now();
    if (ambientState === AMBIENT_STATES.sleeping) {
      setAmbientState(AMBIENT_STATES.idle);
    }

    if (idleTimer.current) clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(() => {
      setAmbientState(AMBIENT_STATES.sleeping);
    }, IDLE_SLEEP_MS);
  }, [ambientState]);

  // Initialize idle timer
  useEffect(() => {
    resetIdleTimer();
    return () => {
      if (idleTimer.current) clearTimeout(idleTimer.current);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Listen for user activity (XP events, page navigation)
  useEffect(() => {
    const handleXpEvent = (e) => {
      resetIdleTimer();
      triggerReaction(e.detail);
    };

    const handleNavigation = () => {
      resetIdleTimer();
      triggerDart();
    };

    window.addEventListener("aquadex_xp_added", handleXpEvent);
    window.addEventListener("popstate", handleNavigation);
    window.addEventListener("aquadex_navigate", handleNavigation);

    return () => {
      window.removeEventListener("aquadex_xp_added", handleXpEvent);
      window.removeEventListener("popstate", handleNavigation);
      window.removeEventListener("aquadex_navigate", handleNavigation);
    };
  }, [resetIdleTimer]); // eslint-disable-line react-hooks/exhaustive-deps

  // Trigger a reaction animation (bounce + emoji)
  const triggerReaction = useCallback((detail) => {
    if (reactionTimer.current) clearTimeout(reactionTimer.current);

    // Determine reaction emoji based on action
    const label = (detail?.actionLabel || "").toLowerCase();
    let emoji = REACTION_EMOJIS.default;
    if (label.includes("feed")) emoji = REACTION_EMOJIS.feed;
    else if (label.includes("water change")) emoji = REACTION_EMOJIS.water;
    else if (label.includes("param")) emoji = REACTION_EMOJIS.params;
    else if (label.includes("scan") || label.includes("species")) emoji = REACTION_EMOJIS.scan;
    else if (label.includes("post") || label.includes("share")) emoji = REACTION_EMOJIS.social;
    else if (detail?.tierChanged) emoji = REACTION_EMOJIS.streak;
    else emoji = REACTION_EMOJIS.xp;

    setReactionEmoji(emoji);
    setAmbientState(AMBIENT_STATES.reacting);

    reactionTimer.current = setTimeout(() => {
      setReactionEmoji(null);
      setAmbientState(AMBIENT_STATES.idle);
    }, REACTION_DURATION_MS);
  }, []);

  // Trigger a dart animation (page transition)
  const triggerDart = useCallback(() => {
    setAmbientState(AMBIENT_STATES.darting);
    // Small random position jitter
    setPosition((prev) => ({
      x: 16 + Math.random() * 8 - 4,
      y: Math.random() * 6 - 3,
    }));

    setTimeout(() => {
      setAmbientState(AMBIENT_STATES.idle);
    }, 600);
  }, []);

  // Toggle popover on tap
  const handleTap = useCallback((e) => {
    e.stopPropagation();
    resetIdleTimer();

    if (showPopover) {
      setShowPopover(false);
      if (popoverTimer.current) clearTimeout(popoverTimer.current);
    } else {
      setShowPopover(true);
      popoverTimer.current = setTimeout(() => setShowPopover(false), POPOVER_DISMISS_MS);
    }
  }, [showPopover, resetIdleTimer]);

  // Dismiss popover on outside click
  useEffect(() => {
    if (!showPopover) return;
    const dismiss = () => setShowPopover(false);
    const timer = setTimeout(() => {
      document.addEventListener("click", dismiss, { once: true });
    }, 100);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("click", dismiss);
      if (popoverTimer.current) clearTimeout(popoverTimer.current);
    };
  }, [showPopover]);

  // Cleanup
  useEffect(() => {
    return () => {
      if (reactionTimer.current) clearTimeout(reactionTimer.current);
      if (popoverTimer.current) clearTimeout(popoverTimer.current);
    };
  }, []);

  if (!visible || !dna) return null;

  const currentMood = mood || getMoodFromNeeds(needs);
  const criticalNeed = getMostCriticalNeed(needs);
  const needsSummary = getNeedsSummary(needs);

  // Animation class based on state
  const getAnimationClass = () => {
    switch (ambientState) {
      case AMBIENT_STATES.sleeping: return "echo-ambient-sleep";
      case AMBIENT_STATES.reacting: return "echo-ambient-bounce";
      case AMBIENT_STATES.darting: return "echo-ambient-dart";
      default: return "echo-ambient-idle";
    }
  };

  return (
    <>
      <div
        className={`echo-ambient-container ${getAnimationClass()}`}
        onClick={handleTap}
        onKeyDown={(e) => e.key === "Enter" && handleTap(e)}
        role="button"
        tabIndex={0}
        aria-label={`Echo companion — ${currentMood.label}. Tap for status.`}
        style={{
          position: "fixed",
          bottom: `calc(4.5rem + ${position.y}px)`,
          left: `${position.x}px`,
          width: `${AMBIENT_SIZE}px`,
          height: `${AMBIENT_SIZE * 0.6}px`,
          zIndex: 8000,
          cursor: "pointer",
          transition: "left 0.4s ease, bottom 0.4s ease",
          pointerEvents: "auto",
        }}
      >
        {/* Mini Echo renderer */}
        <EchoRenderer
          dna={dna}
          stage={stage}
          needs={needs}
          personality={personality}
          size={AMBIENT_SIZE}
          animated={ambientState !== AMBIENT_STATES.sleeping}
        />

        {/* Sleep indicator */}
        {ambientState === AMBIENT_STATES.sleeping && (
          <span
            style={{
              position: "absolute",
              top: "-8px",
              right: "-4px",
              fontSize: "0.6rem",
              animation: "echo-zzz 2s ease-in-out infinite",
            }}
          >
            💤
          </span>
        )}

        {/* Reaction emoji */}
        {reactionEmoji && (
          <span
            style={{
              position: "absolute",
              top: "-12px",
              left: "50%",
              transform: "translateX(-50%)",
              fontSize: "0.75rem",
              animation: "echo-reaction-pop 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)",
              pointerEvents: "none",
            }}
          >
            {reactionEmoji}
          </span>
        )}

        {/* Critical need indicator dot */}
        {criticalNeed && criticalNeed.value < 20 && (
          <span
            style={{
              position: "absolute",
              bottom: "-2px",
              right: "-2px",
              width: "7px",
              height: "7px",
              borderRadius: "50%",
              background: "#ef4444",
              border: "1.5px solid #0a0f1e",
              animation: "echo-pulse-dot 1.5s ease infinite",
            }}
          />
        )}
      </div>

      {/* Popover (quick status) */}
      {showPopover && (
        <div
          role="dialog"
          aria-label="Echo quick status"
          onClick={(e) => e.stopPropagation()}
          style={{
            position: "fixed",
            bottom: `calc(4.5rem + ${AMBIENT_SIZE * 0.6 + 12}px)`,
            left: "16px",
            width: "220px",
            padding: "0.75rem",
            borderRadius: "12px",
            background: "rgba(10, 15, 30, 0.95)",
            border: "1px solid rgba(56, 189, 248, 0.15)",
            backdropFilter: "blur(12px)",
            boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
            zIndex: 8500,
            animation: "echo-popover-in 0.25s ease",
          }}
        >
          {/* Mood header */}
          <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", marginBottom: "0.5rem" }}>
            <span style={{ fontSize: "1rem" }}>{currentMood.emoji}</span>
            <span style={{ fontSize: "0.75rem", fontWeight: "700", color: "#fff" }}>
              {currentMood.label}
            </span>
            {streak > 0 && (
              <span style={{ fontSize: "0.6rem", color: "#fbbf24", marginLeft: "auto" }}>
                🔥 {streak}d
              </span>
            )}
          </div>

          {/* Mini needs bars */}
          <div style={{ display: "grid", gap: "0.25rem", marginBottom: "0.6rem" }}>
            {needsSummary.map((need) => (
              <div key={need.key} style={{ display: "flex", alignItems: "center", gap: "0.3rem" }}>
                <span style={{ fontSize: "0.6rem", width: "1rem" }}>{need.emoji}</span>
                <div style={{
                  flex: 1,
                  height: "4px",
                  background: "rgba(255,255,255,0.06)",
                  borderRadius: "2px",
                  overflow: "hidden",
                }}>
                  <div style={{
                    width: `${need.value}%`,
                    height: "100%",
                    borderRadius: "2px",
                    background: need.status === "critical" ? "#ef4444"
                      : need.status === "low" ? "#f97316"
                      : need.status === "ok" ? "#38bdf8"
                      : "#34d399",
                    transition: "width 0.3s ease",
                  }} />
                </div>
              </div>
            ))}
          </div>

          {/* Open full Echo button */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              setShowPopover(false);
              if (onOpenFull) onOpenFull();
            }}
            style={{
              width: "100%",
              padding: "0.4rem",
              borderRadius: "6px",
              border: "1px solid rgba(56, 189, 248, 0.2)",
              background: "rgba(56, 189, 248, 0.08)",
              color: "#38bdf8",
              fontSize: "0.65rem",
              fontWeight: "600",
              cursor: "pointer",
              textAlign: "center",
            }}
          >
            Visit Echo →
          </button>
        </div>
      )}

      {/* CSS Animations */}
      <style>{`
        @keyframes echo-ambient-bob {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-3px); }
        }
        .echo-ambient-idle {
          animation: echo-ambient-bob 3s ease-in-out infinite;
        }
        @keyframes echo-ambient-sleep-bob {
          0%, 100% { transform: translateY(0) scale(0.95); opacity: 0.6; }
          50% { transform: translateY(1px) scale(0.95); opacity: 0.5; }
        }
        .echo-ambient-sleep {
          animation: echo-ambient-sleep-bob 4s ease-in-out infinite;
        }
        @keyframes echo-ambient-bounce-anim {
          0% { transform: translateY(0) scale(1); }
          30% { transform: translateY(-8px) scale(1.1); }
          60% { transform: translateY(2px) scale(0.95); }
          100% { transform: translateY(0) scale(1); }
        }
        .echo-ambient-bounce {
          animation: echo-ambient-bounce-anim 0.6s cubic-bezier(0.34, 1.56, 0.64, 1);
        }
        @keyframes echo-ambient-dart-anim {
          0% { transform: translateX(0) scaleX(1); }
          40% { transform: translateX(12px) scaleX(1.2); }
          100% { transform: translateX(0) scaleX(1); }
        }
        .echo-ambient-dart {
          animation: echo-ambient-dart-anim 0.5s ease-out;
        }
        @keyframes echo-zzz {
          0%, 100% { opacity: 0.5; transform: translateY(0); }
          50% { opacity: 1; transform: translateY(-4px); }
        }
        @keyframes echo-reaction-pop {
          from { transform: translateX(-50%) scale(0) translateY(4px); opacity: 0; }
          to { transform: translateX(-50%) scale(1) translateY(0); opacity: 1; }
        }
        @keyframes echo-pulse-dot {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.5; transform: scale(1.3); }
        }
        @keyframes echo-popover-in {
          from { opacity: 0; transform: translateY(8px) scale(0.95); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
      `}</style>
    </>
  );
}

export default EchoAmbient;
