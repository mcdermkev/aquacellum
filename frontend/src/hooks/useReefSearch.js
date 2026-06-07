/**
 * useReefSearch.js
 * 
 * Supabase full-text search across social content:
 * - Profiles (display_name, bio)
 * - Currents (title, body, species_tags)
 * - Schools (name, description)
 * - Tides (title, description)
 * - Species Insights (body)
 * 
 * Uses Postgres ilike/textSearch for MVP, with debouncing.
 * Integrates with existing useNaturalSearch for species queries.
 */

import { useState, useCallback, useRef, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase, isSupabaseConfigured } from "../services/supabaseClient";

const DEBOUNCE_MS = 300;
const MIN_QUERY_LENGTH = 2;

/**
 * Search profiles by display_name or bio.
 */
async function searchProfiles(query, limit = 5) {
  const { data, error } = await supabase
    .from("profiles")
    .select("wallet_address, display_name, avatar_url, bio, companion_tier, depth_tier")
    .or(`display_name.ilike.%${query}%,bio.ilike.%${query}%`)
    .limit(limit);

  if (error) return [];
  return data;
}

/**
 * Search currents (posts) by title or body.
 */
async function searchCurrents(query, limit = 5) {
  const { data, error } = await supabase
    .from("currents")
    .select(`
      id, title, body, media_urls, species_tags, created_at, visibility,
      author:author_wallet (wallet_address, display_name, avatar_url, companion_tier)
    `)
    .eq("visibility", "public")
    .or(`title.ilike.%${query}%,body.ilike.%${query}%`)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) return [];
  return data;
}

/**
 * Search schools by name or description.
 */
async function searchSchools(query, limit = 5) {
  const { data, error } = await supabase
    .from("schools")
    .select("id, name, slug, school_type, description, banner_url, member_count")
    .or(`name.ilike.%${query}%,description.ilike.%${query}%`)
    .limit(limit);

  if (error) return [];
  return data;
}

/**
 * Search tides (events) by title or description.
 */
async function searchTides(query, limit = 5) {
  const { data, error } = await supabase
    .from("tides")
    .select(`
      id, title, description, tide_type, status, start_time, end_time,
      host_profile:host_wallet (wallet_address, display_name, avatar_url)
    `)
    .or(`title.ilike.%${query}%,description.ilike.%${query}%`)
    .order("start_time", { ascending: false })
    .limit(limit);

  if (error) return [];
  return data;
}

/**
 * Search species insights by body text.
 */
async function searchInsights(query, limit = 5) {
  const { data, error } = await supabase
    .from("species_insights")
    .select(`
      id, body, category, species_name, net_votes, created_at,
      author:author_wallet (wallet_address, display_name, avatar_url, companion_tier)
    `)
    .ilike("body", `%${query}%`)
    .order("net_votes", { ascending: false })
    .limit(limit);

  if (error) return [];
  return data;
}

/**
 * Run a unified search across all social content types.
 */
async function searchAll(query) {
  if (!query || query.length < MIN_QUERY_LENGTH || !isSupabaseConfigured()) {
    return { profiles: [], currents: [], schools: [], tides: [], insights: [] };
  }

  const [profiles, currents, schools, tides, insights] = await Promise.all([
    searchProfiles(query),
    searchCurrents(query),
    searchSchools(query),
    searchTides(query),
    searchInsights(query),
  ]);

  return { profiles, currents, schools, tides, insights };
}

/**
 * Main reef search hook with debouncing and grouped results.
 */
export function useReefSearch() {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const debounceRef = useRef(null);

  // Debounce the query
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (!query || query.length < MIN_QUERY_LENGTH) {
      setDebouncedQuery("");
      return;
    }

    debounceRef.current = setTimeout(() => {
      setDebouncedQuery(query);
    }, DEBOUNCE_MS);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  const { data, isLoading, error } = useQuery({
    queryKey: ["reef", "search", debouncedQuery],
    queryFn: () => searchAll(debouncedQuery),
    enabled: debouncedQuery.length >= MIN_QUERY_LENGTH && isSupabaseConfigured(),
    staleTime: 30 * 1000,
    placeholderData: { profiles: [], currents: [], schools: [], tides: [], insights: [] },
  });

  const totalResults =
    (data?.profiles?.length || 0) +
    (data?.currents?.length || 0) +
    (data?.schools?.length || 0) +
    (data?.tides?.length || 0) +
    (data?.insights?.length || 0);

  const hasResults = totalResults > 0;
  const isSearching = query.length >= MIN_QUERY_LENGTH;

  const clearSearch = useCallback(() => {
    setQuery("");
    setDebouncedQuery("");
  }, []);

  return {
    query,
    setQuery,
    results: data,
    isLoading,
    error,
    totalResults,
    hasResults,
    isSearching,
    clearSearch,
  };
}
