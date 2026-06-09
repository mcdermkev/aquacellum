import React, { useState, useEffect, Suspense, useCallback, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { ReefEnvironment } from "./ReefEnvironment";
import { TankEnvironment } from "./TankEnvironment";
import { SpeciesSwarm } from "./SpeciesSwarm";
import { NarrationLayer } from "./NarrationLayer";
import { ReefHUD } from "./ReefHUD";
import { CompanionGuide } from "./CompanionGuide";
import { GenerativeReef, BiomeSelector } from "./GenerativeReef";
import { useReefAudio } from "./hooks/useReefAudio";
import { useTankData, parseReefParams } from "./hooks/useTankData";

/** Error boundary to catch Three.js / R3F crashes */
class ReefErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  componentDidCatch(error, info) {
    console.error("[ReefErrorBoundary]", error, info);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          width: "100%", height: "100%", display: "flex", alignItems: "center",
          justifyContent: "center", flexDirection: "column", gap: 12,
          background: "#0a1628", color: "#ef4444", fontFamily: "system-ui, sans-serif", padding: 24
        }}>
          <div style={{ fontSize: "1.2rem" }}>Reef rendering error</div>
          <div style={{ fontSize: "0.8rem", color: "#94a3b8", maxWidth: 500, wordBreak: "break-word" }}>
            {this.state.error?.message || "Unknown error"}
          </div>
          <button onClick={() => this.setState({ hasError: false, error: null })}
            style={{ marginTop: 12, padding: "8px 16px", borderRadius: 8, border: "1px solid #38bdf8",
              background: "transparent", color: "#38bdf8", cursor: "pointer" }}>
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

/**
 * ImmersiveReef — Three-mode reef experience:
 *
 * 1. MASTER REEF — /reef-xr.html
 *    Full 326-species catalog, explore everything.
 *
 * 2. MY TANK — /reef-xr.html?tank={tankId}
 *    Only your fish, environment scaled to your tank.
 *
 * 3. VISIT TANK — /reef-xr.html?tank={tankId}&visit=true&owner={name}
 *    Tour someone else's tank from the Social Reef.
 */
