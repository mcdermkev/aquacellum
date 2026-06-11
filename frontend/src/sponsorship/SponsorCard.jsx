import React from "react";
import { useSponsorImpression, useSponsorClick } from "./useSponsorImpression";

/**
 * SponsorCard
 * 
 * A larger sponsored placement card for marketplace featured listings,
 * reef biome entrances, and checkout partner badges.
 * 
 * Renders nothing when sponsor data is null.
 * 
 * Props:
 *   - sponsor: { id, brand, logo, tier } — from useSponsorSlot or direct config
 *   - title: string — headline text
 *   - description: string — body copy
 *   - productLink: string — CTA link (optional)
 *   - ctaLabel: string — button text (default: "Learn More")
 *   - surface: string — analytics surface identifier
 *   - variant: "featured" | "partner" | "biome" | "campaign"
 *   - accentColor: string — override border/accent color
 */
export function SponsorCard({ 
  sponsor, 
  title, 
  description, 
  productLink, 
  ctaLabel = "Learn More",
  surface, 
  variant = "featured",
  accentColor
}) {
  if (!sponsor) return null;

  useSponsorImpression(sponsor.id, surface);
  const handleClick = useSponsorClick(sponsor.id, surface);

  const accent = accentColor || getAccentForVariant(variant);

  return (
    <div
      className="glass-card"
      style={{
        padding: "1.25rem 1.5rem",
        border: `1px solid ${accent}25`,
        background: `linear-gradient(135deg, ${accent}08 0%, rgba(0,0,0,0) 100%)`,
        position: "relative",
        overflow: "hidden"
      }}
    >
      {/* Sponsored label */}
      <span style={{
        position: "absolute",
        top: "0.75rem",
        right: "0.75rem",
        fontSize: "0.6rem",
        fontWeight: "600",
        color: "rgba(255, 255, 255, 0.4)",
        textTransform: "uppercase",
        letterSpacing: "0.08em",
        padding: "0.15rem 0.5rem",
        borderRadius: "8px",
        background: "rgba(255, 255, 255, 0.03)",
        border: "1px solid rgba(255, 255, 255, 0.06)"
      }}>
        Sponsored
      </span>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "0.75rem" }}>
        {sponsor.logo && (
          <img
            src={sponsor.logo}
            alt={`${sponsor.brand} logo`}
            style={{
              width: "36px",
              height: "36px",
              borderRadius: "8px",
              objectFit: "contain",
              background: "rgba(255, 255, 255, 0.05)",
              padding: "4px"
            }}
          />
        )}
        <div>
          <h4 style={{ 
            margin: 0, 
            fontSize: "0.95rem", 
            fontWeight: "700", 
            color: "#fff" 
          }}>
            {title || sponsor.brand}
          </h4>
          <span style={{ fontSize: "0.7rem", color: "rgba(255, 255, 255, 0.5)" }}>
            {sponsor.brand} Partner
          </span>
        </div>
      </div>

      {/* Body */}
      {description && (
        <p style={{
          fontSize: "0.8rem",
          color: "rgba(255, 255, 255, 0.6)",
          lineHeight: "1.5",
          margin: "0 0 1rem 0"
        }}>
          {description}
        </p>
      )}

      {/* CTA */}
      {productLink && (
        <a
          href={productLink}
          target="_blank"
          rel="noopener noreferrer sponsored"
          onClick={handleClick}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "0.4rem",
            padding: "0.5rem 1rem",
            fontSize: "0.75rem",
            fontWeight: "600",
            color: accent,
            background: `${accent}10`,
            border: `1px solid ${accent}30`,
            borderRadius: "6px",
            textDecoration: "none",
            transition: "all 0.2s ease"
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = `${accent}20`;
            e.currentTarget.style.borderColor = `${accent}50`;
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = `${accent}10`;
            e.currentTarget.style.borderColor = `${accent}30`;
          }}
        >
          {ctaLabel}
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="5" y1="12" x2="19" y2="12" />
            <polyline points="12 5 19 12 12 19" />
          </svg>
        </a>
      )}
    </div>
  );
}

function getAccentForVariant(variant) {
  switch (variant) {
    case "featured": return "#38bdf8";    // Blue
    case "partner": return "#10b981";     // Green
    case "biome": return "#8b5cf6";       // Purple
    case "campaign": return "#f59e0b";    // Amber
    default: return "#38bdf8";
  }
}
