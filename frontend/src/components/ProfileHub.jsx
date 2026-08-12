import React, { useEffect, useState } from "react";
import { getTierLabel } from "../utils/xp";
import {
  STARTER_QUEST_ITEMS,
  getStarterQuestState,
  dismissStarterQuest,
  QUEST_UPDATED_EVENT,
} from "../utils/starterQuest";

/**
 * StarterQuest — first-run activation checklist rendered at the top of the hub.
 *
 * Reads its state from the starterQuest util (localStorage-backed) and re-reads
 * whenever a step is recorded (QUEST_UPDATED_EVENT) or the tab regains focus.
 * Steps are marked complete by real signals wired in App.jsx; tapping an
 * unfinished step just routes the keeper to where they can complete it.
 */
function StarterQuest({ onNavigate }) {
  const [quest, setQuest] = useState(() => getStarterQuestState());

  useEffect(() => {
    const refresh = () => setQuest(getStarterQuestState());
    window.addEventListener(QUEST_UPDATED_EVENT, refresh);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    // Re-read on mount too, in case steps were recorded on another tab.
    refresh();
    return () => {
      window.removeEventListener(QUEST_UPDATED_EVENT, refresh);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);

  // Once finished and dismissed, the card disappears for good.
  if (quest.allDone && quest.dismissed) return null;

  const pct = Math.round((quest.completedCount / quest.total) * 100);

  return (
    <div
      className="glass-card"
      style={{
        padding: "1.1rem 1.25rem",
        borderRadius: "16px",
        display: "flex",
        flexDirection: "column",
        gap: "0.9rem",
        border: quest.allDone ? "1px solid rgba(56,189,248,0.4)" : "1px solid rgba(255,255,255,0.08)",
        background: quest.allDone
          ? "linear-gradient(135deg, rgba(56,189,248,0.14), rgba(16,185,129,0.08))"
          : "rgba(255,255,255,0.02)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.75rem" }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: "0.95rem", fontWeight: 700, color: "#fff", display: "flex", alignItems: "center", gap: "0.4rem" }}>
            {quest.allDone ? "🎉 Quest complete" : "🧭 Starter Quest"}
          </div>
          <div style={{ fontSize: "0.72rem", color: "var(--text-muted)", marginTop: 2 }}>
            {quest.allDone
              ? "You've found your way around Aquadex. Nice work."
              : "A few steps to get your reef going."}
          </div>
        </div>
        <span style={{ fontSize: "0.72rem", fontWeight: 700, color: quest.allDone ? "#38bdf8" : "var(--text-secondary)", whiteSpace: "nowrap" }}>
          {quest.completedCount}/{quest.total}
        </span>
      </div>

      {/* Progress bar */}
      <div style={{ height: 6, borderRadius: 999, background: "rgba(255,255,255,0.06)", overflow: "hidden" }}>
        <div
          style={{
            width: `${pct}%`,
            height: "100%",
            borderRadius: 999,
            background: "linear-gradient(90deg, #38bdf8, #10b981)",
            transition: "width 0.4s ease",
          }}
        />
      </div>

      {/* Steps */}
      <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
        {STARTER_QUEST_ITEMS.map((item) => {
          const done = quest.steps[item.id];
          return (
            <button
              key={item.id}
              type="button"
              disabled={done}
              onClick={() => !done && onNavigate && onNavigate(item.tab)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.7rem",
                textAlign: "left",
                padding: "0.55rem 0.6rem",
                borderRadius: "10px",
                border: "1px solid transparent",
                background: done ? "transparent" : "rgba(255,255,255,0.03)",
                cursor: done ? "default" : "pointer",
                opacity: done ? 0.6 : 1,
                width: "100%",
              }}
            >
              <span
                aria-hidden="true"
                style={{
                  width: 22,
                  height: 22,
                  flexShrink: 0,
                  borderRadius: "50%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "0.7rem",
                  border: done ? "none" : "1.5px solid rgba(255,255,255,0.2)",
                  background: done ? "#10b981" : "transparent",
                  color: "#fff",
                }}
              >
                {done ? "✓" : item.icon}
              </span>
              <span style={{ minWidth: 0, flex: 1 }}>
                <span
                  style={{
                    display: "block",
                    fontSize: "0.83rem",
                    fontWeight: 600,
                    color: "#fff",
                    textDecoration: done ? "line-through" : "none",
                  }}
                >
                  {item.label}
                </span>
                {!done && (
                  <span style={{ display: "block", fontSize: "0.68rem", color: "var(--text-muted)" }}>{item.hint}</span>
                )}
              </span>
              {!done && <span style={{ fontSize: "0.9rem", color: "var(--text-muted)", flexShrink: 0 }}>›</span>}
            </button>
          );
        })}
      </div>

      {quest.allDone && (
        <button
          type="button"
          onClick={dismissStarterQuest}
          style={{
            alignSelf: "flex-end",
            padding: "0.4rem 0.9rem",
            borderRadius: "999px",
            cursor: "pointer",
            border: "1px solid rgba(255,255,255,0.15)",
            background: "rgba(255,255,255,0.04)",
            color: "var(--text-secondary)",
            fontSize: "0.75rem",
            fontWeight: 600,
          }}
        >
          Dismiss
        </button>
      )}
    </div>
  );
}

