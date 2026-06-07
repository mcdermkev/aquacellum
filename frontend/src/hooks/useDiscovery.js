/**
 * useDiscovery.js
 *
 * React hooks for Reef discovery features:
 * - Nearby Breeders (profiles sharing the user's zoneHash region)
 * - Breeders Who Keep [Species] (profile search by species tags)
 * - Top Contributors This Week (leaderboard: insights posted + audits given)
 */

import { useQuery } from "@tanstack/react-query";
import { supabase, getCurrentWallet, isSupabaseConfigured } from "../services/supabaseClient";

/**
 * Fetch nearby breeders based on zone_hash grouping.
 * Profiles include a `zone_hash` column populated during onboarding or
 * profile update. We group breeders who share the same hash prefix (first 4 chars)
 * to approximate regional proximity without exposing exact coordinates.
 *
 * Fallback: if the current user has no zone_hash, return recently active breeders instead.
 */
export function useNearbyBreeders(enabled = true) {
  const walletAddress = getCurrentWallet();

  return useQuery({
    queryKey: ["reef", "discovery", "nearby", walletAddress],
    queryFn: async () => {
      if (!isSupabaseConfigured()) return [];

      // First, get the current user's zone_hash
      const { data: myProfile } = await supabase
        .from("profiles")
        .select("zone_hash")
        .eq("wallet_address", walletAddress)
        .single();

      let query;

      if (myProfile?.zone_hash) {
        // Match breeders with same zone_hash prefix (regional proximity)
        const regionPrefix = myProfile.zone_hash.substring(0, 4);
        query = supabase
          .from("profiles")
          .select("wallet_address, display_name, avatar_url, companion_tier, species_count, tank_count, xp_total, zone_hash")
          .like("zone_hash", `${regionPrefix}%`)
          .neq("wallet_address", walletAddress)
          .order("xp_total", { ascending: false })
          .limit(10);
      } else {
        // Fallback: show recently active breeders (those with most recent updates)
        query = supabase
          .from("profiles")
          .select("wallet_address, display_name, avatar_url, companion_tier, species_count, tank_count, xp_total, zone_hash")
          .neq("wallet_address", walletAddress)
          .order("updated_at", { ascending: false })
          .limit(10);
      }

      const { data, error } = await query;
      if (error) {
        console.warn("[Discovery] Nearby breeders query failed:", error);
        return [];
      }
      return data || [];
    },
    enabled: enabled && !!walletAddress && isSupabaseConfigured(),
    staleTime: 5 * 60 * 1000, // 5 min
  });
}

/**
 * Search for breeders who keep a specific species.
 * Queries currents and profiles that have species_tags matching the search term.
 *
 * @param {string} speciesQuery - The species common name to search for
 */
export function useBreedersForSpecies(speciesQuery, enabled = true) {
  return useQuery({
    queryKey: ["reef", "discovery", "species-breeders", speciesQuery],
    queryFn: async () => {
      if (!isSupabaseConfigured() || !speciesQuery?.trim()) return [];

      const searchTerm = speciesQuery.trim().toLowerCase();

      // Search currents that have species_tags containing the query
      const { data: currents, error: currentsError } = await supabase
        .from("currents")
        .select(`
          author_wallet,
          species_tags,
          profiles:author_wallet (
            wallet_address,
            display_name,
            avatar_url,
            companion_tier,
            species_count,
            tank_count,
            xp_total
          )
        `)
        .eq("visibility", "public")
        .cs("species_tags", [searchTerm])
        .limit(50);

      if (currentsError) {
        // Fallback: try ilike on species_tags as text
        const { data: fallbackData } = await supabase
          .from("currents")
          .select(`
            author_wallet,
            species_tags,
            profiles:author_wallet (
              wallet_address,
              display_name,
              avatar_url,
              companion_tier,
              species_count,
              tank_count,
              xp_total
            )
          `)
          .eq("visibility", "public")
          .limit(100);

        if (!fallbackData) return [];

        // Client-side filter for species match
        const matched = fallbackData.filter((c) =>
          c.species_tags?.some((tag) =>
            tag.toLowerCase().includes(searchTerm)
          )
        );

        // Deduplicate by wallet
        const seen = new Set();
        return matched
          .map((c) => c.profiles)
          .filter((p) => {
            if (!p || seen.has(p.wallet_address)) return false;
            seen.add(p.wallet_address);
            return true;
          })
          .slice(0, 15);
      }

      // Deduplicate by wallet address
      const seen = new Set();
      const unique = (currents || [])
        .map((c) => c.profiles)
        .filter((p) => {
          if (!p || seen.has(p.wallet_address)) return false;
          seen.add(p.wallet_address);
          return true;
        });

      return unique.slice(0, 15);
    },
    enabled: enabled && !!speciesQuery?.trim() && isSupabaseConfigured(),
    staleTime: 2 * 60 * 1000, // 2 min
  });
}

