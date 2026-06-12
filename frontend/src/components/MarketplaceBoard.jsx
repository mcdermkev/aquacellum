import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ethers, Contract } from "ethers";
import aquadexAbi from "../abi/AquadexManager.json";
import marketplaceAbi from "../abi/AquadexMarketplace.json";
import { ListSpecimenModal } from "./ListSpecimenModal";
import { addXp, XP_ACTIONS } from "../utils/xp";
import { getProvider } from "../utils/smartAccount";
import { relayPurchaseSpecimen, relayPurchaseBatch, relayCancelListing, relayCancelBatchListing } from "../services/relayer";
import { FishSilhouetteSVG, PlantSilhouetteSVG } from "./SilhouetteSVG";
import { fetchListingsByBreed } from "../utils/listingManager";
import { useSpeciesSearch } from "../hooks/useSpeciesSearch";
import { LazyImage } from "./LazyImage";
import { useMarketplaceListings } from "../hooks/useMarketplaceListings";
import { LoadingSkeleton } from "./LoadingSkeleton";

// Helper: detect if a fishbase record or specCode is a plant entry
const isPlantEntry = (specCodeOrItem) => {
  if (typeof specCodeOrItem === "object" && specCodeOrItem !== null) {
    return specCodeOrItem.type === "plant";
  }
  return false;
};

