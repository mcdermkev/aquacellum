import React, { useState } from "react";
import { setUpGrowoutTank, growoutTankText, GROWOUT_TANK_COPY } from "../services/growoutTank";

/**
 * GrowoutTankPanel — create a spawn's grow-out tank and move the cohort into it.
 * See docs/GROWOUT_TANK_SPEC.md §4.
 *
 * Self-contained so mounting it in the shared `SpawnGrowoutTracker` (which is
 * rendered from two places with different prop sets) is a couple of lines.
 *
 * This creates no certificates — a cohort is counts, not certificates (§4.2). The
 * promote panel next door is the only path from a count to a birth certificate.
 */
export function GrowoutTankPanel({ spawnId, defaultName = "", casual = false, onDone }) {
  const [open, setOpen] = useState(false);
  const [tankName, setTankName] = useState(defaultName);
  const [volumeGal, setVolumeGal] = useState(20);
  const [fryCount, setFryCount] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

  const pick = (key) => (casual ? GROWOUT_TANK_COPY[key].casual : GROWOUT_TANK_COPY[key].pro);

  const handleSubmit = async () => {
    setError(null);
    setSubmitting(true);
    try {
      const res = await setUpGrowoutTank({
        spawnId,
        tankName,
        volumeGal,
        fryCount: fryCount === "" ? null : Number(fryCount),
        note,
      });
      if (!res.success) {
        setError(growoutTankText(res.errorKey, { casual }) || res.error);
        setSubmitting(false);
        return;
      }
      setResult(res);
      setOpen(false);
      setSubmitting(false);
      setFryCount("");
      setNote("");
      if (onDone) await onDone(res);
    } catch (err) {
      console.error("Grow-out tank setup failed:", err);
      setError(growoutTankText("unexpected", { casual }));
      setSubmitting(false);
    }
  };

  const inputStyle = {
    width: "100%",
    padding: "0.45rem",
    background: "rgba(0,0,0,0.2)",
    border: "1px solid var(--glass-border)",
    color: "#fff",
    borderRadius: "4px",
    fontSize: "0.8rem",
  };
  const labelStyle = { display: "block", fontSize: "0.68rem", color: "var(--text-secondary)", marginBottom: "0.2rem" };

  return (
    <div
      style={{
        padding: "0.75rem",
        background: "rgba(0,0,0,0.2)",
        borderRadius: "6px",
        border: "1px solid var(--glass-border)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.75rem" }}>
        <div style={{ minWidth: 0 }}>
          <strong style={{ fontSize: "0.82rem", color: "#fff" }}>
            🪣 {casual ? "Move to a grow-out tank" : "Grow-out tank"}
          </strong>
          <div style={{ fontSize: "0.68rem", color: "var(--text-muted)", marginTop: 2 }}>
            {casual
              ? "Make a tank for these babies and record how many there are."
              : "Create this batch's grow-out tank and move the cohort into it."}
          </div>
        </div>
        {!open && (
          <button className="btn-secondary" style={{ fontSize: "0.72rem", whiteSpace: "nowrap" }} onClick={() => setOpen(true)}>
            Set up
          </button>
        )}
      </div>

      {result && !open && (
        <div style={{ marginTop: "0.6rem", fontSize: "0.72rem", color: "var(--accent-green)" }}>
          ✓ {result.tankName} created
          {result.fryCountRecorded != null ? ` · ${result.fryCountRecorded} recorded` : ""}
          {result.movedFrom ? " · batch moved" : ""}
        </div>
      )}

      {open && (
        <div style={{ marginTop: "0.75rem", display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          {error && (
            <div style={{ fontSize: "0.72rem", color: "var(--accent-red)" }}>{error}</div>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: "0.5rem" }}>
            <div>
              <label style={labelStyle}>Tank name</label>
              <input type="text" value={tankName} onChange={(e) => setTankName(e.target.value)} placeholder={defaultName} style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>Size (gal)</label>
              <input type="number" min={1} value={volumeGal} onChange={(e) => setVolumeGal(e.target.value)} style={inputStyle} />
            </div>
          </div>

          <div>
            <label style={labelStyle}>{casual ? "How many babies? (optional)" : "Fry in this batch (optional)"}</label>
            <input type="number" min={1} value={fryCount} onChange={(e) => setFryCount(e.target.value)} placeholder="e.g. 120" style={inputStyle} />
            <div style={{ fontSize: "0.64rem", color: "var(--text-muted)", marginTop: "0.25rem", lineHeight: 1.5 }}>
              {pick("headcountIsRunning")}
            </div>
          </div>

          <div>
            <label style={labelStyle}>Note (optional)</label>
            <input type="text" value={note} onChange={(e) => setNote(e.target.value)} style={inputStyle} />
          </div>

          <div style={{ fontSize: "0.64rem", color: "var(--text-muted)", lineHeight: 1.5 }}>{pick("oneTankPerMove")}</div>

          <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.25rem" }}>
            <button
              className="btn-secondary"
              style={{ flex: 1, fontSize: "0.75rem" }}
              onClick={() => { setOpen(false); setError(null); }}
              disabled={submitting}
            >
              Cancel
            </button>
            <button className="btn-primary" style={{ flex: 1, fontSize: "0.75rem", justifyContent: "center" }} onClick={handleSubmit} disabled={submitting}>
              {submitting ? "Working…" : "Create grow-out tank"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default GrowoutTankPanel;
