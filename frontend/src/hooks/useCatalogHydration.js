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
import { normalizeSpeciesRecord } from "../services/normalizeSpeciesRecord";

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

      const res = await fetch("/fishbase_master.json?v=2");
      if (!res.ok) throw new Error(`Catalog fetch failed: ${res.status}`);

      setProgress(40); // Download complete

      const rawData = await res.json();
      setProgress(60); // JSON parsed

      // Same enrichment as useSpeciesData (services/normalizeSpeciesRecord.js).
      // A missing diet stays null; it is never backfilled.
      const data = rawData.map(normalizeSpeciesRecord);

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