import { mapContractError } from "../utils/errorHandler";

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
  setActiveSellerFilter
}) {
  const { data: fetchedListings = [], isLoading: listingsLoading, error: listingsError, refetch: refetchListings } = useMarketplaceListings(contractAddress, marketplaceAddress, filterSpeciesId);
  const listings = fetchedListings;
  const loading = listingsLoading;
  const error = listingsError ? (listingsError.message || "Failed to load listings") : null;
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [activeSubTab, setActiveSubTab] = useState("listings"); // "listings" | "analytics"
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
  const [userLocation, setUserLocation] = useState({ lat: 37.7749, lng: -122.4194 }); // Default SF

  const { 
    results: searchedListings, 
    searchTerm: searchQuery, 
    setSearchTerm: setSearchQuery,
    globalData: cachedGlobalData 
  } = useSpeciesSearch(listings, {
    keys: [
      { name: "commonName", weight: 0.8 },
      { name: "scientificName", weight: 0.7 }
    ],
    threshold: 0.35
  });

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
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setUserLocation({
            lat: position.coords.latitude,
            lng: position.coords.longitude
          });
        },
        (err) => {
          console.warn("Geolocation blocked/failed, using default center.", err);
        }
      );
    }
  }, []);

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

  const calculateCompatibility = (item) => {
    if (!displayTank) return 0;
    const nameKey = item.scientificName ? item.scientificName.toLowerCase() : "";
    const metrics = fishbaseLookup[nameKey];
    const minVol = metrics?.minVolumeGallons ?? 30;

    const simVolume = Number(displayTank.volume);
    const simPh = Number(displayTank.ph);
    const simTemp = Number(displayTank.temp);

    let pVol = 0;
    if (simVolume < minVol) {
      pVol = ((minVol - simVolume) / minVol) * 100;
    }

    let pPh = 0;
    if (simPh < item.minPh) {
      pPh = ((item.minPh - simPh) / 1.5) * 100;
    } else if (simPh > item.maxPh) {
      pPh = ((simPh - item.maxPh) / 1.5) * 100;
    }
    pPh = Math.min(100, pPh);

    let pTemp = 0;
    if (simTemp < item.minTemp) {
      pTemp = ((item.minTemp - simTemp) / 5.0) * 100;
    } else if (simTemp > item.maxTemp) {
      pTemp = ((simTemp - item.maxTemp) / 5.0) * 100;
    }
    pTemp = Math.min(100, pTemp);

    const sVol = Math.max(0, 100 - pVol);
    const sPh = Math.max(0, 100 - pPh);
    const sTemp = Math.max(0, 100 - pTemp);

    const rawScore = (sVol / 100) * (sPh / 100) * (sTemp / 100) * 100;
    return Math.round(rawScore);
  };

  const getZoneHash = (item) => {
    let zoneHash = null;
    if (!item.isBatch && item.tokenId) {
      const metaStr = localStorage.getItem(`aquadex_specimen_metadata_${item.tokenId}`);
      if (metaStr) {
        try {
          const meta = JSON.parse(metaStr);
          zoneHash = meta.zoneHash || meta.ZoneHash;
        } catch (e) {}
      }
    }
    
    if (!zoneHash) {
      // Deterministic fallback using keccak256 hash of the breeder's address
      try {
        zoneHash = keccak256(item.seller);
      } catch (e) {
        // Fallback simple string hash offset
        let hash = 0;
        for (let i = 0; i < item.seller.length; i++) {
          hash = item.seller.charCodeAt(i) + ((hash << 5) - hash);
        }
        zoneHash = "0x" + Math.abs(hash).toString(16).padStart(8, "0");
      }
    }
    return zoneHash;
  };

  const getDistanceForListing = (item) => {
    const zHash = getZoneHash(item);
    let cleanHash = zHash.replace("0x", "");
    
    let part1 = parseInt(cleanHash.substring(0, 8), 16) || 0;
    let part2 = parseInt(cleanHash.substring(8, 16), 16) || 0;
    
    // Fuzz latitude and longitude offset within ~5-7 miles
    const latOffset = ((part1 & 0xFF) / 255 - 0.5) * 0.08;
    const lngOffset = ((part2 & 0xFF) / 255 - 0.5) * 0.08;
    
    const latMiles = latOffset * 69;
    const lngMiles = lngOffset * 55;
    const distance = Math.sqrt(latMiles * latMiles + lngMiles * lngMiles);
    return distance;
  };

  // Legacy listing loading useEffect replaced by React Query useMarketplaceListings hook

  useEffect(() => {
    if (preselectedListSpecimen) {
      setIsModalOpen(true);
    }
  }, [preselectedListSpecimen]);

  const fetchListings = async () => {
    await refetchListings();
  };

  const handleClaimExchange = async (tokenId, priceEther, isShipping, shippingFeeEther) => {
    setActionError(null);
    setActionLoading((prev) => ({ ...prev, [tokenId]: true }));
    setActionTxHash((prev) => ({ ...prev, [tokenId]: null }));

    try {
      const listing = listings.find(l => Number(l.tokenId) === Number(tokenId)) || {};

      // Beta: purchase locally (no MetaMask, no gas)
      const result = await relayPurchaseSpecimen({
        tokenId,
        buyer: walletAccount,
        seller: listing.seller || "",
        priceEth: priceEther,
        shippingFeeEth: shippingFeeEther || "0",
        isShipping,
        commonName: listing.commonName || "Specimen",
      });
      if (!result.success) throw new Error(result.error || "Purchase failed");

      // Trigger XP Telemetry & Toast
      addXp(XP_ACTIONS.CLAIM_EXCHANGE?.points, XP_ACTIONS.CLAIM_EXCHANGE?.label);

      // Route to CheckoutSummary
      if (onSelectCheckoutOrder) {
        onSelectCheckoutOrder("shipping", tokenId);
      } else {
        await fetchListings();
      }
    } catch (err) {
      console.error("Exchange failed:", err);
      setActionError(mapContractError(err, casualModeActive));
    } finally {
      setActionLoading((prev) => ({ ...prev, [tokenId]: false }));
      setActionTxHash((prev) => ({ ...prev, [tokenId]: null }));
    }
  };

  const handlePurchaseBatch = async (listingId, quantity, pricePerFishEther) => {
    setActionError(null);
    setActionLoading(prev => ({ ...prev, [`batch-${listingId}`]: true }));
    setActionTxHash(prev => ({ ...prev, [`batch-${listingId}`]: null }));
    
    try {
      const listing = listings.find(l => Number(l.listingId || l.id) === Number(listingId)) || {};

      // Beta: purchase batch locally (no MetaMask, no gas)
      const result = await relayPurchaseBatch({
        listingId,
        quantity,
        buyer: walletAccount,
        seller: listing.seller || "",
        pricePerFishEth: pricePerFishEther,
        commonName: listing.commonName || "Juvenile Fry Batch",
      });
      if (!result.success) throw new Error(result.error || "Batch purchase failed");

      addXp(XP_ACTIONS.CLAIM_EXCHANGE?.points, XP_ACTIONS.CLAIM_EXCHANGE?.label);

      const purchaseId = result.purchaseId;
      if (onSelectCheckoutOrder && purchaseId) {
        onSelectCheckoutOrder("batch", purchaseId);
      } else {
        await fetchListings();
      }
    } catch (err) {
      console.error("Batch purchase failed:", err);
      setActionError(mapContractError(err, casualModeActive));
    } finally {
      setActionLoading(prev => ({ ...prev, [`batch-${listingId}`]: false }));
      setActionTxHash(prev => ({ ...prev, [`batch-${listingId}`]: null }));
    }
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

  const filteredAndSortedListings = [...searchedListings]
    .filter((item) => {
      if (activeSellerFilter && item.seller) {
        if (item.seller.toLowerCase() !== activeSellerFilter.toLowerCase()) {
          return false;
        }
      }
      return true;
    })
    .sort((a, b) => {
      if (sortBy === "price-asc") {
        return parseFloat(a.price) - parseFloat(b.price);
      }
      if (sortBy === "price-desc") {
        return parseFloat(b.price) - parseFloat(a.price);
      }
      if (sortBy === "tier-purebred") {
        const aPure = (!a.isBatch && a.sireId !== 0 && a.damId !== 0) ? 1 : 0;
        const bPure = (!b.isBatch && b.sireId !== 0 && b.damId !== 0) ? 1 : 0;
        return bPure - aPure;
      }
      if (sortBy === "tier-wild") {
        const aWild = (!a.isBatch && a.sireId === 0 && a.damId === 0) ? 1 : 0;
        const bWild = (!b.isBatch && b.sireId === 0 && b.damId === 0) ? 1 : 0;
        return bWild - aWild;
      }
      if (sortBy === "closest") {
        const distA = getDistanceForListing(a);
        const distB = getDistanceForListing(b);
        return distA - distB;
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

    // 2. Calculate fulfillment breakdown
    const cashOrders = Number(localStorage.getItem("aquadex_cash_orders_count") || 0);
    const digitalOrders = Number(localStorage.getItem("aquadex_digital_orders_count") || 12);
    const totalOrders = cashOrders + digitalOrders || 1;
    const cashPct = Math.round((cashOrders / totalOrders) * 100);
    const digitalPct = 100 - cashPct;

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
          background: "linear-gradient(135deg, rgba(16, 185, 129, 0.08) 0%, rgba(56, 189, 248, 0.02) 100%)",
          border: "1px solid rgba(16, 185, 129, 0.25)",
          position: "relative",
          overflow: "hidden"
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
            background: "rgba(16, 185, 129, 0.15)",
            border: "1px solid rgba(16, 185, 129, 0.4)",
            color: "var(--accent-green)",
            letterSpacing: "0.05em",
            textTransform: "uppercase"
          }}>
            ⚡ Expo Mode Active
          </span>
        </div>

        {/* Dashboard Grid */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: "1.5rem" }}>
          
          {/* Inventory Velocity Card */}
          <div className="glass-card" style={{ padding: "1.5rem", display: "flex", flexDirection: "column", gap: "1.25rem" }}>
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
          <div className="glass-card" style={{ padding: "1.5rem", display: "flex", flexDirection: "column", gap: "1.25rem" }}>
            <h3 style={{ fontSize: "1.1rem", color: "#fff", margin: 0, display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <span>⚖️</span> Fulfillment Splits
            </h3>
            <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", margin: 0 }}>
              Comparing physical Cash Handshake bypasses against digital escrow settlements.
            </p>
            
            <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem", margin: "auto 0" }}>
              {/* Split Bar */}
              <div style={{ display: "flex", height: "24px", width: "100%", borderRadius: "6px", overflow: "hidden", border: "1px solid rgba(255,255,255,0.05)" }}>
                <div style={{ width: `${cashPct}%`, background: "var(--accent-green)", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: "0.7rem", fontWeight: "700" }} title="Cash Handshake">
                  {cashPct > 15 ? `${cashPct}%` : ""}
                </div>
                <div style={{ width: `${digitalPct}%`, background: "var(--accent-blue)", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: "0.7rem", fontWeight: "700" }} title="Digital Escrow">
                  {digitalPct > 15 ? `${digitalPct}%` : ""}
                </div>
              </div>

              {/* Legends */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
                <div className="glass-card" style={{ padding: "0.75rem", border: "1px solid rgba(16, 185, 129, 0.15)", background: "rgba(16, 185, 129, 0.02)" }}>
                  <span style={{ display: "block", fontSize: "0.65rem", color: "var(--text-muted)", textTransform: "uppercase" }}>🤝 Cash Handshake</span>
                  <strong style={{ fontSize: "1.25rem", color: "var(--accent-green)", fontFamily: "monospace" }}>{cashOrders}</strong>
                  <span style={{ fontSize: "0.65rem", color: "var(--text-secondary)", display: "block" }}>Orders Completed</span>
                </div>
                <div className="glass-card" style={{ padding: "0.75rem", border: "1px solid rgba(56, 189, 248, 0.15)", background: "rgba(56, 189, 248, 0.02)" }}>
                  <span style={{ display: "block", fontSize: "0.65rem", color: "var(--text-muted)", textTransform: "uppercase" }}>🛜 Digital Escrow</span>
                  <strong style={{ fontSize: "1.25rem", color: "var(--accent-blue)", fontFamily: "monospace" }}>{digitalOrders}</strong>
                  <span style={{ fontSize: "0.65rem", color: "var(--text-secondary)", display: "block" }}>Orders Completed</span>
                </div>
              </div>
            </div>
          </div>

          {/* XP Telemetry Metrics Card */}
          <div className="glass-card" style={{ padding: "1.5rem", display: "flex", flexDirection: "column", gap: "1.25rem" }}>
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
      {/* Sub-Tab Navigation Bar */}
      {!casualModeActive && (
        <div style={{
          display: "flex",
          background: "rgba(30, 41, 59, 0.4)",
          border: "1px solid rgba(255, 255, 255, 0.05)",
          borderRadius: "8px",
          padding: "0.4rem",
          marginBottom: "2rem",
          gap: "0.5rem"
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
              background: activeSubTab === "listings" ? "rgba(56, 189, 248, 0.15)" : "transparent",
              color: activeSubTab === "listings" ? "var(--accent-blue)" : "var(--text-muted)",
              transition: "all 0.2s"
            }}
          >
            🗂️ Active Directory Listings
          </button>
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
              background: activeSubTab === "analytics" ? "rgba(16, 185, 129, 0.15)" : "transparent",
              color: activeSubTab === "analytics" ? "var(--accent-green)" : "var(--text-muted)",
              transition: "all 0.2s"
            }}
          >
            📊 Event Sales & Inventory Analytics
          </button>
        </div>
      )}

      {activeSubTab === "analytics" ? (
        renderEventAnalytics()
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
                Now displaying only active listings from breeder: <code style={{ color: "var(--accent-amber)", background: "rgba(255,255,255,0.05)", padding: "0.1rem 0.3rem", borderRadius: "4px", fontFamily: "monospace" }}>{activeSellerFilter}</code>. Add additional specimens to consolidate your pickup trip.
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
                ? "Purchase healthy, tank-raised specimens directly from verified local hobbyists. Supported by escrow-backed health & live-arrival guarantees."
                : "Zero-cost peer-to-peer exchange catalog. Browse and share documented specimens with verified ancestry."
              }
            </p>
          </div>
          {!casualModeActive && walletAccount && (
            <button className="btn-primary" onClick={() => setIsModalOpen(true)}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12h14M12 5v14"/>
              </svg>
              Publish Entry
            </button>
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
                <span style={{ fontSize: "0.7rem", padding: "0.25rem 0.65rem", borderRadius: "20px", background: "rgba(251,191,36,0.08)", border: "1px solid rgba(251,191,36,0.25)", color: "#fbbf24", textShadow: "0 0 6px rgba(251,191,36,0.2)", whiteSpace: "nowrap" }}>🤝 Verified Local Breeders</span>
              </div>
            </div>
            <p style={{ color: "var(--text-secondary)", fontSize: "0.75rem", margin: 0, lineHeight: 1.4 }}>
              Every purchase is protected by smart-contract escrow. Funds are released only after you confirm safe arrival.
            </p>
          </div>
        ) : (
          <div style={{
            padding: "1rem 1.5rem",
            marginBottom: "1.5rem",
            background: "linear-gradient(135deg, rgba(34, 197, 94, 0.06) 0%, rgba(56, 189, 248, 0.04) 100%)",
            border: "1px solid rgba(34, 197, 94, 0.22)",
            borderRadius: "var(--radius-md)",
            backdropFilter: "blur(12px)",
            display: "flex",
            alignItems: "center",
            gap: "1.25rem",
            flexWrap: "wrap"
          }}>
            <span style={{ fontSize: "1.75rem", lineHeight: 1 }}>🛡️</span>
            <div style={{ flex: 1, minWidth: "220px" }}>
              <strong style={{ color: "#34d399", fontSize: "0.85rem", display: "block", marginBottom: "0.2rem" }}>
                Safe & Trusted Peer-to-Peer Exchange
              </strong>
              <p style={{ color: "var(--text-secondary)", fontSize: "0.75rem", margin: 0, lineHeight: 1.5 }}>
                Every transaction is protected by a <strong style={{ color: "#fff" }}>smart-contract escrow lock</strong> — funds are only released after you confirm receipt. Local pickups use a <strong style={{ color: "#fff" }}>secure handshake PIN</strong> and shipping orders carry a <strong style={{ color: "#fff" }}>3-day delivery safety window</strong> before any funds clear. Fraud protection is built-in.
              </p>
            </div>
            <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
              <span style={{ fontSize: "0.7rem", padding: "0.3rem 0.75rem", borderRadius: "20px", background: "rgba(34,197,94,0.12)", border: "1px solid rgba(34,197,94,0.35)", color: "#34d399", whiteSpace: "nowrap" }}>🔒 Escrow Protected</span>
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
        gap: "1rem"
      }}>
        {/* Search Input */}
        <input
          type="text"
          placeholder="Search by species common or scientific name..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          style={{
            flex: "1",
            minWidth: "200px",
            padding: "0.5rem 1rem",
            background: "rgba(255, 255, 255, 0.03)",
            border: "1px solid var(--glass-border)",
            borderRadius: "4px",
            color: "#fff",
            fontSize: "0.875rem"
          }}
        />

        {/* Sort Select */}
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value)}
          style={{
            padding: "0.5rem 1rem",
            background: "rgba(8, 12, 20, 0.9)",
            border: "1px solid var(--glass-border)",
            borderRadius: "4px",
            color: "#fff",
            fontSize: "0.875rem"
          }}
        >
          <option value="none">Sort By: Default</option>
          <option value="price-asc">Price: Low to High</option>
          <option value="price-desc">Price: High to Low</option>
          {!casualModeActive && (
            <>
              <option value="tier-purebred">Pedigree Tier: Purebred First</option>
              <option value="tier-wild">Pedigree Tier: Wild Caught First</option>
            </>
          )}
          <option value="closest">Closest to Me</option>
        </select>

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
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginBottom: "1rem" }}>
            <circle cx="12" cy="12" r="10" />
            <path d="M8 12h8" />
          </svg>
          <h3 style={{ color: "var(--text-secondary)", marginBottom: "0.5rem" }}>No Entries Found</h3>
          <p style={{ color: "var(--text-muted)", fontSize: "0.875rem" }}>
            The exchange directory is currently empty. Be the first to publish a specimen card!
          </p>
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
                        const sireId = Number(item.sireId || 0);
                        const damId = Number(item.damId || 0);
                        if (sireId === 0 && damId === 0) {
                          pedigreeClass = "pedigree-wild";
                          pedigreeLabel = "Wild Caught";
                          pedigreeBadgeClass = "badge-amber";
                        } else if ((sireId !== 0 && damId === 0) || (sireId === 0 && damId !== 0)) {
                          pedigreeClass = "pedigree-f1";
                          pedigreeLabel = "Ancestral F1";
                          pedigreeBadgeClass = "badge-blue";
                        } else {
                          pedigreeClass = "pedigree-purebred";
                          pedigreeLabel = "Purebred Pedigree";
                          pedigreeGlowClass = "pedigree-purebred-glow";
                          pedigreeBadgeClass = "badge-green";
                        }
                      }

                      const customPhoto = !item.isBatch ? localStorage.getItem(`aquadex_specimen_photo_${item.tokenId}`) : null;
                      const matchedSpecies = fishbaseData.find(
                        (f) => f.scientificName.toLowerCase() === (item.scientificName || "").toLowerCase()
                      );
                      const masterPhotoUrl = matchedSpecies?.masterPhotoUrl || "";
                      const finalImgSrc = customPhoto || masterPhotoUrl;

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
                          onClick={() => {
                            if (onSelectCheckoutOrder) {
                              if (item.isBatch) {
                                onSelectCheckoutOrder("batch", item.listingId);
                              } else {
                                onSelectCheckoutOrder("shipping", item.tokenId);
                              }
                            }
                          }}
                          style={{ 
                            padding: "1.5rem", 
                            display: "flex", 
                            flexDirection: "column", 
                            gap: "1rem",
                            background: "rgba(255,255,255,0.01)",
                            cursor: "pointer",
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
                                      {item.commonName.toLowerCase().includes("discus") 
                                        ? "🚚 Secured Flat Rate Shipping" 
                                        : `🚚 Shipping (+$${(parseFloat(item.shippingFee) * 1000).toFixed(2)})`}
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

                          {/* Listing pricing detail & actions */}
                          <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", borderTop: "1px solid rgba(255,255,255,0.05)", paddingTop: "0.75rem", marginTop: "auto" }}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                              <div>
                                <span style={{ fontSize: "0.65rem", color: "var(--text-muted)", display: "block", textTransform: "uppercase" }}>
                                  {item.isBatch ? "Price Per Fish" : "Exchange Price"}
                                </span>
                                <strong style={{ fontSize: "1.2rem", color: "var(--accent-green)", fontFamily: "monospace" }}>
                                  ${(parseFloat(item.price) * 1000).toFixed(2)}
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

                            {isOwner ? (
                              <div style={{ display: "flex", gap: "0.5rem" }}>
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
                            ) : (
                              <button 
                                className="btn-primary" 
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
                                {claiming ? (casualModeActive ? "Purchasing..." : "Securing...") : (casualModeActive ? "Purchase" : "Secure Livestock")}
                              </button>
                            )}
                          </div>

                          {/* Telemetry/Tx status */}
                          {txHash && (
                            <div style={{ fontSize: "0.65rem", color: "var(--accent-blue)", background: "var(--accent-blue-glow)", padding: "0.35rem", borderRadius: "4px", textAlign: "center" }}>
                              Tx Confirmed... waiting on blockchain
                            </div>
                          )}

                          {/* Seller info row — masked in Casual Mode */}
                          <div style={{ fontSize: "0.65rem", color: "var(--text-muted)", display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "0.25rem" }}>
                            <span>{casualModeActive ? "🧑‍🌾 Breeder:" : "🧑‍🌾 Listed by:"}</span>
                            {casualModeActive ? (
                              <span style={{ color: "#34d399", fontWeight: "600" }}>✅ Verified Local Breeder</span>
                            ) : (
                              <span style={{ fontFamily: "monospace", color: "var(--text-secondary)" }}>{item.seller?.slice(0,6)}…{item.seller?.slice(-4)}</span>
                            )}
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
    </div>
  );
}
