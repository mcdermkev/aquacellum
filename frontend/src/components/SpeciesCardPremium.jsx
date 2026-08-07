import React, { useMemo } from "react";
import { LazyImage } from "./LazyImage";
import { FishSilhouetteSVG, PlantSilhouetteSVG } from "./SilhouetteSVG";
import { getPersonality } from "../utils/personality";
import { getEasterEggConfig } from "./BreedGallery";
import { CARE_LABELS, CARE_BADGE_CLASS } from "../services/speciesCatalog";
import { fitPresentationKind, VERDICT_CHIP } from "../services/speciesFit";

const isPlantEntry = (item) => {
  if (typeof item === "object" && item !== null) {
    return item.type === "plant";
  }
  return false;
};

// Verdict chip presentation now lives with the fit engine that keys it
// (services/speciesFit.js, beside fitPresentationKind) so tests and other pure
// consumers can read the chip vocabulary without importing this component —
// which transitively pulls in BreedGallery → ethersCompat → `window.ethers`,
// unavailable in the node test environment (Fish Finder T11).
// Re-exported here so existing `from "./SpeciesCardPremium"` imports keep
// working unchanged.
export { VERDICT_CHIP } from "../services/speciesFit";

// Resolve the canonical difficulty descriptor for tier styling, without
// fabricating one. Only T1 global entries carry a canonical `.difficulty`
// (see speciesCatalog.js toCatalogEntry). Contract entries (numeric
// `careLevel` only, no raw string to normalize) resolve to null here — they
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

  // Honest difficulty tier (T6). Additive to the existing care-level badge —
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
      ? (breed.specimenCount > 0 ? "Browse Available" : "Learn More")
      : (viewMode === "global" ? "Propose to Catalog" : "View Certificates");

  const handleCtaClick = (e) => {
    if (hasAvailability && typeof onViewListings === "function") {
      e.stopPropagation();
      onViewListings();
    }
  };

  return (
    <div
      className={`species-card-premium${isOwned ? " card-owned" : ""}${difficultyDescriptor ? ` ${difficultyDescriptor.tierClass}` : ""}`}
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

        {/* Verdict Chip (T6) — informational for missing data, warning for a real mismatch */}
        {verdictChip && (
          <span
            className="species-card-premium__verdict-chip"
            style={{ color: verdictChip.color, borderColor: verdictChip.border }}
          >
            {verdictChip.label}
          </span>
        )}

        {/* Wishlist toggle (T9) — only rendered when the caller wires it in
            (FishFinder); BreedGallery's call site passes neither prop, so this
            never appears there. A bookmark, not an achievement — no XP here. */}
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
            {isWishlisted ? "♥" : "♡"}
          </button>
        )}

        {/* "Kept" ribbon (T9) — this species is already in the keeper's Dex.
            Upgraded with mastery color when species_mastery data is present. */}
        {isKept && (
          <span
            className="species-card-premium__kept-ribbon"
            title={
              masteryTier === "gold" ? "Gold mastery — full lifecycle"
              : masteryTier === "silver" ? "Silver mastery — bred or raised"
              : masteryTier === "bronze" ? "Bronze mastery — 30+ days kept"
              : "In your Dex"
            }
            style={masteryTier && masteryTier !== "kept" ? {
              background: masteryTier === "gold" ? "rgba(255, 215, 0, 0.15)"
                : masteryTier === "silver" ? "rgba(192, 192, 210, 0.12)"
                : "rgba(205, 127, 50, 0.12)",
              borderColor: masteryTier === "gold" ? "rgba(255, 215, 0, 0.4)"
                : masteryTier === "silver" ? "rgba(192, 192, 210, 0.35)"
                : "rgba(205, 127, 50, 0.35)",
              color: masteryTier === "gold" ? "#ffd700"
                : masteryTier === "silver" ? "#c0c0d2"
                : "#cd7f32",
            } : undefined}
          >
            {masteryTier === "gold" ? "🥇 Gold"
              : masteryTier === "silver" ? "🥈 Silver"
              : masteryTier === "bronze" ? "🥉 Bronze"
              : "✓ In your Dex"}
          </span>
        )}

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

        {/* Acquisition hook (T6) — rendered ONLY from summarizeAvailability's
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

      {/* Footer CTA. When it carries a real standalone action (View listings,
          T6), it's a focusable/keyboard-activatable button rather than a bare
          div, since it now does something distinct from the card's onSelect. */}
      {hasAvailability ? (
        <button type="button" className="species-card-premium__cta" onClick={handleCtaClick}>
          <span className="species-card-premium__cta-text">{ctaText}</span>
          <span className="species-card-premium__cta-arrow">→</span>
        </button>
      ) : (
        <div className="species-card-premium__cta">
          <span className="species-card-premium__cta-text">{ctaText}</span>
          <span className="species-card-premium__cta-arrow">→</span>
        </div>
      )}
    </div>
  );
}
