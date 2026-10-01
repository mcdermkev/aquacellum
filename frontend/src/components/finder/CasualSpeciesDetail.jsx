import React, { useMemo, useState, useEffect } from "react";
import { useUserTanks } from "../../hooks/useUserTanks";
import { useSpeciesAvailability } from "../../hooks/useSpeciesAvailability";
import { tankFitInputs } from "../../services/compatibleTanks";
import { assessSpeciesFit, fitPresentationKind, VERDICT_CHIP } from "../../services/speciesFit";
import { summarizeAvailability } from "../../services/speciesAvailability";
import { estimateAddedStocking } from "../../utils/stockingGuidance";
import { getSpeciesCare } from "../logbook/SpeciesCareGuide";
import { buildSpeciesCarePrompt } from "../../utils/poseidonPrompts";
import { getPersonality } from "../../utils/personality";
import { SpeciesInsights } from "../reef/SpeciesInsights";
import { openEchoChat, openEchoPlanner } from "../../services/echoChatBus";
import { DETAIL_COPY } from "./finderCopy";
import { useUnitPrefs } from "../../hooks/useUnitPrefs";
import { formatTemperatureRange } from "../../utils/units";
import { SexingGuide } from "../SexingGuide";
import { SpeciesPhotoCredit } from "../SpeciesPhotoCredit";
import { realCareText } from "../../services/speciesCare";
import {
  ArrowLeft,
  Plus,
  CheckCircle,
  Warning,
  Info,
  XCircle,
  Thermometer,
  Flask,
  Ruler,
  FishSimple,
  ForkKnife,
  ChatCircleDots,
  TestTube,
  Storefront,
} from "@phosphor-icons/react";
import "./FishFinderDaylight.css";

const isPlantEntry = (item) => !!item && item.type === "plant";

