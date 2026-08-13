import React, { useMemo, useState } from "react";
import { awardXp } from "../utils/xp";
import { relayImportTanks, relayImportSpecimens } from "../services/relayer";
import { buildSpeciesMatcher } from "../utils/matchSpecies";
import {
  planBreedingProgram,
  buildSpecimenSpecs,
  emptyProgramLine,
  MAX_LINES,
  MAX_PROGRAM_FISH,
} from "../utils/breedingProgram";

/**
 * BreedingProgramModal — lineage-first intake ("declare your breeding program").
 * See docs/LINEAGE_FIRST_INTAKE_SPEC.md. Pro surface.
 *
 * A breeder declares their lines; each becomes a tank plus a birth certificate
 * per fish, tagged with the line name.
 *
 * Three rules from the spec are enforced here rather than trusted:
 *   - Species must resolve to a real contract catalog id. Exact names
 *     auto-resolve; anything fuzzy must be picked by hand (§7).
 *   - Sex counts are ENTERED, never inferred from the word "pair" (§5).
 *   - Declared stock is foundation stock, so no parent pointers are ever sent —
 *     which is what keeps the COI engine honest for these fish (§5).
 *
 * XP is awarded once and `aquadex:specimen_added` dispatched once, mirroring the
 * add-fish flow, so the Starter Quest step flips a single time.
 */

// Copy in one frozen const with pro/casual variants and static strings — counts
// are interpolated by the render, not baked in — matching the PAIRING_COPY /
// PROMOTION_COPY convention so the language invariant test can scan it.
export const PROGRAM_COPY = Object.freeze({
  intro: Object.freeze({
    pro: "Declare the lines you keep. Each line becomes a tank plus a birth certificate for every fish in it, grouped under the line name.",
    casual: "List the groups of fish you breed. We'll make a tank for each one and add its fish for you.",
  }),
  foundationNote: Object.freeze({
    pro: "Declared fish are recorded as foundation stock with no parents, so relatedness reads as unknown until you log a spawn from them. That is deliberate — a made-up ancestor would make every pairing report a false 0%.",
    casual: "We won't guess these fish's parents. Once you breed them, their babies get a real family tree.",
  }),
  breederNote: Object.freeze({
    pro: "These are recorded as bred by you. If you bought this stock and it came with a pedigree, bring it in through the purchase instead so the original breeder is kept.",
    casual: "These get recorded as yours.",
  }),
});

const CONFIRM_THRESHOLD = 20;

const inputStyle = {
  width: "100%",
  padding: "0.45rem",
  background: "rgba(255,255,255,0.03)",
  border: "1px solid var(--glass-border)",
  color: "#fff",
  borderRadius: "4px",
  fontSize: "0.8rem",
};
const selectStyle = { ...inputStyle, background: "rgba(8,12,20,0.9)" };
const numStyle = { ...inputStyle, textAlign: "center" };
const thStyle = { padding: "0.35rem 0.4rem", fontSize: "0.68rem", color: "var(--text-muted)", textAlign: "left", fontWeight: 600 };
const tdStyle = { padding: "0.3rem 0.4rem", verticalAlign: "middle" };

