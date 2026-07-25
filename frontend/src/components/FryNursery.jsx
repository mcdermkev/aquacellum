import React, { useState, useEffect } from "react";
import { db } from "../db";
import { relayMoveSpecimen } from "../services/relayer";
import { syncSpecimenToCloud } from "../services/cloudSync";
import { groupNurseryFish } from "../utils/nurseryGrouping";
import { deriveSpeciesProfile, rankCompatibleTanks, profileHasCareData } from "../services/compatibleTanks";
import "./logbook/FryNursery.css";

/**
 * FryNursery — triage tray for unassigned specimens (Logbook Rework Task 7).
 *
 * Specimens orphaned by decommission or created without a tank. Reworked from a
 * flat per-row list (a dropdown + 3 buttons on every fish) into a collapsible,
 * species-GROUPED, BULK-capable tray: "12× Common Goldfish" with one "Move all
 * to tank" and "Retire all", expandable to individuals for granular action.
 * Uses the themed confirm dialog instead of window.confirm.
 *
 * Props:
 *   walletAccount, tanks, onRefresh, onListOnMarketplace, casualModeActive
 *   fishbaseData   — for species thumbnails
 *   requestConfirm — themed confirm ({ title, message, confirmLabel, danger, onConfirm })
 */
export function FryNursery({
  walletAccount,
  tanks = [],
  onRefresh,
  onListOnMarketplace,
  casualModeActive = false,
  fishbaseData = [],
  contractSpecies = [],
  requestConfirm,
}) {
  const [nurseryFish, setNurseryFish] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [openGroups, setOpenGroups] = useState({}); // groupKey -> bool (show individuals)
  const [moveTarget, setMoveTarget] = useState({}); // groupKey -> tankId
  const [busyKey, setBusyKey] = useState(null);

  const fetchNursery = async () => {
    try {
      const owner = (walletAccount || "").toLowerCase();
      const all = await db.specimens.toArray();
      const activeTankIds = new Set(
        (await db.tanks.where("ownerAddress").equals(owner).toArray())
          .filter((t) => t.active !== false)
          .map((t) => Number(t.id))
      );
      const unassigned = all.filter((s) => {
        if (Number(s.status ?? 0) !== 0) return false;
        const specOwner = (s.ownerAddress || "").toLowerCase();
        if (specOwner !== owner && specOwner !== "") return false;
        const tankId = Number(s.currentTankId || 0);
        return tankId === 0 || !activeTankIds.has(tankId);
      });
      unassigned.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      setNurseryFish(unassigned);
    } catch (err) {
      console.warn("[FryNursery] Failed to load:", err);
      setNurseryFish([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchNursery(); }, [walletAccount]);

  const activeTanks = tanks.filter((t) => t.active !== false);
  const groups = groupNurseryFish(nurseryFish);

  const confirm = (opts) => {
    if (requestConfirm) requestConfirm(opts);
    else if (window.confirm(opts.message)) opts.onConfirm();
  };

  const moveGroup = async (group) => {
    const targetTankId = Number(moveTarget[group.key]);
    if (!targetTankId) return;
    setBusyKey(group.key);
    try {
      for (const fish of group.fish) {
        await relayMoveSpecimen({ specimenId: fish.id, targetTankId });
      }
      await fetchNursery();
      onRefresh && onRefresh();
    } catch (err) {
      console.error("[FryNursery] Bulk move failed:", err);
    } finally {
      setBusyKey(null);
    }
  };

  const retireFish = async (ids) => {
    for (const id of ids) {
      await db.specimens.update(id, { status: 1 });
      const updated = await db.specimens.get(id);
      if (updated) syncSpecimenToCloud(updated).catch(() => {});
    }
    await fetchNursery();
    onRefresh && onRefresh();
  };

  const retireGroup = (group) => {
    confirm({
      title: casualModeActive ? "Say goodbye?" : "Retire specimens?",
      message: `Retire ${group.count} ${group.commonName}? This marks ${group.count === 1 ? "it" : "them"} inactive and removes ${group.count === 1 ? "it" : "them"} from your inventory.`,
      confirmLabel: `Retire ${group.count}`,
      danger: true,
      onConfirm: () => retireFish(group.fish.map((f) => f.id)),
    });
  };

  const retireOne = (fish) => {
    confirm({
      title: casualModeActive ? "Say goodbye?" : "Retire specimen?",
      message: `Retire ${fish.commonName || "this fish"} (Cert. ${serialOf(fish)})? This marks it inactive.`,
      confirmLabel: "Retire",
      danger: true,
      onConfirm: () => retireFish([fish.id]),
    });
  };

  if (loading || nurseryFish.length === 0) return null;

  const total = nurseryFish.length;
  const summary = groups.slice(0, 3).map((g) => `${g.count} ${g.commonName}`).join(", ") + (groups.length > 3 ? "…" : "");

  return (
    <div className="fry-nursery glass-card">
      {/* Header — collapsible triage banner */}
      <button className="fn-header" data-testid="nursery-header" onClick={() => setExpanded((v) => !v)} aria-expanded={expanded}>
        <span className="fn-header-left">
          <span className="fn-emoji">🐣</span>
          <span>
            <strong className="fn-title">{casualModeActive ? "Fish Nursery" : "Specimen Nursery"}</strong>
            <span className="fn-badge">{total} unassigned</span>
          </span>
        </span>
        <span className="fn-header-right">
          {!expanded && <span className="fn-summary">{summary}</span>}
          <span className={`fn-chevron ${expanded ? "open" : ""}`}>▾</span>
        </span>
      </button>

      {expanded && (
        <div className="fn-body">
          <p className="fn-help">
            {casualModeActive
              ? "These fish aren't in a tank yet. Move a whole group into a tank, or list/retire them."
              : "Unassigned specimens grouped by species. Assign a group to a unit, list on the marketplace, or retire."}
          </p>

          {groups.map((group) => {
            const img = speciesThumb(group, fishbaseData);
            const isOpen = !!openGroups[group.key];
            const busy = busyKey === group.key;

            // Rank the keeper's tanks by fit for this species (grounded in the
            // shared compatibility engine). Only badge/reorder when we actually
            // have species care data; otherwise fall back to the plain list.
            const profile = deriveSpeciesProfile(group, fishbaseData, contractSpecies);
            const showFit = profileHasCareData(profile);
            const ranked = showFit ? rankCompatibleTanks(profile, activeTanks) : null;
            const orderedTanks = ranked ? ranked.map((r) => r.tank) : activeTanks;
            const verdictById = ranked
              ? Object.fromEntries(ranked.map((r) => [String(r.tank.id), r.verdict]))
              : {};
            const bestFit = ranked && ranked[0] && ranked[0].verdict !== "blocked" ? ranked[0].tank : null;

            return (
              <div key={group.key} className="fn-group">
                <div className="fn-group-row">
                  <span className="fn-avatar">
                    {img ? <img src={img} alt={group.commonName} /> : <span>🐠</span>}
                  </span>
                  <div className="fn-group-info">
                    <strong>{group.count}× {group.commonName}</strong>
                    <span className="fn-genders">{genderSummary(group.genders)}</span>
                    {bestFit && (
                      <span className="fn-fit-hint" title={`Best fit for ${group.commonName} based on tank size and water parameters`}>
                        ✓ Best fit: {bestFit.name}
                      </span>
                    )}
                  </div>
                  <div className="fn-group-actions" onClick={(e) => e.stopPropagation()}>
                    <select
                      className="fn-select"
                      value={moveTarget[group.key] || ""}
                      onChange={(e) => setMoveTarget((p) => ({ ...p, [group.key]: e.target.value }))}
                      aria-label={`Move ${group.commonName} to tank${showFit ? " (sorted by fit)" : ""}`}
                    >
                      <option value="">{showFit ? "Move all to… (best fit first)" : "Move all to…"}</option>
                      {orderedTanks.map((t) => (
                        <option key={t.id} value={t.id}>
                          {verdictById[String(t.id)] === "blocked" ? "⚠ " : ""}{t.name}
                          {verdictById[String(t.id)] === "blocked" ? " (may be too small)" : ""}
                        </option>
                      ))}
                    </select>
                    <button
                      className="fn-btn fn-btn-move"
                      disabled={!moveTarget[group.key] || busy}
                      onClick={() => moveGroup(group)}
                    >
                      {busy ? "Moving…" : "Move"}
                    </button>
                    <button className="fn-btn fn-btn-retire" onClick={() => retireGroup(group)} disabled={busy}>Retire all</button>
                    <button className="fn-btn fn-btn-expand" onClick={() => setOpenGroups((p) => ({ ...p, [group.key]: !p[group.key] }))} aria-label="Show individuals">
                      {isOpen ? "−" : "⋯"}
                    </button>
                  </div>
                </div>

                {isOpen && (
                  <div className="fn-individuals">
                    {group.fish.map((fish) => (
                      <div key={fish.id} className="fn-individual">
                        <span className="fn-cert">Cert. {serialOf(fish)}</span>
                        {fish.gender && fish.gender !== "Unsexed" && fish.gender !== "Not Sure" && (
                          <span className="fn-gender-chip">{fish.gender === "Male" ? "♂" : "♀"}</span>
                        )}
                        <span className="fn-spacer" />
                        {onListOnMarketplace && (
                          <button className="fn-mini fn-mini-sell" onClick={() => onListOnMarketplace(null, fish)}>💰 Sell</button>
                        )}
                        <button className="fn-mini fn-mini-retire" onClick={() => retireOne(fish)}>✕ Retire</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function genderSummary(g) {
  const parts = [];
  if (g.Male) parts.push(`♂ ${g.Male}`);
  if (g.Female) parts.push(`♀ ${g.Female}`);
  if (g.Unsexed) parts.push(`? ${g.Unsexed}`);
  return parts.join("  ");
}

function serialOf(fish) {
  return String(fish.id).padStart(3, "0");
}

function speciesThumb(group, fishbaseData) {
  const match = (fishbaseData || []).find((f) => Number(f.speciesId) === Number(group.speciesId) || f.commonName === group.commonName);
  return match?.masterPhotoUrl || "";
}
