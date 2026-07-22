/**
 * AddOnRecommendationStrip.jsx
 *
 * "Add more from {seller} — same box, no extra shipping" (Task 11 UI, §3.B).
 * A horizontally scrollable strip of add-on cards, each carrying two honest
 * signals (box fit, tank fit) sourced entirely from
 * `useAddOnRecommendations().recommendations` (addOnPresenter.presentRecommendation,
 * which preserves addOnRecommender.recommendAddOns' exact ranking — this
 * component never re-sorts or re-scores).
 *
 * Renders nothing when there are no safe recommendations (small seller,
 * everything blocked/out of stock) — a quiet empty state, never a fabricated
 * suggestion (spec §3.B).
 */

import React from "react";
import { CheckCircle, Warning, Package, Plus } from "@phosphor-icons/react";
import { FishSilhouetteSVG } from "../SilhouetteSVG.jsx";
import { addOnCopy } from "../../services/addOnPresenter.js";

export function AddOnRecommendationStrip({ recommendations, sellerName, onAdd, casualModeActive = false }) {
  if (!recommendations || recommendations.length === 0) return null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
      <h4
        style={{
          margin: 0,
          fontSize: "0.78rem",
          fontWeight: 700,
          fontFamily: "Outfit, sans-serif",
          color: "var(--text-secondary)",
          textTransform: "uppercase",
          letterSpacing: "0.03em",
        }}
      >
        {casualModeActive
          ? `More from ${sellerName || "this seller"} — same box`
          : `Add-ons from ${sellerName || "this seller"}`}
      </h4>

      <div
        role="list"
        aria-label="Recommended add-ons"
        style={{
          display: "flex",
          gap: "0.65rem",
          overflowX: "auto",
          paddingBottom: "0.35rem",
          WebkitOverflowScrolling: "touch",
          scrollSnapType: "x proximity",
        }}
      >
        {recommendations.map((row) => (
          <AddOnCard
            key={row.listingId}
            row={row}
            onAdd={() => onAdd?.(row)}
            casualModeActive={casualModeActive}
          />
        ))}
      </div>
    </div>
  );
}

function AddOnCard({ row, onAdd, casualModeActive }) {
  const { boxLabel, tankFitLabel } = addOnCopy(row, { casual: casualModeActive });

  return (
    <div
      role="listitem"
      className="glass-card"
      style={{
        flex: "0 0 auto",
        width: "150px",
        scrollSnapAlign: "start",
        padding: "0.75rem",
        display: "flex",
        flexDirection: "column",
        gap: "0.5rem",
        border: "1px solid var(--glass-border)",
        background: "var(--glass-bg)",
        transition: "transform 0.3s cubic-bezier(0.4,0,0.2,1), box-shadow 0.3s cubic-bezier(0.4,0,0.2,1)",
      }}
      onMouseEnter={(e) => { e.currentTarget.style.transform = "scale(1.03)"; e.currentTarget.style.boxShadow = "0 8px 24px rgba(0,0,0,0.35)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.transform = "scale(1)"; e.currentTarget.style.boxShadow = "none"; }}
    >
      <div
        style={{
          width: "100%",
          height: "72px",
          borderRadius: "8px",
          background: "linear-gradient(135deg, rgba(255,255,255,0.03) 0%, rgba(255,255,255,0.01) 100%)",
          border: "1px solid var(--glass-border)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {row.imageUrl ? (
          <img src={row.imageUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: "8px" }} />
        ) : (
          <FishSilhouetteSVG specimenId={row.listingId} style={{ width: "36px", height: "36px" }} />
        )}
      </div>

      <div style={{ minWidth: 0 }}>
        <strong
          style={{
            display: "block",
            fontFamily: "Outfit, sans-serif",
            fontSize: "0.8rem",
            fontWeight: 700,
            color: "var(--text-primary)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {row.commonName || "Listing"}
        </strong>
        {row.scientificName && (
          <span style={{ fontSize: "0.62rem", color: "var(--text-muted)", fontStyle: "italic", display: "block" }}>
            {row.scientificName}
          </span>
        )}
      </div>

      <strong style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontSize: "0.85rem", color: "var(--text-primary)" }}>
        {row.priceDisplay}{row.isBatch ? " / fish" : ""}
      </strong>

      {/* Box signal — primary, honest disclosure */}
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "0.3rem",
          fontSize: "0.64rem",
          fontWeight: 600,
          padding: "0.2rem 0.4rem",
          borderRadius: "10px",
          background: row.addedBox ? "rgba(251, 191, 36, 0.1)" : "rgba(52, 211, 153, 0.1)",
          border: `1px solid ${row.addedBox ? "rgba(251, 191, 36, 0.3)" : "rgba(52, 211, 153, 0.3)"}`,
          color: row.addedBox ? "var(--amber-400)" : "var(--emerald-400)",
        }}
      >
        {row.addedBox ? <Warning size={11} weight="duotone" /> : <Package size={11} weight="duotone" />}
        {boxLabel}
      </span>

      {/* Tank-fit signal — secondary; only rendered when there's something honest to say */}
      {tankFitLabel && (
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "0.3rem",
            fontSize: "0.62rem",
            color: row.hasBuyerTank === false
              ? "var(--text-muted)"
              : row.tankFitVerdict === "ok" ? "var(--emerald-400)" : "var(--amber-400)",
          }}
          title={row.topReason || undefined}
        >
          {row.hasBuyerTank !== false && (row.tankFitVerdict === "ok" ? <CheckCircle size={11} weight="duotone" /> : <Warning size={11} weight="duotone" />)}
          {tankFitLabel}
        </span>
      )}

      <button
        type="button"
        onClick={onAdd}
        aria-label={`Add ${row.commonName || "item"} to cart`}
        style={{
          marginTop: "auto",
          width: "100%",
          minHeight: "32px",
          padding: "0.35rem 0.5rem",
          borderRadius: "8px",
          border: "none",
          background: "linear-gradient(135deg, var(--teal-400), var(--violet-500))",
          color: "#04120f",
          fontWeight: 700,
          fontSize: "0.7rem",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: "0.25rem",
          boxShadow: "0 0 12px rgba(45, 212, 191, 0.25)",
        }}
      >
        <Plus size={12} weight="bold" /> Add
      </button>
    </div>
  );
}
