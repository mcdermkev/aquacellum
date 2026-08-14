import React, { useEffect, useMemo, useRef, useState } from "react";
import { awardXp } from "../utils/xp";
import { relayImportSpecimens, MAX_IMPORT_SPECIMENS } from "../services/relayer";
import { buildSpeciesMatcher } from "../utils/matchSpecies";
import {
  parseLivestockCsv,
  revalidateLivestockRows,
  distinctSpeciesNames,
  buildEmptyLivestockMapping,
  LIVESTOCK_FIELDS,
} from "../utils/parseLivestockCsv";

/**
 * LivestockImportModal — CSV/paste livestock importer for Pro breeders.
 * See docs/LIVESTOCK_IMPORT_SPEC.md. Pro-mode only.
 *
 * The species-resolution step is the careful part: a typed name only imports
 * once resolved to a real contract speciesId. Exact matches auto-resolve; every
 * other name requires the keeper to pick from the catalog before its rows count
 * as importable. Wrong species = wrong certificate identity, so we never
 * auto-import a fuzzy guess.
 *
 * XP + the aquadex:specimen_added event are fired here EXACTLY ONCE (mirrors the
 * single add-fish flow) so the Starter Quest add_fish step flips a single time.
 */

const FIELD_LABELS = { species: "Species", quantity: "Quantity", sex: "Sex", tank: "Tank" };
const CONFIRM_THRESHOLD = 50;
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

const SAMPLE = "Species,Quantity,Sex,Tank\nGuppy,6,Mixed,Grow-out 1\nBetta,1,Male,Grow-out 2";

