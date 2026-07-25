import React, { useEffect, useState } from "react";
import { db } from "../../db";
import { deriveTankHealth } from "../../utils/tankHealth";
import { TankHealthRing } from "./TankHealthRing";
import "./JournalTimeline.css";

/**
 * JournalTimeline — the Casual-mode tank "story" (Logbook Rework Task 5).
 *
 * Merges care actions (typed actionLogs.payload), water-parameter readings,
 * tank notes, and photos into one photo-first, reverse-chronological timeline —
 * the friendly counterpart to Pro's flat parameter-history list. Reads the Task 1
 * spine tables directly by tank id.
 *
 * Props:
 *   tank            — the active tank (used for health header + tank id)
 *   entriesOverride — optional pre-built entries (for the preview/tests)
 */
export function JournalTimeline({ tank, entriesOverride }) {
  const [entries, setEntries] = useState(entriesOverride || []);
  const [loading, setLoading] = useState(!entriesOverride);

  useEffect(() => {
    if (entriesOverride) {
      setEntries(entriesOverride);
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      const built = await loadJournalEntries(tank?.id);
      if (!cancelled) {
        setEntries(built);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [tank?.id, entriesOverride]);

  const health = tank ? deriveTankHealth(tank) : null;

  return (
    <div className="journal-timeline">
      {health && (
        <div className="journal-header">
          <TankHealthRing health={health} />
        </div>
      )}

      {loading ? (
        <p className="journal-empty">Loading your tank's story…</p>
      ) : entries.length === 0 ? (
        <p className="journal-empty">
          No entries yet. Log a feeding, water change, or photo and your tank's story starts here. 🐠
        </p>
      ) : (
        <ol className="journal-list">
          {entries.map((e) => (
            <li key={e.key} className={`journal-entry journal-entry--${e.kind}`}>
              <span className="journal-icon" aria-hidden="true">{e.icon}</span>
              <div className="journal-body">
                <div className="journal-entry-head">
                  <strong className="journal-title">{e.title}</strong>
                  <span className="journal-time">{relativeTime(e.ms)}</span>
                </div>
                {e.detail && <span className="journal-detail">{e.detail}</span>}
                {e.photo && <img className="journal-photo" src={e.photo} alt={e.title} loading="lazy" />}
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/**
 * Load + merge journal entries for a tank from the spine tables.
 * Exported for reuse/testing.
 */
export async function loadJournalEntries(tankId) {
  if (tankId == null) return [];
  const idKeys = [tankId, String(tankId), Number(tankId)];
  const out = [];

  // Care actions (with typed payloads)
  try {
    const actions = await db.actionLogs.where("tankId").anyOf(idKeys).toArray();
    for (const a of actions) {
      const meta = careMeta(a);
      out.push({
        key: `a-${a.id}`,
        kind: meta.kind,
        icon: meta.icon,
        title: meta.title,
        detail: a.details || meta.detail || "",
        ms: toMs(a.timestamp),
      });
    }
  } catch { /* table absent */ }

  // Parameter readings
  try {
    const readings = await db.paramReadings.where("tankId").anyOf(idKeys).toArray();
    for (const r of readings) {
      const bits = [];
      if (r.temp != null) bits.push(`${Number(r.temp).toFixed(1)}°C`);
      if (r.ph != null) bits.push(`pH ${Number(r.ph).toFixed(1)}`);
      if (r.ammonia != null) bits.push(`NH₃ ${Number(r.ammonia).toFixed(2)}`);
      if (r.nitrate != null) bits.push(`NO₃ ${Number(r.nitrate).toFixed(0)}`);
      out.push({
        key: `r-${r.id}`,
        kind: "reading",
        icon: "🧪",
        title: "Water reading",
        detail: bits.join(" · "),
        ms: toMs(r.timestamp),
      });
    }
  } catch { /* table absent */ }

  // Notes
  try {
    const notes = await db.tankNotes.where("tankId").anyOf(idKeys).toArray();
    for (const n of notes) {
      out.push({
        key: `n-${n.id}`,
        kind: "note",
        icon: "📝",
        title: "Note",
        detail: n.text || "",
        ms: toMs(n.createdAt),
      });
    }
  } catch { /* table absent */ }

  // Photos (tank-level)
  try {
    const media = await db.tankMedia.where("[refType+refId]").equals(["tank", String(tankId)]).toArray();
    for (const m of media) {
      out.push({
        key: `m-${m.id}`,
        kind: "photo",
        icon: "📷",
        title: "Photo",
        detail: "",
        photo: m.dataUrl,
        ms: toMs(m.createdAt),
      });
    }
  } catch { /* table absent */ }

  out.sort((a, b) => b.ms - a.ms);
  return out;
}

/** Map a care action to a friendly icon/title. Uses the typed payload when present. */
function careMeta(a) {
  const kind = a.payload?.kind || inferKindFromType(a.actionType);
  switch (kind) {
    case "feed": return { kind: "feed", icon: "🥣", title: "Fed the fish" };
    case "waterChange": {
      const pct = a.payload?.percent;
      return { kind: "waterChange", icon: "💧", title: pct ? `${pct}% water change` : "Water change" };
    }
    case "clean": return { kind: "clean", icon: "🧹", title: "Cleaned the tank" };
    case "test": return { kind: "reading", icon: "🧪", title: "Water test" };
    case "treatment": return { kind: "treatment", icon: "💊", title: "Treatment" };
    case "observation": return { kind: "note", icon: "👀", title: "Observation" };
    default: return { kind: "care", icon: "📋", title: a.actionType || "Care log" };
  }
}

function inferKindFromType(t) {
  switch (t) {
    case "Feed": return "feed";
    case "Water Change":
    case "Log Immediate Water Change": return "waterChange";
    case "Scraped Algae": return "clean";
    case "Quick Water Test":
    case "Water Test":
    case "Detailed Test": return "test";
    case "Treatment": return "treatment";
    case "Observation": return "observation";
    default: return "care";
  }
}

/** Normalize a timestamp (seconds or ms) to ms. */
function toMs(t) {
  const n = Number(t) || 0;
  return n > 1e12 ? n : n * 1000;
}

function relativeTime(ms) {
  if (!ms) return "";
  const diff = Date.now() - ms;
  if (diff < 60000) return "just now";
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  const days = Math.floor(diff / 86400000);
  if (days < 30) return `${days}d ago`;
  return new Date(ms).toLocaleDateString();
}
