/**
 * EchoWhispers.jsx
 * 
 * Proactive nudge system — contextual micro-prompts that appear as
 * a floating speech bubble from Echo. Timer/state-based, no AI calls.
 * 
 * Triggers:
 *   - On app open (after 3s idle on dashboard)
 *   - After action logged (contextual follow-up)
 *   - When idle for 10s on tank detail
 * 
 * Whisper types:
 *   - Care reminders ("It's been 3 days since water change...")
 *   - Progress nudges ("You're 120 pts from Gold...")
 *   - Social nudges ("A new breeder joined your zone...")
 *   - Streak encouragement ("One more day and you hit 7-day streak!")
 * 
 * Auto-dismisses after 8s or on click. Max 1 whisper per 2 minutes.
 * 
 * Props:
 *   - casualModeActive {boolean}
 *   - userState {{ totalXp, streakDays, lastActiveDate, currentTier }}
 *   - tankData {{ lastWaterChange, lastFeeding, lastParams, tankCount }}
 */

import React, { useState, useEffect, useCallback, useRef } from "react";
import { getTierInfo, TIER_LADDER } from "../utils/xp";
import { getActionReaction } from "../utils/echoMood";

// ─────────────────────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────────────────────

const WHISPER_DISPLAY_MS = 8000;      // Auto-dismiss after 8s
const WHISPER_COOLDOWN_MS = 120000;   // Min 2 minutes between whispers
const INITIAL_DELAY_MS = 3000;        // Wait 3s after mount before first whisper
const ACTION_REACTION_DELAY_MS = 1500; // Wait 1.5s after action for reaction whisper

// ─────────────────────────────────────────────────────────────────────────────
// Whisper Generator
// ─────────────────────────────────────────────────────────────────────────────

