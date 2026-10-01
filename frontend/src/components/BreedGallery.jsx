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
import { useUserRoles } from "../hooks/useUserRoles";
import { ScrollFade } from "./ScrollFade";
import { CurationQueuePanel } from "./CurationQueuePanel";
import { db } from "../db";
import { syncSpecimenToCloud } from "../services/cloudSync";
import { FishSilhouetteSVG, PlantSilhouetteSVG } from "./SilhouetteSVG";
import { getPersonality } from "../utils/personality";
import { SpeciesInsights } from "./reef/SpeciesInsights";
import { SpeciesCardPremium } from "./SpeciesCardPremium";
import { SpeciesPhotoCredit } from "./SpeciesPhotoCredit";
import { buildGlobalCatalog, CARE_LABELS } from "../services/speciesCatalog";
import { assessSpeciesFit } from "../services/speciesFit";
import { realDietText, isCarnivoreTrophic, isHerbivoreTrophic, DIET_NOT_RECORDED } from "../services/speciesDiet";
import { CasualSpeciesDetail } from "./finder/CasualSpeciesDetail";
import { resolveSpecimenPhoto } from "../services/tankMedia";
import { useUnitPrefs } from "../hooks/useUnitPrefs";
import { formatTemperature, formatTemperatureRange, resolveTempScale } from "../utils/units";
import { SexingGuide } from "./SexingGuide";
import { CARE_NOT_RECORDED, checkRange, entryCareRanges, realCareNumber, realCareText, realRange } from "../services/speciesCare";
import { nextTabIndex } from "./breedGalleryTabs";
import {
  FishSimple,
  Certificate,
  GlobeHemisphereWest,
  ClipboardText,
  MagnifyingGlass,
  X,
  SpinnerGap,
  Plus,
  Camera,
  SlidersHorizontal,
  CaretDown,
  WarningCircle,
} from "@phosphor-icons/react";
import "./BreedGalleryDaylight.css";

