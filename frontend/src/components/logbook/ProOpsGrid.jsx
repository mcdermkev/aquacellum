import React, { useEffect, useMemo, useState } from "react";
import { LivingTank } from "./LivingTank";
import { deriveTankHealth } from "../../utils/tankHealth";
import { getOrInitTankSchedules, isScheduleDue } from "../../services/tankSchedules";
import "./ProOpsGrid.css";

const WORKLIST_META = {
  waterChange: { icon: "💧", label: "water change" },
  test: { icon: "🧪", label: "water test" },
  filter: { icon: "🧽", label: "filter service" },
  dose: { icon: "💊", label: "dose" },
};

/**
 * ProOpsGrid — the Pro "Fish Room Operations" cross-tank view (Logbook Rework Task 6).
 *
 * The breeder's missing at-a-glance answer to "what needs my attention right now?"
 * across many tanks. Each tank is a dense row: a compact LivingTank strip whose
 * water reflects health, plus last-test / last-change / overdue / param-flag /
 * stock columns. Rows sort "needs attention" first by default, and can be
 * filtered to just those and searched by tank name or species.
 *
 * Per-tank maintenance schedules are loaded so "overdue" and "needs attention"
 * are exact (same spine the Care Coach uses), not inferred.
 *
 * Props:
 *   tanks            — tanks to display (already location-filtered by the parent)
 *   fishbaseData     — species data for the strip's fish
 *   activeTankId     — currently-open tank (row highlight)
 *   draggedOverTankId/ onDragEnterTank / onDragLeaveTank / onDropSpecimen — drag-to-assign parity
 *   onOpen(tank)     — open the detail panel
 */
export function ProOpsGrid({
  tanks = [],
  fishbaseData = [],
  activeTankId = null,
  draggedOverTankId = null,
  onOpen,
  onDropSpecimen,
  onDropSpecimenGroup,
  onDragEnterTank,
  onDragLeaveTank,
  onLogDue,
  schedulesOverride,
}) {
  const [schedulesByTank, setSchedulesByTank] = useState(schedulesOverride || {});
  const [sortKey, setSortKey] = useState("attention");
  const [attentionOnly, setAttentionOnly] = useState(false);
  const [query, setQuery] = useState("");

  // Load (and lazily provision) schedules for all displayed tanks so the worklist
  // and overdue flags are accurate. `schedulesOverride` bypasses the DB (preview/tests).
  useEffect(() => {
    if (schedulesOverride) { setSchedulesByTank(schedulesOverride); return; }
    let cancelled = false;
    (async () => {
      const map = {};
      await Promise.all(
        tanks.map(async (t) => {
          map[t.id] = await getOrInitTankSchedules(t.id);
        })
      );
      if (!cancelled) setSchedulesByTank(map);
    })();
    return () => { cancelled = true; };
  }, [tanks, schedulesOverride]);

  // Compute health + derived ops fields per tank.
  const rows = useMemo(() => {
    return tanks.map((tank) => {
      const health = deriveTankHealth(tank, { schedules: schedulesByTank[tank.id] || [] });
      const species = (tank.specimens || [])
        .map((s) => s.commonName).filter(Boolean);
      const uniqueSpecies = [...new Set(species)];
      return {
        tank,
        health,
        stock: (tank.specimens || []).filter((s) => !s.isBatchPlaceholder).length,
        speciesText: uniqueSpecies.join(", "),
        needsAttention: health.status !== "ok" || health.overdue.length > 0,
      };
    });
  }, [tanks, schedulesByTank]);

  const filtered = useMemo(() => {
    let list = rows;
    if (attentionOnly) list = list.filter((r) => r.needsAttention);
    const q = query.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (r) => (r.tank.name || "").toLowerCase().includes(q) || r.speciesText.toLowerCase().includes(q)
      );
    }
    return [...list].sort((a, b) => rankRows(a, b, sortKey));
  }, [rows, attentionOnly, query, sortKey]);

  const attentionCount = rows.filter((r) => r.needsAttention).length;

  // Today's worklist — which tanks are due, grouped by maintenance kind.
  const worklist = useMemo(() => {
    const nowSec = Date.now() / 1000;
    const byKind = {};
    for (const tank of tanks) {
      for (const s of schedulesByTank[tank.id] || []) {
        if (!isScheduleDue(s, nowSec)) continue;
        (byKind[s.kind] = byKind[s.kind] || []).push(tank.id);
      }
    }
    return Object.entries(byKind)
      .filter(([kind]) => WORKLIST_META[kind])
      .map(([kind, tankIds]) => ({ kind, tankIds, ...WORKLIST_META[kind] }))
      .sort((a, b) => b.tankIds.length - a.tankIds.length);
  }, [tanks, schedulesByTank]);

  return (
    <div className="ops-grid">
      {/* Today's worklist — one-tap batch logging for everything due */}
      {onLogDue && worklist.length > 0 && (
        <div className="ops-worklist">
          <span className="ops-worklist-title">📋 Today's worklist</span>
          {worklist.map((g) => (
            <button key={g.kind} type="button" className="ops-worklist-item" data-testid="worklist-item" onClick={() => onLogDue(g.kind, g.tankIds)}>
              <span>{g.icon} <strong>{g.tankIds.length}</strong> due for {g.label}</span>
              <span className="ops-worklist-go">Log all →</span>
            </button>
          ))}
        </div>
      )}

      {/* Toolbar */}
      <div className="ops-toolbar">
        <div className="ops-toolbar-left">
          <button
            type="button"
            className={`ops-chip ${attentionOnly ? "ops-chip--active" : ""}`}
            data-testid="ops-attention-filter"
            onClick={() => setAttentionOnly((v) => !v)}
            aria-pressed={attentionOnly}
          >
            ⚠️ Needs attention <span className="ops-chip-count">{attentionCount}</span>
          </button>
          <input
            className="ops-search"
            type="search"
            placeholder="Search tank or species…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search tanks"
          />
        </div>
        <label className="ops-sort">
          <span>Sort</span>
          <select value={sortKey} onChange={(e) => setSortKey(e.target.value)}>
            <option value="attention">Needs attention</option>
            <option value="name">Name</option>
            <option value="test">Oldest test</option>
            <option value="change">Oldest change</option>
            <option value="stock">Stock</option>
          </select>
        </label>
      </div>

      {/* Header row */}
      <div className="ops-row ops-row--head">
        <span className="ops-col-strip" />
        <span className="ops-col-name">Tank</span>
        <span className="ops-col-num">Fish</span>
        <span className="ops-col-time">Tested</span>
        <span className="ops-col-time">Changed</span>
        <span className="ops-col-flags">Status</span>
      </div>

      {filtered.length === 0 ? (
        <p className="ops-empty">No tanks match — try clearing the filter or search.</p>
      ) : (
        filtered.map(({ tank, health, stock, speciesText, needsAttention }) => {
          const isActive = activeTankId != null && Number(activeTankId) === Number(tank.id);
          const isDragOver = draggedOverTankId != null && Number(draggedOverTankId) === Number(tank.id);
          return (
            <div
              key={tank.id}
              className={`ops-row ${isActive ? "ops-row--active" : ""} ${isDragOver ? "ops-row--dragover" : ""} ${needsAttention ? "ops-row--attention" : ""}`}
              data-testid="ops-row"
              role="button"
              tabIndex={0}
              onClick={() => onOpen && onOpen(tank)}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen && onOpen(tank); } }}
              onDragOver={(e) => e.preventDefault()}
              onDragEnter={(e) => { e.preventDefault(); onDragEnterTank && onDragEnterTank(tank.id); }}
              onDragLeave={() => onDragLeaveTank && onDragLeaveTank()}
              onDrop={async (e) => {
                e.preventDefault();
                onDragLeaveTank && onDragLeaveTank();
                const groupStr = e.dataTransfer.getData("application/aquadex-specimen-group");
                if (groupStr && onDropSpecimenGroup) {
                  try {
                    const ids = JSON.parse(groupStr);
                    if (Array.isArray(ids) && ids.length) await onDropSpecimenGroup(ids, tank.id);
                  } catch { /* ignore malformed payload */ }
                  return;
                }
                const idStr = e.dataTransfer.getData("application/aquadex-specimen");
                if (idStr && onDropSpecimen) await onDropSpecimen(Number(idStr), tank.id);
              }}
            >
              <span className="ops-col-strip">
                <LivingTank tank={tank} health={health} variant="strip" fishbaseData={fishbaseData} showLabel={false} height={40} />
              </span>
              <span className="ops-col-name">
                <span className="ops-name-line">
                  <StatusDot status={health.status} />
                  <strong>{tank.name || `Unit #${tank.id}`}</strong>
                </span>
                <span className="ops-breadcrumb">
                  {[tank.room, tank.rack].filter(Boolean).join(" · ") || "—"}
                  {speciesText ? ` · ${speciesText}` : ""}
                </span>
              </span>
              <span className="ops-col-num">{stock}</span>
              <span className="ops-col-time">{relativeTime(tank.latestTestTimestamp)}</span>
              <span className="ops-col-time">{relativeTime(tank.latestChangeTimestamp)}</span>
              <span className="ops-col-flags">
                {health.flags.length === 0 ? (
                  <span className="ops-flag ops-flag--ok">OK</span>
                ) : (
                  health.flags.slice(0, 2).map((f, i) => (
                    <span key={i} className={`ops-flag ${health.status === "alert" ? "ops-flag--alert" : "ops-flag--warn"}`}>{f}</span>
                  ))
                )}
              </span>
            </div>
          );
        })
      )}
    </div>
  );
}

