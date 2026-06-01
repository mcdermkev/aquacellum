import { useState, useEffect, useMemo } from "react";
import Fuse from "fuse.js";
import { useSpeciesData } from "./useSpeciesData";

// --- DATA NORMALIZATION HELPERS ---

export const getDifficultyNormalized = (item) => {
  if (typeof item.careLevel === "number") {
    if (item.careLevel === 0) return "Easy";
    if (item.careLevel === 1) return "Medium";
    if (item.careLevel === 2) return "Difficult";
    if (item.careLevel === 3) return "Expert";
  }

  const diffVal = item.tankMetrics?.difficulty;
  if (diffVal === undefined || diffVal === null) return null;

  if (typeof diffVal === "number") {
    if (diffVal === 0) return "Easy";
    if (diffVal === 1) return "Medium";
    if (diffVal === 2) return "Difficult";
    if (diffVal === 3) return "Expert";
    return "Easy";
  }

  const lower = String(diffVal).toLowerCase();
  if (lower === "easy" || lower === "beginner") return "Easy";
  if (lower === "medium" || lower === "intermediate") return "Medium";
  if (lower === "difficult" || lower === "advanced") return "Difficult";
  if (lower === "expert") return "Expert";

  return null;
};

export const getTempRangeNormalized = (item) => {
  let min = item.minTemp;
  let max = item.maxTemp;
  if (min === undefined || max === undefined) {
    min = item.tankMetrics?.tempRangeCelsius?.[0];
    max = item.tankMetrics?.tempRangeCelsius?.[1];
  }
  if (min === undefined && item.ecology?.tempCeiling !== undefined) {
    max = item.ecology.tempCeiling;
    min = max - 6; // default fallback range
  }
  if (min === undefined) return null;
  return { min: Number(min), max: Number(max) };
};

export const getPhRangeNormalized = (item) => {
  let min = item.minPh;
  let max = item.maxPh;
  if (min === undefined || max === undefined) {
    min = item.tankMetrics?.phRange?.[0];
    max = item.tankMetrics?.phRange?.[1];
  }
  if (min === undefined) return null;
  return { min: Number(min), max: Number(max) };
};

export const getTypeNormalized = (item) => {
  const isPlant =
    item.type === "plant" ||
    Number(item.speciesId) >= 9000 ||
    Number(item.specCode) >= 9000;
  return isPlant ? "Plant" : "Fish";
};

export const getOriginFromBiotope = (item) => {
  const biotope = item.ecology?.biotope || item.biotope || "";
  const comments = item.ecology?.comments || item.comments || "";
  const text = (biotope + " " + comments).toLowerCase();

  if (
    text.includes("amazon") ||
    text.includes("south america") ||
    text.includes("paraguay") ||
    text.includes("orinoco") ||
    text.includes("brazil")
  ) {
    return "South American";
  }
  if (
    text.includes("central america") ||
    text.includes("mexico") ||
    text.includes("honduras") ||
    text.includes("costa rica")
  ) {
    return "Central American";
  }
  if (
    text.includes("africa") ||
    text.includes("malawi") ||
    text.includes("tanganyika") ||
    text.includes("congo")
  ) {
    return "African";
  }
  if (
    text.includes("asia") ||
    text.includes("india") ||
    text.includes("sri lanka") ||
    text.includes("vietnam") ||
    text.includes("thailand") ||
    text.includes("southeast asian") ||
    text.includes("bangladesh")
  ) {
    return "Asian";
  }
  if (
    text.includes("north america") ||
    text.includes("united states") ||
    text.includes("mississippi")
  ) {
    return "North American";
  }
  return null; // Dynamically empty if no biotope keyword is present
};

// --- FACET FILTER MATCHERS ---

const matchesDifficulty = (item, difficulty) => {
  if (difficulty === "All") return true;
  return getDifficultyNormalized(item) === difficulty;
};

const matchesTempBucket = (item, bucket) => {
  if (bucket === "All") return true;
  const range = getTempRangeNormalized(item);
  if (!range) return false;

  if (bucket === "Cold") return range.min < 22;
  if (bucket === "Tropical") return range.min <= 28 && range.max >= 22;
  if (bucket === "Warm") return range.max > 28;
  return true;
};

