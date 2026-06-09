import React from "react";

/**
 * ReefHUD — Adaptive controls for all three modes (master/tank/visit).
 */
export function ReefHUD({
  title,
  subtitle,
  mode,
  onToggleMode,
  speciesCount,
  vrSupported,
  onEnterVR,
  muted,
  onToggleMute,
  audioReady,
  biome,
  onToggleBiomeSelector,
  companionVisible,
  onToggleCompanion,
  reefMode,
  isVisit,
  ownerName,
  tankMeta
}) {
  return (
    <div
      style={{
        position: "absolute",
        top: 16,
        left: 16,
        right: 16,
        zIndex: 50,
        fontFamily: "system-ui, sans-serif",
        color: "#e2e8f0",
        pointerEvents: "none",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "flex-start"
      }}
    >
      {/* Left: title + controls */}
      <div>
        <h1 style={{
          margin: 0, fontSize: 18, fontWeight: 600,
          color: isVisit ? "#c4b5fd" : "#38bdf8",
          textShadow: "0 2px 8px rgba(0,0,0,0.6)"
        }}>
          {title}
        </h1>

        <p style={{
          margin: "3px 0 10px", fontSize: 11, color: "#94a3b8",
          textShadow: "0 1px 4px rgba(0,0,0,0.5)"
        }}>
          {subtitle}
        </p>

        {/* Control buttons */}
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", pointerEvents: "auto" }}>
          <HudButton
            active={mode === "pro"}
            onClick={onToggleMode}
            activeColor="#3b82f6"
            inactiveColor="#22c55e"
            label={mode === "casual" ? "🎣 Casual" : "🔬 Pro"}
          />

          <HudButton
            active={!muted}
            onClick={onToggleMute}
            activeColor="#38bdf8"
            inactiveColor="#64748b"
            label={muted ? "🔇 Muted" : "🔊 Audio"}
          />

          {/* Biome selector — master mode only */}
          {onToggleBiomeSelector && (
            <HudButton
              active={biome !== "default"}
              onClick={onToggleBiomeSelector}
              activeColor="#f59e0b"
              inactiveColor="#64748b"
              label="🌍 Biome"
            />
          )}

          <HudButton
            active={companionVisible}
            onClick={onToggleCompanion}
            activeColor="#8b5cf6"
            inactiveColor="#64748b"
            label={companionVisible ? "🐟 Echo" : "🐟 Off"}
          />

          {/* Link back to master reef when in tank mode */}
          {reefMode === "tank" && (
            <a href="/reef-xr.html" style={{ textDecoration: "none" }}>
              <HudButton
                active={false}
                onClick={() => {}}
                activeColor="#38bdf8"
                inactiveColor="#38bdf8"
                label="🌊 Master Reef"
              />
            </a>
          )}
        </div>

        {/* Controls hint */}
        <div style={{
          marginTop: 10, fontSize: 11, color: "#475569",
          lineHeight: 1.6, textShadow: "0 1px 4px rgba(0,0,0,0.5)"
        }}>
          <div>🖱️ Orbit • Scroll zoom • 👆 Click fish</div>
          <div>🎤 Voice or type to ask Poseidon</div>
        </div>

        {/* Tank info badge (tank/visit mode) */}
        {tankMeta && (
          <div style={{
            marginTop: 8, padding: "6px 10px",
            background: "rgba(139, 92, 246, 0.1)",
            border: "1px solid rgba(139, 92, 246, 0.25)",
            borderRadius: 8, fontSize: 11, color: "#c4b5fd",
            lineHeight: 1.5, maxWidth: 220
          }}>
            <div>📐 {tankMeta.volumeLiters}L • {tankMeta.tankType}</div>
            {tankMeta.tempCelsius && <div>🌡️ {tankMeta.tempCelsius}°C</div>}
            {tankMeta.ph && <div>⚗️ pH {tankMeta.ph}</div>}
            {tankMeta.specimenCount > 0 && <div>🐟 {tankMeta.specimenCount} fish</div>}
          </div>
        )}
      </div>

      {/* Right: VR button or share link */}
      <div style={{ pointerEvents: "auto", display: "flex", flexDirection: "column", gap: 8 }}>
        {vrSupported && (
          <button onClick={onEnterVR} style={{
            background: "rgba(139, 92, 246, 0.2)", border: "1px solid #8b5cf6",
            borderRadius: 12, padding: "10px 18px", color: "#c4b5fd",
            fontSize: 14, fontWeight: 600, cursor: "pointer"
          }}>
            🥽 Enter VR
          </button>
        )}

        {/* Share tank link (when viewing own tank) */}
        {reefMode === "tank" && !isVisit && tankMeta && (
          <button
            onClick={() => {
              const url = `${window.location.origin}/reef-xr.html?tank=${tankMeta.id}&visit=true&owner=${encodeURIComponent(tankMeta.name || "Me")}`;
              navigator.clipboard.writeText(url).then(() => {
                alert("Tank tour link copied! Share with friends.");
              });
            }}
            style={{
              background: "rgba(34, 197, 94, 0.15)", border: "1px solid #22c55e",
              borderRadius: 10, padding: "8px 14px", color: "#22c55e",
              fontSize: 12, fontWeight: 500, cursor: "pointer"
            }}
          >
            🔗 Share Tank Tour
          </button>
        )}
      </div>
    </div>
  );
}

function HudButton({ active, onClick, activeColor, inactiveColor, label }) {
  const color = active ? activeColor : inactiveColor;
  return (
    <button
      onClick={onClick}
      style={{
        background: `${color}22`,
        border: `1px solid ${color}`,
        borderRadius: 8,
        padding: "5px 10px",
        color: color,
        fontSize: 11,
        fontWeight: 500,
        cursor: "pointer",
        transition: "all 0.2s",
        whiteSpace: "nowrap"
      }}
    >
      {label}
    </button>
  );
}
