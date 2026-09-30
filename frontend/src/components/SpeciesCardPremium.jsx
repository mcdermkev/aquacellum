import React, { useMemo } from "react";
import { Heart, Check, Medal, Egg, Thermometer, Drop, Ruler, Certificate, ArrowRight } from "@phosphor-icons/react";
import { LazyImage } from "./LazyImage";
import { FishSilhouetteSVG, PlantSilhouetteSVG } from "./SilhouetteSVG";
import { getPersonality } from "../utils/personality";
import { getEasterEggConfig } from "./BreedGallery";
import { CARE_LABELS, CARE_BADGE_CLASS } from "../services/speciesCatalog";
import { fitPresentationKind, VERDICT_CHIP } from "../services/speciesFit";
import { casualCardTags } from "../services/speciesCardTags";
import { entryCareRanges, realCareText, realCareNumber } from "../services/speciesCare";
import "./SpeciesCardPremium.css";

const isPlantEntry = (item) => {
  if (typeof item === "object" && item !== null) {
    return item.type === "plant";
  }
  return false;
};

// Verdict chip presentation now lives with the fit engine that keys it
// (services/speciesFit.js, beside fitPresentationKind) so tests and other pure
// consumers can read the chip vocabulary without importing this component,
// which transitively pulls in BreedGallery → ethersCompat → `window.ethers`,
// unavailable in the node test environment (Fish Finder T11).
// Re-exported here so existing `from "./SpeciesCardPremium"` imports keep
// working unchanged.
export { VERDICT_CHIP } from "../services/speciesFit";

