import React from "react";
import { useSponsorImpression, useSponsorClick } from "./useSponsorImpression";

/**
 * SponsorOverlay
 * 
 * A non-intrusive spatial overlay for the Immersive Reef (WebXR) biome zones.
 * Renders as a floating HUD element or 3D-space badge depending on context.
 * 
 * For 2D (flat-screen): renders as a translucent overlay at the biome boundary.
 * For VR: intended to be wrapped in a drei <Html> component for spatial placement.
 * 
 * Renders nothing when no sponsor is provided.
 * 
 * Props:
 *   - sponsor: { id, brand, logo }
 *   - biomeName: string — which biome this overlay appears in
 *   - position: "top-left" | "bottom-right" | "center" — overlay position
 *   - surface: string — analytics surface (default: "reef_biome")
 */
export function SponsorOverlay({ sponsor, biomeName, position = "bottom-right", surface = "reef_biome" }) {
  if (!sponsor) return null;

  useSponsorImpression(sponsor.id, surface);
  const handleClick = useSponsorClick(sponsor.id, surface);

  const positionStyles = {
    "top-left": { top: "1rem", left: "1rem" },
    "top-right": { top: "1rem", right: "1rem" },
    "bottom-left": { bottom: "1rem", left: "1rem" },
    "bottom-right": { bottom: "1rem", right: "1rem" },
    "center": { top: "50%", left: "50%", transform: "translate(-50%, -50%)" }
  };

  return (
    <div
      onClick={handleClick}
      style={{
        position: "absolute",
        ...positionStyles[position],
        display: "flex",
        alignItems: "center",
        gap: "0.5rem",
        padding: "0.5rem 0.85rem",
        background: "rgba(0, 0, 0, 0.45)",
        backdropFilter: "blur(8px)",
        borderRadius: "8px",
        border: "1px solid rgba(255, 255, 255, 0.08)",
        zIndex: 10,
        cursor: "pointer",
        transition: "all 0.3s ease",
        opacity: 0.8
      }}
      onMouseEnter={(e) => { e.currentTarget.style.opacity = "1"; }}
      onMouseLeave={(e) => { e.currentTarget.style.opacity = "0.8"; }}
      title={`${biomeName} sponsored by ${sponsor.brand}`}
    >
      {sponsor.logo && (
        <img
          src={sponsor.logo}
          alt={`${sponsor.brand}`}
          style={{ width: "18px", height: "18px", borderRadius: "4px", objectFit: "contain" }}
        />
      )}
      <span style={{ fontSize: "0.65rem", color: "rgba(255, 255, 255, 0.7)", fontWeight: "500" }}>
        {biomeName} presented by <strong style={{ color: "#fff" }}>{sponsor.brand}</strong>
      </span>
    </div>
  );
}
