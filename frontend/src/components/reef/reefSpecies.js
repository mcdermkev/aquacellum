/**
 * Species lookups for The Reef: club tracked species and post tags link to the
 * public species pages (/species/<slug>) and show the species photo.
 *
 * Reads the public /species-index.json at runtime (fields: n = name,
 * s = scientific name, u = slug, p = photo path). Nothing here edits species
 * data; a name that isn't in the index just renders as plain text.
 */

import { useQuery } from "@tanstack/react-query";

function norm(value) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
}

/** Build name and scientific-name maps from the index rows. */
export function buildSpeciesLookup(rows) {
  const byScientific = new Map();
  const byName = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row?.u) continue;
    const entry = { slug: row.u, name: row.n || row.s || "", scientificName: row.s || "", photo: row.p || null };
    if (row.s && !byScientific.has(norm(row.s))) byScientific.set(norm(row.s), entry);
    if (row.n && !byName.has(norm(row.n))) byName.set(norm(row.n), entry);
  }
  return { byScientific, byName };
}

/**
 * Find a species by scientific name first (exact and unambiguous), then by the
 * common name as written. Returns null when neither matches.
 */
export function findSpecies(lookup, { scientificName, commonName } = {}) {
  if (!lookup) return null;
  return (
    (scientificName && lookup.byScientific.get(norm(scientificName))) ||
    (commonName && lookup.byName.get(norm(commonName))) ||
    (commonName && lookup.byScientific.get(norm(commonName))) ||
    null
  );
}

/** Normalise a club's tracked_species entry (objects or legacy strings). */
export function trackedSpeciesLabel(entry) {
  if (!entry) return { commonName: "", scientificName: "" };
  if (typeof entry === "string") return { commonName: entry, scientificName: "" };
  return {
    commonName: entry.commonName || entry.common_name || entry.name || "",
    scientificName: entry.scientificName || entry.scientific_name || "",
  };
}

export function speciesHref(slug) {
  return `/species/${encodeURIComponent(slug)}`;
}

async function fetchSpeciesIndex() {
  const res = await fetch("/species-index.json");
  if (!res.ok) throw new Error(`species index ${res.status}`);
  return buildSpeciesLookup(await res.json());
}

/** The lookup, loaded once per session. `data` is null until it arrives. */
export function useSpeciesLookup() {
  const { data } = useQuery({
    queryKey: ["species-index-lookup"],
    queryFn: fetchSpeciesIndex,
    staleTime: Infinity,
    gcTime: Infinity,
    retry: 1,
  });
  return data || null;
}
