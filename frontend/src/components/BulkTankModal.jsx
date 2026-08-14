import React, { useMemo, useState } from "react";
import { awardXp } from "../utils/xp";
import { relayRegisterTanksBulk, buildBulkTankName, MAX_BULK_TANKS } from "../services/relayer";

/**
 * BulkTankModal — "rack stamping" bulk containment-unit creation.
 * See docs/BULK_TANK_CREATE_SPEC.md. Pro-mode only.
 *
 * This component owns the caller-side side effects the service deliberately
 * leaves out (spec §5): XP is awarded EXACTLY ONCE per bulk action (not per
 * row, which would let a keeper farm thousands of XP from one click), and the
 * `aquadex:tank_registered` event is dispatched ONCE so downstream listeners
 * (Starter Quest, tour) fire a single time.
 */

const CONTAINMENT_TYPES = ["Tank", "Tub", "Basket"];
const WATER_TYPES = [
  { label: "Freshwater", value: "0" },
  { label: "Brackish", value: "2" },
  { label: "Pond", value: "3" },
];
const CONFIRM_THRESHOLD = 12; // above this, require an explicit confirm click
const GAL_TO_L = 3.78541;

const inputStyle = {
  width: "100%",
  padding: "0.5rem",
  background: "rgba(255,255,255,0.03)",
  border: "1px solid var(--glass-border)",
  color: "#fff",
  borderRadius: "4px",
};
const selectStyle = { ...inputStyle, background: "rgba(8,12,20,0.9)" };
const labelStyle = { display: "block", fontSize: "0.75rem", color: "var(--text-secondary)", marginBottom: "0.25rem" };

