/**
 * EchoCompanionWidget.jsx
 * 
 * Persistent dashboard card showing Echo's current state:
 *   - Avatar (tier-appropriate art)
 *   - Mood indicator + poetic one-liner
 *   - Care streak (fire emoji + count)
 *   - Next evolution progress bar
 *   - Tap-to-expand: recent Echo reactions
 * 
 * Props:
 *   - casualModeActive {boolean}
 *   - compact {boolean}
 */

import React, { useState, useEffect, useMemo } from "react";
import { db } from "../db";
import { useAuth } from "../contexts/AuthContext";
import { getTierInfo, getPointsSuffix, TIER_LADDER } from "../utils/xp";
import { getCurrentMood, getMoodLine, getEchoGreeting, getHoursSinceLastAction } from "../utils/echoMood";

// ─────────────────────────────────────────────────────────────────────────────
// Tier Art Mapping
// ─────────────────────────────────────────────────────────────────────────────

const TIER_AVATARS = {
  Shallow: "/echo-fry.jpg",
  Coastal: "/echo-silver.jpg",
  Pelagic: "/echo-mid.jpg",
  Abyssal: "/echo-evolved.jpg",
  Hadal: "/echo-evolved.jpg",
  "Hadal-Champion": "/echo-evolved.jpg",
};

const TIER_BORDER_COLORS = {
  Shallow: "rgba(148, 163, 184, 0.3)",
  Coastal: "rgba(56, 189, 248, 0.4)",
  Pelagic: "rgba(251, 191, 36, 0.4)",
  Abyssal: "rgba(168, 85, 247, 0.5)",
  Hadal: "rgba(245, 158, 11, 0.5)",
  "Hadal-Champion": "rgba(245, 158, 11, 0.6)",
};

