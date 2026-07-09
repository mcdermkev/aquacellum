/**
 * EchoLivingCompanion.jsx
 *
 * The full-screen interactive Echo experience. This is the dedicated Echo screen
 * where users can interact directly with their companion:
 *   - Tap for spin + bubble + one-liner (+1 XP, max 3/day)
 *   - Hold/pet for lean-in + vibration + happiness glow (+2 XP, max 2/day)
 *   - Double-tap for trick animation (if unlocked)
 *   - View needs status bars
 *   - See personality summary
 *   - View evolution progress
 *
 * Props:
 *   - dna {object} EchoDNA from on-chain
 *   - stage {number} 0–6
 *   - needs {object} Current calculated needs
 *   - personality {object} Personality axes
 *   - streak {number} Current care streak days
 *   - totalCareDays {number} Cumulative care days
 *   - tricksUnlocked {string[]} Array of trick IDs
 *   - onInteraction {function} Callback when Echo is interacted with (type, xpEarned)
 *   - onClose {function} Close/back handler
 *   - casualModeActive {boolean}
 */

import React, { useState, useCallback, useRef, useEffect } from "react";
import { EchoRenderer } from "./EchoRenderer";
import {
  getMoodFromNeeds,
  getNeedsSummary,
  getReplenishReaction,
  MOODS,
} from "../utils/echoNeeds";

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const MAX_TAPS_PER_DAY = 3;
const MAX_PETS_PER_DAY = 2;
const TAP_XP = 1;
const PET_XP = 2;
const PET_HOLD_MS = 1500; // Must hold 1.5s for pet
const DOUBLE_TAP_WINDOW_MS = 300;

// ─────────────────────────────────────────────────────────────────────────────
// Trick Definitions
// ─────────────────────────────────────────────────────────────────────────────

const TRICKS = {
  backflip: { id: "backflip", name: "Backflip", animation: "echo-trick-backflip", duration: 1200 },
  bubbleRing: { id: "bubbleRing", name: "Bubble Ring", animation: "echo-trick-bubble", duration: 1500 },
  speedDash: { id: "speedDash", name: "Speed Dash", animation: "echo-trick-dash", duration: 800 },
  glowPulse: { id: "glowPulse", name: "Glow Pulse", animation: "echo-trick-glow", duration: 2000 },
  mirrorDance: { id: "mirrorDance", name: "Mirror Dance", animation: "echo-trick-mirror", duration: 2500 },
  galaxyForm: { id: "galaxyForm", name: "Galaxy Form", animation: "echo-trick-galaxy", duration: 3000 },
};

// One-liners for tap responses
const TAP_LINES = [
  "Bloop! 💫",
  "Echo spins with joy!",
  "A happy wiggle!",
  "Bubble kiss! 🫧",
  "Echo noticed you!",
  "A gentle shimmer of gratitude.",
  "Boop! ✨",
  "Echo does a tiny dance.",
  "You made Echo's day.",
  "A flick of the tail in greeting.",
];

// Pet response lines
const PET_LINES = [
  "Echo leans in... pure contentment. 💜",
  "A deep, warm glow spreads through Echo.",
  "Echo closes her eyes and drifts closer.",
  "The softest purr from the deep.",
  "Echo has never felt so safe.",
  "Pure love, radiating outward.",
];