/**
 * Fetch top contributors for the current week.
 * Ranked by: Insights posted + Audits given (combined activity score).
 *
 * Returns profiles with their weekly contribution counts.
 */
export function useTopContributors(enabled = true) {
  return useQuery({
    queryKey: ["reef", "discovery", "top-contributors"],
    queryFn: async () => {
      if (!isSupabaseConfigured()) return [];

      // Get start of current week (Monday 00:00 UTC)
      const now = new Date();
      const dayOfWeek = now.getUTCDay();
      const mondayOffset = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
      const weekStart = new Date(now);
      weekStart.setUTCDate(now.getUTCDate() - mondayOffset);
      weekStart.setUTCHours(0, 0, 0, 0);
      const weekStartISO = weekStart.toISOString();

      // Fetch insights posted this week
      const { data: weeklyInsights } = await supabase
        .from("species_insights")
        .select("author_wallet")
        .gte("created_at", weekStartISO);

      // Fetch audits given this week
      const { data: weeklyAudits } = await supabase
        .from("expert_audits")
        .select("auditor_wallet")
        .gte("created_at", weekStartISO);

      // Tally contributions per wallet
      const scoreboard = {};

      for (const insight of weeklyInsights || []) {
        const w = insight.author_wallet;
        if (!scoreboard[w]) scoreboard[w] = { wallet: w, insights: 0, audits: 0 };
        scoreboard[w].insights++;
      }

      for (const audit of weeklyAudits || []) {
        const w = audit.auditor_wallet;
        if (!scoreboard[w]) scoreboard[w] = { wallet: w, insights: 0, audits: 0 };
        scoreboard[w].audits++;
      }

      // Sort by total contributions (insights + audits), descending
      const ranked = Object.values(scoreboard)
        .map((entry) => ({ ...entry, total: entry.insights + entry.audits }))
        .sort((a, b) => b.total - a.total)
        .slice(0, 10);

      if (ranked.length === 0) return [];

      // Fetch profiles for ranked wallets
      const wallets = ranked.map((r) => r.wallet);
      const { data: profiles } = await supabase
        .from("profiles")
        .select("wallet_address, display_name, avatar_url, companion_tier, xp_total")
        .in("wallet_address", wallets);

      // Merge profile data into ranked entries
      const profileMap = {};
      for (const p of profiles || []) {
        profileMap[p.wallet_address] = p;
      }

      return ranked.map((entry) => ({
        ...entry,
        profile: profileMap[entry.wallet] || {
          wallet_address: entry.wallet,
          display_name: null,
          avatar_url: null,
          companion_tier: "Bronze",
        },
      }));
    },
    enabled: enabled && isSupabaseConfigured(),
    staleTime: 5 * 60 * 1000, // 5 min
    refetchInterval: 10 * 60 * 1000, // Refresh every 10 min
  });
}
