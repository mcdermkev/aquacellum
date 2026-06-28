import React, { useState, useEffect } from "react";
import { db } from "../db";
import { addXp } from "../utils/xp";
import { generateSpawnNarration } from "../utils/spawnNarration";

// Grow-out checkpoint types
export const GROWOUT_TYPES = {
  fry_count: { emoji: "🐟", label: "Fry Count Update" },
  cull: { emoji: "✂️", label: "Culled" },
  sold: { emoji: "💰", label: "Sold" },
  loss: { emoji: "💀", label: "Natural Loss" },
  moved: { emoji: "🔄", label: "Moved to Grow-Out" },
  note: { emoji: "📝", label: "Observation" },
};

// Inline grow-out tracker component for a single spawn
export function SpawnGrowoutTracker({ spawnId, eggCount, speciesName, mode }) {
  const [checkpoints, setCheckpoints] = useState([]);
  const [expanded, setExpanded] = useState(false);
  const [narrationLoading, setNarrationLoading] = useState(false);
  const [latestNarration, setLatestNarration] = useState(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [formType, setFormType] = useState("fry_count");
  const [formCount, setFormCount] = useState("");
  const [formNote, setFormNote] = useState("");

  const loadCheckpoints = async () => {
    try {
      const rows = await db.spawnGrowout.where("spawnId").equals(spawnId).toArray();
      setCheckpoints(rows.sort((a, b) => b.timestamp - a.timestamp));
    } catch (e) {
      console.warn("Failed to load growout checkpoints:", e);
    }
  };

  useEffect(() => {
    loadCheckpoints();
  }, [spawnId]);

  const handleAddCheckpoint = async () => {
    const count = parseInt(formCount, 10);
    if (isNaN(count) && formType !== "note") return;

    await db.spawnGrowout.add({
      spawnId,
      timestamp: Math.round(Date.now() / 1000),
      type: formType,
      count: formType === "note" ? 0 : count,
      note: formNote.trim() || GROWOUT_TYPES[formType].label
    });

    addXp(5, "Logged Grow-Out Checkpoint");
    setFormCount("");
    setFormNote("");
    setShowAddForm(false);
    await loadCheckpoints();

    // Trigger Poseidon narration in the background (non-blocking)
    setNarrationLoading(true);
    generateSpawnNarration({
      spawnId,
      checkpointType: formType,
      count: formType === "note" ? 0 : count,
      note: formNote.trim(),
      yieldSummary: {
        eggs: eggCount || 0,
        fry: totalFry,
        alive: survivors,
        sold: totalSold,
        lost: totalCulled + totalLoss,
        survivalRate: survivalRate || 0
      },
      speciesName: speciesName || 'Unknown species',
      mode: mode || 'casual'
    }).then(narration => {
      if (narration) {
        setLatestNarration(narration);
        loadCheckpoints(); // Refresh to show the narration entry
      }
    }).finally(() => setNarrationLoading(false));
  };

  // Calculate yield summary
  const totalFry = checkpoints.filter(c => c.type === "fry_count").reduce((max, c) => Math.max(max, c.count || 0), 0);
  const totalCulled = checkpoints.filter(c => c.type === "cull").reduce((sum, c) => sum + (c.count || 0), 0);
  const totalSold = checkpoints.filter(c => c.type === "sold").reduce((sum, c) => sum + (c.count || 0), 0);
  const totalLoss = checkpoints.filter(c => c.type === "loss").reduce((sum, c) => sum + (c.count || 0), 0);
  const survivors = Math.max(0, totalFry - totalCulled - totalSold - totalLoss);
  const survivalRate = totalFry > 0 ? Math.round(((totalFry - totalLoss) / totalFry) * 100) : null;

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        style={{
          background: "none",
          border: "none",
          color: "var(--accent-blue)",
          fontSize: "0.72rem",
          cursor: "pointer",
          padding: "0.25rem 0",
          display: "flex",
          alignItems: "center",
          gap: "0.3rem"
        }}
      >
        📊 {checkpoints.length > 0 ? `Grow-Out (${checkpoints.length} checkpoints)` : "Track Grow-Out"}
        {survivalRate !== null && (
          <span style={{
            fontSize: "0.65rem",
            padding: "0.1rem 0.4rem",
            borderRadius: "10px",
            background: survivalRate >= 80 ? "rgba(52,211,153,0.12)" : survivalRate >= 50 ? "rgba(251,191,36,0.12)" : "rgba(248,113,113,0.12)",
            color: survivalRate >= 80 ? "var(--accent-green)" : survivalRate >= 50 ? "var(--accent-amber)" : "var(--accent-red)",
            border: `1px solid ${survivalRate >= 80 ? "rgba(52,211,153,0.3)" : survivalRate >= 50 ? "rgba(251,191,36,0.3)" : "rgba(248,113,113,0.3)"}`
          }}>
            {survivalRate}% survival
          </span>
        )}
      </button>
    );
  }

  return (
    <div style={{
      marginTop: "0.75rem",
      padding: "0.75rem 1rem",
      borderRadius: "6px",
      background: "rgba(56, 189, 248, 0.03)",
      border: "1px solid rgba(56, 189, 248, 0.15)"
    }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" }}>
        <span style={{ fontSize: "0.8rem", fontWeight: "600", color: "#fff" }}>📊 Grow-Out Tracker</span>
        <button
          type="button"
          onClick={() => setExpanded(false)}
          style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: "0.85rem" }}
        >
          ▲
        </button>
      </div>

      {/* Yield funnel summary */}
      <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", marginBottom: "0.75rem" }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: "1rem", fontWeight: "700", color: "var(--accent-amber)" }}>{eggCount}</div>
          <div style={{ fontSize: "0.6rem", color: "var(--text-muted)" }}>Eggs</div>
        </div>
        <span style={{ color: "var(--text-muted)", alignSelf: "center" }}>→</span>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: "1rem", fontWeight: "700", color: "var(--accent-blue)" }}>{totalFry || "—"}</div>
          <div style={{ fontSize: "0.6rem", color: "var(--text-muted)" }}>Fry</div>
        </div>
        <span style={{ color: "var(--text-muted)", alignSelf: "center" }}>→</span>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: "1rem", fontWeight: "700", color: "var(--accent-green)" }}>{survivors}</div>
          <div style={{ fontSize: "0.6rem", color: "var(--text-muted)" }}>Alive</div>
        </div>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: "1rem", fontWeight: "700", color: "var(--accent-amber)" }}>{totalSold}</div>
          <div style={{ fontSize: "0.6rem", color: "var(--text-muted)" }}>Sold</div>
        </div>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: "1rem", fontWeight: "700", color: "var(--accent-red)" }}>{totalCulled + totalLoss}</div>
          <div style={{ fontSize: "0.6rem", color: "var(--text-muted)" }}>Lost/Culled</div>
        </div>
        {survivalRate !== null && (
          <div style={{ textAlign: "center", marginLeft: "auto" }}>
            <div style={{ fontSize: "1rem", fontWeight: "700", color: survivalRate >= 80 ? "var(--accent-green)" : survivalRate >= 50 ? "var(--accent-amber)" : "var(--accent-red)" }}>
              {survivalRate}%
            </div>
            <div style={{ fontSize: "0.6rem", color: "var(--text-muted)" }}>Survival</div>
          </div>
        )}
      </div>

      {/* Add checkpoint form */}
      {!showAddForm ? (
        <button
          type="button"
          onClick={() => setShowAddForm(true)}
          style={{
            width: "100%",
            padding: "0.4rem",
            fontSize: "0.72rem",
            fontWeight: "600",
            background: "rgba(56, 189, 248, 0.08)",
            border: "1px dashed rgba(56, 189, 248, 0.3)",
            borderRadius: "4px",
            color: "var(--accent-blue)",
            cursor: "pointer"
          }}
        >
          + Add Checkpoint
        </button>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", padding: "0.5rem", background: "rgba(0,0,0,0.2)", borderRadius: "4px" }}>
          <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>
            {Object.entries(GROWOUT_TYPES).map(([key, { emoji, label }]) => (
              <button
                key={key}
                type="button"
                onClick={() => setFormType(key)}
                style={{
                  padding: "0.25rem 0.5rem",
                  fontSize: "0.68rem",
                  border: "1px solid",
                  borderRadius: "4px",
                  cursor: "pointer",
                  background: formType === key ? "rgba(56,189,248,0.15)" : "transparent",
                  borderColor: formType === key ? "rgba(56,189,248,0.4)" : "var(--glass-border)",
                  color: formType === key ? "var(--accent-blue)" : "var(--text-muted)"
                }}
              >
                {emoji} {label}
              </button>
            ))}
          </div>
          <div style={{ display: "flex", gap: "0.4rem" }}>
            {formType !== "note" && (
              <input
                type="number"
                min="0"
                value={formCount}
                onChange={(e) => setFormCount(e.target.value)}
                placeholder="Count"
                style={{ width: "70px", padding: "0.35rem", background: "rgba(255,255,255,0.03)", border: "1px solid var(--glass-border)", color: "#fff", borderRadius: "4px", fontSize: "0.75rem" }}
              />
            )}
            <input
              type="text"
              value={formNote}
              onChange={(e) => setFormNote(e.target.value)}
              placeholder="Note (optional)"
              style={{ flex: 1, padding: "0.35rem", background: "rgba(255,255,255,0.03)", border: "1px solid var(--glass-border)", color: "#fff", borderRadius: "4px", fontSize: "0.75rem" }}
            />
            <button
              type="button"
              onClick={handleAddCheckpoint}
              disabled={formType !== "note" && !formCount}
              className="btn-primary"
              style={{ padding: "0.35rem 0.75rem", fontSize: "0.72rem" }}
            >
              Save
            </button>
            <button
              type="button"
              onClick={() => { setShowAddForm(false); setFormCount(""); setFormNote(""); }}
              style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: "0.8rem" }}
            >
              ×
            </button>
          </div>
        </div>
      )}

      {/* Checkpoint history */}
      {checkpoints.length > 0 && (
        <div style={{ marginTop: "0.75rem", display: "flex", flexDirection: "column", gap: "0.35rem", maxHeight: "160px", overflowY: "auto" }}>
          {checkpoints.map((cp) => (
            cp.type === 'narration' ? (
              // Poseidon narration line — styled distinctly
              <div key={cp.id} style={{
                display: "flex",
                alignItems: "flex-start",
                gap: "0.4rem",
                fontSize: "0.72rem",
                padding: "0.4rem 0.5rem",
                borderRadius: "6px",
                background: "rgba(56, 189, 248, 0.04)",
                border: "1px solid rgba(56, 189, 248, 0.12)",
                color: "rgba(103, 232, 249, 0.9)",
                fontStyle: "italic",
                lineHeight: "1.4"
              }}>
                <img src="/poseidon-avatar.jpg" alt="" style={{ width: "16px", height: "16px", borderRadius: "50%", objectFit: "cover", flexShrink: 0, marginTop: "1px", opacity: 0.8 }} />
                <span>{cp.note}</span>
              </div>
            ) : (
              <div key={cp.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "0.7rem", padding: "0.2rem 0", borderBottom: "1px solid rgba(255,255,255,0.03)" }}>
                <span>
                  <span style={{ marginRight: "0.3rem" }}>{GROWOUT_TYPES[cp.type]?.emoji || "📝"}</span>
                  <span style={{ color: "var(--text-secondary)" }}>{GROWOUT_TYPES[cp.type]?.label || cp.type}</span>
                  {cp.count > 0 && <strong style={{ color: "#fff", marginLeft: "0.3rem" }}>×{cp.count}</strong>}
                  {cp.note && <span style={{ color: "var(--text-muted)", marginLeft: "0.4rem" }}>— {cp.note}</span>}
                </span>
                <span style={{ color: "var(--text-muted)", fontSize: "0.65rem", whiteSpace: "nowrap" }}>
                  {new Date(cp.timestamp * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                </span>
              </div>
            )
          ))}
          {narrationLoading && (
            <div style={{ fontSize: "0.68rem", color: "rgba(56, 189, 248, 0.6)", fontStyle: "italic", padding: "0.3rem 0", display: "flex", alignItems: "center", gap: "0.3rem" }}>
              <img src="/poseidon-avatar.jpg" alt="" style={{ width: "14px", height: "14px", borderRadius: "50%", objectFit: "cover", opacity: 0.5 }} />
              Poseidon is observing...
            </div>
          )}
        </div>
      )}
    </div>
  );
}
