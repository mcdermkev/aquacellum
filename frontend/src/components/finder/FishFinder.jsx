import React, { useMemo, useState, useEffect, useRef } from "react";
import { BreedGallery } from "../BreedGallery";
import { SpeciesCardPremium } from "../SpeciesCardPremium";
import { LoadingSkeleton } from "../LoadingSkeleton";
import { useContractSpecies, useSpeciesData } from "../../hooks/useSpeciesData";
import { useUserTanks } from "../../hooks/useUserTanks";
import { buildGlobalCatalog } from "../../services/speciesCatalog";
import { tankFitInputs } from "../../services/compatibleTanks";
import { rankSpeciesMatches } from "./matchRanking";
import "./FishFinder.css";

// Same verdict → color mapping BreedGallery uses (Fish Finder T2), so the
// chip on a match card always agrees with the "Tank Match" widget below.
const VERDICT_COLOR = Object.freeze({
  ok: "hsl(140, 70%, 45%)",       // green
  caution: "hsl(42, 92%, 52%)",   // amber
  blocked: "hsl(0, 78%, 55%)",    // red
  no_tank: "hsl(210, 10%, 55%)",  // neutral
});

const VERDICT_LABEL = Object.freeze({
  ok: "Good fit",
  caution: "Caution",
  blocked: "Not a fit",
  no_tank: "No tank",
});

/**
 * FishFinder — the Casual `gallery` tab surface (Fish Finder Rework, Task 5).
 *
 * Renders, top to bottom:
 *   1. a tank context bar (pick which tank to match against)
 *   2. the "Good matches for [Tank]" home section (new, this task)
 *   3. the existing <BreedGallery casualModeActive /> unchanged, as the
 *      "Browse all species" continuation.
 *
 * Accepts and forwards every prop BreedGallery receives today. Does not fork
 * any fit/compatibility logic — composes rankSpeciesMatches (matchRanking.js),
 * which itself composes the canonical assessSpeciesFit.
 */
