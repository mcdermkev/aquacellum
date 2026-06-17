import React, { useMemo } from "react";
import { LazyImage } from "./LazyImage";
import { FishSilhouetteSVG, PlantSilhouetteSVG } from "./SilhouetteSVG";
import { getPersonality } from "../utils/personality";
import { getEasterEggConfig } from "./BreedGallery";

const isPlantEntry = (item) => {
  if (typeof item === "object" && item !== null) {
    return item.type === "plant";
  }
  return false;
};

const CARE_LABELS = ["Easy", "Medium", "Difficult", "Expert"];
const CARE_BADGE_CLASS = ["easy", "medium", "hard", "expert"];

export function SpeciesCardPremium({
  breed,
  fishbaseData,
  casualModeActive,
  isOwned,
  ownedCount,
  viewMode,
  searchTerm,
  magikarpEvolved,
  onSelect,
  onEasterEgg,
}) {
  const proMode = !casualModeActive;

  const matched = useMemo(() => {
    return fishbaseData.find(
      (f) => f.scientificName.toLowerCase() === breed.scientificName.toLowerCase()
    );
  }, [fishbaseData, breed.scientificName]);

  const breedImgSrc = matched?.masterPhotoUrl || "";
  const isPlant = isPlantEntry(matched || { specCode: breed.speciesId });

  const fallbackSvg = isPlant ? (
    <PlantSilhouetteSVG
      specCode={matched?.specCode || breed.speciesId}
      style={{ width: "100px", height: "100px" }}
    />
  ) : (
    <FishSilhouetteSVG
      specimenId={breed.speciesId}
      style={{ width: "120px", height: "120px" }}
    />
  );

  // Easter egg detection
  const activeEggType = matched?.easterEgg ||
    (Number(breed.speciesId) === 10691 ? "nami_lol" :
     Number(breed.speciesId) === 271 ? "magikarp_pokemon" : null);
  const eggConfig = activeEggType
    ? getEasterEggConfig(activeEggType, magikarpEvolved)
    : null;
  const isEggRevealed = eggConfig && (
    !casualModeActive ||
    eggConfig.keywords.some(w => (searchTerm || "").toLowerCase().includes(w))
  );

  // Casual mode metadata
  const profile = matched;
  const tagline = casualModeActive
    ? (getPersonality(profile, "casual").vibeLine ||
       profile?.ecology?.socialBehavior || "")
    : "";

  const tags = useMemo(() => {
    if (!casualModeActive || !profile) return [];
    const t = [];
    if (profile?.ecology?.socialBehavior?.toLowerCase().includes("school"))
      t.push("Schooling");
    if (profile?.diet?.trophicLevel === "Omnivore") t.push("Easy Feeder");
    if (breed.careLevel === 0) t.push("Beginner Friendly");
    return t.slice(0, 2);
  }, [casualModeActive, profile, breed.careLevel]);

  const careLabel = CARE_LABELS[breed.careLevel] || "Easy";
  const badgeClass = CARE_BADGE_CLASS[breed.careLevel] || "easy";

  const ctaText = casualModeActive
    ? (breed.specimenCount > 0 ? "Browse Available" : "Learn More")
    : (viewMode === "global" ? "Propose to Catalog" : "View Certificates");

  return (
    <div
      className={`species-card-premium${isOwned ? " card-owned" : ""}`}
      onClick={onSelect}
    >
      {/* Image Section */}
      <div className="species-card-premium__image">
        <LazyImage
          src={breedImgSrc}
          alt={breed.commonName}
          style={{ width: "100%", height: "100%" }}
          fallbackSvg={fallbackSvg}
        />

        {/* Care Level Badge */}
        <span className={`species-card-premium__badge species-card-premium__badge--${badgeClass}`}>
          {careLabel}
        </span>

        {/* Owned Badge */}
        {isOwned && (
          <span className="species-card-premium__owned">
            ✓ In Tank ({ownedCount})
          </span>
        )}

        {/* Easter Egg Badge */}
        {isEggRevealed && eggConfig && (
          <span
            onClick={(e) => {
              e.stopPropagation();
              onEasterEgg && onEasterEgg(eggConfig);
            }}
            style={{
              position: "absolute",
              bottom: "0.6rem",
              left: "0.6rem",
              fontSize: "0.6rem",
              fontWeight: "800",
              padding: "0.22rem 0.65rem",
              borderRadius: "20px",
              whiteSpace: "nowrap",
              color: eggConfig.color,
              background: eggConfig.bg,
              border: `1px solid ${eggConfig.border}`,
              backdropFilter: "blur(8px)",
              boxShadow: `0 0 10px ${eggConfig.glow}`,
              cursor: "pointer",
              zIndex: 10,
              letterSpacing: "0.03em",
            }}
          >
            {eggConfig.label}
          </span>
        )}

        {/* Pro: Spawning trait badge */}
        {proMode && matched?.reproduction?.spawningTrait &&
          matched.reproduction.spawningTrait !== "Information arriving soon" && (
          <span style={{
            position: "absolute",
            bottom: "0.6rem",
            right: "0.6rem",
            fontSize: "0.58rem",
            fontWeight: "700",
            padding: "0.2rem 0.6rem",
            borderRadius: "20px",
            color: "#fcd34d",
            background: "rgba(251, 191, 36, 0.14)",
            border: "1px solid rgba(251, 191, 36, 0.35)",
            backdropFilter: "blur(8px)",
            zIndex: 3,
          }}>
            🥚 {matched.reproduction.spawningTrait}
          </span>
        )}
      </div>

      {/* Card Body */}
      <div className="species-card-premium__body">
        <h3 className="species-card-premium__name">{breed.commonName}</h3>
        <p className="species-card-premium__sci">{breed.scientificName}</p>

        {/* Parameter Pills */}
        <div className="species-card-premium__params">
          <span className="species-card-premium__pill">
            <span className="species-card-premium__pill-icon">🌡️</span>
            {breed.minTemp}–{breed.maxTemp}°C
          </span>
          <span className="species-card-premium__pill">
            <span className="species-card-premium__pill-icon">💧</span>
            pH {breed.minPh}–{breed.maxPh}
          </span>
          {proMode && (
            <span className="species-card-premium__pill">
              <span className="species-card-premium__pill-icon">📐</span>
              {matched?.tankMetrics?.minVolumeGallons || 30} gal
            </span>
          )}
          {proMode && viewMode === "contract" && breed.specimenCount > 0 && (
            <span className="species-card-premium__pill">
              <span className="species-card-premium__pill-icon">📜</span>
              {breed.specimenCount} Certs
            </span>
          )}
        </div>

        {/* Casual: Tagline */}
        {casualModeActive && tagline && (
          <p className="species-card-premium__tagline">"{tagline}"</p>
        )}

        {/* Casual: Tags */}
        {casualModeActive && tags.length > 0 && (
          <div className="species-card-premium__tags">
            {tags.map(tag => (
              <span key={tag} className="species-card-premium__tag">{tag}</span>
            ))}
          </div>
        )}

        {/* Pro: Spec code reference */}
        {proMode && (
          <span style={{
            fontSize: "0.58rem",
            color: "var(--text-muted)",
            fontFamily: "monospace",
            opacity: 0.7,
            marginTop: "auto",
          }}>
            SpecCode #{breed.speciesId} · FishBase Validated
          </span>
        )}
      </div>

      {/* Footer CTA */}
      <div className="species-card-premium__cta">
        <span className="species-card-premium__cta-text">{ctaText}</span>
        <span className="species-card-premium__cta-arrow">→</span>
      </div>
    </div>
  );
}
