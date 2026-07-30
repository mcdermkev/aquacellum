import React, { useEffect, useMemo, useState } from "react";
import { groupNurseryFish } from "../../utils/nurseryGrouping";
import { SEX, isKnownSex, normalizeSex, sexSymbol } from "../../utils/specimenSex";
import "./TankInhabitants.css";

/**
 * TankInhabitants — the detail-panel "Fish / Specimens" tab, reworked from a flat
 * cert-card scroll into a species-GROUPED, BULK-capable inventory (Logbook Rework
 * Task 7). Mirrors the Nursery's grouping model so the whole app speaks one
 * inventory language.
 *
 * - Fish are grouped by species with counts + gender breakdown; a group expands to
 *   its individuals on demand (cert serials tucked behind the detail, not leading).
 * - Multi-select (per group or per individual) drives a bulk "Move to tank" action,
 *   replacing the per-row move grind.
 * - A whole species stack can be dragged onto a tank card (sets a group payload the
 *   list drop handlers understand); individuals stay individually draggable.
 * - Per-individual actions are delegated back to TankList so the existing flows
 *   (photo upload, marketplace listing, the Farewell modal, Ancestry) are unchanged.
 *
 * Marketplace listing stays a single-fish action on purpose — that path touches
 * pricing/ownership and is not something to fan out to a bulk button here.
 *
 * Props:
 *   tank            — the active tank (reads tank.specimens)
 *   tanks           — all tanks, for the move-target selector (current tank excluded)
 *   fishbaseData    — species records for thumbnails / scientific names
 *   casualModeActive
 *   getSpecimenPhoto(spec) — returns a custom photo URL or "" (kept in TankList for parity)
 *   onAddFish()            — open the Add Fish drawer for this tank
 *   onOpenSpecimen(id)     — open the specimen detail
 *   onPhotoSpecimen(spec)  — start a photo upload for this specimen (Casual)
 *   onListSpecimen(spec)   — open the marketplace listing flow
 *   onFarewellSpecimen(spec) — open the Farewell modal (Casual)
 *   onViewLineage(id)      — open Ancestry (Pro)
 *   onMoveSpecimens(ids, targetTankId) => Promise — bulk move
 */
