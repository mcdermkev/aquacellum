import React, { useState, useEffect } from "react";
import { db } from "../db";
import { addXp } from "../utils/xp";
import { generateSpawnNarration } from "../utils/spawnNarration";
import { GrowOutChart } from "./GrowOutChart";
import { compressImage } from "../utils/imageCompression";
import { AnimatedFunnel, ConfettiCelebration } from "./BreederUXPolish";
import { ShareButton } from "./ShareButton";
import { generateNarrationCard, generateSurvivalCard } from "../utils/shareCard";

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
  const [formPhoto, setFormPhoto] = useState(null); // { preview: dataUrl }
  const photoInputRef = React.useRef(null);
  const [confettiTrigger, setConfettiTrigger] = useState(0);

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
      note: formNote.trim() || GROWOUT_TYPES[formType].label,
      photo: formPhoto?.preview || null,
    });

    addXp(5, "Logged Grow-Out Checkpoint");
    setFormCount("");
    setFormNote("");
    setFormPhoto(null);
    setShowAddForm(false);
    setConfettiTrigger(prev => prev + 1);
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
      border: "1px solid rgba(56, 189, 248, 0.15)",
      position: "relative",
      overflow: "hidden",
    }}>
      {/* Confetti on checkpoint success */}
      <ConfettiCelebration trigger={confettiTrigger} duration={1800} />
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
      <AnimatedFunnel
        eggs={eggCount}
        fry={totalFry}
        alive={survivors}
        sold={totalSold}
        lost={totalCulled + totalLoss}
        survivalRate={survivalRate}
      />

      {/* Timeline Chart */}
      <GrowOutChart checkpoints={checkpoints} eggCount={eggCount} spawnId={spawnId} />

      {/* Photo Timeline Strip */}
      {checkpoints.some(cp => cp.photo) && (
        <div style={{ marginTop: "0.75rem" }}>
          <div style={{ fontSize: "0.65rem", fontWeight: "600", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "6px" }}>
            📸 Photo Timeline
          </div>
          <div style={{
            display: "flex", gap: "6px", overflowX: "auto", paddingBottom: "4px",
            scrollbarWidth: "thin",
          }}>
            {checkpoints
              .filter(cp => cp.photo)
              .sort((a, b) => a.timestamp - b.timestamp)
              .map((cp) => (
                <div key={cp.id} style={{ flexShrink: 0, position: "relative" }}>
                  <img
                    src={cp.photo}
                    alt={`${GROWOUT_TYPES[cp.type]?.label || cp.type} - ${new Date(cp.timestamp * 1000).toLocaleDateString()}`}
                    style={{
                      width: "56px", height: "56px", borderRadius: "8px",
                      objectFit: "cover", border: "1px solid rgba(139, 92, 246, 0.2)",
                      cursor: "pointer", transition: "transform 0.2s, box-shadow 0.2s",
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.transform = "scale(1.1)"; e.currentTarget.style.boxShadow = "0 4px 12px rgba(0,0,0,0.4)"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.transform = "scale(1)"; e.currentTarget.style.boxShadow = "none"; }}
                    onClick={() => window.open(cp.photo, "_blank")}
                  />
                  <span style={{
                    position: "absolute", bottom: "2px", left: "50%", transform: "translateX(-50%)",
                    fontSize: "0.5rem", color: "#fff", background: "rgba(0,0,0,0.7)",
                    padding: "1px 4px", borderRadius: "3px", whiteSpace: "nowrap",
                  }}>
                    {new Date(cp.timestamp * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                  </span>
                </div>
              ))}
          </div>
        </div>
      )}

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
            {/* Photo upload */}
            <input
              ref={photoInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              style={{ display: "none" }}
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (file) {
                  try {
                    const compressed = await compressImage(file, 600, 600, 0.65);
                    setFormPhoto({ preview: compressed });
                  } catch (err) {
                    console.warn("Photo compression failed:", err);
                  }
                }
              }}
            />
            <button
              type="button"
              onClick={() => photoInputRef.current?.click()}
              title="Attach photo"
              style={{
                padding: "0.35rem 0.5rem",
                fontSize: "0.8rem",
                background: formPhoto ? "rgba(52, 211, 153, 0.12)" : "rgba(255,255,255,0.03)",
                border: `1px solid ${formPhoto ? "rgba(52, 211, 153, 0.3)" : "var(--glass-border)"}`,
                borderRadius: "4px",
                cursor: "pointer",
                color: formPhoto ? "#34d399" : "var(--text-muted)",
                transition: "all 0.2s",
              }}
            >
              📷{formPhoto ? "✓" : ""}
            </button>
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
              onClick={() => { setShowAddForm(false); setFormCount(""); setFormNote(""); setFormPhoto(null); }}
              style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: "0.8rem" }}
            >
              ×
            </button>
          </div>
          {/* Photo preview */}
          {formPhoto && (
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <img
                src={formPhoto.preview}
                alt="Checkpoint photo preview"
                style={{ width: "48px", height: "48px", borderRadius: "6px", objectFit: "cover", border: "1px solid rgba(52, 211, 153, 0.3)" }}
              />
              <button
                type="button"
                onClick={() => setFormPhoto(null)}
                style={{ fontSize: "0.68rem", color: "var(--text-muted)", background: "none", border: "none", cursor: "pointer" }}
              >
                Remove photo
              </button>
            </div>
          )}
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
                <span style={{ flex: 1 }}>{cp.note}</span>
                <ShareButton
                  generateCard={() => generateNarrationCard({ narration: cp.note, speciesName: speciesName, daysSinceSpawn: Math.floor((cp.timestamp - (checkpoints[checkpoints.length - 1]?.timestamp || cp.timestamp)) / 86400) })}
                  title="Poseidon Observation"
                  text={cp.note}
                  label=""
                  size="sm"
                />
              </div>
            ) : (
              <div key={cp.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "0.7rem", padding: "0.2rem 0", borderBottom: "1px solid rgba(255,255,255,0.03)" }}>
                <span style={{ display: "flex", alignItems: "center", gap: "0.3rem" }}>
                  {cp.photo && (
                    <img src={cp.photo} alt="" style={{ width: "20px", height: "20px", borderRadius: "3px", objectFit: "cover", flexShrink: 0 }} />
                  )}
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
