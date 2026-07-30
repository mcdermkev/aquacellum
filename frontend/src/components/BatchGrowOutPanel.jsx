import React, { useState, useEffect } from "react";
import { db } from "../db";
import { addXp } from "../utils/xp";
import { syncGrowoutCheckpointsToCloud } from "../services/cloudSync";
import { formatLocalRecordRef } from "../utils/specimenIdentity";
import { summarizeGrowout } from "../utils/growoutFunnel";
import { hasEntitlement, getRequiredTierFor } from "../services/entitlements";
import { getXp } from "../utils/xp";

/**
 * BatchGrowOutPanel — Table/grid view for managing multiple spawns at once.
 *
 * Features:
 * - Tabular view of all active spawns with key metrics
 * - Multi-select checkboxes for bulk operations
 * - Bulk actions: mark as moved, log fry count, batch cull, batch note
 * - Sort by date, species, survival rate
 * - Quick-filter for overdue spawns
 */

const BATCH_ACTIONS = [
  { id: "fry_count", label: "Log Fry Count", icon: "🐟", needsCount: true },
  { id: "moved", label: "Mark Moved", icon: "🔄", needsCount: false },
  { id: "cull", label: "Log Cull", icon: "✂️", needsCount: true },
  { id: "sold", label: "Log Sold", icon: "💰", needsCount: true },
  { id: "loss", label: "Log Loss", icon: "💀", needsCount: true },
  { id: "note", label: "Add Note", icon: "📝", needsCount: false },
];