export function TankInhabitants({
  tank,
  tanks = [],
  fishbaseData = [],
  casualModeActive = false,
  getSpecimenPhoto,
  onAddFish,
  onOpenSpecimen,
  onPhotoSpecimen,
  onListSpecimen,
  onFarewellSpecimen,
  onViewLineage,
  onMoveSpecimens,
}) {
  const allSpecimens = Array.isArray(tank?.specimens) ? tank.specimens : [];
  const living = allSpecimens.filter((s) => !s.isBatchPlaceholder);
  const batches = allSpecimens.filter((s) => s.isBatchPlaceholder);

  const groups = useMemo(() => groupNurseryFish(living), [living]);

  const [openGroups, setOpenGroups] = useState({}); // groupKey -> bool
  const [selected, setSelected] = useState(() => new Set()); // specimen ids
  const [moveTarget, setMoveTarget] = useState("");
  const [busy, setBusy] = useState(false);

  // The detail panel stays mounted when the user switches tanks, so reset transient
  // selection/expansion state when the tank changes — otherwise a stale selection
  // from a previous tank could drive a bulk move against the wrong specimens.
  useEffect(() => {
    setSelected(new Set());
    setOpenGroups({});
    setMoveTarget("");
  }, [tank?.id]);

  const moveTanks = tanks.filter((t) => t.active !== false && Number(t.id) !== Number(tank?.id));

  const total = living.length;
  const selCount = selected.size;

  const toggleGroupOpen = (key) =>
    setOpenGroups((p) => ({ ...p, [key]: !p[key] }));

  const toggleOne = (id) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const groupSelectState = (group) => {
    const ids = group.fish.map((f) => f.id);
    const on = ids.filter((id) => selected.has(id)).length;
    if (on === 0) return "none";
    if (on === ids.length) return "all";
    return "some";
  };

  const toggleGroup = (group) =>
    setSelected((prev) => {
      const next = new Set(prev);
      const ids = group.fish.map((f) => f.id);
      const allOn = ids.every((id) => next.has(id));
      if (allOn) ids.forEach((id) => next.delete(id));
      else ids.forEach((id) => next.add(id));
      return next;
    });

  const clearSelection = () => setSelected(new Set());

  const doBulkMove = async () => {
    const targetTankId = Number(moveTarget);
    if (!targetTankId || selCount === 0 || !onMoveSpecimens) return;
    setBusy(true);
    try {
      await onMoveSpecimens([...selected], targetTankId);
      clearSelection();
      setMoveTarget("");
    } finally {
      setBusy(false);
    }
  };

  const startGroupDrag = (group) => (e) => {
    const ids = group.fish.map((f) => f.id);
    e.dataTransfer.setData(
      "application/aquadex-specimen-group",
      JSON.stringify(ids)
    );
    e.dataTransfer.effectAllowed = "move";
  };

  const startOneDrag = (spec) => (e) => {
    e.dataTransfer.setData("application/aquadex-specimen", String(spec.id));
    e.dataTransfer.effectAllowed = "move";
    e.currentTarget.style.opacity = "0.5";
  };

  const heading = casualModeActive
    ? `Fish in this tank (${total})`
    : `Specimens (${total})`;

  return (
    <div className="tank-inhabitants">
      <div className="ti-head">
        <strong className="ti-title">{heading}</strong>
        <button type="button" className="btn-primary ti-add" onClick={() => onAddFish && onAddFish()}>
          + Add Fish
        </button>
      </div>

      {total === 0 ? (
        <div className="ti-empty">
          <p>{casualModeActive ? "No fish recorded in this tank yet." : "No specimens assigned to this tank."}</p>
          <button type="button" className="btn-primary" onClick={() => onAddFish && onAddFish()}>
            {casualModeActive ? "+ Add your first fish" : "+ Register first specimen"}
          </button>
        </div>
      ) : (
        <>
          {/* Bulk-selection toolbar — appears when anything is selected */}
          {selCount > 0 && (
            <div className="ti-bulkbar" data-testid="inhabitants-bulkbar" role="toolbar" aria-label="Bulk actions">
              <span className="ti-bulkbar-count">{selCount} selected</span>
              <div className="ti-bulkbar-actions">
                <select
                  className="ti-select"
                  value={moveTarget}
                  onChange={(e) => setMoveTarget(e.target.value)}
                  aria-label="Move selected fish to tank"
                  disabled={busy || moveTanks.length === 0}
                >
                  <option value="">{moveTanks.length === 0 ? "No other tanks" : "Move to…"}</option>
                  {moveTanks.map((t) => (
                    <option key={t.id} value={t.id}>{t.name || `Tank #${t.id}`}</option>
                  ))}
                </select>
                <button
                  type="button"
                  className="ti-btn ti-btn-move"
                  disabled={!moveTarget || busy}
                  onClick={doBulkMove}
                >
                  {busy ? "Moving…" : `Move ${selCount}`}
                </button>
                <button type="button" className="ti-btn ti-btn-ghost" onClick={clearSelection} disabled={busy}>
                  Clear
                </button>
              </div>
            </div>
          )}

          {groups.map((group) => {
            const img = speciesThumb(group, fishbaseData);
            const isOpen = !!openGroups[group.key];
            const sel = groupSelectState(group);
            return (
              <div key={group.key} className="ti-group" data-testid="inhabitant-group">
                <div
                  className="ti-group-row"
                  draggable
                  onDragStart={startGroupDrag(group)}
                >
                  <input
                    type="checkbox"
                    className="ti-check"
                    checked={sel === "all"}
                    ref={(el) => { if (el) el.indeterminate = sel === "some"; }}
                    onChange={() => toggleGroup(group)}
                    aria-label={`Select all ${group.commonName}`}
                    onClick={(e) => e.stopPropagation()}
                  />
                  <span className="ti-avatar">
                    {img ? <img src={img} alt={group.commonName} /> : <span>🐠</span>}
                  </span>
                  <button
                    type="button"
                    className="ti-group-info"
                    onClick={() => toggleGroupOpen(group.key)}
                    aria-expanded={isOpen}
                  >
                    <strong>{group.count}× {group.commonName}</strong>
                    <span className="ti-genders">
                      {genderSummary(group.genders)}
                      {group.scientificName ? <em className="ti-sci"> · {group.scientificName}</em> : null}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="ti-expand"
                    onClick={() => toggleGroupOpen(group.key)}
                    aria-label={isOpen ? "Collapse" : "Show individuals"}
                  >
                    <span className={`ti-chevron ${isOpen ? "open" : ""}`}>▾</span>
                  </button>
                </div>

                {isOpen && (
                  <div className="ti-individuals">
                    {group.fish.map((spec) => {
                      const photo = (getSpecimenPhoto && getSpecimenPhoto(spec)) || "";
                      const sci = spec.scientificName || group.scientificName || "";
                      return (
                        <div key={spec.id} className="ti-individual" draggable onDragStart={startOneDrag(spec)} onDragEnd={(e) => { e.currentTarget.style.opacity = "1"; }}>
                          <input
                            type="checkbox"
                            className="ti-check"
                            checked={selected.has(spec.id)}
                            onChange={() => toggleOne(spec.id)}
                            aria-label={`Select ${spec.commonName}`}
                          />
                          <button type="button" className="ti-ind-main" onClick={() => onOpenSpecimen && onOpenSpecimen(spec.id)}>
                            {photo ? (
                              <img className="ti-ind-thumb" src={photo} alt={spec.commonName} />
                            ) : (
                              <span className="ti-ind-thumb ti-ind-thumb--empty">🐠</span>
                            )}
                            <span className="ti-ind-text">
                              <span className="ti-ind-name">
                                {spec.commonName}
                                {isKnownSex(spec.gender) && (
                                  <span className={`ti-gender ${normalizeSex(spec.gender) === SEX.MALE ? "male" : "female"}`}>
                                    {sexSymbol(spec.gender)}
                                  </span>
                                )}
                              </span>
                              {!casualModeActive && (
                                <span className="ti-cert">Cert. {String(spec.id).padStart(3, "0")}</span>
                              )}
                              {casualModeActive && sci && <span className="ti-cert ti-sci">{sci}</span>}
                            </span>
                          </button>

                          <div className="ti-ind-actions" onClick={(e) => e.stopPropagation()}>
                            {casualModeActive ? (
                              <>
                                {onPhotoSpecimen && (
                                  <button type="button" className="ti-mini" title="Add / update photo" onClick={() => onPhotoSpecimen(spec)}>📷</button>
                                )}
                                {onListSpecimen && (
                                  <button type="button" className="ti-mini ti-mini-sell" title="List for sale" onClick={() => onListSpecimen(spec)}>💰</button>
                                )}
                                {onFarewellSpecimen && (
                                  <button type="button" className="ti-mini ti-mini-retire" title="Say farewell" onClick={() => onFarewellSpecimen(spec)}>🌊</button>
                                )}
                              </>
                            ) : (
                              <>
                                {onViewLineage && (
                                  <button type="button" className="ti-mini" title="Ancestry" onClick={() => onViewLineage(spec.id)}>Ancestry</button>
                                )}
                                {onListSpecimen && (
                                  <button type="button" className="ti-mini ti-mini-sell" title="List for sale" onClick={() => onListSpecimen(spec)}>Sell</button>
                                )}
                                {onFarewellSpecimen && (
                                  <button type="button" className="ti-mini ti-mini-retire" title="Record departure" onClick={() => onFarewellSpecimen(spec)}>Retire</button>
                                )}
                              </>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}

          {/* Batch placeholders — pending individual registration, no actions */}
          {batches.map((spec) => (
            <div key={spec.id} className="ti-batch">
              <span className="ti-avatar ti-avatar--batch"><span>🐣</span></span>
              <div className="ti-group-info ti-batch-info">
                <strong>{spec.quantity || 1}× {spec.commonName || "Juvenile Fry"}</strong>
                <span className="ti-genders">Pending individual registration</span>
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

function genderSummary(g) {
  const parts = [];
  if (g.Male) parts.push(`♂ ${g.Male}`);
  if (g.Female) parts.push(`♀ ${g.Female}`);
  if (g.Unsexed) parts.push(`? ${g.Unsexed}`);
  return parts.join("  ") || "—";
}

function speciesThumb(group, fishbaseData) {
  const match = (fishbaseData || []).find(
    (f) => Number(f.speciesId) === Number(group.speciesId) || f.commonName === group.commonName
  );
  return match?.masterPhotoUrl || "";
}
