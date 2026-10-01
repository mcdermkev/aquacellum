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
  ArrowLeft,
  Egg,
  Storefront,
  Check,
  Tag,
  TreeStructure,
  Sliders,
  CheckCircle,
  XCircle,
  MinusCircle,
  BookOpenText,
  ForkKnife,
  Lightbulb,
  Warning,
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

// Text colour for the same verdicts. VERDICT_COLOR is too light for text on
// white (2.3:1 to 4.3:1), so it stays on the ring stroke and these text-safe
// tokens carry the score, verdict label and reason bullets.
const VERDICT_TEXT = Object.freeze({
  ok: "var(--accent-green)",
  caution: "var(--accent-amber)",
  blocked: "var(--accent-red)",
  no_tank: "var(--text-muted)",
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
    const checkIcon = (state) =>
      state === "pass" ? (
        <CheckCircle size={18} weight="fill" className="bgal-check-icon" aria-hidden="true" />
      ) : state === "fail" ? (
        <XCircle size={18} weight="fill" className="bgal-check-icon" aria-hidden="true" />
      ) : (
        <MinusCircle size={18} className="bgal-check-icon" aria-hidden="true" />
      );
    // Same branches as before: no recorded minimum is "unknown", never a pass.
    const volumeCheck = minVol == null ? "unknown" : (simVolume >= minVol ? "pass" : "fail");
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
    const verdictText = VERDICT_TEXT[verdict] || VERDICT_TEXT.caution;

    // Records sub-tabs and care-guide tabs: one ARIA tablist each. Arrow keys,
    // Home and End call the same setter as a click (automatic activation).
    const subTabs = [
      {
        id: "specimens",
        label: casualModeActive ? "Fish listed" : "Certificates",
        count: selectedBreedSpecs.length,
        Icon: Certificate,
      },
      { id: "hatchery", label: "Spawning logs", Icon: Egg },
      { id: "listings", label: "Listings", Icon: Storefront },
    ];
    const activeSubIndex = Math.max(0, subTabs.findIndex((t) => t.id === selectedSubTab));
    const handleSubTabKeyDown = (e) => {
      const next = nextTabIndex(e.key, activeSubIndex, subTabs.length);
      if (next === null) return;
      e.preventDefault();
      setSelectedSubTab(subTabs[next].id);
      e.currentTarget.querySelectorAll('[role="tab"]')[next]?.focus();
    };
    const guideTabs = [
      { id: "care", label: "Care", Icon: BookOpenText },
      { id: "diet", label: "Diet", Icon: ForkKnife },
      { id: "breeding", label: "Breeding", Icon: Egg },
      { id: "insights", label: casualModeActive ? "Tips" : "Insights", Icon: Lightbulb },
    ];
    const activeGuideIndex = Math.max(0, guideTabs.findIndex((t) => t.id === activeInfoTab));
    const handleGuideTabKeyDown = (e) => {
      const next = nextTabIndex(e.key, activeGuideIndex, guideTabs.length);
      if (next === null) return;
      e.preventDefault();
      setActiveInfoTab(guideTabs[next].id);
      e.currentTarget.querySelectorAll('[role="tab"]')[next]?.focus();
    };

    return (
      <div className="bgal bgal-detail">
        {/* Back and title header */}
        <header className="bgal-detail-head">
          <button type="button" onClick={() => setSelectedBreed(null)} className="bgal-btn bgal-back">
            <ArrowLeft size={16} weight="bold" aria-hidden="true" />
            Back to species
          </button>
          <div className="bgal-detail-title-row">
            <div className="bgal-head-text">
              <p className="bgal-kicker">Species</p>
              <h2 className="bgal-title">{selectedBreed.commonName}</h2>
              <p className="bgal-detail-sci">{selectedBreed.scientificName}</p>
            </div>
            {selectedBreed.isGlobal && (
              <button
                type="button"
                onClick={() => handleProposeBreed(selectedBreed)}
                className="bgal-btn bgal-btn--primary"
              >
                Suggest for the catalog
              </button>
            )}
          </div>
        </header>

        {/* Key facts */}
        <dl className="bgal-facts">
          <div className="bgal-fact">
            <dt className="bgal-fact-label">Care level</dt>
            <dd className="bgal-fact-value">{CARE_LEVEL_STRINGS[selectedBreed.careLevel]}</dd>
          </div>
          <div className="bgal-fact">
            <dt className="bgal-fact-label">Temperature</dt>
            <dd className={`bgal-fact-value${breedTempRange ? "" : " bgal-fact-value--muted"}`}>
              {breedTempRange ? formatTemperatureRange(breedTempRange[0], breedTempRange[1], tempUnit, { dash: " - " }) : CARE_NOT_RECORDED}
            </dd>
          </div>
          <div className="bgal-fact">
            <dt className="bgal-fact-label">pH</dt>
            <dd className={`bgal-fact-value${breedPhRange ? "" : " bgal-fact-value--muted"}`}>{breedPhText}</dd>
          </div>
          <div className="bgal-fact">
            <dt className="bgal-fact-label">Minimum tank</dt>
            <dd className={`bgal-fact-value${minVol != null ? "" : " bgal-fact-value--muted"}`}>
              {minVol != null ? `${minVol} gal` : "Not recorded"}
            </dd>
          </div>
        </dl>

        {/* Species photo with a caption strip below it */}
        {fullProfile.masterPhotoUrl && (
          <figure className="bgal-hero">
            <img
              className="bgal-hero-img"
              src={fullProfile.masterPhotoUrl}
              alt={selectedBreed.commonName}
            />
            <figcaption className="bgal-hero-caption">
              <span className="bgal-hero-badge">Catalog photo</span>
              <SpeciesPhotoCredit scientificName={selectedBreed.scientificName} style={{ color: "var(--text-muted)", textAlign: "right" }} />
            </figcaption>
          </figure>
        )}

        {/* Care guide first in the DOM so focus order matches what you see,
            then records (main) and the tank check (side). */}
        <div className="bgal-detail-grid">

          {/* Species care guide */}
          <section className="bgal-guide" aria-labelledby="bgal-guide-title">
            <h3 className="bgal-panel-title bgal-panel-title--icon" id="bgal-guide-title">
              <BookOpenText size={20} aria-hidden="true" />
              Care guide
            </h3>

            {/* Personality flavor intro; absent = silent (renders only when present for the active mode) */}
            {personalityFlavorText && (
              <p className="bgal-guide-intro">{personalityFlavorText}</p>
            )}

            <div
              className="bgal-tabs"
              role="tablist"
              aria-label="Care guide sections"
              onKeyDown={handleGuideTabKeyDown}
            >
              {guideTabs.map(({ id, label, Icon }, index) => {
                const selected = activeInfoTab === id;
                return (
                  <button
                    key={id}
                    type="button"
                    role="tab"
                    id={`bgal-guide-tab-${id}`}
                    aria-selected={selected}
                    aria-controls="bgal-guide-panel"
                    tabIndex={index === activeGuideIndex ? 0 : -1}
                    className="bgal-tab"
                    onClick={() => setActiveInfoTab(id)}
                  >
                    <Icon size={18} weight={selected ? "fill" : "regular"} aria-hidden="true" />
                    <span>{label}</span>
                  </button>
                );
              })}
            </div>

            <div
              role="tabpanel"
              id="bgal-guide-panel"
              aria-labelledby={`bgal-guide-tab-${guideTabs[activeGuideIndex].id}`}
              className="bgal-guide-panel"
            >
              {activeInfoTab === "care" && (
                <div className="bgal-guide-body">
                  {biotopeText && (
                    <div className="bgal-kv bgal-kv--block">
                      <span className="bgal-kv-label">Natural habitat</span>
                      <p className="bgal-kv-text">{biotopeText}</p>
                    </div>
                  )}

                  <div className="bgal-kv-grid">
                    <div className="bgal-kv bgal-kv--block">
                      <span className="bgal-kv-label">Water hardness</span>
                      {hardnessText ? (
                        <span className="badge badge-blue">{hardnessText}</span>
                      ) : (
                        <span className="bgal-kv-missing">{CARE_NOT_RECORDED}</span>
                      )}
                    </div>
                    <div className="bgal-kv bgal-kv--block">
                      <span className="bgal-kv-label">Maximum temperature</span>
                      {tempCeiling != null ? (
                        <span className="badge badge-red">
                          Up to {formatTemperature(tempCeiling, tempScale.scale, { precision: 0 })}
                        </span>
                      ) : (
                        <span className="bgal-kv-missing">{CARE_NOT_RECORDED}</span>
                      )}
                    </div>
                  </div>

                  <div className="bgal-kv bgal-kv--block">
                    <span className="bgal-kv-label">pH range</span>
                    {breedPhRange ? (
                      <span className="badge badge-green">{breedPhText} pH</span>
                    ) : (
                      <span className="bgal-kv-missing">{CARE_NOT_RECORDED}</span>
                    )}
                  </div>

                  {socialText && (
                    <div className="bgal-callout">
                      <strong className="bgal-callout-title">
                        <Warning size={16} weight="fill" aria-hidden="true" />
                        Temperament and tankmates
                      </strong>
                      <p className="bgal-callout-text">{socialText}</p>
                    </div>
                  )}
                </div>
              )}

              {activeInfoTab === "diet" && (
                <div className="bgal-guide-body">
                  <div className="bgal-kv">
                    <span className="bgal-kv-label">Diet type</span>
                    {realDietText(fullProfile.diet?.trophicLevel) ? (
                      <span className={`badge ${
                        isCarnivoreTrophic(fullProfile.diet.trophicLevel) ? "badge-red" :
                        isHerbivoreTrophic(fullProfile.diet.trophicLevel) ? "badge-green" : "badge-blue"
                      }`}>
                        {realDietText(fullProfile.diet.trophicLevel)}
                      </span>
                    ) : (
                      <span className="bgal-kv-missing">{DIET_NOT_RECORDED}</span>
                    )}
                  </div>

                  {realDietText(fullProfile.diet?.fooditems) && (
                    <div className="bgal-kv bgal-kv--block">
                      <span className="bgal-kv-label">Wild diet</span>
                      <p className="bgal-kv-text">{realDietText(fullProfile.diet.fooditems)}</p>
                    </div>
                  )}

                  {realDietText(fullProfile.diet?.feedingPlaybook) && (
                    <div className="bgal-callout bgal-callout--teal">
                      <strong className="bgal-callout-title">How to feed</strong>
                      <p className="bgal-callout-text">{realDietText(fullProfile.diet.feedingPlaybook)}</p>
                    </div>
                  )}
                </div>
              )}

              {activeInfoTab === "breeding" && (
                <div className="bgal-guide-body">
                  <div className="bgal-kv">
                    <span className="bgal-kv-label">Spawning</span>
                    {spawningText ? (
                      <span className="badge badge-amber">{spawningText}</span>
                    ) : (
                      <span className="bgal-kv-missing">{CARE_NOT_RECORDED}</span>
                    )}
                  </div>

                  {layoutText && (
                    <div className="bgal-callout bgal-callout--green">
                      <strong className="bgal-callout-title">Spawning setup</strong>
                      <p className="bgal-callout-text">{layoutText}</p>
                    </div>
                  )}

                  {reproNotesText && (
                    <div className="bgal-kv bgal-kv--block">
                      <span className="bgal-kv-label">Breeding notes</span>
                      <p className="bgal-kv-text">{reproNotesText}</p>
                    </div>
                  )}

                  {/* Sexing sits in the reproduction tab because that is the decision
                      it serves: you cannot pair what you cannot sex. Shown even when
                      undocumented here, because a breeder needs to know the gap is
                      ours before planning around it. */}
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
          </section>

          {/* Main column: certificates, spawning logs, listings */}
          <div className="bgal-main">

            <div className="bgal-sub-bar">
              <div
                className="bgal-tabs"
                role="tablist"
                aria-label="Species records"
                onKeyDown={handleSubTabKeyDown}
              >
                {subTabs.map(({ id, label, count, Icon }, index) => {
                  const selected = selectedSubTab === id;
                  return (
                    <button
                      key={id}
                      type="button"
                      role="tab"
                      id={`bgal-sub-tab-${id}`}
                      aria-selected={selected}
                      aria-controls="bgal-sub-panel"
                      tabIndex={index === activeSubIndex ? 0 : -1}
                      className="bgal-tab"
                      onClick={() => setSelectedSubTab(id)}
                    >
                      <Icon size={18} weight={selected ? "fill" : "regular"} aria-hidden="true" />
                      <span>{label}</span>
                      {count !== undefined && <span className="bgal-tab-count">{count}</span>}
                    </button>
                  );
                })}
              </div>

              {selectedSubTab === "specimens" && walletAccount && (
                <button
                  type="button"
                  className="bgal-chip"
                  aria-pressed={showMyFishOnly}
                  onClick={() => setShowMyFishOnly(!showMyFishOnly)}
                >
                  {showMyFishOnly && <Check size={14} weight="bold" aria-hidden="true" />}
                  Only my fish
                </button>
              )}
            </div>

            <div
              role="tabpanel"
              id="bgal-sub-panel"
              aria-labelledby={`bgal-sub-tab-${subTabs[activeSubIndex].id}`}
            >
              {selectedSubTab === "specimens" ? (
                specsLoading ? (
                  <div className="bgal-state" role="status">
                    <p className="bgal-state-text">Loading certificates…</p>
                  </div>
                ) : (selectedBreedSpecs.length === 0 || (showMyFishOnly && selectedBreedSpecs.filter(s => s.owner.toLowerCase() === walletAccount.toLowerCase()).length === 0)) ? (
                  <div className="bgal-state">
                    <p className="bgal-state-text">
                      {showMyFishOnly ? "You don't own any certificates for this species." : "No certificates registered for this species yet."}
                    </p>
                  </div>
                ) : (
                  <div className="bgal-cert-grid">
                    {(showMyFishOnly && walletAccount
                      ? selectedBreedSpecs.filter(s => s.owner.toLowerCase() === walletAccount.toLowerCase())
                      : selectedBreedSpecs
                    ).map((spec) => {
                      // Same colour per status index as before (unknown falls back to Active's).
                      const statusClass = ["active", "deceased", "rehomed"][spec.status] || "active";
                      const birthDate = spec.birthTimestamp > 0
                        ? new Date(spec.birthTimestamp * 1000).toLocaleDateString()
                        : "Not recorded";

                      const customPhoto = specimenPhotos[spec.specimenId] || null;
                      const specBreedData = fishbaseData.find(
                        (item) => item.scientificName.toLowerCase() === selectedBreed.scientificName.toLowerCase()
                      );
                      const masterPhotoUrl = specBreedData?.masterPhotoUrl || "";
                      const finalImgSrc = customPhoto || masterPhotoUrl;

                      return (
                        <div
                          key={spec.specimenId}
                          className="bgal-cert"
                          onClick={() => onSelectSpecimen && onSelectSpecimen(spec.specimenId)}
                        >
                          {/* Photo / Fallback SVG Area */}
                          {(() => {
                            const isPlant = isPlantEntry(specBreedData || {});
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
                              <div className="bgal-cert-media">
                                <LazyImage
                                  src={finalImgSrc}
                                  alt={`Specimen ${spec.specimenId}`}
                                  style={{ width: "100%", height: "100%" }}
                                  fallbackSvg={fallbackSvg}
                                />

                                {/* Only when the picture really is the species photo, not this fish's own */}
                                {!customPhoto && masterPhotoUrl && (
                                  <span className="bgal-cert-photo-label">Species photo</span>
                                )}

                                <span className={`bgal-status bgal-status--${statusClass}`}>
                                  {spec.status === 0 ? "Active" : spec.status === 1 ? "Deceased" : "Rehomed"}
                                </span>
                              </div>
                            );
                          })()}

                          {/* The title is the card's keyboard target. It has no handler of
                              its own; its click bubbles to the card's onClick. */}
                          <h3 className="bgal-cert-title">
                            <button type="button" className="bgal-cert-open">
                              {casualModeActive ? selectedBreed.commonName : `Certificate No. ${spec.specimenId.toString().padStart(3, "0")}`}
                            </button>
                          </h3>

                          {editingTagId === spec.specimenId ? (
                            <div
                              className="bgal-tag-edit"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <input
                                type="text"
                                className="bgal-tag-input"
                                aria-label="Stock tag"
                                value={editingTagValue}
                                onChange={(e) => setEditingTagValue(e.target.value.slice(0, 16))}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") handleTagEditSave(e, spec);
                                  if (e.key === "Escape") handleTagEditCancel(e);
                                }}
                                autoFocus
                                maxLength={16}
                                placeholder="e.g. esgIV"
                              />
                              <button
                                type="button"
                                className="bgal-btn bgal-btn--primary"
                                onClick={(e) => handleTagEditSave(e, spec)}
                              >Save</button>
                              <button
                                type="button"
                                className="bgal-btn"
                                onClick={(e) => handleTagEditCancel(e)}
                              >Cancel</button>
                            </div>
                          ) : (
                            <div className="bgal-tag-row">
                              {spec.breederStockTag ? (
                                <button
                                  type="button"
                                  className="bgal-tag"
                                  aria-label={`Edit stock tag ${spec.breederStockTag}`}
                                  title="Edit stock tag"
                                  onClick={(e) => handleTagEditStart(e, spec)}
                                >
                                  {spec.breederStockTag}
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  className="bgal-tag-add"
                                  title="Add breeder stock tag"
                                  onClick={(e) => handleTagEditStart(e, spec)}
                                >
                                  <Tag size={14} aria-hidden="true" />
                                  Add tag
                                </button>
                              )}
                            </div>
                          )}

                          <dl className="bgal-cert-facts">
                            {proMode && (
                              <div className="bgal-cert-fact">
                                <dt>Owner</dt>
                                <dd className="bgal-mono">
                                  {spec.owner ? `${spec.owner.substring(0, 6)}...${spec.owner.substring(38)}` : "None"}
                                </dd>
                              </div>
                            )}
                            {proMode && (
                              <div className="bgal-cert-fact">
                                <dt>Breeder</dt>
                                <dd className="bgal-mono">
                                  {spec.breeder && spec.breeder !== ZeroAddress
                                    ? `${spec.breeder.substring(0, 6)}...${spec.breeder.substring(38)}`
                                    : "Wild-caught"}
                                </dd>
                              </div>
                            )}
                            <div className="bgal-cert-fact">
                              <dt>{casualModeActive ? "Date added" : "Hatched"}</dt>
                              <dd>{birthDate}</dd>
                            </div>
                          </dl>
                          {casualModeActive && (
                            <div className="bgal-cert-pills">
                              <span className="bgal-mini-pill">Registered</span>
                              {spec.status === 0 && (
                                <span className="bgal-mini-pill">Tank-bred</span>
                              )}
                            </div>
                          )}

                          <div className="bgal-cert-actions">
                            {proMode && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onViewLineage(spec.specimenId);
                                }}
                                className="bgal-btn bgal-btn--primary"
                              >
                                <TreeStructure size={16} aria-hidden="true" />
                                View family tree
                              </button>
                            )}
                            {casualModeActive && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onSelectSpecimen && onSelectSpecimen(spec.specimenId);
                                }}
                                className="bgal-btn"
                              >
                                View details
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )
              ) : selectedSubTab === "hatchery" ? (
                <section className="bgal-panel" aria-labelledby="bgal-hatchery-title">
                  <h3 className="bgal-panel-title" id="bgal-hatchery-title">Spawning records</h3>
                  <HatcheryLogs
                    specCode={selectedBreed.speciesId}
                    contractInstance={contractInstance}
                    marketplaceAddress={marketplaceAddress}
                    walletAccount={walletAccount}
                    onCheckoutSuccessRedirect={onCheckoutSuccessRedirect}
                  />
                </section>
              ) : (
                <section className="bgal-panel" aria-labelledby="bgal-listings-title">
                  <h3 className="bgal-panel-title" id="bgal-listings-title">Listings for this species</h3>
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
                </section>
              )}
            </div>
          </div>

          {/* Side column: check your tank, parameter check, tankmates */}
          <aside className="bgal-side" aria-label="Tank check">

            <section className="bgal-sim" aria-labelledby="bgal-sim-title">
              <h3 className="bgal-panel-title bgal-panel-title--icon" id="bgal-sim-title">
                <Sliders size={18} aria-hidden="true" />
                {casualModeActive ? "Tank match" : "Check your tank"}
              </h3>
              <p className="bgal-panel-lead">Set your tank's size, pH and temperature to see how this species fits.</p>

              {/* Match score */}
              <div className="bgal-sim-score">
                {/* Circular gauge: the ring keeps the verdict hue, the number uses the text-safe one */}
                <div className="bgal-ring">
                  <svg width="80" height="80" viewBox="0 0 100 100" className="bgal-ring-svg" aria-hidden="true">
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
                      className="bgal-ring-bar"
                    />
                  </svg>
                  <span className="bgal-ring-value" style={{ color: verdictText }}>
                    {score}%
                  </span>
                </div>

                <div className="bgal-sim-verdict-wrap">
                  <span className="bgal-sim-verdict-label">
                    {casualModeActive ? "Tank fit" : "Fit score"}
                  </span>
                  <strong className="bgal-sim-verdict" style={{ color: verdictText }}>
                    {verdict === "ok"
                      ? (casualModeActive ? (score === 100 ? "Perfect fit for your tank" : "Good for your tank") : "Good fit")
                      : verdict === "blocked"
                        ? (casualModeActive ? "Not a safe fit" : "Not a fit")
                        : (casualModeActive ? "Check before you buy" : "Caution")}
                  </strong>
                  {casualModeActive && verdict === "ok" && score === 100 && (
                    <span className="bgal-mini-pill">Perfect fit</span>
                  )}
                </div>
              </div>

              {/* Feedback description */}
              <p className="bgal-sim-headline">{text}</p>

              {/* Honest per-parameter reasons from the canonical fit engine
                  (why the verdict is what it is, e.g. an unknown minimum tank
                  size, or which water parameter is off). Fish Finder T2. */}
              {Array.isArray(reasons) && reasons.length > 0 && (
                <ul className="bgal-reasons">
                  {reasons.map((reason, i) => (
                    <li key={i}>
                      <span aria-hidden="true" className="bgal-reasons-mark" style={{ color: verdictText }}>
                        {verdict === "ok" ? <Check size={12} weight="bold" /> : "•"}
                      </span>
                      <span>{reason}</span>
                    </li>
                  ))}
                </ul>
              )}

              {/* Sliders */}
              <div className="bgal-sliders">
                <div className="bgal-slider">
                  <div className="bgal-slider-head">
                    <label htmlFor="bgal-sim-volume">Tank size</label>
                    <output htmlFor="bgal-sim-volume">{simVolume} gal</output>
                  </div>
                  <input
                    type="range"
                    id="bgal-sim-volume"
                    className="bgal-range"
                    min="5"
                    max="300"
                    step="5"
                    value={simVolume}
                    onChange={(e) => setSimVolume(Number(e.target.value))}
                    aria-valuetext={`${simVolume} gallons`}
                  />
                  <div className="bgal-slider-scale">
                    <span>5 gal</span>
                    {minVol != null && <span>Minimum: {minVol} gal</span>}
                    <span>300 gal</span>
                  </div>
                </div>

                <div className="bgal-slider">
                  <div className="bgal-slider-head">
                    <label htmlFor="bgal-sim-ph">Water pH</label>
                    <output htmlFor="bgal-sim-ph">{simPh}</output>
                  </div>
                  <input
                    type="range"
                    id="bgal-sim-ph"
                    className="bgal-range"
                    min="4.0"
                    max="10.0"
                    step="0.1"
                    value={simPh}
                    onChange={(e) => setSimPh(Number(e.target.value))}
                    aria-valuetext={`pH ${simPh}`}
                  />
                  <div className="bgal-slider-scale">
                    <span>4.0</span>
                    <span>Species range: {breedPhText}</span>
                    <span>10.0</span>
                  </div>
                </div>

                <div className="bgal-slider">
                  <div className="bgal-slider-head">
                    <label htmlFor="bgal-sim-temp">Temperature</label>
                    <output htmlFor="bgal-sim-temp">{tempScale.convert(simTemp).toFixed(1)} {tempScale.suffix}</output>
                  </div>
                  <input
                    type="range"
                    id="bgal-sim-temp"
                    className="bgal-range"
                    min="15.0"
                    max="35.0"
                    step="0.5"
                    value={simTemp}
                    onChange={(e) => setSimTemp(Number(e.target.value))}
                    aria-valuetext={`${tempScale.convert(simTemp).toFixed(1)} ${tempScale.suffix}`}
                  />
                  <div className="bgal-slider-scale">
                    {/* The slider's domain stays 15 to 35 °C; only these end labels
                        are converted, so the input value never changes meaning. */}
                    <span>{tempScale.convert(15).toFixed(1)} {tempScale.suffix}</span>
                    <span>Species range: {breedTempText}</span>
                    <span>{tempScale.convert(35).toFixed(1)} {tempScale.suffix}</span>
                  </div>
                </div>
              </div>
            </section>

            {/* Parameter check */}
            <section className="bgal-checks" aria-labelledby="bgal-checks-title">
              <h4 className="bgal-side-title" id="bgal-checks-title">Parameter check</h4>
              <ul className="bgal-check-list">
                {/* Volume check. With no recorded minimum we say so rather than
                    scoring against a fabricated default (Decision D3). */}
                <li className={`bgal-check bgal-check--${volumeCheck}`}>
                  {checkIcon(volumeCheck)}
                  <span>
                    {minVol == null
                      ? "Minimum volume not recorded for this species"
                      : (simVolume >= minVol ? `Tank is big enough (${minVol} gal minimum)` : `Tank is too small (needs ${minVol} gal)`)}
                  </span>
                </li>
                {/* pH and temperature: a species with no recorded range is
                    "not recorded", never a pass against a default. */}
                <li className={`bgal-check bgal-check--${phCheck}`}>
                  {checkIcon(phCheck)}
                  <span>
                    {phCheck === "unknown"
                      ? "pH range not recorded for this species"
                      : phCheck === "pass"
                        ? `pH is in range (${breedPhText})`
                        : `pH is out of range (${breedPhText})`}
                  </span>
                </li>
                <li className={`bgal-check bgal-check--${tempCheck}`}>
                  {checkIcon(tempCheck)}
                  <span>
                    {tempCheck === "unknown"
                      ? "Temperature range not recorded for this species"
                      : tempCheck === "pass"
                        ? `Temperature is in range (${breedTempText})`
                        : `Temperature is out of range (${breedTempText})`}
                  </span>
                </li>
              </ul>
            </section>

            {/* Tankmates that match */}
            <section className="bgal-mates" aria-labelledby="bgal-mates-title">
              <h4 className="bgal-side-title" id="bgal-mates-title">Tankmates that match</h4>
              <p className="bgal-panel-lead">Species whose recorded pH and temperature ranges fit the settings above.</p>
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
                    <p className="bgal-mates-empty">
                      No species with recorded ranges match these settings.
                    </p>
                  );
                }

                return (
                  <ScrollFade
                    focusable
                    role="group"
                    aria-label="Compatible tankmates"
                    className="bgal-mates-row"
                  >
                    {companions.map((comp) => (
                      <div
                        key={comp.specCode}
                        className={`bgal-mate${isPlantEntry(comp) ? " bgal-mate--plant" : ""}`}
                      >
                        <div className="bgal-mate-art">
                          {isPlantEntry(comp) ? (
                            <PlantSilhouetteSVG specCode={comp.specCode} />
                          ) : (
                            <FishSilhouetteSVG specimenId={comp.specCode} />
                          )}
                        </div>
                        <span className="bgal-mate-name" title={comp.commonName}>
                          {comp.commonName}
                        </span>
                        <span className="bgal-mate-sci" title={comp.scientificName}>
                          {comp.scientificName}
                        </span>
                        <span className="bgal-mate-meta">
                          {isPlantEntry(comp) ? "Plant" : `pH ${comp.tankMetrics?.phRange?.[0]}-${comp.tankMetrics?.phRange?.[1]}`}
                        </span>
                      </div>
                    ))}
                  </ScrollFade>
                );
              })()}
            </section>

          </aside>
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
            Show {filteredSpecies.length} {filteredSpecies.length === 1 ? "result" : "results"}
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
            // Keep Tab and Shift+Tab inside the dialog
            if (e.key === "Tab") {
              const focusable = e.currentTarget.querySelectorAll(
                '.bgal-egg-dialog button:not([disabled]), .bgal-egg-dialog a[href], .bgal-egg-dialog input, .bgal-egg-dialog [tabindex]:not([tabindex="-1"])'
              );
              if (focusable.length === 0) return;
              const first = focusable[0];
              const last = focusable[focusable.length - 1];
              if (e.shiftKey && document.activeElement === first) {
                e.preventDefault();
                last.focus();
              } else if (!e.shiftKey && document.activeElement === last) {
                e.preventDefault();
                first.focus();
              }
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
