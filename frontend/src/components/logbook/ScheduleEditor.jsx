import React, { useEffect, useState } from "react";
import { getOrInitTankSchedules, setScheduleCadence } from "../../services/tankSchedules";
import "./ScheduleEditor.css";

/**
 * ScheduleEditor — per-tank maintenance cadence editor (Logbook Rework Task 8
 * polish). Lets the keeper set how often each maintenance kind is due; writes
 * `tankSchedules` via `setScheduleCadence`, which the Care Coach, Ops worklist,
 * flag explainer, and living-water ambient all read for exact due/overdue.
 *
 * Collapsed by default to keep the overview tidy.
 *
 * Props:
 *   tank            — active tank
 *   casualModeActive
 *   onChange()      — notified after a save so the parent can refresh derived state
 */
const KINDS = [
  { kind: "waterChange", label: "Water change", icon: "💧", def: 7 },
  { kind: "test", label: "Water test", icon: "🧪", def: 7 },
  { kind: "filter", label: "Filter service", icon: "🧽", def: 14 },
  { kind: "dose", label: "Dose / supplement", icon: "💊", def: 7 },
];

export function ScheduleEditor({ tank, casualModeActive = false, onChange }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState({}); // kind -> { cadenceDays, enabled }
  const [savingKind, setSavingKind] = useState(null);

  useEffect(() => {
    let cancelled = false;
    if (tank?.id == null) return;
    getOrInitTankSchedules(tank.id)
      .then((list) => {
        if (cancelled) return;
        const byKind = {};
        for (const k of KINDS) {
          const found = (list || []).find((s) => s.kind === k.kind);
          byKind[k.kind] = found
            ? { cadenceDays: found.cadenceDays ?? k.def, enabled: found.enabled !== false }
            : { cadenceDays: k.def, enabled: false }; // filter/dose off until enabled
        }
        setRows(byKind);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [tank?.id]);

  if (tank?.id == null) return null;

  const save = async (kind, next) => {
    setRows((p) => ({ ...p, [kind]: next }));
    setSavingKind(kind);
    try {
      const days = Math.max(1, Math.min(365, Number(next.cadenceDays) || 1));
      await setScheduleCadence(tank.id, kind, days, next.enabled);
      onChange && onChange();
    } finally {
      setSavingKind(null);
    }
  };

  return (
    <div className="sched-editor">
      <button
        type="button"
        className="sched-head"
        data-testid="schedule-editor-toggle"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className="sched-head-left">
          <span aria-hidden="true">🗓️</span>
          <strong>{casualModeActive ? "Reminders" : "Maintenance schedule"}</strong>
        </span>
        <span className={`sched-chevron ${open ? "open" : ""}`}>▾</span>
      </button>

      {open && (
        <div className="sched-body">
          <p className="sched-help">
            {casualModeActive
              ? "How often should we remind you? Reminders drive your Care Coach and the tank's health."
              : "Set cadence per task. Drives the Ops worklist, overdue flags, and living-water ambient."}
          </p>
          {KINDS.map((k) => {
            const row = rows[k.kind] || { cadenceDays: k.def, enabled: false };
            const busy = savingKind === k.kind;
            return (
              <div key={k.kind} className={`sched-row ${row.enabled ? "" : "sched-row--off"}`}>
                <label className="sched-toggle">
                  <input
                    type="checkbox"
                    checked={row.enabled}
                    disabled={busy}
                    onChange={(e) => save(k.kind, { ...row, enabled: e.target.checked })}
                    aria-label={`Enable ${k.label} reminders`}
                  />
                  <span className="sched-label"><span aria-hidden="true">{k.icon}</span> {k.label}</span>
                </label>
                <span className="sched-cadence">
                  every
                  <input
                    type="number"
                    min={1}
                    max={365}
                    value={row.cadenceDays}
                    disabled={busy || !row.enabled}
                    onChange={(e) => setRows((p) => ({ ...p, [k.kind]: { ...row, cadenceDays: e.target.value } }))}
                    onBlur={(e) => {
                      const days = Math.max(1, Math.min(365, Number(e.target.value) || k.def));
                      save(k.kind, { ...row, cadenceDays: days });
                    }}
                    aria-label={`${k.label} cadence in days`}
                  />
                  days
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
