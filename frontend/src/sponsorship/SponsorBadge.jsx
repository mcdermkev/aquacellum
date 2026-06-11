import React from "react";
import { useSponsorImpression, useSponsorClick } from "./useSponsorImpression";

/**
 * SponsorBadge
 * 
 * A lightweight, non-intrusive "Recommended by [Brand]" or "Powered by [Brand]" chip.
 * Renders inline below action confirmations, species cards, or toast messages.
 * 
 * When no sponsor data is provided, renders nothing.
 * 
 * Props:
 *   - sponsor: { id, brand, logo } — from useSponsorSlot result
 *   - product: string — product name
 *   - productLink: string — affiliate/product URL (optional)
 *   - tagline: string — short description (optional)
 *   - surface: string — which surface this badge appears on (for analytics)
 *   - variant: "inline" | "toast" | "card-footer" — controls styling
 */
export function SponsorBadge({ sponsor, product, productLink, tagline, surface, variant = "inline" }) {
  if (!sponsor) return null;

  // Track impression
  useSponsorImpression(sponsor.id, surface);
  const handleClick = useSponsorClick(sponsor.id, surface);

  const baseStyle = {
    display: "inline-flex",
    alignItems: "center",
    gap: "0.4rem",
    fontSize: "0.7rem",
    color: "rgba(255, 255, 255, 0.5)",
    padding: "0.25rem 0.6rem",
    borderRadius: "12px",
    background: "rgba(255, 255, 255, 0.03)",
    border: "1px solid rgba(255, 255, 255, 0.06)",
    transition: "all 0.2s ease",
    textDecoration: "none",
    cursor: productLink ? "pointer" : "default"
  };

  const variantStyles = {
    inline: {},
    toast: {
      marginTop: "0.5rem",
      fontSize: "0.65rem"
    },
    "card-footer": {
      marginTop: "0.75rem",
      padding: "0.35rem 0.75rem",
      background: "rgba(56, 189, 248, 0.03)",
      border: "1px solid rgba(56, 189, 248, 0.08)"
    }
  };

  const style = { ...baseStyle, ...variantStyles[variant] };

  const content = (
    <>
      {sponsor.logo && (
        <img 
          src={sponsor.logo} 
          alt={`${sponsor.brand} logo`}
          style={{ width: "14px", height: "14px", borderRadius: "3px", objectFit: "contain" }}
        />
      )}
      <span>
        {tagline || `Recommended by ${sponsor.brand}`}
        {product && <strong style={{ color: "rgba(255, 255, 255, 0.7)", marginLeft: "0.25rem" }}>{product}</strong>}
      </span>
    </>
  );

  if (productLink) {
    return (
      <a
        href={productLink}
        target="_blank"
        rel="noopener noreferrer sponsored"
        onClick={handleClick}
        style={style}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = "rgba(56, 189, 248, 0.06)";
          e.currentTarget.style.borderColor = "rgba(56, 189, 248, 0.15)";
          e.currentTarget.style.color = "rgba(255, 255, 255, 0.7)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = style.background;
          e.currentTarget.style.borderColor = style.border?.replace("1px solid ", "") || "rgba(255, 255, 255, 0.06)";
          e.currentTarget.style.color = "rgba(255, 255, 255, 0.5)";
        }}
      >
        {content}
      </a>
    );
  }

  return <span style={style}>{content}</span>;
}
