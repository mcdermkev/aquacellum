import React from "react";
import { assessStocking, stockingHeadline } from "../../utils/stockingGuidance";
import { inhabitantKind } from "./inhabitants";
import "./StockingGuidance.css";

/**
 * StockingGuidance — deterministic "how full is this tank?" panel (Logbook
 * Rework Task 10, Knowledge layer). Renders the combined-inhabitants stocking
 * estimate from `assessStocking`, always with its grounding disclaimers so the
 * rough guideline is never mistaken for a precise limit. Renders nothing when
 * there are no fish or no known volume.
 *
 * The estimate is a fish-length rule, so it only ever sees the fish. Corals,
 * inverts and plants are left out and said so: a coral has no "adult length",
 * and counting a snail's shell as inches of fish is not a stocking estimate.
 *
 * Props:
 *   tank            — active tank
 *   fishbaseData    — curated reference catalog
 *   contractSpecies — on-chain species catalog
 *   casualModeActive
 */
export function StockingGuidance({ tank, fishbaseData = [], contractSpecies = [], casualModeActive = false }) {
  const all = Array.isArray(tank?.specimens) ? tank.specimens : [];
  const living = all.filter((s) => !s.isBatchPlaceholder);
  const fishOnly = all.filter((s) => {
    const kind = inhabitantKind(s, fishbaseData);
    return kind === "fish" || kind === "amphibian";
  });
  const corals = living.filter((s) => inhabitantKind(s, fishbaseData) === "coral").length;
  const inverts = living.filter((s) => inhabitantKind(s, fishbaseData) === "invertebrate").length;

  const a = assessStocking({ ...tank, specimens: fishOnly }, { fishbaseData, contractSpecies });

  // A reef of only corals and inverts has no fish-length estimate to give, but
  // it deserves an honest line rather than silence.
  if (!a.applicable) {
    if ((corals || inverts) && a.volumeGallons > 0) {
      return (
        <div className="stocking-guide sg--neutral" data-testid="stocking-guide">
          <div className="sg-head">
            <span className="sg-icon" aria-hidden="true">🪸</span>
            <strong className="sg-title">Stocking</strong>
            <span className="sg-meta">{a.volumeGallons} gal</span>
          </div>
          <p className="sg-line">{reefLifeNote(corals, inverts, casualModeActive)}</p>
        </div>
      );
    }
    return null;
  }

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
            ? "We don't have confirmed adult sizes for these fish yet, so there's no size estimate. Keep an eye on water quality as they grow."
            : "No confirmed adult sizes for these species in the catalog, so no length-based estimate is available."}
        </p>
      )}

      <ul className="sg-notes">
        {a.assumptions.map((note, i) => (
          <li key={i}>{note}</li>
        ))}
        {(corals > 0 || inverts > 0) && <li>{reefLifeNote(corals, inverts, casualModeActive)}</li>}
      </ul>
    </div>
  );
}

function reefLifeNote(corals, inverts, casual) {
  const parts = [];
  if (corals) parts.push(`${corals} coral${corals === 1 ? "" : "s"}`);
  if (inverts) parts.push(`${inverts} invert${inverts === 1 ? "" : "s"}`);
  const who = parts.join(" and ");
  return casual
    ? `${who} not counted here. Corals need light, flow and room to grow rather than swimming space, and most inverts add very little waste.`
    : `${who} excluded: the length rule is for fish. Plan corals by light, flow and spacing.`;
}