export function ImmersiveReef() {
  // Parse URL to determine mode
  const { tankId, isVisit, ownerName } = parseReefParams();

  // Fetch appropriate data
  const { speciesData, tankMeta, loading, error: dataError, mode } = useTankData(tankId);

  const [inspectedSpecies, setInspectedSpecies] = useState(null);
  const [uiMode, setUiMode] = useState("casual");
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [biome, setBiome] = useState("default");
  const [showBiomeSelector, setShowBiomeSelector] = useState(false);
  const [companionVisible, setCompanionVisible] = useState(true);

  // Reef ambient audio
  const { ready: audioReady, muted, initAudio, toggleMute } = useReefAudio({ isSpeaking });

  const handleInspect = useCallback((species) => {
    setInspectedSpecies(species);
  }, []);

  const handleDismiss = useCallback(() => {
    setInspectedSpecies(null);
  }, []);

  const handleFirstInteraction = useCallback(() => {
    if (!audioReady) initAudio();
  }, [audioReady, initAudio]);

  // Compute title / subtitle based on mode
  const title = mode === "master"
    ? "🐠 Immersive Reef"
    : isVisit
      ? `🏊 ${ownerName || "Friend"}'s Tank`
      : "🏠 My Tank";

  const subtitle = mode === "master"
    ? `${speciesData.length} species • Main Reef`
    : tankMeta
      ? `${speciesData.length} species • ${tankMeta.volumeLiters}L ${tankMeta.name || ""}`
      : `${speciesData.length} species`;

  if (loading) {
    return (
      <div style={{
        width: "100%", height: "100%", display: "flex", alignItems: "center",
        justifyContent: "center", flexDirection: "column", gap: 12,
        background: "#0a1628", color: "#38bdf8", fontFamily: "system-ui, sans-serif"
      }}>
        <div style={{ fontSize: "2rem" }}>🐠</div>
        <div style={{ fontSize: "1.1rem" }}>
          {mode === "master" ? "Loading reef data…" : "Entering tank…"}
        </div>
      </div>
    );
  }

  if (dataError) {
    return (
      <div style={{
        width: "100%", height: "100%", display: "flex", alignItems: "center",
        justifyContent: "center", flexDirection: "column", gap: 12,
        background: "#0a1628", color: "#ef4444", fontFamily: "system-ui, sans-serif"
      }}>
        <div style={{ fontSize: "1.1rem" }}>Failed to load</div>
        <div style={{ fontSize: "0.8rem", color: "#94a3b8" }}>{dataError}</div>
        <a href="/reef-xr.html" style={{ marginTop: 12, color: "#38bdf8", fontSize: 13 }}>
          ← Back to Master Reef
        </a>
      </div>
    );
  }

  return (
    <ReefErrorBoundary>
    <div
      style={{ width: "100%", height: "100%", position: "relative" }}
      onClick={handleFirstInteraction}
    >
      <Canvas
        camera={{ position: [0, 2, mode === "tank" ? 8 : 12], fov: 60, near: 0.1, far: 200 }}
        style={{ width: "100%", height: "100%" }}
        gl={{ antialias: true, alpha: false }}
        onCreated={({ gl }) => { gl.setClearColor("#0a1628"); }}
      >
        <Suspense fallback={null}>
          {/* Environment selection */}
          {mode === "tank" && tankMeta ? (
            <TankEnvironment tankMeta={tankMeta} />
          ) : biome === "default" ? (
            <ReefEnvironment />
          ) : (
            <GenerativeReef biomeType={biome} seed={42} />
          )}

          {/* Fish schools — uses tank specimens or full catalog */}
          <SpeciesSwarm
            speciesData={speciesData}
            onInspect={handleInspect}
            tankMode={mode === "tank"}
          />

          {/* Companion Echo fish */}
          {companionVisible && (
            <CompanionGuide
              tier="Silver"
              mood={inspectedSpecies ? "excited" : "calm"}
              inspectedSpecies={inspectedSpecies}
              visible={true}
            />
          )}
        </Suspense>

        <OrbitControls
          enablePan
          enableZoom
          maxPolarAngle={Math.PI * 0.85}
          minDistance={1}
          maxDistance={mode === "tank" ? 20 : 50}
          target={[0, 0, 0]}
        />
      </Canvas>

      {/* HUD */}
      <ReefHUD
        title={title}
        subtitle={subtitle}
        mode={uiMode}
        onToggleMode={() => setUiMode(m => m === "casual" ? "pro" : "casual")}
        speciesCount={speciesData.length}
        vrSupported={false}
        onEnterVR={() => {}}
        muted={muted}
        onToggleMute={toggleMute}
        audioReady={audioReady}
        biome={biome}
        onToggleBiomeSelector={mode === "master" ? () => setShowBiomeSelector(s => !s) : null}
        companionVisible={companionVisible}
        onToggleCompanion={() => setCompanionVisible(v => !v)}
        reefMode={mode}
        isVisit={isVisit}
        ownerName={ownerName}
        tankMeta={tankMeta}
      />

      {/* Biome selector (master mode only) */}
      {showBiomeSelector && mode === "master" && (
        <div style={{
          position: "absolute", top: 140, left: 16, zIndex: 60,
          background: "rgba(10, 22, 40, 0.92)", border: "1px solid rgba(56, 189, 248, 0.3)",
          borderRadius: 12, padding: 14, backdropFilter: "blur(8px)"
        }}>
          <p style={{ margin: "0 0 8px", fontSize: 12, color: "#94a3b8", fontFamily: "system-ui" }}>
            Choose environment:
          </p>
          <BiomeSelector currentBiome={biome} onSelect={(b) => { setBiome(b); setShowBiomeSelector(false); }} />
          <button
            onClick={() => { setBiome("default"); setShowBiomeSelector(false); }}
            style={{ marginTop: 8, padding: "4px 10px", borderRadius: 6,
              border: `1px solid ${biome === "default" ? "#38bdf8" : "#334155"}`,
              background: biome === "default" ? "rgba(56, 189, 248, 0.15)" : "transparent",
              color: biome === "default" ? "#38bdf8" : "#94a3b8", fontSize: 11, cursor: "pointer" }}
          >
            🐠 Default Reef
          </button>
        </div>
      )}

      {/* Narration panel */}
      {inspectedSpecies && (
        <NarrationLayer species={inspectedSpecies} mode={uiMode} onDismiss={handleDismiss} />
      )}

      {/* Visit banner */}
      {isVisit && (
        <div style={{
          position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)",
          background: "rgba(10, 22, 40, 0.85)", border: "1px solid rgba(139, 92, 246, 0.4)",
          borderRadius: 16, padding: "20px 28px", textAlign: "center",
          fontFamily: "system-ui, sans-serif", backdropFilter: "blur(8px)",
          zIndex: 200, animation: "fadeOut 3s forwards 2s", pointerEvents: "none"
        }}>
          <div style={{ fontSize: 24, marginBottom: 8 }}>🏊</div>
          <div style={{ color: "#c4b5fd", fontSize: 16, fontWeight: 600 }}>
            Visiting {ownerName || "a friend"}'s tank
          </div>
          <div style={{ color: "#94a3b8", fontSize: 12, marginTop: 4 }}>
            {speciesData.length} species • {tankMeta?.volumeLiters || "?"}L
          </div>
          <style>{`
            @keyframes fadeOut {
              from { opacity: 1; }
              to { opacity: 0; }
            }
          `}</style>
        </div>
      )}
    </div>
    </ReefErrorBoundary>
  );
}
