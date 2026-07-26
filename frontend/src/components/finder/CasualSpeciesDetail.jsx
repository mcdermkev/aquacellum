import React, { useMemo, useState, useEffect } from "react";
import { useUserTanks } from "../../hooks/useUserTanks";
import { useSpeciesAvailability } from "../../hooks/useSpeciesAvailability";
import { tankFitInputs } from "../../services/compatibleTanks";
import { assessSpeciesFit, fitPresentationKind } from "../../services/speciesFit";
import { summarizeAvailability } from "../../services/speciesAvailability";
import { estimateAddedStocking } from "../../utils/stockingGuidance";
import { getSpeciesCare } from "../logbook/SpeciesCareGuide";
import { buildSpeciesCarePrompt } from "../../utils/poseidonPrompts";
import { getPersonality } from "../../utils/personality";
import { SpeciesInsights } from "../reef/SpeciesInsights";
import { PoseidonChatConsole } from "../PoseidonChatConsole";
import { VERDICT_CHIP } from "../SpeciesCardPremium";
import "./CasualSpeciesDetail.css";

const isPlantEntry = (item) => !!item && item.type === "plant";

/**
 * CasualSpeciesDetail — the care-first Casual species detail (Fish Finder
 * Rework Task 8). Replaces the breeder-flavored "Catalog" detail
 * (BreedGallery's `if (selectedBreed)` branch) for Casual users only; the Pro
 * branch is untouched.
 *
 * "Can I keep this well?" — in order: an honest fit-for-*my*-tank verdict
 * (composing assessSpeciesFit/fitPresentationKind, T2/T6), grounded care needs
 * (composing SpeciesCareGuide's getSpeciesCare), stocking impact (composing
 * the new estimateAddedStocking), contextual Ask Poseidon, and the
 * acquisition hook (composing useSpeciesAvailability/summarizeAvailability,
 * T3/T6). Nothing here re-derives a score, a care fact, or a price — every
 * number is read from an existing canonical service.
 *
 * No hatchery/spawning logs, certificate/specimen cards, breeder stock-tag
 * editing, "Propose to Catalog", or manual-slider simulator — those are Pro
 * (or later-task) surfaces.
 */