export function BreedingProgramModal({ walletAccount, catalog = [], casualModeActive = false, onClose, onCreated }) {
  const [rows, setRows] = useState([emptyProgramLine()]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [pendingConfirm, setPendingConfirm] = useState(false);
  const [progress, setProgress] = useState(null);

  const matcher = useMemo(() => buildSpeciesMatcher(catalog), [catalog]);
  const catalogById = useMemo(() => {
    const m = new Map();
    for (const s of catalog) m.set(Number(s.speciesId), s);
    return m;
  }, [catalog]);

  const plan = useMemo(() => planBreedingProgram(rows, catalogById), [rows, catalogById]);

  const pick = (key) => (casualModeActive ? PROGRAM_COPY[key].casual : PROGRAM_COPY[key].pro);

  const setRow = (index, patch) => {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));
    setPendingConfirm(false);
    setError(null);
  };

  // Typing a species name auto-resolves ONLY on an exact catalog match; anything
  // else clears the id so the row stays blocked until the breeder picks (spec §7).
  const handleSpeciesText = (index, text) => {
    const match = matcher.match(text);
    setRow(index, { species: text, speciesId: match.status === "exact" ? match.speciesId : null });
  };

  const addRow = () => {
    if (rows.length >= MAX_LINES) return;
    setRows((prev) => [...prev, emptyProgramLine()]);
    setPendingConfirm(false);
  };

  const removeRow = (index) => {
    setRows((prev) => (prev.length === 1 ? [emptyProgramLine()] : prev.filter((_, i) => i !== index)));
    setPendingConfirm(false);
  };

  const handleCreate = async () => {
    setError(null);
    if (plan.readyLines.length === 0) return;
    if (plan.overCap) {
      setError(`That's ${plan.totalFish} fish across ${plan.readyLines.length} lines — the limit is ${MAX_PROGRAM_FISH} fish and ${MAX_LINES} lines per run.`);
      return;
    }
    if (plan.totalFish > CONFIRM_THRESHOLD && !pendingConfirm) {
      setPendingConfirm(true);
      return;
    }

    setSubmitting(true);
    try {
      // 1. Tanks first — the fish need their ids. Each call is individually atomic;
      //    a fish failure after this leaves empty tanks, which claim nothing and
      //    are reusable (spec §6.1).
      setProgress("Creating tanks…");
      const tankResult = await relayImportTanks({ ownerAddress: walletAccount, tanks: plan.tankSpecs });
      if (!tankResult.success) {
        setError(tankResult.error || "Could not create the tanks.");
        setSubmitting(false);
        setPendingConfirm(false);
        setProgress(null);
        return;
      }

      // 2. Fish, placed by line. No parent pointers — foundation stock (spec §5).
      setProgress("Registering fish…");
      const specs = buildSpecimenSpecs(plan.readyLines, tankResult.tankIds);
      const fishResult = await relayImportSpecimens({ ownerAddress: walletAccount, specimens: specs });
      if (!fishResult.success) {
        setError(
          `${plan.tankSpecs.length} tanks were created, but the fish could not be registered: ${fishResult.error || "unknown error"}. The tanks are empty and ready to reuse.`
        );
        setSubmitting(false);
        setPendingConfirm(false);
        setProgress(null);
        return;
      }

      // Caller-side side effects, once each.
      awardXp("MINT_SPECIMEN", { quantity: fishResult.specimenIds.length });
      window.dispatchEvent(
        new CustomEvent("aquadex:tank_registered", {
          detail: { tankId: tankResult.tankIds[0], count: tankResult.tankIds.length, tankIds: tankResult.tankIds },
        })
      );
      window.dispatchEvent(
        new CustomEvent("aquadex:specimen_added", {
          detail: { tokenId: fishResult.specimenIds[0], count: fishResult.specimenIds.length },
        })
      );

      if (onCreated) onCreated({ tankIds: tankResult.tankIds, specimenIds: fishResult.specimenIds });
      if (onClose) onClose();
    } catch (err) {
      console.error("Breeding program intake failed:", err);
      setError(err.message || "Could not create the program.");
      setSubmitting(false);
      setPendingConfirm(false);
      setProgress(null);
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
          maxWidth: "860px",
          maxHeight: "90vh",
          overflowY: "auto",
          padding: "2rem",
          background: "var(--bg-secondary)",
          border: "1px solid var(--glass-border-hover)",
        }}
      >
        <h3 style={{ fontSize: "1.5rem", marginBottom: "0.25rem" }}>Declare your breeding program</h3>
        <p style={{ color: "var(--text-muted)", fontSize: "0.85rem", marginBottom: "1rem" }}>{pick("intro")}</p>

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

        {/* Line rows */}
        <div style={{ overflowX: "auto", border: "1px solid var(--glass-border)", borderRadius: "8px" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={thStyle}>Line / pair name</th>
                <th style={thStyle}>Species</th>
                <th style={{ ...thStyle, textAlign: "center", width: 62 }}>♂</th>
                <th style={{ ...thStyle, textAlign: "center", width: 62 }}>♀</th>
                <th style={{ ...thStyle, textAlign: "center", width: 76 }}>Unsexed</th>
                <th style={{ ...thStyle, textAlign: "center", width: 78 }}>Tank gal</th>
                <th style={{ ...thStyle, width: 90 }}>Status</th>
                <th style={{ ...thStyle, width: 34 }}></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const planned = plan.lines[i];
                const ok = planned && planned.errors.length === 0;
                const match = r.species ? matcher.match(r.species) : null;
                const needsPick = !!r.species && !r.speciesId;
                // Suggestions first, then the rest of the catalog.
                const suggestedIds = new Set((match?.candidates || []).map((c) => Number(c.speciesId)));
                const ordered = needsPick
                  ? [...(match?.candidates || []), ...catalog.filter((s) => !suggestedIds.has(Number(s.speciesId)))]
                  : [];
                return (
                  <tr key={i} style={{ borderTop: "1px solid var(--glass-border)" }}>
                    <td style={tdStyle}>
                      <input
                        type="text"
                        value={r.line}
                        onChange={(e) => setRow(i, { line: e.target.value })}
                        placeholder="e.g. Blue Grass A1"
                        style={inputStyle}
                      />
                    </td>
                    <td style={tdStyle}>
                      <input
                        type="text"
                        value={r.species}
                        onChange={(e) => handleSpeciesText(i, e.target.value)}
                        placeholder="Type a species"
                        style={inputStyle}
                      />
                      {needsPick && (
                        <select
                          value={r.speciesId ? String(r.speciesId) : ""}
                          onChange={(e) => setRow(i, { speciesId: e.target.value ? Number(e.target.value) : null })}
                          style={{ ...selectStyle, marginTop: "0.25rem" }}
                        >
                          <option value="">— Pick the species —</option>
                          {ordered.map((s) => (
                            <option key={s.speciesId} value={String(s.speciesId)}>
                              {s.commonName} ({s.scientificName})
                            </option>
                          ))}
                        </select>
                      )}
                      {r.speciesId && (
                        <div style={{ fontSize: "0.66rem", color: "var(--accent-green)", marginTop: 2 }}>
                          {catalogById.get(Number(r.speciesId))?.commonName}
                        </div>
                      )}
                    </td>
                    <td style={tdStyle}>
                      <input type="number" min={0} value={r.males} onChange={(e) => setRow(i, { males: e.target.value })} style={numStyle} />
                    </td>
                    <td style={tdStyle}>
                      <input type="number" min={0} value={r.females} onChange={(e) => setRow(i, { females: e.target.value })} style={numStyle} />
                    </td>
                    <td style={tdStyle}>
                      <input type="number" min={0} value={r.unsexed} onChange={(e) => setRow(i, { unsexed: e.target.value })} style={numStyle} />
                    </td>
                    <td style={tdStyle}>
                      <input type="number" min={0} value={r.volumeGal} onChange={(e) => setRow(i, { volumeGal: e.target.value })} style={numStyle} />
                    </td>
                    <td style={{ ...tdStyle, fontSize: "0.68rem", color: ok ? "var(--text-muted)" : "var(--accent-red)" }}>
                      {ok ? `${planned.fishCount} fish` : planned?.errors[0] || ""}
                    </td>
                    <td style={tdStyle}>
                      <button
                        type="button"
                        onClick={() => removeRow(i)}
                        title="Remove line"
                        style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: "1rem" }}
                      >
                        ×
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <button
          type="button"
          className="btn-secondary"
          onClick={addRow}
          disabled={rows.length >= MAX_LINES}
          style={{ fontSize: "0.78rem", marginTop: "0.6rem" }}
        >
          + Add line
        </button>

        {/* Summary */}
        <div style={{ marginTop: "1rem", fontSize: "0.82rem", color: "var(--text-secondary)" }}>
          <strong style={{ color: "var(--accent-green)" }}>
            {plan.readyLines.length} lines · {plan.readyLines.length} tanks · {plan.totalFish} fish
          </strong>
          {plan.skippedCount > 0 && (
            <span> · <strong style={{ color: "var(--accent-red)" }}>{plan.skippedCount} incomplete</strong></span>
          )}
        </div>

        {/* The two honesty notes from the spec */}
        <div
          style={{
            marginTop: "0.85rem",
            padding: "0.7rem 0.85rem",
            borderRadius: "var(--radius-sm)",
            background: "rgba(255,255,255,0.02)",
            border: "1px dashed var(--glass-border)",
            fontSize: "0.72rem",
            color: "var(--text-muted)",
            lineHeight: 1.55,
          }}
        >
          <div>{pick("foundationNote")}</div>
          <div style={{ marginTop: "0.4rem" }}>{pick("breederNote")}</div>
        </div>

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
            This creates <strong>{plan.readyLines.length} tanks</strong> and{" "}
            <strong>{plan.totalFish} birth certificates</strong>. Certificates can't be deleted afterward, only archived.
            Click again to confirm.
          </div>
        )}

        <div style={{ display: "flex", gap: "1rem", marginTop: "1.5rem" }}>
          <button type="button" className="btn-secondary" onClick={onClose} disabled={submitting} style={{ flex: 1 }}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={handleCreate}
            disabled={submitting || plan.readyLines.length === 0}
            style={{ flex: 1, justifyContent: "center" }}
          >
            {submitting
              ? progress || "Working…"
              : pendingConfirm
              ? `Confirm — create ${plan.totalFish} fish`
              : plan.readyLines.length > 0
              ? `Create ${plan.readyLines.length} tanks & ${plan.totalFish} fish`
              : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default BreedingProgramModal;
