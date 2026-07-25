import React from "react";
import { buildSpeciesCarePrompt } from "../../utils/poseidonPrompts";
import "./SpeciesCareGuide.css";

/**
 * SpeciesCareGuide — the Casual "what your fish need" teaching panel (Logbook
 * Rework Task 10, Knowledge layer). Surfaces each resident species' care needs
 * (temperature, pH, adult size, temperament, diet, care level) right where the
 * keeper is looking, grounded in the curated species catalog — so Casual users
 * LEARN good husbandry, not just log it.
 *
 * Props:
 *   tank            — active tank (for its specimens)
 *   fishbaseData    — curated reference catalog (useSpeciesData)
 *   contractSpecies — on-chain species catalog with temp/pH/care level (useContractSpecies)
 */
export function SpeciesCareGuide({ tank, fishbaseData = [], contractSpecies = [], onAskPoseidon }) {
  const refs = uniqueSpecies(tank?.specimens);
  if (refs.length === 0) return null;

  const cards = refs
    .map((ref) => getSpeciesCare(ref, fishbaseData, contractSpecies))
    .filter((c) => c && hasAnyCareData(c));

  if (cards.length === 0) return null;

  return (
    <div className="care-guide">
      <div className="care-guide-title">🎓 Care guide — what your fish need</div>
      <div className="care-guide-list">
        {cards.map((c) => (
          <div key={c.key} className="cg-card">
            <div className="cg-head">
              <strong className="cg-name">{c.commonName}</strong>
              {c.careLevelLabel && <span className="cg-level">{c.careLevelLabel}</span>}
            </div>
            <div className="cg-chips">
              {c.tempMin != null && c.tempMax != null && (
                <span className="cg-chip">🌡️ {fmt(c.tempMin)}–{fmt(c.tempMax)}°C</span>
              )}
              {c.phMin != null && c.phMax != null && (
                <span className="cg-chip">🧪 pH {fmt(c.phMin)}–{fmt(c.phMax)}</span>
              )}
              {c.maxLengthCm != null && <span className="cg-chip">📏 up to {fmt(c.maxLengthCm)} cm</span>}
              {c.temperament && <span className="cg-chip">🐟 {c.temperament}</span>}
              {c.diet && <span className="cg-chip">🍽️ {c.diet}</span>}
            </div>
            {c.tip && <p className="cg-tip">{c.tip}</p>}
            {onAskPoseidon && (
              <button
                type="button"
                className="cg-ask"
                onClick={() => onAskPoseidon(buildSpeciesCarePrompt(c.commonName, tank))}
              >
                💬 Ask Poseidon about {c.commonName}
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Unique species references from a tank's specimens. */
function uniqueSpecies(specimens) {
  const seen = new Set();
  const out = [];
  for (const s of specimens || []) {
    if (s.isBatchPlaceholder) continue;
    const key = String(s.speciesId ?? s.commonName ?? "");
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({ speciesId: s.speciesId, commonName: s.commonName, scientificName: s.scientificName });
  }
  return out;
}

const CARE_LEVELS = ["Beginner-friendly", "Easy", "Moderate", "Advanced", "Expert"];

// Short temperament by family (falls back to null → hidden).
const FAMILY_TEMPERAMENT = {
  cichlidae: "Territorial",
  characidae: "Peaceful schooler",
  poeciliidae: "Peaceful",
  cyprinidae: "Active schooler",
  osphronemidae: "Can be territorial",
  anabantidae: "Can be territorial",
  loricariidae: "Peaceful bottom-dweller",
  callichthyidae: "Peaceful, keep in groups",
  serrasalmidae: "Predatory",
  melanotaeniidae: "Active, peaceful",
};

/**
 * Normalize a species' care data from the contract catalog (preferred, has
 * temp/pH/care level) with a fallback to the curated fishbase catalog.
 * Exported for testing.
 */
export function getSpeciesCare(ref, fishbaseData = [], contractSpecies = []) {
  if (!ref) return null;
  const idMatch = (x) => Number(x?.speciesId ?? x?.specCode) === Number(ref.speciesId);
  const nameMatch = (x) => x?.commonName && ref.commonName && x.commonName === ref.commonName;

  const contract = contractSpecies.find((c) => idMatch(c) || nameMatch(c));
  const fb = fishbaseData.find((f) => idMatch(f) || nameMatch(f));

  const tempMin = numOr(contract?.minTemp, fb?.tankMetrics?.tempRangeCelsius?.[0]);
  const tempMax = numOr(contract?.maxTemp, fb?.tankMetrics?.tempRangeCelsius?.[1] ?? fb?.ecology?.tempCeiling);
  const phMin = numOr(contract?.minPh, fb?.ecology?.phMin);
  const phMax = numOr(contract?.maxPh, fb?.ecology?.phMax);
  const careLevelNum = contract?.careLevel;
  const family = (fb?.family || "").toLowerCase();

  return {
    key: String(ref.speciesId ?? ref.commonName),
    commonName: ref.commonName || fb?.commonName || fb?.scientificName || "Unknown species",
    careLevelLabel: Number.isFinite(careLevelNum) ? (CARE_LEVELS[careLevelNum] || `Level ${careLevelNum}`) : null,
    tempMin, tempMax, phMin, phMax,
    maxLengthCm: numOr(fb?.maxLengthCm, undefined),
    temperament: FAMILY_TEMPERAMENT[family] || null,
    diet: fb?.diet?.trophicLevel && fb.diet.trophicLevel !== "Information arriving soon" ? fb.diet.trophicLevel : null,
    tip: truncate(fb?.ecology?.comments),
  };
}

function hasAnyCareData(c) {
  return c.tempMin != null || c.phMin != null || c.maxLengthCm != null || c.temperament || c.diet || c.careLevelLabel;
}

function numOr(a, b) {
  const v = a != null ? a : b;
  return v == null || Number.isNaN(Number(v)) ? undefined : Number(v);
}

function fmt(n) {
  return Number.isInteger(n) ? String(n) : Number(n).toFixed(1);
}

function truncate(text) {
  if (!text || text === "Information arriving soon") return null;
  return text.length > 160 ? `${text.slice(0, 157)}…` : text;
}
