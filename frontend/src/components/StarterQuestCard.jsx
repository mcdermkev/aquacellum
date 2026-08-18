import React, { useEffect, useState } from "react";
import {
  STARTER_QUEST_ITEMS,
  getStarterQuestState,
  dismissStarterQuest,
  QUEST_UPDATED_EVENT,
} from "../utils/starterQuest";

/**
 * StarterQuestCard — the first-run activation checklist.
 *
 * ── WHY THIS MOVED OUT OF ProfileHub ────────────────────────────────────────
 *
 * This checklist already worked. It is driven by real product events, is
 * idempotent, seeds returning keepers so finished work never reads as undone,
 * and it has e2e cover. Its only defect was WHERE it rendered: it was declared
 * inside ProfileHub, which lives on the `profile` tab — and `profile` has no
 * entry in App.jsx's nav array. On desktop the only way to reach it was to type
 * /app/profile. The e2e tests navigate there by URL, which is exactly how a
 * routing gap in an activation surface stayed invisible.
 *
 * So a new user, told nothing and shown nothing, was lost — while the thing
 * built to orient them sat one unlinked route away.
 *
 * ── WHY THIS ISN'T A THIRD WIZARD ───────────────────────────────────────────
 *
 * Two previous attempts (an onboarding wizard and a guided spotlight tour) were
 * sunset for feeling forced. The difference here is structural, not cosmetic:
 *
 *   - It does not interrupt. No overlay, no modal, no focus trap, no gate. It is
 *     a card in the page you already opened.
 *   - It does not narrate the UI. Each row is a real action with a real
 *     destination; tapping one navigates and gets out of the way.
 *   - It can be closed at ANY time, not only once finished. That is the single
 *     most important change: a checklist you cannot dismiss is a demand, and a
 *     demand is what "forced" feels like. Dismissal is permanent.
 *   - It disappears on its own when the work is genuinely done.
 *
 * A tour explains an interface. This one just answers "what do I do first?" and
 * then leaves.
 */
export function StarterQuestCard({ onNavigate, compact = false }) {
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

  // Dismissal is respected whether or not the quest was finished. Previously
  // only a COMPLETED quest could be dismissed, so a keeper who had no interest
  // in, say, posting to the Reef was shown an unfinishable list forever.
  if (quest.dismissed) return null;

  const pct = Math.round((quest.completedCount / quest.total) * 100);

  return (
    <div
      className="glass-card starter-quest"
      style={{
        padding: compact ? "0.9rem 1rem" : "1.1rem 1.25rem",
        borderRadius: "16px",
        display: "flex",
        flexDirection: "column",
        gap: "0.9rem",
        border: quest.allDone ? "1px solid rgba(56,189,248,0.4)" : "1px solid rgba(255,255,255,0.08)",
        background: quest.allDone
          ? "linear-gradient(135deg, rgba(56,189,248,0.14), rgba(16,185,129,0.08))"
          : "rgba(255,255,255,0.02)",
      }}
      aria-label="Getting started checklist"
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.75rem" }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: "0.95rem", fontWeight: 700, color: "#fff", display: "flex", alignItems: "center", gap: "0.4rem" }}>
            {quest.allDone ? "🎉 You're all set" : "🧭 New here? Start with these"}
          </div>
          <div style={{ fontSize: "0.72rem", color: "var(--text-muted)", marginTop: 2 }}>
            {quest.allDone
              ? "You've found your way around Aquadex. Nice work."
              : "Five things that get your tanks logged and your fish catalogued."}
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexShrink: 0 }}>
          <span style={{ fontSize: "0.72rem", fontWeight: 700, color: quest.allDone ? "#38bdf8" : "var(--text-secondary)", whiteSpace: "nowrap" }}>
            {quest.completedCount}/{quest.total}
          </span>
          {/* Always available, not just on completion. */}
          <button
            type="button"
            onClick={dismissStarterQuest}
            aria-label="Hide the getting started checklist"
            title="Hide this"
            style={{
              background: "none",
              border: "none",
              color: "var(--text-muted)",
              cursor: "pointer",
              fontSize: "1.1rem",
              lineHeight: 1,
              minWidth: "32px",
              minHeight: "32px",
            }}
          >
            ×
          </button>
        </div>
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
    </div>
  );
}

export default StarterQuestCard;
