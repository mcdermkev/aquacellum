import React, { useMemo, useRef, useState } from "react";
import { awardXp } from "../utils/xp";
import { relayImportTanks, MAX_IMPORT_TANKS } from "../services/relayer";
import { tankTypeLabel } from "../utils/tankUtils";
import {
  parseTankCsv,
  revalidateRows,
  importableSpecs,
  buildEmptyMapping,
  IMPORT_FIELDS,
} from "../utils/parseTankCsv";

/**
 * ImportTanksModal — CSV/paste tank importer for Pro breeders (migration wedge).
 * See docs/CSV_TANK_IMPORT_SPEC.md. Pro-mode only.
 *
 * Like the bulk-create flow, this owns the caller-side side effects the service
 * leaves out (spec §5): XP is awarded EXACTLY ONCE for the whole import and the
 * `aquadex:tank_registered` event is dispatched ONCE, so the Starter Quest
 * add_tank step flips a single time regardless of how many rows imported.
 */

const FIELD_LABELS = {
  name: "Name",
  volumeLiters: "Volume (gal)",
  tankType: "Water type",
  containment: "Containment",
  facility: "Group",
  room: "Room",
  rack: "Rack",
};

const CONFIRM_THRESHOLD = 25;
const L_TO_GAL = 1 / 3.78541;
const PREVIEW_LIMIT = 10;

const inputStyle = {
  width: "100%",
  padding: "0.5rem",
  background: "rgba(255,255,255,0.03)",
  border: "1px solid var(--glass-border)",
  color: "#fff",
  borderRadius: "4px",
};
const selectStyle = { ...inputStyle, background: "rgba(8,12,20,0.9)" };
const labelStyle = { display: "block", fontSize: "0.72rem", color: "var(--text-secondary)", marginBottom: "0.2rem" };

const SAMPLE = "Name,Volume,Water,Group,Room,Rack\nBetta A1,5,Freshwater,Fish Room,Room A,Rack 1\nBetta A2,5,Freshwater,Fish Room,Room A,Rack 1";

