import React from "react";
import { useUnitPrefs } from "../hooks/useUnitPrefs";
import { formatTemperature } from "../utils/units";

const ACTION_COLORS = {
  "Water Change": "#38bdf8",
  "Fed Fish": "#34d399",
  "Cleaned Filter": "#a78bfa",
  "Tested Water": "#fbbf24",
  "Added Fertilizer": "#6ee7b7",
  "Dosed Medication": "#f87171",
};

export function ActivityLog({ onChainLogs, actionLogs, casualModeActive }) {
  const { tempUnit } = useUnitPrefs();

  // Safely extract primitive values from ethers.js Result objects (never spread them)
  const safeOnChain = Array.isArray(onChainLogs) ? onChainLogs : [];
  const safeAction  = Array.isArray(actionLogs)  ? actionLogs  : [];

  const waterItems = safeOnChain.map((l, i) => {
    const ts        = Number(l.timestamp || 0) * 1000;
    const tempRaw   = l.tempCelsiusX10 !== undefined ? Number(l.tempCelsiusX10) : (l.temp !== undefined ? Number(l.temp) : 0);
    const phRaw     = l.phX10          !== undefined ? Number(l.phX10)          : (l.ph   !== undefined ? Number(l.ph)   : 0);
    const notesStr  = typeof l.notes === "string" ? l.notes : "";
    return { _type: "water", _ts: ts, _id: i, tempRaw, phRaw, notesStr };
  });

  const actionItems = safeAction.map((l, i) => ({
    _type:      "action",
    _ts:        Number(l.timestamp || 0) * 1000,
    _id:        i,
    actionType: typeof l.actionType === "string" ? l.actionType : "Care Log",
    details:    typeof l.details    === "string" ? l.details    : "",
  }));

  const merged = [...waterItems, ...actionItems].sort((a, b) => b._ts - a._ts);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", maxHeight: "280px", overflowY: "auto" }}>
      <strong style={{ fontSize: "0.85rem", color: "var(--text-secondary)" }}>
        {casualModeActive ? "Activity Log" : "Environmental Logs History"}
      </strong>
      {merged.length === 0 ? (
        <p style={{ color: "var(--text-muted)", fontSize: "0.85rem", padding: "2rem", textAlign: "center" }}>
          No activity logged yet. Use Quick Actions to log care tasks!
        </p>
      ) : merged.map((log) =>
        log._type === "action" ? (
          <div key={`a-${log._id}`} style={{
            padding: "0.65rem 0.85rem",
            background: "rgba(56,189,248,0.04)",
            border: `1px solid ${(ACTION_COLORS[log.actionType] || "#38bdf8")}33`,
            borderLeft: `3px solid ${ACTION_COLORS[log.actionType] || "#38bdf8"}`,
            borderRadius: "8px",
            fontSize: "0.8rem",
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.2rem" }}>
              <strong style={{ color: ACTION_COLORS[log.actionType] || "#38bdf8" }}>{log.actionType}</strong>
              <span style={{ fontSize: "0.68rem", color: "var(--text-muted)" }}>{new Date(log._ts).toLocaleString()}</span>
            </div>
            {log.details ? <span style={{ color: "var(--text-secondary)" }}>{log.details}</span> : null}
          </div>
        ) : (
          <div key={`w-${log._id}`} style={{
            padding: "0.65rem 0.85rem",
            background: "rgba(255,255,255,0.01)",
            border: "1px solid var(--glass-border)",
            borderLeft: "3px solid var(--accent-green)",
            borderRadius: "8px",
            fontSize: "0.75rem",
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.2rem" }}>
              <strong style={{ color: "var(--accent-green)" }}>💧 Water Parameters</strong>
              <span style={{ fontSize: "0.68rem", color: "var(--text-muted)" }}>{new Date(log._ts).toLocaleString()}</span>
            </div>
            <span style={{ color: "var(--accent-blue)" }}>
              {/*
                Honours Settings → Units & Formatting. `tempUnit` defaults to
                "both", which formats as `24.5°C (76.1°F)` — byte-identical to the
                hardcoded output this replaced, so the default path is unchanged.
              */}
              Temp: {formatTemperature(log.tempRaw / 10, tempUnit, { parenthesizeSecond: true })} | pH: {(log.phRaw / 10).toFixed(1)}
            </span>
            {log.notesStr ? <p style={{ color: "var(--text-secondary)", marginTop: "0.25rem", margin: 0 }}>"{log.notesStr}"</p> : null}
          </div>
        )
      )}
    </div>
  );
}
