import React from "react";
import { assessStocking, stockingHeadline } from "../../utils/stockingGuidance";
import "./StockingGuidance.css";

/**
 * StockingGuidance — deterministic "how full is this tank?" panel (Logbook
 * Rework Task 10, Knowledge layer). Renders the combined-inhabitants stocking
 * estimate from `assessStocking`, always with its grounding disclaimers so the
 * rough guideline is never mistaken for a precise limit. Renders nothing when
 * there are no fish or no known volume.
 *
 * Props:
 *   tank            — active tank
 *   fishbaseData    — curated reference catalog
 *   contractSpecies — on-chain species catalog
 *   casualModeActive
 */
export function StockingGuidance({ tank, fishbaseData = [], contractSpecies = [], casualModeActive = false }) {
  const a = assessStocking(tank, { fishbaseData, contractSpecies });
  if (!a.applicable) return null;

  const head = stockingHeadline(a.band);
  const pct = a.ratio != null ? Math.min(100, Math.round(a.ratio * 100)) : null;

  return (
    <div className={`stocking-guide sg--${head.tone}`} data-testid="stocking-guide">
      <div className="sg-head">
        <span className="sg-icon" aria-hidden="true">{head.icon}</span>
        <strong className="sg-title">{a.band ? head.text : "Stocking"}</strong>
        <span className="sg-meta">{a.fishCount} fish · {a.volumeGallons} gal</span>
      </div>

      {a.ratio != null ? (
        <>
          <div className="sg-bar" role="img" aria-label={`Estimated stocking ${pct}% of the rough guideline`}>
            <span className={`sg-bar-fill sg--${head.tone}`} style={{ width: `${pct}%` }} />
            <span className="sg-bar-mark" title="Rough guideline (100%)" />
          </div>
          <p className="sg-line">
            About <strong>{pct}%</strong> of the rough guideline
            {" "}({a.totalAdultLengthCm} cm of adult fish vs ~{a.capacityLengthCm} cm for {a.volumeGallons} gal
            {a.unknownCount > 0 ? `, ${a.knownCount} of ${a.fishCount} fish counted` : ""}).
          </p>
        </>
      ) : (
        <p className="sg-line">
          {casualModeActive
            ? "We don't have confirmed adult sizes for these fish yet, so there's no size estimate — but keep an eye on water quality as they grow."
            : "No confirmed adult sizes for these species in the catalog, so no length-based estimate is available."}
        </p>
      )}

      <ul className="sg-notes">
        {a.assumptions.map((note, i) => (
          <li key={i}>{note}</li>
        ))}
      </ul>
    </div>
  );
}
