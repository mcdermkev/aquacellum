/**
 * useSpeciesMastery — server-authoritative per-species progression.
 *
 * COSMETIC_EXPRESSION_SPEC.md §1. One fetch, one cache, used everywhere:
 * MyDexPanel species cards, ListingCard seller chip, PublicProfile Dex,
 * certificate frame derivation. Never re-derived locally — the view in
 * Supabase is the single source of truth, and all rendering reads from this
 * hook's react-query cache.
 *
 * Returns `null` while loading (callers should treat null as "data not ready",
 * not "no mastery"), so a brief flash of an undecorated card is preferred over
 * showing a wrong tier.
 *
 * @param {string|null} walletAddress
 * @returns {{ data: Map<string, MasteryEntry> | null, isLoading: boolean }}
 *
 * MasteryEntry: { speciesKey, commonName, masteryTier, daysKept, hasSpawned,
 *                 hasRaisedFry, hasRaisedPurchased }
 */

import { useQuery } from "@tanstack/react-query";
import { supabase, isSupabaseConfigured } from "../services/supabaseClient";

/**
 * Mastery tier hierarchy for comparison / sorting.
 */
export const MASTERY_TIERS = Object.freeze({
  kept: { order: 0, label: "Kept", color: "#64748b", borderColor: "rgba(100, 116, 139, 0.3)" },
  bronze: { order: 1, label: "Bronze", color: "#cd7f32", borderColor: "rgba(205, 127, 50, 0.5)" },
  silver: { order: 2, label: "Silver", color: "#c0c0d2", borderColor: "rgba(192, 192, 210, 0.5)" },
  gold: { order: 3, label: "Gold", color: "#ffd700", borderColor: "rgba(255, 215, 0, 0.5)", glow: "0 0 8px rgba(255, 215, 0, 0.2)" },
});

/**
 * Fetch mastery for a single wallet. Cached for 5 minutes — mastery changes
 * slowly (days, not seconds), so frequent refetches waste bandwidth.
 */
export function useSpeciesMastery(walletAddress) {
  const { data, isLoading } = useQuery({
    queryKey: ["speciesMastery", (walletAddress || "").toLowerCase()],
    enabled: !!walletAddress && isSupabaseConfigured(),
    staleTime: 1000 * 60 * 5,
    gcTime: 1000 * 60 * 30,
    queryFn: async () => {
      const wallet = String(walletAddress).toLowerCase();
      const { data: rows, error } = await supabase
        .from("species_mastery")
        .select("species_key, common_name, mastery_tier, days_kept, has_spawned, has_raised_fry, has_raised_purchased")
        .eq("wallet_address", wallet);

      if (error) {
        console.warn("[useSpeciesMastery] fetch failed:", error.message);
        return new Map();
      }

      const map = new Map();
      for (const row of rows || []) {
        map.set(row.species_key, {
          speciesKey: row.species_key,
          commonName: row.common_name,
          masteryTier: row.mastery_tier || "kept",
          daysKept: Math.floor(Number(row.days_kept) || 0),
          hasSpawned: !!row.has_spawned,
          hasRaisedFry: !!row.has_raised_fry,
          hasRaisedPurchased: !!row.has_raised_purchased,
        });
      }
      return map;
    },
  });

  return { data: data ?? null, isLoading };
}

/**
 * Look up mastery for a specific species from a pre-fetched map.
 * Returns the tier metadata object (from MASTERY_TIERS) + the entry, or a
 * default "kept" state if absent.
 *
 * @param {Map|null} masteryMap from useSpeciesMastery
 * @param {string} speciesKey lowercased scientificName
 * @returns {{ tier: string, meta: object, entry: object|null }}
 */
export function getMasteryForSpecies(masteryMap, speciesKey) {
  const key = String(speciesKey || "").toLowerCase().trim();
  const entry = masteryMap?.get(key) || null;
  const tier = entry?.masteryTier || "kept";
  const meta = MASTERY_TIERS[tier] || MASTERY_TIERS.kept;
  return { tier, meta, entry };
}

export default useSpeciesMastery;