const matchesPhBucket = (item, bucket) => {
  if (bucket === "All") return true;
  const range = getPhRangeNormalized(item);
  if (!range) return false;

  if (bucket === "Acidic") return range.min < 6.8;
  if (bucket === "Neutral") return range.min <= 7.8 && range.max >= 6.8;
  if (bucket === "Alkaline") return range.max > 7.8;
  return true;
};

const matchesType = (item, type) => {
  if (type === "All") return true;
  return getTypeNormalized(item) === type;
};

const matchesOrigin = (item, origin) => {
  if (origin === "All") return true;
  return getOriginFromBiotope(item) === origin;
};

// --- MAIN HOOK IMPLEMENTATION ---

const DEFAULT_FILTERS = {
  type: "All",
  difficulty: "All",
  tempBucket: "All",
  phBucket: "All",
  origin: "All",
};

export function useSpeciesSearch(customList = null, options = {}) {
  const { data: globalData, isLoading: globalLoading, error: globalError } = useSpeciesData();

  const [searchTerm, setSearchTerm] = useState("");
  const [filters, setFilters] = useState(DEFAULT_FILTERS);

  const loading = customList ? false : globalLoading;
  const error = customList ? null : (globalError?.message || null);

  // Determine active search target dataset
  const itemsToSearch = useMemo(() => {
    return customList || globalData || [];
  }, [customList, globalData]);

  // Determine available facets dynamically in the source data (Defensive approach)
  const availableFacets = useMemo(() => {
    let hasDifficulty = false;
    let hasTemp = false;
    let hasPh = false;
    let hasOrigin = false;
    let hasType = false;

    for (const item of itemsToSearch) {
      if (getDifficultyNormalized(item) !== null) hasDifficulty = true;
      if (getTempRangeNormalized(item) !== null) hasTemp = true;
      if (getPhRangeNormalized(item) !== null) hasPh = true;
      if (getOriginFromBiotope(item) !== null) hasOrigin = true;
      if (getTypeNormalized(item) !== null) hasType = true;
    }

    return {
      difficulty: hasDifficulty,
      temp: hasTemp,
      ph: hasPh,
      origin: hasOrigin,
      type: hasType,
    };
  }, [itemsToSearch]);

  // Create Fuse.js instance when searchable list or options change
  const fuse = useMemo(() => {
    if (!itemsToSearch || itemsToSearch.length === 0) return null;
    return new Fuse(itemsToSearch, {
      keys: options.keys || [
        { name: "commonName", weight: 0.8 },
        { name: "scientificName", weight: 0.7 },
        { name: "genus", weight: 0.4 },
        { name: "species", weight: 0.3 },
        { name: "family", weight: 0.4 },
        { name: "ecology.biotope", weight: 0.2 },
      ],
      threshold: options.threshold ?? 0.45,
      distance: options.distance ?? 100,
      ignoreLocation: true,
    });
  }, [itemsToSearch, options.keys, options.threshold, options.distance]);

  // 1. First pass: Apply search term (fuzzy search)
  const searchedItems = useMemo(() => {
    if (!searchTerm.trim()) {
      return itemsToSearch;
    }
    if (!fuse) return [];
    return fuse.search(searchTerm).map((res) => res.item);
  }, [itemsToSearch, searchTerm, fuse]);

  // 2. Second pass: Apply all active filters to get the final results
  const results = useMemo(() => {
    return searchedItems.filter((item) => {
      return (
        matchesType(item, filters.type) &&
        matchesDifficulty(item, filters.difficulty) &&
        matchesTempBucket(item, filters.tempBucket) &&
        matchesPhBucket(item, filters.phBucket) &&
        matchesOrigin(item, filters.origin)
      );
    });
  }, [searchedItems, filters]);

  // Helper to compute facet counts dynamically and interactively
  const facets = useMemo(() => {
    // For a premium UX, the count for a facet option should reflect the number of matching items
    // if all *other* filters are applied, so the user knows what results would look like.
    
    const getTypeCount = (type) =>
      searchedItems.filter(
        (item) =>
          matchesDifficulty(item, filters.difficulty) &&
          matchesTempBucket(item, filters.tempBucket) &&
          matchesPhBucket(item, filters.phBucket) &&
          matchesOrigin(item, filters.origin) &&
          matchesType(item, type)
      ).length;

    const getDifficultyCount = (diff) =>
      searchedItems.filter(
        (item) =>
          matchesType(item, filters.type) &&
          matchesTempBucket(item, filters.tempBucket) &&
          matchesPhBucket(item, filters.phBucket) &&
          matchesOrigin(item, filters.origin) &&
          matchesDifficulty(item, diff)
      ).length;

    const getTempCount = (temp) =>
      searchedItems.filter(
        (item) =>
          matchesType(item, filters.type) &&
          matchesDifficulty(item, filters.difficulty) &&
          matchesPhBucket(item, filters.phBucket) &&
          matchesOrigin(item, filters.origin) &&
          matchesTempBucket(item, temp)
      ).length;

    const getPhCount = (ph) =>
      searchedItems.filter(
        (item) =>
          matchesType(item, filters.type) &&
          matchesDifficulty(item, filters.difficulty) &&
          matchesTempBucket(item, filters.tempBucket) &&
          matchesOrigin(item, filters.origin) &&
          matchesPhBucket(item, ph)
      ).length;

    const getOriginCount = (origin) =>
      searchedItems.filter(
        (item) =>
          matchesType(item, filters.type) &&
          matchesDifficulty(item, filters.difficulty) &&
          matchesTempBucket(item, filters.tempBucket) &&
          matchesPhBucket(item, filters.phBucket) &&
          matchesOrigin(item, origin)
      ).length;

    return {
      type: {
        All: searchedItems.filter(
          (item) =>
            matchesDifficulty(item, filters.difficulty) &&
            matchesTempBucket(item, filters.tempBucket) &&
            matchesPhBucket(item, filters.phBucket) &&
            matchesOrigin(item, filters.origin)
        ).length,
        Fish: getTypeCount("Fish"),
        Plant: getTypeCount("Plant"),
      },
      difficulty: {
        All: searchedItems.filter(
          (item) =>
            matchesType(item, filters.type) &&
            matchesTempBucket(item, filters.tempBucket) &&
            matchesPhBucket(item, filters.phBucket) &&
            matchesOrigin(item, filters.origin)
        ).length,
        Easy: getDifficultyCount("Easy"),
        Medium: getDifficultyCount("Medium"),
        Difficult: getDifficultyCount("Difficult"),
        Expert: getDifficultyCount("Expert"),
      },
      temp: {
        All: searchedItems.filter(
          (item) =>
            matchesType(item, filters.type) &&
            matchesDifficulty(item, filters.difficulty) &&
            matchesPhBucket(item, filters.phBucket) &&
            matchesOrigin(item, filters.origin)
        ).length,
        Cold: getTempCount("Cold"),
        Tropical: getTempCount("Tropical"),
        Warm: getTempCount("Warm"),
      },
      ph: {
        All: searchedItems.filter(
          (item) =>
            matchesType(item, filters.type) &&
            matchesDifficulty(item, filters.difficulty) &&
            matchesTempBucket(item, filters.tempBucket) &&
            matchesOrigin(item, filters.origin)
        ).length,
        Acidic: getPhCount("Acidic"),
        Neutral: getPhCount("Neutral"),
        Alkaline: getPhCount("Alkaline"),
      },
      origin: {
        All: searchedItems.filter(
          (item) =>
            matchesType(item, filters.type) &&
            matchesDifficulty(item, filters.difficulty) &&
            matchesTempBucket(item, filters.tempBucket) &&
            matchesPhBucket(item, filters.phBucket)
        ).length,
        "South American": getOriginCount("South American"),
        "Central American": getOriginCount("Central American"),
        African: getOriginCount("African"),
        Asian: getOriginCount("Asian"),
        "North American": getOriginCount("North American"),
      },
    };
  }, [searchedItems, filters]);

  const resetFilters = () => setFilters(DEFAULT_FILTERS);

  return {
    results,
    loading,
    error,
    searchTerm,
    setSearchTerm,
    filters,
    setFilters,
    facets,
    availableFacets,
    globalData,
    resetFilters,
  };
}
