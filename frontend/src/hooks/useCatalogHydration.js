/**
 * useCatalogHydration.js
 * 
 * Background species catalog loader — designed to run in parallel with
 * the onboarding wizard so the database hydrates while the user is engaged
 * with Poseidon's narrative. Completely decoupled from wizard UI steps.
 * 
 * Returns { catalogReady, progress, error, retry }
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { db } from "../db";

export function useCatalogHydration() {
  const [catalogReady, setCatalogReady] = useState(false);
  const [progress, setProgress] = useState(0); // 0-100
  const [error, setError] = useState(null);
  const attemptRef = useRef(0);

  const hydrate = useCallback(async () => {
    try {
      setError(null);

      // Check if catalog is already cached in Dexie
      const existingCount = await db.species.count();
      if (existingCount > 100) {
        // Already hydrated from a previous session
        setProgress(100);
        setCatalogReady(true);
        return;
      }

      setProgress(10); // Fetch started

      const res = await fetch("/fishbase_master.json");
      if (!res.ok) throw new Error(`Catalog fetch failed: ${res.status}`);

      setProgress(40); // Download complete

      const rawData = await res.json();
      setProgress(60); // JSON parsed

      // Enrich with safe fallbacks (same logic as useSpeciesData)
      const data = rawData.map(item => ({
        ...item,
        family: item.family || "Information arriving soon",
        ecology: {
          comments: item.ecology?.comments || "Information arriving soon",
          biotope: item.ecology?.biotope || "Generic Biotope Details",
          phMin: item.ecology?.phMin ?? item.tankMetrics?.phRange?.[0] ?? 6.5,
          phMax: item.ecology?.phMax ?? item.tankMetrics?.phRange?.[1] ?? 7.5,
          hardnessRange: item.ecology?.hardnessRange || "5 - 15 dGH",
          tempCeiling: item.ecology?.tempCeiling ?? item.tankMetrics?.tempRangeCelsius?.[1] ?? 28,
          socialBehavior: item.ecology?.socialBehavior || "Information arriving soon",
        },
        diet: {
          trophicLevel: item.diet?.trophicLevel || "Omnivore",
          fooditems: item.diet?.fooditems || "Information arriving soon",
          feedingPlaybook: item.diet?.feedingPlaybook || "Information arriving soon",
        },
        reproduction: {
          spawningTrait: item.reproduction?.spawningTrait || "Information arriving soon",
          layoutRequirement: item.reproduction?.layoutRequirement || "Information arriving soon",
          comments: item.reproduction?.comments || "Information arriving soon",
        }
      }));

      setProgress(80); // Enrichment complete

      // Bulk insert into Dexie
      await db.species.clear();
      await db.species.bulkAdd(data);

      setProgress(100);
      setCatalogReady(true);
    } catch (err) {
      console.warn("Catalog hydration failed:", err);
      setError(err.message);

      // Exponential backoff retry (max 3 attempts)
      attemptRef.current += 1;
      if (attemptRef.current < 3) {
        const delay = Math.pow(2, attemptRef.current) * 1000;
        setTimeout(hydrate, delay);
      }
    }
  }, []);

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  const retry = useCallback(() => {
    attemptRef.current = 0;
    hydrate();
  }, [hydrate]);

  return { catalogReady, progress, error, retry };
}