export function FishFinder({
  contractAddress,
  marketplaceAddress,
  walletAccount,
  onViewLineage,
  preselectedBreedId,
  onClearPreselectedBreed,
  onSelectSpecimen,
  displayTank,
  setDisplayTank,
  onSelectCheckoutOrder,
  onCheckoutSuccessRedirect,
  casualModeActive,
  initialSelectedBreed,
  onSelectedBreedChange,
}) {
  const browseSectionRef = useRef(null);

  const { data: tanks = [], isLoading: tanksLoading } = useUserTanks(contractAddress, walletAccount);
  const { data: fishbaseData = [], isLoading: speciesLoading } = useSpeciesData();
  const { data: contractSpecies = [], isLoading: contractLoading } = useContractSpecies(contractAddress);

  // One source of candidates: prefer the on-chain registered catalog when
  // non-empty, else fall back to the curated global catalog. Keeps this
  // simple per the T5 spec — no merge of both.
  const candidates = useMemo(() => {
    if (Array.isArray(contractSpecies) && contractSpecies.length > 0) return contractSpecies;
    return buildGlobalCatalog(fishbaseData);
  }, [contractSpecies, fishbaseData]);

  const isLoadingCandidates = speciesLoading || contractLoading;

  // Track the selected tank id locally; default to the current displayTank
  // (matched by id) if set, else the user's first tank.
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
      // Also seed displayTank so the "Good matches" section has a tank context
      // on first load — otherwise a tank shows selected in the bar while the
      // matches read "Choose a tank above" until the user re-picks. Only runs
      // when nothing was previously selected (displayTank?.id == null).
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

  // Species already residing in the selected tank — excluded from "fish to
  // add" so the home reads as a shopping list, not a mirror of the tank.
  const residingSpeciesIds = useMemo(() => {
    if (!selectedTank || !Array.isArray(selectedTank.specimens)) return [];
    const ids = selectedTank.specimens
      .filter((s) => !s.isBatchPlaceholder && s.speciesId)
      .map((s) => Number(s.speciesId));
    return Array.from(new Set(ids));
  }, [selectedTank]);

  const matches = useMemo(
    () => rankSpeciesMatches(candidates, tankContext, { fishbaseData, limit: 12, excludeSpeciesIds: residingSpeciesIds }),
    [candidates, tankContext, fishbaseData, residingSpeciesIds]
  );

  // Selection wiring into the inner BreedGallery's existing detail view.
  //
  // BreedGallery's `initialSelectedBreed` only seeds state on mount (its
  // effect has an empty dep array), so re-passing a changed value once
  // BreedGallery is already mounted underneath us does nothing. Its
  // `preselectedBreedId` prop IS reactive, but it only matches against the
  // on-chain `contractSpeciesList` (viewMode === "contract").
  //
  // So: when candidates come from the contract catalog (the common case),
  // selecting a match card sets a local preselect id that flows into
  // BreedGallery's reactive `preselectedBreedId` channel and opens its
  // existing detail view. When candidates are the curated global catalog
  // (no registered on-chain species yet), that channel can't match — per the
  // T5 escalation tripwire, we don't restructure BreedGallery's detail path;
  // we fall back to scrolling the browse section into view instead.
  const [matchPreselectId, setMatchPreselectId] = useState(null);
  const usingContractCatalog = Array.isArray(contractSpecies) && contractSpecies.length > 0;

  const handleSelectMatch = (entry) => {
    if (usingContractCatalog) {
      setMatchPreselectId(entry.speciesId);
    } else if (browseSectionRef.current) {
      browseSectionRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  const effectivePreselectedBreedId = matchPreselectId ?? preselectedBreedId;
  const handleClearPreselectedBreed = () => {
    setMatchPreselectId(null);
    if (typeof onClearPreselectedBreed === "function") onClearPreselectedBreed();
  };

  return (
    <div className="fish-finder">
      {/* ── Tank context bar ────────────────────────────────────────────── */}
      <div className="fish-finder__tank-bar glass-card">
        <div className="fish-finder__tank-bar-label">
          <span className="fish-finder__tank-bar-icon" aria-hidden="true">🐠</span>
          <span>Matching against</span>
        </div>

        {tanksLoading ? (
          <div className="fish-finder__tank-bar-loading shimmer-placeholder" />
        ) : tanks.length === 0 ? (
          <div className="fish-finder__tank-bar-empty">
            <span>Add an aquarium to get matches picked for your water.</span>
            <button
              type="button"
              className="fish-finder__tank-bar-cta"
              onClick={() => window.dispatchEvent(new CustomEvent("aquadex:navigate-tab", { detail: { tab: "tanks" } }))}
            >
              Add a tank →
            </button>
          </div>
        ) : (
          <div className="fish-finder__tank-bar-select">
            <select
              value={selectedTankId ?? ""}
              onChange={(e) => handleSelectTank(e.target.value)}
              aria-label="Choose a tank to match against"
            >
              {tanks.map((tank) => (
                <option key={tank.id} value={tank.id}>
                  {tank.name || "Unnamed Tank"}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* ── "Good matches" home ─────────────────────────────────────────── */}
      <div className="fish-finder__home">
        <h2 className="fish-finder__home-title">
          {selectedTank ? `Good matches for ${selectedTank.name || "your tank"}` : "Good matches for your tank"}
        </h2>

        {!tankContext ? (
          <p className="fish-finder__home-hint">
            {tanks.length === 0
              ? "Add an aquarium above to see fish picked for your water."
              : "Choose a tank above to see personalized matches."}
          </p>
        ) : isLoadingCandidates ? (
          <LoadingSkeleton variant="gallery" count={4} />
        ) : matches.length === 0 ? (
          <p className="fish-finder__home-hint">No matches to show yet.</p>
        ) : (
          <div className="fish-finder__matches-grid">
            {matches.map(({ entry, fit }) => (
              <div key={entry.speciesId} className="fish-finder__match-card">
                <SpeciesCardPremium
                  breed={entry}
                  fishbaseData={fishbaseData}
                  casualModeActive={true}
                  isOwned={false}
                  ownedCount={0}
                  viewMode={Array.isArray(contractSpecies) && contractSpecies.length > 0 ? "contract" : "global"}
                  searchTerm=""
                  onSelect={() => handleSelectMatch(entry)}
                />
                <span
                  className="fish-finder__verdict-chip"
                  style={{ color: VERDICT_COLOR[fit.verdict], borderColor: `${VERDICT_COLOR[fit.verdict]}50` }}
                >
                  {VERDICT_LABEL[fit.verdict] || "Caution"}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Browse all species — the existing gallery, unchanged ───────── */}
      <div className="fish-finder__browse" ref={browseSectionRef}>
        <h2 className="fish-finder__browse-title">Browse all species</h2>
        <BreedGallery
          contractAddress={contractAddress}
          marketplaceAddress={marketplaceAddress}
          walletAccount={walletAccount}
          onViewLineage={onViewLineage}
          preselectedBreedId={effectivePreselectedBreedId}
          onClearPreselectedBreed={handleClearPreselectedBreed}
          onSelectSpecimen={onSelectSpecimen}
          displayTank={displayTank}
          setDisplayTank={setDisplayTank}
          onSelectCheckoutOrder={onSelectCheckoutOrder}
          onCheckoutSuccessRedirect={onCheckoutSuccessRedirect}
          casualModeActive={casualModeActive}
          initialSelectedBreed={initialSelectedBreed}
          onSelectedBreedChange={onSelectedBreedChange}
        />
      </div>
    </div>
  );
}
