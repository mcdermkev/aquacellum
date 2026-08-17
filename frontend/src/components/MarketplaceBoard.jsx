import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { addSavedSearch, describeSavedSearch, normalizeSearch } from "../services/savedSearches";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ethers, Contract } from "ethers";
import { Plus, MinusCircle } from "@phosphor-icons/react";
import aquadexAbi from "../abi/AquadexManager.json";
import marketplaceAbi from "../abi/AquadexMarketplace.json";
import { ListSpecimenModal } from "./ListSpecimenModal";
import { EditListingModal } from "./EditListingModal";
import { BatchListingWizard } from "./BatchListingWizard";
import { OfferModal } from "./OfferModal";
import { XP_ACTIONS, getXp } from "../utils/xp";
import { getProvider } from "../utils/smartAccount";
import { relayCancelListing, relayCancelBatchListing } from "../services/relayer";
import { FishSilhouetteSVG, PlantSilhouetteSVG } from "./SilhouetteSVG";
import { fetchListingsByBreed } from "../utils/listingManager";
import { useSpeciesData } from "../hooks/useSpeciesData";
import { LazyImage } from "./LazyImage";
import { useMarketplaceListings } from "../hooks/useMarketplaceListings";
import { WantedBoard } from "./WantedBoard";
import { LoadingSkeleton } from "./LoadingSkeleton";
import { getOrCreateConversation } from "../services/messagesApi";
import { getProfile } from "../services/reefApi";
import { generateAlias } from "../utils/generateAlias";
import { db } from "../db";
import { evaluateTankFit } from "../services/addOnRecommender";
import { applyCatalogQuery, SORT_OPTIONS, FULFILLMENT_TYPES, getListingKey } from "../services/catalogQuery";
import { hasEntitlement } from "../services/entitlements";
import { EXPO_ANALYTICS_ENABLED } from "../config/liveEvents";
import { ProductDetailModal } from "./ProductDetailModal";
import { useCart } from "../contexts/CartContext";
import { resolveSpecimenPhoto } from "../services/tankMedia";

// Helper: detect if a fishbase record or specCode is a plant entry
const isPlantEntry = (specCodeOrItem) => {
  if (typeof specCodeOrItem === "object" && specCodeOrItem !== null) {
    return specCodeOrItem.type === "plant";
  }
  return false;
};

/**
 * SellerName — Resolves a seller's wallet address to a human-readable name
 * instead of showing the raw hex address. Checks the Supabase Reef profile
 * first, then the local Dexie mirror, then falls back to a deterministic
 * fish-themed alias (never shows a blank or the raw address).
 */
function SellerName({ address }) {
  const [name, setName] = useState(() => (address ? generateAlias(address) : "Unknown Breeder"));

  useEffect(() => {
    if (!address) return;
    let cancelled = false;

    (async () => {
      try {
        const { data } = await getProfile(address);
        if (!cancelled && data?.display_name) {
          setName(data.display_name);
          return;
        }
      } catch (e) { /* fall through to next source */ }

      try {
        const local = await db.userProfile.get(address.toLowerCase());
        if (!cancelled && local?.alias) {
          setName(local.alias);
          return;
        }
      } catch (e) { /* fall through to alias */ }

      if (!cancelled) setName(generateAlias(address));
    })();

    return () => { cancelled = true; };
  }, [address]);

  return <>{name}</>;
}

import { mapContractError } from "../utils/errorHandler";
import { PROVENANCE, resolveProvenance, provenanceLabel } from "../utils/provenance";
import { SellerChip } from "./SellerChip";
import { useSpeciesMastery, getMasteryForSpecies } from "../hooks/useSpeciesMastery";

/**
 * SellerChipLoader — self-loading seller chip for a specific listing.
 *
 * Each instance fetches the seller's tier (from their profile, already cached by
 * getProfile) and their species mastery (from the species_mastery view, cached by
 * useSpeciesMastery). Both are react-query-driven with a 5-minute staleTime, so
 * browsing a page of 20 listings from the same seller results in one fetch, not 20.
 */
function SellerChipLoader({ sellerAddress, scientificName }) {
  const [tier, setTier] = React.useState(null);

  React.useEffect(() => {
    if (!sellerAddress) return;
    let cancelled = false;
    getProfile(sellerAddress)
      .then(({ data }) => {
        if (!cancelled) setTier(data?.companion_tier || "Shallow");
      })
      .catch(() => {
        if (!cancelled) setTier("Shallow");
      });
    return () => { cancelled = true; };
  }, [sellerAddress]);

  const { data: masteryMap } = useSpeciesMastery(sellerAddress);
  const mastery = scientificName
    ? getMasteryForSpecies(masteryMap, scientificName)
    : null;

  if (!tier) return null;
  return <SellerChip sellerTier={tier} speciesMastery={mastery} compact />;
}

