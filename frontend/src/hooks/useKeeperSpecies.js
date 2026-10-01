import { useEffect, useState } from "react";
import { db } from "../db";
import { useSpeciesData } from "./useSpeciesData";
import { livingInhabitants, speciesRecordFor } from "../components/logbook/inhabitants";

/**
 * What this keeper keeps, as catalog species: `[{ specCode, name }]`, once
 * each, from the living inhabitants of their tanks on this device.
 *
 * Resolved through the catalog (speciesRecordFor), never from a specimen's raw
 * speciesId: on-chain ids are small integers that can collide with an
 * unrelated specCode.
 *
 * @param {boolean} active read only when needed
 * @param {number} [max]
 */
export function keeperSpeciesFrom(tanks, catalog, max = 20) {
  const out = [];
  const seen = new Set();
  for (const tank of Array.isArray(tanks) ? tanks : []) {
    if (!tank || tank.active === false) continue;
    for (const spec of livingInhabitants(tank)) {
      const rec = speciesRecordFor(spec, catalog);
      const code = Number(rec?.specCode);
      if (!rec || !Number.isInteger(code) || code <= 0 || seen.has(code)) continue;
      if (String(rec.type || "").toLowerCase() === "plant") continue;
      seen.add(code);
      out.push({ specCode: code, name: String(rec.commonName || rec.scientificName || "").split("/")[0].trim() });
      if (out.length >= max) return out;
    }
  }
  return out;
}

/**
 * @returns {{ species: Array<{specCode: number, name: string}>, ready: boolean }}
 *   `ready` turns true once the answer is known (possibly empty). Callers that
 *   fetch with it should wait for `ready`: fetching once without and again with
 *   the species would mean two signed requests, so two wallet prompts.
 */
export function useKeeperSpecies(active = true, max = 20) {
  const { data: catalog = [], isError, isFetched } = useSpeciesData();
  const [state, setState] = useState({ species: [], ready: false });

  useEffect(() => {
    if (!active) return undefined;
    // No catalog (it failed to load): the answer is "nothing known".
    if (catalog.length === 0) {
      if (isError || isFetched) setState({ species: [], ready: true });
      return undefined;
    }
    let cancelled = false;
    db.tanks.toArray()
      .then((tanks) => { if (!cancelled) setState({ species: keeperSpeciesFrom(tanks, catalog, max), ready: true }); })
      .catch(() => { if (!cancelled) setState({ species: [], ready: true }); });
    return () => { cancelled = true; };
  }, [active, catalog, isError, isFetched, max]);

  return state;
}

export default useKeeperSpecies;
