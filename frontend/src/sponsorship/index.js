/**
 * Aquadex Sponsorship Module
 * 
 * Unified export for all sponsorship components, hooks, and utilities.
 * 
 * Architecture:
 *   - SponsorProvider wraps the app and loads config
 *   - useSponsorSlot resolves a sponsor for any UI surface
 *   - useSponsorCampaign tracks XP challenge progress
 *   - SponsorBadge / SponsorCard / SponsorOverlay render branded UI
 *   - SponsorCampaignBanner shows active challenge progress
 *   - Analytics module tracks impressions for reporting
 * 
 * Integration points (surfaces):
 *   ┌─────────────────────────────────────────────────────────────┐
 *   │  Surface ID                  │  Location in App             │
 *   ├──────────────────────────────┼──────────────────────────────┤
 *   │  husbandry_feed              │  TankList → Feed action      │
 *   │  husbandry_treatment         │  TankList → Treatment action │
 *   │  husbandry_water_change      │  TankList → Water change     │
 *   │  alert_high_nitrate          │  Chemistry alerts            │
 *   │  alert_high_ammonia          │  Chemistry alerts            │
 *   │  species_detail_temperature  │  Species card / DB page      │
 *   │  species_detail_diet         │  Species card / DB page      │
 *   │  species_detail_habitat      │  Species card / DB page      │
 *   │  marketplace_featured        │  MarketplaceBoard listings   │
 *   │  checkout_shipping           │  CheckoutSummary shipping    │
 *   │  checkout_insurance          │  CheckoutSummary guarantee   │
 *   │  onboarding_equipment        │  OnboardingWizard tank setup │
 *   │  reef_biome                  │  ImmersiveReef biome zones   │
 *   │  reef_narration              │  NarrationLayer attribution  │
 *   │  xp_campaign                 │  XP system campaign banners  │
 *   └──────────────────────────────┴──────────────────────────────┘
 * 
 * When no sponsors are configured, everything returns null / renders nothing.
 */

// Provider
export { SponsorProvider, useSponsorContext } from "./SponsorProvider";

// Hooks
export { useSponsorSlot } from "./useSponsorSlot";
export { useSponsorImpression, useSponsorClick } from "./useSponsorImpression";
export { useSponsorCampaign } from "./useSponsorCampaign";

// Components
export { SponsorBadge } from "./SponsorBadge";
export { SponsorCard } from "./SponsorCard";
export { SponsorOverlay } from "./SponsorOverlay";
export { SponsorCampaignBanner } from "./SponsorCampaignBanner";

// Analytics
export { 
  getStoredImpressions, 
  generateReport, 
  exportForUpload, 
  clearStoredImpressions 
} from "./analytics/impressionLogger";