/**
 * ProfileHub — the "Profile" destination for Casual mode's bottom nav.
 *
 * Consolidates the account surfaces that came off the primary bar (My Orders,
 * Settings, Seller Hub, Founders) into one hub, topped with the keeper's
 * level / XP / species summary. This is also the natural future home for the
 * Starter Quest activation checklist.
 *
 * Purely presentational — all data + navigation is threaded from App.jsx.
 */
export function ProfileHub({
  account,
  levelInfo,
  xp = 0,
  speciesCount = 0,
  isFounder = false,
  isStorefrontBeta = false,
  onNavigate,
  onSwitchToPro,
}) {
  const title = levelInfo ? getTierLabel(levelInfo, true) : "Aquarist";
  const level = levelInfo?.level ?? 1;
  const pct = Math.round(levelInfo?.progressPct || 0);
  const nextLevelXp = levelInfo?.nextLevelXp;
  const shortAddr = account ? `${account.slice(0, 6)}…${account.slice(-4)}` : "";
  const accentHex = levelInfo?.colorHex || "#38bdf8";

  const links = [
    { id: "orders", icon: "📦", label: "My Orders", desc: "Purchases, sales & pickups", show: true },
    { id: "breeder-terminal", icon: "🧑‍🌾", label: "Seller Hub", desc: "List fish & manage payouts", show: isStorefrontBeta },
    { id: "settings", icon: "⚙️", label: "Settings", desc: "Account, privacy & backup", show: true },
    { id: "founders", icon: "📊", label: "Founders", desc: "Founder dashboard", show: isFounder },
  ].filter((l) => l.show);

  return (
    <div className="profile-hub" style={{ display: "flex", flexDirection: "column", gap: "1rem", maxWidth: 640, margin: "0 auto" }}>
      {/* First-run activation checklist */}
      <StarterQuest onNavigate={onNavigate} />

      {/* Identity + level */}
      <div className="glass-card" style={{ padding: "1.25rem", borderRadius: "16px", display: "flex", flexDirection: "column", gap: "1rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.9rem" }}>
          <div
            aria-hidden="true"
            style={{
              width: 56, height: 56, borderRadius: "50%", flexShrink: 0,
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: "1.6rem",
              background: `radial-gradient(circle at 30% 30%, ${accentHex}33, rgba(10,14,26,0.9))`,
              border: `1px solid ${accentHex}55`,
              boxShadow: `0 0 18px ${accentHex}33`,
            }}
          >
            🐠
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: "1rem", fontWeight: 700, color: "#fff" }}>
              {levelInfo?.icon ? `${levelInfo.icon} ` : ""}Lvl {level} · {title}
            </div>
            {shortAddr && (
              <div style={{ fontSize: "0.72rem", color: "var(--text-muted)", fontFamily: "monospace", marginTop: 2 }}>
                {shortAddr}
              </div>
            )}
          </div>
        </div>

        {/* XP progress */}
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.68rem", color: "var(--text-muted)", marginBottom: 4 }}>
            <span>{xp.toLocaleString()} pts</span>
            <span>{nextLevelXp ? `${nextLevelXp.toLocaleString()} to next` : "Max level"}</span>
          </div>
          <div style={{ height: 8, borderRadius: 999, background: "rgba(255,255,255,0.06)", overflow: "hidden" }}>
            <div style={{ width: `${pct}%`, height: "100%", borderRadius: 999, background: `linear-gradient(90deg, ${accentHex}, ${accentHex}aa)`, transition: "width 0.4s ease" }} />
          </div>
        </div>

        {/* Stat chips */}
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          <span style={{ fontSize: "0.7rem", color: "var(--text-secondary)", background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 999, padding: "0.25rem 0.6rem" }}>
            🐠 {speciesCount} species
          </span>
        </div>
      </div>

      {/* Quick links */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: "0.75rem" }}>
        {links.map((l) => (
          <button
            key={l.id}
            type="button"
            onClick={() => onNavigate && onNavigate(l.id)}
            className="glass-card profile-hub__link"
            style={{
              textAlign: "left", padding: "0.9rem", borderRadius: "14px", cursor: "pointer",
              border: "1px solid rgba(255,255,255,0.06)", background: "rgba(255,255,255,0.02)",
              display: "flex", flexDirection: "column", gap: "0.3rem",
            }}
          >
            <span style={{ fontSize: "1.3rem" }}>{l.icon}</span>
            <span style={{ fontSize: "0.85rem", fontWeight: 600, color: "#fff" }}>{l.label}</span>
            <span style={{ fontSize: "0.68rem", color: "var(--text-muted)" }}>{l.desc}</span>
          </button>
        ))}
      </div>

      {/* Switch to Pro */}
      <button
        type="button"
        onClick={onSwitchToPro}
        style={{
          marginTop: "0.25rem", padding: "0.75rem 1rem", borderRadius: "12px", cursor: "pointer",
          border: "1px solid rgba(168,85,247,0.3)",
          background: "linear-gradient(135deg, rgba(168,85,247,0.14), rgba(124,58,237,0.08))",
          color: "#fff", fontSize: "0.85rem", fontWeight: 600,
          display: "flex", alignItems: "center", justifyContent: "center", gap: "0.5rem",
        }}
      >
        ✦ Switch to Pro mode — unlock Breeder Tools
      </button>
    </div>
  );
}

export default ProfileHub;