export function BulkTankModal({ walletAccount, locationGroups = [], onClose, onCreated }) {
  const [count, setCount] = useState(10);
  const [prefix, setPrefix] = useState("Grow-out");
  const [startNumber, setStartNumber] = useState(1);
  const [pad, setPad] = useState(0);
  const [containment, setContainment] = useState("0");
  const [tankType, setTankType] = useState("0");
  const [volumeGal, setVolumeGal] = useState(10);
  const [facility, setFacility] = useState("");
  const [room, setRoom] = useState("");
  const [rack, setRack] = useState("");
  const [seedInitialLog, setSeedInitialLog] = useState(true);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [pendingConfirm, setPendingConfirm] = useState(false);

  // Clamp to a sane range for preview + submit; the service enforces it again.
  const safeCount = Math.max(1, Math.min(MAX_BULK_TANKS, Math.floor(Number(count) || 0)));
  const namePattern = useMemo(
    () => ({ prefix, startNumber: Number(startNumber) || 0, pad: Number(pad) || 0 }),
    [prefix, startNumber, pad]
  );

  // Preview: first three names + the last, so the pattern is unmistakable.
  const previewText = useMemo(() => {
    const shown = [];
    for (let i = 0; i < Math.min(3, safeCount); i++) shown.push(buildBulkTankName(namePattern, i));
    if (safeCount > 4) shown.push("…");
    if (safeCount > 3) shown.push(buildBulkTankName(namePattern, safeCount - 1));
    return shown.join(", ");
  }, [namePattern, safeCount]);

  const locationLabel = [rack, room, facility].map((s) => s.trim()).filter(Boolean).join(" · ") || "Unassigned";

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);

    // Above the threshold, require a second, deliberate click.
    if (safeCount > CONFIRM_THRESHOLD && !pendingConfirm) {
      setPendingConfirm(true);
      return;
    }

    setSubmitting(true);
    try {
      const result = await relayRegisterTanksBulk({
        ownerAddress: walletAccount,
        count: safeCount,
        namePattern,
        tankType: Number(tankType),
        volumeLiters: Math.round(Number(volumeGal) * GAL_TO_L),
        containment: Number(containment),
        facility,
        room,
        rack,
        seedInitialLog,
      });

      if (!result.success) {
        setError(result.error || "Failed to create units.");
        setSubmitting(false);
        setPendingConfirm(false);
        return;
      }

      // Caller-side side effects, exactly once (see header note + spec §5).
      awardXp("REGISTER_TANK");
      window.dispatchEvent(
        new CustomEvent("aquadex:tank_registered", {
          detail: { tankId: result.tankIds[0], count: result.tankIds.length, tankIds: result.tankIds },
        })
      );

      if (onCreated) onCreated(result);
      if (onClose) onClose();
    } catch (err) {
      console.error("Bulk tank create failed:", err);
      setError(err.message || "Failed to create units.");
      setSubmitting(false);
      setPendingConfirm(false);
    }
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0, 0, 0, 0.75)",
        backdropFilter: "blur(8px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
        padding: "1rem",
      }}
    >
      <div
        className="glass-card"
        style={{
          width: "100%",
          maxWidth: "520px",
          maxHeight: "90vh",
          overflowY: "auto",
          padding: "2rem",
          background: "var(--bg-secondary)",
          border: "1px solid var(--glass-border-hover)",
        }}
      >
        <h3 style={{ fontSize: "1.5rem", marginBottom: "0.25rem" }}>Add a Rack</h3>
        <p style={{ color: "var(--text-muted)", fontSize: "0.85rem", marginBottom: "1.5rem" }}>
          Stamp out a row of identical units in one go. Name them, place them, and set the shared specs — then stock them
          afterward.
        </p>

        {error && (
          <div
            style={{
              padding: "0.75rem",
              borderRadius: "var(--radius-sm)",
              background: "rgba(248, 113, 113, 0.1)",
              color: "var(--accent-red)",
              fontSize: "0.8rem",
              marginBottom: "1rem",
            }}
          >
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          {/* Count + naming */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1.5fr", gap: "1rem" }}>
            <div>
              <label style={labelStyle} htmlFor="bulk-count">How many units</label>
              <input
                id="bulk-count"
                type="number"
                min={1}
                max={MAX_BULK_TANKS}
                value={count}
                onChange={(e) => { setCount(e.target.value); setPendingConfirm(false); }}
                required
                style={inputStyle}
              />
            </div>
            <div>
              <label style={labelStyle} htmlFor="bulk-prefix">Name prefix</label>
              <input
                id="bulk-prefix"
                type="text"
                value={prefix}
                onChange={(e) => setPrefix(e.target.value)}
                placeholder="e.g. Grow-out"
                style={inputStyle}
              />
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
            <div>
              <label style={labelStyle}>Start number</label>
              <input
                type="number"
                min={0}
                value={startNumber}
                onChange={(e) => setStartNumber(e.target.value)}
                style={inputStyle}
              />
            </div>
            <div>
              <label style={labelStyle}>Zero-pad</label>
              <select value={pad} onChange={(e) => setPad(Number(e.target.value))} style={selectStyle}>
                <option value={0}>None (1, 2, 3)</option>
                <option value={2}>2 digits (01, 02)</option>
                <option value={3}>3 digits (001)</option>
              </select>
            </div>
          </div>

          {/* Live preview */}
          <div
            style={{
              fontSize: "0.72rem",
              color: "var(--text-muted)",
              background: "rgba(255,255,255,0.02)",
              border: "1px dashed var(--glass-border)",
              borderRadius: "6px",
              padding: "0.5rem 0.65rem",
            }}
          >
            <strong style={{ color: "var(--text-secondary)" }}>Preview:</strong> {previewText}{" "}
            <span style={{ opacity: 0.7 }}>({safeCount} units)</span>
          </div>

          {/* Shared specs */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "0.75rem" }}>
            <div>
              <label style={labelStyle}>Containment</label>
              <select value={containment} onChange={(e) => setContainment(e.target.value)} style={selectStyle}>
                {CONTAINMENT_TYPES.map((c, idx) => (
                  <option key={idx} value={idx}>{c}</option>
                ))}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Water type</label>
              <select value={tankType} onChange={(e) => setTankType(e.target.value)} style={selectStyle}>
                {WATER_TYPES.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Volume (gal)</label>
              <input type="number" min={0} value={volumeGal} onChange={(e) => setVolumeGal(e.target.value)} style={inputStyle} />
            </div>
          </div>

          {/* Location */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "0.75rem" }}>
            <div>
              <label style={labelStyle} htmlFor="bulk-facility">Group</label>
              <input
                id="bulk-facility"
                type="text"
                list="bulk-facility-groups"
                value={facility}
                onChange={(e) => setFacility(e.target.value)}
                placeholder="Your group name"
                style={inputStyle}
              />
              <datalist id="bulk-facility-groups">
                {locationGroups.map((g) => (
                  <option key={g} value={g} />
                ))}
              </datalist>
            </div>
            <div>
              <label style={labelStyle} htmlFor="bulk-room">Room</label>
              <input id="bulk-room" type="text" value={room} onChange={(e) => setRoom(e.target.value)} placeholder="e.g. Room B" style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle} htmlFor="bulk-rack">Rack</label>
              <input id="bulk-rack" type="text" value={rack} onChange={(e) => setRack(e.target.value)} placeholder="e.g. Rack 3" style={inputStyle} />
            </div>
          </div>

          <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.78rem", color: "var(--text-secondary)", cursor: "pointer" }}>
            <input type="checkbox" checked={seedInitialLog} onChange={(e) => setSeedInitialLog(e.target.checked)} />
            Seed a starter water reading for each unit
          </label>

          {pendingConfirm && (
            <div
              style={{
                fontSize: "0.78rem",
                color: "var(--accent-blue)",
                background: "var(--accent-blue-glow)",
                borderRadius: "var(--radius-sm)",
                padding: "0.6rem 0.75rem",
              }}
            >
              This creates <strong>{safeCount} units</strong> in {locationLabel}. Click again to confirm.
            </div>
          )}

          <div style={{ display: "flex", gap: "1rem", marginTop: "0.5rem" }}>
            <button type="button" className="btn-secondary" onClick={onClose} disabled={submitting} style={{ flex: 1 }}>
              Cancel
            </button>
            <button type="submit" className="btn-primary" disabled={submitting} style={{ flex: 1, justifyContent: "center" }}>
              {submitting ? "Creating…" : pendingConfirm ? `Confirm — create ${safeCount}` : `Create ${safeCount} units`}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default BulkTankModal;