export function BatchGrowOutPanel({ walletAccount, casualModeActive }) {
  const [spawns, setSpawns] = useState([]);
  const [checkpointData, setCheckpointData] = useState({});
  const [speciesCatalog, setSpeciesCatalog] = useState({});
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(new Set());
  const [sortBy, setSortBy] = useState("date"); // date, species, survival, overdue
  const [showBatchForm, setShowBatchForm] = useState(false);
  const [batchAction, setBatchAction] = useState("fry_count");
  const [batchCount, setBatchCount] = useState("");
  const [batchNote, setBatchNote] = useState("");
  const [batchBusy, setBatchBusy] = useState(false);
  const [filterOverdue, setFilterOverdue] = useState(false);

  // Multi-spawn actions only. Per-spawn checkpoint logging is REQUIRED and lives
  // on each spawn's own tracker, never gated.
  const canBulkManage = hasEntitlement("bulk_management", { xp: getXp() });
  const bulkRequiredTier = getRequiredTierFor("bulk_management");

  useEffect(() => {
    if (!walletAccount) { setLoading(false); return; }
    loadData();
  }, [walletAccount]);

  const loadData = async () => {
    try {
      setLoading(true);
      const walletLower = walletAccount.toLowerCase();

      const allSpawns = await db.spawns.toArray();
      const mySpawns = allSpawns.filter(s => (s.ownerAddress || "").toLowerCase() === walletLower);

      const allCheckpoints = await db.spawnGrowout.toArray();
      const cpMap = {};
      for (const cp of allCheckpoints) {
        if (!cpMap[cp.spawnId]) cpMap[cp.spawnId] = [];
        cpMap[cp.spawnId].push(cp);
      }
      setCheckpointData(cpMap);

      const catalog = {};
      try {
        const records = await db.table("species").toArray();
        for (const sp of records) {
          const id = Number(sp.speciesId || sp.specCode);
          if (id) catalog[id] = sp.commonName || sp.scientificName || "";
        }
      } catch (e) {}
      setSpeciesCatalog(catalog);
      setSpawns(mySpawns);
    } catch (err) {
      console.error("[BatchGrowOut] Load failed:", err);
    } finally {
      setLoading(false);
    }
  };

  // Calculate spawn metrics via the shared funnel (utils/growoutFunnel.js).
  const getSpawnMetrics = (spawn) => {
    const eggCount = (spawn.offspringIds || []).length || Number(spawn.offspringCount || 0);
    const funnel = summarizeGrowout(checkpointData[spawn.spawnId], { eggCount });
    const lastCp = funnel.lastCheckpointAt || spawn.timestamp || 0;

    return {
      maxFry: funnel.fry,
      alive: funnel.alive,
      sold: funnel.sold,
      // This column is labelled "lost" in the table and has always meant
      // "removed by loss or cull", as distinct from sold.
      losses: funnel.lost + funnel.culled,
      survival: funnel.survivalRate,
      lastCp,
      daysSince: Math.floor((Date.now() / 1000 - lastCp) / 86400),
      eggCount,
      checkpointCount: funnel.checkpointCount,
    };
  };

  // Sort and filter spawns
  const processedSpawns = spawns
    .map(s => ({ ...s, metrics: getSpawnMetrics(s) }))
    .filter(s => !filterOverdue || s.metrics.daysSince >= 5)
    .sort((a, b) => {
      switch (sortBy) {
        case "species": return (speciesCatalog[a.speciesId] || "").localeCompare(speciesCatalog[b.speciesId] || "");
        case "survival": return (b.metrics.survival || 0) - (a.metrics.survival || 0);
        case "overdue": return b.metrics.daysSince - a.metrics.daysSince;
        default: return (b.timestamp || 0) - (a.timestamp || 0);
      }
    });

  const toggleSelect = (spawnId) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(spawnId)) next.delete(spawnId);
      else next.add(spawnId);
      return next;
    });
  };

  const selectAll = () => {
    if (selected.size === processedSpawns.length) setSelected(new Set());
    else setSelected(new Set(processedSpawns.map(s => s.spawnId)));
  };

  const handleBatchSubmit = async () => {
    if (selected.size === 0) return;
    // Guard the action itself, not just its button — the UI can be stale and the
    // entitlement is the rule, not the rendering.
    if (!canBulkManage) return;
    const action = BATCH_ACTIONS.find(a => a.id === batchAction);
    if (!action) return;

    const count = parseInt(batchCount, 10);
    if (action.needsCount && (isNaN(count) || count <= 0)) return;

    setBatchBusy(true);
    try {
      const timestamp = Math.round(Date.now() / 1000);
      const entries = [];

      for (const spawnId of selected) {
        entries.push({
          spawnId,
          timestamp,
          type: batchAction,
          count: action.needsCount ? count : 0,
          note: batchNote.trim() || `Batch: ${action.label}`,
        });
      }

      await db.spawnGrowout.bulkAdd(entries);
      // Fire-and-forget cloud mirror. walletAccount is passed explicitly so the
      // batch skips a per-checkpoint spawn-owner lookup.
      syncGrowoutCheckpointsToCloud(entries, walletAccount).catch(() => {});
      addXp(5 * selected.size, `Batch logged ${action.label} × ${selected.size} spawns`);

      // Reset
      setShowBatchForm(false);
      setBatchCount("");
      setBatchNote("");
      setSelected(new Set());
      await loadData();
    } catch (err) {
      console.error("[BatchGrowOut] Batch submit failed:", err);
    } finally {
      setBatchBusy(false);
    }
  };

  const formatDate = (ts) => {
    if (!ts) return "—";
    const ms = ts > 1e12 ? ts : ts * 1000;
    return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  };

  if (loading) return <div className="glass-card shimmer-placeholder" style={{ height: "200px", borderRadius: "var(--radius-md)" }} />;

  if (spawns.length < 3) return null; // Only show for breeders with 3+ spawns

  return (
    <div style={{ marginTop: "1.5rem" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem", flexWrap: "wrap", gap: "0.5rem" }}>
        <div>
          <h3 style={{ fontSize: "0.95rem", fontWeight: "700", color: "#fff", margin: "0 0 0.15rem" }}>
            ⚡ Batch Operations
          </h3>
          <p style={{ fontSize: "0.72rem", color: "var(--text-muted)", margin: 0 }}>
            Select multiple spawns to log checkpoints in bulk
          </p>
        </div>
        <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>
          {/* Sort chips */}
          {[
            { id: "date", label: "Recent" },
            { id: "overdue", label: "Overdue" },
            { id: "survival", label: "Survival %" },
            { id: "species", label: "Species" },
          ].map(s => (
            <button key={s.id} onClick={() => setSortBy(s.id)} style={{
              padding: "4px 10px", borderRadius: "12px", fontSize: "0.65rem", fontWeight: "600",
              background: sortBy === s.id ? "rgba(139,92,246,0.12)" : "transparent",
              border: `1px solid ${sortBy === s.id ? "rgba(139,92,246,0.3)" : "rgba(255,255,255,0.06)"}`,
              color: sortBy === s.id ? "#a78bfa" : "var(--text-muted)", cursor: "pointer",
            }}>
              {s.label}
            </button>
          ))}
          <button onClick={() => setFilterOverdue(!filterOverdue)} style={{
            padding: "4px 10px", borderRadius: "12px", fontSize: "0.65rem", fontWeight: "600",
            background: filterOverdue ? "rgba(251,191,36,0.12)" : "transparent",
            border: `1px solid ${filterOverdue ? "rgba(251,191,36,0.3)" : "rgba(255,255,255,0.06)"}`,
            color: filterOverdue ? "#fbbf24" : "var(--text-muted)", cursor: "pointer",
          }}>
            ⏰ Overdue Only
          </button>
        </div>
      </div>

      {/* Batch action bar (visible when items selected).
          Logging a checkpoint on ONE spawn is never gated — that's
          `breeder_growout_tracking`, a REQUIRED capability, and it's available
          on every spawn card above. Applying one across MANY spawns at once is a
          scale convenience, gated on the same `bulk_management` tier the Breeder
          Terminal uses for bulk fulfillment. The table, the metrics, and the
          per-spawn trackers all stay fully usable either way. */}
      {selected.size > 0 && !canBulkManage && (
        <div style={{
          padding: "0.6rem 0.8rem", marginBottom: "0.6rem", borderRadius: "8px",
          background: "rgba(255,255,255,0.02)", border: "1px dashed var(--glass-border)",
          display: "flex", alignItems: "center", gap: "0.6rem", flexWrap: "wrap",
        }}>
          <span style={{ fontSize: "0.75rem", color: "var(--text-muted)", lineHeight: 1.5 }}>
            {selected.size} selected — applying one action across several spawns at once unlocks at{" "}
            <strong style={{ color: "#a78bfa" }}>{bulkRequiredTier}</strong>. You can log a checkpoint on
            any single spawn now, from its own tracker.
          </span>
        </div>
      )}
      {selected.size > 0 && canBulkManage && (
        <div style={{
          padding: "0.6rem 0.8rem", marginBottom: "0.6rem", borderRadius: "8px",
          background: "rgba(139, 92, 246, 0.06)", border: "1px solid rgba(139, 92, 246, 0.2)",
          display: "flex", alignItems: "center", gap: "0.6rem", flexWrap: "wrap",
        }}>
          <span style={{ fontSize: "0.75rem", fontWeight: "600", color: "#a78bfa" }}>
            {selected.size} selected
          </span>
          {!showBatchForm ? (
            <button onClick={() => setShowBatchForm(true)} style={{
              padding: "5px 12px", borderRadius: "6px", fontSize: "0.72rem", fontWeight: "600",
              background: "rgba(139,92,246,0.15)", border: "1px solid rgba(139,92,246,0.3)",
              color: "#fff", cursor: "pointer",
            }}>
              Apply Batch Action
            </button>
          ) : (
            <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap", alignItems: "center" }}>
              <select
                value={batchAction}
                onChange={(e) => setBatchAction(e.target.value)}
                style={{ padding: "4px 8px", borderRadius: "4px", fontSize: "0.72rem", background: "rgba(0,0,0,0.3)", border: "1px solid var(--glass-border)", color: "#fff" }}
              >
                {BATCH_ACTIONS.map(a => (
                  <option key={a.id} value={a.id}>{a.icon} {a.label}</option>
                ))}
              </select>
              {BATCH_ACTIONS.find(a => a.id === batchAction)?.needsCount && (
                <input
                  type="number" min="1" value={batchCount}
                  onChange={(e) => setBatchCount(e.target.value)}
                  placeholder="Count"
                  style={{ width: "60px", padding: "4px 6px", borderRadius: "4px", fontSize: "0.72rem", background: "rgba(0,0,0,0.3)", border: "1px solid var(--glass-border)", color: "#fff" }}
                />
              )}
              <input
                type="text" value={batchNote}
                onChange={(e) => setBatchNote(e.target.value)}
                placeholder="Note (optional)"
                style={{ width: "120px", padding: "4px 6px", borderRadius: "4px", fontSize: "0.72rem", background: "rgba(0,0,0,0.3)", border: "1px solid var(--glass-border)", color: "#fff" }}
              />
              <button onClick={handleBatchSubmit} disabled={batchBusy} className="btn-primary" style={{ padding: "4px 12px", fontSize: "0.72rem" }}>
                {batchBusy ? "Saving..." : `Apply to ${selected.size}`}
              </button>
              <button onClick={() => setShowBatchForm(false)} style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: "0.8rem" }}>×</button>
            </div>
          )}
          <button onClick={() => setSelected(new Set())} style={{ marginLeft: "auto", background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: "0.68rem" }}>
            Clear selection
          </button>
        </div>
      )}

      {/* Table */}
      <div style={{ borderRadius: "10px", overflow: "hidden", border: "1px solid rgba(139,92,246,0.1)" }}>
        {/* Header row */}
        <div style={{
          display: "grid", gridTemplateColumns: "32px 1fr 70px 60px 60px 55px 60px 60px",
          gap: "4px", padding: "8px 12px", background: "rgba(139,92,246,0.04)",
          borderBottom: "1px solid rgba(139,92,246,0.08)",
        }}>
          <div style={{ display: "flex", alignItems: "center" }}>
            <input
              type="checkbox"
              checked={selected.size === processedSpawns.length && processedSpawns.length > 0}
              onChange={selectAll}
              style={{ accentColor: "#a78bfa" }}
            />
          </div>
          <span style={{ fontSize: "0.62rem", fontWeight: "700", color: "var(--text-muted)", textTransform: "uppercase" }}>Species / Spawn</span>
          <span style={{ fontSize: "0.62rem", fontWeight: "700", color: "var(--text-muted)", textTransform: "uppercase", textAlign: "center" }}>Spawned</span>
          <span style={{ fontSize: "0.62rem", fontWeight: "700", color: "var(--text-muted)", textTransform: "uppercase", textAlign: "center" }}>Fry</span>
          <span style={{ fontSize: "0.62rem", fontWeight: "700", color: "var(--text-muted)", textTransform: "uppercase", textAlign: "center" }}>Alive</span>
          <span style={{ fontSize: "0.62rem", fontWeight: "700", color: "var(--text-muted)", textTransform: "uppercase", textAlign: "center" }}>Surv%</span>
          <span style={{ fontSize: "0.62rem", fontWeight: "700", color: "var(--text-muted)", textTransform: "uppercase", textAlign: "center" }}>Logs</span>
          <span style={{ fontSize: "0.62rem", fontWeight: "700", color: "var(--text-muted)", textTransform: "uppercase", textAlign: "center" }}>Last</span>
        </div>

        {/* Data rows */}
        <div style={{ maxHeight: "320px", overflowY: "auto" }}>
          {processedSpawns.map((spawn) => {
            const m = spawn.metrics;
            const isSelected = selected.has(spawn.spawnId);
            const isOverdue = m.daysSince >= 5;
            const speciesName = speciesCatalog[spawn.speciesId] || `#${spawn.speciesId}`;

            return (
              <div
                key={spawn.spawnId}
                onClick={() => toggleSelect(spawn.spawnId)}
                style={{
                  display: "grid", gridTemplateColumns: "32px 1fr 70px 60px 60px 55px 60px 60px",
                  gap: "4px", padding: "8px 12px", cursor: "pointer",
                  background: isSelected ? "rgba(139,92,246,0.06)" : "transparent",
                  borderBottom: "1px solid rgba(255,255,255,0.03)",
                  transition: "background 0.15s",
                }}
                onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.background = "rgba(255,255,255,0.02)"; }}
                onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.background = "transparent"; }}
              >
                <div style={{ display: "flex", alignItems: "center" }}>
                  <input type="checkbox" checked={isSelected} readOnly style={{ accentColor: "#a78bfa", pointerEvents: "none" }} />
                </div>
                <div style={{ overflow: "hidden" }}>
                  <div style={{ fontSize: "0.78rem", fontWeight: "500", color: "#fff", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {speciesName}
                  </div>
                  <div style={{ fontSize: "0.6rem", color: "var(--text-muted)" }}>
                    #{formatLocalRecordRef(spawn.spawnId)}
                  </div>
                </div>
                <div style={{ textAlign: "center", fontSize: "0.72rem", color: "var(--text-secondary)", alignSelf: "center" }}>
                  {formatDate(spawn.timestamp)}
                </div>
                <div style={{ textAlign: "center", fontSize: "0.78rem", fontWeight: "600", color: "#60a5fa", alignSelf: "center" }}>
                  {m.maxFry || m.eggCount || "—"}
                </div>
                <div style={{ textAlign: "center", fontSize: "0.78rem", fontWeight: "600", color: "#34d399", alignSelf: "center" }}>
                  {m.alive}
                </div>
                <div style={{ textAlign: "center", fontSize: "0.72rem", fontWeight: "600", alignSelf: "center", color: m.survival === null ? "var(--text-muted)" : m.survival >= 80 ? "#34d399" : m.survival >= 50 ? "#fbbf24" : "#f87171" }}>
                  {m.survival !== null ? `${m.survival}%` : "—"}
                </div>
                <div style={{ textAlign: "center", fontSize: "0.72rem", color: "var(--text-muted)", alignSelf: "center" }}>
                  {m.checkpointCount}
                </div>
                <div style={{ textAlign: "center", fontSize: "0.68rem", alignSelf: "center", color: isOverdue ? "#fbbf24" : "var(--text-muted)" }}>
                  {m.daysSince === 0 ? "Today" : `${m.daysSince}d`}
                  {isOverdue && <span style={{ marginLeft: "2px" }}>⏰</span>}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Summary footer */}
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: "0.5rem", padding: "0 0.25rem" }}>
        <span style={{ fontSize: "0.65rem", color: "var(--text-muted)" }}>
          {processedSpawns.length} spawn{processedSpawns.length !== 1 ? "s" : ""} shown
          {filterOverdue && ` (${spawns.length} total)`}
        </span>
        <span style={{ fontSize: "0.65rem", color: "var(--text-muted)" }}>
          Click rows to select · Shift+click for range
        </span>
      </div>
    </div>
  );
}

export default BatchGrowOutPanel;