export function MarketplaceBoard({ 
  contractAddress, 
  marketplaceAddress, 
  walletAccount, 
  onLineageSelect,
  preselectedListSpecimen,
  preselectedListTank,
  onClearPreselectedList,
  casualModeActive,
  displayTank,
  setDisplayTank,
  filterSpeciesId,
  onSelectCheckoutOrder,
  activeSellerFilter,
  setActiveSellerFilter,
  // A saved filter set handed in from Settings → Fish Finder, and the callback that
  // clears it once applied. Mirrors how `filterSpeciesId` / `activeSellerFilter`
  // already arrive from App.jsx.
  pendingSavedSearch,
  onClearPendingSavedSearch
}) {
  const { data: fetchedListings = [], isLoading: listingsLoading, error: listingsError, refetch: refetchListings } = useMarketplaceListings(contractAddress, marketplaceAddress, filterSpeciesId);
  const listings = fetchedListings;
  const loading = listingsLoading;
  const error = listingsError ? (listingsError.message || "Failed to load listings") : null;
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isBatchWizardOpen, setIsBatchWizardOpen] = useState(false);
  const [offerListing, setOfferListing] = useState(null);
  const [editingItem, setEditingItem] = useState(null);
  const [savedItems, setSavedItems] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem('aquadex_watchlist') || '[]')); }
    catch { return new Set(); }
  });
  const [cardImageIndexMap, setCardImageIndexMap] = useState({});
  const [activeSubTab, setActiveSubTab] = useState("listings"); // "listings" | "wanted" | "analytics"
  const [actionLoading, setActionLoading] = useState({});
  const [actionTxHash, setActionTxHash] = useState({});
  const [actionError, setActionError] = useState(null);
  const [sortBy, setSortBy] = useState("none");
  const [isWizardOpen, setIsWizardOpen] = useState(false);
  const [wizardVolume, setWizardVolume] = useState("30");
  const [wizardPh, setWizardPh] = useState("7.0");
  const [wizardTemp, setWizardTemp] = useState("24.0");
  const [fishbaseLookup, setFishbaseLookup] = useState({});
  const [fishbaseData, setFishbaseData] = useState([]);
  const [checkoutQuantityMap, setCheckoutQuantityMap] = useState({});
  const { addItem: addToCart } = useCart();

  // ── Task 8: unified catalog query state (search/filter/facets) ───────────
  const [searchQuery, setSearchQuery] = useState("");
  const [familyFilter, setFamilyFilter] = useState("all");
  const [careLevelFilter, setCareLevelFilter] = useState("all");
  const [fulfillmentFilter, setFulfillmentFilter] = useState("all");
  const [priceMinInput, setPriceMinInput] = useState("");
  const [priceMaxInput, setPriceMaxInput] = useState("");
  // Confirms a save landed, and confirms an applied saved search — the save button
  // previously gave no feedback at all, so there was no way to tell it had worked.
  const [savedSearchNotice, setSavedSearchNotice] = useState(null);
  const [showFilterPanel, setShowFilterPanel] = useState(false);

  // Offline banner: shows cached listings with a clear "offline" indicator
  // instead of silently rendering stale data as if it were live.
  const [isOnline, setIsOnline] = useState(() => (typeof navigator !== "undefined" ? navigator.onLine : true));
  useEffect(() => {
    const goOnline = () => setIsOnline(true);
    const goOffline = () => setIsOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  // Deep-linkable product detail overlay: ?listing=<listingKey>
  const [searchParams, setSearchParams] = useSearchParams();
  const [selectedProductListing, setSelectedProductListing] = useState(null);
  const [productNotFound, setProductNotFound] = useState(false);

  const openProductDetail = (item) => {
    const next = new URLSearchParams(searchParams);
    next.set("listing", getListingKey(item));
    setSearchParams(next);
  };

  const closeProductDetail = () => {
    const next = new URLSearchParams(searchParams);
    next.delete("listing");
    setSearchParams(next);
    setSelectedProductListing(null);
    setProductNotFound(false);
  };

  // Local XP for the saved_search entitlement check (browsing itself is
  // REQUIRED and never gated — only the ability to persist a search).
  const xpForEntitlements = useMemo(() => getXp(), []);

  // Saving now goes through services/savedSearches.js, which also de-duplicates an
  // identical filter set. Previously this appended straight to localStorage, so two
  // clicks on the same filters produced two identical rows.
  const saveCurrentSearch = () => {
    addSavedSearch({
      search: searchQuery,
      family: familyFilter,
      careLevel: careLevelFilter,
      fulfillment: fulfillmentFilter,
      priceMinInput,
      priceMaxInput,
    });
    setSavedSearchNotice("Saved. Re-run it any time from Settings → Fish Finder.");
  };

  /**
   * Apply a saved search handed in from Settings.
   *
   * ⚠️ THIS IS THE READER THAT MAKES SAVING MEAN ANYTHING. Until now
   * `aquadex_saved_searches` was write-only — the board appended to it and nothing
   * ever read a record back, so the saved data was unreachable.
   *
   * `normalizeSearch` fills any field a legacy record is missing, because applying
   * a PARTIAL filter set would leave the user's current selections in place and the
   * restored results would not match what they saved.
   */
  useEffect(() => {
    if (!pendingSavedSearch) return;
    const filters = normalizeSearch(pendingSavedSearch);
    setSearchQuery(filters.search);
    setFamilyFilter(filters.family);
    setCareLevelFilter(filters.careLevel);
    setFulfillmentFilter(filters.fulfillment);
    setPriceMinInput(filters.priceMinInput);
    setPriceMaxInput(filters.priceMaxInput);
    setSavedSearchNotice(`Showing your saved search: ${describeSavedSearch(filters)}`);
    // Clear it so navigating away and back does not silently re-apply and override
    // whatever the user has since typed.
    if (onClearPendingSavedSearch) onClearPendingSavedSearch();
  }, [pendingSavedSearch, onClearPendingSavedSearch]);

  // (Removed dead geolocation code — no real proximity feature reads it.)

  const { data: cachedGlobalData } = useSpeciesData();

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
    // Minimum card width of 320px + 24px gap = 344px. Handle edge case of very narrow screens.
    return Math.max(1, Math.floor((containerWidth + 24) / 344));
  }, [containerWidth]);

  useEffect(() => {
    if (casualModeActive) {
      setActiveSubTab("listings");
    }
  }, [casualModeActive]);

  useEffect(() => {
    if (cachedGlobalData) {
      const lookup = {};
      cachedGlobalData.forEach((item) => {
        lookup[item.scientificName.toLowerCase()] = item.tankMetrics;
      });
      setFishbaseLookup(lookup);
      setFishbaseData(cachedGlobalData);
    }
  }, [cachedGlobalData]);

  // Family lookup for the catalog family filter/facets, keyed by speciesId
  // and lowercased scientific name (matches catalogQuery.js's resolveFamily).
  const familyLookup = useMemo(() => {
    const lookup = {};
    (cachedGlobalData || []).forEach((item) => {
      if (!item.family) return;
      if (item.speciesId != null) lookup[item.speciesId] = item.family;
      if (item.scientificName) lookup[item.scientificName.toLowerCase()] = item.family;
    });
    return lookup;
  }, [cachedGlobalData]);

  // Adapts a marketplace listing item into the species-profile shape
  // evaluateTankFit expects, sourcing the minimum tank volume from the
  // fishbase lookup (by scientific name) the way the legacy formula did.
  const itemToSpeciesProfile = (item) => {
    const nameKey = item.scientificName ? item.scientificName.toLowerCase() : "";
    const metrics = fishbaseLookup[nameKey];
    return {
      minVolumeGallons: metrics?.minVolumeGallons ?? undefined,
      tempRange: item.minTemp != null && item.maxTemp != null ? [item.minTemp, item.maxTemp] : null,
      phRange: item.minPh != null && item.maxPh != null ? [item.minPh, item.maxPh] : null,
    };
  };

  const calculateCompatibility = (item) => {
    if (!displayTank) return 0;
    return evaluateTankFit(itemToSpeciesProfile(item), displayTank).score;
  };

  // Removed the fabricated per-wallet "distance" (it hashed the seller address
  // into a fake mileage) and its "Closest to Me" sort — the marketplace has no
  // real seller location to sort by. Real location-based discovery is a
  // separate, opt-in feature (see FISH_FINDER_REWORK_PLAN T15).

  // Legacy listing loading useEffect replaced by React Query useMarketplaceListings hook

  useEffect(() => {
    if (preselectedListSpecimen) {
      setIsModalOpen(true);
    }
  }, [preselectedListSpecimen]);

  // Deep-link route recovery: resolve ?listing=<listingKey> against the
  // loaded listings once they're available. An id with no match (sold,
  // removed, or just wrong) shows the not-found state rather than crashing
  // or silently doing nothing.
  useEffect(() => {
    const listingKeyParam = searchParams.get("listing");
    if (!listingKeyParam) {
      setSelectedProductListing(null);
      setProductNotFound(false);
      return;
    }
    if (loading && listings.length === 0) return; // still loading — wait
    const match = listings.find((item) => getListingKey(item) === listingKeyParam);
    if (match) {
      setSelectedProductListing(match);
      setProductNotFound(false);
    } else {
      setSelectedProductListing(null);
      setProductNotFound(true);
    }
  }, [searchParams, listings, loading]);

  const fetchListings = async () => {
    await refetchListings();
  };

  // Route a batch purchase into the checkout confirmation flow. Nothing is
  // consumed here: the batch listing quantity is only decremented after the
  // buyer completes payment (settled on-chain via purchaseBatchFiat in the
  // Stripe webhook). This keeps the listing intact if checkout is abandoned,
  // and mirrors the single-specimen "pending_purchase" path.
  const handlePurchaseBatch = (listingId, quantity) => {
    if (!onSelectCheckoutOrder) return;
    onSelectCheckoutOrder("pending_batch", listingId, { quantity: Number(quantity) || 1 });
  };

  const handleCancelListing = async (tokenId) => {
    setActionError(null);
    setActionLoading((prev) => ({ ...prev, [tokenId]: true }));
    setActionTxHash((prev) => ({ ...prev, [tokenId]: null }));

    try {
      const result = await relayCancelListing(tokenId);
      if (!result.success) throw new Error(result.error || "Cancel failed");

      await fetchListings();
    } catch (err) {
      console.error("Cancel listing failed:", err);
      setActionError(mapContractError(err, casualModeActive));
    } finally {
      setActionLoading((prev) => ({ ...prev, [tokenId]: false }));
      setActionTxHash((prev) => ({ ...prev, [tokenId]: null }));
    }
  };

  const handleCancelBatchListing = async (listingId) => {
    setActionError(null);
    setActionLoading((prev) => ({ ...prev, [`batch-${listingId}`]: true }));
    setActionTxHash((prev) => ({ ...prev, [`batch-${listingId}`]: null }));

    try {
      const result = await relayCancelBatchListing(listingId);
      if (!result.success) throw new Error(result.error || "Cancel failed");

      await fetchListings();
    } catch (err) {
      console.error("Cancel batch listing failed:", err);
      setActionError(mapContractError(err, casualModeActive));
    } finally {
      setActionLoading((prev) => ({ ...prev, [`batch-${listingId}`]: false }));
      setActionTxHash((prev) => ({ ...prev, [`batch-${listingId}`]: null }));
    }
  };

  // Helper function to safely parse parseEther since we can't import parseEther from ethers directly if not imported
  const parseEther = (str) => {
    const parts = str.split(".");
    const whole = parts[0];
    let fraction = parts[1] || "";
    while (fraction.length < 18) fraction += "0";
    if (fraction.length > 18) fraction = fraction.substring(0, 18);
    return BigInt(whole) * 1000000000000000000n + BigInt(fraction);
  };

  // Watchlist toggle
  const toggleSaveItem = (e, item) => {
    e.stopPropagation();
    const key = `${item.isBatch ? 'b' : 's'}-${item.id || item.tokenId || item.listingId}`;
    setSavedItems(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      localStorage.setItem('aquadex_watchlist', JSON.stringify([...next]));
      return next;
    });
  };

  const isItemSaved = (item) => {
    const key = `${item.isBatch ? 'b' : 's'}-${item.id || item.tokenId || item.listingId}`;
    return savedItems.has(key);
  };

  // REMOVED: `breederReputation` — trust tiers derived from ACTIVE LISTING COUNT
  // (BREEDER_STATE_MODEL §9.28, §12.7).
  //
  // It awarded "🏆 Master Breeder" at 10 listings, "⭐ Established" at 5, and
  // "✓ Trusted" at 3. Posting listings is free and self-serve, so all three were
  // reputation claims backed by inventory volume and nothing else — no sales, no
  // ratings, no verification. It is the same mistake as the old "Established
  // Seller" badge that was earnable by typing 50 into a form (§9.11), and it was
  // more expensive here: it sat on the marketplace board, which is exactly where a
  // buyer decides whether a premium price is justified. The whole point of the
  // pedigree work in §12 is to make "bred by this breeder" worth paying for, and a
  // badge you get for uploading ten rows undercuts it.
  //
  // "Established" also collided with the real, verified-sales achievement of the
  // same name, so the same word meant two different things depending on the screen.
  //
  // Not replaced with a listing-count label: listing volume is not reputation, and
  // naming it honestly ("10+ listings") would be clutter with no signal. The real
  // master-breeder signal is `breeder_profiles.is_master_breeder`, gated by
  // `breederRegistry.checkMasterBreederEligibility` (tier 4 + 5 completed sales +
  // ≥4.0 rating) and rendered on the storefront by `BreederHeader` — which is the
  // right surface for it, because that is where the eligibility check runs. Putting
  // it back on the board needs a per-seller profile read; that is a separate change
  // with its own performance profile, not a drive-by.

  // Map the UI's sort select to catalogQuery's canonical SORT_OPTIONS where a
  // direct equivalent exists. "tier-purebred"/"tier-unverified" are marketplace-
  // specific pedigree/provenance sorts (not part of the generic catalog
  // contract), so those stay as a local post-sort pass below rather than forking
  // catalogQuery.js's sort logic.
  const catalogSort =
    sortBy === "price-asc" ? SORT_OPTIONS.PRICE_ASC
    : sortBy === "price-desc" ? SORT_OPTIONS.PRICE_DESC
    : undefined;

  const priceMinCents = priceMinInput.trim() !== "" ? Math.round(parseFloat(priceMinInput) * 100) : undefined;
  const priceMaxCents = priceMaxInput.trim() !== "" ? Math.round(parseFloat(priceMaxInput) * 100) : undefined;

  const { results: queriedListings, facets } = useMemo(() => {
    return applyCatalogQuery(listings, {
      search: searchQuery,
      family: familyFilter !== "all" ? familyFilter : undefined,
      familyLookup,
      careLevel: careLevelFilter !== "all" ? Number(careLevelFilter) : undefined,
      fulfillment: fulfillmentFilter !== "all" ? fulfillmentFilter : undefined,
      priceMinCents: Number.isFinite(priceMinCents) ? priceMinCents : undefined,
      priceMaxCents: Number.isFinite(priceMaxCents) ? priceMaxCents : undefined,
      sort: catalogSort,
      displayTank,
      speciesLookup: fishbaseLookup,
    });
  }, [listings, searchQuery, familyFilter, familyLookup, careLevelFilter, fulfillmentFilter, priceMinCents, priceMaxCents, catalogSort, displayTank, fishbaseLookup]);

  const filteredAndSortedListings = queriedListings
    .filter((item) => {
      if (activeSellerFilter && item.seller) {
        if (item.seller.toLowerCase() !== activeSellerFilter.toLowerCase()) {
          return false;
        }
      }
      return true;
    })
    .slice() // stable-sort on top of applyCatalogQuery's already-deterministic order
    .sort((a, b) => {
      // Boosted listings always appear first
      const aBoosted = a.isBoosted ? 1 : 0;
      const bBoosted = b.isBoosted ? 1 : 0;
      if (aBoosted !== bBoosted) return bBoosted - aBoosted;

      if (sortBy === "tier-purebred") {
        const aPure = (!a.isBatch && a.sireId !== 0 && a.damId !== 0) ? 1 : 0;
        const bPure = (!b.isBatch && b.sireId !== 0 && b.damId !== 0) ? 1 : 0;
        return bPure - aPure;
      }
      // Was "tier-wild", sorting by `sireId === 0 && damId === 0` under the label
      // "Wild Caught First". That surfaced anything with no recorded parents as
      // wild-caught, which is a claim the data never supported. Now sorts by the
      // stored provenance instead, which is a fact the keeper stated.
      if (sortBy === "tier-unverified") {
        const aUnv = (!a.isBatch && resolveProvenance(a) === PROVENANCE.UNVERIFIED) ? 1 : 0;
        const bUnv = (!b.isBatch && resolveProvenance(b) === PROVENANCE.UNVERIFIED) ? 1 : 0;
        return bUnv - aUnv;
      }
      return 0;
    });

  // Declare paged/row memos here, AFTER filteredAndSortedListings, to avoid TDZ ReferenceError
  const pagedListings = useMemo(() => {
    return filteredAndSortedListings.slice(0, visibleCount);
  }, [filteredAndSortedListings, visibleCount]);

  const rowItems = useMemo(() => {
    return chunkArray(pagedListings, columnsCount);
  }, [pagedListings, columnsCount, chunkArray]);

  // Card photos for the listings currently paged in, resolved through the one §9.3
  // precedence order (hosted → Dexie tankMedia → legacy localStorage → none). The card
  // body renders synchronously, so this resolves into state; a card with no entry yet
  // shows the master species image / silhouette, exactly as it did before when a
  // specimen had no photo. Nothing is substituted for an absent photo.
  const [resolvedCardPhotos, setResolvedCardPhotos] = useState({}); // tokenId -> url
  // `pagedListings` is rebuilt on every render (filteredAndSortedListings is not
  // memoised), so the effect keys off the ids + recorded URLs instead of the array
  // identity — depending on the array would re-resolve and re-setState forever.
  const cardPhotoKey = (pagedListings || [])
    .filter((l) => !l.isBatch && l.tokenId != null)
    .map((l) => `${l.tokenId}|${l.photoUrl || ""}`)
    .join(",");
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const singles = (pagedListings || []).filter((l) => !l.isBatch && l.tokenId != null);
      const entries = await Promise.all(
        singles.map(async (l) => {
          // A cloud-synced listing carries its own recorded copy in `photoUrl` — that is
          // the hosted step's input, which is what makes a photo visible to a buyer who
          // has never had this fish on their device.
          const { url } = await resolveSpecimenPhoto(l.tokenId, { hostedUrl: l.photoUrl || "" });
          return [l.tokenId, url];
        })
      );
      if (!cancelled) {
        setResolvedCardPhotos(Object.fromEntries(entries.filter(([, url]) => url)));
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cardPhotoKey]);

  const rowVirtualizer = useVirtualizer({
    count: rowItems.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 480,
    overscan: 3,
  });

  const virtualItems = rowVirtualizer.getVirtualItems();

  // Reset pagination and scroll back to top when query, sort, or active seller filters change
  // NOTE: This useEffect must be placed AFTER rowVirtualizer is declared to avoid TDZ.
  useEffect(() => {
    setVisibleCount(24);
    try {
      rowVirtualizer.scrollToOffset(0);
    } catch (e) {}
  }, [searchQuery, sortBy, activeSellerFilter, rowVirtualizer]);

  // Infinite Scroll Trigger with a safety margin (5 rows from the end)
  useEffect(() => {
    if (virtualItems.length > 0) {
      const lastItem = virtualItems[virtualItems.length - 1];
      if (lastItem.index >= rowItems.length - 5 && visibleCount < filteredAndSortedListings.length) {
        setVisibleCount((prev) => Math.min(filteredAndSortedListings.length, prev + 24));
      }
    }
  }, [virtualItems, rowItems.length, visibleCount, filteredAndSortedListings.length]);

  if (!walletAccount && listings.length === 0) {
    return (
      <div className="glass-card" style={{ padding: "3rem", textAlign: "center" }}>
        <h2 style={{ marginBottom: "1rem", color: "var(--text-secondary)" }}>Not Connected</h2>
        <p style={{ color: "var(--text-muted)", marginBottom: "1.5rem" }}>
          Connect your account to view and manage marketplace listings.
        </p>
      </div>
    );
  }

  const renderEventAnalytics = () => {
    // 1. Calculate reactive velocity metrics
    const speciesVelocity = [
      { name: "Neon Tetra", base: 50, filterKey: "neon" },
      { name: "Discus", base: 10, filterKey: "discus" },
      { name: "Clownfish", base: 20, filterKey: "clown" },
      { name: "Guppy Batch", base: 100, filterKey: "guppy" }
    ].map(sp => {
      const active = listings.filter(l => l.commonName.toLowerCase().includes(sp.filterKey)).length;
      const base = Math.max(sp.base, active + 10);
      const sold = base - active;
      const pct = Math.round((sold / base) * 100);
      const isHigh = pct >= 50;
      return {
        name: sp.name,
        active,
        sold,
        pct,
        status: isHigh ? "High Velocity 🔥" : "Stable 🌊",
        statusColor: isHigh ? "var(--accent-red)" : "var(--accent-blue)"
      };
    });

    // 2. Fulfillment breakdown.
    //
    // `aquadex_digital_orders_count` HAS NO WRITER anywhere in the codebase. The cash
    // counter is real — CheckoutSummary and HandshakeVerification both increment it on
    // a completed handshake — but its digital counterpart was never implemented, and
    // the gap was hidden behind `|| 12`. So this card showed every seller a flat
    // "12 Digital Escrow orders completed" and a split bar computed from it, on a
    // business dashboard, regardless of what they had actually sold.
    //
    // The `|| 12` is gone rather than replaced with a fabricated alternative. I did
    // NOT add a digital counter, because the only clean write point
    // (`_recordPendingPurchase`) fires when a Stripe SESSION IS CREATED with status
    // "pending" — counting there would book abandoned checkouts as completed sales,
    // which is the same class of lie in the other direction. Which event counts as a
    // completed digital order is a product decision, not a guess to make here.
    const cashOrders = Number(localStorage.getItem("aquadex_cash_orders_count") || 0);
    const digitalOrders = Number(localStorage.getItem("aquadex_digital_orders_count") || 0);
    const totalOrders = cashOrders + digitalOrders;
    // Guard the divide separately from the display: with no orders at all there is no
    // split to show, and `|| 1` previously turned "nothing sold" into a confident
    // 0% / 100% bar.
    const hasFulfillmentData = totalOrders > 0;
    const cashPct = hasFulfillmentData ? Math.round((cashOrders / totalOrders) * 100) : 0;
    const digitalPct = hasFulfillmentData ? 100 - cashPct : 0;

    // 3. Calculate Double XP points
    let eventDoubleXp = 0;
    try {
      const profileStr = localStorage.getItem("aquadex_xp_profile");
      if (profileStr) {
        const profile = JSON.parse(profileStr);
        if (profile.history) {
          profile.history.forEach(item => {
            if (item.action && (item.action.includes("DOUBLE") || item.action.includes("Event") || item.action.includes("Event Double XP"))) {
              eventDoubleXp += Number(item.points || 0);
            }
          });
        }
      }
    } catch (e) {}

    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "2rem", animation: "fadeIn 0.3s ease-out" }}>
        {/* Banner */}
        <div className="glass-card" style={{
          padding: "2rem",
          background: "linear-gradient(135deg, rgba(168, 85, 247, 0.08) 0%, rgba(56, 189, 248, 0.02) 100%)",
          border: "1px solid rgba(168, 85, 247, 0.25)",
          position: "relative",
          overflow: "hidden",
          boxShadow: "0 8px 32px 0 rgba(168, 85, 247, 0.05)"
        }}>
          <h2 style={{ fontSize: "1.75rem", color: "#fff", margin: 0, display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <span>📊</span> Live Expo Sales & Inventory Analytics
          </h2>
          <p style={{ color: "var(--text-secondary)", fontSize: "0.875rem", marginTop: "0.5rem", marginBottom: 0 }}>
            Real-time telemetry tracking velocity metrics, provenance logs, and gamified XP boosters for active swap meets.
          </p>
          <span style={{
            position: "absolute",
            top: "1rem",
            right: "1.5rem",
            fontSize: "0.65rem",
            fontWeight: "700",
            padding: "0.25rem 0.75rem",
            borderRadius: "20px",
            background: "rgba(168, 85, 247, 0.15)",
            border: "1px solid rgba(168, 85, 247, 0.4)",
            color: "#c084fc",
            letterSpacing: "0.05em",
            textTransform: "uppercase"
          }}>
            ⚡ Expo Mode Active
          </span>
        </div>

        {/* Dashboard Grid */}
        <div className="marketplace-dashboard-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: "1.5rem" }}>
          
          {/* Inventory Velocity Card */}
          <div className="glass-card" style={{
            padding: "1.5rem",
            display: "flex",
            flexDirection: "column",
            gap: "1.25rem",
            border: "1px solid rgba(168, 85, 247, 0.2)",
            boxShadow: "0 4px 20px rgba(168, 85, 247, 0.05)"
          }}>
            <h3 style={{ fontSize: "1.1rem", color: "#fff", margin: 0, display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <span>🚀</span> Inventory Velocity Meters
            </h3>
            <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", margin: 0 }}>
              Tracking local breeder stock clearance rates based on directory delta logs.
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
              {speciesVelocity.map((sp, idx) => (
                <div key={idx} style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.8rem" }}>
                    <strong style={{ color: "#fff" }}>{sp.name}</strong>
                    <span style={{ color: sp.statusColor, fontWeight: "600" }}>{sp.status}</span>
                  </div>
                  <div style={{ height: "8px", width: "100%", background: "rgba(255,255,255,0.03)", borderRadius: "4px", overflow: "hidden", border: "1px solid rgba(255,255,255,0.05)" }}>
                    <div style={{ height: "100%", width: `${sp.pct}%`, background: sp.pct >= 50 ? "linear-gradient(90deg, var(--accent-red) 0%, #ef4444 100%)" : "linear-gradient(90deg, var(--accent-blue) 0%, #38bdf8 100%)", borderRadius: "4px" }} />
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.65rem", color: "var(--text-secondary)" }}>
                    <span>{sp.sold} Sold</span>
                    <span>{sp.active} In Directory</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Fulfillment Breakdown Card */}
          <div className="glass-card" style={{
            padding: "1.5rem",
            display: "flex",
            flexDirection: "column",
            gap: "1.25rem",
            border: "1px solid rgba(168, 85, 247, 0.2)",
            boxShadow: "0 4px 20px rgba(168, 85, 247, 0.05)"
          }}>
            <h3 style={{ fontSize: "1.1rem", color: "#fff", margin: 0, display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <span>⚖️</span> Fulfillment Splits
            </h3>
            <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", margin: 0 }}>
              Compare paying in person (cash) with paying securely online.
            </p>
            
            <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem", margin: "auto 0" }}>
              {/* Split Bar — only drawn when there is something to split. */}
              {hasFulfillmentData ? (
                <div style={{ display: "flex", height: "24px", width: "100%", borderRadius: "6px", overflow: "hidden", border: "1px solid rgba(255,255,255,0.05)" }}>
                  <div style={{ width: `${cashPct}%`, background: "var(--accent-green)", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: "0.7rem", fontWeight: "700" }} title="Cash Handshake">
                    {cashPct > 15 ? `${cashPct}%` : ""}
                  </div>
                  <div style={{ width: `${digitalPct}%`, background: "var(--accent-blue)", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: "0.7rem", fontWeight: "700" }} title="Digital Escrow">
                    {digitalPct > 15 ? `${digitalPct}%` : ""}
                  </div>
                </div>
              ) : (
                <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", margin: 0, fontStyle: "italic" }}>
                  No completed orders on this device yet — nothing to compare.
                </p>
              )}

              {/* Legends */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
                <div className="glass-card" style={{ padding: "0.75rem", border: "1px solid rgba(16, 185, 129, 0.15)", background: "rgba(16, 185, 129, 0.02)" }}>
                  <span style={{ display: "block", fontSize: "0.65rem", color: "var(--text-muted)", textTransform: "uppercase" }}>🤝 Cash Handshake</span>
                  <strong style={{ fontSize: "1.25rem", color: "var(--accent-green)", fontFamily: "monospace" }}>{cashOrders}</strong>
                  <span style={{ fontSize: "0.65rem", color: "var(--text-secondary)", display: "block" }}>Orders Completed</span>
                </div>
                <div className="glass-card" style={{ padding: "0.75rem", border: "1px solid rgba(168, 85, 247, 0.25)", background: "rgba(168, 85, 247, 0.02)" }}>
                  <span style={{ display: "block", fontSize: "0.65rem", color: "var(--text-muted)", textTransform: "uppercase" }}>🛜 Digital Escrow</span>
                  <strong style={{ fontSize: "1.25rem", color: "rgba(168, 85, 247, 0.8)", fontFamily: "monospace" }}>{digitalOrders}</strong>
                  <span style={{ fontSize: "0.65rem", color: "var(--text-secondary)", display: "block" }}>Orders Completed</span>
                </div>
              </div>
            </div>
          </div>

          {/* XP Telemetry Metrics Card */}
          <div className="glass-card" style={{
            padding: "1.5rem",
            display: "flex",
            flexDirection: "column",
            gap: "1.25rem",
            border: "1px solid rgba(168, 85, 247, 0.2)",
            boxShadow: "0 4px 20px rgba(168, 85, 247, 0.05)"
          }}>
            <h3 style={{ fontSize: "1.1rem", color: "#fff", margin: 0, display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <span>🎖️</span> Double XP Telemetry
            </h3>
            <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", margin: 0 }}>
              Points earned via active swap meet promotions inside active event zones.
            </p>
            
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "0.75rem", margin: "auto 0", padding: "1rem 0" }}>
              <div style={{
                width: "90px",
                height: "90px",
                borderRadius: "50%",
                background: "radial-gradient(var(--accent-amber-glow) 0%, rgba(0,0,0,0) 70%)",
                border: "2px solid var(--accent-amber)",
                boxShadow: "0 0 20px var(--accent-amber-glow)",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center"
              }}>
                <span style={{ fontSize: "0.6rem", color: "var(--text-muted)", textTransform: "uppercase" }}>Bonus XP</span>
                <strong style={{ fontSize: "1.75rem", color: "var(--accent-amber)", fontFamily: "monospace" }}>+{eventDoubleXp}</strong>
              </div>
              <div style={{ textAlign: "center" }}>
                <strong style={{ display: "block", color: "#fff", fontSize: "0.85rem" }}>Live Event Boost Active</strong>
                <span style={{ fontSize: "0.7rem", color: "var(--text-secondary)" }}>
                  You receive +2x XP points for all local transactions fulfilled within event bounds!
                </span>
              </div>
            </div>
          </div>

        </div>
      </div>
    );
  };

  return (
    <div style={{ maxWidth: "1200px", margin: "0 auto" }}>
      {/* Casual Mode: simple toggle between Store and Looking For */}
      {casualModeActive && (
        <div style={{
          display: "flex",
          background: "rgba(8, 25, 48, 0.6)",
          border: "1px solid rgba(56, 189, 248, 0.12)",
          borderRadius: "10px",
          padding: "0.35rem",
          marginBottom: "1.5rem",
          gap: "0.4rem",
          backdropFilter: "blur(12px)"
        }}>
          <button
            onClick={() => setActiveSubTab("listings")}
            style={{
              flex: 1,
              padding: "0.55rem",
              fontSize: "0.82rem",
              fontWeight: "600",
              border: "none",
              borderRadius: "6px",
              cursor: "pointer",
              background: activeSubTab === "listings" ? "rgba(56, 189, 248, 0.15)" : "transparent",
              color: activeSubTab === "listings" ? "#7dd3fc" : "var(--text-muted)",
              transition: "all 0.2s"
            }}
          >
            🐟 Browse Store
          </button>
          <button
            onClick={() => setActiveSubTab("wanted")}
            style={{
              flex: 1,
              padding: "0.55rem",
              fontSize: "0.82rem",
              fontWeight: "600",
              border: "none",
              borderRadius: "6px",
              cursor: "pointer",
              background: activeSubTab === "wanted" ? "rgba(56, 189, 248, 0.15)" : "transparent",
              color: activeSubTab === "wanted" ? "#7dd3fc" : "var(--text-muted)",
              transition: "all 0.2s"
            }}
          >
            🔍 Looking For
          </button>
        </div>
      )}

      {/* Pro Mode: Sub-Tab Navigation Bar */}
      {!casualModeActive && (
        <div style={{
          display: "flex",
          background: "rgba(15, 23, 42, 0.6)",
          border: "1px solid rgba(168, 85, 247, 0.2)",
          borderRadius: "10px",
          padding: "0.4rem",
          marginBottom: "2rem",
          gap: "0.5rem",
          backdropFilter: "blur(12px)"
        }}>
          <button
            onClick={() => setActiveSubTab("listings")}
            style={{
              flex: 1,
              padding: "0.6rem",
              fontSize: "0.85rem",
              fontWeight: "600",
              border: "none",
              borderRadius: "6px",
              cursor: "pointer",
              background: activeSubTab === "listings" ? "rgba(168, 85, 247, 0.18)" : "transparent",
              color: activeSubTab === "listings" ? "#c084fc" : "var(--text-muted)",
              boxShadow: activeSubTab === "listings" ? "0 0 10px rgba(168, 85, 247, 0.15)" : "none",
              transition: "all 0.2s"
            }}
          >
            🗂️ Active Directory Listings
          </button>
          <button
            onClick={() => setActiveSubTab("wanted")}
            style={{
              flex: 1,
              padding: "0.6rem",
              fontSize: "0.85rem",
              fontWeight: "600",
              border: "none",
              borderRadius: "6px",
              cursor: "pointer",
              background: activeSubTab === "wanted" ? "rgba(168, 85, 247, 0.18)" : "transparent",
              color: activeSubTab === "wanted" ? "#c084fc" : "var(--text-muted)",
              boxShadow: activeSubTab === "wanted" ? "0 0 10px rgba(168, 85, 247, 0.15)" : "none",
              transition: "all 0.2s"
            }}
          >
            🔍 Wanted Board
          </button>
          {/* Event Sales & Inventory Analytics — hidden for launch: the panel's
              data is fabricated (hardcoded velocity, per-device fulfillment,
              always-on XP boost). Gated behind EXPO_ANALYTICS_ENABLED until it's
              rebuilt on real data. See docs/DEFERRED_AND_GATED.md. */}
          {EXPO_ANALYTICS_ENABLED && (
            <button
              onClick={() => setActiveSubTab("analytics")}
              style={{
                flex: 1,
                padding: "0.6rem",
                fontSize: "0.85rem",
                fontWeight: "600",
                border: "none",
                borderRadius: "6px",
                cursor: "pointer",
                background: activeSubTab === "analytics" ? "rgba(168, 85, 247, 0.18)" : "transparent",
                color: activeSubTab === "analytics" ? "#c084fc" : "var(--text-muted)",
                boxShadow: activeSubTab === "analytics" ? "0 0 10px rgba(168, 85, 247, 0.15)" : "none",
                transition: "all 0.2s"
              }}
            >
              📊 Event Sales & Inventory Analytics
            </button>
          )}
        </div>
      )}

      {activeSubTab === "analytics" && EXPO_ANALYTICS_ENABLED ? (
        renderEventAnalytics()
      ) : activeSubTab === "wanted" ? (
        <WantedBoard casualModeActive={casualModeActive} walletAccount={walletAccount} />
      ) : (
        <>
      {activeSellerFilter && (
        <div 
          className="glass-card" 
          style={{ 
            padding: "1.25rem 2rem", 
            marginBottom: "1.5rem", 
            display: "flex", 
            justifyContent: "space-between", 
            alignItems: "center",
            background: "rgba(251, 191, 36, 0.05)",
            border: "1px solid rgba(251, 191, 36, 0.2)",
            boxShadow: "0 8px 32px 0 rgba(251, 191, 36, 0.05)",
            backdropFilter: "blur(8px)",
            borderRadius: "var(--radius-md)",
            animation: "fadeIn 0.3s ease-out"
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
            <span style={{ fontSize: "1.5rem" }}>🤝</span>
            <div>
              <h4 style={{ color: "#fff", margin: 0, fontSize: "0.95rem", fontWeight: "700" }}>
                Consolidated Local Pickup Funnel Active
              </h4>
              <p style={{ color: "var(--text-secondary)", margin: "0.25rem 0 0 0", fontSize: "0.8rem" }}>
                Now displaying only active listings from breeder: <code style={{ color: "var(--accent-amber)", background: "rgba(255,255,255,0.05)", padding: "0.1rem 0.3rem", borderRadius: "4px" }}><SellerName address={activeSellerFilter} /></code>. Add additional specimens to consolidate your pickup trip.
              </p>
            </div>
          </div>
          <button 
            className="btn-secondary"
            onClick={() => setActiveSellerFilter(null)}
            style={{ 
              padding: "0.4rem 1rem", 
              fontSize: "0.75rem", 
              borderColor: "rgba(251, 191, 36, 0.3)", 
              color: "var(--accent-amber)" 
            }}
          >
            Clear Filter
          </button>
        </div>
      )}
      {/* Header Panel */}
      {!filterSpeciesId && (
        <div className="glass-card" style={{ padding: "2rem", marginBottom: "2rem", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "1.5rem" }}>
          <div>
            <h2 style={{ fontSize: "1.75rem", marginBottom: "0.25rem", color: "#fff" }}>
              {casualModeActive ? "Local Breeder Store" : "Available Local Livestock Directory"}
            </h2>
            <p style={{ color: "var(--text-muted)", fontSize: "0.875rem" }}>
              {casualModeActive 
                ? "Purchase healthy, tank-raised specimens directly from verified local hobbyists. Backed by buyer-protected health & live-arrival guarantees."
                : "Zero-cost peer-to-peer exchange catalog. Browse and share documented specimens with verified ancestry."
              }
            </p>
          </div>
          {!casualModeActive && walletAccount && (
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <button className="btn-primary-pro" onClick={() => setIsModalOpen(true)}>
                <Plus size={18} weight="bold" />
                Publish Entry
              </button>
              <button className="btn-secondary" onClick={() => setIsBatchWizardOpen(true)} style={{ fontSize: "0.75rem", padding: "0.4rem 0.75rem" }}>
                🐟 List Fry Batch
              </button>
            </div>
          )}
          {casualModeActive && walletAccount && (
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <button className="btn-primary" onClick={() => setIsModalOpen(true)}>
                <Plus size={18} weight="bold" />
                Sell a Fish
              </button>
              <button className="btn-secondary" onClick={() => setIsBatchWizardOpen(true)} style={{ fontSize: "0.75rem", padding: "0.4rem 0.75rem" }}>
                🐟 Sell Fry Batch
              </button>
            </div>
          )}
        </div>
      )}

      {/* Trust Assurance Glassmorphic Banner */}
      {activeSubTab === "listings" && (
        casualModeActive ? (
          <div style={{
            padding: "1rem 1.5rem",
            marginBottom: "1.5rem",
            background: "linear-gradient(135deg, rgba(34, 197, 94, 0.04) 0%, rgba(56, 189, 248, 0.02) 100%)",
            border: "1px solid rgba(255, 255, 255, 0.08)",
            borderRadius: "var(--radius-md)",
            backdropFilter: "blur(12px)",
            display: "flex",
            flexDirection: "column",
            gap: "0.75rem"
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
              <span style={{ fontSize: "1.2rem", lineHeight: 1 }}>🛡️</span>
              <strong style={{ color: "#34d399", fontSize: "0.85rem" }}>
                Breeder Store Guarantee
              </strong>
              <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginLeft: "auto" }}>
                <span style={{ fontSize: "0.7rem", padding: "0.25rem 0.65rem", borderRadius: "20px", background: "rgba(34,197,94,0.08)", border: "1px solid rgba(34,197,94,0.25)", color: "#34d399", textShadow: "0 0 6px rgba(34,197,94,0.2)", whiteSpace: "nowrap" }}>🛡️ Escrow Health Guarantee</span>
                <span style={{ fontSize: "0.7rem", padding: "0.25rem 0.65rem", borderRadius: "20px", background: "rgba(56,189,248,0.08)", border: "1px solid rgba(56,189,248,0.25)", color: "#7dd3fc", textShadow: "0 0 6px rgba(56,189,248,0.2)", whiteSpace: "nowrap" }}>📦 3-Day Safe Arrival</span>
                {/* REMOVED: a "🤝 Verified Local Breeders" pill (§9.28). The other
                    two pills describe real platform mechanisms — escrow and the
                    arrival window both exist and are enforced. That one asserted
                    something about the sellers that is neither verified nor local,
                    sitting inside a banner headed "Guarantee", which is the worst
                    possible place for an unbacked claim. */}
              </div>
            </div>
            <p style={{ color: "var(--text-secondary)", fontSize: "0.75rem", margin: 0, lineHeight: 1.4 }}>
              Every purchase is protected by smart-contract escrow. Funds are released only after you confirm safe arrival.
            </p>
          </div>
        ) : (
          <div style={{
            padding: "1.25rem 1.75rem",
            marginBottom: "1.5rem",
            background: "linear-gradient(135deg, rgba(168, 85, 247, 0.08) 0%, rgba(56, 189, 248, 0.02) 100%)",
            border: "1px solid rgba(168, 85, 247, 0.25)",
            borderRadius: "var(--radius-md)",
            backdropFilter: "blur(12px)",
            display: "flex",
            alignItems: "center",
            gap: "1.25rem",
            flexWrap: "wrap",
            boxShadow: "0 8px 32px 0 rgba(168, 85, 247, 0.05)"
          }}>
            <span style={{ fontSize: "1.75rem", lineHeight: 1 }}>🛡️</span>
            <div style={{ flex: 1, minWidth: "220px" }}>
              <strong style={{ color: "#c084fc", fontSize: "0.85rem", display: "block", marginBottom: "0.2rem" }}>
                Safe & Trusted Peer-to-Peer Exchange
              </strong>
              <p style={{ color: "var(--text-secondary)", fontSize: "0.75rem", margin: 0, lineHeight: 1.5 }}>
                Every transaction is protected by a <strong style={{ color: "#fff" }}>smart-contract escrow lock</strong> — funds are only released after you confirm receipt. Local pickups use a <strong style={{ color: "#fff" }}>secure handshake PIN</strong> and shipping orders carry a <strong style={{ color: "#fff" }}>3-day delivery safety window</strong> before any funds clear. Fraud protection is built-in.
              </p>
            </div>
            <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
              <span style={{ fontSize: "0.7rem", padding: "0.3rem 0.75rem", borderRadius: "20px", background: "rgba(168,85,247,0.12)", border: "1px solid rgba(168,85,247,0.35)", color: "#c084fc", whiteSpace: "nowrap" }}>🔒 Escrow Protected</span>
              <span style={{ fontSize: "0.7rem", padding: "0.3rem 0.75rem", borderRadius: "20px", background: "rgba(56,189,248,0.10)", border: "1px solid rgba(56,189,248,0.3)", color: "#7dd3fc", whiteSpace: "nowrap" }}>📦 3-Day Safety Window</span>
              <span style={{ fontSize: "0.7rem", padding: "0.3rem 0.75rem", borderRadius: "20px", background: "rgba(251,191,36,0.10)", border: "1px solid rgba(251,191,36,0.3)", color: "#fbbf24", whiteSpace: "nowrap" }}>🤝 Handshake Verified</span>
            </div>
          </div>
        )
      )}

      {/* Controls Bar */}
      <div className="marketplace-controls-bar glass-card" style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        padding: "1rem 1.5rem",
        marginBottom: "2rem",
        borderRadius: "var(--radius-sm)",
        flexWrap: "wrap",
        gap: "1rem",
        ...(!casualModeActive && {
          border: "1px solid rgba(168, 85, 247, 0.2)",
          boxShadow: "0 8px 32px 0 rgba(168, 85, 247, 0.05)"
        })
      }}>
        {/* Search Input */}
        <label htmlFor="marketplace-search-input" style={{ position: "absolute", width: "1px", height: "1px", overflow: "hidden", clip: "rect(0,0,0,0)" }}>
          Search by species common or scientific name
        </label>
        <input
          id="marketplace-search-input"
          type="text"
          placeholder="Search by species common or scientific name..."
          aria-label="Search by species common or scientific name"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          style={{
            flex: "1",
            minWidth: "200px",
            padding: "0.5rem 1rem",
            background: "rgba(255, 255, 255, 0.03)",
            border: casualModeActive ? "1px solid var(--glass-border)" : "1px solid rgba(168, 85, 247, 0.3)",
            borderRadius: "4px",
            color: "#fff",
            fontSize: "0.875rem",
            outline: "none",
            transition: "all 0.2s"
          }}
          onFocus={(e) => {
            if (!casualModeActive) {
              e.target.style.borderColor = "rgba(168, 85, 247, 0.8)";
              e.target.style.boxShadow = "0 0 8px rgba(168, 85, 247, 0.4)";
            }
          }}
          onBlur={(e) => {
            if (!casualModeActive) {
              e.target.style.borderColor = "rgba(168, 85, 247, 0.3)";
              e.target.style.boxShadow = "none";
            }
          }}
        />

        {/* Sort Select */}
        <label htmlFor="marketplace-sort-select" style={{ position: "absolute", width: "1px", height: "1px", overflow: "hidden", clip: "rect(0,0,0,0)" }}>
          Sort listings
        </label>
        <select
          id="marketplace-sort-select"
          aria-label="Sort listings"
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value)}
          style={{
            padding: "0.5rem 1rem",
            background: "rgba(8, 12, 20, 0.9)",
            border: casualModeActive ? "1px solid var(--glass-border)" : "1px solid rgba(168, 85, 247, 0.3)",
            borderRadius: "4px",
            color: "#fff",
            fontSize: "0.875rem",
            outline: "none",
            cursor: "pointer",
            transition: "all 0.2s"
          }}
          onFocus={(e) => {
            if (!casualModeActive) {
              e.target.style.borderColor = "rgba(168, 85, 247, 0.8)";
              e.target.style.boxShadow = "0 0 8px rgba(168, 85, 247, 0.4)";
            }
          }}
          onBlur={(e) => {
            if (!casualModeActive) {
              e.target.style.borderColor = "rgba(168, 85, 247, 0.3)";
              e.target.style.boxShadow = "none";
            }
          }}
        >
          <option value="none">Sort By: Default</option>
          <option value="price-asc">Price: Low to High</option>
          <option value="price-desc">Price: High to Low</option>
          {!casualModeActive && (
            <>
              <option value="tier-purebred">Pedigree Tier: Purebred First</option>
              <option value="tier-unverified">Provenance: Unverified First</option>
            </>
          )}
        </select>

        {/* Filters toggle — reveals the facet-driven filter panel below */}
        <button
          type="button"
          className="btn-secondary"
          onClick={() => setShowFilterPanel((v) => !v)}
          aria-expanded={showFilterPanel}
          aria-controls="marketplace-filter-panel"
          style={{
            padding: "0.5rem 1rem",
            fontSize: "0.875rem",
            borderRadius: "4px",
            background: showFilterPanel ? "rgba(56, 189, 248, 0.12)" : "rgba(255,255,255,0.03)",
            borderColor: showFilterPanel ? "var(--accent-blue)" : "var(--glass-border)",
          }}
        >
          🔎 Filters{(familyFilter !== "all" || careLevelFilter !== "all" || fulfillmentFilter !== "all" || priceMinInput || priceMaxInput) ? " •" : ""}
        </button>

        {casualModeActive && (
          <button 
            className="btn-secondary" 
            onClick={() => setIsWizardOpen(true)}
            style={{ 
              padding: "0.5rem 1rem", 
              background: displayTank ? "rgba(34, 197, 94, 0.15)" : "rgba(255,255,255,0.03)", 
              borderColor: displayTank ? "var(--accent-green)" : "var(--glass-border)",
              color: displayTank ? "var(--accent-green)" : "#fff",
              fontSize: "0.875rem",
              borderRadius: "4px",
              cursor: "pointer"
            }}
          >
            🏡 {displayTank ? `Display Tank: ${displayTank.volume}G | pH ${displayTank.ph} | ${displayTank.temp}°C` : "Set Up My Display Tank"}
          </button>
        )}
      </div>

      {/* Filter Panel — driven by facets from applyCatalogQuery */}
      {showFilterPanel && (
        <div
          id="marketplace-filter-panel"
          className="glass-card"
          style={{
            padding: "1.25rem 1.5rem",
            marginBottom: "1.5rem",
            display: "flex",
            flexWrap: "wrap",
            gap: "1.25rem",
            borderRadius: "var(--radius-sm)",
          }}
        >
          <div>
            <label htmlFor="marketplace-family-filter" style={{ display: "block", fontSize: "0.7rem", color: "var(--text-secondary)", marginBottom: "0.3rem" }}>
              Family
            </label>
            <select
              id="marketplace-family-filter"
              value={familyFilter}
              onChange={(e) => setFamilyFilter(e.target.value)}
              style={{ padding: "0.4rem 0.75rem", background: "rgba(8,12,20,0.9)", border: "1px solid var(--glass-border)", borderRadius: "4px", color: "#fff", fontSize: "0.8rem" }}
            >
              <option value="all">All Families ({Object.values(facets.family).reduce((a, b) => a + b, 0)})</option>
              {Object.entries(facets.family).sort().map(([fam, count]) => (
                <option key={fam} value={fam}>{fam} ({count})</option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="marketplace-care-filter" style={{ display: "block", fontSize: "0.7rem", color: "var(--text-secondary)", marginBottom: "0.3rem" }}>
              Care Level
            </label>
            <select
              id="marketplace-care-filter"
              value={careLevelFilter}
              onChange={(e) => setCareLevelFilter(e.target.value)}
              style={{ padding: "0.4rem 0.75rem", background: "rgba(8,12,20,0.9)", border: "1px solid var(--glass-border)", borderRadius: "4px", color: "#fff", fontSize: "0.8rem" }}
            >
              <option value="all">Any Care Level</option>
              {["0", "1", "2", "3"].map((lvl) => (
                <option key={lvl} value={lvl}>
                  {["Easy", "Medium", "Difficult", "Expert"][Number(lvl)]} ({facets.careLevel[lvl] || 0})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="marketplace-fulfillment-filter" style={{ display: "block", fontSize: "0.7rem", color: "var(--text-secondary)", marginBottom: "0.3rem" }}>
              Fulfillment
            </label>
            <select
              id="marketplace-fulfillment-filter"
              value={fulfillmentFilter}
              onChange={(e) => setFulfillmentFilter(e.target.value)}
              style={{ padding: "0.4rem 0.75rem", background: "rgba(8,12,20,0.9)", border: "1px solid var(--glass-border)", borderRadius: "4px", color: "#fff", fontSize: "0.8rem" }}
            >
              <option value="all">Any Fulfillment</option>
              <option value={FULFILLMENT_TYPES.SHIPPING}>🚚 Ships Nationwide ({facets.fulfillmentType[FULFILLMENT_TYPES.SHIPPING] || 0})</option>
              <option value={FULFILLMENT_TYPES.PICKUP}>📍 Local Pickup ({facets.fulfillmentType[FULFILLMENT_TYPES.PICKUP] || 0})</option>
              <option value={FULFILLMENT_TYPES.LOCAL_DELIVERY}>🚴 Local Delivery ({facets.fulfillmentType[FULFILLMENT_TYPES.LOCAL_DELIVERY] || 0})</option>
            </select>
          </div>

          <div>
            <label htmlFor="marketplace-price-min" style={{ display: "block", fontSize: "0.7rem", color: "var(--text-secondary)", marginBottom: "0.3rem" }}>
              Price Range (USD)
            </label>
            <div style={{ display: "flex", gap: "0.4rem", alignItems: "center" }}>
              <input
                id="marketplace-price-min"
                type="number"
                min="0"
                step="0.01"
                placeholder="Min"
                aria-label="Minimum price in dollars"
                value={priceMinInput}
                onChange={(e) => setPriceMinInput(e.target.value)}
                style={{ width: "70px", padding: "0.4rem 0.5rem", background: "rgba(0,0,0,0.3)", border: "1px solid var(--glass-border)", borderRadius: "4px", color: "#fff", fontSize: "0.8rem" }}
              />
              <span style={{ color: "var(--text-muted)" }}>–</span>
              <label htmlFor="marketplace-price-max" style={{ position: "absolute", width: "1px", height: "1px", overflow: "hidden", clip: "rect(0,0,0,0)" }}>Maximum price in dollars</label>
              <input
                id="marketplace-price-max"
                type="number"
                min="0"
                step="0.01"
                placeholder="Max"
                aria-label="Maximum price in dollars"
                value={priceMaxInput}
                onChange={(e) => setPriceMaxInput(e.target.value)}
                style={{ width: "70px", padding: "0.4rem 0.5rem", background: "rgba(0,0,0,0.3)", border: "1px solid var(--glass-border)", borderRadius: "4px", color: "#fff", fontSize: "0.8rem" }}
              />
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "flex-end" }}>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => {
                setFamilyFilter("all");
                setCareLevelFilter("all");
                setFulfillmentFilter("all");
                setPriceMinInput("");
                setPriceMaxInput("");
              }}
              style={{ padding: "0.4rem 0.75rem", fontSize: "0.75rem" }}
            >
              Clear Filters
            </button>
          </div>

          {/* Saved-search affordance — gated by the saved_search entitlement
              (an earned convenience; browsing/searching itself is never gated). */}
          {walletAccount && hasEntitlement("saved_search", { xp: xpForEntitlements }) && (
            <div style={{ display: "flex", alignItems: "flex-end" }}>
              <button
                type="button"
                className="btn-secondary"
                onClick={saveCurrentSearch}
                style={{ padding: "0.4rem 0.75rem", fontSize: "0.75rem" }}
                title="Save this search for quick access later"
              >
                💾 Save This Search
              </button>
            </div>
          )}
        </div>
      )}

      {/* Confirms a save landed, and confirms an applied saved search. The save
          button previously gave no feedback whatsoever, so a user had no way to
          tell whether it had done anything — which, given nothing could read the
          saved data back, it effectively had not. */}
      {savedSearchNotice && (
        <div
          role="status"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "1rem",
            padding: "0.6rem 1rem",
            marginBottom: "1rem",
            borderRadius: "var(--radius-sm)",
            background: "rgba(52, 211, 153, 0.08)",
            border: "1px solid rgba(52, 211, 153, 0.25)",
            color: "var(--accent-green)",
            fontSize: "0.78rem",
          }}
        >
          <span>{savedSearchNotice}</span>
          <button
            type="button"
            onClick={() => setSavedSearchNotice(null)}
            aria-label="Dismiss"
            style={{
              background: "none",
              border: "none",
              color: "inherit",
              cursor: "pointer",
              fontSize: "0.9rem",
              lineHeight: 1,
            }}
          >
            ✕
          </button>
        </div>
      )}

      {!isOnline && (
        <div
          role="status"
          style={{
            padding: "0.85rem 1.25rem",
            backgroundColor: "rgba(56, 189, 248, 0.08)",
            border: "1px solid rgba(56, 189, 248, 0.25)",
            color: "#7dd3fc",
            borderRadius: "var(--radius-sm)",
            marginBottom: "1.5rem",
            fontSize: "0.82rem",
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
          }}
        >
          <span aria-hidden="true">📡</span>
          <span>You're offline — showing cached listings from your last sync. Prices and availability may be out of date.</span>
        </div>
      )}

      {actionError && (
        <div style={{
          padding: "1rem",
          backgroundColor: "rgba(248, 113, 113, 0.08)",
          border: "1px solid rgba(248, 113, 113, 0.2)",
          color: "var(--accent-red)",
          borderRadius: "var(--radius-sm)",
          marginBottom: "1.5rem",
          fontSize: "0.85rem"
        }}>
          <strong>Directory Alert:</strong> {actionError}
        </div>
      )}

      {error && (
        <div style={{
          padding: "1rem",
          backgroundColor: "rgba(251, 191, 36, 0.08)",
          border: "1px solid rgba(251, 191, 36, 0.2)",
          color: "var(--accent-amber)",
          borderRadius: "var(--radius-sm)",
          marginBottom: "1.5rem",
          fontSize: "0.85rem"
        }}>
          {error} (Using local-first cached offline registry data)
        </div>
      )}

      {loading && listings.length === 0 ? (
        <LoadingSkeleton variant="marketplace" count={6} />
      ) : listings.length === 0 ? (
        <div className="glass-card" style={{ padding: "4rem 2rem", textAlign: "center", border: "1px dashed var(--glass-border)", background: "none" }}>
          <MinusCircle size={48} weight="duotone" color="var(--text-muted)" style={{ marginBottom: "1rem" }} />
          <h3 style={{ color: "var(--text-secondary)", marginBottom: "0.5rem" }}>No Entries Found</h3>
          <p style={{ color: "var(--text-muted)", fontSize: "0.875rem" }}>
            The exchange directory is currently empty. Be the first to publish a specimen card!
          </p>
        </div>
      ) : filteredAndSortedListings.length === 0 ? (
        <div className="glass-card" style={{ padding: "4rem 2rem", textAlign: "center", border: "1px dashed var(--glass-border)", background: "none" }}>
          <MinusCircle size={48} weight="duotone" color="var(--text-muted)" style={{ marginBottom: "1rem" }} />
          <h3 style={{ color: "var(--text-secondary)", marginBottom: "0.5rem" }}>No matching listings</h3>
          <p style={{ color: "var(--text-muted)", fontSize: "0.875rem", marginBottom: "1.25rem" }}>
            No listings match your current search and filters. Try widening your price range or clearing a filter.
          </p>
          <button
            className="btn-secondary"
            onClick={() => {
              setSearchQuery("");
              setFamilyFilter("all");
              setCareLevelFilter("all");
              setFulfillmentFilter("all");
              setPriceMinInput("");
              setPriceMaxInput("");
            }}
            style={{ margin: "0 auto" }}
          >
            Clear search & filters
          </button>
        </div>
      ) : (
        <>
        <div 
          ref={parentRefCallback}
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
                    {row.map((item) => {
                      const isOwner = walletAccount && item.seller.toLowerCase() === walletAccount.toLowerCase();
                      const identifier = item.isBatch ? `batch-${item.listingId}` : item.tokenId;
                      const claiming = actionLoading[identifier];
                      const txHash = actionTxHash[identifier];

                      let pedigreeClass = "";
                      let pedigreeLabel = "";
                      let pedigreeGlowClass = "";
                      let pedigreeBadgeClass = "";

                      if (item.isBatch) {
                        pedigreeClass = "pedigree-f1";
                        pedigreeLabel = "Batch Fry Stock";
                        pedigreeBadgeClass = "badge-blue";
                      } else {
                        // Badge reads STORED provenance. It used to read
                        // "Wild Caught" whenever both parent ids were 0, so a
                        // shop-bought fish was advertised to buyers as wild-caught
                        // founder stock on the strength of a missing field.
                        // See utils/provenance.js.
                        const sireId = Number(item.sireId || 0);
                        const damId = Number(item.damId || 0);
                        pedigreeLabel = provenanceLabel(item, { casual: casualModeActive });

                        if (sireId !== 0 && damId !== 0) {
                          pedigreeClass = "pedigree-purebred";
                          pedigreeGlowClass = "pedigree-purebred-glow";
                          pedigreeBadgeClass = "badge-green";
                        } else if (sireId !== 0 || damId !== 0) {
                          pedigreeClass = "pedigree-f1";
                          pedigreeBadgeClass = "badge-blue";
                        } else {
                          pedigreeClass = "pedigree-wild";
                          pedigreeBadgeClass = "badge-amber";
                        }
                      }

                      const customPhoto = !item.isBatch ? (resolvedCardPhotos[item.tokenId] || null) : null;
                      let additionalPhotos = [];
                      if (!item.isBatch) {
                        try {
                          const stored = localStorage.getItem(`aquadex_specimen_photos_${item.tokenId}`);
                          if (stored) {
                            additionalPhotos = JSON.parse(stored);
                          }
                        } catch (e) {
                          console.warn("Error parsing additional photos:", e);
                        }
                      }
                      // `item.photoUrl` (the cloud-synced copy) is no longer a separate
                      // carousel entry: it is now the hosted input to the resolver above, so
                      // the same image no longer appears twice when a seller has both copies.
                      const allPhotos = [customPhoto, ...additionalPhotos].filter(Boolean);
                      const activePhotoIdx = cardImageIndexMap[identifier] || 0;

                      const matchedSpecies = fishbaseData.find(
                        (f) => f.scientificName.toLowerCase() === (item.scientificName || "").toLowerCase()
                      );
                      const masterPhotoUrl = matchedSpecies?.masterPhotoUrl || "";
                      const finalImgSrc = allPhotos.length > 0 ? (allPhotos[activePhotoIdx] || allPhotos[0]) : masterPhotoUrl;

                      // Compatibility-based card glow (green/amber/red)
                      const compatScore = displayTank ? calculateCompatibility(item) : null;
                      const compatBorderColor = compatScore === null ? null
                        : compatScore >= 80 ? "rgba(34, 197, 94, 0.4)"
                        : compatScore >= 50 ? "rgba(251, 191, 36, 0.4)"
                        : "rgba(248, 113, 113, 0.4)";
                      const compatGlow = compatScore === null ? null
                        : compatScore >= 80 ? "0 0 12px rgba(34, 197, 94, 0.15)"
                        : compatScore >= 50 ? "0 0 12px rgba(251, 191, 36, 0.15)"
                        : "0 0 12px rgba(248, 113, 113, 0.15)";

                      return (
                        <div 
                          key={item.isBatch ? `batch-${item.listingId}` : `spec-${item.tokenId}`} 
                          className={`glass-card ${pedigreeClass}`} 
                          style={{ 
                            padding: "1.5rem", 
                            display: "flex", 
                            flexDirection: "column", 
                            gap: "1rem",
                            background: "rgba(255,255,255,0.01)",
                            ...(compatBorderColor && {
                              borderColor: compatBorderColor,
                              boxShadow: compatGlow,
                            })
                          }}
                        >
                          {/* Photo / Fallback SVG Area */}
                          {(() => {
                            const isPlant = isPlantEntry(matchedSpecies || { specCode: item.speciesId || 0 });
                            const badgeLabel = isPlant ? "🌿 Certified Master Flora" : "🛡️ Breeder-Verified Master Stock";
                            const badgeBg = isPlant ? "rgba(16,185,129,0.18)" : "rgba(56,189,248,0.12)";
                            const badgeBorder = isPlant ? "rgba(16,185,129,0.45)" : "rgba(56,189,248,0.35)";
                            const badgeColor = isPlant ? "#34d399" : "#7dd3fc";
                            const fallbackSvg = isPlant ? (
                              <PlantSilhouetteSVG
                                specCode={item.speciesId || 9001}
                                style={{ width: "100px", height: "100px" }}
                              />
                            ) : (
                              <FishSilhouetteSVG 
                                specimenId={item.isBatch ? item.listingId : item.tokenId} 
                                style={{ width: "120px", height: "120px" }} 
                              />
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
                                marginBottom: "0.5rem",
                                position: "relative",
                                overflow: "hidden",
                                border: isPlant ? "1px solid rgba(16, 185, 129, 0.15)" : "1px solid rgba(255, 255, 255, 0.08)",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center"
                              }}>
                                <LazyImage
                                  src={finalImgSrc}
                                  alt={`Specimen ${item.isBatch ? 'Batch' : item.tokenId}`}
                                  style={{ width: "100%", height: "100%" }}
                                  fallbackSvg={fallbackSvg}
                                />

                                {allPhotos.length > 1 && (
                                  <>
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        const prevIdx = (activePhotoIdx - 1 + allPhotos.length) % allPhotos.length;
                                        setCardImageIndexMap(prev => ({ ...prev, [identifier]: prevIdx }));
                                      }}
                                      style={{
                                        position: "absolute",
                                        left: "0.5rem",
                                        top: "50%",
                                        transform: "translateY(-50%)",
                                        background: "rgba(0, 0, 0, 0.5)",
                                        border: "1px solid rgba(255, 255, 255, 0.2)",
                                        color: "#fff",
                                        borderRadius: "50%",
                                        width: "28px",
                                        height: "28px",
                                        cursor: "pointer",
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: "center",
                                        zIndex: 3,
                                        transition: "all 0.2s ease",
                                        backdropFilter: "blur(4px)",
                                        fontSize: "1rem"
                                      }}
                                      aria-label="Previous photo"
                                    >
                                      &#8249;
                                    </button>
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        const nextIdx = (activePhotoIdx + 1) % allPhotos.length;
                                        setCardImageIndexMap(prev => ({ ...prev, [identifier]: nextIdx }));
                                      }}
                                      style={{
                                        position: "absolute",
                                        right: "0.5rem",
                                        top: "50%",
                                        transform: "translateY(-50%)",
                                        background: "rgba(0, 0, 0, 0.5)",
                                        border: "1px solid rgba(255, 255, 255, 0.2)",
                                        color: "#fff",
                                        borderRadius: "50%",
                                        width: "28px",
                                        height: "28px",
                                        cursor: "pointer",
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: "center",
                                        zIndex: 3,
                                        transition: "all 0.2s ease",
                                        backdropFilter: "blur(4px)",
                                        fontSize: "1rem"
                                      }}
                                      aria-label="Next photo"
                                    >
                                      &#8250;
                                    </button>
                                    <div style={{
                                      position: "absolute",
                                      top: "0.6rem",
                                      left: "50%",
                                      transform: "translateX(-50%)",
                                      display: "flex",
                                      gap: "4px",
                                      zIndex: 3,
                                      background: "rgba(0, 0, 0, 0.3)",
                                      padding: "0.2rem 0.4rem",
                                      borderRadius: "10px",
                                      backdropFilter: "blur(4px)"
                                    }}>
                                      {allPhotos.map((_, dotIdx) => (
                                        <span
                                          key={dotIdx}
                                          style={{
                                            width: "6px",
                                            height: "6px",
                                            borderRadius: "50%",
                                            background: dotIdx === activePhotoIdx ? "var(--accent-pro, #a855f7)" : "rgba(255, 255, 255, 0.35)",
                                            transition: "background 0.2s ease"
                                          }}
                                        />
                                      ))}
                                    </div>
                                  </>
                                )}

                                {/* Save/Watchlist Button */}
                                <button
                                  onClick={(e) => toggleSaveItem(e, item)}
                                  style={{
                                    position: "absolute",
                                    top: "0.5rem",
                                    right: "0.5rem",
                                    width: "30px",
                                    height: "30px",
                                    borderRadius: "50%",
                                    background: isItemSaved(item) ? "rgba(244,63,94,0.15)" : "rgba(0,0,0,0.5)",
                                    backdropFilter: "blur(4px)",
                                    border: isItemSaved(item) ? "1px solid rgba(244,63,94,0.4)" : "1px solid rgba(255,255,255,0.1)",
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    cursor: "pointer",
                                    zIndex: 5,
                                    transition: "all 0.2s ease",
                                    fontSize: "0.85rem",
                                    lineHeight: 1,
                                  }}
                                  title={isItemSaved(item) ? "Remove from saved" : "Save for later"}
                                  aria-label={isItemSaved(item) ? "Remove from saved" : "Save for later"}
                                >
                                  {isItemSaved(item) ? "❤️" : "🤍"}
                                </button>

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

                          {/* Species Header */}
                          <div>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                              <span style={{ fontSize: "0.65rem", color: "var(--text-muted)", letterSpacing: "0.05em", textTransform: "uppercase", fontWeight: "600" }}>
                                {item.isBatch ? "Batch Fry Exchange" : "Specimen Exchange"}
                              </span>
                              {!casualModeActive && (
                                <span className="badge badge-blue" style={{ fontSize: "0.6rem", padding: "0.15rem 0.5rem", fontFamily: "monospace" }}>
                                  {item.isBatch ? `Listing ID: ${item.listingId}` : `Cert. Serial No. ${item.tokenId.toString().padStart(3, "0")}`}
                                </span>
                              )}
                            </div>
                            <h4 style={{ fontSize: "1.1rem", color: "#fff", marginTop: "0.25rem" }}>{item.commonName}</h4>
                            {item.scientificName && (
                              <span style={{ fontSize: "0.75rem", fontStyle: "italic", color: "var(--text-secondary)", display: "block" }}>
                                {item.scientificName}
                              </span>
                            )}
                            
                            {/* Compatibility Badge — shows at all levels when tank is configured */}
                            {displayTank && compatScore !== null && (
                              <div style={{
                                display: "inline-flex",
                                alignItems: "center",
                                gap: "0.4rem",
                                padding: "0.35rem 0.75rem",
                                borderRadius: "50px",
                                background: compatScore >= 80 ? "rgba(34, 197, 94, 0.15)" : compatScore >= 50 ? "rgba(251, 191, 36, 0.12)" : "rgba(248, 113, 113, 0.12)",
                                border: `1px solid ${compatScore >= 80 ? "var(--accent-green)" : compatScore >= 50 ? "rgba(251, 191, 36, 0.5)" : "rgba(248, 113, 113, 0.5)"}`,
                                color: compatScore >= 80 ? "var(--accent-green)" : compatScore >= 50 ? "#fbbf24" : "#f87171",
                                fontSize: "0.7rem",
                                fontWeight: "700",
                                marginTop: "0.5rem"
                              }}>
                                <span style={{ display: "inline-block", width: "8px", height: "8px", borderRadius: "50%", background: compatScore >= 80 ? "var(--accent-green)" : compatScore >= 50 ? "#fbbf24" : "#f87171" }}></span>
                                {compatScore >= 80 ? `[${compatScore}% Compatible]` : compatScore >= 50 ? `[${compatScore}% — Caution]` : `[${compatScore}% — Not Recommended]`}
                              </div>
                            )}

                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "0.5rem", flexWrap: "wrap", gap: "0.5rem" }}>
                              {casualModeActive ? (
                                <>
                                  <span style={{
                                    fontSize: "0.65rem",
                                    fontWeight: "600",
                                    padding: "0.2rem 0.5rem",
                                    borderRadius: "12px",
                                    background: "rgba(34, 197, 94, 0.08)",
                                    border: "1px solid rgba(34, 197, 94, 0.2)",
                                    color: "#34d399",
                                    display: "inline-flex",
                                    alignItems: "center",
                                    gap: "0.25rem",
                                    whiteSpace: "nowrap"
                                  }}>
                                    🏠 Tank-Bred
                                  </span>
                                  <span style={{
                                    fontSize: "0.65rem",
                                    fontWeight: "600",
                                    padding: "0.2rem 0.5rem",
                                    borderRadius: "12px",
                                    background: item.isShipping ? "rgba(56, 189, 248, 0.08)" : "rgba(251, 191, 36, 0.08)",
                                    border: item.isShipping ? "1px solid rgba(56, 189, 248, 0.2)" : "1px solid rgba(251, 191, 36, 0.2)",
                                    color: item.isShipping ? "#7dd3fc" : "#fbbf24",
                                    display: "inline-flex",
                                    alignItems: "center",
                                    gap: "0.25rem",
                                    whiteSpace: "nowrap"
                                  }}>
                                    {item.isShipping ? "🚚 Shipping" : "📍 Local Pickup"}
                                  </span>
                                  {item.careLevel === 0 && (
                                    <span style={{
                                      fontSize: "0.65rem",
                                      fontWeight: "600",
                                      padding: "0.2rem 0.5rem",
                                      borderRadius: "12px",
                                      background: "rgba(34, 211, 238, 0.08)",
                                      border: "1px solid rgba(34, 211, 238, 0.2)",
                                      color: "#22d3ee",
                                      display: "inline-flex",
                                      alignItems: "center",
                                      gap: "0.25rem",
                                      whiteSpace: "nowrap"
                                    }}>
                                      ✨ Beginner Friendly
                                    </span>
                                  )}
                                </>
                              ) : (
                                <>
                                  <span className={`badge ${pedigreeBadgeClass} ${pedigreeGlowClass}`} style={{ fontSize: "0.6rem", padding: "0.15rem 0.5rem" }}>
                                    {pedigreeLabel}
                                  </span>
                                  {item.isShipping ? (
                                    <span className="badge badge-blue" style={{ fontSize: "0.6rem", padding: "0.15rem 0.5rem" }}>
                                      🚚 Ships Nationwide — rate quoted at checkout
                                    </span>
                                  ) : (
                                    <span className="badge badge-amber" style={{ fontSize: "0.6rem", padding: "0.15rem 0.5rem" }}>
                                      📍 Local Pickup
                                    </span>
                                  )}
                                </>
                              )}
                            </div>
                          </div>

                          {/* Ancestry & Lineage Metadata / Batch details */}
                          {!casualModeActive && !item.isBatch && (
                            <div style={{
                              padding: "0.75rem",
                              background: "rgba(255,255,255,0.02)",
                              borderRadius: "4px",
                              fontSize: "0.75rem",
                              display: "flex",
                              flexDirection: "column",
                              gap: "0.35rem"
                            }}>
                              <span style={{ fontSize: "0.65rem", color: "var(--text-muted)", textTransform: "uppercase", fontWeight: "600" }}>Lineage Records:</span>
                              <div style={{ display: "flex", justifyContent: "space-between" }}>
                                <span>Sire (Father):</span>
                                {item.sireId !== 0 ? (
                                  <button 
                                    onClick={(e) => { e.stopPropagation(); onLineageSelect(item.sireId); }}
                                    style={{ background: "none", border: "none", color: "var(--accent-blue)", textDecoration: "underline", padding: 0, cursor: "pointer", fontSize: "0.75rem" }}
                                  >
                                    Cert. Serial No. {item.sireId.toString().padStart(3, "0")}
                                  </button>
                                ) : (
                                  <span style={{ color: "var(--text-muted)" }}>Unknown (Wild)</span>
                                )}
                              </div>
                              <div style={{ display: "flex", justifyContent: "space-between" }}>
                                <span>Dam (Mother):</span>
                                {item.damId !== 0 ? (
                                  <button 
                                    onClick={(e) => { e.stopPropagation(); onLineageSelect(item.damId); }}
                                    style={{ background: "none", border: "none", color: "var(--accent-blue)", textDecoration: "underline", padding: 0, cursor: "pointer", fontSize: "0.75rem" }}
                                  >
                                    Cert. Serial No. {item.damId.toString().padStart(3, "0")}
                                  </button>
                                ) : (
                                  <span style={{ color: "var(--text-muted)" }}>Unknown (Wild)</span>
                                )}
                              </div>
                            </div>
                          )}

                          {!casualModeActive && item.isBatch && (
                            <div style={{
                              padding: "0.75rem",
                              background: "rgba(255,255,255,0.02)",
                              borderRadius: "4px",
                              fontSize: "0.75rem",
                              display: "flex",
                              flexDirection: "column",
                              gap: "0.35rem"
                            }}>
                              <span style={{ fontSize: "0.65rem", color: "var(--text-muted)", textTransform: "uppercase", fontWeight: "600" }}>Batch Records:</span>
                              <div style={{ display: "flex", justifyContent: "space-between" }}>
                                <span>Spawn Event ID:</span>
                                <strong style={{ color: "#fff" }}>{item.spawnId}</strong>
                              </div>
                              <div style={{ display: "flex", justifyContent: "space-between" }}>
                                <span>Available Juveniles:</span>
                                <strong style={{ color: "#fff" }}>{item.quantity} fry</strong>
                              </div>
                            </div>
                          )}

                          {/* Enhanced Specimen Details — visible to buyers */}
                          {(item.description || item.age || item.size || item.diet || item.temperament || item.healthStatus) && (
                            <div style={{
                              padding: "0.75rem",
                              background: "rgba(255,255,255,0.02)",
                              borderRadius: "6px",
                              fontSize: "0.75rem",
                              display: "flex",
                              flexDirection: "column",
                              gap: "0.4rem",
                              border: "1px solid rgba(255,255,255,0.04)"
                            }}>
                              <span style={{ fontSize: "0.65rem", color: "var(--text-muted)", textTransform: "uppercase", fontWeight: "600" }}>Specimen Details:</span>

                              {/* Age & Size chips */}
                              {(item.age || item.size) && (
                                <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>
                                  {item.age && (
                                    <span style={{ fontSize: "0.65rem", padding: "0.15rem 0.45rem", borderRadius: "10px", background: "rgba(56,189,248,0.08)", border: "1px solid rgba(56,189,248,0.2)", color: "#7dd3fc" }}>
                                      📅 {item.age}
                                    </span>
                                  )}
                                  {item.size && (
                                    <span style={{ fontSize: "0.65rem", padding: "0.15rem 0.45rem", borderRadius: "10px", background: "rgba(168,85,247,0.08)", border: "1px solid rgba(168,85,247,0.2)", color: "#c4b5fd" }}>
                                      📏 {item.size}
                                    </span>
                                  )}
                                  {item.temperament && (
                                    <span style={{ fontSize: "0.65rem", padding: "0.15rem 0.45rem", borderRadius: "10px", background: "rgba(34,197,94,0.08)", border: "1px solid rgba(34,197,94,0.2)", color: "#34d399" }}>
                                      {item.temperament === "Peaceful" ? "🕊️" : item.temperament === "Aggressive" ? "⚔️" : item.temperament === "Schooling" ? "🐠" : "⚡"} {item.temperament}
                                    </span>
                                  )}
                                </div>
                              )}

                              {/* Diet */}
                              {item.diet && (
                                <div style={{ display: "flex", justifyContent: "space-between" }}>
                                  <span style={{ color: "var(--text-muted)" }}>Diet:</span>
                                  <span style={{ color: "#fff" }}>{item.diet}</span>
                                </div>
                              )}

                              {/* Water params */}
                              {(item.minTemp > 0 || item.minPh > 0 || item.tankSizeMin > 0) && (
                                <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginTop: "0.15rem" }}>
                                  {item.minTemp > 0 && item.maxTemp > 0 && (
                                    <span style={{ fontSize: "0.6rem", padding: "0.1rem 0.35rem", borderRadius: "4px", background: "rgba(251,191,36,0.06)", border: "1px solid rgba(251,191,36,0.15)", color: "#fbbf24" }}>
                                      🌡️ {item.minTemp}–{item.maxTemp}°F
                                    </span>
                                  )}
                                  {item.minPh > 0 && item.maxPh > 0 && (
                                    <span style={{ fontSize: "0.6rem", padding: "0.1rem 0.35rem", borderRadius: "4px", background: "rgba(56,189,248,0.06)", border: "1px solid rgba(56,189,248,0.15)", color: "#7dd3fc" }}>
                                      💧 pH {item.minPh}–{item.maxPh}
                                    </span>
                                  )}
                                  {item.tankSizeMin > 0 && (
                                    <span style={{ fontSize: "0.6rem", padding: "0.1rem 0.35rem", borderRadius: "4px", background: "rgba(34,211,238,0.06)", border: "1px solid rgba(34,211,238,0.15)", color: "#22d3ee" }}>
                                      🏠 {item.tankSizeMin}+ gal
                                    </span>
                                  )}
                                </div>
                              )}

                              {/* Health & DOA */}
                              {(item.healthStatus || item.doaGuarantee !== undefined) && (
                                <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap", marginTop: "0.15rem" }}>
                                  {item.healthStatus && item.healthStatus !== "healthy" && (
                                    <span style={{ fontSize: "0.6rem", padding: "0.15rem 0.45rem", borderRadius: "10px", background: item.healthStatus === "treated" ? "rgba(251,191,36,0.08)" : "rgba(248,113,113,0.08)", border: item.healthStatus === "treated" ? "1px solid rgba(251,191,36,0.2)" : "1px solid rgba(248,113,113,0.2)", color: item.healthStatus === "treated" ? "#fbbf24" : "#f87171" }}>
                                      {item.healthStatus === "treated" ? "💊 Recently Treated" : "🔬 In Quarantine"}
                                    </span>
                                  )}
                                  {item.healthStatus === "healthy" && (
                                    <span style={{ fontSize: "0.6rem", padding: "0.15rem 0.45rem", borderRadius: "10px", background: "rgba(34,197,94,0.08)", border: "1px solid rgba(34,197,94,0.2)", color: "#34d399" }}>
                                      ✅ Healthy
                                    </span>
                                  )}
                                  {item.doaGuarantee && (
                                    <span style={{ fontSize: "0.6rem", padding: "0.15rem 0.45rem", borderRadius: "10px", background: "rgba(34,197,94,0.08)", border: "1px solid rgba(34,197,94,0.2)", color: "#34d399" }}>
                                      🛡️ DOA Guarantee
                                    </span>
                                  )}
                                </div>
                              )}

                              {/* Description */}
                              {item.description && (
                                <p style={{ margin: "0.25rem 0 0 0", color: "var(--text-secondary)", fontSize: "0.72rem", lineHeight: 1.4, fontStyle: "italic" }}>
                                  "{item.description.length > 120 ? item.description.slice(0, 120) + "..." : item.description}"
                                </p>
                              )}
                            </div>
                          )}

                          {/* Listing pricing detail & actions */}
                          <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", borderTop: "1px solid rgba(255,255,255,0.05)", paddingTop: "0.75rem", marginTop: "auto" }}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                              <div>
                                <span style={{ fontSize: "0.65rem", color: "var(--text-muted)", display: "block", textTransform: "uppercase" }}>
                                  {item.isBatch ? "Price Per Fish" : "Exchange Price"}
                                </span>
                                <strong style={{ fontSize: "1.2rem", color: "var(--accent-green)", fontFamily: "monospace" }}>
                                  ${parseFloat(item.priceUsd ?? item.price ?? 0).toFixed(2)}
                                </strong>
                              </div>

                              {item.isBatch && (
                                <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
                                  <label style={{ fontSize: "0.7rem", color: "var(--text-secondary)" }}>Qty:</label>
                                  <input 
                                    type="number"
                                    min="1"
                                    max={item.quantity}
                                    value={checkoutQuantityMap[item.listingId] || 1}
                                    onChange={(e) => {
                                      const val = Math.min(item.quantity, Math.max(1, Number(e.target.value)));
                                      setCheckoutQuantityMap(prev => ({ ...prev, [item.listingId]: val }));
                                    }}
                                    onClick={(e) => e.stopPropagation()}
                                    style={{ width: "50px", background: "rgba(0,0,0,0.3)", border: "1px solid rgba(255,255,255,0.08)", color: "#fff", borderRadius: "4px", padding: "0.25rem 0.4rem", textAlign: "center", outline: "none", fontSize: "0.75rem" }}
                                  />
                                </div>
                              )}
                            </div>

                            <button
                              className="btn-secondary"
                              onClick={(e) => { e.stopPropagation(); openProductDetail(item); }}
                              style={{ width: "100%", padding: "0.35rem 1rem", fontSize: "0.7rem", justifyContent: "center" }}
                            >
                              🔍 View Details
                            </button>

                            {isOwner ? (
                              <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
                                <div style={{ display: "flex", gap: "0.5rem" }}>
                                  {!casualModeActive && (
                                    <button 
                                      className="btn-primary-pro" 
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setEditingItem(item);
                                      }}
                                      style={{ flex: 1, padding: "0.4rem", fontSize: "0.75rem", justifyContent: "center" }}
                                    >
                                      Edit Listing
                                    </button>
                                  )}
                                  <button 
                                    className="btn-secondary" 
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      if (item.isBatch) {
                                        handleCancelBatchListing(item.listingId);
                                      } else {
                                        handleCancelListing(item.tokenId);
                                      }
                                  }}
                                  disabled={claiming}
                                  style={{ flex: 1, padding: "0.4rem", fontSize: "0.75rem", justifyContent: "center" }}
                                >
                                  {claiming ? (casualModeActive ? "Removing..." : "Withdrawing...") : (casualModeActive ? "Remove Listing" : "Withdraw Entry")}
                                </button>
                                </div>
                                {/* Boost / Analytics row for owners */}
                                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.5rem" }}>
                                  <span style={{ fontSize: "0.62rem", color: "var(--text-muted)" }}>
                                    👁 {(() => { try { const v = JSON.parse(localStorage.getItem('aquadex_listing_views') || '{}'); return v[`${item.isBatch ? 'b' : 's'}-${item.id}`] || 0; } catch { return 0; } })()} views
                                  </span>
                                  {!item.isBoosted && (
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        // Mark as boosted in local listing
                                        const id = item.isBatch ? item.listingId : item.tokenId;
                                        import("../db").then(({ db }) => {
                                          db.localListings.update(Number(id), { isBoosted: true, boostedAt: Date.now() });
                                          import("../services/cloudSync").then(({ syncListingToCloud }) => {
                                            syncListingToCloud({ ...item, isBoosted: true, boostedAt: Date.now() }).catch(() => {});
                                          });
                                          fetchListings();
                                        });
                                      }}
                                      style={{ fontSize: "0.6rem", padding: "0.2rem 0.5rem", background: "rgba(251,191,36,0.08)", border: "1px solid rgba(251,191,36,0.2)", color: "#fbbf24", borderRadius: "6px", cursor: "pointer", fontWeight: "600" }}
                                    >
                                      ⚡ Boost Listing
                                    </button>
                                  )}
                                  {item.isBoosted && (
                                    <span style={{ fontSize: "0.6rem", padding: "0.2rem 0.5rem", background: "rgba(251,191,36,0.08)", border: "1px solid rgba(251,191,36,0.2)", color: "#fbbf24", borderRadius: "6px", fontWeight: "600" }}>
                                      ⚡ Boosted
                                    </span>
                                  )}
                                </div>
                              </div>
                            ) : (
                              <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
                                <button 
                                  className={casualModeActive ? "btn-primary" : "btn-primary-pro"} 
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (item.isBatch) {
                                      handlePurchaseBatch(item.listingId, checkoutQuantityMap[item.listingId] || 1, item.price);
                                    } else {
                                      if (onSelectCheckoutOrder) {
                                        onSelectCheckoutOrder("pending_purchase", item.tokenId);
                                      }
                                    }
                                  }}
                                  disabled={claiming || !walletAccount}
                                  style={{ width: "100%", padding: "0.4rem 1rem", fontSize: "0.75rem", justifyContent: "center" }}
                                >
                                  {claiming ? (casualModeActive ? "Purchasing..." : "Securing...") : (casualModeActive ? "Buy Now" : "Secure Livestock")}
                                </button>
                                <button
                                  className="btn-secondary"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    addToCart(item, item.isBatch ? (checkoutQuantityMap[item.listingId] || 1) : 1);
                                  }}
                                  disabled={!walletAccount}
                                  style={{ width: "100%", padding: "0.35rem 1rem", fontSize: "0.7rem", justifyContent: "center" }}
                                >
                                  🛒 Add to Cart
                                </button>
                                <button
                                  className="btn-secondary"
                                  onClick={(e) => { e.stopPropagation(); setOfferListing(item); }}
                                  disabled={!walletAccount}
                                  style={{ width: "100%", padding: "0.35rem 1rem", fontSize: "0.7rem", justifyContent: "center" }}
                                >
                                  💬 Make an Offer
                                </button>
                                {/* Ask the breeder a question before buying — keeps the
                                    conversation (and the sale) on-platform. */}
                                {walletAccount && item.seller &&
                                  item.seller.toLowerCase() !== walletAccount.toLowerCase() && (
                                  <button
                                    className="btn-secondary"
                                    onClick={async (e) => {
                                      e.stopPropagation();
                                      try {
                                        const { data } = await getOrCreateConversation(item.seller);
                                        if (data?.id) {
                                          window.dispatchEvent(new CustomEvent("aquadex_open_conversation", {
                                            detail: { conversationId: data.id, targetWallet: item.seller },
                                          }));
                                        }
                                      } catch (err) {
                                        console.warn("[MarketplaceBoard] Ask the breeder failed:", err);
                                      }
                                    }}
                                    style={{ width: "100%", padding: "0.35rem 1rem", fontSize: "0.7rem", justifyContent: "center" }}
                                  >
                                    🐟 Ask the breeder
                                  </button>
                                )}
                                {/* Consolidated-shipping nudge: same breeder, one box. */}
                                {(() => {
                                  const alreadyFiltered =
                                    activeSellerFilter && item.seller &&
                                    activeSellerFilter.toLowerCase() === item.seller.toLowerCase();
                                  if (alreadyFiltered || !item.seller) return null;
                                  const others = listings.filter((l) =>
                                    l.seller &&
                                    l.seller.toLowerCase() === item.seller.toLowerCase() &&
                                    (l.isBatch
                                      ? l.listingId !== item.listingId
                                      : Number(l.tokenId) !== Number(item.tokenId))
                                  ).length;
                                  if (others <= 0) return null;
                                  return (
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        if (setActiveSellerFilter) setActiveSellerFilter(item.seller);
                                      }}
                                      title="Buy more from this breeder in one shipping box"
                                      style={{
                                        width: "100%",
                                        marginTop: "0.15rem",
                                        padding: "0.3rem 0.6rem",
                                        fontSize: "0.62rem",
                                        color: "#7dd3fc",
                                        background: "rgba(56,189,248,0.06)",
                                        border: "1px dashed rgba(56,189,248,0.3)",
                                        borderRadius: "6px",
                                        cursor: "pointer",
                                        textAlign: "center",
                                      }}
                                    >
                                      📦 {others} more from this breeder — {casualModeActive ? "add them and ship together" : "consolidate into one shipment"}
                                    </button>
                                  );
                                })()}
                              </div>
                            )}
                          </div>

                          {/* Telemetry/Tx status */}
                          {txHash && (
                            <div style={{ fontSize: "0.65rem", color: "var(--accent-blue)", background: "var(--accent-blue-glow)", padding: "0.35rem", borderRadius: "4px", textAlign: "center" }}>
                              Confirmed — syncing your purchase...
                            </div>
                          )}

                          {/* Seller info row — masked in Casual Mode */}
                          <div style={{ fontSize: "0.65rem", color: "var(--text-muted)", display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "0.25rem" }}>
                            <span>{casualModeActive ? "🧑‍🌾 Breeder:" : "🧑‍🌾 Listed by:"}</span>
                            {/* The seller's name, in both modes. Casual mode used to
                                replace it with a hardcoded "✅ Verified Local
                                Breeder" on EVERY listing — a verification claim and
                                a locality claim, neither of which was checked, shown
                                to the readers least equipped to question it (§9.28).
                                Fabricated proximity was already retired once from the
                                Fish Finder (Decision D3); this was the same claim
                                surviving in casual mode.

                                `SellerName` is casual-safe on its own: it resolves a
                                display name, then a local alias, then a generated
                                alias, and never renders a raw address. */}
                            <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
                              <span style={{ color: "var(--text-secondary)", fontWeight: "600" }}><SellerName address={item.seller} /></span>
                              <SellerChipLoader sellerAddress={item.seller} scientificName={item.scientificName} />
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
          {visibleCount < filteredAndSortedListings.length && (
            <div style={{ height: "60px", display: "flex", justifyContent: "center", alignItems: "center", marginTop: "1rem" }}>
              <div className="shimmer-placeholder" style={{ width: "120px", height: "12px", borderRadius: "10px" }} />
            </div>
          )}
        </div>
        </>
      )}
      </>
      )}

      {/* Display Tank Wizard Modal */}
      {isWizardOpen && (
        <div style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: "rgba(0,0,0,0.75)",
          backdropFilter: "blur(8px)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 2000,
          padding: "1rem"
        }}>
          <div className="glass-card" style={{
            width: "100%",
            maxWidth: "400px",
            padding: "2rem",
            background: "var(--bg-secondary)",
            border: "1px solid var(--accent-blue)"
          }}>
            <h3 style={{ color: "#fff", marginBottom: "1rem" }}>🏡 Display Tank Setup Wizard</h3>
            <p style={{ fontSize: "0.8rem", color: "var(--text-secondary)", marginBottom: "1.25rem" }}>
              Configure your home display aquarium parameters to check compatibility matches with breeder listings.
            </p>

            <form onSubmit={(e) => {
              e.preventDefault();
              setDisplayTank({
                volume: wizardVolume,
                ph: wizardPh,
                temp: wizardTemp
              });
              setIsWizardOpen(false);
            }} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
              <div>
                <label style={{ display: "block", fontSize: "0.75rem", color: "var(--text-secondary)", marginBottom: "0.25rem" }}>Tank Volume (Gallons)</label>
                <input 
                  type="number" 
                  value={wizardVolume}
                  onChange={(e) => setWizardVolume(e.target.value)}
                  required
                  style={{ width: "100%", padding: "0.5rem", background: "rgba(255,255,255,0.03)", border: "1px solid var(--glass-border)", color: "#fff", borderRadius: "4px" }}
                />
              </div>

              <div>
                <label style={{ display: "block", fontSize: "0.75rem", color: "var(--text-secondary)", marginBottom: "0.25rem" }}>Estimated Tap pH</label>
                <input 
                  type="number" 
                  step="0.1"
                  value={wizardPh}
                  onChange={(e) => setWizardPh(e.target.value)}
                  required
                  style={{ width: "100%", padding: "0.5rem", background: "rgba(255,255,255,0.03)", border: "1px solid var(--glass-border)", color: "#fff", borderRadius: "4px" }}
                />
              </div>

              <div>
                <label style={{ display: "block", fontSize: "0.75rem", color: "var(--text-secondary)", marginBottom: "0.25rem" }}>Water Temperature (°C)</label>
                <input 
                  type="number" 
                  step="0.5"
                  value={wizardTemp}
                  onChange={(e) => setWizardTemp(e.target.value)}
                  required
                  style={{ width: "100%", padding: "0.5rem", background: "rgba(255,255,255,0.03)", border: "1px solid var(--glass-border)", color: "#fff", borderRadius: "4px" }}
                />
              </div>

              <div style={{ display: "flex", gap: "0.5rem", marginTop: "1rem" }}>
                <button type="submit" className="btn-primary" style={{ flex: 1, justifyContent: "center" }}>
                  Save Profile
                </button>
                <button type="button" className="btn-secondary" style={{ flex: 1 }} onClick={() => setIsWizardOpen(false)}>
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* List Modal Integration */}
      <ListSpecimenModal 
        isOpen={isModalOpen}
        onClose={() => {
          setIsModalOpen(false);
          if (onClearPreselectedList) onClearPreselectedList();
        }}
        contractAddress={contractAddress}
        marketplaceAddress={marketplaceAddress}
        walletAccount={walletAccount}
        onSuccess={fetchListings}
        preselectedListSpecimen={preselectedListSpecimen}
        preselectedListTank={preselectedListTank}
      />

      {/* Edit Modal Integration */}
      <EditListingModal 
        isOpen={!!editingItem}
        onClose={() => setEditingItem(null)}
        item={editingItem}
        onSuccess={fetchListings}
      />

      {/* Batch Listing Wizard */}
      <BatchListingWizard
        isOpen={isBatchWizardOpen}
        onClose={() => setIsBatchWizardOpen(false)}
        walletAccount={walletAccount}
        onSuccess={fetchListings}
      />

      {/* Offer Modal */}
      <OfferModal
        isOpen={!!offerListing}
        onClose={() => setOfferListing(null)}
        listing={offerListing}
        walletAccount={walletAccount}
        casualModeActive={casualModeActive}
        onSuccess={() => setOfferListing(null)}
      />

      {/* Product Detail Modal — deep-linkable by listing id (?listing=<key>) */}
      <ProductDetailModal
        listing={selectedProductListing}
        notFound={productNotFound}
        speciesRecord={
          selectedProductListing
            ? fishbaseData.find((f) => f.scientificName?.toLowerCase() === (selectedProductListing.scientificName || "").toLowerCase())
            : undefined
        }
        displayTank={displayTank}
        walletAccount={walletAccount}
        casualModeActive={casualModeActive}
        onClose={closeProductDetail}
        onBuyNow={(item) => {
          closeProductDetail();
          if (!onSelectCheckoutOrder) return;
          if (item.isBatch) {
            handlePurchaseBatch(item.listingId, checkoutQuantityMap[item.listingId] || 1);
          } else {
            onSelectCheckoutOrder("pending_purchase", item.tokenId);
          }
        }}
        onAddToCart={(item) => {
          addToCart(item, item.isBatch ? (checkoutQuantityMap[item.listingId] || 1) : 1);
          closeProductDetail();
        }}
      />
    </div>
  );
}
