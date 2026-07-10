import React, { useState, useEffect } from "react";
import { db } from "../db";
import { relayMoveSpecimen } from "../services/relayer";
import { syncSpecimenToCloud } from "../services/cloudSync";

/**
 * FryNursery — Displays unassigned specimens (currentTankId = 0, status = 0).
 * These are fish that were orphaned by tank decommission, or created without
 * a tank assignment. Users can move them into a tank or list them on the marketplace.
 */
export function FryNursery({ walletAccount, tanks = [], onRefresh, onListOnMarketplace, casualModeActive = false }) {
  const [nurseryFish, setNurseryFish] = useState([]);
  const [loading, setLoading] = useState(true);
  const [moveTarget, setMoveTarget] = useState({}); // { [specimenId]: tankId }
  const [movingId, setMovingId] = useState(null);
  const [expanded, setExpanded] = useState(false);

  const fetchNursery = async () => {
    try {
      const owner = (walletAccount || "").toLowerCase();
      const all = await db.specimens.toArray();
      // Get IDs of all active tanks so we can detect orphans
      const activeTankIds = new Set(
        (await db.tanks.where("ownerAddress").equals(owner).toArray())
          .filter(t => t.active !== false)
          .map(t => Number(t.id))
      );
      const unassigned = all.filter(s => {
        if (Number(s.status ?? 0) !== 0) return false;
        const specOwner = (s.ownerAddress || "").toLowerCase();
        if (specOwner !== owner && specOwner !== "") return false;
        const tankId = Number(s.currentTankId || 0);
        // Unassigned: no tank, or assigned to a tank that no longer exists/is inactive
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

  useEffect(() => {
    fetchNursery();
  }, [walletAccount]);

  const handleMove = async (specimenId) => {
    const targetTankId = Number(moveTarget[specimenId]);
    if (!targetTankId) return;
    setMovingId(specimenId);
    try {
      const result = await relayMoveSpecimen({ specimenId, targetTankId });
      if (result.success) {
        await fetchNursery();
        if (onRefresh) onRefresh();
      }
    } catch (err) {
      console.error("[FryNursery] Move failed:", err);
    } finally {
      setMovingId(null);
    }
  };

  const handleRetire = async (specimenId) => {
    try {
      await db.specimens.update(specimenId, { status: 1 });
      const updated = await db.specimens.get(specimenId);
      if (updated) syncSpecimenToCloud(updated).catch(() => {});
      await fetchNursery();
    } catch (err) {
      console.error("[FryNursery] Retire failed:", err);
    }
  };

  // Active tanks the user can move fish into
  const activeTanks = tanks.filter(t => t.active !== false);

  if (loading) return null;
  if (nurseryFish.length === 0) return null;

  const displayFish = expanded ? nurseryFish : nurseryFish.slice(0, 5);

  return (
    <div className="glass-card" style={{ marginTop: "1.5rem", padding: "1.25rem", borderColor: "rgba(251, 191, 36, 0.2)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <span style={{ fontSize: "1.3rem" }}>🐣</span>
          <h3 style={{ fontSize: "1rem", color: "#fff", margin: 0 }}>
            {casualModeActive ? "Fish Nursery" : "Specimen Nursery"}
          </h3>
          <span className="badge badge-amber" style={{ fontSize: "0.7rem" }}>
            {nurseryFish.length} unassigned
          </span>
        </div>
        {nurseryFish.length > 5 && (
          <button
            onClick={() => setExpanded(!expanded)}
            style={{
              background: "transparent",
              border: "none",
              color: "var(--accent-blue)",
              cursor: "pointer",
              fontSize: "0.75rem",
            }}
          >
            {expanded ? "Show less" : `Show all (${nurseryFish.length})`}
          </button>
        )}
      </div>

      <p style={{ color: "var(--text-muted)", fontSize: "0.78rem", marginBottom: "1rem", lineHeight: 1.5 }}>
        {casualModeActive
          ? "These fish aren't assigned to a tank yet. Move them to a tank or list them for sale."
          : "Unassigned specimens — orphaned by decommission or created without tank assignment. Assign to a unit or list on marketplace."}
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
        {displayFish.map((fish) => {
          const serial = String(fish.id).padStart(3, "0");
          const name = fish.commonName || fish.scientificName || "Unknown";
          return (
            <div
              key={fish.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.75rem",
                padding: "0.6rem 0.8rem",
                background: "rgba(0, 0, 0, 0.2)",
                borderRadius: "8px",
                border: "1px solid rgba(255, 255, 255, 0.05)",
                flexWrap: "wrap",
              }}
            >
              {/* Fish info */}
              <div style={{ flex: "1 1 140px", minWidth: "120px" }}>
                <span style={{ color: "var(--accent-green)", fontSize: "0.72rem", fontWeight: 600 }}>
                  Cert. {serial}
                </span>
                <span style={{ color: "#fff", fontSize: "0.82rem", marginLeft: "0.5rem" }}>
                  {name}
                </span>
                {fish.gender && fish.gender !== "Unsexed" && (
                  <span style={{ color: "var(--text-muted)", fontSize: "0.7rem", marginLeft: "0.4rem" }}>
                    ({fish.gender})
                  </span>
                )}
              </div>

              {/* Move to tank selector */}
              <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", flex: "1 1 200px" }}>
                <select
                  value={moveTarget[fish.id] || ""}
                  onChange={(e) => setMoveTarget(prev => ({ ...prev, [fish.id]: e.target.value }))}
                  style={{
                    flex: 1,
                    padding: "0.3rem 0.5rem",
                    fontSize: "0.72rem",
                    background: "rgba(0, 0, 0, 0.3)",
                    border: "1px solid rgba(255, 255, 255, 0.1)",
                    borderRadius: "5px",
                    color: "#fff",
                    maxWidth: "160px",
                  }}
                  aria-label={`Select tank for specimen ${serial}`}
                >
                  <option value="">Move to tank...</option>
                  {activeTanks.map(t => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
                <button
                  onClick={() => handleMove(fish.id)}
                  disabled={!moveTarget[fish.id] || movingId === fish.id}
                  style={{
                    padding: "0.3rem 0.6rem",
                    fontSize: "0.7rem",
                    fontWeight: 500,
                    borderRadius: "5px",
                    border: "1px solid rgba(56, 189, 248, 0.3)",
                    background: moveTarget[fish.id] ? "rgba(56, 189, 248, 0.1)" : "transparent",
                    color: moveTarget[fish.id] ? "var(--accent-blue)" : "var(--text-muted)",
                    cursor: moveTarget[fish.id] ? "pointer" : "not-allowed",
                    opacity: movingId === fish.id ? 0.5 : 1,
                    whiteSpace: "nowrap",
                  }}
                  aria-label={`Move specimen ${serial} to selected tank`}
                >
                  {movingId === fish.id ? "Moving..." : "→ Move"}
                </button>
              </div>

              {/* Actions */}
              <div style={{ display: "flex", gap: "0.3rem" }}>
                {onListOnMarketplace && (
                  <button
                    onClick={() => onListOnMarketplace(null, fish)}
                    style={{
                      padding: "0.25rem 0.5rem",
                      fontSize: "0.68rem",
                      borderRadius: "4px",
                      border: "1px solid rgba(52, 211, 153, 0.2)",
                      background: "rgba(52, 211, 153, 0.06)",
                      color: "var(--accent-green)",
                      cursor: "pointer",
                      whiteSpace: "nowrap",
                    }}
                    aria-label={`List specimen ${serial} on marketplace`}
                  >
                    💰 Sell
                  </button>
                )}
                <button
                  onClick={() => {
                    if (window.confirm(`Retire Cert. ${serial} (${name})? This marks it as inactive and removes it from your inventory.`)) {
                      handleRetire(fish.id);
                    }
                  }}
                  style={{
                    padding: "0.25rem 0.5rem",
                    fontSize: "0.68rem",
                    borderRadius: "4px",
                    border: "1px solid rgba(248, 113, 113, 0.2)",
                    background: "rgba(248, 113, 113, 0.06)",
                    color: "var(--accent-red, #f87171)",
                    cursor: "pointer",
                    whiteSpace: "nowrap",
                  }}
                  aria-label={`Retire specimen ${serial}`}
                >
                  ✕ Retire
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
