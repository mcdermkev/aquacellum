/**
 * ChallengeCard.jsx
 * 
 * Displays a school challenge with progress, time remaining, and leaderboard.
 */

import React from "react";

const CHALLENGE_TYPE_INFO = {
  breeding_sprint: { emoji: "🧬", label: "Breeding Sprint", color: "#a78bfa" },
  growout_race: { emoji: "📈", label: "Grow-Out Race", color: "#34d399" },
  photo_contest: { emoji: "📷", label: "Photo Contest", color: "#f472b6" },
  care_streak: { emoji: "🔥", label: "Care Streak", color: "#fbbf24" },
};

const STATUS_STYLES = {
  upcoming: { bg: "rgba(56, 189, 248, 0.08)", border: "rgba(56, 189, 248, 0.2)", label: "Upcoming", color: "var(--accent-blue)" },
  active: { bg: "rgba(52, 211, 153, 0.08)", border: "rgba(52, 211, 153, 0.2)", label: "Active", color: "var(--accent-green)" },
  completed: { bg: "rgba(255,255,255,0.03)", border: "rgba(255,255,255,0.08)", label: "Completed", color: "var(--text-muted)" },
  cancelled: { bg: "rgba(248, 113, 113, 0.05)", border: "rgba(248, 113, 113, 0.15)", label: "Cancelled", color: "var(--accent-red)" },
};

export function ChallengeCard({ challenge }) {
  const typeInfo = CHALLENGE_TYPE_INFO[challenge.challenge_type] || { emoji: "🏆", label: "Challenge", color: "#fff" };
  const statusStyle = STATUS_STYLES[challenge.status] || STATUS_STYLES.upcoming;

  const now = new Date();
  const start = new Date(challenge.start_time);
  const end = new Date(challenge.end_time);

  const getTimeRemaining = () => {
    if (challenge.status === "completed" || challenge.status === "cancelled") return null;

    const target = challenge.status === "upcoming" ? start : end;
    const diff = target - now;

    if (diff <= 0) return challenge.status === "upcoming" ? "Starting soon" : "Ending soon";

    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));

    if (days > 0) return `${days}d ${hours}h remaining`;
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    return `${hours}h ${minutes}m remaining`;
  };

  const getProgress = () => {
    if (challenge.status !== "active") return 0;
    const total = end - start;
    const elapsed = now - start;
    return Math.min(100, Math.max(0, (elapsed / total) * 100));
  };

  const timeRemaining = getTimeRemaining();
  const progress = getProgress();
  const leaderboard = challenge.leaderboard || [];

  return (
    <div
      className="glass-card challenge-card"
      style={{
        padding: "1rem 1.25rem",
        borderRadius: "var(--radius-sm)",
        border: `1px solid ${statusStyle.border}`,
        background: statusStyle.bg,
      }}
    >
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "0.75rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <span style={{ fontSize: "1.3rem" }}>{typeInfo.emoji}</span>
          <div>
            <h4 style={{ margin: 0, fontSize: "0.9rem", color: "#fff", fontWeight: "600" }}>
              {challenge.title}
            </h4>
            <span style={{ fontSize: "0.65rem", color: typeInfo.color }}>
              {typeInfo.label}
            </span>
          </div>
        </div>

        <span style={{
          padding: "0.2rem 0.6rem",
          borderRadius: "50px",
          background: "rgba(0,0,0,0.3)",
          fontSize: "0.6rem",
          color: statusStyle.color,
          fontWeight: "600",
        }}>
          {statusStyle.label}
        </span>
      </div>

      {/* Description */}
      {challenge.description && (
        <p style={{ margin: "0 0 0.75rem", fontSize: "0.75rem", color: "var(--text-secondary)", lineHeight: "1.4" }}>
          {challenge.description}
        </p>
      )}

      {/* Progress Bar (active only) */}
      {challenge.status === "active" && (
        <div style={{ marginBottom: "0.75rem" }}>
          <div style={{
            height: "4px",
            background: "rgba(255,255,255,0.06)",
            borderRadius: "2px",
            overflow: "hidden",
          }}>
            <div style={{
              width: `${progress}%`,
              height: "100%",
              background: `linear-gradient(90deg, ${typeInfo.color}, ${typeInfo.color}88)`,
              borderRadius: "2px",
              transition: "width 0.5s ease",
            }} />
          </div>
        </div>
      )}

      {/* Time + Reward */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: leaderboard.length > 0 ? "0.75rem" : 0 }}>
        {timeRemaining && (
          <span style={{ fontSize: "0.7rem", color: "var(--text-muted)" }}>
            ⏱ {timeRemaining}
          </span>
        )}
        <span style={{ fontSize: "0.7rem", color: "var(--accent-amber)" }}>
          🏆 {challenge.reward_xp} XP
          {challenge.reward_badge && ` + ${challenge.reward_badge}`}
        </span>
      </div>

      {/* Leaderboard (top 3) */}
      {leaderboard.length > 0 && (
        <div style={{
          marginTop: "0.5rem",
          padding: "0.5rem 0.75rem",
          background: "rgba(0,0,0,0.15)",
          borderRadius: "var(--radius-sm)",
        }}>
          <div style={{ fontSize: "0.6rem", color: "var(--text-muted)", marginBottom: "0.4rem", fontWeight: "600" }}>
            LEADERBOARD
          </div>
          {leaderboard.slice(0, 3).map((entry, i) => (
            <div key={i} style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "0.2rem 0",
              fontSize: "0.7rem",
            }}>
              <span style={{ color: i === 0 ? "var(--accent-amber)" : "#fff" }}>
                {i === 0 ? "🥇" : i === 1 ? "🥈" : "🥉"} {entry.wallet?.slice(0, 6)}...{entry.wallet?.slice(-4)}
              </span>
              <span style={{ color: "var(--text-secondary)", fontFamily: "monospace" }}>
                {entry.score}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
