/**
 * TankCamDiscovery.jsx
 * 
 * Browse active Tank Cams in a grid layout.
 * Shows live thumbnail preview, tank name, owner, viewer count.
 * Tap to open full TankCamViewer.
 */

import React, { useState } from "react";
import { useTankCams } from "../../hooks/useTankCam";
import { TankCamViewer } from "./TankCamViewer";
import { ProfileCard } from "../reef/ProfileCard";

function TankCamCard({ cam, onOpen }) {
  const thumbnailUrl = cam.mux_playback_id
    ? `https://image.mux.com/${cam.mux_playback_id}/thumbnail.webp?time=5&width=400`
    : null;

  return (
    <button
      onClick={() => onOpen(cam)}
      style={{
        background: "rgba(255,255,255,0.02)",
        border: "1px solid rgba(255,255,255,0.06)",
        borderRadius: "12px",
        overflow: "hidden",
        cursor: "pointer",
        textAlign: "left",
        padding: 0,
        width: "100%",
        transition: "border-color 0.2s ease, transform 0.1s ease",
      }}
      onMouseEnter={(e) => { e.currentTarget.style.borderColor = "rgba(56,189,248,0.3)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.borderColor = "rgba(255,255,255,0.06)"; }}
      aria-label={`Watch ${cam.tank_name || "Tank Cam"} by ${cam.profiles?.display_name || "unknown"}`}
    >
      {/* Thumbnail */}
      <div style={{ position: "relative", paddingBottom: "56.25%", background: "#111" }}>
        {thumbnailUrl && (
          <img
            src={thumbnailUrl}
            alt=""
            loading="lazy"
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              objectFit: "cover",
            }}
          />
        )}

        {/* LIVE badge */}
        <span
          style={{
            position: "absolute",
            top: "6px",
            left: "6px",
            padding: "2px 6px",
            borderRadius: "3px",
            background: "rgba(239, 68, 68, 0.9)",
            fontSize: "0.55rem",
            fontWeight: 700,
            color: "#fff",
          }}
        >
          ● LIVE
        </span>

        {/* Viewer count */}
        {cam.viewer_count > 0 && (
          <span
            style={{
              position: "absolute",
              top: "6px",
              right: "6px",
              padding: "2px 6px",
              borderRadius: "3px",
              background: "rgba(0,0,0,0.6)",
              fontSize: "0.6rem",
              color: "#fff",
            }}
          >
            👁️ {cam.viewer_count}
          </span>
        )}
      </div>

      {/* Info */}
      <div style={{ padding: "0.6rem 0.75rem", display: "flex", flexDirection: "column", gap: "0.3rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
          {cam.tank_name && (
            <span style={{ fontSize: "0.75rem", fontWeight: 600, color: "#fff" }}>
              🐠 {cam.tank_name}
            </span>
          )}
        </div>
        {cam.profiles && (
          <div style={{ opacity: 0.8 }}>
            <ProfileCard
              walletAddress={cam.profiles.wallet_address}
              displayName={cam.profiles.display_name}
              avatarUrl={cam.profiles.avatar_url}
              companionTier={cam.profiles.companion_tier}
              compact
            />
          </div>
        )}
      </div>
    </button>
  );
}

export function TankCamDiscovery() {
  const { data: cams = [], isLoading } = useTankCams();
  const [activeCam, setActiveCam] = useState(null);

  if (activeCam) {
    return <TankCamViewer cam={activeCam} onClose={() => setActiveCam(null)} />;
  }

  return (
    <section aria-label="Live Tank Cams">
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "1rem" }}>
        <h3 style={{ margin: 0, fontSize: "1rem", fontWeight: 700, color: "#fff" }}>
          📹 Live Tank Cams
        </h3>
        {cams.length > 0 && (
          <span style={{
            padding: "2px 8px",
            borderRadius: "50px",
            background: "rgba(239, 68, 68, 0.1)",
            border: "1px solid rgba(239, 68, 68, 0.2)",
            fontSize: "0.6rem",
            color: "#f87171",
          }}>
            {cams.length} live
          </span>
        )}
      </div>

      {isLoading ? (
        <div style={{ textAlign: "center", padding: "2rem", color: "var(--text-muted)" }}>
          Loading live cams…
        </div>
      ) : cams.length === 0 ? (
        <div
          style={{
            textAlign: "center",
            padding: "2rem",
            borderRadius: "12px",
            background: "rgba(255,255,255,0.02)",
            border: "1px solid rgba(255,255,255,0.06)",
          }}
        >
          <p style={{ fontSize: "1.5rem", margin: "0 0 0.5rem" }}>📷</p>
          <p style={{ margin: 0, fontSize: "0.8rem", color: "var(--text-muted)" }}>
            No live Tank Cams right now.
          </p>
          <p style={{ margin: "0.25rem 0 0", fontSize: "0.7rem", color: "var(--text-muted)" }}>
            Set up a Tank Cam in your tank settings to broadcast here!
          </p>
        </div>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
            gap: "0.75rem",
          }}
        >
          {cams.map((cam) => (
            <TankCamCard key={cam.id} cam={cam} onOpen={setActiveCam} />
          ))}
        </div>
      )}
    </section>
  );
}

export default TankCamDiscovery;
