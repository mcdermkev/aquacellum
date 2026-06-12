import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ethers, Contract, ZeroAddress } from "ethers";
import aquadexAbi from "../abi/AquadexManager.json";
import { getProvider } from "../utils/smartAccount";
import { HatcheryLogs } from "./HatcheryLogs";
import { MarketplaceBoard } from "./MarketplaceBoard";
import { useSpeciesSearch } from "../hooks/useSpeciesSearch";
import { useNaturalSearch } from "../hooks/useNaturalSearch";
import { LazyImage } from "./LazyImage";
import { useContractSpecies, useSpeciesData } from "../hooks/useSpeciesData";
import { LoadingSkeleton } from "./LoadingSkeleton";
import SuggestSpeciesModal from "./SuggestSpeciesModal";
import { useSuggestSpecies } from "../hooks/useSuggestSpecies";
import { BreedersCouncil } from "./BreedersCouncil";
import { CurationQueuePanel } from "./CurationQueuePanel";
import { db } from "../db";
import { FishSilhouetteSVG, PlantSilhouetteSVG } from "./SilhouetteSVG";
import { getPersonality } from "../utils/personality";
import { SpeciesInsights } from "./reef/SpeciesInsights";

// Config configurations for Aquadex biological easter eggs
export function getEasterEggConfig(key, evolved = false) {
  if (key === "nami_lol") {
    return {
      key: "nami_lol",
      emoji: "🌊",
      label: "🌊 Nami Approved",
      title: "Tidecaller's Blessing",
      lore: "Nami, the Tidecaller from League of Legends, secretly blesses this species. Keep your tank parameters perfect and she may grant you the perfect water flow ✨",
      buttonText: "Receive Blessing",
      keywords: ["nami", "tidecaller", "league"],
      color: "#38bdf8",
      bg: "rgba(14, 165, 233, 0.25)",
      border: "rgba(56, 189, 248, 0.6)",
      glow: "rgba(56, 189, 248, 0.4)"
    };
  }
  if (key === "magikarp_pokemon") {
    if (evolved) {
      return {
        key: "magikarp_pokemon",
        emoji: "🐲",
        label: "🐲 Gyarados Awakened!",
        title: "Gyarados Awakened!",
        lore: "Congratulations! Your Magikarp has evolved into Gyarados! The most powerful and intimidating fish in the tank. Rawr! 🐲",
        buttonText: "De-evolve",
        keywords: ["magikarp", "pokemon", "gyarados", "splash"],
        color: "#2563eb",
        bg: "rgba(37, 99, 235, 0.25)",
        border: "rgba(37, 99, 235, 0.6)",
        glow: "rgba(37, 99, 235, 0.4)"
      };
    } else {
      return {
        key: "magikarp_pokemon",
        emoji: "🐟",
        label: "🐟 Magikarp Mode",
        title: "Magikarp Mode",
        lore: "Magikarp from Pokémon. The ultimate underdog fish. Splash around long enough with perfect water parameters and you too might evolve into something legendary ✨",
        buttonText: "Evolve Magikarp",
        keywords: ["magikarp", "pokemon", "gyarados", "splash"],
        color: "#f97316",
        bg: "rgba(249, 115, 22, 0.25)",
        border: "rgba(249, 115, 22, 0.6)",
        glow: "rgba(249, 115, 22, 0.4)"
      };
    }
  }
  return null;
}

// Helper: detect if a fishbase record or specCode is a plant entry
const isPlantEntry = (specCodeOrItem) => {
  if (typeof specCodeOrItem === "object" && specCodeOrItem !== null) {
    return specCodeOrItem.type === "plant";
  }
  return false;
};

const SUPABASE_BUCKET = "https://eybxazurluxacahrqubm.supabase.co/storage/v1/object/public/species-images";

const getSupabaseImageUrl = (name) => {
  if (!name) return "";
  const formatted = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  return `${SUPABASE_BUCKET}/${formatted}.jpg`;
};