// Verdict kind → icon. The tone (color) comes from `.ff-verdict--{kind}` in
// FishFinderDaylight.css, not from VERDICT_CHIP's colors, which are below
// 4.5:1 as text on white.
const VERDICT_ICON = {
  ok: CheckCircle,
  caution_mismatch: Warning,
  caution_data: Info,
  blocked: XCircle,
};

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
  const { tempUnit } = useUnitPrefs();

  const fullProfile = useMemo(() => {
    return fishbaseData.find(
      (f) => f?.scientificName && breed?.scientificName &&
        f.scientificName.toLowerCase() === breed.scientificName.toLowerCase()
    ) || {};
  }, [fishbaseData, breed?.scientificName]);

  const isPlant = isPlantEntry(fullProfile) || isPlantEntry({ type: breed?.type });
  const subjectWord = isPlant ? "this species" : "this fish";

  const flavorText = getPersonality(fullProfile, "casual").flavorText;
  const biotopeText = realCareText(fullProfile.ecology?.biotope);
  const socialText = realCareText(fullProfile.ecology?.socialBehavior);

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

  // ── Ask Echo: the one app-wide chat, with the chosen tank in context ──────
  const askPoseidon = (prompt) => {
    openEchoChat({ seedPrompt: prompt || null, tankId: selectedTank?.id ?? null });
  };

  // ── Acquisition hook (T3/T6 — composed, never re-derived) ─────────────────
  const availabilitySummary = summarizeAvailability(getAvailability(breed));
  const handleViewListings = () => {
    // T4a: open the marketplace filtered to this species.
    window.dispatchEvent(new CustomEvent("aquadex:navigate-tab", {
      detail: { tab: "directory", speciesId: breed?.speciesId, speciesName: breed?.commonName },
    }));
  };

  if (!breed) return null;

  const VerdictIcon = verdictChip ? VERDICT_ICON[presentationKind] : null;

  return (
    <div className="ff-detail">
      {/* ── Header ───────────────────────────────────────────────────────── */}
      <button type="button" onClick={onBack} className="ff-btn ff-btn--ghost ff-back">
        <ArrowLeft size={16} aria-hidden="true" />
        {DETAIL_COPY.back}
      </button>

      <div className="ff-intro">
        {fullProfile.masterPhotoUrl && (
          <figure className="ff-hero">
            <div className="ff-hero-frame">
              <img className="ff-hero-img" src={fullProfile.masterPhotoUrl} alt={breed.commonName} />
            </div>
            <figcaption className="ff-hero-credit">
              <SpeciesPhotoCredit
                scientificName={breed.scientificName}
                style={{ color: "var(--text-secondary)", fontSize: "0.78rem" }}
              />
            </figcaption>
          </figure>
        )}

        <h2 className="ff-name">{breed.commonName}</h2>
        <p className="ff-sci">{breed.scientificName}</p>

        <div className="ff-meta">
          {breed.difficulty?.label && (
            <span className={`ff-level ff-level--${
              breed.difficulty.careLevel === 0 ? "easy" : breed.difficulty.careLevel === 2 ? "hard" : "medium"
            }`}>
              {breed.difficulty.label}
            </span>
          )}
          {!breed.difficulty?.label && care?.careLevelLabel && (
            <span className="ff-level">{care.careLevelLabel}</span>
          )}
        </div>

        {flavorText && <p className="ff-flavor">"{flavorText}"</p>}
      </div>

      {/* ── "Does it fit your tank?" (the hero panel) ───────────────────── */}
      <section className="ff-card ff-panel" aria-labelledby="ff-fit-title">
        <h3 id="ff-fit-title" className="ff-panel-title">{DETAIL_COPY.fitTitle}</h3>

        {tanks.length === 0 ? (
          <div className="ff-context-empty">
            <p className="ff-context-text">{DETAIL_COPY.emptyFit(subjectWord)}</p>
            <button
              type="button"
              className="ff-btn ff-btn--primary"
              onClick={() => window.dispatchEvent(new CustomEvent("aquadex:navigate-tab", { detail: { tab: "tanks" } }))}
            >
              <Plus size={16} weight="bold" aria-hidden="true" />
              {DETAIL_COPY.emptyFitCta}
            </button>
          </div>
        ) : (
          <>
            <div>
              <label htmlFor="ff-detail-tank-picker" className="ff-field-label">{DETAIL_COPY.contextBar.pickerLabel}</label>
              <select
                id="ff-detail-tank-picker"
                className="ff-select"
                value={selectedTankId ?? ""}
                onChange={(e) => handleSelectTank(e.target.value)}
              >
                {tanks.map((tank) => (
                  <option key={tank.id} value={tank.id}>
                    {tank.name || DETAIL_COPY.contextBar.unnamed}
                  </option>
                ))}
              </select>
            </div>

            {verdictChip && (
              <div className={"ff-verdict ff-verdict--" + presentationKind}>
                {VerdictIcon && <VerdictIcon size={20} weight="fill" aria-hidden="true" />}
                <span className="ff-verdict-label">{verdictChip.label}</span>
                <span className="ff-verdict-headline">{fit.headline}</span>
              </div>
            )}

            {Array.isArray(fit.reasons) && fit.reasons.length > 0 && (
              <ul className="ff-reasons">
                {fit.reasons.map((reason, i) => (
                  <li key={i}>{reason}</li>
                ))}
              </ul>
            )}
          </>
        )}
      </section>

      {/* ── Care needs (grounded) ───────────────────────────────────────── */}
      {care && (
        <section className="ff-card ff-panel" aria-labelledby="ff-care-title">
          <h3 id="ff-care-title" className="ff-panel-title">{DETAIL_COPY.careTitle}</h3>
          <div className="ff-care-chips">
            {care.tempMin != null && care.tempMax != null && (
              <span className="ff-care-chip">
                <Thermometer size={16} aria-hidden="true" />
                {formatTemperatureRange(care.tempMin, care.tempMax, tempUnit)}
              </span>
            )}
            {care.phMin != null && care.phMax != null && (
              <span className="ff-care-chip">
                <Flask size={16} aria-hidden="true" />
                pH {care.phMin}–{care.phMax}
              </span>
            )}
            {care.maxLengthCm != null && (
              <span className="ff-care-chip">
                <Ruler size={16} aria-hidden="true" />
                up to {care.maxLengthCm} cm
              </span>
            )}
            {care.temperament && (
              <span className="ff-care-chip">
                <FishSimple size={16} aria-hidden="true" />
                {care.temperament}
              </span>
            )}
            {care.diet && (
              <span className="ff-care-chip">
                <ForkKnife size={16} aria-hidden="true" />
                {care.diet}
              </span>
            )}
          </div>
          {care.tip && <p className="ff-tip">{care.tip}</p>}

          {/* Only recorded text; placeholders and blanks hide the row. */}
          {(biotopeText || socialText) && (
            <div className="ff-care-extra">
              {biotopeText && (
                <p className="ff-care-row">
                  <strong className="ff-care-row-label">{DETAIL_COPY.biotopeLabel}</strong> {biotopeText}
                </p>
              )}
              {socialText && (
                <p className="ff-care-row">
                  <strong className="ff-care-row-label">{DETAIL_COPY.socialLabel}</strong> {socialText}
                </p>
              )}
            </div>
          )}

          {/* Male vs female. Hidden when undocumented: this is a browsing surface
              for someone choosing a fish, so an "unknown" row per species would be
              noise. The species page states the gap explicitly instead. */}
          <SexingGuide record={fullProfile} casual hideWhenUndocumented />

          {/* Ask Echo + Plan a tank (Echo's two actions, unchanged), side by side. */}
          <div className="ff-echo-actions">
            <button
              type="button"
              className="ff-btn ff-btn--soft"
              onClick={() => askPoseidon(buildSpeciesCarePrompt(breed.commonName, selectedTank))}
            >
              <ChatCircleDots size={18} aria-hidden="true" />
              {DETAIL_COPY.askEcho(breed.commonName)}
            </button>
            <button
              type="button"
              className="ff-btn"
              onClick={() => openEchoPlanner({ species: [fullProfile?.scientificName ? fullProfile : breed], tankId: selectedTank?.id ?? null })}
            >
              <TestTube size={18} aria-hidden="true" />
              {DETAIL_COPY.planTank}
            </button>
          </div>

          {/* Casual "Tips" — SpeciesInsights, unchanged component */}
          <div className="ff-tips">
            <SpeciesInsights
              specCode={breed.speciesId || fullProfile.specCode}
              speciesName={breed.commonName}
              casualModeActive={true}
            />
          </div>
        </section>
      )}

      {/* ── Stocking impact ──────────────────────────────────────────────── */}
      {selectedTank && (
        <section className="ff-card ff-panel" aria-labelledby="ff-stocking-title">
          <h3 id="ff-stocking-title" className="ff-panel-title">{DETAIL_COPY.stockingTitle}</h3>
          {stocking?.canEstimate ? (
            <p className="ff-panel-text">
              {DETAIL_COPY.stockingImpact(
                subjectWord,
                selectedTank.name || DETAIL_COPY.fallbackName,
                stocking.afterPercent,
                stocking.beforePercent
              )}
            </p>
          ) : (
            <p className="ff-hint">{DETAIL_COPY.stockingUnknown}</p>
          )}
        </section>
      )}

      {/* ── Acquisition hook (T3/T6 — composed, never re-derived) ───────── */}
      {availabilitySummary && (
        <div className="ff-card ff-avail">
          <p className="ff-avail-text">{availabilitySummary}</p>
          <button type="button" className="ff-btn ff-btn--primary" onClick={handleViewListings}>
            <Storefront size={18} aria-hidden="true" />
            {DETAIL_COPY.viewListings}
          </button>
        </div>
      )}
    </div>
  );
}