export function CasualSpeciesDetail({
  breed,
  fishbaseData = [],
  contractSpecies = [],
  contractAddress,
  marketplaceAddress,
  walletAccount,
  displayTank,
  setDisplayTank,
  onBack,
}) {
  const { data: tanks = [] } = useUserTanks(contractAddress, walletAccount);
  const { getAvailability } = useSpeciesAvailability(contractAddress, marketplaceAddress);

  const fullProfile = useMemo(() => {
    return fishbaseData.find(
      (f) => f?.scientificName && breed?.scientificName &&
        f.scientificName.toLowerCase() === breed.scientificName.toLowerCase()
    ) || {};
  }, [fishbaseData, breed?.scientificName]);

  const isPlant = isPlantEntry(fullProfile) || isPlantEntry({ type: breed?.type });
  const subjectWord = isPlant ? "this species" : "this fish";

  const flavorText = getPersonality(fullProfile, "casual").flavorText;

  // ── Tank selector (mirrors the FishFinder tank-bar pattern) ──────────────
  const [selectedTankId, setSelectedTankId] = useState(null);

  useEffect(() => {
    if (selectedTankId != null) return;
    if (displayTank?.id != null) {
      setSelectedTankId(displayTank.id);
      return;
    }
    if (tanks.length > 0) {
      const first = tanks[0];
      setSelectedTankId(first.id);
      // Also seed displayTank so the fit panel has a tank context on first
      // load — otherwise the picker shows a tank selected while the verdict
      // still reads "no tank" until the user re-picks (only runs when
      // nothing was previously selected, mirroring FishFinder's fix).
      if (typeof setDisplayTank === "function") {
        setDisplayTank({ id: first.id, name: first.name, ...tankFitInputs(first) });
      }
    }
  }, [displayTank, tanks, selectedTankId, setDisplayTank]);

  const selectedTank = useMemo(
    () => tanks.find((t) => Number(t.id) === Number(selectedTankId)) || null,
    [tanks, selectedTankId]
  );

  const handleSelectTank = (tankId) => {
    setSelectedTankId(tankId);
    const tank = tanks.find((t) => Number(t.id) === Number(tankId));
    if (tank && typeof setDisplayTank === "function") {
      setDisplayTank({ id: tank.id, name: tank.name, ...tankFitInputs(tank) });
    }
  };

  const tankContext = displayTank
    ? { volume: displayTank.volume, temp: displayTank.temp, ph: displayTank.ph }
    : null;

  // ── Fit verdict (T2/T6 — composed, never re-derived) ──────────────────────
  const fit = useMemo(
    () => assessSpeciesFit(breed, tankContext, { fishbaseData }),
    [breed, tankContext, fishbaseData]
  );
  const presentationKind = fitPresentationKind(fit);
  const verdictChip = presentationKind !== "no_tank" ? VERDICT_CHIP[presentationKind] : null;

  // ── Grounded care needs (composes SpeciesCareGuide's getSpeciesCare) ──────
  const care = useMemo(
    () => getSpeciesCare(
      { speciesId: breed?.speciesId, commonName: breed?.commonName, scientificName: breed?.scientificName },
      fishbaseData,
      contractSpecies
    ),
    [breed, fishbaseData, contractSpecies]
  );

  // ── Stocking impact (new this task) ───────────────────────────────────────
  const stocking = useMemo(() => {
    if (!selectedTank) return null;
    return estimateAddedStocking(selectedTank, breed, { fishbaseData, contractSpecies });
  }, [selectedTank, breed, fishbaseData, contractSpecies]);

  // ── Ask Poseidon (exact TankList pattern: local seed state + console) ────
  const [poseidonSeed, setPoseidonSeed] = useState(null);
  const [poseidonOpen, setPoseidonOpen] = useState(false);
  const askPoseidon = (prompt) => {
    setPoseidonSeed(prompt || null);
    setPoseidonOpen(true);
  };

  // ── Acquisition hook (T3/T6 — composed, never re-derived) ─────────────────
  const availabilitySummary = summarizeAvailability(getAvailability(breed));
  const handleViewListings = () => {
    // TODO(T4): filter marketplace to breed.speciesId
    window.dispatchEvent(new CustomEvent("aquadex:navigate-tab", { detail: { tab: "directory" } }));
  };

  if (!breed) return null;

  return (
    <div className="casual-species-detail">
      {/* ── Header ───────────────────────────────────────────────────────── */}
      <div className="csd-header">
        <button type="button" onClick={onBack} className="btn-secondary csd-back">
          ← Back
        </button>

        {fullProfile.masterPhotoUrl && (
          <div className="csd-hero">
            <img src={fullProfile.masterPhotoUrl} alt={breed.commonName} />
            <div className="csd-hero-fade" />
          </div>
        )}

        <h2 className="csd-name">{breed.commonName}</h2>
        <p className="csd-sci">{breed.scientificName}</p>

        <div className="csd-meta-row">
          {breed.difficulty?.label && (
            <span className={`species-card-premium__badge species-card-premium__badge--${
              breed.difficulty.careLevel === 0 ? "easy" : breed.difficulty.careLevel === 2 ? "hard" : "medium"
            } csd-meta-badge`}>
              {breed.difficulty.label}
            </span>
          )}
          {!breed.difficulty?.label && care?.careLevelLabel && (
            <span className="species-card-premium__badge species-card-premium__badge--easy csd-meta-badge">
              {care.careLevelLabel}
            </span>
          )}
        </div>

        {flavorText && <p className="csd-flavor">"{flavorText}"</p>}
      </div>

      {/* ── "Does it fit your tank?" (the hero panel) ───────────────────── */}
      <div className="glass-card csd-fit-panel">
        <h3 className="csd-section-title">Does it fit your tank?</h3>

        {tanks.length === 0 ? (
          <div className="csd-empty-tank">
            <span>Add an aquarium to check whether {subjectWord} fits your water.</span>
            <button
              type="button"
              onClick={() => window.dispatchEvent(new CustomEvent("aquadex:navigate-tab", { detail: { tab: "tanks" } }))}
            >
              Add a tank →
            </button>
          </div>
        ) : (
          <>
            <div className="csd-tank-select">
              <label htmlFor="csd-tank-picker">Matching against</label>
              <select
                id="csd-tank-picker"
                value={selectedTankId ?? ""}
                onChange={(e) => handleSelectTank(e.target.value)}
              >
                {tanks.map((tank) => (
                  <option key={tank.id} value={tank.id}>
                    {tank.name || "Unnamed Tank"}
                  </option>
                ))}
              </select>
            </div>

            {verdictChip && (
              <div className="csd-verdict" style={{ color: verdictChip.color, borderColor: verdictChip.border }}>
                <span className="csd-verdict-chip" style={{ background: verdictChip.border }}>
                  {verdictChip.label}
                </span>
                <span className="csd-verdict-headline">{fit.headline}</span>
              </div>
            )}

            {Array.isArray(fit.reasons) && fit.reasons.length > 0 && (
              <ul className="csd-reasons">
                {fit.reasons.map((reason, i) => (
                  <li key={i}>{reason}</li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>

      {/* ── Care needs (grounded) ───────────────────────────────────────── */}
      {care && (
        <div className="glass-card csd-care-panel">
          <h3 className="csd-section-title">Care needs</h3>
          <div className="cg-chips">
            {care.tempMin != null && care.tempMax != null && (
              <span className="cg-chip">🌡️ {care.tempMin}–{care.tempMax}°C</span>
            )}
            {care.phMin != null && care.phMax != null && (
              <span className="cg-chip">🧪 pH {care.phMin}–{care.phMax}</span>
            )}
            {care.maxLengthCm != null && <span className="cg-chip">📏 up to {care.maxLengthCm} cm</span>}
            {care.temperament && <span className="cg-chip">🐟 {care.temperament}</span>}
            {care.diet && <span className="cg-chip">🍽️ {care.diet}</span>}
          </div>
          {care.tip && <p className="cg-tip">{care.tip}</p>}

          {(fullProfile.ecology?.biotope || fullProfile.ecology?.socialBehavior) && (
            <div className="csd-care-extra">
              {fullProfile.ecology?.biotope && (
                <p><strong>Biotope:</strong> {fullProfile.ecology.biotope}</p>
              )}
              {fullProfile.ecology?.socialBehavior && (
                <p><strong>Social behavior:</strong> {fullProfile.ecology.socialBehavior}</p>
              )}
            </div>
          )}

          <button
            type="button"
            className="cg-ask"
            onClick={() => askPoseidon(buildSpeciesCarePrompt(breed.commonName, selectedTank))}
          >
            💬 Ask Poseidon about {breed.commonName}
          </button>

          {/* Casual "Tips" — SpeciesInsights, unchanged component */}
          <div className="csd-tips">
            <SpeciesInsights
              specCode={breed.speciesId || fullProfile.specCode}
              speciesName={breed.commonName}
              casualModeActive={true}
            />
          </div>
        </div>
      )}

      {/* ── Stocking impact ──────────────────────────────────────────────── */}
      {selectedTank && (
        <div className="glass-card csd-stocking-panel">
          <h3 className="csd-section-title">Stocking impact</h3>
          {stocking?.canEstimate ? (
            <p>
              Adding {subjectWord} would bring {selectedTank.name || "your tank"} to ~{stocking.afterPercent}%
              of its stocking guideline (from ~{stocking.beforePercent}%).
            </p>
          ) : (
            <p className="csd-hint">We can't estimate the bioload — adult size unknown for this species.</p>
          )}
        </div>
      )}

      {/* ── Acquisition hook (T3/T6 — composed, never re-derived) ───────── */}
      {availabilitySummary && (
        <div className="glass-card csd-availability-panel">
          <p className="csd-availability-text">{availabilitySummary}</p>
          <button type="button" className="btn-primary csd-view-listings" onClick={handleViewListings}>
            View listings →
          </button>
        </div>
      )}

      {/* PoseidonChatConsole positions itself absolute/top:0/right:0/height:100%
          relative to its nearest positioned ancestor (see TankList's fixed-
          height biotope-banner wrapper). This detail page has no such fixed-
          height hero, so it gets its own viewport-fixed docking container. */}
      {poseidonOpen && (
        <div className="csd-poseidon-dock">
          <PoseidonChatConsole
            casualModeActive={true}
            walletAccount={walletAccount}
            seedPrompt={poseidonSeed}
            onClose={() => { setPoseidonOpen(false); setPoseidonSeed(null); }}
          />
        </div>
      )}
    </div>
  );
}