export function LivestockImportModal({ walletAccount, catalog = [], tanks = [], onClose, onCreated }) {
  const [rawText, setRawText] = useState("");
  const [headers, setHeaders] = useState([]);
  const [dataRows, setDataRows] = useState([]);
  const [mapping, setMapping] = useState(buildEmptyLivestockMapping());
  const [picks, setPicks] = useState({}); // distinctName -> speciesId (user override)
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [pendingConfirm, setPendingConfirm] = useState(false);
  const fileRef = useRef(null);

  const matcher = useMemo(() => buildSpeciesMatcher(catalog), [catalog]);
  const catalogById = useMemo(() => {
    const m = new Map();
    for (const s of catalog) m.set(Number(s.speciesId), s);
    return m;
  }, [catalog]);
  const tankByName = useMemo(() => {
    const m = new Map();
    for (const t of tanks) {
      const key = String(t.name ?? "").trim().toLowerCase();
      if (key && !m.has(key)) m.set(key, t);
    }
    return m;
  }, [tanks]);

  const rows = useMemo(() => revalidateLivestockRows(dataRows, mapping), [dataRows, mapping]);
  const distinctNames = useMemo(() => distinctSpeciesNames(rows), [rows]);
  const matches = useMemo(() => {
    const m = new Map();
    for (const name of distinctNames) m.set(name, matcher.match(name));
    return m;
  }, [distinctNames, matcher]);

  // Effective resolved speciesId for a name: user pick wins, else an exact match.
  const resolvedSpeciesId = (name) => {
    if (picks[name] !== undefined && picks[name] !== "") return Number(picks[name]);
    const match = matches.get(name);
    return match && match.status === "exact" ? match.speciesId : null;
  };

  // Reset picks when the data source changes so stale picks don't linger.
  useEffect(() => {
    setPicks({});
  }, [dataRows]);

  const applyParse = (text) => {
    setError(null);
    setPendingConfirm(false);
    const parsed = parseLivestockCsv(text);
    setHeaders(parsed.headers);
    setDataRows(parsed.rows.map((r) => r.raw));
    setMapping(parsed.mapping);
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

  // Build the importable specimen list (quantity expanded into individuals).
  const { specimens, readyFish, skippedRows } = useMemo(() => {
    const out = [];
    let skipped = 0;
    for (const r of rows) {
      const sid = r.errors.length === 0 ? resolvedSpeciesId(r.species) : null;
      if (!sid) {
        skipped += 1;
        continue;
      }
      const entry = catalogById.get(Number(sid));
      const tank = r.tankName ? tankByName.get(r.tankName.trim().toLowerCase()) : null;
      for (let i = 0; i < r.quantity; i++) {
        out.push({
          speciesId: Number(sid),
          commonName: entry?.commonName || "",
          scientificName: entry?.scientificName || "",
          gender: r.sex,
          currentTankId: tank ? Number(tank.id) : 0,
        });
      }
    }
    return { specimens: out, readyFish: out.length, skippedRows: skipped };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, picks, matches, catalogById, tankByName]);

  const handleImport = async () => {
    setError(null);
    if (specimens.length === 0) return;
    if (specimens.length > MAX_IMPORT_SPECIMENS) {
      setError(`That's ${specimens.length} fish — the limit is ${MAX_IMPORT_SPECIMENS} per import.`);
      return;
    }
    if (readyFish > CONFIRM_THRESHOLD && !pendingConfirm) {
      setPendingConfirm(true);
      return;
    }

    setSubmitting(true);
    try {
      const result = await relayImportSpecimens({ ownerAddress: walletAccount, specimens });
      if (!result.success) {
        setError(result.error || "Import failed.");
        setSubmitting(false);
        setPendingConfirm(false);
        return;
      }
      // Caller-side side effects, once (see header note + spec §7).
      awardXp("MINT_SPECIMEN", { quantity: result.specimenIds.length });
      window.dispatchEvent(
        new CustomEvent("aquadex:specimen_added", {
          detail: { tokenId: result.specimenIds[0], count: result.specimenIds.length },
        })
      );
      if (onCreated) onCreated(result);
      if (onClose) onClose();
    } catch (err) {
      console.error("Livestock import failed:", err);
      setError(err.message || "Import failed.");
      setSubmitting(false);
      setPendingConfirm(false);
    }
  };

  const hasData = dataRows.length > 0;
  const unresolvedNames = distinctNames.filter((n) => !resolvedSpeciesId(n));

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
          maxWidth: "820px",
          maxHeight: "90vh",
          overflowY: "auto",
          padding: "2rem",
          background: "var(--bg-secondary)",
          border: "1px solid var(--glass-border-hover)",
        }}
      >
        <h3 style={{ fontSize: "1.5rem", marginBottom: "0.25rem" }}>Import livestock</h3>
        <p style={{ color: "var(--text-muted)", fontSize: "0.85rem", marginBottom: "1.25rem" }}>
          Paste your fish list (species, quantity, sex, tank). We'll match each species to your catalog — confirm any
          that aren't an exact match, then import. Lineage is added later per fish.
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
        <label style={labelStyle} htmlFor="import-livestock-paste">Paste your rows</label>
        <textarea
          id="import-livestock-paste"
          value={rawText}
          onChange={(e) => { setRawText(e.target.value); applyParse(e.target.value); }}
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
            <button type="button" className="btn-secondary" style={{ fontSize: "0.78rem" }} onClick={() => { setRawText(""); applyParse(""); }}>
              Clear
            </button>
          )}
        </div>

        {hasData && (
          <>
            {/* Step 2 — column mapping */}
            <div style={{ marginTop: "1.5rem" }}>
              <div style={{ fontSize: "0.9rem", fontWeight: 600, color: "#fff", marginBottom: "0.5rem" }}>Match your columns</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: "0.6rem" }}>
                {LIVESTOCK_FIELDS.map((field) => (
                  <div key={field}>
                    <label style={labelStyle}>
                      {FIELD_LABELS[field]}
                      {field === "species" && <span style={{ color: "var(--accent-red)" }}> *</span>}
                    </label>
                    <select
                      aria-label={`Source column for ${FIELD_LABELS[field]}`}
                      value={mapping[field]}
                      onChange={(e) => { setMapping((p) => ({ ...p, [field]: Number(e.target.value) })); setPendingConfirm(false); }}
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

            {/* Step 3 — species resolution */}
            <div style={{ marginTop: "1.5rem" }}>
              <div style={{ fontSize: "0.9rem", fontWeight: 600, color: "#fff", marginBottom: "0.5rem" }}>
                Resolve species{" "}
                {unresolvedNames.length > 0 && (
                  <span style={{ fontSize: "0.72rem", color: "var(--accent-amber, #fbbf24)", fontWeight: 500 }}>
                    · {unresolvedNames.length} need a match
                  </span>
                )}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
                {distinctNames.map((name) => {
                  const match = matches.get(name);
                  const resolved = resolvedSpeciesId(name);
                  const isExact = match && match.status === "exact" && picks[name] === undefined;
                  // Order options: suggestions first, then the rest of the catalog.
                  const suggestedIds = new Set((match?.candidates || []).map((c) => Number(c.speciesId)));
                  const ordered = [
                    ...(match?.candidates || []),
                    ...catalog.filter((s) => !suggestedIds.has(Number(s.speciesId))),
                  ];
                  return (
                    <div
                      key={name}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "0.6rem",
                        padding: "0.4rem 0.5rem",
                        background: resolved ? "transparent" : "rgba(251,191,36,0.06)",
                        borderRadius: "6px",
                      }}
                    >
                      <span style={{ flexShrink: 0, fontSize: "0.9rem" }}>{resolved ? (isExact ? "✓" : "•") : "⚠"}</span>
                      <span style={{ minWidth: 0, flex: "0 0 34%", fontSize: "0.82rem", color: "#fff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        "{name}"
                      </span>
                      <select
                        aria-label={`Species for "${name}"`}
                        value={resolved ? String(resolved) : ""}
                        onChange={(e) => { setPicks((p) => ({ ...p, [name]: e.target.value })); setPendingConfirm(false); }}
                        style={{ ...selectStyle, flex: 1 }}
                      >
                        <option value="">— Select species —</option>
                        {ordered.map((s) => (
                          <option key={s.speciesId} value={String(s.speciesId)}>
                            {s.commonName} ({s.scientificName})
                          </option>
                        ))}
                      </select>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Summary + preview */}
            <div style={{ marginTop: "1.25rem", fontSize: "0.82rem", color: "var(--text-secondary)" }}>
              <strong style={{ color: "var(--accent-green)" }}>{readyFish} fish ready</strong>
              {skippedRows > 0 && <span> · <strong style={{ color: "var(--accent-red)" }}>{skippedRows} rows skipped</strong></span>}
            </div>
            <div style={{ marginTop: "0.5rem", overflowX: "auto", border: "1px solid var(--glass-border)", borderRadius: "6px" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.76rem" }}>
                <thead>
                  <tr style={{ color: "var(--text-muted)", textAlign: "left" }}>
                    <th style={{ padding: "0.4rem 0.6rem" }}></th>
                    <th style={{ padding: "0.4rem 0.6rem" }}>Species</th>
                    <th style={{ padding: "0.4rem 0.6rem" }}>Qty</th>
                    <th style={{ padding: "0.4rem 0.6rem" }}>Sex</th>
                    <th style={{ padding: "0.4rem 0.6rem" }}>Tank</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, PREVIEW_LIMIT).map((r, i) => {
                    const sid = r.errors.length === 0 ? resolvedSpeciesId(r.species) : null;
                    const entry = sid ? catalogById.get(Number(sid)) : null;
                    const tank = r.tankName ? tankByName.get(r.tankName.trim().toLowerCase()) : null;
                    const tankMissing = r.tankName && !tank;
                    return (
                      <tr key={i} style={{ borderTop: "1px solid var(--glass-border)", opacity: sid ? 1 : 0.55 }}>
                        <td style={{ padding: "0.4rem 0.6rem" }}>{sid ? "✓" : "✗"}</td>
                        <td style={{ padding: "0.4rem 0.6rem", color: "#fff" }}>
                          {entry ? entry.commonName : <span style={{ color: "var(--accent-red)" }}>{r.species || "(missing)"} — needs match</span>}
                        </td>
                        <td style={{ padding: "0.4rem 0.6rem" }}>{r.quantity}</td>
                        <td style={{ padding: "0.4rem 0.6rem" }}>{r.sex}</td>
                        <td style={{ padding: "0.4rem 0.6rem", color: tankMissing ? "var(--accent-amber, #fbbf24)" : "var(--text-muted)" }}>
                          {tank ? tank.name : r.tankName ? `${r.tankName} (not found → unassigned)` : "Unassigned"}
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
                This registers <strong>{readyFish} fish</strong>. Click again to confirm.
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
            disabled={submitting || readyFish === 0}
            style={{ flex: 1, justifyContent: "center" }}
          >
            {submitting
              ? "Importing…"
              : pendingConfirm
              ? `Confirm — import ${readyFish}`
              : readyFish > 0
              ? `Import ${readyFish} fish`
              : "Import"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default LivestockImportModal;