export function BreedGallery({ 
  contractAddress, 
  marketplaceAddress,
  walletAccount, 
  onViewLineage, 
  preselectedBreedId, 
  onClearPreselectedBreed,
  onSelectSpecimen,
  displayTank,
  setDisplayTank,
  onSelectCheckoutOrder,
  onCheckoutSuccessRedirect,
  casualModeActive,
  initialSelectedBreed,
  onSelectedBreedChange
}) {
  const proMode = !casualModeActive;
  const [selectedBreed, setSelectedBreed] = useState(initialSelectedBreed || null);
  const [selectedBreedSpecs, setSelectedBreedSpecs] = useState([]);
  const [residingSpecies, setResidingSpecies] = useState([]);
  const [toastMessage, setToastMessage] = useState(null);

  const showToast = (msg) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 4000);
  };

  useEffect(() => {
    if (typeof onSelectedBreedChange === "function") {
      onSelectedBreedChange(selectedBreed);
    }
  }, [selectedBreed, onSelectedBreedChange]);

  useEffect(() => {
    const getResiding = async () => {
      try {
        const userTanks = await db.tanks.toArray();
        const speciesMap = {};
        for (const t of userTanks) {
          if (t.specimens) {
            for (const spec of t.specimens) {
              if (spec.speciesId) {
                speciesMap[spec.speciesId] = spec.commonName || `Species ID ${spec.speciesId}`;
              }
            }
          }
        }
        
        // Also fetch from standalone specimens table
        const localSpecimens = await db.specimens.toArray();
        const userSpecimens = localSpecimens.filter(
          (s) => s.ownerAddress?.toLowerCase() === walletAccount?.toLowerCase() && s.status === 0
        );
        for (const spec of userSpecimens) {
          if (spec.speciesId) {
            speciesMap[spec.speciesId] = spec.commonName || `Species ID ${spec.speciesId}`;
          }
        }

        setResidingSpecies(Object.entries(speciesMap).map(([id, name]) => ({
          id: Number(id),
          name
        })));
      } catch (err) {
        console.warn("Failed to load residing species:", err);
      }
    };
    if (walletAccount) {
      getResiding();
    }
  }, [walletAccount]);

  const [viewMode, setViewMode] = useState("contract"); // "contract" | "global" — must be declared before use
  const { data: contractSpeciesList = [], isLoading: isContractSpeciesLoading, error: contractSpeciesError, refetch: refetchContractSpecies } = useContractSpecies(contractAddress);
  const { data: globalData = [] } = useSpeciesData();
  const speciesList = contractSpeciesList;
  const loading = (viewMode === "contract" && isContractSpeciesLoading);
  const [specsLoading, setSpecsLoading] = useState(false);
  const error = (viewMode === "contract" && contractSpeciesError) ? (contractSpeciesError.message || "Failed to load breed catalog") : null;
  const [showMyFishOnly, setShowMyFishOnly] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [notification, setNotification] = useState(null);

  // New States for Spawning Logs and Tank Compatibility Simulation
  const [contractInstance, setContractInstance] = useState(null);
  const [selectedSubTab, setSelectedSubTab] = useState("specimens"); // "specimens" | "hatchery"
  const [masterLookup, setMasterLookup] = useState({});
  const [fishbaseData, setFishbaseData] = useState([]);
  const [simVolume, setSimVolume] = useState(30);
  const [simPh, setSimPh] = useState(7.0);
  const [simTemp, setSimTemp] = useState(24.0);
  const [activeInfoTab, setActiveInfoTab] = useState("care");
  const [activeLoreEgg, setActiveLoreEgg] = useState(null);
  const [isSuggestModalOpen, setIsSuggestModalOpen] = useState(false);
  const [isCurator, setIsCurator] = useState(false);
  const [magikarpEvolved, setMagikarpEvolved] = useState(false);
  const [isEvolving, setIsEvolving] = useState(false);
  const [evolutionError, setEvolutionError] = useState("");
  const [starryBgActive, setStarryBgActive] = useState(false);
  const starryTimeoutRef = useRef(null);

  useEffect(() => {
    return () => {
      if (starryTimeoutRef.current) clearTimeout(starryTimeoutRef.current);
    };
  }, []);

  const { 
    suggestionsQuery, 
    suggestSpecies, 
    updateSuggestionStatus 
  } = useSuggestSpecies(walletAccount, fishbaseData);

  const CARE_LEVEL_STRINGS = ["Easy", "Medium", "Difficult", "Expert"];

  const globalRefList = useMemo(() => {
    if (!globalData || globalData.length === 0) return [];
    const seenNames = new Set();
    const seenCodes = new Set();
    const catalog = [];
    
    const DIFFICULTY_MAP = {
      "easy": 0,
      "beginner": 0,
      "intermediate": 1,
      "medium": 1,
      "difficult": 2,
      "advanced": 2,
      "expert": 3
    };
    
    for (const item of globalData) {
      const scientificNameLower = item.scientificName.toLowerCase();
      if (seenNames.has(scientificNameLower) || seenCodes.has(item.specCode)) {
        continue;
      }
      seenNames.add(scientificNameLower);
      seenCodes.add(item.specCode);
      
      const diffStr = (item.tankMetrics?.difficulty || "easy").toLowerCase();
      const careLevel = DIFFICULTY_MAP[diffStr] ?? 1;
      
      catalog.push({
        speciesId: item.specCode,
        allSpeciesIds: [item.specCode],
        scientificName: item.scientificName,
        commonName: item.commonName,
        canonicalIpfsUri: "ipfs://placeholder",
        careLevel: careLevel,
        minTemp: item.tankMetrics?.tempRangeCelsius?.[0] ?? 22.0,
        maxTemp: item.tankMetrics?.tempRangeCelsius?.[1] ?? 28.0,
        minPh: item.tankMetrics?.phRange?.[0] ?? 6.5,
        maxPh: item.tankMetrics?.phRange?.[1] ?? 7.5,
        specimenCount: 0,
        isGlobal: true,
      });
    }
    return catalog;
  }, [globalData]);

  const searchList = useMemo(() => {
    if (viewMode === "global") {
      return globalRefList;
    }
    if (casualModeActive && viewMode === "contract") {
      const residingIds = new Set(residingSpecies.map((s) => Number(s.id)));
      return speciesList.filter((s) => residingIds.has(Number(s.speciesId)));
    }
    return speciesList;
  }, [viewMode, speciesList, globalRefList, residingSpecies, casualModeActive]);

  // useSpeciesSearch MUST be called before any useEffect/code that references searchTerm or globalData
  const {
    results: filteredSpecies,
    searchTerm,
    setSearchTerm,
    filters,
    setFilters,
    facets,
    availableFacets,
    resetFilters
  } = useSpeciesSearch(searchList);

  // Natural language search — parses queries like "beginner fish for warm water"
  const { isParsing, explanation: nlExplanation, parseQuery: nlParseQuery, clearParsed } = useNaturalSearch({
    onFiltersReady: (parsed) => {
      // Apply the AI-parsed search term
      if (parsed.searchTerm && parsed.searchTerm !== searchTerm) {
        setSearchTerm(parsed.searchTerm);
      }
      // Apply parsed filters
      if (parsed.filters) {
        const newFilters = { ...filters };
        if (parsed.filters.difficulty) newFilters.difficulty = parsed.filters.difficulty;
        if (parsed.filters.tempMin) newFilters.tempMin = parsed.filters.tempMin;
        if (parsed.filters.tempMax) newFilters.tempMax = parsed.filters.tempMax;
        if (parsed.filters.phMin) newFilters.phMin = parsed.filters.phMin;
        if (parsed.filters.phMax) newFilters.phMax = parsed.filters.phMax;
        if (parsed.filters.maxSize) newFilters.maxSize = parsed.filters.maxSize;
        setFilters(newFilters);
      }
    },
    tankContext: displayTank ? { volume: displayTank.volume, temp: displayTank.temp, ph: displayTank.ph } : null,
  });

  useEffect(() => {
    if (!searchTerm) return;
    const normalized = searchTerm.toLowerCase().trim();
    if (normalized === "vacuum" || normalized === "algae") {
      window.dispatchEvent(new CustomEvent('poseidon:echo-reaction', {
        detail: { mood: "fry_clumsy", glowActive: true, glowColor: "#10b981", swimSpeedMultiplier: 0.5, durationMs: 5000 }
      }));
    } else if (normalized === "galaxy" || normalized === "stars" || normalized === "celestial") {
      if (simTemp >= 22.0 && simTemp <= 24.0) {
        setStarryBgActive(true);
        if (starryTimeoutRef.current) clearTimeout(starryTimeoutRef.current);
        starryTimeoutRef.current = setTimeout(() => {
          setStarryBgActive(false);
        }, 6000);

        window.dispatchEvent(new CustomEvent('poseidon:echo-reaction', {
          detail: { mood: "calm", glowActive: true, glowColor: "#38bdf8", swimSpeedMultiplier: 1.2, durationMs: 6000 }
        }));
      }
    } else if (normalized === "minecraft" || normalized === "cute") {
      window.dispatchEvent(new CustomEvent('poseidon:echo-reaction', {
        detail: { mood: "happy", glowActive: true, glowColor: "#ff85a2", swimSpeedMultiplier: 1.5, durationMs: 5000 }
      }));
    }
  }, [searchTerm, simTemp]);



  const [visibleCount, setVisibleCount] = useState(24);
  const [containerWidth, setContainerWidth] = useState(1200);

  // ResizeObserver via callback ref for robust DOM tracking
  const parentRef = useRef(null);
  const resizeObserverRef = useRef(null);

  const parentRefCallback = useCallback((node) => {
    if (resizeObserverRef.current) {
      resizeObserverRef.current.disconnect();
      resizeObserverRef.current = null;
    }
    parentRef.current = node;
    if (node) {
      const resizeObserver = new ResizeObserver((entries) => {
        for (let entry of entries) {
          setContainerWidth(entry.contentRect.width || 1200);
        }
      });
      resizeObserver.observe(node);
      resizeObserverRef.current = resizeObserver;
    }
  }, []);



  const chunkArray = useCallback((arr, size) => {
    const chunks = [];
    for (let i = 0; i < arr.length; i += size) {
      chunks.push(arr.slice(i, i + size));
    }
    return chunks;
  }, []);

  const columnsCount = useMemo(() => {
    // Minimum card width of 280px + 24px gap = 304px. Handle edge case of very narrow screens.
    return Math.max(1, Math.floor((containerWidth + 24) / 304));
  }, [containerWidth]);

  const pagedSpecies = useMemo(() => {
    return filteredSpecies.slice(0, visibleCount);
  }, [filteredSpecies, visibleCount]);

  const rowItems = useMemo(() => {
    return chunkArray(pagedSpecies, columnsCount);
  }, [pagedSpecies, columnsCount, chunkArray]);

  const rowVirtualizer = useVirtualizer({
    count: rowItems.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => columnsCount === 1 ? 520 : 420,
    overscan: 3,
  });

  const virtualItems = rowVirtualizer.getVirtualItems();

  // Infinite Scroll Trigger with a safety margin (5 rows from the end)
  useEffect(() => {
    if (virtualItems.length > 0) {
      const lastItem = virtualItems[virtualItems.length - 1];
      if (lastItem.index >= rowItems.length - 5 && visibleCount < filteredSpecies.length) {
        setVisibleCount((prev) => Math.min(filteredSpecies.length, prev + 24));
      }
    }
  }, [virtualItems, rowItems.length, visibleCount, filteredSpecies.length]);

  // Reset pagination and scroll back to top when query or filters change
  useEffect(() => {
    setVisibleCount(24);
    try {
      rowVirtualizer.scrollToOffset(0);
    } catch (e) {}
  }, [searchTerm, filters, viewMode, rowVirtualizer]);


  // Set up master lookup and fishbase reference from the cached global data
  useEffect(() => {
    if (globalData) {
      const lookup = {};
      globalData.forEach((item) => {
        lookup[item.scientificName.toLowerCase()] = item.tankMetrics;
      });
      setMasterLookup(lookup);
      setFishbaseData(globalData);
    }
  }, [globalData]);

  // Initialize and persist stable contract instance for subcomponents
  useEffect(() => {
    if (contractAddress) {
      try {
        const provider = getProvider();
        const contract = new Contract(contractAddress, aquadexAbi, provider);
        setContractInstance(contract);
      } catch (err) {
        console.error("Failed to initialize contract in BreedGallery:", err);
      }
    }
  }, [contractAddress]);

  // Query curator role from contract
  useEffect(() => {
    const checkCuratorRole = async () => {
      if (contractInstance && walletAccount) {
        try {
          const curatorAddress = await contractInstance.curator();
          setIsCurator(curatorAddress.toLowerCase() === walletAccount.toLowerCase());
        } catch (e) {
          console.warn("Failed to check curator role:", e);
          setIsCurator(false);
        }
      } else {
        setIsCurator(false);
      }
    };
    checkCuratorRole();
  }, [contractInstance, walletAccount]);

  // Dynamically initialize simulator values to the species ideal midpoint when selected
  useEffect(() => {
    if (selectedBreed) {
      const nameKey = selectedBreed.scientificName.toLowerCase();
      const metrics = masterLookup[nameKey];
      const minVol = metrics?.minVolumeGallons ?? 30;
      setSimVolume(minVol);

      const midPh = (selectedBreed.minPh + selectedBreed.maxPh) / 2;
      setSimPh(Number(midPh.toFixed(1)));

      const midTemp = (selectedBreed.minTemp + selectedBreed.maxTemp) / 2;
      setSimTemp(Number(midTemp.toFixed(1)));
      
      // Default sub-tab back to specimens
      setSelectedSubTab("specimens");
      setActiveInfoTab("care");
    }
  }, [selectedBreed, masterLookup]);


  // species list fetch is now handled by React Query useContractSpecies hook.

  // fetchGlobalSpecies is now completely handled reactively by useSpeciesSearch and memoization.

  const loadBreedSpecimens = async (breed) => {
    if (!contractAddress || !breed) return;
    try {
      setSpecsLoading(true);
      
      const provider = getProvider();
      const contract = new Contract(contractAddress, aquadexAbi, provider);

      const targetIds = breed.allSpeciesIds || [breed.speciesId];
      let allTokenIds = [];
      for (const spId of targetIds) {
        const tokenIds = await contract.getSpecimensByBreed(spId);
        allTokenIds = [...allTokenIds, ...tokenIds];
      }

      const uniqueTokenIds = Array.from(new Set(allTokenIds));

      const loadedSpecs = await Promise.all(
        uniqueTokenIds.map(async (tokenId) => {
          const spec = await contract.specimens(tokenId);
          const owner = await contract.ownerOf(tokenId);
          return {
            specimenId: Number(tokenId),
            speciesId: Number(spec.speciesId),
            birthTimestamp: Number(spec.birthTimestamp),
            breeder: spec.breeder,
            currentTankId: Number(spec.currentTankId),
            sireId: Number(spec.sireId),
            damId: Number(spec.damId),
            ipfsMetadataUri: spec.ipfsMetadataUri,
            status: Number(spec.status),
            owner: owner
          };
        })
      );
      setSelectedBreedSpecs(loadedSpecs);
    } catch (err) {
      console.error(err);
    } finally {
      setSpecsLoading(false);
    }
  };

  useEffect(() => {
    if (initialSelectedBreed) {
      loadBreedSpecimens(initialSelectedBreed);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleProposeBreed = (breed) => {
    // Bypass DAO voting: open the Suggest Species modal pre-populated with the global breed entry.
    // The form will route through /api/suggest-species (Gemini AI audit) and land in the Curator dashboard queue.
    setIsSuggestModalOpen(true);
  };

  // useEffect fetching is replaced by react-query hook

  useEffect(() => {
    if (preselectedBreedId && speciesList.length > 0) {
      const matchedBreed = speciesList.find(b => {
        if (b.allSpeciesIds) {
          return b.allSpeciesIds.some(id => Number(id) === Number(preselectedBreedId));
        }
        return Number(b.speciesId) === Number(preselectedBreedId);
      });
      if (matchedBreed) {
        setSelectedBreed(matchedBreed);
        loadBreedSpecimens(matchedBreed);
        if (onClearPreselectedBreed) {
          onClearPreselectedBreed();
        }
      }
    }
  }, [preselectedBreedId, speciesList, onClearPreselectedBreed]);

  // Compatibility calculation - must be at top level (Rules of Hooks)
  const compatibility = useMemo(() => {
    if (!selectedBreed) return { score: 100, color: "hsl(120, 85%, 50%)", text: "", minVol: 30 };
    const nameKey = selectedBreed.scientificName.toLowerCase();
    const metrics = masterLookup[nameKey];
    const minVol = metrics?.minVolumeGallons ?? 30;

    // 1. Tank Volume Penalty
    let pVol = 0;
    if (simVolume < minVol) {
      pVol = ((minVol - simVolume) / minVol) * 100;
    }

    // 2. pH Penalty (1.5 pH units deviation = 100% penalty)
    let pPh = 0;
    if (simPh < selectedBreed.minPh) {
      pPh = ((selectedBreed.minPh - simPh) / 1.5) * 100;
    } else if (simPh > selectedBreed.maxPh) {
      pPh = ((simPh - selectedBreed.maxPh) / 1.5) * 100;
    }
    pPh = Math.min(100, pPh);

    // 3. Temp Penalty (5.0 C deviation = 100% penalty)
    let pTemp = 0;
    if (simTemp < selectedBreed.minTemp) {
      pTemp = ((selectedBreed.minTemp - simTemp) / 5.0) * 100;
    } else if (simTemp > selectedBreed.maxTemp) {
      pTemp = ((simTemp - selectedBreed.maxTemp) / 5.0) * 100;
    }
    pTemp = Math.min(100, pTemp);

    // Multiplicative scoring for realistic compatibility scaling
    const sVol = Math.max(0, 100 - pVol);
    const sPh = Math.max(0, 100 - pPh);
    const sTemp = Math.max(0, 100 - pTemp);

    const rawScore = (sVol / 100) * (sPh / 100) * (sTemp / 100) * 100;
    const score = Math.round(rawScore);

    // Transition from Green (100% = 120 hue) to Red (0% = 0 hue)
    const color = `hsl(${score * 1.2}, 85%, 50%)`;

    let text = "";
    if (score === 100) {
      text = "Perfect Match! Your parameters perfectly match the species' needs.";
    } else if (score >= 80) {
      text = "Good Compatibility. Minor parameters are slightly off but safe.";
    } else if (score >= 50) {
      text = "Caution! Some parameters deviate significantly from the baseline.";
    } else {
      text = "Warning: Dangerous environment! High risk of stress or failure.";
    }

    return { score, color, text, minVol };
  }, [selectedBreed, simVolume, simPh, simTemp, masterLookup]);

  if (loading) {
    return <LoadingSkeleton variant="gallery" count={8} />;
  }

  if (error) {
    return (
      <div className="glass-card" style={{ padding: "3rem", textAlign: "center", border: "1px solid rgba(239, 68, 68, 0.2)" }}>
        <p style={{ color: "#ef4444" }}>{error}</p>
        <button onClick={() => refetchContractSpecies()} className="btn-secondary" style={{ marginTop: "1rem" }}>Retry</button>
      </div>
    );
  }

  if (selectedBreed) {
    const { score, color, text, minVol } = compatibility;
    const fullProfile = fishbaseData.find(
      (f) => f.scientificName.toLowerCase() === selectedBreed.scientificName.toLowerCase()
    ) || {};
    const mode = casualModeActive ? "casual" : "pro";
    const personalityFlavorText = getPersonality(fullProfile, mode).flavorText;
    const radius = 40;
    const strokeWidth = 8;
    const circumference = 2 * Math.PI * radius;
    const strokeDashoffset = circumference - (score / 100) * circumference;

    return (
      <div>
        {/* Back and title header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "2rem", flexWrap: "wrap", gap: "1rem" }}>
          <div>
            <button onClick={() => setSelectedBreed(null)} className="btn-secondary" style={{ display: "inline-flex", alignItems: "center", gap: "0.5rem" }}>
              ← Back to Species List
            </button>
            <h2 style={{ fontSize: "1.75rem", fontWeight: "700", color: "#fff", marginTop: "1rem", marginBottom: "0.25rem" }}>
              {selectedBreed.commonName} Catalog
            </h2>
            <p style={{ fontSize: "0.875rem", color: "var(--text-muted)", fontStyle: "italic", margin: 0 }}>
              {selectedBreed.scientificName}
            </p>
            {selectedBreed.isGlobal && (
              <button 
                onClick={() => handleProposeBreed(selectedBreed)} 
                className="btn-primary" 
                style={{ 
                  marginTop: "0.75rem", 
                  padding: "0.4rem 1rem", 
                  fontSize: "0.8rem",
                  boxShadow: "0 0 10px var(--accent-blue-glow)"
                }}
              >
                Propose Breed to Active Catalog
              </button>
            )}
          </div>
          {/* Metadata details panel */}
          <div className="glass-card" style={{ display: "flex", gap: "1.5rem", padding: "0.75rem 1.5rem" }}>
            <div>
              <span style={{ fontSize: "0.65rem", color: "var(--text-muted)", display: "block", textTransform: "uppercase" }}>Care Level</span>
              <strong style={{ fontSize: "0.9rem", color: "var(--accent-blue)" }}>{CARE_LEVEL_STRINGS[selectedBreed.careLevel]}</strong>
            </div>
            <div>
              <span style={{ fontSize: "0.65rem", color: "var(--text-muted)", display: "block", textTransform: "uppercase" }}>Temperature</span>
              <strong style={{ fontSize: "0.9rem", color: "#fff" }}>{selectedBreed.minTemp}°C - {selectedBreed.maxTemp}°C</strong>
            </div>
            <div>
              <span style={{ fontSize: "0.65rem", color: "var(--text-muted)", display: "block", textTransform: "uppercase" }}>pH Range</span>
              <strong style={{ fontSize: "0.9rem", color: "#fff" }}>{selectedBreed.minPh} - {selectedBreed.maxPh}</strong>
            </div>
            <div>
              <span style={{ fontSize: "0.65rem", color: "var(--text-muted)", display: "block", textTransform: "uppercase" }}>Min Tank</span>
              <strong style={{ fontSize: "0.9rem", color: "var(--accent-amber)" }}>{minVol} Gal</strong>
            </div>
          </div>
        </div>

        {/* Species Hero Image Banner */}
        {fullProfile.masterPhotoUrl && (
          <div style={{
            width: "100%",
            height: "220px",
            borderRadius: "var(--radius-md)",
            overflow: "hidden",
            marginBottom: "2rem",
            position: "relative",
            border: "1px solid rgba(255,255,255,0.08)",
          }}>
            <img
              src={fullProfile.masterPhotoUrl}
              alt={selectedBreed.commonName}
              style={{
                width: "100%",
                height: "100%",
                objectFit: "cover",
              }}
            />
            <div style={{
              position: "absolute",
              bottom: 0,
              left: 0,
              right: 0,
              height: "60%",
              background: "linear-gradient(to top, rgba(10,15,30,0.95) 0%, transparent 100%)",
            }} />
            <div style={{
              position: "absolute",
              bottom: "1rem",
              left: "1.5rem",
              display: "flex",
              alignItems: "center",
              gap: "0.75rem",
            }}>
              <span style={{
                background: "rgba(56, 189, 248, 0.12)",
                border: "1px solid rgba(56, 189, 248, 0.35)",
                color: "#7dd3fc",
                padding: "0.3rem 0.75rem",
                borderRadius: "50px",
                fontSize: "0.75rem",
                fontWeight: "600",
              }}>
                🛡️ Verified Master Photo
              </span>
            </div>
          </div>
        )}

        {/* Dashboard layout */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: "2rem", width: "100%", alignItems: "start" }}>
          
          {/* Left Column: Specimens or Spawning Timeline */}
          <div style={{ flex: "1 1 600px", minWidth: "320px", order: 2 }}>
            
            {/* Sub-tab Selection */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem", flexWrap: "wrap", gap: "1rem" }}>
              <div 
                className="glass-card" 
                style={{ 
                  display: "flex", 
                  gap: "0.25rem", 
                  padding: "0.25rem", 
                  borderRadius: "var(--radius-sm)",
                  background: "rgba(255,255,255,0.01)"
                }}
              >
                <button 
                  className={selectedSubTab === "specimens" ? "btn-primary" : "btn-secondary"} 
                  onClick={() => setSelectedSubTab("specimens")}
                  style={{ padding: "0.4rem 1rem", fontSize: "0.8rem", borderRadius: "6px" }}
                >
                  {casualModeActive ? `Fish Listed (${selectedBreedSpecs.length})` : `Registered Certificates (${selectedBreedSpecs.length})`}
                </button>
                <button 
                  className={selectedSubTab === "hatchery" ? "btn-primary" : "btn-secondary"} 
                  onClick={() => setSelectedSubTab("hatchery")}
                  style={{ padding: "0.4rem 1rem", fontSize: "0.8rem", borderRadius: "6px" }}
                >
                  Hatchery Spawning Logs
                </button>
                <button 
                  className={selectedSubTab === "listings" ? "btn-primary" : "btn-secondary"} 
                  onClick={() => setSelectedSubTab("listings")}
                  style={{ padding: "0.4rem 1rem", fontSize: "0.8rem", borderRadius: "6px" }}
                >
                  Active Listings
                </button>
              </div>

              {selectedSubTab === "specimens" && walletAccount && (
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                  <span style={{ fontSize: "0.8rem", color: "var(--text-secondary)" }}>Show My Fish Only:</span>
                  <button 
                    onClick={() => setShowMyFishOnly(!showMyFishOnly)}
                    style={{
                      padding: "0.35rem 0.75rem",
                      fontSize: "0.75rem",
                      borderRadius: "4px",
                      background: showMyFishOnly ? "var(--accent-blue-glow)" : "rgba(255,255,255,0.02)",
                      border: showMyFishOnly ? "1px solid var(--accent-blue)" : "1px solid var(--glass-border)",
                      color: showMyFishOnly ? "#fff" : "var(--text-secondary)",
                      cursor: "pointer",
                      transition: "all 0.2s"
                    }}
                  >
                    {showMyFishOnly ? "Active" : "Inactive"}
                  </button>
                </div>
              )}
            </div>

            {selectedSubTab === "specimens" ? (
              specsLoading ? (
                <div className="glass-card" style={{ padding: "3rem", textAlign: "center" }}>
                  <p style={{ color: "var(--text-muted)" }}>Loading registered certificates...</p>
                </div>
              ) : (selectedBreedSpecs.length === 0 || (showMyFishOnly && selectedBreedSpecs.filter(s => s.owner.toLowerCase() === walletAccount.toLowerCase()).length === 0)) ? (
                <div className="glass-card" style={{ padding: "3rem", textAlign: "center" }}>
                  <p style={{ color: "var(--text-muted)", margin: 0 }}>
                    {showMyFishOnly ? "You do not own any certificates under this breed." : "No certificates registered under this breed yet."}
                  </p>
                </div>
              ) : (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: "1.5rem" }}>
                  {(showMyFishOnly && walletAccount
                    ? selectedBreedSpecs.filter(s => s.owner.toLowerCase() === walletAccount.toLowerCase())
                    : selectedBreedSpecs
                  ).map((spec) => {
                    const statusBadgeColors = [
                      { text: "#22c55e", bg: "rgba(34, 197, 94, 0.1)", border: "rgba(34, 197, 94, 0.2)" }, // Active
                      { text: "#ef4444", bg: "rgba(239, 68, 68, 0.1)", border: "rgba(239, 68, 68, 0.2)" }, // Deceased
                      { text: "#3b82f6", bg: "rgba(59, 130, 246, 0.1)", border: "rgba(59, 130, 246, 0.2)" }  // Rehomed
                    ];
                    const badge = statusBadgeColors[spec.status] || statusBadgeColors[0];
                    const birthDate = spec.birthTimestamp > 0 
                      ? new Date(spec.birthTimestamp * 1000).toLocaleDateString()
                      : "Wild-Caught / Unknown";

                    const customPhoto = localStorage.getItem(`aquadex_specimen_photo_${spec.specimenId}`);
                    const specBreedData = fishbaseData.find(
                      (item) => item.scientificName.toLowerCase() === selectedBreed.scientificName.toLowerCase()
                    );
                    const masterPhotoUrl = specBreedData?.masterPhotoUrl || "";
                    const finalImgSrc = customPhoto || masterPhotoUrl;

                    return (
                      <div 
                        key={spec.specimenId} 
                        className="glass-card" 
                        onClick={() => onSelectSpecimen && onSelectSpecimen(spec.specimenId)}
                        style={{ padding: "1.5rem", position: "relative", cursor: "pointer" }}
                      >
                        {/* Photo / Fallback SVG Area */}
                        {(() => {
                          const isPlant = isPlantEntry(specBreedData || {});
                          const badgeLabel = isPlant ? "🌿 Certified Master Flora" : "🛡️ Breeder-Verified Master Stock";
                          const badgeBg = isPlant
                            ? "rgba(16, 185, 129, 0.18)"
                            : "rgba(56, 189, 248, 0.12)";
                          const badgeBorder = isPlant
                            ? "rgba(16, 185, 129, 0.45)"
                            : "rgba(56, 189, 248, 0.35)";
                          const badgeColor = isPlant ? "#34d399" : "#7dd3fc";
                          const fallbackSvg = isPlant ? (
                            <PlantSilhouetteSVG
                              specCode={specBreedData?.specCode || 9001}
                              style={{ width: "100px", height: "100px" }}
                            />
                          ) : (
                            <FishSilhouetteSVG 
                              specimenId={spec.specimenId} 
                              style={{ width: "120px", height: "120px" }} 
                            />
                          );
                          return (
                            <div style={{ 
                               height: "12rem", 
                               width: "100%",
                               borderRadius: "0.75rem", 
                               background: "linear-gradient(135deg, rgba(255, 255, 255, 0.03) 0%, rgba(255, 255, 255, 0.01) 100%)", 
                               backdropFilter: "blur(12px)",
                               boxShadow: "inset 0 1px 1px rgba(255, 255, 255, 0.05), 0 4px 15px rgba(0, 0, 0, 0.1)",
                               marginBottom: "1rem",
                               position: "relative",
                               overflow: "hidden",
                               border: "1px solid rgba(255, 255, 255, 0.08)",
                               display: "flex",
                               alignItems: "center",
                               justifyContent: "center"
                             }}>
                              <LazyImage
                                src={finalImgSrc}
                                alt={`Specimen ${spec.specimenId}`}
                                style={{ width: "100%", height: "100%" }}
                                fallbackSvg={fallbackSvg}
                              />

                              {/* Glassmorphic Verified Master Badge */}
                              {masterPhotoUrl && (
                                <span style={{
                                  position: "absolute",
                                  bottom: "0.6rem",
                                  left: "50%",
                                  transform: "translateX(-50%)",
                                  fontSize: "0.6rem",
                                  fontWeight: "700",
                                  padding: "0.22rem 0.65rem",
                                  borderRadius: "20px",
                                  whiteSpace: "nowrap",
                                  color: badgeColor,
                                  background: badgeBg,
                                  border: `1px solid ${badgeBorder}`,
                                  backdropFilter: "blur(8px)",
                                  letterSpacing: "0.03em",
                                  zIndex: 2
                                }}>
                                  {badgeLabel}
                                </span>
                              )}

                              <span style={{ 
                                position: "absolute", 
                                top: "0.75rem", 
                                right: "0.75rem", 
                                fontSize: "0.65rem",
                                fontWeight: "700",
                                padding: "0.25rem 0.5rem",
                                borderRadius: "4px",
                                color: badge.text,
                                background: badge.bg,
                                border: `1px solid ${badge.border}`,
                                zIndex: 2
                              }}>
                                {spec.status === 0 ? "Active" : spec.status === 1 ? "Deceased" : "Rehomed"}
                              </span>
                            </div>
                          );
                        })()}

                        <h3 style={{ fontSize: "1.1rem", fontWeight: "700", color: "#fff", marginBottom: "0.75rem", marginTop: 0 }}>
                          {casualModeActive ? selectedBreed.commonName : `Cert. Serial No. ${spec.specimenId.toString().padStart(3, "0")}`}
                        </h3>

                        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", fontSize: "0.75rem", color: "var(--text-secondary)", marginBottom: "1.25rem" }}>
                          {proMode && (
                            <div style={{ display: "flex", justifyContent: "space-between" }}>
                              <span>Owner</span>
                              <strong style={{ fontFamily: "monospace", color: "#fff" }}>
                                {spec.owner ? `${spec.owner.substring(0, 6)}...${spec.owner.substring(38)}` : "None"}
                              </strong>
                            </div>
                          )}
                          {proMode && (
                            <div style={{ display: "flex", justifyContent: "space-between" }}>
                              <span>Breeder</span>
                              <strong style={{ fontFamily: "monospace", color: "#fff" }}>
                                {spec.breeder && spec.breeder !== ZeroAddress 
                                  ? `${spec.breeder.substring(0, 6)}...${spec.breeder.substring(38)}` 
                                  : "Wild-Caught"}
                              </strong>
                            </div>
                          )}
                          <div style={{ display: "flex", justifyContent: "space-between" }}>
                            <span>{casualModeActive ? "Date Added" : "Birth/Hatch Date"}</span>
                            <strong style={{ color: "#fff" }}>{birthDate}</strong>
                          </div>
                          {casualModeActive && (
                            <div style={{ display: "flex", gap: "0.35rem", flexWrap: "wrap", marginTop: "0.25rem" }}>
                              <span style={{
                                fontSize: "0.6rem",
                                padding: "0.2rem 0.5rem",
                                borderRadius: "20px",
                                background: "rgba(34, 197, 94, 0.12)",
                                border: "1px solid rgba(34, 197, 94, 0.3)",
                                color: "#4ade80",
                                fontWeight: "700"
                              }}>✅ Registry Verified</span>
                              {spec.status === 0 && (
                                <span style={{
                                  fontSize: "0.6rem",
                                  padding: "0.2rem 0.5rem",
                                  borderRadius: "20px",
                                  background: "rgba(56, 189, 248, 0.12)",
                                  border: "1px solid rgba(56, 189, 248, 0.3)",
                                  color: "#7dd3fc",
                                  fontWeight: "700"
                                }}>🐠 Tank-Bred Premium Stock</span>
                              )}
                            </div>
                          )}
                        </div>

                        <div style={{ display: "flex", gap: "0.5rem" }}>
                          {proMode && (
                            <button 
                              onClick={(e) => {
                                e.stopPropagation();
                                onViewLineage(spec.specimenId);
                              }}
                              className="btn-primary" 
                              style={{ flex: 1, padding: "0.5rem", fontSize: "0.75rem", textAlign: "center", zIndex: 10 }}
                            >
                              Trace Ancestry Family Tree
                            </button>
                          )}
                          {casualModeActive && (
                            <button 
                              onClick={(e) => {
                                e.stopPropagation();
                                onSelectSpecimen && onSelectSpecimen(spec.specimenId);
                              }}
                              className="btn-primary" 
                              style={{ flex: 1, padding: "0.5rem", fontSize: "0.75rem", textAlign: "center", zIndex: 10, background: "linear-gradient(135deg, rgba(14,165,233,0.3), rgba(56,189,248,0.2))", border: "1px solid rgba(56,189,248,0.4)" }}
                            >
                              🐠 View Details
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )
            ) : selectedSubTab === "hatchery" ? (
              <div className="glass-card" style={{ padding: "1.5rem 2rem", background: "rgba(255,255,255,0.01)", border: "1px solid rgba(255,255,255,0.04)" }}>
                <h3 style={{ fontSize: "1.15rem", fontWeight: "600", color: "#fff", marginBottom: "1.5rem", fontFamily: "'Outfit', sans-serif" }}>
                  Hatchery Insights & Spawning Records
                </h3>
                <HatcheryLogs 
                  specCode={selectedBreed.speciesId} 
                  contractInstance={contractInstance} 
                  marketplaceAddress={marketplaceAddress} 
                  walletAccount={walletAccount} 
                  onCheckoutSuccessRedirect={onCheckoutSuccessRedirect}
                />
              </div>
            ) : (
              <div className="glass-card" style={{ padding: "1.5rem 2rem", background: "rgba(255,255,255,0.01)", border: "1px solid rgba(255,255,255,0.04)" }}>
                <h3 style={{ fontSize: "1.15rem", fontWeight: "600", color: "#fff", marginBottom: "1.5rem", fontFamily: "'Outfit', sans-serif" }}>
                  Active Marketplace Listings
                </h3>
                <MarketplaceBoard 
                  contractAddress={contractAddress}
                  marketplaceAddress={marketplaceAddress}
                  walletAccount={walletAccount}
                  filterSpeciesId={selectedBreed.speciesId}
                  onLineageSelect={onViewLineage}
                  onSelectCheckoutOrder={onSelectCheckoutOrder}
                  displayTank={displayTank}
                  setDisplayTank={setDisplayTank}
                  casualModeActive={true}
                />
              </div>
            )}

          </div>

          {/* Right Column: Simulate My Tank Widget */}
          <div style={{ width: "340px", flexShrink: 0, display: "flex", flexDirection: "column", gap: "1.5rem", order: 3 }}>
            
            {/* Simulator Main Card */}
            <div 
              className="glass-card" 
              style={{ 
                padding: "1.5rem", 
                background: "rgba(255,255,255,0.02)",
                border: "1px solid rgba(255,255,255,0.05)",
                display: "flex",
                flexDirection: "column",
                gap: "1.25rem"
              }}
            >
              <h3 style={{ fontSize: "1.2rem", fontWeight: "700", color: "#fff", margin: 0, display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <span>🎮</span> Simulate My Tank
              </h3>

              {/* Match Score Display Panel */}
              <div 
                style={{ 
                  display: "flex", 
                  alignItems: "center", 
                  gap: "1rem", 
                  padding: "1rem", 
                  background: "rgba(0,0,0,0.2)", 
                  borderRadius: "var(--radius-sm)",
                  border: `1px solid ${color}30`
                }}
              >
                {/* Circular Gauge */}
                <div style={{ position: "relative", width: "80px", height: "80px", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <svg width="80" height="80" viewBox="0 0 100 100" style={{ transform: "rotate(-90deg)", position: "absolute", top: 0, left: 0 }}>
                    <circle 
                      cx="50" 
                      cy="50" 
                      r={radius} 
                      fill="none" 
                      stroke="rgba(255,255,255,0.04)" 
                      strokeWidth={strokeWidth} 
                    />
                    <circle 
                      cx="50" 
                      cy="50" 
                      r={radius} 
                      fill="none" 
                      stroke={color} 
                      strokeWidth={strokeWidth} 
                      strokeDasharray={circumference}
                      strokeDashoffset={strokeDashoffset}
                      strokeLinecap="round"
                      style={{ transition: "stroke-dashoffset 0.3s ease, stroke 0.3s ease" }}
                    />
                  </svg>
                  <div style={{ fontSize: "1.1rem", fontWeight: "700", color: color, textShadow: `0 0 6px ${color}30` }}>
                    {score}%
                  </div>
                </div>

                <div>
                  <span style={{ fontSize: "0.65rem", color: "var(--text-muted)", display: "block", textTransform: "uppercase", fontWeight: "600" }}>
                    {casualModeActive ? "Tank Compatibility" : "Compatibility Score"}
                  </span>
                  <strong style={{ fontSize: "1rem", color: color, display: "block", marginTop: "0.15rem", transition: "color 0.3s ease" }}>
                    {score === 100 ? (casualModeActive ? "✅ 100% Compatibility Match" : "Perfect Match") : score >= 80 ? (casualModeActive ? "👍 Good for your tank!" : "Good Match") : score >= 50 ? "Caution" : "Warning"}
                  </strong>
                  {casualModeActive && score === 100 && (
                    <span style={{ display: "inline-block", marginTop: "0.4rem", fontSize: "0.6rem", padding: "0.2rem 0.6rem", borderRadius: "20px", background: "rgba(34,197,94,0.15)", border: "1px solid rgba(34,197,94,0.4)", color: "#4ade80", fontWeight: "700", letterSpacing: "0.03em" }}>
                      [ Perfect Aquarium Fit ]
                    </span>
                  )}
                </div>
              </div>

              {/* Feedback description */}
              <p style={{ fontSize: "0.75rem", color: "var(--text-secondary)", margin: 0, lineHeight: "1.4" }}>
                {text}
              </p>

              {/* Sliders Container */}
              <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem", borderTop: "1px solid rgba(255,255,255,0.05)", paddingTop: "1.25rem" }}>
                
                {/* Tank Size Slider */}
                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.75rem", marginBottom: "0.4rem" }}>
                    <span style={{ color: "var(--text-secondary)" }}>Tank Size</span>
                    <strong style={{ color: "#fff" }}>{simVolume} Gal</strong>
                  </div>
                  <input 
                    type="range" 
                    min="5" 
                    max="300" 
                    step="5"
                    value={simVolume} 
                    onChange={(e) => setSimVolume(Number(e.target.value))}
                    style={{ 
                      width: "100%", 
                      accentColor: "var(--accent-blue)",
                      background: "rgba(255,255,255,0.1)",
                      height: "4px",
                      borderRadius: "2px",
                      outline: "none"
                    }}
                  />
                  <div style={{ fontSize: "0.65rem", color: "var(--text-muted)", marginTop: "0.25rem", display: "flex", justifyContent: "space-between" }}>
                    <span>5 gal</span>
                    <span>Min ideal: {minVol} gal</span>
                    <span>300 gal</span>
                  </div>
                </div>

                {/* pH Slider */}
                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.75rem", marginBottom: "0.4rem" }}>
                    <span style={{ color: "var(--text-secondary)" }}>Water pH</span>
                    <strong style={{ color: "#fff" }}>{simPh}</strong>
                  </div>
                  <input 
                    type="range" 
                    min="4.0" 
                    max="10.0" 
                    step="0.1"
                    value={simPh} 
                    onChange={(e) => setSimPh(Number(e.target.value))}
                    style={{ 
                      width: "100%", 
                      accentColor: "var(--accent-blue)",
                      background: "rgba(255,255,255,0.1)",
                      height: "4px",
                      borderRadius: "2px",
                      outline: "none"
                    }}
                  />
                  <div style={{ fontSize: "0.65rem", color: "var(--text-muted)", marginTop: "0.25rem", display: "flex", justifyContent: "space-between" }}>
                    <span>4.0 pH</span>
                    <span>Ideal: {selectedBreed.minPh} - {selectedBreed.maxPh}</span>
                    <span>10.0 pH</span>
                  </div>
                </div>

                {/* Temperature Slider */}
                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.75rem", marginBottom: "0.4rem" }}>
                    <span style={{ color: "var(--text-secondary)" }}>Temperature</span>
                    <strong style={{ color: "#fff" }}>{simTemp} °C</strong>
                  </div>
                  <input 
                    type="range" 
                    min="15.0" 
                    max="35.0" 
                    step="0.5"
                    value={simTemp} 
                    onChange={(e) => setSimTemp(Number(e.target.value))}
                    style={{ 
                      width: "100%", 
                      accentColor: "var(--accent-blue)",
                      background: "rgba(255,255,255,0.1)",
                      height: "4px",
                      borderRadius: "2px",
                      outline: "none"
                    }}
                  />
                  <div style={{ fontSize: "0.65rem", color: "var(--text-muted)", marginTop: "0.25rem", display: "flex", justifyContent: "space-between" }}>
                    <span>15.0 °C</span>
                    <span>Ideal: {selectedBreed.minTemp} - {selectedBreed.maxTemp} °C</span>
                    <span>35.0 °C</span>
                  </div>
                </div>

              </div>
            </div>

            {/* Checklist telemetry card */}
            <div 
              className="glass-card" 
              style={{ 
                padding: "1.25rem", 
                background: "rgba(255,255,255,0.01)",
                border: "1px solid rgba(255,255,255,0.03)",
                display: "flex",
                flexDirection: "column",
                gap: "0.75rem"
              }}
            >
              <h4 style={{ fontSize: "0.85rem", fontWeight: "700", color: "#fff", textTransform: "uppercase", letterSpacing: "0.05em", margin: 0 }}>
                Parameter Check
              </h4>
              <ul style={{ listStyle: "none", fontSize: "0.75rem", display: "flex", flexDirection: "column", gap: "0.5rem", padding: 0, margin: 0 }}>
                <li style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                  <span>{simVolume >= minVol ? "🟢" : "🔴"}</span>
                  <span style={{ color: simVolume >= minVol ? "var(--text-primary)" : "var(--text-muted)" }}>
                    {simVolume >= minVol ? `Volume is sufficient (>= ${minVol} gal)` : `Volume too low (need >= ${minVol} gal)`}
                  </span>
                </li>
                <li style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                  <span>{(simPh >= selectedBreed.minPh && simPh <= selectedBreed.maxPh) ? "🟢" : "🔴"}</span>
                  <span style={{ color: (simPh >= selectedBreed.minPh && simPh <= selectedBreed.maxPh) ? "var(--text-primary)" : "var(--text-muted)" }}>
                    {(simPh >= selectedBreed.minPh && simPh <= selectedBreed.maxPh) 
                      ? `pH is within safe limits (${selectedBreed.minPh} - ${selectedBreed.maxPh})` 
                      : `pH is out of range (${selectedBreed.minPh} - ${selectedBreed.maxPh})`}
                  </span>
                </li>
                <li style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                  <span>{(simTemp >= selectedBreed.minTemp && simTemp <= selectedBreed.maxTemp) ? "🟢" : "🔴"}</span>
                  <span style={{ color: (simTemp >= selectedBreed.minTemp && simTemp <= selectedBreed.maxTemp) ? "var(--text-primary)" : "var(--text-muted)" }}>
                    {(simTemp >= selectedBreed.minTemp && simTemp <= selectedBreed.maxTemp) 
                      ? `Temp is within safe limits (${selectedBreed.minTemp} - ${selectedBreed.maxTemp}°C)` 
                      : `Temp is out of range (${selectedBreed.minTemp} - ${selectedBreed.maxTemp}°C)`}
                  </span>
                </li>
              </ul>
            </div>

            {/* Verified Safe Companions */}
            <div 
              className="glass-card" 
              style={{ 
                padding: "1.25rem", 
                background: "rgba(255,255,255,0.01)",
                border: "1px solid rgba(255,255,255,0.03)",
                display: "flex",
                flexDirection: "column",
                gap: "0.75rem"
              }}
            >
              <h4 style={{ fontSize: "0.85rem", fontWeight: "700", color: "#fff", textTransform: "uppercase", letterSpacing: "0.05em", margin: 0 }}>
                Verified Safe Companions
              </h4>
              {(() => {
                const companions = fishbaseData.filter((item) => {
                  if (item.scientificName.toLowerCase() === selectedBreed.scientificName.toLowerCase()) {
                    return false;
                  }
                  const minPh = item.tankMetrics?.phRange?.[0] ?? 6.5;
                  const maxPh = item.tankMetrics?.phRange?.[1] ?? 7.5;
                  const minTemp = item.tankMetrics?.tempRangeCelsius?.[0] ?? 22.0;
                  const maxTemp = item.tankMetrics?.tempRangeCelsius?.[1] ?? 28.0;

                  const phMatch = simPh >= (minPh - 0.3) && simPh <= (maxPh + 0.3);
                  const tempMatch = simTemp >= (minTemp - 2.0) && simTemp <= (maxTemp + 2.0);

                  return phMatch && tempMatch;
                });

                if (companions.length === 0) {
                  return (
                    <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", margin: 0, fontStyle: "italic" }}>
                      No compatible companions found.
                    </p>
                  );
                }

                return (
                  <div 
                    style={{ 
                      display: "flex", 
                      gap: "0.75rem", 
                      overflowX: "auto", 
                      paddingBottom: "0.5rem",
                      scrollbarWidth: "thin",
                      scrollbarColor: "rgba(255,255,255,0.1) transparent"
                    }}
                  >
                    {companions.map((comp) => (
                      <div 
                        key={comp.specCode} 
                        style={{ 
                          flex: "0 0 110px", 
                          padding: "0.5rem", 
                          background: isPlantEntry(comp)
                            ? "rgba(16, 185, 129, 0.04)"
                            : "rgba(255,255,255,0.02)", 
                          border: `1px solid ${isPlantEntry(comp) ? "rgba(16,185,129,0.15)" : "rgba(255,255,255,0.05)"}`, 
                          borderRadius: "6px",
                          display: "flex",
                          flexDirection: "column",
                          alignItems: "center",
                          textAlign: "center"
                        }}
                      >
                        <div style={{ width: "40px", height: "30px", marginBottom: "0.25rem" }}>
                          {isPlantEntry(comp) ? (
                            <PlantSilhouetteSVG specCode={comp.specCode} />
                          ) : (
                            <FishSilhouetteSVG specimenId={comp.specCode} />
                          )}
                        </div>
                        <span style={{ fontSize: "0.7rem", fontWeight: "600", color: isPlantEntry(comp) ? "#34d399" : "#fff", display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", width: "100%" }} title={comp.commonName}>
                          {comp.commonName}
                        </span>
                        <span style={{ fontSize: "0.55rem", color: "var(--text-muted)", fontStyle: "italic", display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", width: "100%" }} title={comp.scientificName}>
                          {comp.scientificName}
                        </span>
                        <span style={{ fontSize: "0.55rem", color: isPlantEntry(comp) ? "#34d399" : "var(--accent-blue)", marginTop: "0.15rem" }}>
                          {isPlantEntry(comp) ? "🌿 Flora" : `pH ${comp.tankMetrics?.phRange?.[0]}-${comp.tankMetrics?.phRange?.[1]}`}
                        </span>
                      </div>
                    ))}
                  </div>
                );
              })()}
            </div>

          </div>

          {/* Species Care Guide — shown first via flex order */}
          <div 
            className="bg-white/[0.02] border border-white/[0.06] p-5 rounded-2xl glass-card"
            style={{ 
              flex: "1 1 100%", 
              minWidth: "320px",
              order: 1,
              background: "rgba(255, 255, 255, 0.02)", 
              border: "1px solid rgba(255, 255, 255, 0.06)", 
              padding: "1.25rem", 
              borderRadius: "1rem",
              display: "flex",
              flexDirection: "column",
              gap: "1.25rem"
            }}
          >
            <h3 style={{ fontSize: "1.2rem", fontWeight: "700", color: "#fff", margin: 0, display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <span>📋</span> Species Care Guide
            </h3>

            {/* Personality flavor intro — absent = silent (renders only when present for the active mode) */}
            {personalityFlavorText && (
              <p
                style={{
                  margin: 0,
                  paddingLeft: "0.85rem",
                  borderLeft: "2px solid var(--accent-blue)",
                  fontStyle: "italic",
                  fontSize: "0.85rem",
                  lineHeight: "1.5",
                  color: "var(--text-secondary)"
                }}
              >
                {personalityFlavorText}
              </p>
            )}

            {/* Sub-tab Selection */}
            <div 
              className="glass-card" 
              style={{ 
                display: "flex", 
                gap: "0.25rem", 
                padding: "0.25rem", 
                borderRadius: "var(--radius-sm)",
                background: "rgba(255,255,255,0.01)"
              }}
            >
              <button 
                className={activeInfoTab === "care" ? "btn-primary" : "btn-secondary"} 
                onClick={() => setActiveInfoTab("care")}
                style={{ flex: 1, padding: "0.4rem 0.5rem", fontSize: "0.8rem", borderRadius: "6px", textAlign: "center", whiteSpace: "nowrap" }}
              >
                Care Blueprint
              </button>
              <button 
                className={activeInfoTab === "diet" ? "btn-primary" : "btn-secondary"} 
                onClick={() => setActiveInfoTab("diet")}
                style={{ flex: 1, padding: "0.4rem 0.5rem", fontSize: "0.8rem", borderRadius: "6px", textAlign: "center", whiteSpace: "nowrap" }}
              >
                Diet & Nutrition
              </button>
              <button 
                className={activeInfoTab === "breeding" ? "btn-primary" : "btn-secondary"} 
                onClick={() => setActiveInfoTab("breeding")}
                style={{ flex: 1, padding: "0.4rem 0.5rem", fontSize: "0.8rem", borderRadius: "6px", textAlign: "center", whiteSpace: "nowrap" }}
              >
                Breeding Profile
              </button>
              <button 
                className={activeInfoTab === "insights" ? "btn-primary" : "btn-secondary"} 
                onClick={() => setActiveInfoTab("insights")}
                style={{ flex: 1, padding: "0.4rem 0.5rem", fontSize: "0.8rem", borderRadius: "6px", textAlign: "center", whiteSpace: "nowrap" }}
              >
                {casualModeActive ? "💡 Tips" : "Insights"}
              </button>
            </div>

            {/* Tab Contents */}
            {activeInfoTab === "care" && (
              <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
                <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                  <span style={{ fontSize: "0.75rem", color: "var(--text-muted)", textTransform: "uppercase", fontWeight: "600" }}>Biotope Origin</span>
                  <p style={{ fontSize: "0.85rem", color: "var(--text-secondary)", lineHeight: "1.4" }}>
                    {fullProfile.ecology?.biotope || "General freshwater aquatic biotope."}
                  </p>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
                  <div>
                    <span style={{ fontSize: "0.75rem", color: "var(--text-muted)", textTransform: "uppercase", fontWeight: "600", display: "block", marginBottom: "0.25rem" }}>Water Hardness</span>
                    <span className="badge badge-blue" style={{ fontSize: "0.8rem", padding: "0.35rem 0.75rem" }}>
                      {fullProfile.ecology?.hardnessRange || "5 - 15 dGH"}
                    </span>
                  </div>
                  <div>
                    <span style={{ fontSize: "0.75rem", color: "var(--text-muted)", textTransform: "uppercase", fontWeight: "600", display: "block", marginBottom: "0.25rem" }}>Temp Ceiling</span>
                    <span className="badge badge-red" style={{ fontSize: "0.8rem", padding: "0.35rem 0.75rem" }}>
                      Up to {fullProfile.ecology?.tempCeiling || selectedBreed.maxTemp}°C
                    </span>
                  </div>
                </div>

                <div>
                  <span style={{ fontSize: "0.75rem", color: "var(--text-muted)", textTransform: "uppercase", fontWeight: "600", display: "block", marginBottom: "0.25rem" }}>pH Envelope</span>
                  <span className="badge badge-green" style={{ fontSize: "0.8rem", padding: "0.35rem 0.75rem" }}>
                    {selectedBreed.minPh} - {selectedBreed.maxPh} pH
                  </span>
                </div>

                <div style={{ 
                  padding: "1rem", 
                  background: "var(--accent-amber-glow)", 
                  border: "1px solid rgba(251, 191, 36, 0.2)", 
                  borderRadius: "8px", 
                  display: "flex", 
                  flexDirection: "column", 
                  gap: "0.25rem" 
                }}>
                  <strong style={{ fontSize: "0.75rem", color: "var(--accent-amber)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                    ⚠️ Social & Aggression Rules
                  </strong>
                  <p style={{ fontSize: "0.8rem", color: "var(--text-primary)", lineHeight: "1.4" }}>
                    {fullProfile.ecology?.socialBehavior || "Compatible with similar temperament species."}
                  </p>
                </div>
              </div>
            )}

            {activeInfoTab === "diet" && (
              <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: "0.75rem", color: "var(--text-muted)", textTransform: "uppercase", fontWeight: "600" }}>Trophic Level</span>
                  <span className={`badge ${
                    (fullProfile.diet?.trophicLevel || "Omnivore").toLowerCase().includes("carn") ? "badge-red" : 
                    (fullProfile.diet?.trophicLevel || "Omnivore").toLowerCase().includes("herb") ? "badge-green" : "badge-blue"
                  }`} style={{ fontSize: "0.8rem" }}>
                    {fullProfile.diet?.trophicLevel || "Omnivore"}
                  </span>
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                  <span style={{ fontSize: "0.75rem", color: "var(--text-muted)", textTransform: "uppercase", fontWeight: "600" }}>Wild Food Items</span>
                  <p style={{ fontSize: "0.85rem", color: "var(--text-secondary)", lineHeight: "1.4" }}>
                    {fullProfile.diet?.fooditems || "General micro-invertebrates and plant matter."}
                  </p>
                </div>

                <div style={{ 
                  padding: "1rem", 
                  background: "var(--accent-blue-glow)", 
                  border: "1px solid rgba(56, 189, 248, 0.2)", 
                  borderRadius: "8px", 
                  display: "flex", 
                  flexDirection: "column", 
                  gap: "0.25rem" 
                }}>
                  <strong style={{ fontSize: "0.75rem", color: "var(--accent-blue)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                    📋 Hobbyist Feeding Playbook
                  </strong>
                  <p style={{ fontSize: "0.8rem", color: "var(--text-primary)", lineHeight: "1.4" }}>
                    {fullProfile.diet?.feedingPlaybook || "Requires high-quality flakes/pellets as a daily staple. Supplement with live or frozen foods."}
                  </p>
                </div>
              </div>
            )}

            {activeInfoTab === "breeding" && (
              <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: "0.75rem", color: "var(--text-muted)", textTransform: "uppercase", fontWeight: "600" }}>Spawning Trait</span>
                  <span className="badge badge-amber" style={{ fontSize: "0.8rem" }}>
                    {fullProfile.reproduction?.spawningTrait || "Egg-scatterer"}
                  </span>
                </div>

                <div style={{ 
                  padding: "1rem", 
                  background: "var(--accent-green-glow)", 
                  border: "1px solid rgba(52, 211, 153, 0.2)", 
                  borderRadius: "8px", 
                  display: "flex", 
                  flexDirection: "column", 
                  gap: "0.25rem" 
                }}>
                  <strong style={{ fontSize: "0.75rem", color: "var(--accent-green)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                    🌿 Tank Decoration Requirements
                  </strong>
                  <p style={{ fontSize: "0.8rem", color: "var(--text-primary)", lineHeight: "1.4" }}>
                    {fullProfile.reproduction?.layoutRequirement || "Java moss beds or spawning mops."}
                  </p>
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                  <span style={{ fontSize: "0.75rem", color: "var(--text-muted)", textTransform: "uppercase", fontWeight: "600" }}>Biological Reproduction Notes</span>
                  <p style={{ fontSize: "0.85rem", color: "var(--text-secondary)", lineHeight: "1.4" }}>
                    {fullProfile.reproduction?.comments || "Egg scattering species. Separate hatchery tank recommended."}
                  </p>
                </div>
              </div>
            )}

            {activeInfoTab === "insights" && (
              <SpeciesInsights
                specCode={selectedBreed.speciesId || fullProfile.specCode}
                speciesName={selectedBreed.commonName}
                casualModeActive={casualModeActive}
              />
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* Toast notification */}
      {toastMessage && (
        <div className="inline-toast">
          {toastMessage}
        </div>
      )}
      <h2 style={{ fontSize: "1.75rem", fontWeight: "700", color: "#fff", marginBottom: "0.5rem", marginTop: 0 }}>
        Breed & Species Catalog
      </h2>
      <p style={{ color: "var(--text-muted)", fontSize: "0.875rem", marginBottom: "2rem" }}>
        Browse verified genetic registries by aquatic species.
      </p>

      {/* Search Input and Navigation Tabs Container */}
      <div style={{ 
        display: "flex", 
        justifyContent: "space-between", 
        alignItems: "center", 
        gap: "1rem", 
        marginBottom: "2rem",
        flexWrap: "wrap"
      }}>
        {/* Tabs */}
        <div 
          className="glass-card" 
          style={{ 
            display: "flex", 
            gap: "0.5rem", 
            padding: "0.5rem", 
            borderRadius: "var(--radius-sm)",
            maxWidth: "fit-content",
            margin: 0
          }}
        >
          <button 
            className={viewMode === "contract" ? "btn-primary" : "btn-secondary"} 
            onClick={() => {
              setViewMode("contract");
              setSelectedBreed(null);
              setSearchTerm("");
            }}
            style={{ padding: "0.5rem 1.25rem", fontSize: "0.875rem" }}
          >
            {proMode ? "Registered Breeds" : "My Collection"}
          </button>
          <button 
            className={viewMode === "global" ? "btn-primary" : "btn-secondary"} 
            onClick={() => {
              setViewMode("global");
              setSelectedBreed(null);
              setSearchTerm("");
            }}
            style={{ padding: "0.5rem 1.25rem", fontSize: "0.875rem" }}
          >
            {proMode ? "Global Database" : "All Species"}
          </button>
          <button 
            className={viewMode === "council" ? "btn-primary" : "btn-secondary"} 
            onClick={() => {
              setViewMode("council");
              setSelectedBreed(null);
              setSearchTerm("");
            }}
            style={{ padding: "0.5rem 1.25rem", fontSize: "0.875rem" }}
          >
            {proMode ? "Breeders Council" : "Community"}
          </button>
          {isCurator && (
            <button 
              className={viewMode === "curation" ? "btn-primary" : "btn-secondary"} 
              onClick={() => {
                setViewMode("curation");
                setSelectedBreed(null);
                setSearchTerm("");
              }}
              style={{ padding: "0.5rem 1.25rem", fontSize: "0.875rem" }}
            >
              Curation Queue
            </button>
          )}
        </div>

        {/* Search Bar & Suggest Button Row */}
        <div style={{ display: "flex", gap: "1rem", alignItems: "center", minWidth: "300px", flex: "1", maxWidth: "550px" }}>
          <div style={{ position: "relative", flex: "1" }}>
            <input 
              type="text" 
              placeholder={casualModeActive ? "Try: 'beginner fish for warm water'" : "Search species or describe what you need..."} 
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value);
                nlParseQuery(e.target.value);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && searchTerm.length >= 8) {
                  nlParseQuery(searchTerm);
                }
              }}
              style={{ 
                width: "100%", 
                padding: "0.6rem 2.5rem 0.6rem 1rem", 
                background: "rgba(255, 255, 255, 0.03)", 
                border: `1px solid ${isParsing ? 'rgba(56, 189, 248, 0.4)' : 'var(--glass-border)'}`, 
                borderRadius: "50px", 
                color: "#fff", 
                fontSize: "0.875rem",
                outline: "none",
                transition: "border-color 0.2s"
              }}
              onFocus={(e) => e.target.style.borderColor = "var(--accent-blue)"}
              onBlur={(e) => { if (!isParsing) e.target.style.borderColor = "var(--glass-border)"; }}
            />
            {isParsing && (
              <span style={{ position: "absolute", right: "38px", top: "50%", transform: "translateY(-50%)", fontSize: "0.65rem", color: "rgba(56, 189, 248, 0.7)" }}>
                🔱
              </span>
            )}
            {searchTerm ? (
              <button 
                onClick={() => { setSearchTerm(""); clearParsed(); }}
                style={{
                  position: "absolute",
                  right: "10px",
                  top: "50%",
                  transform: "translateY(-50%)",
                  background: "none",
                  border: "none",
                  color: "var(--text-muted)",
                  cursor: "pointer",
                  fontSize: "1.1rem",
                  padding: "0 5px",
                  lineHeight: "1"
                }}
              >
                &times;
              </button>
            ) : (
              <svg 
                width="16" 
                height="16" 
                viewBox="0 0 24 24" 
                fill="none" 
                stroke="var(--text-muted)" 
                strokeWidth="2" 
                strokeLinecap="round" 
                strokeLinejoin="round"
                style={{
                  position: "absolute",
                  right: "15px",
                  top: "50%",
                  transform: "translateY(-50%)",
                  pointerEvents: "none"
                }}
              >
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
            )}
          </div>
          {!casualModeActive && (
            <button 
              onClick={() => setIsSuggestModalOpen(true)}
              className="btn-secondary"
              style={{
                padding: "0.6rem 1.25rem",
                borderRadius: "50px",
                border: "1px solid rgba(56, 189, 248, 0.3)",
                color: "#38bdf8",
                fontSize: "0.875rem",
                fontWeight: "700",
                cursor: "pointer",
                whiteSpace: "nowrap",
                background: "rgba(56, 189, 248, 0.05)",
                boxShadow: "0 0 8px rgba(56, 189, 248, 0.15)",
                outline: "none"
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "rgba(56, 189, 248, 0.12)";
                e.currentTarget.style.boxShadow = "0 0 12px rgba(56, 189, 248, 0.3)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "rgba(56, 189, 248, 0.05)";
                e.currentTarget.style.boxShadow = "0 0 8px rgba(56, 189, 248, 0.15)";
              }}
            >
              ⚡ Suggest Species
            </button>
          )}
        </div>
      </div>

      {/* Residing Species Quick-Tap Badges */}
      {residingSpecies.length > 0 && (
        <div style={{
          display: "flex",
          alignItems: "center",
          gap: "0.5rem",
          flexWrap: "wrap",
          marginBottom: "1.5rem",
          padding: "0.25rem 0.5rem"
        }}>
          <span style={{ 
            fontSize: "0.65rem", 
            color: "var(--text-muted)", 
            fontWeight: "700", 
            textTransform: "uppercase",
            letterSpacing: "0.05em",
            display: "inline-flex",
            alignItems: "center",
            gap: "0.25rem"
          }}>
            🐠 My Tank Species
          </span>
          <div style={{ display: "flex", gap: "0.35rem", flexWrap: "wrap" }}>
            {residingSpecies.map((item) => (
              <button
                key={`badge-${item.id}`}
                onClick={() => {
                  const breed = speciesList.find(s => Number(s.speciesId) === Number(item.id)) ||
                                globalRefList.find(s => Number(s.speciesId) === Number(item.id));
                  if (breed) {
                    setSelectedBreed(breed);
                    if (viewMode !== "global") {
                      loadBreedSpecimens(breed);
                    }
                  }
                }}
                style={{
                  background: "rgba(255, 255, 255, 0.03)",
                  border: "1px solid rgba(255, 255, 255, 0.06)",
                  color: "var(--text-secondary)",
                  padding: "0.25rem 0.65rem",
                  borderRadius: "50px",
                  fontSize: "0.7rem",
                  fontWeight: "500",
                  cursor: "pointer",
                  transition: "all 0.2s cubic-bezier(0.4, 0, 0.2, 1)",
                  boxShadow: "0 2px 8px rgba(0,0,0,0.1)"
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "rgba(56, 189, 248, 0.08)";
                  e.currentTarget.style.borderColor = "rgba(56, 189, 248, 0.3)";
                  e.currentTarget.style.color = "#7dd3fc";
                  e.currentTarget.style.transform = "translateY(-1px)";
                  e.currentTarget.style.boxShadow = "0 4px 12px rgba(56, 189, 248, 0.15)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "rgba(255, 255, 255, 0.03)";
                  e.currentTarget.style.borderColor = "rgba(255, 255, 255, 0.06)";
                  e.currentTarget.style.color = "var(--text-secondary)";
                  e.currentTarget.style.transform = "translateY(0)";
                  e.currentTarget.style.boxShadow = "0 2px 8px rgba(0,0,0,0.1)";
                }}
              >
                {item.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {viewMode === "council" ? (
        <BreedersCouncil 
          walletAccount={walletAccount} 
          suggestionsQuery={suggestionsQuery}
          updateSuggestionStatus={updateSuggestionStatus}
          CARE_LEVEL_STRINGS={CARE_LEVEL_STRINGS}
          marketplaceAddress={marketplaceAddress}
        />
      ) : viewMode === "curation" ? (
        <CurationQueuePanel 
          contractInstance={contractInstance}
          suggestionsQuery={suggestionsQuery}
          updateSuggestionStatus={updateSuggestionStatus}
          refetchContractSpecies={refetchContractSpecies}
          CARE_LEVEL_STRINGS={CARE_LEVEL_STRINGS}
          showToast={showToast}
        />
      ) : loading || (viewMode === "global" && !globalData) ? (
        <div className="glass-card" style={{ padding: "3rem", textAlign: "center" }}>
          <p style={{ color: "var(--text-muted)", fontSize: "1.1rem" }}>
            {viewMode === "contract" ? "Querying Breed Catalog..." : "Loading Global Reference Library..."}
          </p>
        </div>
      ) : error ? (
        <div className="glass-card" style={{ padding: "3rem", textAlign: "center", border: "1px solid rgba(239, 68, 68, 0.2)" }}>
          <p style={{ color: "#ef4444" }}>{error}</p>
          <button onClick={refetchContractSpecies} className="btn-secondary" style={{ marginTop: "1rem" }}>Retry</button>
        </div>
      ) : filteredSpecies.length === 0 ? (
        <div className="glass-card" style={{ padding: "3rem", textAlign: "center" }}>
          <p style={{ color: "var(--text-muted)", margin: 0 }}>No species registered in the catalog yet.</p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
          {/* Poseidon NL Search explanation chip */}
          {nlExplanation && nlExplanation !== 'Parsed locally' && (
            <div style={{
              display: "flex",
              alignItems: "center",
              gap: "0.5rem",
              padding: "0.4rem 0.75rem",
              borderRadius: "20px",
              background: "rgba(56, 189, 248, 0.06)",
              border: "1px solid rgba(56, 189, 248, 0.15)",
              fontSize: "0.72rem",
              color: "rgba(103, 232, 249, 0.85)",
              width: "fit-content"
            }}>
              <img src="/poseidon-avatar.jpg" alt="" style={{ width: "16px", height: "16px", borderRadius: "50%", objectFit: "cover" }} />
              <span>{nlExplanation}</span>
              <button
                onClick={() => { resetFilters(); clearParsed(); setSearchTerm(""); }}
                style={{ background: "none", border: "none", color: "rgba(103, 232, 249, 0.6)", cursor: "pointer", fontSize: "0.8rem", padding: "0 4px" }}
              >
                ✕
              </button>
            </div>
          )}

          {/* Filter Toggle Button */}
          <button
            onClick={() => setFiltersOpen(!filtersOpen)}
            className="glass-card breed-filter-toggle"
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "0.75rem 1.25rem",
              background: filtersOpen ? "rgba(56, 189, 248, 0.06)" : "rgba(255,255,255,0.02)",
              border: filtersOpen ? "1px solid rgba(56, 189, 248, 0.3)" : "1px solid rgba(255,255,255,0.08)",
              borderRadius: "var(--radius-sm)",
              cursor: "pointer",
              transition: "all 0.3s ease",
              width: "100%",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
              <span style={{ fontSize: "1.1rem" }}>🎛️</span>
              <span style={{ fontSize: "0.85rem", fontWeight: "600", color: "#fff", letterSpacing: "0.03em" }}>
                {casualModeActive ? "Filter Fish" : "Filters & Refinement"}
              </span>
              {(filters.type !== "All" || filters.difficulty !== "All" || filters.tempBucket !== "All" || filters.phBucket !== "All") && (
                <span style={{
                  background: "var(--accent-blue)",
                  color: "#fff",
                  fontSize: "0.65rem",
                  fontWeight: "700",
                  padding: "0.15rem 0.5rem",
                  borderRadius: "50px",
                }}>
                  ACTIVE
                </span>
              )}
            </div>
            <span style={{ 
              color: "var(--text-muted)", 
              fontSize: "0.8rem",
              transform: filtersOpen ? "rotate(180deg)" : "rotate(0deg)",
              transition: "transform 0.3s ease",
            }}>
              ▼
            </span>
          </button>

          {/* Mobile filter backdrop */}
          {filtersOpen && (
            <div 
              className="breed-filter-backdrop"
              onClick={() => setFiltersOpen(false)}
            />
          )}

          {/* Collapsible Filter Panel — becomes bottom sheet on mobile */}
          <div className={`breed-filter-panel ${filtersOpen ? "breed-filter-panel--open" : ""}`} style={{
            maxHeight: filtersOpen ? "600px" : "0px",
            overflow: "hidden",
            transition: "max-height 0.4s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.3s ease",
            opacity: filtersOpen ? 1 : 0,
          }}>
          <div 
            className="glass-card" 
            style={{ 
              padding: "1.5rem", 
              display: "flex", 
              flexWrap: "wrap",
              gap: "1.5rem",
              background: "rgba(255,255,255,0.01)",
              border: "1px solid rgba(255,255,255,0.06)",
              borderRadius: "var(--radius-sm)"
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid rgba(255,255,255,0.05)", paddingBottom: "0.75rem", width: "100%" }}>
              <span style={{ fontSize: "0.8rem", fontWeight: "700", color: "#fff", letterSpacing: "0.05em" }}>FILTERS</span>
              <button 
                onClick={resetFilters} 
                style={{ 
                  background: "none", 
                  border: "none", 
                  color: "var(--accent-blue)", 
                  fontSize: "0.75rem", 
                  cursor: "pointer",
                  textDecoration: "underline",
                  padding: 0
                }}
              >
                Reset All
              </button>
            </div>

            {/* Category / Type Filter */}
            {availableFacets.type && (
              <div>
                <span style={{ fontSize: "0.65rem", color: "var(--text-muted)", letterSpacing: "0.05em", textTransform: "uppercase", fontWeight: "600", display: "block", marginBottom: "0.5rem" }}>
                  Category
                </span>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem" }}>
                  {[
                    { val: "All", label: "All" },
                    { val: "Fish", label: "Fish" },
                    { val: "Plant", label: "Plants" }
                  ].map(opt => {
                    const isActive = filters.type === opt.val;
                    const count = facets.type[opt.val] || 0;
                    return (
                      <button
                        key={opt.val}
                        onClick={() => setFilters(prev => ({ ...prev, type: opt.val }))}
                        className={isActive ? "btn-primary" : "btn-secondary"}
                        style={{ 
                          padding: "0.35rem 0.65rem", 
                          fontSize: "0.725rem", 
                          borderRadius: "20px",
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "0.25rem",
                          cursor: "pointer"
                        }}
                      >
                        {opt.label} <span style={{ opacity: 0.6, fontSize: "0.65rem" }}>({count})</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Care Level Difficulty Filter */}
            {availableFacets.difficulty && (
              <div>
                <span style={{ fontSize: "0.65rem", color: "var(--text-muted)", letterSpacing: "0.05em", textTransform: "uppercase", fontWeight: "600", display: "block", marginBottom: "0.5rem" }}>
                  Care Level
                </span>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem" }}>
                  {[
                    { val: "All", label: "All" },
                    { val: "Easy", label: "Easy" },
                    { val: "Medium", label: "Medium" },
                    { val: "Difficult", label: "Difficult" },
                    { val: "Expert", label: "Expert" }
                  ].map(opt => {
                    const isActive = filters.difficulty === opt.val;
                    const count = facets.difficulty[opt.val] || 0;
                    return (
                      <button
                        key={opt.val}
                        onClick={() => setFilters(prev => ({ ...prev, difficulty: opt.val }))}
                        className={isActive ? "btn-primary" : "btn-secondary"}
                        style={{ 
                          padding: "0.35rem 0.65rem", 
                          fontSize: "0.725rem", 
                          borderRadius: "20px",
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "0.25rem",
                          cursor: "pointer"
                        }}
                      >
                        {opt.label} <span style={{ opacity: 0.6, fontSize: "0.65rem" }}>({count})</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Temperature Range Filter */}
            {availableFacets.temp && (
              <div>
                <span style={{ fontSize: "0.65rem", color: "var(--text-muted)", letterSpacing: "0.05em", textTransform: "uppercase", fontWeight: "600", display: "block", marginBottom: "0.5rem" }}>
                  Temperature
                </span>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem" }}>
                  {[
                    { val: "All", label: "All" },
                    { val: "Cold", label: "Cold (<22°C)" },
                    { val: "Tropical", label: "Tropical (22-28°C)" },
                    { val: "Warm", label: "Warm (>28°C)" }
                  ].map(opt => {
                    const isActive = filters.tempBucket === opt.val;
                    const count = facets.temp[opt.val] || 0;
                    return (
                      <button
                        key={opt.val}
                        onClick={() => setFilters(prev => ({ ...prev, tempBucket: opt.val }))}
                        className={isActive ? "btn-primary" : "btn-secondary"}
                        style={{ 
                          padding: "0.35rem 0.65rem", 
                          fontSize: "0.725rem", 
                          borderRadius: "20px",
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "0.25rem",
                          cursor: "pointer"
                        }}
                      >
                        {opt.label} <span style={{ opacity: 0.6, fontSize: "0.65rem" }}>({count})</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* pH Range Filter */}
            {availableFacets.ph && (
              <div>
                <span style={{ fontSize: "0.65rem", color: "var(--text-muted)", letterSpacing: "0.05em", textTransform: "uppercase", fontWeight: "600", display: "block", marginBottom: "0.5rem" }}>
                  pH Level
                </span>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem" }}>
                  {[
                    { val: "All", label: "All" },
                    { val: "Acidic", label: "Acidic (<6.8)" },
                    { val: "Neutral", label: "Neutral (6.8-7.8)" },
                    { val: "Alkaline", label: "Alkaline (>7.8)" }
                  ].map(opt => {
                    const isActive = filters.phBucket === opt.val;
                    const count = facets.ph[opt.val] || 0;
                    return (
                      <button
                        key={opt.val}
                        onClick={() => setFilters(prev => ({ ...prev, phBucket: opt.val }))}
                        className={isActive ? "btn-primary" : "btn-secondary"}
                        style={{ 
                          padding: "0.35rem 0.65rem", 
                          fontSize: "0.725rem", 
                          borderRadius: "20px",
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "0.25rem",
                          cursor: "pointer"
                        }}
                      >
                        {opt.label} <span style={{ opacity: 0.6, fontSize: "0.65rem" }}>({count})</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Biotope Origin Filter */}
            {availableFacets.origin && (
              <div>
                <span style={{ fontSize: "0.65rem", color: "var(--text-muted)", letterSpacing: "0.05em", textTransform: "uppercase", fontWeight: "600", display: "block", marginBottom: "0.5rem" }}>
                  Biotope Origin
                </span>
                <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
                  {[
                    { val: "All", label: "All" },
                    { val: "South American", label: "South American" },
                    { val: "Central American", label: "Central American" },
                    { val: "African", label: "African" },
                    { val: "Asian", label: "Asian" },
                    { val: "North American", label: "North American" }
                  ].map(opt => {
                    const isActive = filters.origin === opt.val;
                    const count = facets.origin[opt.val] || 0;
                    return (
                      <button
                        key={opt.val}
                        onClick={() => setFilters(prev => ({ ...prev, origin: opt.val }))}
                        className={isActive ? "btn-primary" : "btn-secondary"}
                        style={{ 
                          padding: "0.35rem 0.75rem", 
                          fontSize: "0.725rem", 
                          borderRadius: "20px",
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          width: "100%",
                          textAlign: "left",
                          cursor: "pointer"
                        }}
                      >
                        <span>{opt.label}</span>
                        <span style={{ opacity: 0.6, fontSize: "0.65rem" }}>({count})</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
          {/* Mobile Apply Filters button — inside the panel */}
          <button
            className="breed-filter-apply-btn btn-primary"
            onClick={() => setFiltersOpen(false)}
            style={{ 
              display: "none", 
              width: "100%", 
              padding: "0.85rem", 
              marginTop: "1rem",
              fontSize: "0.9rem",
              fontWeight: "600",
              borderRadius: "var(--radius-sm)"
            }}
          >
            Apply Filters ({filteredSpecies.length} results)
          </button>
          </div>
          <div style={{ width: "100%" }}>
            {filteredSpecies.length === 0 ? (
              <div className="glass-card" style={{ padding: "4rem 2rem", textAlign: "center", border: "1px dashed var(--glass-border)", background: "none" }}>
                <h3 style={{ color: "var(--text-secondary)", marginBottom: "0.5rem" }}>No Species Matches</h3>
                <p style={{ color: "var(--text-muted)", fontSize: "0.875rem", marginBottom: "1.5rem" }}>
                  No species match the current search query or active filters.
                </p>
                <button
                  onClick={() => setIsSuggestModalOpen(true)}
                  className="btn-primary"
                  style={{
                    padding: "0.5rem 1.5rem",
                    fontSize: "0.875rem",
                    borderRadius: "20px",
                    background: "rgba(56, 189, 248, 0.15)",
                    border: "1px solid rgba(56, 189, 248, 0.5)",
                    color: "#38bdf8",
                    cursor: "pointer",
                    boxShadow: "0 0 10px rgba(56, 189, 248, 0.1)"
                  }}
                >
                  Propose new species suggestion 🐠
                </button>
              </div>
            ) : (
              <div 
                ref={parentRefCallback}
                className={starryBgActive ? "starry-grid-overlay" : ""}
                style={{
                  height: "750px", // Scrollable container viewport height
                  overflowY: "auto",
                  width: "100%",
                  position: "relative",
                  scrollbarWidth: "thin",
                  scrollbarColor: "rgba(255,255,255,0.1) transparent"
                }}
              >
                <div
                  style={{
                    height: `${rowVirtualizer.getTotalSize()}px`,
                    width: "100%",
                    position: "relative"
                  }}
                >
                  {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                    const row = rowItems[virtualRow.index];
                    if (!row) return null;
                    return (
                      <div
                        key={virtualRow.key}
                        ref={rowVirtualizer.measureElement}
                        data-index={virtualRow.index}
                        style={{
                          position: "absolute",
                          top: 0,
                          left: 0,
                          width: "100%",
                          transform: `translateY(${virtualRow.start}px)`,
                          paddingBottom: "1.5rem" // Grid row spacing
                        }}
                      >
                        <div style={{ 
                          display: "grid", 
                          gridTemplateColumns: `repeat(${columnsCount}, 1fr)`, 
                          gap: "1.5rem" 
                        }}>
                          {row.map((breed) => (
                            <div 
                              key={breed.speciesId} 
                              className="glass-card" 
                              style={{ 
                                padding: "0", 
                                cursor: "pointer", 
                                background: "linear-gradient(145deg, rgba(6, 20, 38, 0.85) 0%, rgba(8, 12, 20, 0.95) 100%)",
                                border: "1px solid rgba(34, 211, 238, 0.12)",
                                borderRadius: "16px",
                                overflow: "hidden",
                                transition: "transform 0.25s cubic-bezier(0.4, 0, 0.2, 1), box-shadow 0.25s ease, border-color 0.25s ease" 
                              }}
                              onClick={() => {
                                setSelectedBreed(breed);
                                if (viewMode !== "global") {
                                  loadBreedSpecimens(breed);
                                }
                              }}
                              onMouseEnter={(e) => {
                                e.currentTarget.style.transform = "translateY(-4px)";
                                e.currentTarget.style.boxShadow = "0 8px 40px rgba(34, 211, 238, 0.12), inset 0 1px 0 rgba(34, 211, 238, 0.1)";
                                e.currentTarget.style.borderColor = "rgba(34, 211, 238, 0.35)";
                              }}
                              onMouseLeave={(e) => {
                                e.currentTarget.style.transform = "translateY(0)";
                                e.currentTarget.style.boxShadow = "none";
                                e.currentTarget.style.borderColor = "rgba(34, 211, 238, 0.12)";
                              }}
                            >
                              {/* Terminal Header Bar */}
                              <div style={{
                                display: "flex",
                                justifyContent: "space-between",
                                alignItems: "center",
                                padding: "0.6rem 1rem",
                                borderBottom: "1px solid rgba(34, 211, 238, 0.08)",
                                background: "rgba(0, 0, 0, 0.2)",
                              }}>
                                <div style={{ display: "flex", gap: "5px" }}>
                                  <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: "#ff5f57" }} />
                                  <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: "#ffbd2e" }} />
                                  <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: "#28c840" }} />
                                </div>
                                <span style={{ fontSize: "0.6rem", color: "var(--text-muted)", fontFamily: "monospace" }}>
                                  spec-dex / entry #{breed.speciesId}
                                </span>
                                <span style={{
                                  fontSize: "0.55rem",
                                  fontWeight: "700",
                                  padding: "0.15rem 0.5rem",
                                  borderRadius: "4px",
                                  border: "1px solid rgba(255,255,255,0.3)",
                                  color: "#fff",
                                  textTransform: "uppercase",
                                  letterSpacing: "0.05em",
                                }}>
                                  {CARE_LEVEL_STRINGS[breed.careLevel]}
                                </span>
                              </div>

                              {/* Card Body */}
                              <div style={{ padding: "1rem 1.25rem 1.25rem" }}>
                              {/* Photo Card Area */}
                              {(() => {
                                const matched = fishbaseData.find(
                                  (f) => f.scientificName.toLowerCase() === breed.scientificName.toLowerCase()
                                );
                                const breedImgSrc = matched?.masterPhotoUrl || "";
                                const isPlant = isPlantEntry(matched || { specCode: breed.speciesId });
                                const badgeLabel = isPlant ? "🌿 Certified Master Flora" : "🛡️ Breeder-Verified Master Stock";
                                const badgeBg = isPlant ? "rgba(16,185,129,0.18)" : "rgba(56,189,248,0.12)";
                                const badgeBorder = isPlant ? "rgba(16,185,129,0.45)" : "rgba(56,189,248,0.35)";
                                const badgeColor = isPlant ? "#34d399" : "#7dd3fc";
                                const fallbackSvg = isPlant ? (
                                  <PlantSilhouetteSVG
                                    specCode={matched?.specCode || breed.speciesId}
                                    style={{ width: "100px", height: "100px" }}
                                  />
                                ) : (
                                  <FishSilhouetteSVG 
                                    specimenId={breed.speciesId} 
                                    style={{ width: "120px", height: "120px" }} 
                                  />
                                );
                                 const activeEggType = matched?.easterEgg || (Number(breed.speciesId) === 10691 ? "nami_lol" : Number(breed.speciesId) === 271 ? "magikarp_pokemon" : null);
                                 const eggConfig = activeEggType ? getEasterEggConfig(activeEggType, magikarpEvolved) : null;
                                 const isEggRevealed = eggConfig && (
                                   !casualModeActive || 
                                   eggConfig.keywords.some(w => searchTerm.toLowerCase().includes(w))
                                 );
                                return (
                                  <div style={{ 
                                     height: "12rem", 
                                     width: "100%", 
                                     borderRadius: "0.75rem", 
                                     background: isPlant 
                                       ? "linear-gradient(135deg, rgba(16, 185, 129, 0.06) 0%, rgba(16, 185, 129, 0.02) 100%)" 
                                       : "linear-gradient(135deg, rgba(255, 255, 255, 0.03) 0%, rgba(255, 255, 255, 0.01) 100%)",
                                     backdropFilter: "blur(12px)",
                                     boxShadow: "inset 0 1px 1px rgba(255, 255, 255, 0.05), 0 4px 15px rgba(0, 0, 0, 0.1)",
                                     marginBottom: "1rem",
                                     position: "relative",
                                     overflow: "hidden",
                                     border: isPlant ? "1px solid rgba(16, 185, 129, 0.15)" : "1px solid rgba(255, 255, 255, 0.08)",
                                     display: "flex",
                                     alignItems: "center",
                                     justifyContent: "center"
                                  }}>
                                    <LazyImage
                                      src={breedImgSrc}
                                      alt={breed.commonName}
                                      style={{ width: "100%", height: "100%" }}
                                      fallbackSvg={fallbackSvg}
                                    />

                                    {isEggRevealed && eggConfig && (
                                       <span 
                                         onClick={(e) => {
                                           e.stopPropagation();
                                           setActiveLoreEgg(eggConfig);
                                         }}
                                         style={{
                                           position: "absolute",
                                           top: "0.6rem",
                                           left: "0.6rem",
                                           fontSize: "0.6rem",
                                           fontWeight: "800",
                                           padding: "0.22rem 0.65rem",
                                           borderRadius: "20px",
                                           whiteSpace: "nowrap",
                                           color: eggConfig.color,
                                           background: eggConfig.bg,
                                           border: `1px solid ${eggConfig.border}`,
                                           backdropFilter: "blur(8px)",
                                           boxShadow: `0 0 10px ${eggConfig.glow}`,
                                           cursor: "pointer",
                                           transition: "all 0.2s ease",
                                           zIndex: 10,
                                           letterSpacing: "0.03em"
                                         }}
                                         onMouseEnter={(e) => {
                                           e.currentTarget.style.transform = "scale(1.05)";
                                           e.currentTarget.style.boxShadow = `0 0 15px ${eggConfig.glow}`;
                                         }}
                                         onMouseLeave={(e) => {
                                           e.currentTarget.style.transform = "scale(1)";
                                           e.currentTarget.style.boxShadow = `0 0 10px ${eggConfig.glow}`;
                                         }}
                                       >
                                         {eggConfig.label}
                                       </span>
                                     )}

                                    {/* Pro-only breeding method badge (top-right) */}
                                    {proMode && matched?.reproduction?.spawningTrait &&
                                      matched.reproduction.spawningTrait !== "Information arriving soon" && (
                                      <span style={{
                                        position: "absolute",
                                        top: "0.6rem",
                                        right: "0.6rem",
                                        fontSize: "0.6rem",
                                        fontWeight: "700",
                                        padding: "0.22rem 0.65rem",
                                        borderRadius: "20px",
                                        whiteSpace: "nowrap",
                                        color: "#fcd34d",
                                        background: "rgba(251, 191, 36, 0.16)",
                                        border: "1px solid rgba(251, 191, 36, 0.4)",
                                        backdropFilter: "blur(8px)",
                                        letterSpacing: "0.03em",
                                        zIndex: 3
                                      }}>
                                        🥚 {matched.reproduction.spawningTrait}
                                      </span>
                                    )}

                                    {/* Glassmorphic Verified Master Badge */}
                                    <span style={{
                                      position: "absolute",
                                      bottom: "0.6rem",
                                      left: "50%",
                                      transform: "translateX(-50%)",
                                      fontSize: "0.6rem",
                                      fontWeight: "700",
                                      padding: "0.22rem 0.65rem",
                                      borderRadius: "20px",
                                      whiteSpace: "nowrap",
                                      color: badgeColor,
                                      background: badgeBg,
                                      border: `1px solid ${badgeBorder}`,
                                      backdropFilter: "blur(8px)",
                                      letterSpacing: "0.03em",
                                      zIndex: 2
                                    }}>
                                      {badgeLabel}
                                    </span>
                                  </div>
                                );
                              })()}

                              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "0.25rem" }}>
                                <h3 style={{ fontSize: "1.15rem", fontWeight: "700", color: "#fff", margin: 0, letterSpacing: "-0.01em" }}>
                                  {breed.commonName}
                                </h3>
                                {viewMode === "contract" && (
                                  <span style={{ fontSize: "0.7rem", color: proMode ? "#67e8f9" : "var(--accent-green)", fontWeight: "600", fontFamily: "monospace" }}>
                                    {proMode ? `${breed.specimenCount} Certs` : breed.specimenCount > 0 ? `${breed.specimenCount} Available` : ""}
                                  </span>
                                )}
                                {proMode && (
                                  <span style={{ fontSize: "0.6rem", color: "var(--text-muted)", fontFamily: "monospace", opacity: 0.7 }}>
                                    #{breed.speciesId}
                                  </span>
                                )}
                              </div>

                              <p style={{ fontSize: "0.78rem", color: proMode ? "#67e8f9" : "var(--text-secondary)", fontStyle: "italic", margin: "0 0 0.75rem 0", fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
                                {breed.scientificName}
                              </p>

                              {/* Casual Mode: Personality tagline + behavior tags */}
                              {casualModeActive && (() => {
                                const profile = fishbaseData.find(f => f.scientificName.toLowerCase() === breed.scientificName.toLowerCase());
                                const tagline = getPersonality(profile, "casual").vibeLine || profile?.ecology?.socialBehavior || profile?.ecology?.comments || "";
                                const tags = [];
                                if (profile?.ecology?.socialBehavior?.toLowerCase().includes("school")) tags.push("Schooling Fish");
                                if (profile?.diet?.trophicLevel === "Omnivore") tags.push("Easy Feeder");
                                if (breed.careLevel === 0) tags.push("Beginner Friendly");
                                if (profile?.reproduction?.spawningTrait) tags.push("Tank-Bred Available");
                                const displayTags = tags.slice(0, 3);
                                
                                return (
                                  <div style={{ marginBottom: "1rem" }}>
                                    {tagline && (
                                      <p style={{
                                        fontSize: "0.72rem",
                                        color: "var(--text-secondary)",
                                        fontStyle: "italic",
                                        margin: "0 0 0.75rem 0",
                                        paddingLeft: "0.75rem",
                                        borderLeft: "2px solid rgba(34, 211, 238, 0.4)",
                                        lineHeight: "1.4",
                                        display: "-webkit-box",
                                        WebkitLineClamp: 2,
                                        WebkitBoxOrient: "vertical",
                                        overflow: "hidden",
                                      }}>
                                        "{tagline}"
                                      </p>
                                    )}
                                    {displayTags.length > 0 && (
                                      <div style={{ display: "flex", gap: "0.35rem", flexWrap: "wrap" }}>
                                        {displayTags.map(tag => (
                                          <span key={tag} style={{
                                            fontSize: "0.58rem",
                                            fontWeight: "700",
                                            padding: "0.2rem 0.55rem",
                                            borderRadius: "20px",
                                            color: "#34d399",
                                            background: "rgba(16, 185, 129, 0.1)",
                                            border: "1px solid rgba(16, 185, 129, 0.3)",
                                            textTransform: "uppercase",
                                            letterSpacing: "0.04em",
                                          }}>
                                            {tag}
                                          </span>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                );
                              })()}

                              {/* Pro Mode: Full technical data block */}
                              {proMode && (() => {
                                const profile = fishbaseData.find(f => f.scientificName.toLowerCase() === breed.scientificName.toLowerCase());
                                const minVol = profile?.tankMetrics?.minVolumeGallons ?? profile?.tankMetrics?.minVolume ?? 30;
                                return (
                                  <div style={{ marginBottom: "0.75rem" }}>
                                    {/* 2x2 Parameter Grid matching landing page */}
                                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem", marginBottom: "0.75rem" }}>
                                      <div style={{ padding: "0.5rem 0.6rem", background: "rgba(6, 20, 38, 0.7)", borderRadius: "6px", border: "1px solid rgba(34, 211, 238, 0.1)", position: "relative", overflow: "hidden" }}>
                                        <span style={{ fontSize: "0.5rem", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", display: "block" }}>Temp Range</span>
                                        <strong style={{ fontSize: "0.9rem", color: "#67e8f9", fontFamily: "monospace" }}>{breed.minTemp} – {breed.maxTemp}°C</strong>
                                        <div style={{ position: "absolute", bottom: 0, left: "10%", right: "10%", height: "2px", background: "linear-gradient(90deg, transparent, #22d3ee, transparent)" }} />
                                      </div>
                                      <div style={{ padding: "0.5rem 0.6rem", background: "rgba(6, 20, 38, 0.7)", borderRadius: "6px", border: "1px solid rgba(34, 211, 238, 0.1)", position: "relative", overflow: "hidden" }}>
                                        <span style={{ fontSize: "0.5rem", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", display: "block" }}>pH Range</span>
                                        <strong style={{ fontSize: "0.9rem", color: "#67e8f9", fontFamily: "monospace" }}>{breed.minPh} – {breed.maxPh}</strong>
                                        <div style={{ position: "absolute", bottom: 0, left: "10%", right: "10%", height: "2px", background: "linear-gradient(90deg, transparent, #22d3ee, transparent)" }} />
                                      </div>
                                      <div style={{ padding: "0.5rem 0.6rem", background: "rgba(6, 20, 38, 0.7)", borderRadius: "6px", border: "1px solid rgba(34, 211, 238, 0.1)", position: "relative", overflow: "hidden" }}>
                                        <span style={{ fontSize: "0.5rem", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", display: "block" }}>Min. Volume</span>
                                        <strong style={{ fontSize: "0.9rem", color: "#67e8f9", fontFamily: "monospace" }}>{Math.round(minVol * 3.785)}L / {minVol} gal</strong>
                                        <div style={{ position: "absolute", bottom: 0, left: "10%", right: "10%", height: "2px", background: "linear-gradient(90deg, transparent, #22d3ee, transparent)" }} />
                                      </div>
                                      <div style={{ padding: "0.5rem 0.6rem", background: "rgba(6, 20, 38, 0.7)", borderRadius: "6px", border: "1px solid rgba(34, 211, 238, 0.1)", position: "relative", overflow: "hidden" }}>
                                        <span style={{ fontSize: "0.5rem", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", display: "block" }}>Care Level</span>
                                        <strong style={{ fontSize: "0.9rem", color: "#67e8f9", fontFamily: "monospace" }}>{CARE_LEVEL_STRINGS[breed.careLevel]}</strong>
                                        <div style={{ position: "absolute", bottom: 0, left: "10%", right: "10%", height: "2px", background: "linear-gradient(90deg, transparent, #22d3ee, transparent)" }} />
                                      </div>
                                    </div>
                                    {/* Raw on-chain values */}
                                    <div style={{ fontSize: "0.58rem", color: "var(--text-muted)", fontFamily: "monospace", marginBottom: "0.5rem", lineHeight: "1.6", opacity: 0.8 }}>
                                      FishBase SpecCode: {profile?.specCode || breed.speciesId} · WoRMS Validated · Updated May 2026<br/>
                                      tempX10: [{breed.minTemp * 10}, {breed.maxTemp * 10}] · phX10: [{breed.minPh * 10}, {breed.maxPh * 10}] · salX10000: 10000
                                    </div>
                                  </div>
                                );
                              })()}

                              {/* Casual Mode: Friendly parameter tiles */}
                              {casualModeActive && (
                              <div style={{ 
                                display: "grid", 
                                gridTemplateColumns: "repeat(3, 1fr)", 
                                gap: "0.75rem", 
                                marginBottom: "1rem"
                              }}>
                                <div style={{
                                  padding: "0.6rem 0.5rem",
                                  background: "rgba(6, 20, 38, 0.7)",
                                  borderRadius: "8px",
                                  border: "1px solid rgba(56, 189, 248, 0.1)",
                                  textAlign: "center",
                                  position: "relative",
                                  overflow: "hidden",
                                }}>
                                  <span style={{ fontSize: "0.55rem", color: "var(--text-muted)", display: "block", marginBottom: "0.3rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                                    {casualModeActive ? "Difficulty" : "Care"}
                                  </span>
                                  <strong style={{ fontSize: "0.85rem", color: casualModeActive ? (breed.careLevel === 0 ? "#34d399" : breed.careLevel === 1 ? "#fbbf24" : "#f87171") : "#67e8f9", fontWeight: "700" }}>
                                    {casualModeActive ? (breed.careLevel === 0 ? "Easy!" : breed.careLevel === 1 ? "Medium" : "Hard") : CARE_LEVEL_STRINGS[breed.careLevel]}
                                  </strong>
                                  <div style={{ position: "absolute", bottom: 0, left: "15%", right: "15%", height: "2px", background: casualModeActive ? `linear-gradient(90deg, transparent, ${breed.careLevel === 0 ? "#34d399" : breed.careLevel === 1 ? "#fbbf24" : "#f87171"}, transparent)` : "linear-gradient(90deg, transparent, #22d3ee, transparent)", borderRadius: "2px" }} />
                                </div>
                                <div style={{
                                  padding: "0.6rem 0.5rem",
                                  background: "rgba(6, 20, 38, 0.7)",
                                  borderRadius: "8px",
                                  border: "1px solid rgba(56, 189, 248, 0.1)",
                                  textAlign: "center",
                                  position: "relative",
                                  overflow: "hidden",
                                }}>
                                  <span style={{ fontSize: "0.55rem", color: "var(--text-muted)", display: "block", marginBottom: "0.3rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>Temp</span>
                                  <strong style={{ fontSize: "0.85rem", color: "#67e8f9", fontWeight: "700" }}>{breed.minTemp}–{breed.maxTemp}°C</strong>
                                  <div style={{ position: "absolute", bottom: 0, left: "15%", right: "15%", height: "2px", background: "linear-gradient(90deg, transparent, #22d3ee, transparent)", borderRadius: "2px" }} />
                                </div>
                                <div style={{
                                  padding: "0.6rem 0.5rem",
                                  background: "rgba(6, 20, 38, 0.7)",
                                  borderRadius: "8px",
                                  border: "1px solid rgba(56, 189, 248, 0.1)",
                                  textAlign: "center",
                                  position: "relative",
                                  overflow: "hidden",
                                }}>
                                  <span style={{ fontSize: "0.55rem", color: "var(--text-muted)", display: "block", marginBottom: "0.3rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>pH</span>
                                  <strong style={{ fontSize: "0.85rem", color: "#67e8f9", fontWeight: "700" }}>{breed.minPh}–{breed.maxPh}</strong>
                                  <div style={{ position: "absolute", bottom: 0, left: "15%", right: "15%", height: "2px", background: "linear-gradient(90deg, transparent, #22d3ee, transparent)", borderRadius: "2px" }} />
                                </div>
                              </div>
                              )}

                              <div style={{ fontSize: "0.72rem", color: "#22d3ee", textAlign: "right", fontWeight: "600", letterSpacing: "0.02em" }}>
                                {casualModeActive 
                                  ? (breed.specimenCount > 0 ? "🛒 Browse Available →" : "Learn More →")
                                  : (viewMode === "global" ? "Propose Breed to Catalog" : "View Certificates →")
                                }
                              </div>
                              </div>{/* end card body */}
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
                {visibleCount < filteredSpecies.length && (
                  <div style={{ height: "60px", display: "flex", justifyContent: "center", alignItems: "center", marginTop: "1rem" }}>
                    <div className="shimmer-placeholder" style={{ width: "120px", height: "12px", borderRadius: "10px" }} />
                  </div>
                )}
              </div>
            )}
          </div>
          </div>
        )}

      {notification && (
        <div 
          style={{
            position: "fixed",
            bottom: "2rem",
            right: "2rem",
            background: "rgba(14, 20, 36, 0.95)",
            border: "1px solid var(--accent-blue)",
            borderRadius: "var(--radius-sm)",
            padding: "1rem 1.25rem",
            boxShadow: "0 8px 32px rgba(0, 0, 0, 0.6)",
            zIndex: 10000,
            display: "flex",
            flexDirection: "column",
            animation: "shimmer 3s ease-in-out infinite",
          }}
        >
          <strong style={{ color: "#fff", display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}>CURATION QUEUE</strong>
          <span style={{ fontSize: "0.75rem", color: "var(--text-secondary)" }}>{notification.message}</span>
        </div>
      )}

      {activeLoreEgg && (
        <div style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: "rgba(10, 15, 30, 0.8)",
          backdropFilter: "blur(12px)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 20000,
          padding: "1.5rem"
        }}>
          <div className="glass-card" style={{
            maxWidth: "480px",
            width: "100%",
            padding: "2rem",
            background: "rgba(14, 20, 36, 0.95)",
            border: `1px solid ${activeLoreEgg.border}`,
            borderRadius: "1rem",
            boxShadow: `0 20px 50px ${activeLoreEgg.glow}`,
            textAlign: "center",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "1.25rem",
            animation: "shimmer 3s ease-in-out infinite"
          }}>
            <div style={{
              width: "64px",
              height: "64px",
              borderRadius: "50%",
              background: activeLoreEgg.bg,
              border: `1px solid ${activeLoreEgg.border}`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "2rem",
              boxShadow: `0 0 15px ${activeLoreEgg.glow}`
            }}>
              {activeLoreEgg.emoji}
            </div>
            
            <h3 style={{ fontSize: "1.5rem", fontWeight: "800", color: "#fff", margin: 0 }}>
              {activeLoreEgg.title}
            </h3>
            
            <p style={{ fontSize: "0.9rem", color: "var(--text-secondary)", lineHeight: "1.6", margin: 0 }}>
              "{activeLoreEgg.lore}"
            </p>

            {activeLoreEgg.key === "magikarp_pokemon" && evolutionError && (
              <p style={{ color: "#ef4444", fontSize: "0.8rem", margin: "0.5rem 0", lineHeight: "1.4" }}>
                ⚠️ {evolutionError}
              </p>
            )}
            
            <div style={{ display: "flex", gap: "1rem", marginTop: "0.5rem" }}>
              <button 
                onClick={() => {
                  setActiveLoreEgg(null);
                  setEvolutionError("");
                }} 
                className="btn-secondary" 
                style={{ 
                  padding: "0.5rem 1.5rem", 
                  fontSize: "0.85rem",
                  cursor: "pointer"
                }}
              >
                Close
              </button>

              {activeLoreEgg.key === "magikarp_pokemon" && !casualModeActive && (
                <button 
                  onClick={async () => {
                    if (magikarpEvolved) {
                      // Reset to Magikarp
                      setMagikarpEvolved(false);
                      setEvolutionError("");
                      setActiveLoreEgg(getEasterEggConfig("magikarp_pokemon", false));
                    } else {
                      // Check parameters (pH: 7.2, Temp: 20°C)
                      const isPerfect = Math.abs(simPh - 7.2) < 0.15 && Math.abs(simTemp - 20.0) < 0.8;
                      if (!isPerfect) {
                        setEvolutionError(`Parameters unstable! Goldfish evolution requires ideal coldwater biology. Target: pH 7.2, Temp 20.0°C. (Current: pH ${simPh} | Temp ${simTemp}°C)`);
                        return;
                      }
                      setEvolutionError("");
                      setIsEvolving(true);
                      setActiveLoreEgg(null);
                      
                      // Evolution animation delay
                      setTimeout(() => {
                        setIsEvolving(false);
                        setMagikarpEvolved(true);
                        // Reopen modal with Gyarados configuration
                        setActiveLoreEgg(getEasterEggConfig("magikarp_pokemon", true));
                      }, 2500);
                    }
                  }} 
                  className="btn-primary" 
                  style={{ 
                    padding: "0.5rem 1.5rem", 
                    fontSize: "0.85rem",
                    background: magikarpEvolved ? "#ef4444" : activeLoreEgg.color,
                    color: magikarpEvolved ? "#fff" : "#000",
                    border: "none",
                    borderRadius: "4px",
                    fontWeight: "bold",
                    cursor: "pointer",
                    boxShadow: `0 0 10px ${activeLoreEgg.glow}` 
                  }}
                >
                  {magikarpEvolved ? "De-evolve Gyarados 🐟" : "Evolve Magikarp ⚡"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {isEvolving && (
        <div style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: "rgba(10, 15, 30, 0.95)",
          backdropFilter: "blur(20px)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 35000,
          animation: "flashBackground 2.5s infinite"
        }}>
          {/* Custom style tags injected for evolution keyframes */}
          <style>{`
            @keyframes flashBackground {
              0%, 100% { background-color: rgba(10, 15, 30, 0.95); }
              50% { background-color: rgba(249, 115, 22, 0.3); }
            }
            @keyframes pulseScale {
              0%, 100% { transform: scale(1) rotate(0deg); opacity: 0.8; }
              50% { transform: scale(1.6) rotate(180deg); opacity: 1; filter: drop-shadow(0 0 25px #f97316); }
            }
            @keyframes evolveFlash {
              0% { opacity: 0; }
              70% { opacity: 0.8; }
              80% { opacity: 1; background: #fff; }
              100% { opacity: 0; }
            }
            .evolution-fish {
              font-size: 5rem;
              animation: pulseScale 1.2s ease-in-out infinite;
            }
            .evolution-flash-screen {
              position: absolute;
              top: 0; left: 0; right: 0; bottom: 0;
              background: #fff;
              pointer-events: none;
              animation: evolveFlash 2.5s forwards;
            }
          `}</style>
          
          <div className="evolution-fish">🐟</div>
          
          <h2 style={{ color: "#fff", marginTop: "2rem", fontWeight: "900", letterSpacing: "0.1em", fontSize: "2rem", textShadow: "0 0 10px #f97316" }}>
            EVOLVING...
          </h2>
          <p style={{ color: "#94a3b8", fontSize: "0.9rem", marginTop: "0.5rem" }}>
            The water parameters are perfect. Biological code restructure initiated!
          </p>

          <div className="evolution-flash-screen" />
        </div>
      )}

      <SuggestSpeciesModal 
        isOpen={isSuggestModalOpen}
        onClose={() => setIsSuggestModalOpen(false)}
        casualModeActive={casualModeActive}
        onSubmit={async (data) => {
          await suggestSpecies(data);
          setNotification({
            message: `Proposal submitted! Proposing ${data.commonName} (${data.scientificName}) to the curation queue.`
          });
          setTimeout(() => setNotification(null), 5000);
        }}
      />
    </div>
  );
}