export function ImportTanksModal({ walletAccount, onClose, onCreated }) {
  const [rawText, setRawText] = useState("");
  const [headers, setHeaders] = useState([]);
  const [dataRows, setDataRows] = useState([]); // raw string rows (no header)
  const [mapping, setMapping] = useState(buildEmptyMapping());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [pendingConfirm, setPendingConfirm] = useState(false);
  const fileRef = useRef(null);

  // Re-validate the parsed data rows whenever the (possibly edited) mapping changes.
  const rows = useMemo(() => revalidateRows(dataRows, mapping), [dataRows, mapping]);
  const ready = useMemo(() => importableSpecs(rows), [rows]);
  const skippedCount = rows.length - ready.length;
  const warnCount = useMemo(() => rows.filter((r) => r.errors.length === 0 && r.warnings.length > 0).length, [rows]);

  const applyParse = (text) => {
    setError(null);
    setPendingConfirm(false);
    const parsed = parseTankCsv(text);
    setHeaders(parsed.headers);
    setDataRows(parsed.rows.map((r) => r.raw));
    setMapping(parsed.mapping);
  };

  const handleTextChange = (e) => {
    const text = e.target.value;
    setRawText(text);
    applyParse(text);
  };

  const handleFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result || "");
      setRawText(text);
      applyParse(text);
    };
    reader.readAsText(file);
  };

  const setFieldColumn = (field, colIndex) => {
    setMapping((prev) => ({ ...prev, [field]: colIndex }));
    setPendingConfirm(false);
  };

  const handleImport = async () => {
    setError(null);
    if (ready.length === 0) return;

    if (ready.length > CONFIRM_THRESHOLD && !pendingConfirm) {
      setPendingConfirm(true);
      return;
    }

    setSubmitting(true);
    try {
      const result = await relayImportTanks({ ownerAddress: walletAccount, tanks: ready });
      if (!result.success) {
        setError(result.error || "Import failed.");
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
      console.error("Tank import failed:", err);
      setError(err.message || "Import failed.");
      setSubmitting(false);
      setPendingConfirm(false);
    }
  };

  const hasData = dataRows.length > 0;
  const previewRows = rows.slice(0, PREVIEW_LIMIT);

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
          maxWidth: "760px",
          maxHeight: "90vh",
          overflowY: "auto",
          padding: "2rem",
          background: "var(--bg-secondary)",
          border: "1px solid var(--glass-border-hover)",
        }}
      >
        <h3 style={{ fontSize: "1.5rem", marginBottom: "0.25rem" }}>Import tanks</h3>
        <p style={{ color: "var(--text-muted)", fontSize: "0.85rem", marginBottom: "1.25rem" }}>
          Paste rows from a spreadsheet (or upload a .csv). We'll match your columns — check the mapping and preview,
          then import. Livestock is added afterward.
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

        {/* Step 1 — input */}
        <label style={labelStyle} htmlFor="import-tanks-paste">Paste your rows</label>
        <textarea
          id="import-tanks-paste"
          value={rawText}
          onChange={handleTextChange}
          placeholder={SAMPLE}
          rows={5}
          style={{ ...inputStyle, fontFamily: "monospace", fontSize: "0.78rem", resize: "vertical" }}
        />
        <div style={{ display: "flex", gap: "0.75rem", alignItems: "center", marginTop: "0.5rem" }}>
          <button type="button" className="btn-secondary" style={{ fontSize: "0.78rem" }} onClick={() => fileRef.current?.click()}>
            Upload .csv / .tsv
          </button>
          <input ref={fileRef} type="file" accept=".csv,.tsv,.txt" onChange={handleFile} style={{ display: "none" }} />
          {rawText && (
            <button
              type="button"
              className="btn-secondary"
              style={{ fontSize: "0.78rem" }}
              onClick={() => { setRawText(""); applyParse(""); }}
            >
              Clear
            </button>
          )}
        </div>

        {hasData && (
          <>
            {/* Step 2 — column mapping */}
            <div style={{ marginTop: "1.5rem" }}>
              <div style={{ fontSize: "0.9rem", fontWeight: 600, color: "#fff", marginBottom: "0.5rem" }}>Match your columns</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: "0.6rem" }}>
                {IMPORT_FIELDS.map((field) => (
                  <div key={field}>
                    <label style={labelStyle}>
                      {FIELD_LABELS[field]}
                      {field === "name" && <span style={{ color: "var(--accent-red)" }}> *</span>}
                    </label>
                    <select
                      value={mapping[field]}
                      onChange={(e) => setFieldColumn(field, Number(e.target.value))}
                      style={selectStyle}
                    >
                      <option value={-1}>— Ignore —</option>
                      {headers.map((h, idx) => (
                        <option key={idx} value={idx}>{h}</option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            </div>

            {/* Summary */}
            <div style={{ marginTop: "1.25rem", fontSize: "0.82rem", color: "var(--text-secondary)" }}>
              <strong style={{ color: "var(--accent-green)" }}>{ready.length} ready</strong>
              {skippedCount > 0 && <span> · <strong style={{ color: "var(--accent-red)" }}>{skippedCount} skipped</strong></span>}
              {warnCount > 0 && <span> · <strong style={{ color: "var(--accent-amber, #fbbf24)" }}>{warnCount} with warnings</strong></span>}
            </div>

            {/* Step 2b — preview */}
            <div style={{ marginTop: "0.5rem", overflowX: "auto", border: "1px solid var(--glass-border)", borderRadius: "6px" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.76rem" }}>
                <thead>
                  <tr style={{ color: "var(--text-muted)", textAlign: "left" }}>
                    <th style={{ padding: "0.4rem 0.6rem" }}></th>
                    <th style={{ padding: "0.4rem 0.6rem" }}>Name</th>
                    <th style={{ padding: "0.4rem 0.6rem" }}>Volume</th>
                    <th style={{ padding: "0.4rem 0.6rem" }}>Water</th>
                    <th style={{ padding: "0.4rem 0.6rem" }}>Location</th>
                    <th style={{ padding: "0.4rem 0.6rem" }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {previewRows.map((r, i) => {
                    const ok = r.errors.length === 0;
                    const gal = Math.round(r.spec.volumeLiters * L_TO_GAL);
                    const loc = [r.spec.rack, r.spec.room, r.spec.facility].filter(Boolean).join(" · ") || "—";
                    return (
                      <tr key={i} style={{ borderTop: "1px solid var(--glass-border)", opacity: ok ? 1 : 0.55 }}>
                        <td style={{ padding: "0.4rem 0.6rem" }}>{ok ? (r.warnings.length ? "⚠" : "✓") : "✗"}</td>
                        <td style={{ padding: "0.4rem 0.6rem", color: "#fff" }}>{r.spec.name || <em style={{ color: "var(--accent-red)" }}>(missing)</em>}</td>
                        <td style={{ padding: "0.4rem 0.6rem" }}>{gal} gal</td>
                        <td style={{ padding: "0.4rem 0.6rem" }}>{tankTypeLabel(r.spec.tankType)}</td>
                        <td style={{ padding: "0.4rem 0.6rem" }}>{loc}</td>
                        <td style={{ padding: "0.4rem 0.6rem", color: ok ? "var(--text-muted)" : "var(--accent-red)" }}>
                          {ok ? (r.warnings[0] || "Ready") : r.errors[0]}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {rows.length > PREVIEW_LIMIT && (
              <div style={{ fontSize: "0.72rem", color: "var(--text-muted)", marginTop: "0.35rem" }}>
                Showing {PREVIEW_LIMIT} of {rows.length} rows.
              </div>
            )}

            {pendingConfirm && (
              <div
                style={{
                  marginTop: "1rem",
                  fontSize: "0.78rem",
                  color: "var(--accent-blue)",
                  background: "var(--accent-blue-glow)",
                  borderRadius: "var(--radius-sm)",
                  padding: "0.6rem 0.75rem",
                }}
              >
                This imports <strong>{ready.length} tanks</strong>. Click again to confirm.
              </div>
            )}
          </>
        )}

        <div style={{ display: "flex", gap: "1rem", marginTop: "1.5rem" }}>
          <button type="button" className="btn-secondary" onClick={onClose} disabled={submitting} style={{ flex: 1 }}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={handleImport}
            disabled={submitting || ready.length === 0}
            style={{ flex: 1, justifyContent: "center" }}
          >
            {submitting
              ? "Importing…"
              : pendingConfirm
              ? `Confirm — import ${ready.length}`
              : ready.length > 0
              ? `Import ${ready.length} tanks`
              : "Import"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default ImportTanksModal;