const TIER_GLOW_COLORS = {
  Shallow: "none",
  Coastal: "0 0 12px rgba(56, 189, 248, 0.2)",
  Pelagic: "0 0 16px rgba(251, 191, 36, 0.25)",
  Abyssal: "0 0 20px rgba(168, 85, 247, 0.3)",
  Hadal: "0 0 24px rgba(245, 158, 11, 0.35)",
  "Hadal-Champion": "0 0 28px rgba(245, 158, 11, 0.4)",
};

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export function EchoCompanionWidget({ casualModeActive = true, compact = false }) {
  const { account } = useAuth();
  const [echoState, setEchoState] = useState({
    totalXp: 0,
    currentTier: "Shallow",
    streakDays: 0,
    lastActiveDate: null,
    eggState: 0,
  });
  const [actionsToday, setActionsToday] = useState(0);
  const [recentReactions, setRecentReactions] = useState([]);
  const [expanded, setExpanded] = useState(false);
  const [greeting, setGreeting] = useState("");

  // Load Echo's state from Dexie
  useEffect(() => {
    if (!account) return;

    const loadState = async () => {
      try {
        const profile = await db.userProfile.get(account);
        const companion = await db.breederCompanion.get(account);

        if (profile) {
          setEchoState({
            totalXp: profile.totalXp || 0,
            currentTier: profile.currentTier || "Shallow",
            streakDays: profile.streakDays || 0,
            lastActiveDate: profile.lastActiveDate || null,
            eggState: companion?.eggState || 0,
          });
        }

        // Count today's actions
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        const todayTimestamp = Math.floor(todayStart.getTime() / 1000);

        const todayLogs = await db.actionLogs
          .where("timestamp")
          .aboveOrEqual(todayTimestamp)
          .count();

        setActionsToday(todayLogs);
      } catch (err) {
        console.warn("EchoCompanionWidget: Failed to load state:", err);
      }
    };

    loadState();

    // Listen for XP events to refresh state
    const handleXpEvent = () => loadState();
    window.addEventListener("aquadex_xp_added", handleXpEvent);
    return () => window.removeEventListener("aquadex_xp_added", handleXpEvent);
  }, [account]);

  // Generate greeting once per mount
  useEffect(() => {
    const hoursSince = getHoursSinceLastAction(echoState.lastActiveDate);
    setGreeting(getEchoGreeting({ streakDays: echoState.streakDays, hoursSinceLastAction: hoursSince }));
  }, [echoState.lastActiveDate, echoState.streakDays]);

  // Listen for action reactions
  useEffect(() => {
    const handleReaction = (e) => {
      const { actionLabel, points } = e.detail || {};
      if (actionLabel) {
        setRecentReactions((prev) => [
          { text: actionLabel, points, time: Date.now() },
          ...prev.slice(0, 4),
        ]);
      }
    };
    window.addEventListener("aquadex_xp_added", handleReaction);
    return () => window.removeEventListener("aquadex_xp_added", handleReaction);
  }, []);

  // Derive mood
  const mood = useMemo(() => {
    const hoursSince = getHoursSinceLastAction(echoState.lastActiveDate);
    return getCurrentMood({
      streakDays: echoState.streakDays,
      hoursSinceLastAction: hoursSince,
      actionsToday,
      justLeveledUp: false,
    });
  }, [echoState.streakDays, echoState.lastActiveDate, actionsToday]);

  const moodLine = useMemo(() => getMoodLine(mood.key), [mood.key]);

  // Tier progress
  const tierInfo = getTierInfo(echoState.totalXp);
  const tier = echoState.currentTier || "Shallow";
  const suffix = getPointsSuffix(casualModeActive);

  // If Echo hasn't hatched yet, show egg state
  if (echoState.eggState === 0 && echoState.totalXp < 500) {
    return (
      <div
        className="glass-card"
        style={{
          padding: compact ? "0.75rem" : "1rem 1.25rem",
          borderRadius: "var(--radius-sm)",
          border: "1px solid rgba(56, 189, 248, 0.08)",
          background: "rgba(56, 189, 248, 0.02)",
          textAlign: "center",
        }}
      >
        <span style={{ fontSize: "1.5rem", display: "block", marginBottom: "0.3rem" }}>🥚</span>
        <div style={{ fontSize: "0.75rem", fontWeight: "700", color: "#fff", marginBottom: "0.2rem" }}>
          Echo is waiting...
        </div>
        <div style={{ fontSize: "0.65rem", color: "var(--text-muted)", lineHeight: "1.4" }}>
          Keep logging care activities. At 500 {suffix}, something will hatch.
        </div>
        <div style={{
          marginTop: "0.5rem",
          height: "4px",
          background: "rgba(255,255,255,0.06)",
          borderRadius: "2px",
          overflow: "hidden",
        }}>
          <div style={{
            width: `${Math.min(100, (echoState.totalXp / 500) * 100)}%`,
            height: "100%",
            background: "linear-gradient(90deg, #38bdf8, #a78bfa)",
            borderRadius: "2px",
            transition: "width 0.5s ease",
          }} />
        </div>
      </div>
    );
  }

  return (
    <div
      className="glass-card"
      style={{
        padding: compact ? "0.75rem" : "1rem 1.25rem",
        borderRadius: "var(--radius-sm)",
        border: `1px solid ${TIER_BORDER_COLORS[tier] || "rgba(56, 189, 248, 0.1)"}`,
        background: "rgba(6, 182, 212, 0.02)",
        cursor: "pointer",
        transition: "all 0.2s ease",
      }}
      onClick={() => setExpanded(!expanded)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === "Enter" && setExpanded(!expanded)}
      aria-expanded={expanded}
      aria-label="Echo companion status"
    >
      {/* Header: Avatar + Mood + Streak */}
      <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
        {/* Echo Avatar */}
        <div style={{ position: "relative", flexShrink: 0 }}>
          <img
            src={TIER_AVATARS[tier] || "/echo-fry.jpg"}
            alt={`Echo — ${tier}`}
            style={{
              width: compact ? "36px" : "44px",
              height: compact ? "36px" : "44px",
              borderRadius: "50%",
              objectFit: "cover",
              border: `2px solid ${TIER_BORDER_COLORS[tier]}`,
              boxShadow: TIER_GLOW_COLORS[tier],
            }}
          />
          {/* Mood indicator dot */}
          <span style={{
            position: "absolute",
            bottom: "-1px",
            right: "-1px",
            fontSize: "0.7rem",
            background: "rgba(10, 10, 20, 0.9)",
            borderRadius: "50%",
            padding: "1px",
            lineHeight: 1,
          }}>
            {mood.emoji}
          </span>
        </div>

        {/* Text content */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: "0.78rem", fontWeight: "700", color: "#fff" }}>
              Echo
            </span>
            {/* Streak badge */}
            {echoState.streakDays > 0 && (
              <span style={{
                fontSize: "0.6rem",
                padding: "0.1rem 0.4rem",
                borderRadius: "50px",
                background: echoState.streakDays >= 7
                  ? "rgba(251, 191, 36, 0.12)"
                  : "rgba(255,255,255,0.04)",
                border: echoState.streakDays >= 7
                  ? "1px solid rgba(251, 191, 36, 0.2)"
                  : "1px solid rgba(255,255,255,0.08)",
                color: echoState.streakDays >= 7 ? "#fbbf24" : "var(--text-muted)",
                fontWeight: "600",
              }}>
                🔥 {echoState.streakDays}d
              </span>
            )}
          </div>

          {/* Mood line */}
          <p style={{
            margin: "0.15rem 0 0",
            fontSize: "0.65rem",
            color: mood.color,
            lineHeight: "1.4",
            fontStyle: "italic",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: expanded ? "normal" : "nowrap",
          }}>
            {greeting || moodLine}
          </p>
        </div>
      </div>

      {/* Progress bar to next tier */}
      {tierInfo.nextLevelXp && (
        <div style={{ marginTop: "0.5rem" }}>
          <div style={{
            display: "flex",
            justifyContent: "space-between",
            fontSize: "0.55rem",
            color: "var(--text-muted)",
            marginBottom: "0.2rem",
          }}>
            <span>{casualModeActive ? tierInfo.hobbyistLabel : tierInfo.breederLabel}</span>
            <span>{echoState.totalXp.toLocaleString()} / {tierInfo.nextLevelXp.toLocaleString()} {suffix}</span>
          </div>
          <div style={{
            height: "3px",
            background: "rgba(255,255,255,0.06)",
            borderRadius: "2px",
            overflow: "hidden",
          }}>
            <div style={{
              width: `${tierInfo.progressPct}%`,
              height: "100%",
              background: `linear-gradient(90deg, ${mood.color}, ${mood.color}88)`,
              borderRadius: "2px",
              transition: "width 0.5s ease",
            }} />
          </div>
        </div>
      )}

      {/* Expanded: Recent reactions */}
      {expanded && (
        <div style={{ marginTop: "0.6rem", borderTop: "1px solid rgba(255,255,255,0.05)", paddingTop: "0.5rem" }}>
          <div style={{ fontSize: "0.55rem", color: "var(--text-muted)", fontWeight: "600", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "0.3rem" }}>
            Recent Activity
          </div>
          {recentReactions.length > 0 ? (
            recentReactions.map((reaction, i) => (
              <div key={i} style={{
                display: "flex",
                justifyContent: "space-between",
                fontSize: "0.62rem",
                color: "var(--text-secondary)",
                padding: "0.15rem 0",
              }}>
                <span>{reaction.text}</span>
                <span style={{ color: "var(--accent-green)", fontFamily: "monospace" }}>
                  +{reaction.points} {suffix}
                </span>
              </div>
            ))
          ) : (
            <div style={{ fontSize: "0.62rem", color: "var(--text-muted)", fontStyle: "italic" }}>
              No activity yet today. Log a feeding or water test to see Echo react.
            </div>
          )}

          {/* Mood explanation */}
          <div style={{
            marginTop: "0.4rem",
            padding: "0.35rem 0.5rem",
            borderRadius: "6px",
            background: `${mood.color}08`,
            border: `1px solid ${mood.color}15`,
            fontSize: "0.6rem",
            color: mood.color,
            fontStyle: "italic",
          }}>
            {moodLine}
          </div>
        </div>
      )}
    </div>
  );
}

export default EchoCompanionWidget;
