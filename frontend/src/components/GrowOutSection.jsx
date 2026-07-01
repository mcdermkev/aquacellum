import React, { useState, useEffect } from "react";
import { db } from "../db";
import { SpawnGrowoutTracker } from "./SpawnGrowoutTracker";
import { getOverdueSpawns } from "../utils/growoutReminders";
import { BatchGrowOutPanel } from "./BatchGrowOutPanel";
import { EmptyStateIllustration, BreederSkeleton } from "./BreederUXPolish";

/**
 * GrowOutSection — Breeder Tools sub-section that surfaces the grow-out
 * checkpoint tracker for every spawn this breeder owns. Each spawn gets its own
 * <SpawnGrowoutTracker> (the same component used in the per-species hatchery
 * logs), so checkpoints, the egg→fry→alive funnel, survival %, XP, and Poseidon
 * narration all behave identically here. Reads are local-first from Dexie.
 */
export function GrowOutSection({ walletAccount, casualModeActive }) {
  const [spawns, setSpawns] = useState([]);
  const [speciesCatalog, setSpeciesCatalog] = useState({});
  const [loading, setLoading] = useState(true);
  const [overdueSpawns, setOverdueSpawns] = useState([]);

  // Check for overdue spawns on mount
  useEffect(() => {
    getOverdueSpawns().then(setOverdueSpawns).catch(() => {});
  }, [spawns]);

  useEffect(() => {
    if (!walletAccount) {
      setSpawns([]);
      setLoading(false);
      return;
    }
    let active = true;

    const load = async () => {
      try {
        setLoading(true);
        const walletLower = walletAccount.toLowerCase();

        // ownerAddress is not indexed on the spawns table, so full-scan + filter.
        let spawnRecords = [];
        try {
          const allSpawns = await db.spawns.toArray();
          spawnRecords = allSpawns.filter((s) => (s.ownerAddress || "").toLowerCase() === walletLower);
          // Newest spawns first.
          spawnRecords.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
        } catch (e) {
          console.warn("[GrowOut] Failed to load spawns:", e);
        }

        // Resolve species display names (same pattern as SpawningDashboard).
        const catalog = {};
        try {
          const speciesRecords = await db.table("species").toArray();
          for (const sp of speciesRecords) {
            const spId = Number(sp.speciesId || sp.id || sp.specCode);
            if (spId) catalog[spId] = { commonName: sp.commonName || "", scientificName: sp.scientificName || "" };
          }
        } catch (e) {}
        try {
          const manifest = await db.speciesManifest.toArray();
          for (const sp of manifest) {
            const spId = Number(sp.speciesId);
            if (spId && !catalog[spId]) {
              catalog[spId] = { commonName: sp.commonName || "", scientificName: sp.scientificName || "" };
            }
          }
        } catch (e) {}

        if (active) {
          setSpawns(spawnRecords);
          setSpeciesCatalog(catalog);
        }
      } catch (err) {
        console.error("[GrowOut] load error:", err);
      } finally {
        if (active) setLoading(false);
      }
    };

    load();
    return () => { active = false; };
  }, [walletAccount]);

  const getSpeciesName = (speciesId) => {
    const entry = speciesCatalog[speciesId];
    return entry?.commonName || entry?.scientificName || `Species #${speciesId}`;
  };

  const formatDate = (timestamp) => {
    if (!timestamp) return "—";
    const ms = timestamp > 1e12 ? timestamp : timestamp * 1000;
    return new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  };

  if (!walletAccount) {
    return (
      <div style={{ padding: "2rem", textAlign: "center", color: "var(--text-muted)", fontSize: "0.85rem" }}>
        Connect your wallet to track grow-out progress for your spawns.
      </div>
    );
  }

  if (loading) {
    return <BreederSkeleton rows={3} type="card" />;
  }

  if (spawns.length === 0) {
    return (
      <div
        style={{
          padding: "2.5rem 2rem",
          textAlign: "center",
          borderRadius: "12px",
          background: "rgba(255, 255, 255, 0.02)",
          border: "1px dashed var(--glass-border)",
        }}
      >
        <EmptyStateIllustration type="growout" size={100} />
        <div style={{ fontSize: "0.95rem", fontWeight: "600", color: "#fff", marginBottom: "0.35rem" }}>
          No spawns to track yet
        </div>
        <div style={{ fontSize: "0.8rem", color: "var(--text-muted)", maxWidth: "420px", margin: "0 auto", lineHeight: "1.5" }}>
          {casualModeActive
            ? "Once you breed a pair in the Spawning tab, your baby fish will show up here so you can track how many make it."
            : "Log a spawn from the Spawning tab and it will appear here with a grow-out tracker for fry counts, culls, sales, and survival rate."}
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* Overdue spawns nudge banner */}
      {overdueSpawns.length > 0 && (
        <div style={{
          marginBottom: "1rem", padding: "0.75rem 1rem", borderRadius: "10px",
          background: "rgba(251, 191, 36, 0.05)", border: "1px solid rgba(251, 191, 36, 0.15)",
          display: "flex", alignItems: "flex-start", gap: "0.6rem",
        }}>
          <img src="/poseidon-avatar.jpg" alt="" style={{ width: "24px", height: "24px", borderRadius: "50%", objectFit: "cover", flexShrink: 0, marginTop: "1px" }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: "0.75rem", fontWeight: "600", color: "#fbbf24", marginBottom: "3px" }}>
              Poseidon nudge — {overdueSpawns.length} spawn{overdueSpawns.length > 1 ? "s" : ""} overdue
            </div>
            <div style={{ fontSize: "0.7rem", color: "var(--text-muted)", lineHeight: "1.4" }}>
              {overdueSpawns.slice(0, 3).map(s => `${s.speciesName} (#${String(s.spawnId).slice(-4)}) — ${s.daysSince}d`).join(" · ")}
              {overdueSpawns.length > 3 && ` +${overdueSpawns.length - 3} more`}
            </div>
          </div>
        </div>
      )}

      <div style={{ marginBottom: "1.25rem" }}>
        <h2 style={{ fontSize: "1.1rem", fontWeight: "700", color: "#fff", margin: "0 0 0.25rem" }}>
          📊 Grow-Out Tracker
        </h2>
        <p style={{ fontSize: "0.8rem", color: "var(--text-muted)", margin: 0, lineHeight: "1.5" }}>
          {casualModeActive
            ? "Keep tabs on each batch of babies — log how many are growing, how many you've rehomed, and how many made it."
            : "Track fry survival across each spawn: log checkpoints for counts, culls, sales, and losses to monitor your yield funnel and survival rate over time."}
        </p>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
        {spawns.map((spawn) => {
          const eggCount = (spawn.offspringIds || []).length || Number(spawn.offspringCount || 0);
          const speciesName = getSpeciesName(Number(spawn.speciesId));
          return (
            <div
              key={spawn.spawnId}
              style={{
                padding: "1rem 1.25rem",
                borderRadius: "12px",
                background: "rgba(255, 255, 255, 0.02)",
                border: "1px solid var(--glass-border)",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: "0.5rem" }}>
                <div>
                  <span style={{ fontSize: "0.9rem", fontWeight: "600", color: "#fff" }}>{speciesName}</span>
                  <span style={{ fontSize: "0.72rem", color: "var(--text-muted)", marginLeft: "0.5rem" }}>
                    🥚 {eggCount} {eggCount === 1 ? "offspring" : "offspring"}
                  </span>
                </div>
                <span style={{ fontSize: "0.68rem", color: "var(--text-muted)" }}>
                  Spawned {formatDate(spawn.timestamp)}
                </span>
              </div>

              <SpawnGrowoutTracker
                spawnId={spawn.spawnId}
                eggCount={eggCount}
                speciesName={speciesName}
                mode={casualModeActive ? "casual" : "pro"}
              />
            </div>
          );
        })}
      </div>

      {/* Batch Operations Panel (for breeders with many spawns) */}
      <BatchGrowOutPanel walletAccount={walletAccount} casualModeActive={casualModeActive} />
    </div>
  );
}