/** Pure row comparator. Exported for testing. */
export function rankRows(a, b, sortKey) {
  switch (sortKey) {
    case "name":
      return (a.tank.name || "").localeCompare(b.tank.name || "");
    case "test":
      return (a.tank.latestTestTimestamp || 0) - (b.tank.latestTestTimestamp || 0);
    case "change":
      return (a.tank.latestChangeTimestamp || 0) - (b.tank.latestChangeTimestamp || 0);
    case "stock":
      return b.stock - a.stock;
    case "attention":
    default: {
      const rank = { alert: 0, drifting: 1, ok: 2 };
      const ra = rank[a.health.status] ?? 3;
      const rb = rank[b.health.status] ?? 3;
      if (ra !== rb) return ra - rb;
      if (b.health.overdue.length !== a.health.overdue.length) return b.health.overdue.length - a.health.overdue.length;
      // then oldest test first (most in need of a check)
      return (a.tank.latestTestTimestamp || 0) - (b.tank.latestTestTimestamp || 0);
    }
  }
}

function StatusDot({ status }) {
  const color = status === "ok" ? "#34d399" : status === "drifting" ? "#fbbf24" : "#f87171";
  return <span className="ops-dot" style={{ background: color, boxShadow: `0 0 6px ${color}` }} />;
}

function relativeTime(tsSeconds) {
  if (!tsSeconds) return "—";
  const diff = Date.now() / 1000 - Number(tsSeconds);
  if (diff < 3600) return `${Math.max(1, Math.floor(diff / 60))}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  const days = Math.floor(diff / 86400);
  if (days < 30) return `${days}d`;
  return `${Math.floor(days / 30)}mo`;
}
