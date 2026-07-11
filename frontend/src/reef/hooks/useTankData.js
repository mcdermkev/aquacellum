/**
 * useTankData — Fetches tank data for personal or shared tank immersion.
 *
 * Modes:
 * - No tankId → "master" mode (full species catalog)
 * - tankId present → fetch that tank's specimens from Supabase
 *
 * Returns the species data in the same shape as fishbase_master.json entries,
 * so the rest of the reef renderer works unchanged.
 */
import { useState, useEffect } from "react";
import { supabase, isSupabaseConfigured } from "../../services/supabaseClient";

/**
 * @param {string|null} tankId - UUID of the tank to load, or null for master reef
 * @returns {{ speciesData, tankMeta, loading, error, mode }}
 */
export function useTankData(tankId) {
  const [speciesData, setSpeciesData] = useState([]);
  const [tankMeta, setTankMeta] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Determine mode from tankId
  const mode = tankId ? "tank" : "master";

  useEffect(() => {
    if (!tankId) {
      // Master mode: load full catalog
      loadMasterCatalog();
    } else {
      // Tank mode: load from Supabase
      loadTankData(tankId);
    }
  }, [tankId]);

  async function loadMasterCatalog() {
    try {
      const res = await fetch("/fishbase_master.json?v=2");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setSpeciesData(data);
      setTankMeta(null);
      setLoading(false);
    } catch (err) {
      console.error("[useTankData] Failed to load master catalog:", err);
      setError(err.message);
      setLoading(false);
    }
  }

  async function loadTankData(id) {
    if (!isSupabaseConfigured()) {
      // Fallback: try to load from localStorage demo data
      const demoTank = loadDemoTank(id);
      if (demoTank) {
        setSpeciesData(demoTank.species);
        setTankMeta(demoTank.meta);
        setLoading(false);
        return;
      }
      setError("Supabase not configured. Connect to load tank data.");
      setLoading(false);
      return;
    }

    try {
      // Fetch tank metadata. Cloud tables store the full Dexie object in a
      // JSONB `data` column; only id/owner_address/name/active are relational.
      const { data: tankRow, error: tankError } = await supabase
        .from("aquadex_tanks")
        .select("*")
        .eq("id", id)
        .single();

      if (tankError) throw new Error(tankError.message);
      if (!tankRow) throw new Error("Tank not found");

      const tank = tankRow.data || {};

      // Fetch specimens in this tank (relational: current_tank_id / species_id;
      // full specimen object lives in `data`).
      const { data: specimens, error: specError } = await supabase
        .from("aquadex_specimens")
        .select("*")
        .eq("current_tank_id", id);

      if (specError) throw new Error(specError.message);

      // Map specimens to species data format compatible with the reef renderer
      const masterCatalog = await fetch("/fishbase_master.json?v=2").then(r => r.json());
      const speciesInTank = mapSpecimensToSpecies(specimens || [], masterCatalog);

      setTankMeta({
        id: tankRow.id,
        name: tankRow.name || tank.name || "My Tank",
        ownerWallet: tankRow.owner_address || tank.ownerAddress || tank.wallet_address,
        volumeLiters: tank.volumeLiters || tank.volume_liters || 100,
        tankType: tank.tankType || tank.tank_type || "freshwater",
        tempCelsius: tank.tempCelsius ?? tank.temp_celsius ?? null,
        ph: tank.ph ?? null,
        specimenCount: specimens?.length || 0,
        isPublic: (tank.isPublic ?? tank.is_public) !== false,
        description: tank.description || null
      });

      setSpeciesData(speciesInTank);
      setLoading(false);
    } catch (err) {
      console.error("[useTankData] Failed to load tank:", err);
      setError(err.message);
      setLoading(false);
    }
  }

  return { speciesData, tankMeta, loading, error, mode };
}

/**
 * Map Supabase specimen rows to fishbase_master-style species objects.
 * Each specimen gets matched to its full species record from the catalog.
 */
function mapSpecimensToSpecies(specimens, masterCatalog) {
  const catalogMap = new Map();
  for (const sp of masterCatalog) {
    catalogMap.set(sp.specCode, sp);
  }

  const speciesMap = new Map();

  for (const row of specimens) {
    // Cloud rows carry the full Dexie specimen object in `data`; species_id is
    // also promoted to a relational column. Fall back across both shapes.
    const d = row.data || row;
    const specCode = row.species_id ?? d.speciesId ?? d.specCode ?? d.spec_code;
    if (specCode === undefined || specCode === null) continue;

    const catalogEntry = catalogMap.get(specCode) || catalogMap.get(Number(specCode));
    if (!catalogEntry) continue;

    const key = catalogEntry.specCode;
    const quantity = d.quantity || 1;

    // Track count per species
    if (speciesMap.has(key)) {
      speciesMap.get(key)._tankCount += quantity;
    } else {
      speciesMap.set(key, {
        ...catalogEntry,
        _tankCount: quantity,
        _specimenId: row.id,
        _nickname: d.nickname || null
      });
    }
  }

  return Array.from(speciesMap.values());
}

/**
 * Load demo tank from localStorage (for development/testing without Supabase)
 */
function loadDemoTank(id) {
  try {
    const stored = localStorage.getItem(`aquadex_tank_${id}`);
    if (stored) return JSON.parse(stored);

    // Check if any tank stored as "demo"
    const demo = localStorage.getItem("aquadex_demo_tank");
    if (demo) return JSON.parse(demo);
  } catch (e) {
    return null;
  }
  return null;
}

/**
 * Parse reef URL params to determine mode.
 * - /reef-xr.html → master mode
 * - /reef-xr.html?tank=uuid → personal/shared tank mode
 * - /reef-xr.html?tank=uuid&visit=true → visiting someone else's tank
 */
export function parseReefParams() {
  const params = new URLSearchParams(window.location.search);
  const tankId = params.get("tank") || null;
  const isVisit = params.get("visit") === "true";
  const ownerName = params.get("owner") || null;

  return { tankId, isVisit, ownerName };
}