// Stage names for display
const STAGE_NAMES = ["Egg", "Larva", "Fry", "Juvenile", "Adult", "Elder", "Legendary"];

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export function EchoLivingCompanion({
  dna,
  stage = 2,
  needs,
  personality,
  streak = 0,
  totalCareDays = 0,
  tricksUnlocked = [],
  onInteraction,
  onClose,
  casualModeActive = true,
}) {
  const [reaction, setReaction] = useState(null);
  const [activeTrick, setActiveTrick] = useState(null);
  const [lastInteraction, setLastInteraction] = useState(null);
  const [todayTaps, setTodayTaps] = useState(() => {
    const stored = localStorage.getItem("echo_taps_today");
    if (stored) {
      const { count, date } = JSON.parse(stored);
      if (date === new Date().toDateString()) return count;
    }
    return 0;
  });
  const [todayPets, setTodayPets] = useState(() => {
    const stored = localStorage.getItem("echo_pets_today");
    if (stored) {
      const { count, date } = JSON.parse(stored);
      if (date === new Date().toDateString()) return count;
    }
    return 0;
  });

  const lastTapTime = useRef(0);
  const holdTimer = useRef(null);
  const holdStartTime = useRef(0);
  const reactionTimeout = useRef(null);

  // Persist tap/pet counts
  useEffect(() => {
    localStorage.setItem("echo_taps_today", JSON.stringify({ count: todayTaps, date: new Date().toDateString() }));
  }, [todayTaps]);

  useEffect(() => {
    localStorage.setItem("echo_pets_today", JSON.stringify({ count: todayPets, date: new Date().toDateString() }));
  }, [todayPets]);

  // Show a reaction bubble
  const showReaction = useCallback((text, type = "tap") => {
    if (reactionTimeout.current) clearTimeout(reactionTimeout.current);
    setReaction({ text, type });
    reactionTimeout.current = setTimeout(() => setReaction(null), 3000);
  }, []);

  // Haptic feedback (if available)
  const vibrate = useCallback((pattern) => {
    if (navigator.vibrate) navigator.vibrate(pattern);
  }, []);

  // ─── Tap Handler ─────────────────────────────────────────────────────
  const handleTap = useCallback(() => {
    const now = Date.now();

    // Check for double-tap (trick trigger)
    if (now - lastTapTime.current < DOUBLE_TAP_WINDOW_MS) {
      lastTapTime.current = 0;
      handleDoubleTap();
      return;
    }

    lastTapTime.current = now;

    // Delay slightly to check if this becomes a double-tap
    setTimeout(() => {
      if (lastTapTime.current !== now) return; // Was consumed by double-tap

      if (todayTaps >= MAX_TAPS_PER_DAY) {
        showReaction("Echo appreciates the attention! (max taps reached today)", "info");
        return;
      }

      const line = TAP_LINES[Math.floor(Math.random() * TAP_LINES.length)];
      showReaction(line, "tap");
      vibrate(50);
      setLastInteraction({ type: "react", timestamp: Date.now() });

      setTodayTaps((prev) => prev + 1);
      if (onInteraction) onInteraction("tap", TAP_XP);
    }, DOUBLE_TAP_WINDOW_MS + 50);
  }, [todayTaps, onInteraction, showReaction, vibrate]);

  // ─── Double-Tap Handler (Trick) ─────────────────────────────────────
  const handleDoubleTap = useCallback(() => {
    if (tricksUnlocked.length === 0) {
      showReaction("Echo doesn't know any tricks yet. Keep caring!", "info");
      return;
    }

    if (activeTrick) return; // Already performing

    // Pick a random unlocked trick
    const trickId = tricksUnlocked[Math.floor(Math.random() * tricksUnlocked.length)];
    const trick = TRICKS[trickId];
    if (!trick) return;

    setActiveTrick(trick);
    vibrate([50, 50, 100]);
    showReaction(`${trick.name}! 🎉`, "trick");
    setLastInteraction({ type: "trick", timestamp: Date.now() });

    setTimeout(() => setActiveTrick(null), trick.duration);
  }, [tricksUnlocked, activeTrick, showReaction, vibrate]);

  // ─── Pet (Press & Hold) Handlers ────────────────────────────────────
  const handlePointerDown = useCallback(() => {
    holdStartTime.current = Date.now();
    holdTimer.current = setTimeout(() => {
      // Held long enough — trigger pet
      if (todayPets >= MAX_PETS_PER_DAY) {
        showReaction("Echo loves the affection! (max pets reached today)", "info");
        return;
      }

      const line = PET_LINES[Math.floor(Math.random() * PET_LINES.length)];
      showReaction(line, "pet");
      vibrate([30, 30, 30, 30, 80]); // Gentle purr pattern
      setLastInteraction({ type: "pet", timestamp: Date.now() });

      setTodayPets((prev) => prev + 1);
      if (onInteraction) onInteraction("pet", PET_XP);
    }, PET_HOLD_MS);
  }, [todayPets, onInteraction, showReaction, vibrate]);

  const handlePointerUp = useCallback(() => {
    const held = Date.now() - holdStartTime.current;
    if (holdTimer.current) {
      clearTimeout(holdTimer.current);
      holdTimer.current = null;
    }

    // If released before PET_HOLD_MS, treat as tap
    if (held < PET_HOLD_MS) {
      handleTap();
    }
  }, [handleTap]);

  // Cleanup
  useEffect(() => {
    return () => {
      if (holdTimer.current) clearTimeout(holdTimer.current);
      if (reactionTimeout.current) clearTimeout(reactionTimeout.current);
    };
  }, []);

  // Derive mood
  const mood = getMoodFromNeeds(needs);
  const needsSummary = getNeedsSummary(needs);

  // Dominant personality
  const dominantPersonality = personality
    ? Object.entries(personality).sort((a, b) => b[1] - a[1])[0]
    : null;

  return (
    <div
      className="echo-living-companion"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9500,
        background: "linear-gradient(180deg, #0a0f1e 0%, #0d1b2a 40%, #1b2838 100%)",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      {/* Header */}
      <div style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        padding: "1rem 1.25rem 0.5rem",
        zIndex: 2,
      }}>
        <div>
          <h2 style={{ margin: 0, fontSize: "1.1rem", fontWeight: "700", color: "#fff" }}>
            Echo
          </h2>
          <span style={{ fontSize: "0.7rem", color: "var(--text-muted, #94a3b8)" }}>
            {STAGE_NAMES[stage]} · {mood.emoji} {mood.label}
          </span>
        </div>
        <button
          onClick={onClose}
          aria-label="Close Echo screen"
          style={{
            background: "rgba(255,255,255,0.06)",
            border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: "8px",
            padding: "0.4rem 0.8rem",
            color: "#fff",
            fontSize: "0.75rem",
            cursor: "pointer",
          }}
        >
          ← Back
        </button>
      </div>

      {/* Echo Interaction Area */}
      <div
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          position: "relative",
          minHeight: 0,
          touchAction: "none",
          userSelect: "none",
        }}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        {/* Background ambient particles */}
        <div style={{ position: "absolute", inset: 0, overflow: "hidden", pointerEvents: "none" }}>
          {[...Array(6)].map((_, i) => (
            <div
              key={i}
              style={{
                position: "absolute",
                left: `${15 + i * 14}%`,
                bottom: "10%",
                width: "3px",
                height: "3px",
                borderRadius: "50%",
                background: `hsl(${(dna?.baseHue || 200) + i * 20}, 60%, 60%)`,
                opacity: 0.3,
                animation: `echo-ambient-float ${4 + i * 0.7}s ease-in-out infinite`,
                animationDelay: `${i * 0.5}s`,
              }}
            />
          ))}
        </div>

        {/* Echo SVG */}
        <div style={{ transition: "transform 0.3s ease" }}>
          <EchoRenderer
            dna={dna}
            stage={stage}
            needs={needs}
            personality={personality}
            size={220}
            animated={true}
            lastInteraction={lastInteraction}
          />
        </div>

        {/* Reaction Bubble */}
        {reaction && (
          <div
            role="status"
            aria-live="polite"
            style={{
              position: "absolute",
              top: "15%",
              left: "50%",
              transform: "translateX(-50%)",
              maxWidth: "280px",
              padding: "0.6rem 1rem",
              borderRadius: "12px",
              background: reaction.type === "pet"
                ? "rgba(168, 85, 247, 0.15)"
                : reaction.type === "trick"
                ? "rgba(251, 191, 36, 0.15)"
                : "rgba(56, 189, 248, 0.12)",
              border: `1px solid ${
                reaction.type === "pet"
                  ? "rgba(168, 85, 247, 0.3)"
                  : reaction.type === "trick"
                  ? "rgba(251, 191, 36, 0.3)"
                  : "rgba(56, 189, 248, 0.2)"
              }`,
              backdropFilter: "blur(8px)",
              color: "#fff",
              fontSize: "0.8rem",
              textAlign: "center",
              animation: "echo-reaction-in 0.3s ease",
              pointerEvents: "none",
            }}
          >
            {reaction.text}
          </div>
        )}

        {/* Interaction hint */}
        <div style={{
          position: "absolute",
          bottom: "8%",
          left: "50%",
          transform: "translateX(-50%)",
          fontSize: "0.6rem",
          color: "rgba(255,255,255,0.3)",
          textAlign: "center",
          pointerEvents: "none",
        }}>
          tap · hold to pet · double-tap for tricks
        </div>
      </div>

      {/* Status Panel (bottom section) */}
      <div style={{
        padding: "0.75rem 1.25rem 1.5rem",
        background: "rgba(0,0,0,0.3)",
        borderTop: "1px solid rgba(255,255,255,0.05)",
        overflowY: "auto",
        maxHeight: "40vh",
      }}>
        {/* Needs Bars */}
        <div style={{ marginBottom: "0.75rem" }}>
          <div style={{ fontSize: "0.7rem", fontWeight: "600", color: "var(--text-muted, #94a3b8)", marginBottom: "0.4rem", textTransform: "uppercase", letterSpacing: "0.5px" }}>
            Needs
          </div>
          <div style={{ display: "grid", gap: "0.35rem" }}>
            {needsSummary.map((need) => (
              <div key={need.key} style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <span style={{ fontSize: "0.7rem", width: "1.2rem", textAlign: "center" }}>{need.emoji}</span>
                <span style={{ fontSize: "0.65rem", color: "#ccc", width: "4.5rem" }}>{need.label}</span>
                <div style={{
                  flex: 1,
                  height: "6px",
                  background: "rgba(255,255,255,0.06)",
                  borderRadius: "3px",
                  overflow: "hidden",
                }}>
                  <div style={{
                    width: `${need.value}%`,
                    height: "100%",
                    borderRadius: "3px",
                    background: need.status === "critical"
                      ? "linear-gradient(90deg, #ef4444, #f97316)"
                      : need.status === "low"
                      ? "linear-gradient(90deg, #f97316, #fbbf24)"
                      : need.status === "ok"
                      ? "linear-gradient(90deg, #38bdf8, #34d399)"
                      : "linear-gradient(90deg, #34d399, #a78bfa)",
                    transition: "width 0.5s ease",
                  }} />
                </div>
                <span style={{ fontSize: "0.6rem", color: "var(--text-muted, #94a3b8)", width: "2rem", textAlign: "right" }}>
                  {need.value}%
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Stats Row */}
        <div style={{
          display: "flex",
          gap: "0.75rem",
          marginBottom: "0.75rem",
          flexWrap: "wrap",
        }}>
          {/* Streak */}
          <div style={{
            flex: "1 1 auto",
            padding: "0.5rem 0.7rem",
            borderRadius: "8px",
            background: "rgba(255,255,255,0.03)",
            border: "1px solid rgba(255,255,255,0.06)",
            textAlign: "center",
          }}>
            <div style={{ fontSize: "1rem" }}>🔥</div>
            <div style={{ fontSize: "0.85rem", fontWeight: "700", color: "#fff" }}>{streak}</div>
            <div style={{ fontSize: "0.55rem", color: "var(--text-muted, #94a3b8)" }}>Streak</div>
          </div>

          {/* Care Days */}
          <div style={{
            flex: "1 1 auto",
            padding: "0.5rem 0.7rem",
            borderRadius: "8px",
            background: "rgba(255,255,255,0.03)",
            border: "1px solid rgba(255,255,255,0.06)",
            textAlign: "center",
          }}>
            <div style={{ fontSize: "1rem" }}>📅</div>
            <div style={{ fontSize: "0.85rem", fontWeight: "700", color: "#fff" }}>{totalCareDays}</div>
            <div style={{ fontSize: "0.55rem", color: "var(--text-muted, #94a3b8)" }}>Care Days</div>
          </div>

          {/* Stage */}
          <div style={{
            flex: "1 1 auto",
            padding: "0.5rem 0.7rem",
            borderRadius: "8px",
            background: "rgba(255,255,255,0.03)",
            border: "1px solid rgba(255,255,255,0.06)",
            textAlign: "center",
          }}>
            <div style={{ fontSize: "1rem" }}>🌊</div>
            <div style={{ fontSize: "0.85rem", fontWeight: "700", color: "#fff" }}>{STAGE_NAMES[stage]}</div>
            <div style={{ fontSize: "0.55rem", color: "var(--text-muted, #94a3b8)" }}>Stage</div>
          </div>

          {/* Personality */}
          {dominantPersonality && (
            <div style={{
              flex: "1 1 auto",
              padding: "0.5rem 0.7rem",
              borderRadius: "8px",
              background: "rgba(255,255,255,0.03)",
              border: "1px solid rgba(255,255,255,0.06)",
              textAlign: "center",
            }}>
              <div style={{ fontSize: "1rem" }}>💎</div>
              <div style={{ fontSize: "0.7rem", fontWeight: "700", color: "#fff", textTransform: "capitalize" }}>
                {dominantPersonality[0]}
              </div>
              <div style={{ fontSize: "0.55rem", color: "var(--text-muted, #94a3b8)" }}>Personality</div>
            </div>
          )}
        </div>

        {/* Tricks Section */}
        {tricksUnlocked.length > 0 && (
          <div>
            <div style={{ fontSize: "0.7rem", fontWeight: "600", color: "var(--text-muted, #94a3b8)", marginBottom: "0.3rem", textTransform: "uppercase", letterSpacing: "0.5px" }}>
              Tricks Learned
            </div>
            <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>
              {tricksUnlocked.map((trickId) => {
                const trick = TRICKS[trickId];
                if (!trick) return null;
                return (
                  <span
                    key={trickId}
                    style={{
                      fontSize: "0.6rem",
                      padding: "0.2rem 0.5rem",
                      borderRadius: "4px",
                      background: "rgba(168, 85, 247, 0.1)",
                      border: "1px solid rgba(168, 85, 247, 0.2)",
                      color: "#c4b5fd",
                    }}
                  >
                    {trick.name}
                  </span>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* CSS Animations */}
      <style>{`
        @keyframes echo-ambient-float {
          0%, 100% { transform: translateY(0) scale(1); opacity: 0.3; }
          50% { transform: translateY(-40px) scale(1.5); opacity: 0.1; }
        }
        @keyframes echo-reaction-in {
          from { opacity: 0; transform: translateX(-50%) translateY(8px) scale(0.9); }
          to { opacity: 1; transform: translateX(-50%) translateY(0) scale(1); }
        }
        @keyframes echo-trick-backflip {
          0% { transform: rotate(0deg) scale(1); }
          50% { transform: rotate(180deg) scale(1.1); }
          100% { transform: rotate(360deg) scale(1); }
        }
        .echo-trick-backflip {
          animation: echo-trick-backflip 1.2s cubic-bezier(0.34, 1.56, 0.64, 1);
        }
        @keyframes echo-trick-bubble {
          0%, 100% { transform: scale(1); filter: none; }
          30% { transform: scale(1.05); }
          50% { transform: scale(0.95); filter: drop-shadow(0 0 12px rgba(56, 189, 248, 0.6)); }
          70% { transform: scale(1.02); filter: drop-shadow(0 0 8px rgba(56, 189, 248, 0.3)); }
        }
        .echo-trick-bubble {
          animation: echo-trick-bubble 1.5s ease;
        }
        @keyframes echo-trick-dash {
          0% { transform: translateX(0) scaleX(1); }
          30% { transform: translateX(60px) scaleX(1.3); }
          50% { transform: translateX(80px) scaleX(0.8); opacity: 0.5; }
          70% { transform: translateX(-20px) scaleX(1.1); }
          100% { transform: translateX(0) scaleX(1); opacity: 1; }
        }
        .echo-trick-dash {
          animation: echo-trick-dash 0.8s cubic-bezier(0.22, 1, 0.36, 1);
        }
        @keyframes echo-trick-glow {
          0%, 100% { filter: none; }
          25% { filter: drop-shadow(0 0 20px rgba(168, 85, 247, 0.8)) brightness(1.3); }
          50% { filter: drop-shadow(0 0 30px rgba(56, 189, 248, 0.9)) brightness(1.5); }
          75% { filter: drop-shadow(0 0 20px rgba(251, 191, 36, 0.8)) brightness(1.3); }
        }
        .echo-trick-glow {
          animation: echo-trick-glow 2s ease;
        }
        @keyframes echo-trick-mirror {
          0%, 100% { transform: scaleX(1); }
          25% { transform: scaleX(-1) translateX(30px); }
          50% { transform: scaleX(1) translateX(-30px); }
          75% { transform: scaleX(-1) translateX(15px); }
        }
        .echo-trick-mirror {
          animation: echo-trick-mirror 2.5s ease-in-out;
        }
        @keyframes echo-trick-galaxy {
          0%, 100% { filter: none; transform: scale(1); }
          30% { filter: drop-shadow(0 0 15px rgba(99, 102, 241, 0.8)) saturate(2); transform: scale(1.15); }
          60% { filter: drop-shadow(0 0 25px rgba(168, 85, 247, 1)) saturate(3) hue-rotate(30deg); transform: scale(1.2); }
          80% { filter: drop-shadow(0 0 20px rgba(56, 189, 248, 0.9)) saturate(2); transform: scale(1.1); }
        }
        .echo-trick-galaxy {
          animation: echo-trick-galaxy 3s ease;
        }
      `}</style>
    </div>
  );
}

export default EchoLivingCompanion;
