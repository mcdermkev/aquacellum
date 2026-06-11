import { useMemo } from "react";
import { useSponsorContext } from "./SponsorProvider";

/**
 * useSponsorSlot
 * 
 * Primary hook for consuming sponsorship data at any UI surface.
 * Returns the resolved sponsor + product for a given slot, or null.
 * 
 * Usage:
 *   const sponsor = useSponsorSlot("husbandry_feed", { speciesGroup: "cichlidae" });
 *   // sponsor is null when no sponsor is active — render nothing
 *   // sponsor has { sponsor, product, productLink, tagline } when active
 * 
 * Surfaces:
 *   - "husbandry_feed"           → Feed action in My Aquarium
 *   - "husbandry_treatment"      → Treatment action
 *   - "husbandry_water_change"   → Water change action
 *   - "alert_high_nitrate"       → Chemistry alert: nitrate
 *   - "alert_high_ammonia"       → Chemistry alert: ammonia
 *   - "species_detail_temperature" → Species card: temperature section
 *   - "species_detail_diet"      → Species card: diet section
 *   - "species_detail_habitat"   → Species card: habitat section
 *   - "marketplace_featured"     → Marketplace featured listing slot
 *   - "checkout_shipping"        → Checkout shipping partner badge
 *   - "checkout_insurance"       → Checkout arrival guarantee
 *   - "onboarding_equipment"     → Onboarding wizard equipment suggestion
 *   - "reef_biome"               → Immersive Reef biome sponsorship
 *   - "reef_narration"           → Reef AI narration attribution
 *   - "xp_campaign"              → XP loyalty campaign branding
 */
export function useSponsorSlot(surface, context = {}) {
  const { resolveSponsorSlot, logImpression } = useSponsorContext();

  const resolved = useMemo(() => {
    return resolveSponsorSlot(surface, context);
  }, [surface, context?.species, context?.speciesGroup, context?.actionType]);

  // Auto-log impression when a slot resolves (first render only via memo)
  // Actual impression tracking is deferred to the Badge/Card component onMount

  return resolved;
}