// Resolve the canonical difficulty descriptor for tier styling, without
// fabricating one. Only T1 global entries carry a canonical `.difficulty`
// (see speciesCatalog.js toCatalogEntry). Contract entries (numeric
// `careLevel` only, no raw string to normalize) resolve to null here; they
// keep today's CARE_LABELS badge with no added tier class, per the "unknown
// stays unstyled/neutral" rule.
function resolveDifficultyDescriptor(breed) {
  if (breed?.difficulty && typeof breed.difficulty === "object" && breed.difficulty.tierClass) {
    return breed.difficulty.key === "unknown" ? null : breed.difficulty;
  }
  return null;
}

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
  fit,
  availabilitySummary,
  onViewListings,
  isWishlisted,
  onToggleWishlist,
  isKept,
  masteryTier, // "kept" | "bronze" | "silver" | "gold" | undefined
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
       realCareText(profile?.ecology?.socialBehavior) || "")
    : "";

  // Only recorded ranges get a pill. Global entries' flat minPh / maxPh fall
  // back to display defaults, so read the honest profile (services/speciesCare.js).
  const { tempRange, phRange } = entryCareRanges(breed);
  const minVolume = realCareNumber(matched?.tankMetrics?.minVolumeGallons);
  const spawningTrait = realCareText(matched?.reproduction?.spawningTrait);

  // Tags only when backed by recorded data (services/speciesCardTags.js).
  // "Easy Feeder" needs a real trophic level and never applies to plants.
  const tags = useMemo(() => {
    if (!casualModeActive || !profile) return [];
    return casualCardTags(profile, { careLevel: breed.careLevel, isPlant });
  }, [casualModeActive, profile, breed.careLevel, isPlant]);

  const careLabel = CARE_LABELS[breed.careLevel] || "Easy";
  const badgeClass = CARE_BADGE_CLASS[breed.careLevel] || "easy";

  // Honest difficulty tier (T6). Additive to the existing care-level badge,
  // never fabricated for a species with no recognized difficulty.
  const difficultyDescriptor = resolveDifficultyDescriptor(breed);

  // Verdict chip (T6): only when a fit was passed and there's an active tank.
  const presentationKind = fit ? fitPresentationKind(fit) : null;
  const verdictChip = presentationKind && presentationKind !== "no_tank"
    ? VERDICT_CHIP[presentationKind]
    : null;

  const hasAvailability = !!availabilitySummary;

  const ctaText = hasAvailability
    ? "View listings"
    : casualModeActive
      ? (breed.specimenCount > 0 ? "See available fish" : "Learn more")
      : (viewMode === "global" ? "View details" : "View certificates");

  const handleCtaClick = (e) => {
    if (hasAvailability && typeof onViewListings === "function") {
      e.stopPropagation();
      onViewListings();
    }
  };

  return (
    <div
      className={`bgal-card species-card-premium${isOwned ? " card-owned" : ""}${difficultyDescriptor ? ` ${difficultyDescriptor.tierClass}` : ""}`}
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

        {/* Verdict Chip (T6): informational for missing data, warning for a
            real mismatch. The verdict colour is too light for text on white,
            so it rides on the ring and the dot; the label stays dark. */}
        {verdictChip && (
          <span
            className="species-card-premium__verdict-chip"
            style={{ borderColor: verdictChip.border }}
          >
            <span className="bgal-card__dot" style={{ background: verdictChip.color }} aria-hidden="true" />
            {verdictChip.label}
          </span>
        )}

        {/* Wishlist toggle (T9): only rendered when the caller wires it in
            (FishFinder); BreedGallery's call site passes neither prop, so this
            never appears there. A bookmark, not an achievement: no XP here.
            A Phosphor heart, filled when saved. */}
        {typeof onToggleWishlist === "function" && (
          <button
            type="button"
            className={`species-card-premium__wishlist${isWishlisted ? " species-card-premium__wishlist--active" : ""}`}
            aria-label={isWishlisted ? "Remove from wishlist" : "Add to wishlist"}
            aria-pressed={!!isWishlisted}
            onClick={(e) => {
              e.stopPropagation();
              onToggleWishlist();
            }}
          >
            <Heart size={20} weight={isWishlisted ? "fill" : "regular"} aria-hidden="true" />
          </button>
        )}

        {/* "Kept" ribbon (T9): this species is already in the keeper's Dex.
            Upgraded with a mastery tier class when species_mastery data is
            present (text-safe tones in SpeciesCardPremium.css). */}
        {isKept && (
          <span
            className={`species-card-premium__kept-ribbon bgal-card__kept${
              masteryTier === "gold" || masteryTier === "silver" || masteryTier === "bronze"
                ? ` bgal-card__kept--${masteryTier}`
                : ""
            }`}
            title={
              masteryTier === "gold" ? "Gold mastery: full lifecycle"
              : masteryTier === "silver" ? "Silver mastery: bred or raised"
              : masteryTier === "bronze" ? "Bronze mastery: 30+ days kept"
              : "In your Dex"
            }
          >
            {masteryTier === "gold" || masteryTier === "silver" || masteryTier === "bronze"
              ? <Medal size={12} weight="fill" aria-hidden="true" />
              : <Check size={12} weight="bold" aria-hidden="true" />}
            {masteryTier === "gold" ? "Gold"
              : masteryTier === "silver" ? "Silver"
              : masteryTier === "bronze" ? "Bronze"
              : "In your Dex"}
          </span>
        )}

        {/* Owned Badge */}
        {isOwned && (
          <span className="species-card-premium__owned">
            <Check size={12} weight="bold" aria-hidden="true" />
            In your tanks ({ownedCount})
          </span>
        )}

        {/* Easter Egg Badge: a real button so it is keyboard reachable. The
            label and colours come from getEasterEggConfig unchanged. */}
        {isEggRevealed && eggConfig && (
          <button
            type="button"
            className="bgal-card__egg"
            onClick={(e) => {
              e.stopPropagation();
              onEasterEgg && onEasterEgg(eggConfig);
            }}
            style={{
              color: eggConfig.color,
              background: eggConfig.bg,
              border: `1px solid ${eggConfig.border}`,
            }}
          >
            {eggConfig.label}
          </button>
        )}

        {/* Pro: Spawning trait badge */}
        {proMode && spawningTrait && (
          <span className="bgal-card__spawn" title={spawningTrait}>
            <Egg size={12} aria-hidden="true" /> {spawningTrait}
          </span>
        )}
      </div>

      {/* Card Body */}
      <div className="species-card-premium__body">
        {/* The name is the card's keyboard target: its ::after stretches over
            the card, and a click on it bubbles to the root's onSelect, so
            mouse, Enter and Space all open the card once. */}
        <h3 className="species-card-premium__name">
          <button type="button" className="bgal-card__open">{breed.commonName}</button>
        </h3>
        <p className="species-card-premium__sci">{breed.scientificName}</p>

        {/* Parameter Pills */}
        <div className="species-card-premium__params">
          {tempRange && (
            <span className="species-card-premium__pill">
              <span className="species-card-premium__pill-icon"><Thermometer size={13} aria-hidden="true" /></span>
              {tempRange[0]}–{tempRange[1]}°C
            </span>
          )}
          {phRange && (
            <span className="species-card-premium__pill">
              <span className="species-card-premium__pill-icon"><Drop size={13} aria-hidden="true" /></span>
              pH {phRange[0]}–{phRange[1]}
            </span>
          )}
          {proMode && minVolume != null && (
            <span className="species-card-premium__pill">
              <span className="species-card-premium__pill-icon"><Ruler size={13} aria-hidden="true" /></span>
              {minVolume} gal
            </span>
          )}
          {proMode && viewMode === "contract" && breed.specimenCount > 0 && (
            <span className="species-card-premium__pill">
              <span className="species-card-premium__pill-icon"><Certificate size={13} aria-hidden="true" /></span>
              {breed.specimenCount} certificates
            </span>
          )}
        </div>

        {/* Acquisition hook (T6): rendered ONLY from summarizeAvailability's
            output; this component never computes its own price/seller count. */}
        {hasAvailability && (
          <p className="species-card-premium__availability">{availabilitySummary}</p>
        )}

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

        {/* Pro: catalog ID reference. speciesId is the Aquacellum catalog ID,
            not a FishBase SpecCode (that is fishbaseSpecCode on the record). */}
        {proMode && (
          <span className="bgal-card__catalog-id">
            Catalog #{breed.speciesId}
          </span>
        )}
      </div>

      {/* Footer CTA. When it carries a real standalone action (View listings,
          T6), it's a focusable/keyboard-activatable button rather than a bare
          div, since it now does something distinct from the card's onSelect. */}
      {hasAvailability ? (
        <button type="button" className="species-card-premium__cta" onClick={handleCtaClick}>
          <span className="species-card-premium__cta-text">{ctaText}</span>
          <span className="species-card-premium__cta-arrow"><ArrowRight size={14} weight="bold" aria-hidden="true" /></span>
        </button>
      ) : (
        <div className="species-card-premium__cta">
          <span className="species-card-premium__cta-text">{ctaText}</span>
          <span className="species-card-premium__cta-arrow"><ArrowRight size={14} weight="bold" aria-hidden="true" /></span>
        </div>
      )}
    </div>
  );
}