// Compatibility ring/label hue per honest fit verdict (Fish Finder T2). Driven
// by verdict rather than raw score so an unknown-data "caution" never shows a
// green "perfect" ring.
const VERDICT_COLOR = Object.freeze({
  ok: "hsl(140, 70%, 45%)",       // green
  caution: "hsl(42, 92%, 52%)",   // amber
  blocked: "hsl(0, 78%, 55%)",    // red
  no_tank: "hsl(210, 10%, 55%)",  // neutral
});

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
      color: "var(--accent-blue)",
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
  onSelectedBreedChange,
  deepLinkSpecies,
  pendingSpeciesSearch,
  onClearPendingSpeciesSearch
}) {
  const proMode = !casualModeActive;
  // Temperature display honours Settings → Units & Formatting. NOTE: every
  // temperature VALUE in this component (simTemp, minTemp/maxTemp, the slider's
  // 15–35 domain, the evolution checks) stays in Celsius — only the rendering is
  // converted. Converting the stored values would break the comparisons below.
  const { tempUnit } = useUnitPrefs();
  const tempScale = resolveTempScale(tempUnit);
  const [selectedBreed, setSelectedBreed] = useState(initialSelectedBreed || null);
  const [selectedBreedSpecs, setSelectedBreedSpecs] = useState([]);
  const [residingSpecies, setResidingSpecies] = useState([]);
  const [showMyTankSpeciesOnly, setShowMyTankSpeciesOnly] = useState(proMode);
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
        
        const addOrUpdate = (speciesId, name) => {
          if (!speciesId) return;
          const id = Number(speciesId);
          if (!speciesMap[id]) {
            speciesMap[id] = { name: name || `Species ID ${id}`, count: 0 };
          } else if (name && speciesMap[id].name.startsWith("Species ID ")) {
            speciesMap[id].name = name;
          }
          speciesMap[id].count += 1;
        };

        for (const t of userTanks) {
          if (t.specimens) {
            for (const spec of t.specimens) {
              addOrUpdate(spec.speciesId, spec.commonName);
            }
          }
        }
        
        // Also fetch from standalone specimens table
        const localSpecimens = await db.specimens.toArray();
        const userSpecimens = localSpecimens.filter(
          (s) => s.ownerAddress?.toLowerCase() === walletAccount?.toLowerCase() && s.status === 0
        );
        for (const spec of userSpecimens) {
          addOrUpdate(spec.speciesId, spec.commonName);
        }

        setResidingSpecies(Object.entries(speciesMap).map(([id, info]) => ({
          id: Number(id),
          name: info.name,
          count: info.count
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
  const [galleryDropPhoto, setGalleryDropPhoto] = useState(null); // { preview }
  const galleryPhotoInputRef = useRef(null);

  // Certificate card photos, resolved through the one §9.3 precedence order
  // (hosted → Dexie tankMedia → legacy localStorage → none). The card body renders
  // synchronously, so the read happens in an effect and lands here; a card with no
  // entry yet falls back to the master species image, exactly as it did when a
  // specimen had no photo at all. Absent stays absent — no stand-in URL.
  const [specimenPhotos, setSpecimenPhotos] = useState({}); // specimenId -> url
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const entries = await Promise.all(
        (selectedBreedSpecs || []).map(async (s) => {
          const { url } = await resolveSpecimenPhoto(s.specimenId);
          return [s.specimenId, url];
        })
      );
      if (!cancelled) {
        setSpecimenPhotos(Object.fromEntries(entries.filter(([, url]) => url)));
      }
    })();
    return () => { cancelled = true; };
  }, [selectedBreedSpecs]);

  // Breeder Stock Tag inline editing state
  const [editingTagId, setEditingTagId] = useState(null); // specimenId being edited
  const [editingTagValue, setEditingTagValue] = useState("");

  const handleTagEditStart = (e, spec) => {
    e.stopPropagation();
    setEditingTagId(spec.specimenId);
    setEditingTagValue(spec.breederStockTag || "");
  };

  const handleTagEditSave = async (e, spec) => {
    e.stopPropagation();
    const newTag = editingTagValue.trim().slice(0, 16);
    try {
      await db.specimens.update(spec.specimenId, { breederStockTag: newTag });
      // Fire-and-forget cloud sync
      const updatedSpec = await db.specimens.get(spec.specimenId);
      if (updatedSpec) syncSpecimenToCloud(updatedSpec).catch(() => {});
      // Update local state in the displayed list
      setSelectedBreedSpecs((prev) =>
        prev.map((s) => s.specimenId === spec.specimenId ? { ...s, breederStockTag: newTag } : s)
      );
      showToast(`Stock tag ${newTag ? `"${newTag}"` : "cleared"} saved.`);
    } catch (err) {
      console.error("Failed to save breeder stock tag:", err);
      showToast("Failed to save stock tag.");
    }
    setEditingTagId(null);
    setEditingTagValue("");
  };

  const handleTagEditCancel = (e) => {
    if (e) e.stopPropagation();
    setEditingTagId(null);
    setEditingTagValue("");
  };

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
    castVote,
    isVoting,
    promoteSpecies,
    isPromoting,
  } = useSuggestSpecies();

  // Server-authoritative curation roles (user_roles). Distinct from `isCurator`,
  // which compares against the on-chain curator address and therefore only ever
  // matches the deployer wallet.
  const { data: curationRoles = [] } = useUserRoles(walletAccount);
  const isCouncilMember = curationRoles.some((r) => r === "founder" || r === "curator");

  const CARE_LEVEL_STRINGS = CARE_LABELS;

  // Projected via the canonical species-catalog contract (Fish Finder T1) so the
  // app and the public database.html interpret difficulty/ranges identically.
  const globalRefList = useMemo(() => buildGlobalCatalog(globalData), [globalData]);

  const searchList = useMemo(() => {
    if (viewMode === "global") {
      return globalRefList;
    }
    if (viewMode === "contract") {
      if (casualModeActive || showMyTankSpeciesOnly) {
        const residingIds = new Set(residingSpecies.map((s) => Number(s.id)));
        return speciesList.filter((s) => residingIds.has(Number(s.speciesId)));
      }
    }
    return speciesList;
  }, [viewMode, speciesList, globalRefList, residingSpecies, casualModeActive, showMyTankSpeciesOnly]);

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
      // Slider START POSITION only — not a claim about the species. When the
      // minimum volume is unknown we park the slider mid-range; the "Min ideal"
      // label and the Parameter Check both render an explicit "not recorded"
      // state rather than treating this seed as data (Decision D3).
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

      const targetIds = (breed.allSpeciesIds || [breed.speciesId]).map(Number);
      const loadedById = new Map();

      // 1. On-chain specimens for this breed/species.
      try {
        const provider = getProvider();
        const contract = new Contract(contractAddress, aquadexAbi, provider);

        let allTokenIds = [];
        for (const spId of targetIds) {
          const tokenIds = await contract.getSpecimensByBreed(spId);
          allTokenIds = [...allTokenIds, ...tokenIds];
        }
        const uniqueTokenIds = Array.from(new Set(allTokenIds));

        await Promise.all(
          uniqueTokenIds.map(async (tokenId) => {
            const spec = await contract.specimens(tokenId);
            const owner = await contract.ownerOf(tokenId);
            // Enrich with local breederStockTag if available
            let breederStockTag = "";
            try {
              const localSpec = await db.specimens.get(Number(tokenId));
              if (localSpec?.breederStockTag) breederStockTag = localSpec.breederStockTag;
            } catch (_) {}
            loadedById.set(Number(tokenId), {
              specimenId: Number(tokenId),
              speciesId: Number(spec.speciesId),
              birthTimestamp: Number(spec.birthTimestamp),
              breeder: spec.breeder,
              currentTankId: Number(spec.currentTankId),
              sireId: Number(spec.sireId),
              damId: Number(spec.damId),
              ipfsMetadataUri: spec.ipfsMetadataUri,
              status: Number(spec.status),
              owner: owner,
              breederStockTag
            });
          })
        );
      } catch (err) {
        console.warn("Failed to load on-chain specimens for breed, falling back to local-only:", err);
      }

      // 2. Local-first specimens for this species that haven't (yet) confirmed
      // on-chain. Mints are enqueued as a fire-and-forget batched background
      // job, so a freshly-registered fish can sit in "pending"/"failed"
      // chainStatus for a while (or indefinitely offline) and would otherwise
      // be invisible here since getSpecimensByBreed only returns confirmed
      // on-chain token ids. Merge them in so newly added specimens always
      // show up in their species feed immediately.
      try {
        const localSpecies = await db.specimens
          .filter((s) => targetIds.includes(Number(s.speciesId)))
          .toArray();
        for (const s of localSpecies) {
          const id = Number(s.onChainId ?? s.id);
          if (loadedById.has(id)) continue; // already have the on-chain version
          loadedById.set(id, {
            specimenId: Number(s.id),
            speciesId: Number(s.speciesId),
            birthTimestamp: s.birthTimestamp || s.createdAt || 0,
            breeder: s.breeder || s.ownerAddress || "",
            currentTankId: Number(s.currentTankId || 0),
            sireId: Number(s.sireId || 0),
            damId: Number(s.damId || 0),
            ipfsMetadataUri: s.ipfsMetadataUri || "",
            status: s.status ?? 0,
            owner: s.ownerAddress || "",
            breederStockTag: s.breederStockTag || "",
            chainStatus: s.chainStatus || "local"
          });
        }
      } catch (err) {
        console.warn("Failed to load local specimens for breed:", err);
      }

      setSelectedBreedSpecs(Array.from(loadedById.values()));
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
    // The form will route through /api/ai?action=suggest-species (Gemini AI audit) and land in the Curator dashboard queue.
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

  // Deep-link support (Fish Finder T4b): open a species' detail from a
  // ?species=<scientificName> deep link. Resolved by scientific name across
  // BOTH the contract catalog and the global catalog (so it works regardless
  // of the specCode-vs-on-chain-id scheme), once, and only when no detail is
  // already open.
  // A free-text query handed over from Poseidon ("look up neon tetra"). Distinct from
  // `deepLinkSpecies` above, which is an exact-scientificName jump to one species'
  // detail — this just fills the search box, which is what "search for this" means.
  // Cleared immediately so re-opening the tab doesn't re-apply a stale query.
  useEffect(() => {
    if (!pendingSpeciesSearch) return;
    setSearchTerm(pendingSpeciesSearch);
    onClearPendingSpeciesSearch?.();
  }, [pendingSpeciesSearch, setSearchTerm, onClearPendingSpeciesSearch]);

  const deepLinkHandledRef = useRef(false);
  useEffect(() => {
    if (!deepLinkSpecies || deepLinkHandledRef.current || selectedBreed) return;
    const target = String(deepLinkSpecies).toLowerCase();
    const pool = [...(speciesList || []), ...(globalRefList || [])];
    const match = pool.find(
      (b) => b?.scientificName && b.scientificName.toLowerCase() === target
    );
    if (match) {
      deepLinkHandledRef.current = true;
      setSelectedBreed(match);
      loadBreedSpecimens(match);
    }
  }, [deepLinkSpecies, speciesList, globalRefList, selectedBreed]);

  // Compatibility calculation - must be at top level (Rules of Hooks).
  // Composes the canonical fit engine (Fish Finder T2 → speciesFit.js) so this
  // widget, the Marketplace, and the Logbook always give the same verdict.
  // No bespoke scoring formula lives here anymore; unknown-range species now
  // degrade to an honest "caution" instead of being scored against fabricated
  // defaults.
  const compatibility = useMemo(() => {
    if (!selectedBreed) {
      return { score: 100, verdict: "ok", color: "hsl(120, 85%, 50%)", text: "", minVol: null, reasons: [] };
    }
    const fit = assessSpeciesFit(
      selectedBreed,
      { volume: simVolume, ph: simPh, temp: simTemp },
      { fishbaseData }
    );
    const score = fit.score;
    // Color is driven by the honest VERDICT, not the raw score: an unknown-data
    // species can score high on known axes yet still be "caution", so a
    // score-based hue would contradict the verdict/headline. (Fish Finder T2.)
    const color = VERDICT_COLOR[fit.verdict] || VERDICT_COLOR.caution;
    return {
      score,
      verdict: fit.verdict,
      color,
      text: fit.headline,
      reasons: fit.reasons,
      // Honest: null when the species has no recorded minimum volume. The old
      // `?? 30` printed a fabricated "Min ideal: 30 gal" / "need >= 30 gal" as
      // if it were the species' real requirement (Decision D3 — no fabricated
      // data). Callers must render an explicit "not recorded" state instead.
      minVol: fit.minVolumeGallons,
    };
  }, [selectedBreed, simVolume, simPh, simTemp, fishbaseData]);

  if (loading) {
    return <LoadingSkeleton variant="gallery" count={8} />;
  }

  if (error) {
    return (
      <div className="bgal">
        <div className="bgal-state bgal-state--error" role="alert">
          <WarningCircle size={28} aria-hidden="true" />
          <p className="bgal-state-text">{error}</p>
          <button type="button" onClick={() => refetchContractSpecies()} className="bgal-btn">Try again</button>
        </div>
      </div>
    );
  }

  if (selectedBreed) {
    // Casual: the care-first "can I keep this well?" detail (Fish Finder
    // Rework Task 8) replaces the breeder-flavored detail below. The Pro
    // branch beneath this early-return is untouched.
    if (casualModeActive) {
      return (
        <CasualSpeciesDetail
          breed={selectedBreed}
          fishbaseData={fishbaseData}
          contractSpecies={contractSpeciesList}
          contractAddress={contractAddress}
          marketplaceAddress={marketplaceAddress}
          walletAccount={walletAccount}
          displayTank={displayTank}
          setDisplayTank={setDisplayTank}
          onBack={() => setSelectedBreed(null)}
        />
      );
    }

    const { score, color, text, minVol, verdict, reasons } = compatibility;
    const fullProfile = fishbaseData.find(
      (f) => f.scientificName.toLowerCase() === selectedBreed.scientificName.toLowerCase()
    ) || {};
    const mode = casualModeActive ? "casual" : "pro";
    const personalityFlavorText = getPersonality(fullProfile, mode).flavorText;
    // Recorded ranges only. A global entry's flat minPh / maxPh / minTemp /
    // maxTemp fall back to display defaults, so they are never used as data
    // here (services/speciesCare.js entryCareRanges).
    const { tempRange: breedTempRange, phRange: breedPhRange } = entryCareRanges(selectedBreed);
    const breedTempText = breedTempRange
      ? formatTemperatureRange(breedTempRange[0], breedTempRange[1], tempScale.scale, { dash: " - " })
      : CARE_NOT_RECORDED;
    const breedPhText = breedPhRange ? `${breedPhRange[0]} - ${breedPhRange[1]}` : CARE_NOT_RECORDED;
    const phCheck = checkRange(simPh, breedPhRange);
    const tempCheck = checkRange(simTemp, breedTempRange);
    const checkIcon = (state) => (state === "pass" ? "🟢" : state === "fail" ? "🔴" : "⚪");
    const biotopeText = realCareText(fullProfile.ecology?.biotope);
    const hardnessText = realCareText(fullProfile.ecology?.hardnessRange);
    const tempCeiling = realCareNumber(fullProfile.ecology?.tempCeiling) ?? breedTempRange?.[1] ?? null;
    const socialText = realCareText(fullProfile.ecology?.socialBehavior);
    const spawningText = realCareText(fullProfile.reproduction?.spawningTrait);
    const layoutText = realCareText(fullProfile.reproduction?.layoutRequirement);
    const reproNotesText = realCareText(fullProfile.reproduction?.comments);
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
            <h2 style={{ fontSize: "1.75rem", fontWeight: "700", color: "var(--text-primary)", marginTop: "1rem", marginBottom: "0.25rem" }}>
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
              <strong style={{ fontSize: "0.9rem", color: breedTempRange ? "var(--text-primary)" : "var(--text-muted)" }}>
                {breedTempRange ? formatTemperatureRange(breedTempRange[0], breedTempRange[1], tempUnit, { dash: " - " }) : CARE_NOT_RECORDED}
              </strong>
            </div>
            <div>
              <span style={{ fontSize: "0.65rem", color: "var(--text-muted)", display: "block", textTransform: "uppercase" }}>pH Range</span>
              <strong style={{ fontSize: "0.9rem", color: breedPhRange ? "var(--text-primary)" : "var(--text-muted)" }}>{breedPhText}</strong>
            </div>
            <div>
              <span style={{ fontSize: "0.65rem", color: "var(--text-muted)", display: "block", textTransform: "uppercase" }}>Min Tank</span>
              <strong style={{ fontSize: "0.9rem", color: minVol != null ? "var(--accent-amber)" : "var(--text-muted)" }}>
                {minVol != null ? `${minVol} Gal` : "Not recorded"}
              </strong>
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
            border: "1px solid rgba(var(--ink-rgb), 0.13)",
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
              right: "1.5rem",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              flexWrap: "wrap",
              gap: "0.75rem",
            }}>
              <span style={{
                background: "rgba(255, 255, 255, 0.92)",
                border: "1px solid rgba(56, 189, 248, 0.35)",
                color: "var(--accent-blue)",
                padding: "0.3rem 0.75rem",
                borderRadius: "50px",
                fontSize: "0.75rem",
                fontWeight: "600",
              }}>
                🛡️ Verified Master Photo
              </span>
              <SpeciesPhotoCredit scientificName={selectedBreed.scientificName} style={{ textAlign: "right" }} />
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
                  background: "rgba(var(--ink-rgb), 0.02)"
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
                      background: showMyFishOnly ? "var(--accent-blue-glow)" : "rgba(var(--ink-rgb), 0.02)",
                      border: showMyFishOnly ? "1px solid var(--accent-blue)" : "1px solid var(--glass-border)",
                      color: showMyFishOnly ? "var(--accent-blue)" : "var(--text-secondary)",
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
                      { text: "#047857", bg: "rgba(34, 197, 94, 0.1)", border: "rgba(34, 197, 94, 0.2)" }, // Active
                      { text: "#b91c1c", bg: "rgba(239, 68, 68, 0.1)", border: "rgba(239, 68, 68, 0.2)" }, // Deceased
                      { text: "#1d4ed8", bg: "rgba(59, 130, 246, 0.1)", border: "rgba(59, 130, 246, 0.2)" }  // Rehomed
                    ];
                    const badge = statusBadgeColors[spec.status] || statusBadgeColors[0];
                    const birthDate = spec.birthTimestamp > 0 
                      ? new Date(spec.birthTimestamp * 1000).toLocaleDateString()
                      : "Wild-Caught / Unknown";

                    const customPhoto = specimenPhotos[spec.specimenId] || null;
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
                            ? "rgba(236, 253, 245, 0.92)"
                            : "rgba(240, 249, 255, 0.92)";
                          const badgeBorder = isPlant
                            ? "rgba(16, 185, 129, 0.45)"
                            : "rgba(56, 189, 248, 0.35)";
                          const badgeColor = isPlant ? "var(--accent-green)" : "var(--accent-blue)";
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
                               background: "linear-gradient(135deg, rgba(var(--ink-rgb), 0.03) 0%, rgba(var(--ink-rgb), 0.02) 100%)", 
                               backdropFilter: "blur(12px)",
                               boxShadow: "inset 0 1px 1px rgba(255, 255, 255, 0.05), 0 4px 15px rgba(var(--ink-rgb), 0.04)",
                               marginBottom: "1rem",
                               position: "relative",
                               overflow: "hidden",
                               border: "1px solid rgba(var(--ink-rgb), 0.13)",
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

                        <h3 style={{ fontSize: "1.1rem", fontWeight: "700", color: "var(--text-primary)", marginBottom: "0.75rem", marginTop: 0 }}>
                          {casualModeActive ? selectedBreed.commonName : `Cert. Serial No. ${spec.specimenId.toString().padStart(3, "0")}`}
                        </h3>

                        {editingTagId === spec.specimenId ? (
                          <div style={{ marginBottom: "0.75rem", marginTop: "-0.5rem", display: "flex", gap: "0.35rem", alignItems: "center" }}
                            onClick={(e) => e.stopPropagation()}
                          >
                            <input
                              type="text"
                              value={editingTagValue}
                              onChange={(e) => setEditingTagValue(e.target.value.slice(0, 16))}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") handleTagEditSave(e, spec);
                                if (e.key === "Escape") handleTagEditCancel(e);
                              }}
                              autoFocus
                              maxLength={16}
                              placeholder="e.g. esgIV"
                              style={{
                                fontSize: "0.7rem",
                                fontFamily: "monospace",
                                padding: "0.2rem 0.5rem",
                                borderRadius: "4px",
                                background: "rgba(168, 85, 247, 0.08)",
                                border: "1px solid rgba(168, 85, 247, 0.5)",
                                color: "var(--accent-violet)",
                                outline: "none",
                                width: "100px"
                              }}
                            />
                            <button
                              onClick={(e) => handleTagEditSave(e, spec)}
                              style={{
                                fontSize: "0.6rem",
                                padding: "0.15rem 0.4rem",
                                borderRadius: "3px",
                                background: "rgba(52, 211, 153, 0.15)",
                                border: "1px solid rgba(52, 211, 153, 0.4)",
                                color: "var(--accent-green)",
                                cursor: "pointer"
                              }}
                            >Save</button>
                            <button
                              onClick={(e) => handleTagEditCancel(e)}
                              style={{
                                fontSize: "0.6rem",
                                padding: "0.15rem 0.4rem",
                                borderRadius: "3px",
                                background: "rgba(248, 113, 113, 0.1)",
                                border: "1px solid rgba(248, 113, 113, 0.3)",
                                color: "var(--accent-red)",
                                cursor: "pointer"
                              }}
                            >Cancel</button>
                          </div>
                        ) : (
                          <div style={{ marginBottom: "0.75rem", marginTop: "-0.5rem", display: "flex", alignItems: "center", gap: "0.35rem" }}>
                            {spec.breederStockTag ? (
                              <span
                                onClick={(e) => handleTagEditStart(e, spec)}
                                title="Click to edit stock tag"
                                style={{
                                  fontSize: "0.7rem",
                                  fontWeight: "700",
                                  padding: "0.2rem 0.6rem",
                                  borderRadius: "4px",
                                  background: "rgba(168, 85, 247, 0.12)",
                                  border: "1px solid rgba(168, 85, 247, 0.35)",
                                  color: "var(--accent-violet)",
                                  fontFamily: "monospace",
                                  letterSpacing: "0.04em",
                                  cursor: "pointer",
                                  transition: "border-color 0.2s"
                                }}
                              >
                                {spec.breederStockTag}
                              </span>
                            ) : (
                              <button
                                onClick={(e) => handleTagEditStart(e, spec)}
                                title="Add breeder stock tag"
                                style={{
                                  fontSize: "0.6rem",
                                  padding: "0.15rem 0.5rem",
                                  borderRadius: "4px",
                                  background: "rgba(168, 85, 247, 0.06)",
                                  border: "1px dashed rgba(168, 85, 247, 0.3)",
                                  color: "rgba(192, 132, 252, 0.6)",
                                  cursor: "pointer",
                                  fontFamily: "monospace"
                                }}
                              >+ Tag</button>
                            )}
                          </div>
                        )}

                        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", fontSize: "0.75rem", color: "var(--text-secondary)", marginBottom: "1.25rem" }}>
                          {proMode && (
                            <div style={{ display: "flex", justifyContent: "space-between" }}>
                              <span>Owner</span>
                              <strong style={{ fontFamily: "monospace", color: "var(--text-primary)" }}>
                                {spec.owner ? `${spec.owner.substring(0, 6)}...${spec.owner.substring(38)}` : "None"}
                              </strong>
                            </div>
                          )}
                          {proMode && (
                            <div style={{ display: "flex", justifyContent: "space-between" }}>
                              <span>Breeder</span>
                              <strong style={{ fontFamily: "monospace", color: "var(--text-primary)" }}>
                                {spec.breeder && spec.breeder !== ZeroAddress 
                                  ? `${spec.breeder.substring(0, 6)}...${spec.breeder.substring(38)}` 
                                  : "Wild-Caught"}
                              </strong>
                            </div>
                          )}
                          <div style={{ display: "flex", justifyContent: "space-between" }}>
                            <span>{casualModeActive ? "Date Added" : "Birth/Hatch Date"}</span>
                            <strong style={{ color: "var(--text-primary)" }}>{birthDate}</strong>
                          </div>
                          {casualModeActive && (
                            <div style={{ display: "flex", gap: "0.35rem", flexWrap: "wrap", marginTop: "0.25rem" }}>
                              <span style={{
                                fontSize: "0.6rem",
                                padding: "0.2rem 0.5rem",
                                borderRadius: "20px",
                                background: "rgba(34, 197, 94, 0.12)",
                                border: "1px solid rgba(34, 197, 94, 0.3)",
                                color: "var(--accent-green)",
                                fontWeight: "700"
                              }}>✅ Registry Verified</span>
                              {spec.status === 0 && (
                                <span style={{
                                  fontSize: "0.6rem",
                                  padding: "0.2rem 0.5rem",
                                  borderRadius: "20px",
                                  background: "rgba(56, 189, 248, 0.12)",
                                  border: "1px solid rgba(56, 189, 248, 0.3)",
                                  color: "var(--accent-blue)",
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
              <div className="glass-card" style={{ padding: "1.5rem 2rem", background: "rgba(var(--ink-rgb), 0.02)", border: "1px solid rgba(var(--ink-rgb), 0.09)" }}>
                <h3 style={{ fontSize: "1.15rem", fontWeight: "600", color: "var(--text-primary)", marginBottom: "1.5rem", fontFamily: "'Outfit', sans-serif" }}>
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
              <div className="glass-card" style={{ padding: "1.5rem 2rem", background: "rgba(var(--ink-rgb), 0.02)", border: "1px solid rgba(var(--ink-rgb), 0.09)" }}>
                <h3 style={{ fontSize: "1.15rem", fontWeight: "600", color: "var(--text-primary)", marginBottom: "1.5rem", fontFamily: "'Outfit', sans-serif" }}>
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
                background: "rgba(var(--ink-rgb), 0.02)",
                border: "1px solid rgba(var(--ink-rgb), 0.1)",
                display: "flex",
                flexDirection: "column",
                gap: "1.25rem"
              }}
            >
              <h3 style={{ fontSize: "1.2rem", fontWeight: "700", color: "var(--text-primary)", margin: 0, display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <span>🎮</span> {casualModeActive ? "Tank Match" : "Simulate My Tank"}
              </h3>

              {/* Match Score Display Panel */}
              <div 
                style={{ 
                  display: "flex", 
                  alignItems: "center", 
                  gap: "1rem", 
                  padding: "1rem", 
                  background: "var(--bg-band)", 
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
                      stroke="rgba(11,37,48,0.09)" 
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
                    {verdict === "ok"
                      ? (casualModeActive ? (score === 100 ? "✅ 100% Compatibility Match" : "👍 Good for your tank!") : "Good Match")
                      : verdict === "blocked"
                        ? (casualModeActive ? "🚫 Not a safe fit" : "Warning")
                        : (casualModeActive ? "⚠️ Proceed with caution" : "Caution")}
                  </strong>
                  {casualModeActive && verdict === "ok" && score === 100 && (
                    <span style={{ display: "inline-block", marginTop: "0.4rem", fontSize: "0.6rem", padding: "0.2rem 0.6rem", borderRadius: "20px", background: "rgba(34,197,94,0.15)", border: "1px solid rgba(34,197,94,0.4)", color: "var(--accent-green)", fontWeight: "700", letterSpacing: "0.03em" }}>
                      [ Perfect Aquarium Fit ]
                    </span>
                  )}
                </div>
              </div>

              {/* Feedback description */}
              <p style={{ fontSize: "0.75rem", color: "var(--text-secondary)", margin: 0, lineHeight: "1.4" }}>
                {text}
              </p>

              {/* Honest per-parameter reasons from the canonical fit engine
                  (why the verdict is what it is — e.g. an unknown minimum tank
                  size, or which water parameter is off). Fish Finder T2. */}
              {Array.isArray(reasons) && reasons.length > 0 && (
                <ul style={{ margin: "0.5rem 0 0", padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: "0.3rem" }}>
                  {reasons.map((reason, i) => (
                    <li key={i} style={{ fontSize: "0.7rem", color: "var(--text-muted)", lineHeight: "1.35", display: "flex", gap: "0.4rem" }}>
                      <span aria-hidden="true" style={{ color, flexShrink: 0 }}>{verdict === "ok" ? "✓" : "•"}</span>
                      <span>{reason}</span>
                    </li>
                  ))}
                </ul>
              )}

              {/* Sliders Container */}
              <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem", borderTop: "1px solid rgba(var(--ink-rgb), 0.1)", paddingTop: "1.25rem" }}>
                
                {/* Tank Size Slider */}
                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.75rem", marginBottom: "0.4rem" }}>
                    <span style={{ color: "var(--text-secondary)" }}>Tank Size</span>
                    <strong style={{ color: "var(--text-primary)" }}>{simVolume} Gal</strong>
                  </div>
                  <input 
                    type="range" 
                    min="5" 
                    max="300" 
                    step="5"
                    value={simVolume} 
                    onChange={(e) => setSimVolume(Number(e.target.value))}
                    className="premium-slider"
                  />
                  <div style={{ fontSize: "0.65rem", color: "var(--text-muted)", marginTop: "0.25rem", display: "flex", justifyContent: "space-between" }}>
                    <span>5 gal</span>
                    {minVol != null && <span>Min ideal: {minVol} gal</span>}
                    <span>300 gal</span>
                  </div>
                </div>

                {/* pH Slider */}
                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.75rem", marginBottom: "0.4rem" }}>
                    <span style={{ color: "var(--text-secondary)" }}>Water pH</span>
                    <strong style={{ color: "var(--text-primary)" }}>{simPh}</strong>
                  </div>
                  <input 
                    type="range" 
                    min="4.0" 
                    max="10.0" 
                    step="0.1"
                    value={simPh} 
                    onChange={(e) => setSimPh(Number(e.target.value))}
                    className="premium-slider"
                  />
                  <div style={{ fontSize: "0.65rem", color: "var(--text-muted)", marginTop: "0.25rem", display: "flex", justifyContent: "space-between" }}>
                    <span>4.0 pH</span>
                    <span>Ideal: {breedPhText}</span>
                    <span>10.0 pH</span>
                  </div>
                </div>

                {/* Temperature Slider */}
                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.75rem", marginBottom: "0.4rem" }}>
                    <span style={{ color: "var(--text-secondary)" }}>Temperature</span>
                    <strong style={{ color: "var(--text-primary)" }}>{tempScale.convert(simTemp).toFixed(1)} {tempScale.suffix}</strong>
                  </div>
                  <input 
                    type="range" 
                    min="15.0" 
                    max="35.0" 
                    step="0.5"
                    value={simTemp} 
                    onChange={(e) => setSimTemp(Number(e.target.value))}
                    className="premium-slider"
                  />
                  <div style={{ fontSize: "0.65rem", color: "var(--text-muted)", marginTop: "0.25rem", display: "flex", justifyContent: "space-between" }}>
                    {/* The slider's domain stays 15–35 °C; only these end labels
                        are converted, so the input value never changes meaning. */}
                    <span>{tempScale.convert(15).toFixed(1)} {tempScale.suffix}</span>
                    <span>Ideal: {breedTempText}</span>
                    <span>{tempScale.convert(35).toFixed(1)} {tempScale.suffix}</span>
                  </div>
                </div>

              </div>
            </div>

            {/* Checklist telemetry card */}
            <div 
              className="glass-card" 
              style={{ 
                padding: "1.25rem", 
                background: "rgba(var(--ink-rgb), 0.02)",
                border: "1px solid rgba(var(--ink-rgb), 0.08)",
                display: "flex",
                flexDirection: "column",
                gap: "0.75rem"
              }}
            >
              <h4 style={{ fontSize: "0.85rem", fontWeight: "700", color: "var(--text-primary)", textTransform: "uppercase", letterSpacing: "0.05em", margin: 0 }}>
                Parameter Check
              </h4>
              <ul style={{ listStyle: "none", fontSize: "0.75rem", display: "flex", flexDirection: "column", gap: "0.5rem", padding: 0, margin: 0 }}>
                {/* Volume check. With no recorded minimum we say so rather than
                    scoring against a fabricated default (Decision D3). */}
                <li style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                  <span>{minVol == null ? "⚪" : (simVolume >= minVol ? "🟢" : "🔴")}</span>
                  <span style={{ color: minVol != null && simVolume >= minVol ? "var(--text-primary)" : "var(--text-muted)" }}>
                    {minVol == null
                      ? "Minimum volume not recorded for this species"
                      : (simVolume >= minVol ? `Volume is sufficient (>= ${minVol} gal)` : `Volume too low (need >= ${minVol} gal)`)}
                  </span>
                </li>
                {/* pH and temperature: a species with no recorded range is
                    "not recorded", never a pass against a default. */}
                <li style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                  <span>{checkIcon(phCheck)}</span>
                  <span style={{ color: phCheck === "pass" ? "var(--text-primary)" : "var(--text-muted)" }}>
                    {phCheck === "unknown"
                      ? "pH range not recorded for this species"
                      : phCheck === "pass"
                        ? `pH is within safe limits (${breedPhText})`
                        : `pH is out of range (${breedPhText})`}
                  </span>
                </li>
                <li style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                  <span>{checkIcon(tempCheck)}</span>
                  <span style={{ color: tempCheck === "pass" ? "var(--text-primary)" : "var(--text-muted)" }}>
                    {tempCheck === "unknown"
                      ? "Temperature range not recorded for this species"
                      : tempCheck === "pass"
                        ? `Temp is within safe limits (${breedTempText})`
                        : `Temp is out of range (${breedTempText})`}
                  </span>
                </li>
              </ul>
            </div>

            {/* Verified Safe Companions */}
            <div 
              className="glass-card" 
              style={{ 
                padding: "1.25rem", 
                background: "rgba(var(--ink-rgb), 0.02)",
                border: "1px solid rgba(var(--ink-rgb), 0.08)",
                display: "flex",
                flexDirection: "column",
                gap: "0.75rem"
              }}
            >
              <h4 style={{ fontSize: "0.85rem", fontWeight: "700", color: "var(--text-primary)", textTransform: "uppercase", letterSpacing: "0.05em", margin: 0 }}>
                Verified Safe Companions
              </h4>
              {(() => {
                const companions = fishbaseData.filter((item) => {
                  if (item.scientificName.toLowerCase() === selectedBreed.scientificName.toLowerCase()) {
                    return false;
                  }
                  // "Verified" means both ranges are on record and match. A
                  // companion with no recorded pH or temperature is left out,
                  // never matched against a default range.
                  const phRange = realRange(item.tankMetrics?.phRange?.[0], item.tankMetrics?.phRange?.[1]);
                  const tempRange = realRange(item.tankMetrics?.tempRangeCelsius?.[0], item.tankMetrics?.tempRangeCelsius?.[1]);
                  return checkRange(simPh, phRange, 0.3) === "pass" && checkRange(simTemp, tempRange, 2.0) === "pass";
                });

                if (companions.length === 0) {
                  return (
                    <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", margin: 0, fontStyle: "italic" }}>
                      No compatible companions found.
                    </p>
                  );
                }

                return (
                  <ScrollFade
                    focusable
                    role="group"
                    aria-label="Compatible tankmates"
                    style={{
                      display: "flex",
                      gap: "0.75rem",
                      overflowX: "auto",
                      paddingBottom: "0.5rem",
                      scrollbarWidth: "thin",
                      scrollbarColor: "rgba(var(--ink-rgb), 0.15) transparent"
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
                            : "rgba(var(--ink-rgb), 0.02)", 
                          border: `1px solid ${isPlantEntry(comp) ? "rgba(16,185,129,0.15)" : "rgba(var(--ink-rgb), 0.1)"}`, 
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
                        <span style={{ fontSize: "0.7rem", fontWeight: "600", color: isPlantEntry(comp) ? "var(--accent-green)" : "var(--text-primary)", display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", width: "100%" }} title={comp.commonName}>
                          {comp.commonName}
                        </span>
                        <span style={{ fontSize: "0.55rem", color: "var(--text-muted)", fontStyle: "italic", display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", width: "100%" }} title={comp.scientificName}>
                          {comp.scientificName}
                        </span>
                        <span style={{ fontSize: "0.55rem", color: isPlantEntry(comp) ? "var(--accent-green)" : "var(--accent-blue)", marginTop: "0.15rem" }}>
                          {isPlantEntry(comp) ? "🌿 Flora" : `pH ${comp.tankMetrics?.phRange?.[0]}-${comp.tankMetrics?.phRange?.[1]}`}
                        </span>
                      </div>
                    ))}
                  </ScrollFade>
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
              background: "rgba(var(--ink-rgb), 0.02)", 
              border: "1px solid rgba(var(--ink-rgb), 0.11)", 
              padding: "1.25rem", 
              borderRadius: "1rem",
              display: "flex",
              flexDirection: "column",
              gap: "1.25rem"
            }}
          >
            <h3 style={{ fontSize: "1.2rem", fontWeight: "700", color: "var(--text-primary)", margin: 0, display: "flex", alignItems: "center", gap: "0.5rem" }}>
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
            <div className="species-detail__tabs">
              <button 
                className={`species-detail__tab${activeInfoTab === "care" ? " active" : ""}`}
                onClick={() => setActiveInfoTab("care")}
              >
                Care Blueprint
              </button>
              <button 
                className={`species-detail__tab${activeInfoTab === "diet" ? " active" : ""}`}
                onClick={() => setActiveInfoTab("diet")}
              >
                Diet & Nutrition
              </button>
              <button 
                className={`species-detail__tab${activeInfoTab === "breeding" ? " active" : ""}`}
                onClick={() => setActiveInfoTab("breeding")}
              >
                Breeding Profile
              </button>
              <button 
                className={`species-detail__tab${activeInfoTab === "insights" ? " active" : ""}`}
                onClick={() => setActiveInfoTab("insights")}
              >
                {casualModeActive ? "💡 Tips" : "Insights"}
              </button>
            </div>

            {/* Tab Contents */}
            {activeInfoTab === "care" && (
              <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
                {biotopeText && (
                  <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                    <span style={{ fontSize: "0.75rem", color: "var(--text-muted)", textTransform: "uppercase", fontWeight: "600" }}>Biotope Origin</span>
                    <p style={{ fontSize: "0.85rem", color: "var(--text-secondary)", lineHeight: "1.4" }}>
                      {biotopeText}
                    </p>
                  </div>
                )}

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
                  <div>
                    <span style={{ fontSize: "0.75rem", color: "var(--text-muted)", textTransform: "uppercase", fontWeight: "600", display: "block", marginBottom: "0.25rem" }}>Water Hardness</span>
                    {hardnessText ? (
                      <span className="badge badge-blue" style={{ fontSize: "0.8rem", padding: "0.35rem 0.75rem" }}>
                        {hardnessText}
                      </span>
                    ) : (
                      <span style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>{CARE_NOT_RECORDED}</span>
                    )}
                  </div>
                  <div>
                    <span style={{ fontSize: "0.75rem", color: "var(--text-muted)", textTransform: "uppercase", fontWeight: "600", display: "block", marginBottom: "0.25rem" }}>Temp Ceiling</span>
                    {tempCeiling != null ? (
                      <span className="badge badge-red" style={{ fontSize: "0.8rem", padding: "0.35rem 0.75rem" }}>
                        Up to {formatTemperature(tempCeiling, tempScale.scale, { precision: 0 })}
                      </span>
                    ) : (
                      <span style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>{CARE_NOT_RECORDED}</span>
                    )}
                  </div>
                </div>

                <div>
                  <span style={{ fontSize: "0.75rem", color: "var(--text-muted)", textTransform: "uppercase", fontWeight: "600", display: "block", marginBottom: "0.25rem" }}>pH Envelope</span>
                  {breedPhRange ? (
                    <span className="badge badge-green" style={{ fontSize: "0.8rem", padding: "0.35rem 0.75rem" }}>
                      {breedPhText} pH
                    </span>
                  ) : (
                    <span style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>{CARE_NOT_RECORDED}</span>
                  )}
                </div>

                {socialText && <div style={{ 
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
                    {socialText}
                  </p>
                </div>}
              </div>
            )}

            {activeInfoTab === "diet" && (
              <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: "0.75rem", color: "var(--text-muted)", textTransform: "uppercase", fontWeight: "600" }}>Trophic Level</span>
                  {realDietText(fullProfile.diet?.trophicLevel) ? (
                    <span className={`badge ${
                      isCarnivoreTrophic(fullProfile.diet.trophicLevel) ? "badge-red" :
                      isHerbivoreTrophic(fullProfile.diet.trophicLevel) ? "badge-green" : "badge-blue"
                    }`} style={{ fontSize: "0.8rem" }}>
                      {realDietText(fullProfile.diet.trophicLevel)}
                    </span>
                  ) : (
                    <span style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>{DIET_NOT_RECORDED}</span>
                  )}
                </div>

                {realDietText(fullProfile.diet?.fooditems) && (
                  <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                    <span style={{ fontSize: "0.75rem", color: "var(--text-muted)", textTransform: "uppercase", fontWeight: "600" }}>Wild Food Items</span>
                    <p style={{ fontSize: "0.85rem", color: "var(--text-secondary)", lineHeight: "1.4" }}>
                      {realDietText(fullProfile.diet.fooditems)}
                    </p>
                  </div>
                )}

                {realDietText(fullProfile.diet?.feedingPlaybook) && <div style={{ 
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
                    {realDietText(fullProfile.diet.feedingPlaybook)}
                  </p>
                </div>}
              </div>
            )}

            {activeInfoTab === "breeding" && (
              <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: "0.75rem", color: "var(--text-muted)", textTransform: "uppercase", fontWeight: "600" }}>Spawning Trait</span>
                  {spawningText ? (
                    <span className="badge badge-amber" style={{ fontSize: "0.8rem" }}>
                      {spawningText}
                    </span>
                  ) : (
                    <span style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>{CARE_NOT_RECORDED}</span>
                  )}
                </div>

                {layoutText && <div style={{ 
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
                    {layoutText}
                  </p>
                </div>}

                {reproNotesText && (
                  <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                    <span style={{ fontSize: "0.75rem", color: "var(--text-muted)", textTransform: "uppercase", fontWeight: "600" }}>Biological Reproduction Notes</span>
                    <p style={{ fontSize: "0.85rem", color: "var(--text-secondary)", lineHeight: "1.4" }}>
                      {reproNotesText}
                    </p>
                  </div>
                )}

                {/* Sexing sits in the reproduction tab because that is the decision
                    it serves: you cannot pair what you cannot sex. Shown even when
                    undocumented here — a breeder needs to know the gap is ours
                    before planning around it. */}
                <SexingGuide record={fullProfile} casual={casualModeActive} />
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

  // One tab row for the catalog views. Each `activate` is the exact body the
  // old toggle button ran on click; keyboard moves call the same function.
  const viewTabs = proMode
    ? [
        {
          id: "mine",
          label: "In my tanks",
          count: residingSpecies.length,
          Icon: FishSimple,
          selected: viewMode === "contract" && showMyTankSpeciesOnly,
          activate: () => {
            setViewMode("contract");
            setShowMyTankSpeciesOnly(true);
            setSelectedBreed(null);
            setSearchTerm("");
          },
        },
        {
          id: "registered",
          label: "Registered breeds",
          count: speciesList.length,
          Icon: Certificate,
          selected: viewMode === "contract" && !showMyTankSpeciesOnly,
          activate: () => {
            setViewMode("contract");
            setShowMyTankSpeciesOnly(false);
            setSelectedBreed(null);
            setSearchTerm("");
          },
        },
        {
          id: "all",
          label: "All species",
          Icon: GlobeHemisphereWest,
          selected: viewMode === "global",
          activate: () => {
            setViewMode("global");
            setSelectedBreed(null);
            setSearchTerm("");
          },
        },
      ]
    : [
        {
          id: "collection",
          label: "My collection",
          count: residingSpecies.length,
          Icon: FishSimple,
          selected: viewMode === "contract",
          activate: () => {
            setViewMode("contract");
            setSelectedBreed(null);
            setSearchTerm("");
          },
        },
        {
          id: "all",
          label: "All species",
          Icon: GlobeHemisphereWest,
          selected: viewMode === "global",
          activate: () => {
            setViewMode("global");
            setSelectedBreed(null);
            setSearchTerm("");
          },
        },
      ];
  // Gated on the server-authoritative keeper role, OR on holding the
  // on-chain curator address. `isCurator` alone matched only the deployer
  // wallet (0xc42e…c934), so neither founder could ever open this tab,
  // the same class of bug as the Hardhat allowlist in BreedersCouncil.
  if (isCouncilMember || isCurator) {
    viewTabs.push({
      id: "review",
      label: "Review queue",
      Icon: ClipboardText,
      selected: viewMode === "curation",
      activate: () => {
        setViewMode("curation");
        setSelectedBreed(null);
        setSearchTerm("");
      },
    });
  }
  const selectedViewIndex = viewTabs.findIndex((t) => t.selected);
  const activeViewIndex = selectedViewIndex < 0 ? 0 : selectedViewIndex;
  const activeViewTabId = viewTabs[activeViewIndex].id;
  const handleViewTabKeyDown = (e) => {
    const next = nextTabIndex(e.key, activeViewIndex, viewTabs.length);
    if (next === null) return;
    e.preventDefault();
    viewTabs[next].activate();
    e.currentTarget.querySelectorAll('[role="tab"]')[next]?.focus();
  };
  const filtersActive = filters.type !== "All" || filters.difficulty !== "All" || filters.tempBucket !== "All" || filters.phBucket !== "All";

  return (
    <div className="bgal">
      {/* Toast notification */}
      {toastMessage && (
        <div className="inline-toast">
          {toastMessage}
        </div>
      )}
      {/* Pro only: in Casual, Fish Finder already titles this section. */}
      {proMode && (
        <header className="bgal-head">
          <div className="bgal-head-text">
            <p className="bgal-kicker">Breeding</p>
            <h2 className="bgal-title">Breed Gallery</h2>
            <p className="bgal-subtitle">
              Registered breeds, the species in your tanks, and the full species catalog.
            </p>
          </div>
        </header>
      )}

      <div className="bgal-toolbar">
        <div
          className="bgal-tabs"
          role="tablist"
          aria-label="Catalog views"
          onKeyDown={handleViewTabKeyDown}
        >
          {viewTabs.map(({ id, label, count, Icon, selected, activate }, index) => (
            <button
              key={id}
              type="button"
              role="tab"
              id={`bgal-view-tab-${id}`}
              aria-selected={selected}
              aria-controls="bgal-view-panel"
              tabIndex={index === activeViewIndex ? 0 : -1}
              className="bgal-tab"
              onClick={activate}
            >
              <Icon size={18} weight={selected ? "fill" : "regular"} aria-hidden="true" />
              <span>{label}</span>
              {count !== undefined && <span className="bgal-tab-count">{count}</span>}
            </button>
          ))}
        </div>

        <div className="bgal-search-row">
          <div className="bgal-search">
            <input
              type="text"
              className={`bgal-search-input${isParsing ? " bgal-search-input--busy" : ""}`}
              aria-label="Search species"
              placeholder={casualModeActive ? "Try: 'beginner fish for warm water'" : "Search species or describe what you need"}
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
            />
            {isParsing && (
              <span className="bgal-search-busy" role="status">
                <SpinnerGap className="bgal-spin" size={16} aria-hidden="true" />
                <span className="bgal-sr-only">Reading your search</span>
              </span>
            )}
            {searchTerm ? (
              <button
                type="button"
                className="bgal-search-clear"
                aria-label="Clear search"
                onClick={() => { setSearchTerm(""); clearParsed(); }}
              >
                <X size={16} aria-hidden="true" />
              </button>
            ) : (
              <MagnifyingGlass className="bgal-search-icon" size={16} aria-hidden="true" />
            )}
          </div>
          {!casualModeActive && (
            <button
              type="button"
              onClick={() => setIsSuggestModalOpen(true)}
              className="bgal-btn bgal-btn--soft"
            >
              <Plus size={16} weight="bold" aria-hidden="true" />
              Suggest a species
            </button>
          )}
        </div>
      </div>

      {/* Picture drop bar: upload a photo for species identification */}
      <div
        className={`bgal-drop${galleryDropPhoto ? " bgal-drop--filled" : ""}`}
        onClick={() => !galleryDropPhoto && galleryPhotoInputRef.current?.click()}
        onKeyDown={(e) => {
          if (galleryDropPhoto) return;
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            galleryPhotoInputRef.current?.click();
          }
        }}
        onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add("bgal-drop--over"); }}
        onDragLeave={(e) => { e.currentTarget.classList.remove("bgal-drop--over"); }}
        onDrop={(e) => {
          e.preventDefault();
          e.currentTarget.classList.remove("bgal-drop--over");
          const file = e.dataTransfer.files?.[0];
          if (file && file.type.startsWith("image/")) {
            setGalleryDropPhoto({ preview: URL.createObjectURL(file) });
          }
        }}
        role={galleryDropPhoto ? undefined : "button"}
        tabIndex={galleryDropPhoto ? undefined : 0}
        aria-label={galleryDropPhoto ? undefined : (casualModeActive ? "Drop or tap to add a photo" : "Upload a reference photo")}
      >
        {galleryDropPhoto ? (
          <>
            <img
              src={galleryDropPhoto.preview}
              alt="Uploaded reference"
              className="bgal-drop-thumb"
            />
            <span className="bgal-drop-done">Photo added</span>
            <button
              type="button"
              className="bgal-btn"
              aria-label="Remove photo"
              onClick={(e) => {
                e.stopPropagation();
                setGalleryDropPhoto(null);
                if (galleryPhotoInputRef.current) galleryPhotoInputRef.current.value = "";
              }}
            >
              Remove
            </button>
          </>
        ) : (
          <>
            <Camera size={22} aria-hidden="true" />
            <span className="bgal-drop-text">
              {casualModeActive ? "Drop or tap to add a picture" : "Drop an image or click to upload a reference photo"}
            </span>
          </>
        )}
        <input
          ref={galleryPhotoInputRef}
          type="file"
          accept="image/*"
          className="bgal-drop-input"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) {
              setGalleryDropPhoto({ preview: URL.createObjectURL(file) });
            }
          }}
        />
      </div>

      {/* Residing species shortcuts */}
      {residingSpecies.length > 0 && (
        <div className="bgal-chips">
          <span className="bgal-chips-label">
            <FishSimple size={14} weight="fill" aria-hidden="true" />
            In your tanks
          </span>
          <div className="bgal-chips-list">
            {residingSpecies.map((item) => {
              const isBadgeSelected = selectedBreed && Number(selectedBreed.speciesId) === Number(item.id);
              return (
                <button
                  key={`badge-${item.id}`}
                  type="button"
                  className={`bgal-chip${isBadgeSelected ? " bgal-chip--current" : ""}`}
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
                >
                  {item.name} <span className="bgal-chip-count">({item.count})</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div role="tabpanel" id="bgal-view-panel" aria-labelledby={`bgal-view-tab-${activeViewTabId}`}>
      {viewMode === "curation" ? (
        <CurationQueuePanel
          walletAccount={walletAccount}
          suggestionsQuery={suggestionsQuery}
          castVote={castVote}
          isVoting={isVoting}
          promoteSpecies={promoteSpecies}
          isPromoting={isPromoting}
          CARE_LEVEL_STRINGS={CARE_LEVEL_STRINGS}
          marketplaceAddress={marketplaceAddress}
        />
      ) : loading || (viewMode === "global" && !globalData) ? (
        <div className="bgal-state" role="status">
          <p className="bgal-state-text">
            {viewMode === "contract" ? "Loading registered breeds…" : "Loading the species catalog…"}
          </p>
        </div>
      ) : error ? (
        <div className="bgal-state bgal-state--error" role="alert">
          <WarningCircle size={28} aria-hidden="true" />
          <p className="bgal-state-text">{error}</p>
          <button type="button" onClick={refetchContractSpecies} className="bgal-btn">Try again</button>
        </div>
      ) : filteredSpecies.length === 0 ? (
        <div className="bgal-state">
          <p className="bgal-state-text">No species registered in the catalog yet.</p>
        </div>
      ) : (
        <div className="bgal-results">
          {/* Poseidon NL Search explanation chip */}
          {nlExplanation && nlExplanation !== 'Parsed locally' && (
            <div className="bgal-nl-chip">
              <img src="/echo/face.webp" alt="" />
              <span>{nlExplanation}</span>
              <button
                type="button"
                aria-label="Clear this search"
                onClick={() => { resetFilters(); clearParsed(); setSearchTerm(""); }}
              >
                <X size={14} aria-hidden="true" />
              </button>
            </div>
          )}

          {/* Filter Toggle Button */}
          <button
            type="button"
            onClick={() => setFiltersOpen(!filtersOpen)}
            className="bgal-filter-toggle"
            aria-expanded={filtersOpen}
            aria-controls="bgal-filter-panel"
          >
            <span className="bgal-filter-toggle-label">
              <SlidersHorizontal size={18} aria-hidden="true" />
              <span>{casualModeActive ? "Filter fish" : "Filters"}</span>
              {filtersActive && (
                <span className="bgal-filter-on">On</span>
              )}
            </span>
            <CaretDown className="bgal-filter-caret" size={16} weight="bold" aria-hidden="true" />
          </button>

          {/* Mobile filter backdrop */}
          {filtersOpen && (
            <div 
              className="breed-filter-backdrop"
              onClick={() => setFiltersOpen(false)}
            />
          )}

          {/* Collapsible filter panel, a bottom sheet on phones */}
          <div id="bgal-filter-panel" className={`breed-filter-panel ${filtersOpen ? "breed-filter-panel--open" : ""}`} style={{
            maxHeight: filtersOpen ? "600px" : "0px",
            overflow: "hidden",
            transition: "max-height 0.4s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.3s ease",
            opacity: filtersOpen ? 1 : 0,
          }}>
          <div className="bgal-filters">
            <div className="bgal-filters-head">
              <h3 className="bgal-filters-title">Filters</h3>
              <button type="button" onClick={resetFilters} className="bgal-linkbtn">
                Reset all
              </button>
            </div>

            {/* Category / Type Filter */}
            {availableFacets.type && (
              <div className="bgal-filter-group" role="group" aria-labelledby="bgal-filter-label-type">
                <span id="bgal-filter-label-type" className="bgal-filter-label">
                  Category
                </span>
                <div className="bgal-filter-options">
                  {[
                    { val: "All", label: "All" },
                    { val: "Fish", label: "Fish" },
                    { val: "Plant", label: "Plants" },
                    { val: "Coral", label: "Corals" },
                    { val: "Invertebrate", label: "Inverts" }
                  ].filter(opt => opt.val === "All" || opt.val === "Fish" || opt.val === "Plant" || (facets.type[opt.val] || 0) > 0).map(opt => {
                    const isActive = filters.type === opt.val;
                    const count = facets.type[opt.val] || 0;
                    return (
                      <button
                        key={opt.val}
                        type="button"
                        onClick={() => setFilters(prev => ({ ...prev, type: opt.val }))}
                        className="bgal-chip"
                        aria-pressed={isActive}
                      >
                        {opt.label} <span className="bgal-chip-count">({count})</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Care Level Difficulty Filter */}
            {availableFacets.difficulty && (
              <div className="bgal-filter-group" role="group" aria-labelledby="bgal-filter-label-difficulty">
                <span id="bgal-filter-label-difficulty" className="bgal-filter-label">
                  Care level
                </span>
                <div className="bgal-filter-options">
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
                        type="button"
                        onClick={() => setFilters(prev => ({ ...prev, difficulty: opt.val }))}
                        className="bgal-chip"
                        aria-pressed={isActive}
                      >
                        {opt.label} <span className="bgal-chip-count">({count})</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Temperature Range Filter */}
            {availableFacets.temp && (
              <div className="bgal-filter-group" role="group" aria-labelledby="bgal-filter-label-temp">
                <span id="bgal-filter-label-temp" className="bgal-filter-label">
                  Temperature
                </span>
                <div className="bgal-filter-options">
                  {[
                    { val: "All", label: "All" },
                    // The 22/28 °C bucket boundaries are the filter's own logic and
                    // stay in Celsius; only the labels follow the preference.
                    { val: "Cold", label: `Cold (<${formatTemperature(22, tempScale.scale, { precision: 0 })})` },
                    { val: "Tropical", label: `Tropical (${formatTemperatureRange(22, 28, tempScale.scale, { dash: "-" })})` },
                    { val: "Warm", label: `Warm (>${formatTemperature(28, tempScale.scale, { precision: 0 })})` }
                  ].map(opt => {
                    const isActive = filters.tempBucket === opt.val;
                    const count = facets.temp[opt.val] || 0;
                    return (
                      <button
                        key={opt.val}
                        type="button"
                        onClick={() => setFilters(prev => ({ ...prev, tempBucket: opt.val }))}
                        className="bgal-chip"
                        aria-pressed={isActive}
                      >
                        {opt.label} <span className="bgal-chip-count">({count})</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* pH Range Filter */}
            {availableFacets.ph && (
              <div className="bgal-filter-group" role="group" aria-labelledby="bgal-filter-label-ph">
                <span id="bgal-filter-label-ph" className="bgal-filter-label">
                  pH
                </span>
                <div className="bgal-filter-options">
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
                        type="button"
                        onClick={() => setFilters(prev => ({ ...prev, phBucket: opt.val }))}
                        className="bgal-chip"
                        aria-pressed={isActive}
                      >
                        {opt.label} <span className="bgal-chip-count">({count})</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Biotope Origin Filter */}
            {availableFacets.origin && (
              <div className="bgal-filter-group" role="group" aria-labelledby="bgal-filter-label-origin">
                <span id="bgal-filter-label-origin" className="bgal-filter-label">
                  Natural habitat
                </span>
                <div className="bgal-filter-options bgal-filter-options--stack">
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
                        type="button"
                        onClick={() => setFilters(prev => ({ ...prev, origin: opt.val }))}
                        className="bgal-chip"
                        aria-pressed={isActive}
                      >
                        <span>{opt.label}</span>
                        <span className="bgal-chip-count">({count})</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
          {/* Phone "Show results" button, inside the sheet (index.css shows it at 640px and below) */}
          <button
            type="button"
            className="breed-filter-apply-btn bgal-btn bgal-btn--primary"
            onClick={() => setFiltersOpen(false)}
          >
            Show {filteredSpecies.length} results
          </button>
          </div>
          <div style={{ width: "100%" }}>
            {filteredSpecies.length === 0 ? (
              showMyTankSpeciesOnly && residingSpecies.length === 0 ? (
                <div className="bgal-empty">
                  <span className="bgal-empty-icon" aria-hidden="true">
                    <FishSimple size={28} weight="duotone" />
                  </span>
                  <h3 className="bgal-empty-title">No fish in your tanks yet</h3>
                  <p className="bgal-empty-lead">
                    When your aquariums have fish in them, their species show up here. Register a fish in Breeder Tools to start a pedigree line.
                  </p>
                  <button
                    type="button"
                    onClick={() => { window.location.hash = "breeder"; }}
                    className="bgal-btn bgal-btn--primary"
                  >
                    Register a fish
                  </button>
                </div>
              ) : showMyTankSpeciesOnly ? (
                <div className="bgal-empty">
                  <span className="bgal-empty-icon" aria-hidden="true">
                    <MagnifyingGlass size={28} weight="duotone" />
                  </span>
                  <h3 className="bgal-empty-title">None of your tank species match</h3>
                  <p className="bgal-empty-lead">
                    Nothing in your tanks matches this search or these filters.
                  </p>
                  <div className="bgal-empty-actions">
                    <button
                      type="button"
                      onClick={() => { resetFilters(); clearParsed(); setSearchTerm(""); }}
                      className="bgal-btn"
                    >
                      Clear search and filters
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowMyTankSpeciesOnly(false)}
                      className="bgal-btn bgal-btn--primary"
                    >
                      Show all registered breeds
                    </button>
                  </div>
                </div>
              ) : (
                <div className="bgal-empty">
                  <span className="bgal-empty-icon" aria-hidden="true">
                    <MagnifyingGlass size={28} weight="duotone" />
                  </span>
                  <h3 className="bgal-empty-title">No species match</h3>
                  <p className="bgal-empty-lead">
                    Nothing matches this search or these filters.
                  </p>
                  <div className="bgal-empty-actions">
                    <button
                      type="button"
                      onClick={() => { resetFilters(); clearParsed(); setSearchTerm(""); }}
                      className="bgal-btn"
                    >
                      Clear search and filters
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsSuggestModalOpen(true)}
                      className="bgal-btn bgal-btn--primary"
                    >
                      Suggest a species
                    </button>
                  </div>
                </div>
              )
            ) : (
              <div 
                ref={parentRefCallback}
                className={"bgal-grid-scroller" + (starryBgActive ? " starry-grid-overlay" : "")}
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
                          {row.map((breed) => {
                            const residingInfo = residingSpecies.find(r => Number(r.id) === Number(breed.speciesId));
                            const ownedCount = residingInfo ? residingInfo.count : 0;
                            const isOwned = ownedCount > 0;

                            return (
                              <SpeciesCardPremium
                                key={breed.speciesId}
                                breed={breed}
                                fishbaseData={fishbaseData}
                                casualModeActive={casualModeActive}
                                isOwned={isOwned}
                                ownedCount={ownedCount}
                                viewMode={viewMode}
                                searchTerm={searchTerm}
                                magikarpEvolved={magikarpEvolved}
                                onSelect={() => {
                                  setSelectedBreed(breed);
                                  if (viewMode !== "global") {
                                    loadBreedSpecimens(breed);
                                  }
                                }}
                                onEasterEgg={(config) => setActiveLoreEgg(config)}
                              />
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
                {visibleCount < filteredSpecies.length && (
                  <div className="bgal-grid-more">
                    <div className="shimmer-placeholder" />
                  </div>
                )}
              </div>
            )}
          </div>
          </div>
        )}
      </div>

      {notification && (
        <div className="bgal-toast" role="status">
          <strong>Suggestion sent</strong>
          <span>{notification.message}</span>
        </div>
      )}

      {activeLoreEgg && (
        <div
          className="bgal-egg-overlay"
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setActiveLoreEgg(null);
              setEvolutionError("");
            }
          }}
        >
          <div
            className="bgal-egg-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="bgal-egg-title"
            style={{ borderColor: activeLoreEgg.border }}
          >
            <div
              className="bgal-egg-emoji"
              aria-hidden="true"
              style={{
                background: activeLoreEgg.bg,
                border: `1px solid ${activeLoreEgg.border}`,
                boxShadow: `0 0 15px ${activeLoreEgg.glow}`
              }}
            >
              {activeLoreEgg.emoji}
            </div>
            
            <h3 id="bgal-egg-title" className="bgal-egg-title">
              {activeLoreEgg.title}
            </h3>
            
            <p className="bgal-egg-lore">
              "{activeLoreEgg.lore}"
            </p>

            {activeLoreEgg.key === "magikarp_pokemon" && evolutionError && (
              <p className="bgal-egg-error" role="alert">
                ⚠️ {evolutionError}
              </p>
            )}
            
            <div className="bgal-egg-actions">
              <button 
                type="button"
                onClick={() => {
                  setActiveLoreEgg(null);
                  setEvolutionError("");
                }} 
                className="bgal-btn"
                autoFocus
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
                        setEvolutionError(`Parameters unstable! Goldfish evolution requires ideal coldwater biology. Target: pH 7.2, Temp ${formatTemperature(20, tempScale.scale)}. (Current: pH ${simPh} | Temp ${formatTemperature(simTemp, tempScale.scale)})`);
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
          <p style={{ color: "rgba(255, 255, 255, 0.75)", fontSize: "0.9rem", marginTop: "0.5rem" }}>
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
            message: `Sent ${data.commonName} (${data.scientificName}) to the review queue.`
          });
          setTimeout(() => setNotification(null), 5000);
        }}
        walletAccount={walletAccount}
        suggestionsQuery={suggestionsQuery}
        castVote={castVote}
        isVoting={isVoting}
        promoteSpecies={promoteSpecies}
        isPromoting={isPromoting}
        CARE_LEVEL_STRINGS={CARE_LEVEL_STRINGS}
        marketplaceAddress={marketplaceAddress}
      />
    </div>
  );
}
