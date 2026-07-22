/**
 * BoxCapacityMeter.jsx
 *
 * The "Your shipping box" fill meter (Task 11 UI, §3.A). Pure presentation —
 * every number comes from `useAddOnRecommendations().boxStatus`
 * (addOnPresenter.buildBoxStatus, which itself composes parcelPlanner.js /
 * packingEngine.js). This component never computes capacity itself.
 */

import React from "react";
import { Package } from "@phosphor-icons/react";
import { capacityCopy } from "../../services/addOnPresenter.js";

export function BoxCapacityMeter({ boxStatus, casualModeActive = false }) {
  const { fillPercent, parcels, remaining } = boxStatus;
  if (parcels === 0) return null; // empty cart — nothing to show

  const isFull = fillPercent >= 100 || (Number.isFinite(Number(remaining?.livestock)) && Number(remaining.livestock) <= 0);
  const headline = capacityCopy(boxStatus, { casual: casualModeActive });

  return (
    <div
      className="glass-card"
      style={{
        padding: "0.85rem 1rem",
        display: "flex",
        flexDirection: "column",
        gap: "0.5rem",
        border: "1px solid var(--glass-border)",
        background: "var(--glass-bg)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "0.45rem" }}>
        <Package size={16} weight="duotone" color={isFull ? "var(--amber-400)" : "var(--teal-400)"} />
        <strong
          style={{
            fontFamily: "Outfit, sans-serif",
            fontSize: "0.82rem",
            fontWeight: 700,
            background: "linear-gradient(135deg, var(--teal-300), var(--cyan-300), var(--teal-400))",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
            backgroundClip: "text",
          }}
        >
          {headline}
        </strong>
      </div>

      <div
        role="progressbar"
        aria-valuenow={fillPercent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={casualModeActive ? "Shipping box fill level" : "Parcel capacity used"}
        style={{
          height: "8px",
          borderRadius: "6px",
          background: "rgba(255,255,255,0.06)",
          overflow: "hidden",
          position: "relative",
        }}
      >
        <div
          style={{
            height: "100%",
            width: `${fillPercent}%`,
            borderRadius: "6px",
            background: isFull
              ? "linear-gradient(90deg, var(--amber-400), #f59e0b)"
              : "linear-gradient(90deg, var(--teal-400), var(--cyan-400))",
            transition: "width 0.3s cubic-bezier(0.4,0,0.2,1), background 0.3s cubic-bezier(0.4,0,0.2,1)",
          }}
        />
      </div>

      <span style={{ fontSize: "0.68rem", color: "var(--text-muted)" }}>
        {fillPercent}% full{parcels > 1 ? ` · ${parcels} boxes` : ""}
      </span>
    </div>
  );
}
