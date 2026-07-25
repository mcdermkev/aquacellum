import React, { useEffect, useState } from "react";
import { db } from "../../db";
import { deriveTankHealth } from "../../utils/tankHealth";
import { getOrInitTankSchedules, isScheduleDue } from "../../services/tankSchedules";
import "./CareCoach.css";

/**
 * CareCoach — the Casual-mode habit engine (Logbook Rework Task 5).
 *
 * The Casual logbook's job is to help new fishkeepers LEARN good habits through a
 * gamified, rewarding loop. CareCoach surfaces the single most important next
 * habit for a tank right now — test the water, change the water, or "you're on
 * track!" — with a one-tap action, a short *why it matters*, and gamified
 * reinforcement (streak + XP framing). It reads health + maintenance recency;
 * once per-tank schedules land (Task 8) it will read those instead of the
 * 7-day default cadence used here.
 *
 * Props:
 *   tank          — active tank (health + latestTest/Change timestamps)
 *   walletAccount — to read the user's streak for reinforcement (optional)
 *   onAction(kind)— called when the user taps the suggested habit ("test" | "waterChange")
 */
export function CareCoach({ tank, walletAccount, onAction }) {
  const [streakDays, setStreakDays] = useState(0);
  const [schedules, setSchedules] = useState(null);

  useEffect(() => {
    let cancelled = false;
    if (!walletAccount) return;
    db.userProfile.get(walletAccount)
      .then((p) => { if (!cancelled && p?.streakDays) setStreakDays(p.streakDays); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [walletAccount]);

  // Load (and lazily provision) this tank's maintenance schedules so the coach's
  // "due" logic is exact rather than a 7-day recency guess.
  useEffect(() => {
    let cancelled = false;
    if (tank?.id == null) return;
    getOrInitTankSchedules(tank.id)
      .then((rows) => { if (!cancelled) setSchedules(rows); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [tank?.id]);

  if (!tank) return null;
  const s = pickSuggestion(tank, Date.now(), schedules);

  return (
    <div className={`care-coach ${s.urgent ? "care-coach--urgent" : s.kind ? "" : "care-coach--praise"}`}>
      <div className="care-coach-main">
        <span className="care-coach-icon" aria-hidden="true">{s.icon}</span>
        <div className="care-coach-text">
          <div className="care-coach-head">
            <strong className="care-coach-title">{s.title}</strong>
            {streakDays > 0 && (
              <span className="care-coach-streak" title={`${streakDays}-day care streak`}>🔥 {streakDays}-day streak</span>
            )}
          </div>
          <span className="care-coach-why">{s.why}</span>
        </div>
      </div>

      {s.kind && (
        <button
          type="button"
          className="care-coach-cta"
          onClick={() => onAction && onAction(s.kind)}
        >
          {s.cta} <span className="care-coach-pts">+{s.pts} pts</span>
        </button>
      )}
    </div>
  );
}

const EMERGENCY = (health) => ({
  kind: "waterChange", urgent: true, icon: "🚨",
  title: "Your water needs help now",
  why: health?.flags?.[0]
    ? `${health.flags[0]} — a water change dilutes it fast and protects your fish.`
    : "Ammonia or nitrite is high — a water change helps right away.",
  cta: "Log a water change", pts: 10,
});

const PRAISE = {
  kind: null, icon: "🎉",
  title: "You're a great fishkeeper!",
  why: "Everything's on track. Keep the streak going — your fish are lucky to have you.",
  cta: null, pts: 0,
};

/** Build a suggestion for a due schedule kind (test / waterChange). */
function fromScheduleKind(kind, { never, overdueDays }) {
  if (kind === "test") {
    return {
      kind: "test", icon: "🧪",
      title: never ? "Test your water" : overdueDays > 0 ? `Water test overdue by ${overdueDays}d` : "Time for a water test",
      why: "Testing catches problems days before your fish ever show stress.",
      cta: "Log a water test", pts: 8,
    };
  }
  if (kind === "waterChange") {
    return {
      kind: "waterChange", icon: "💧",
      title: never ? "Start your water-change routine" : overdueDays > 0 ? `Water change overdue by ${overdueDays}d` : "Time for a water change",
      why: "Regular water changes keep nitrate low and your fish thriving.",
      cta: "Log a water change", pts: 10,
    };
  }
  return null; // filter/dose have no one-tap handler yet
}

/**
 * Choose the most important habit to nudge right now. Exported for testing.
 * Prefers real per-tank schedules when available; falls back to a 7-day recency
 * heuristic when a tank has no schedules yet.
 * @param {object} tank
 * @param {number} [now] ms
 * @param {Array|null} [schedules] tankSchedules rows for this tank
 */
export function pickSuggestion(tank, now = Date.now(), schedules = null) {
  const health = deriveTankHealth(tank, { now, schedules: schedules || [] });
  const nowSec = now / 1000;

  // 1. Emergency first — the water itself is unsafe.
  if (health.status === "alert") return EMERGENCY(health);

  // 2. Schedule-driven (exact) when this tank has schedules.
  if (schedules && schedules.length) {
    const order = { test: 0, waterChange: 1, filter: 2, dose: 3 };
    const due = schedules
      .filter((s) => isScheduleDue(s, nowSec))
      .sort((a, b) => (order[a.kind] ?? 9) - (order[b.kind] ?? 9));
    for (const top of due) {
      const never = top.lastDoneAt == null;
      const overdueDays = never ? 0 : Math.max(0, Math.floor((nowSec - Number(top.nextDueAt)) / 86400));
      const built = fromScheduleKind(top.kind, { never, overdueDays });
      if (built) return built;
    }
    return PRAISE;
  }

  // 3. Recency fallback (no schedules yet).
  const daysSince = (ts) => (ts ? (nowSec - Number(ts)) / 86400 : Infinity);
  const dTest = daysSince(tank.latestTestTimestamp);
  const dChange = daysSince(tank.latestChangeTimestamp);
  if (dTest >= 7) return fromScheduleKind("test", { never: dTest === Infinity, overdueDays: 0 });
  if (dChange >= 7) return fromScheduleKind("waterChange", { never: dChange === Infinity, overdueDays: 0 });
  return PRAISE;
}