function generateWhisper(userState, tankData, casualModeActive) {
  const { totalXp = 0, streakDays = 0, lastActiveDate, currentTier } = userState || {};
  const { lastWaterChange, lastFeeding, lastParams, tankCount = 0 } = tankData || {};
  const suffix = casualModeActive ? "pts" : "XP";

  const now = Date.now();
  const candidates = [];

  // ─── Care reminders ─────────────────────────────────────────────────
  if (lastWaterChange) {
    const daysSinceWater = Math.floor((now - new Date(lastWaterChange).getTime()) / (1000 * 60 * 60 * 24));
    if (daysSinceWater >= 3) {
      candidates.push({
        priority: 3,
        text: daysSinceWater >= 7
          ? `It's been ${daysSinceWater} days since the last water change. Your fish would appreciate one.`
          : `${daysSinceWater} days since your last water change. Good time for a refresh?`,
        icon: "💧",
      });
    }
  }

  if (lastFeeding) {
    const hoursSinceFeeding = Math.floor((now - new Date(lastFeeding).getTime()) / (1000 * 60 * 60));
    if (hoursSinceFeeding >= 36) {
      candidates.push({
        priority: 2,
        text: "Your fish haven't been fed in a while. A quick log goes a long way.",
        icon: "🍽️",
      });
    }
  }

  if (lastParams) {
    const daysSinceParams = Math.floor((now - new Date(lastParams).getTime()) / (1000 * 60 * 60 * 24));
    if (daysSinceParams >= 5) {
      candidates.push({
        priority: 1,
        text: `It's been ${daysSinceParams} days since parameters were checked. A quick test keeps everyone safe.`,
        icon: "🧪",
      });
    }
  }

  // ─── Progress nudges ────────────────────────────────────────────────
  const tierInfo = getTierInfo(totalXp);
  if (tierInfo.nextLevelXp) {
    const ptsToNext = tierInfo.nextLevelXp - totalXp;
    if (ptsToNext <= 200 && ptsToNext > 0) {
      const nextTier = TIER_LADDER.find((t) => t.min === tierInfo.nextLevelXp);
      const nextLabel = casualModeActive
        ? (nextTier?.hobbyistLabel || "next tier")
        : (nextTier?.breederLabel || "next tier");
      candidates.push({
        priority: 2,
        text: `You're only ${ptsToNext} ${suffix} from ${nextLabel}. So close.`,
        icon: "🌟",
      });
    }
  }

  // ─── Streak encouragement ──────────────────────────────────────────
  if (streakDays === 6) {
    candidates.push({
      priority: 3,
      text: "One more day and you hit a 7-day streak! That unlocks the 1.5x bonus.",
      icon: "🔥",
    });
  } else if (streakDays >= 7 && streakDays % 7 === 0) {
    candidates.push({
      priority: 1,
      text: `${streakDays} days of consistent care. Echo shimmers with pride.`,
      icon: "✨",
    });
  } else if (streakDays >= 3 && streakDays < 7) {
    candidates.push({
      priority: 0,
      text: `${streakDays}-day streak and counting. Keep it going.`,
      icon: "🔥",
    });
  }

  // ─── New user encouragement ────────────────────────────────────────
  if (totalXp < 100 && tankCount >= 1) {
    candidates.push({
      priority: 1,
      text: casualModeActive
        ? "Try logging a feeding or water change. Each care action earns points and helps Echo grow."
        : "Log operational metrics to accumulate reputation. Each action synchronizes with the leaderboard.",
      icon: "💡",
    });
  }

  // ─── Return the highest priority whisper (with some randomness) ────
  if (candidates.length === 0) return null;

  // Sort by priority (highest first), then pick randomly from top tier
  candidates.sort((a, b) => b.priority - a.priority);
  const topPriority = candidates[0].priority;
  const topCandidates = candidates.filter((c) => c.priority === topPriority);
  return topCandidates[Math.floor(Math.random() * topCandidates.length)];
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export function EchoWhispers({ casualModeActive = true, userState, tankData }) {
  const [whisper, setWhisper] = useState(null);
  const [visible, setVisible] = useState(false);
  const [animatingOut, setAnimatingOut] = useState(false);
  const lastWhisperTime = useRef(0);
  const dismissTimer = useRef(null);

  // Dismiss function
  const dismiss = useCallback(() => {
    setAnimatingOut(true);
    setTimeout(() => {
      setWhisper(null);
      setVisible(false);
      setAnimatingOut(false);
    }, 300);
  }, []);

  // Show a whisper with auto-dismiss
  const showWhisper = useCallback((w) => {
    if (!w) return;
    const now = Date.now();
    if (now - lastWhisperTime.current < WHISPER_COOLDOWN_MS) return;

    lastWhisperTime.current = now;
    setWhisper(w);
    setVisible(true);
    setAnimatingOut(false);

    if (dismissTimer.current) clearTimeout(dismissTimer.current);
    dismissTimer.current = setTimeout(dismiss, WHISPER_DISPLAY_MS);
  }, [dismiss]);

  // Initial whisper on mount (after delay)
  useEffect(() => {
    const timer = setTimeout(() => {
      const w = generateWhisper(userState, tankData, casualModeActive);
      showWhisper(w);
    }, INITIAL_DELAY_MS);

    return () => clearTimeout(timer);
  }, []); // Only on mount

  // Action reaction whispers
  useEffect(() => {
    const handleAction = (e) => {
      const { actionLabel, points } = e.detail || {};
      if (!actionLabel) return;

      // Map common action labels to reaction keys
      let reactionKey = null;
      const label = (actionLabel || "").toLowerCase();
      if (label.includes("feed")) reactionKey = "LOG_FEEDING";
      else if (label.includes("water change")) reactionKey = "LOG_WATER";
      else if (label.includes("water") || label.includes("param")) reactionKey = "LOG_PARAMETERS";
      else if (label.includes("tank")) reactionKey = "REGISTER_TANK";
      else if (label.includes("mint") || label.includes("birth")) reactionKey = "MINT_SPECIMEN";
      else if (label.includes("spawn") || label.includes("breed")) reactionKey = "SPAWN_BREED";

      if (reactionKey) {
        const reaction = getActionReaction(reactionKey);
        if (reaction) {
          setTimeout(() => {
            showWhisper({ text: reaction, icon: "🐠" });
          }, ACTION_REACTION_DELAY_MS);
        }
      }
    };

    window.addEventListener("aquadex_xp_added", handleAction);
    return () => window.removeEventListener("aquadex_xp_added", handleAction);
  }, [showWhisper]);

  // Cleanup
  useEffect(() => {
    return () => {
      if (dismissTimer.current) clearTimeout(dismissTimer.current);
    };
  }, []);

  if (!visible || !whisper) return null;

  return (
    <div
      className="echo-whisper"
      onClick={dismiss}
      onKeyDown={(e) => (e.key === "Escape" || e.key === "Enter") && dismiss()}
      role="status"
      aria-live="polite"
      aria-label="Echo whisper notification — click or press Escape to dismiss"
      tabIndex={0}
      style={{
        position: "fixed",
        bottom: "5.5rem",
        left: "2rem",
        maxWidth: "320px",
        padding: "0.75rem 1rem",
        borderRadius: "12px 12px 12px 4px",
        background: "rgba(10, 15, 30, 0.92)",
        border: "1px solid rgba(56, 189, 248, 0.15)",
        backdropFilter: "blur(12px)",
        boxShadow: "0 8px 32px rgba(0, 0, 0, 0.4), 0 0 12px rgba(56, 189, 248, 0.08)",
        cursor: "pointer",
        zIndex: 9000,
        display: "flex",
        alignItems: "flex-start",
        gap: "0.6rem",
        opacity: animatingOut ? 0 : 1,
        transform: animatingOut ? "translateY(8px) scale(0.95)" : "translateY(0) scale(1)",
        transition: "opacity 0.3s ease, transform 0.3s ease",
        animation: !animatingOut ? "echo-whisper-in 0.4s cubic-bezier(0.16, 1, 0.3, 1)" : "none",
      }}
    >
      {/* Echo avatar mini */}
      <div style={{
        width: "28px",
        height: "28px",
        borderRadius: "50%",
        background: "rgba(56, 189, 248, 0.1)",
        border: "1.5px solid rgba(56, 189, 248, 0.25)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: "0.85rem",
        flexShrink: 0,
      }}>
        {whisper.icon || "🐠"}
      </div>

      {/* Whisper text */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: "0.72rem",
          color: "#fff",
          lineHeight: "1.45",
          fontStyle: "italic",
        }}>
          {whisper.text}
        </div>
        <div style={{
          fontSize: "0.55rem",
          color: "var(--text-muted)",
          marginTop: "0.25rem",
        }}>
          Echo · tap to dismiss
        </div>
      </div>

      {/* CSS animation keyframe (injected once) */}
      <style>{`
        @keyframes echo-whisper-in {
          0% { opacity: 0; transform: translateY(16px) scale(0.9); }
          100% { opacity: 1; transform: translateY(0) scale(1); }
        }
      `}</style>
    </div>
  );
}

export default EchoWhispers;
