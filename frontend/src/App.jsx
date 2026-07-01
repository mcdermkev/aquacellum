import React, { useState, useEffect, useRef, lazy, Suspense } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import "./styles/index.css";
import "./styles/storefront-setup.css";
import { GlobeHemisphereWest } from "@phosphor-icons/react";
import { ConnectWallet } from "./components/ConnectWallet";
import { SpecimenDetailModal } from "./components/SpecimenDetailModal";
import { getLevelInfo, getXp } from "./utils/xp";
import { haptic } from "./utils/haptics";
import { getSmartAccountAddress, getProvider } from "./utils/smartAccount";
import { ethers } from "ethers";
import { useQueryClient } from "@tanstack/react-query";
import managerAbi from "./abi/AquadexManager.json";
import marketplaceAbi from "./abi/AquadexMarketplace.json";
import { useXPSync } from "./hooks/useXPSync";
import { LandingHobbyist } from "./components/LandingHobbyist";
import { LandingBreeder } from "./components/LandingBreeder";
import { ModeSegmentedControl } from "./components/ModeSegmentedControl";
import { OnboardingWizard } from "./components/OnboardingWizard";
import { useOnboardingGate } from "./hooks/useOnboardingGate";
import { useAuth } from "./contexts/AuthContext";
import { pullCloudDataForWallet, pushAllLocalDataToCloud } from "./services/cloudSync";
import { ZoneLeaderboardWidget } from "./components/ZoneLeaderboardWidget";
import { RewardCreditsCard } from "./components/RewardCreditsCard";
import { EchoCompanionWidget } from "./components/EchoCompanionWidget";
import { EchoWhispers } from "./components/EchoWhispers";
import { EchoAmbient } from "./components/EchoAmbient";
import { useEchoState } from "./hooks/useEchoState";
import { useEchoRareMoments } from "./hooks/useEchoRareMoments";
import { BetaBanner } from "./components/BetaBanner";
import { db } from "./db";
import { TabErrorBoundary } from "./components/TabErrorBoundary";
import { NetworkStatusBanner } from "./components/NetworkStatusBanner";
import { FeedbackWidget } from "./components/FeedbackWidget";
import { PoseidonGlobalWidget } from "./components/PoseidonGlobalWidget";
import { WhatsNewModal } from "./components/WhatsNewModal";
import { IncomingBadge } from "./components/IncomingBadge";
import { useArrivalNudge } from "./hooks/useArrivalNudge";
import { initGrowoutReminders } from "./utils/growoutReminders";
import {
  CONTRACT_ADDRESS,
  MARKETPLACE_ADDRESS,
  FOUNDER_WALLETS,
  FOUNDER_WALLET_PATTERNS,
  VALID_TABS,
  isFounderWallet,
  formatSyncTime,
} from "./config/appConfig";


// ── Code-split tab views ───────────────────────────────────────────────────
// Each main tab is lazy-loaded so it ships as its own chunk instead of bloating
// the entry bundle. They render inside the existing <Suspense> boundary around
// renderContent(), which shows a skeleton fallback while a chunk loads.
const TankList = lazy(() =>
  import("./components/TankList").then((m) => ({ default: m.TankList }))
);
const BreederTools = lazy(() =>
  import("./components/BreederTools").then((m) => ({ default: m.BreederTools }))
);
const MarketplaceBoard = lazy(() =>
  import("./components/MarketplaceBoard").then((m) => ({ default: m.MarketplaceBoard }))
);
const BreedGallery = lazy(() =>
  import("./components/BreedGallery").then((m) => ({ default: m.BreedGallery }))
);
const LocalBreederMap = lazy(() =>
  import("./components/LocalBreederMap").then((m) => ({ default: m.LocalBreederMap }))
);
const CheckoutSummary = lazy(() =>
  import("./components/CheckoutSummary").then((m) => ({ default: m.CheckoutSummary }))
);
const IncomingSpecimens = lazy(() =>
  import("./components/IncomingSpecimens").then((m) => ({ default: m.IncomingSpecimens }))
);
const DataPortabilityWidget = lazy(() =>
  import("./components/DataPortabilityWidget").then((m) => ({ default: m.DataPortabilityWidget }))
);
const FoundersDashboard = lazy(() =>
  import("./components/FoundersDashboard").then((m) => ({ default: m.FoundersDashboard }))
);

// Lazy-load The Reef social layer (code-split for performance)
const ReefFeed = lazy(() =>
  import("./components/reef").then((m) => ({ default: m.ReefFeed }))
);

// Lazy-load Storefront Setup (only needed for beta breeders)
const StorefrontSetup = lazy(() =>
  import("./components/StorefrontSetup").then((m) => ({ default: m.StorefrontSetup }))
);

// Lazy-load Echo Living Companion (full-screen interactive experience)
const EchoLivingCompanion = lazy(() =>
  import("./components/EchoLivingCompanion").then((m) => ({ default: m.EchoLivingCompanion }))
);

// Lazy-load Echo Rare Moment Overlay (special animation events)
const EchoRareMomentOverlay = lazy(() =>
  import("./components/EchoRareMomentOverlay").then((m) => ({ default: m.EchoRareMomentOverlay }))
);

export default function App() {
  const { account, ready, authenticated, getAccessToken } = useAuth();
  const queryClient = useQueryClient();
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  // Initialize Poseidon grow-out checkpoint reminders (PWA notifications)
  useEffect(() => { initGrowoutReminders(); }, []);

  // Cloud sync: on login, pull cloud data to this device then push any local-only data up.
  // This is what makes tanks appear on any device the user signs in to.
  const runCloudSync = async (walletAddr, signal) => {
    setSyncStatus("syncing");
    try {
      await pullCloudDataForWallet(walletAddr);
      if (signal?.cancelled) return;
      await pushAllLocalDataToCloud(walletAddr);
      if (!signal?.cancelled) {
        queryClient.invalidateQueries({ queryKey: ["tanks", walletAddr] });
        setSyncStatus("success");
        const now = new Date();
        setLastSyncedAt(now);
        localStorage.setItem("aquadex_last_synced", now.toISOString());
        // Auto-dismiss success after 3s
        setTimeout(() => setSyncStatus((s) => s === "success" ? null : s), 3000);
      }
    } catch (e) {
      console.warn("[CloudSync] Login sync failed:", e.message);
      if (!signal?.cancelled) {
        setSyncStatus("failed");
      }
    }
  };

  useEffect(() => {
    if (!account) return;
    const signal = { cancelled: false };
    runCloudSync(account, signal);
    return () => { signal.cancelled = true; };
  }, [account]); // eslint-disable-line react-hooks/exhaustive-deps

  // Set up ethers event listeners for reactive background refetching
  useEffect(() => {
    if (!account) return;

    let managerContract = null;
    let marketplaceContract = null;

    try {
      const provider = getProvider();
      managerContract = new ethers.Contract(CONTRACT_ADDRESS, managerAbi, provider);
      marketplaceContract = new ethers.Contract(MARKETPLACE_ADDRESS, marketplaceAbi, provider);

      const invalidateTanks = () => {
        queryClient.invalidateQueries({ queryKey: ["tanks", account] });
        queryClient.invalidateQueries({ queryKey: ["contractSpecies", CONTRACT_ADDRESS] });
      };

      const invalidateSpeciesCatalog = () => {
        queryClient.invalidateQueries({ queryKey: ["contractSpecies", CONTRACT_ADDRESS] });
      };

      const invalidateListings = () => {
        queryClient.invalidateQueries({ queryKey: ["listings"] });
      };

      // Listen to the most important events
      managerContract.on("SpecimenRegistered", invalidateTanks);
      managerContract.on("SpeciesAdded", invalidateSpeciesCatalog);
      marketplaceContract.on("SpecimenListed", invalidateListings);
      marketplaceContract.on("ListingCancelled", invalidateListings);
      marketplaceContract.on("SpecimenPurchased", invalidateListings);

      return () => {
        if (managerContract) {
          managerContract.off("SpecimenRegistered", invalidateTanks);
          managerContract.off("SpeciesAdded", invalidateSpeciesCatalog);
        }
        if (marketplaceContract) {
          marketplaceContract.off("SpecimenListed", invalidateListings);
          marketplaceContract.off("ListingCancelled", invalidateListings);
          marketplaceContract.off("SpecimenPurchased", invalidateListings);
        }
      };
    } catch (err) {
      console.warn("Aquadex: Failed to initialize event listeners for cache invalidation:", err);
    }
  }, [account, queryClient]);

  // Resolve smart wallet address for founder check (smart wallet differs from EOA)
  const [smartWalletForFounderCheck, setSmartWalletForFounderCheck] = useState(null);
  useEffect(() => {
    if (!account) { setSmartWalletForFounderCheck(null); return; }
    let cancelled = false;
    const resolve = async () => {
      try {
        const { getSmartWalletAddress, hasUserSigner } = await import("./services/smartAccountClient");
        // Wait briefly for signer to be registered
        if (!hasUserSigner()) await new Promise(r => setTimeout(r, 1500));
        const addr = await getSmartWalletAddress();
        if (!cancelled) setSmartWalletForFounderCheck(addr);
      } catch (err) {
        console.warn("[App] Smart wallet resolve for founder check failed:", err);
      }
    };
    resolve();
    return () => { cancelled = true; };
  }, [account]);

  const isFounder = isFounderWallet(account, smartWalletForFounderCheck);

  // Storefront beta: all authenticated users can access "My Store" during closed beta
  const isStorefrontBeta = !!account;

  // ─── Router-driven tab state ──────────────────────────────────────────────
  // The active tab is derived from the URL path (/app/<tab>) instead of local
  // state + URL hash. This gives real URLs, deep-linking, and proper
  // back/forward without full page reloads.
  const navigate = useNavigate();
  const location = useLocation();
  const tabFromPath = location.pathname.replace(/^\/app\/?/, "").split("/")[0];
  const activeTab = VALID_TABS.includes(tabFromPath) ? tabFromPath : "tanks";

  // Navigate to a tab while preserving any query string (e.g. ?view=breeder).
  // Reads window.location.search at call time so it stays correct even when
  // invoked from event handlers registered once on mount.
  const goToTab = (tab) => {
    navigate(`/app/${tab}${window.location.search}`);
  };

  // Backward-compat: redirect legacy hash deep links (/app#directory) and bare
  // /app to the canonical path-based route. Runs once on mount.
  useEffect(() => {
    const hash = window.location.hash.replace("#", "");
    if (VALID_TABS.includes(hash)) {
      navigate(`/app/${hash}${window.location.search}`, { replace: true });
    } else if (!VALID_TABS.includes(tabFromPath)) {
      navigate(`/app/tanks${window.location.search}`, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [preselectedLineageId, setPreselectedLineageId] = useState(null);
  const [breederToolsSection, setBreederToolsSection] = useState("register");
  const [selectedBreedId, setSelectedBreedId] = useState(null);
  const [gallerySelectedBreed, setGallerySelectedBreed] = useState(null);
  const [preselectedListSpecimen, setPreselectedListSpecimen] = useState(null);
  const [preselectedListTank, setPreselectedListTank] = useState(null);
  const [xp, setXp] = useState(() => getXp());
  const [toasts, setToasts] = useState([]);
  const [syncStatus, setSyncStatus] = useState(null); // null | "syncing" | "failed" | "success"
  const [lastSyncedAt, setLastSyncedAt] = useState(() => {
    const saved = localStorage.getItem("aquadex_last_synced");
    return saved ? new Date(saved) : null;
  });
  const [casualModeActive, setCasualModeActive] = useState(() => {
    const saved = localStorage.getItem("aquadex_casual_mode");
    if (saved !== null) return saved === "true";
    return false;
  });
  const [enteredDashboard, setEnteredDashboard] = useState(() => {
    return localStorage.getItem("aquadex_entered_dashboard") === "true";
  });
  // Per-account onboarding gate (replaces the old localStorage-only check).
  // `loading` lets us avoid flashing the wizard before the per-account flag resolves.
  // TODO: Re-enable once mobile onboarding bug is fixed
  // const { showOnboarding, loading: onboardingLoading } = useOnboardingGate(account);
  const showOnboarding = false;
  const onboardingLoading = false;
  const [postedFirstCurrent, setPostedFirstCurrent] = useState(() => {
    return localStorage.getItem("aquadex_posted_first_current") === "true";
  });

  useEffect(() => {
    const handleFirstCurrentPosted = () => {
      setPostedFirstCurrent(true);
    };
    window.addEventListener("aquadex_first_current_posted", handleFirstCurrentPosted);
    return () => window.removeEventListener("aquadex_first_current_posted", handleFirstCurrentPosted);
  }, []);
  const [triggerLoginOnEntry, setTriggerLoginOnEntry] = useState(false);
  // View mode (hobbyist | breeder) is derived from the ?view= query param.
  // location.search updates on router navigation and browser back/forward, so
  // no manual popstate listener is needed.
  const viewParam = new URLSearchParams(location.search).get("view") || "hobbyist";
  const [displayTank, setDisplayTank] = useState(() => {
    const cached = localStorage.getItem("aquadex_display_tank");
    if (cached) {
      try {
        return JSON.parse(cached);
      } catch (e) {}
    }
    return null;
  });
  const [selectedSpecimenId, setSelectedSpecimenId] = useState(null);
  const [preselectedOrderForCheckout, setPreselectedOrderForCheckout] = useState(null);
  const [activeSellerFilter, setActiveSellerFilter] = useState(null);

  // Echo Whispers — real user state from Dexie (replaces hardcoded values)
  const [echoUserState, setEchoUserState] = useState({ totalXp: 0, streakDays: 0, lastActiveDate: null, currentTier: "Shallow" });
  const [echoTankData, setEchoTankData] = useState({});

  // Echo Living Companion — unified state hook for the new Tamagotchi system
  const echoState = useEchoState(account);
  const [echoFullScreenOpen, setEchoFullScreenOpen] = useState(false);

  // Echo Rare Moments — time-gated special animations
  const { activeMoment, dismissMoment } = useEchoRareMoments(echoState);

  const [marketplaceContract, setMarketplaceContract] = useState(null);

  useEffect(() => {
    if (!account) return;
    try {
      const provider = getProvider();
      const contract = new ethers.Contract(MARKETPLACE_ADDRESS, marketplaceAbi, provider);
      setMarketplaceContract(contract);
    } catch (err) {
      console.warn("Failed to initialize marketplace contract for useXPSync:", err);
    }
  }, [account]);

  // Hook up useXPSync globally in App.jsx
  useXPSync(account, marketplaceContract, null, getAccessToken);

  // ─── Arrival Flow: track incoming specimens + nudge state ─────────────────
  const { incomingCount, hasNudge, shouldShowToast, markToastShown } = useArrivalNudge(account);

  // Show nudge toast on startup (once per 24h)
  useEffect(() => {
    if (shouldShowToast && incomingCount > 0) {
      const msg = casualModeActive
        ? `You have ${incomingCount} fish waiting to be placed in a tank.`
        : `${incomingCount} unassigned specimen${incomingCount > 1 ? "s" : ""} in transit.`;
      setToasts((prev) => [...prev, { id: Date.now(), message: msg, type: "info" }]);
      markToastShown();
    }
  }, [shouldShowToast]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Load real Echo state from Dexie for EchoWhispers ─────────────────────
  useEffect(() => {
    if (!account) return;

    const loadEchoState = async () => {
      try {
        const profile = await db.userProfile.get(account);
        if (profile) {
          setEchoUserState({
            totalXp: profile.totalXp || 0,
            streakDays: profile.streakDays || 0,
            lastActiveDate: profile.lastActiveDate || null,
            currentTier: profile.currentTier || "Shallow",
          });
        }

        // Load tank data for care reminders
        const logs = await db.actionLogs.orderBy("timestamp").reverse().limit(50).toArray();
        const waterChanges = logs.filter(l => l.actionType === "Water Change");
        const feedings = logs.filter(l => l.actionType === "Feed");
        const paramTests = logs.filter(l => l.actionType === "Quick Water Test" || l.actionType === "Water Parameters");
        const tankCount = await db.tanks.where("active").equals(1).count();

        setEchoTankData({
          lastWaterChange: waterChanges[0]?.timestamp ? new Date(waterChanges[0].timestamp * 1000).toISOString() : null,
          lastFeeding: feedings[0]?.timestamp ? new Date(feedings[0].timestamp * 1000).toISOString() : null,
          lastParams: paramTests[0]?.timestamp ? new Date(paramTests[0].timestamp * 1000).toISOString() : null,
          tankCount,
        });
      } catch (err) {
        console.warn("App: Failed to load Echo state from Dexie:", err);
      }
    };

    loadEchoState();

    // Refresh when XP changes
    const refreshEchoState = () => loadEchoState();
    window.addEventListener("aquadex_xp_added", refreshEchoState);
    return () => window.removeEventListener("aquadex_xp_added", refreshEchoState);
  }, [account]);

  useEffect(() => {
    if (displayTank) {
      localStorage.setItem("aquadex_display_tank", JSON.stringify(displayTank));
    } else {
      localStorage.removeItem("aquadex_display_tank");
    }
  }, [displayTank]);

  useEffect(() => {
    const handleXpAdded = (e) => {
      const d = e.detail || {};
      // Field names vary by dispatcher: xp.js / useXPSync send actionLabel/totalXp,
      // while older callers send label/newXp. Normalize both shapes.
      const points = Number(d.points);
      const label = d.label || d.actionLabel || "Husbandry Activity";
      const totalXp = d.newXp ?? d.totalXp;
      const levelChanged = d.levelChanged ?? d.tierChanged ?? false;
      const newLevel = d.newLevel;

      // Keep the XP bar in sync only when a real total is provided.
      if (Number.isFinite(Number(totalXp))) {
        setXp(Number(totalXp));
      }

      // Some dispatchers (cloud sync restore, Poseidon bridge) fire this event
      // purely as a refresh signal with no point value. Skip the toast for those
      // instead of rendering a stuck "+undefined ... earned undefined" popup.
      if (!Number.isFinite(points) || points <= 0) {
        return;
      }

      // Create unique ID for the toast notification
      const toastId = Date.now() + Math.random();

      // Push a regular XP earned toast
      setToasts((prev) => [...prev, { id: toastId, points, label, isLevelUp: false }]);

      // Haptic feedback on mobile — makes XP rewards feel physical
      haptic("success");

      // Auto-expire after 4 seconds
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== toastId));
      }, 4000);

      // If we leveled up, queue a special achievement notification
      if (levelChanged) {
        const levelUpId = toastId + 1;
        setTimeout(() => {
          setToasts((prev) => [...prev, { id: levelUpId, level: newLevel, isLevelUp: true }]);
          // Stronger haptic pattern for level-up celebration
          haptic("levelUp");
          setTimeout(() => {
            setToasts((prev) => prev.filter((t) => t.id !== levelUpId));
          }, 5000);
        }, 800);
      }
    };

    window.addEventListener("aquadex_xp_added", handleXpAdded);
    return () => {
      window.removeEventListener("aquadex_xp_added", handleXpAdded);
    };
  }, []);

  // Listen for "Share on Reef" events from tank detail panels
  useEffect(() => {
    const handleShareOnReef = (e) => {
      // Navigate to reef tab
      goToTab("reef");
      // Dispatch event with the tank detail for ReefFeed to capture in React state
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent("reef_open_composer", { detail: e.detail }));
      }, 300);
    };
    window.addEventListener("reef_share_tank", handleShareOnReef);
    return () => window.removeEventListener("reef_share_tank", handleShareOnReef);
  }, []);

  // Listen for Poseidon deep-link navigation events (species search, tab switches)
  useEffect(() => {
    const handlePoseidonNav = (e) => {
      const { tab, search } = e.detail || {};
      if (tab) {
        goToTab(tab);
      }
      // If a species search query is provided, dispatch it for the gallery to pick up
      if (search) {
        setTimeout(() => {
          window.dispatchEvent(
            new CustomEvent("poseidon:species-search", { detail: { query: search } })
          );
        }, 200);
      }
    };
    window.addEventListener("poseidon:navigate", handlePoseidonNav);
    return () => window.removeEventListener("poseidon:navigate", handlePoseidonNav);
  }, []);

  const handleWalletConnected = (addr) => {
    // Account is now managed by AuthContext — this callback is kept for
    // backward compatibility with ConnectWallet's onConnected prop but
    // the actual state lives in useAuth().
  };

  const handleWalletDisconnected = () => {
    // Account is now managed by AuthContext
  };

  const handleTabChange = (tabName) => {
    if (tabName !== "breeder") {
      setPreselectedLineageId(null);
    }
    if (tabName !== "gallery") {
      setSelectedBreedId(null);
    }
    if (tabName !== "directory") {
      setActiveSellerFilter(null);
    }
    goToTab(tabName);
  };

  const handleLineageSelect = (tokenId) => {
    setPreselectedLineageId(tokenId);
    setBreederToolsSection("lineage");
    goToTab("breeder");
  };

  const handleListOnMarketplace = (tank, specimen) => {
    setPreselectedListSpecimen(specimen);
    setPreselectedListTank(tank);
    goToTab("directory");
  };

  const handleSelectCheckoutOrder = (type, id) => {
    setPreselectedOrderForCheckout({ type, id });
    goToTab("orders");
  };

  const handleCheckoutSuccessRedirect = (sellerAddress) => {
    setActiveSellerFilter(sellerAddress);
    goToTab("directory");
  };

  const levelInfo = getLevelInfo(xp);

  // Count unique species across all user's tanks for the profile chip
  const [speciesCount, setSpeciesCount] = useState(0);
  useEffect(() => {
    if (!account) { setSpeciesCount(0); return; }
    (async () => {
      try {
        const { db } = await import("./db");
        const tanks = await db.tanks.where("ownerAddress").equals(account).toArray();
        const speciesIds = new Set();
        for (const tank of tanks) {
          if (tank.specimens) {
            tank.specimens.forEach(s => { if (s.speciesId) speciesIds.add(Number(s.speciesId)); });
          }
        }
        setSpeciesCount(speciesIds.size);
      } catch { setSpeciesCount(0); }
    })();
  }, [account, syncStatus]); // re-count after sync completes

  const renderContent = () => {
    switch (activeTab) {
      case "breeder":
        return (
          <BreederTools
            contractAddress={CONTRACT_ADDRESS}
            walletAccount={account}
            casualModeActive={casualModeActive}
            preselectedTokenId={preselectedLineageId}
            onSelectBreed={(breedId) => {
              setSelectedBreedId(breedId);
              handleTabChange("gallery");
            }}
            onSpawningComplete={() => handleTabChange("tanks")}
            initialSection={breederToolsSection}
          />
        );
      case "directory":
        return (
          <MarketplaceBoard 
            contractAddress={CONTRACT_ADDRESS} 
            marketplaceAddress={MARKETPLACE_ADDRESS} 
            walletAccount={account} 
            onLineageSelect={handleLineageSelect} 
            preselectedListSpecimen={preselectedListSpecimen}
            preselectedListTank={preselectedListTank}
            onClearPreselectedList={() => {
              setPreselectedListSpecimen(null);
              setPreselectedListTank(null);
            }}
            casualModeActive={casualModeActive}
            displayTank={displayTank}
            setDisplayTank={setDisplayTank}
            onSelectCheckoutOrder={handleSelectCheckoutOrder}
            activeSellerFilter={activeSellerFilter}
            setActiveSellerFilter={setActiveSellerFilter}
          />
        );
      case "gallery":
        return (
          <BreedGallery 
            contractAddress={CONTRACT_ADDRESS} 
            marketplaceAddress={MARKETPLACE_ADDRESS} 
            walletAccount={account} 
            onViewLineage={handleLineageSelect} 
            preselectedBreedId={selectedBreedId}
            onClearPreselectedBreed={() => setSelectedBreedId(null)}
            onSelectSpecimen={setSelectedSpecimenId}
            displayTank={displayTank}
            setDisplayTank={setDisplayTank}
            onSelectCheckoutOrder={handleSelectCheckoutOrder}
            onCheckoutSuccessRedirect={handleCheckoutSuccessRedirect}
            casualModeActive={casualModeActive}
            initialSelectedBreed={gallerySelectedBreed}
            onSelectedBreedChange={setGallerySelectedBreed}
          />
        );
      case "map":
        return (
          <LocalBreederMap 
            contractAddress={CONTRACT_ADDRESS} 
            marketplaceAddress={MARKETPLACE_ADDRESS} 
            walletAccount={account} 
            casualModeActive={casualModeActive}
          />
        );
      case "orders":
        return (
          <CheckoutSummary 
            contractAddress={CONTRACT_ADDRESS} 
            marketplaceAddress={MARKETPLACE_ADDRESS} 
            walletAccount={account} 
            preselectedOrderForCheckout={preselectedOrderForCheckout}
            clearPreselectedOrder={() => setPreselectedOrderForCheckout(null)}
            displayTank={displayTank}
            casualModeActive={casualModeActive}
          />
        );
      case "incoming":
        return (
          <IncomingSpecimens
            walletAccount={account}
            casualModeActive={casualModeActive}
            contractAddress={CONTRACT_ADDRESS}
          />
        );
      case "reef":
        return (
          <Suspense fallback={
            <div style={{ display: "flex", flexDirection: "column", gap: "1rem", maxWidth: "640px", margin: "0 auto", padding: "2rem 0" }}>
              {[1, 2, 3].map((i) => (
                <div key={i} style={{ height: "180px", borderRadius: "12px", background: "rgba(255, 255, 255, 0.03)", border: "1px solid rgba(255, 255, 255, 0.05)", animation: "pulse 1.5s ease-in-out infinite" }} />
              ))}
            </div>
          }>
            <ReefFeed 
              casualModeActive={casualModeActive}
              walletAccount={account}
              walletAddress={account}
            />
          </Suspense>
        );
      case "settings":
        return (
          <DataPortabilityWidget 
            casualModeActive={casualModeActive} 
            onToggleMode={(newCasualVal) => {
              setCasualModeActive(newCasualVal);
              localStorage.setItem("aquadex_casual_mode", newCasualVal.toString());
            }}
          />
        );
      case "founders":
        return (
          <FoundersDashboard casualModeActive={casualModeActive} />
        );
      case "storefront":
        return (
          <Suspense fallback={
            <div style={{ maxWidth: "640px", margin: "0 auto", padding: "2rem 0" }}>
              <div className="shimmer-placeholder" style={{ width: "100%", height: "300px", borderRadius: "16px" }} />
            </div>
          }>
            <StorefrontSetup
              walletAccount={smartWalletForFounderCheck || account}
              casualModeActive={casualModeActive}
            />
          </Suspense>
        );
      case "tanks":
      default:
        return (
          <div style={{ display: "flex", gap: "1.5rem", alignItems: "flex-start" }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <TankList 
                contractAddress={CONTRACT_ADDRESS} 
                walletAccount={account} 
                onViewLineage={handleLineageSelect} 
                onListOnMarketplace={handleListOnMarketplace}
                casualModeActive={casualModeActive}
                onSelectSpecimen={setSelectedSpecimenId}
              />
            </div>
            <aside className="zone-leaderboard-sidebar" style={{ width: "280px", flexShrink: 0, position: "sticky", top: "2rem" }}>
              {casualModeActive && (
                <div style={{ marginBottom: "1rem" }}>
                  <EchoCompanionWidget casualModeActive={casualModeActive} compact />
                </div>
              )}
              <ZoneLeaderboardWidget casualModeActive={casualModeActive} compact />
              <div style={{ marginTop: "1rem" }}>
                <RewardCreditsCard casualModeActive={casualModeActive} compact />
              </div>
            </aside>
          </div>
        );
    }
  };

  if (!enteredDashboard) {
    if (viewParam === "breeder") {
      return (
        <LandingBreeder 
          onEnter={() => {
            setEnteredDashboard(true);
            localStorage.setItem("aquadex_entered_dashboard", "true");
          }} 
        />
      );
    } else {
      return (
        <LandingHobbyist 
          onEnter={() => {
            setEnteredDashboard(true);
            localStorage.setItem("aquadex_entered_dashboard", "true");
          }} 
        />
      );
    }
  }

  // Onboarding completion handler. OnboardingWizard's completeOnboarding()
  // (via OnboardingContext) has ALREADY persisted the per-account flag + Dexie
  // mirror + refreshed the localStorage cache before firing this exactly once.
  // App's job is to react: update casual mode here, then let useOnboardingGate
  // re-resolve and swap to the dashboard.
  const handleOnboardingComplete = (isCasual) => {
    if (isCasual !== null && isCasual !== undefined) {
      setCasualModeActive(isCasual);
      localStorage.setItem("aquadex_casual_mode", isCasual.toString());
    }
  };

  return (
    <>
    <NetworkStatusBanner />
    <div style={{ padding: "2rem max(2rem, (100vw - 1200px) / 2)", minHeight: "100vh" }}>
      <BetaBanner />
      {/* Premium Header Nav Bar — Redesigned v2 */}
      <header 
        className={`aquadex-header glass-card ${casualModeActive ? "aquadex-header--casual" : "aquadex-header--pro"}`}
        style={{ 
          display: "flex", 
          flexDirection: "column",
          padding: "0",
          marginBottom: "2rem",
          borderRadius: "var(--radius-md)",
          overflow: "visible",
          border: casualModeActive 
            ? "1px solid rgba(56, 189, 248, 0.12)" 
            : "1px solid rgba(168, 85, 247, 0.15)",
          boxShadow: casualModeActive
            ? "0 8px 32px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(56, 189, 248, 0.05)"
            : "0 8px 32px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(168, 85, 247, 0.06)",
          transition: "border-color 0.35s ease, box-shadow 0.35s ease",
        }}
      >
        {/* Main header content area */}
        <div className="aquadex-header-main" style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "1rem 1.5rem",
          gap: "1rem",
          flexWrap: "wrap",
        }}>
          {/* Zone 1: Logo + Identity */}
          <div className="aquadex-header-identity" style={{ display: "flex", alignItems: "center", gap: "0.75rem", minWidth: "0" }}>
            <div style={{
              background: casualModeActive 
                ? "linear-gradient(135deg, #0ea5e9 0%, #0369a1 100%)"
                : "linear-gradient(135deg, #a855f7 0%, #7c3aed 100%)",
              width: "36px",
              height: "36px",
              borderRadius: "10px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow: casualModeActive 
                ? "0 0 14px rgba(56, 189, 248, 0.3)"
                : "0 0 14px rgba(168, 85, 247, 0.3)",
              transition: "background 0.35s ease, box-shadow 0.35s ease",
              flexShrink: 0,
            }}>
              <GlobeHemisphereWest size={18} weight="duotone" color="#fff" />
            </div>
            <div style={{ minWidth: "0" }}>
              <h1 className="aquadex-header-title" style={{ 
                fontSize: "1.25rem", 
                fontWeight: "700", 
                letterSpacing: "0.04em", 
                color: "#fff", 
                margin: 0,
                lineHeight: "1.2"
              }}>
                AQUADEX
              </h1>
              <span style={{ 
                fontSize: "0.6rem", 
                color: "var(--text-muted)", 
                letterSpacing: "0.08em", 
                textTransform: "uppercase", 
                display: "block",
                lineHeight: "1.4"
              }}>
                {casualModeActive ? "Digital Aquarium Log" : "Breeder Protocol"}
              </span>
            </div>
          </div>

          {/* Zone 2: Mode Segmented Control (center) */}
          <div className="aquadex-header-mode" style={{ 
            flex: "0 1 380px", 
            display: "flex", 
            justifyContent: "center",
            minWidth: "200px"
          }}>
            <ModeSegmentedControl 
              casualModeActive={casualModeActive}
              onToggle={(newCasualVal) => {
                setCasualModeActive(newCasualVal);
                localStorage.setItem("aquadex_casual_mode", newCasualVal.toString());
              }}
            />
          </div>

          {/* Zone 3: Status + Wallet (right) */}
          <div className="aquadex-header-status" style={{ 
            display: "flex", 
            alignItems: "center", 
            gap: "0.75rem",
            flexShrink: 0,
          }}>
            {!isOnline && (
              <span style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "0.35rem",
                padding: "0.3rem 0.65rem",
                background: "rgba(248, 113, 113, 0.08)",
                border: "1px solid rgba(248, 113, 113, 0.2)",
                borderRadius: "50px",
                color: "var(--accent-red)",
                fontSize: "0.65rem",
                fontWeight: "600",
              }}>
                <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: "var(--accent-red)" }} />
                Offline
              </span>
            )}
            {isOnline && (
              <button
                onClick={() => queryClient.invalidateQueries()}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "0.35rem",
                  padding: "0.3rem 0.65rem",
                  background: "rgba(52, 211, 153, 0.04)",
                  border: "1px solid rgba(52, 211, 153, 0.15)",
                  borderRadius: "50px",
                  color: "var(--text-muted)",
                  fontSize: "0.65rem",
                  cursor: "pointer",
                  transition: "all 0.2s ease",
                  minHeight: "30px",
                }}
                aria-label="Sync status — click to refresh"
                title="Synced — click to refresh"
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = "rgba(52, 211, 153, 0.4)"; e.currentTarget.style.color = "#fff"; }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = "rgba(52, 211, 153, 0.15)"; e.currentTarget.style.color = "var(--text-muted)"; }}
              >
                <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: "var(--accent-green)", boxShadow: "0 0 4px var(--accent-green)" }} />
                <span className="sync-status-text">{casualModeActive ? "Saved" : "Synced"}</span>
              </button>
            )}
            <ConnectWallet 
              onConnected={handleWalletConnected} 
              onDisconnected={handleWalletDisconnected} 
              casualModeActive={casualModeActive}
              triggerLoginOnEntry={triggerLoginOnEntry}
              clearTriggerLogin={() => setTriggerLoginOnEntry(false)}
            />
          </div>
        </div>

        {/* XP Progress Bar — full-width at header bottom */}
        <div className="aquadex-header-xp" style={{
          display: "flex",
          alignItems: "center",
          padding: casualModeActive ? "0.5rem 1.5rem 0.65rem" : "0.35rem 1.5rem 0.45rem",
          gap: "0.75rem",
          borderTop: "1px solid rgba(255, 255, 255, 0.04)",
          background: "rgba(0, 0, 0, 0.15)",
          opacity: casualModeActive ? 1 : 0.7,
          borderRadius: "0 0 var(--radius-md) var(--radius-md)",
        }}>
          {/* Level badge */}
          <span style={{ 
            fontSize: "0.7rem", 
            fontWeight: "600", 
            color: casualModeActive ? "var(--accent-amber)" : "var(--text-secondary)",
            whiteSpace: "nowrap",
            display: "flex",
            alignItems: "center",
            gap: "0.35rem",
          }}>
            {casualModeActive ? `✨ Lvl ${levelInfo.level}` : `Tier ${levelInfo.level}`}
            {casualModeActive && (
              <span style={{ color: "var(--text-muted)", fontWeight: "400", fontSize: "0.65rem" }}>
                {levelInfo.badge}
              </span>
            )}
          </span>

          {/* Species count chip */}
          {speciesCount > 0 && (
            <span style={{
              fontSize: "0.62rem",
              fontWeight: "500",
              color: "var(--accent-green)",
              background: "rgba(52, 211, 153, 0.08)",
              border: "1px solid rgba(52, 211, 153, 0.2)",
              borderRadius: "12px",
              padding: "0.1rem 0.45rem",
              whiteSpace: "nowrap",
            }}>
              🐠 {speciesCount} species
            </span>
          )}

          {/* Progress bar */}
          <div style={{ 
            flex: 1, 
            height: "4px", 
            background: "rgba(255,255,255,0.04)", 
            borderRadius: "10px", 
            overflow: "hidden",
            position: "relative",
          }}>
            <div style={{ 
              width: `${levelInfo.nextLevelXp ? ((xp - levelInfo.baseXp) / (levelInfo.nextLevelXp - levelInfo.baseXp)) * 100 : 100}%`, 
              height: "100%", 
              background: casualModeActive 
                ? "linear-gradient(90deg, #fbbf24, #f59e0b)"
                : "linear-gradient(90deg, #a855f7, #7c3aed)",
              borderRadius: "10px",
              boxShadow: casualModeActive 
                ? "0 0 8px rgba(251, 191, 36, 0.4)"
                : "0 0 8px rgba(168, 85, 247, 0.4)",
              transition: "width 0.4s ease-out, background 0.35s ease"
            }} />
          </div>

          {/* XP count */}
          <span style={{ 
            fontSize: "0.65rem", 
            color: "var(--text-muted)", 
            fontFamily: "monospace",
            whiteSpace: "nowrap",
          }}>
            {xp} / {levelInfo.nextLevelXp || "MAX"} {casualModeActive ? "pts" : "XP"}
          </span>
        </div>
      </header>

      {/* Tabs Subnavigation — Premium Glassmorphic Pill Bar */}
      {account && (
        <nav
          aria-label="Main navigation"
          ref={(el) => {
            if (!el) return;
            const handleScroll = () => {
              el.classList.toggle("aquadex-nav--scrolled-start", el.scrollLeft > 10);
              el.classList.toggle("aquadex-nav--scrolled-end", el.scrollLeft >= el.scrollWidth - el.clientWidth - 10);
            };
            el.addEventListener("scroll", handleScroll, { passive: true });
            handleScroll();
          }}
          className={`aquadex-nav glass-card ${casualModeActive ? "aquadex-nav--casual" : "aquadex-nav--pro"}`}
          style={{ marginBottom: "2rem" }}
        >
          {/* Tab helper: render a single pill button */}
          {[
            { id: "tanks",     icon: "🐠",  label: casualModeActive ? "My Aquariums"  : "Aquariums",    tourId: "aquariums-tab", alwaysShow: true  },
            { id: "gallery",   icon: "🔍",  label: casualModeActive ? "Fish Finder"   : "Breed Gallery", alwaysShow: true  },
            { id: "breeder",   icon: "🧬",  label: "Breeder Tools",                                      alwaysShow: !casualModeActive },
            { id: "directory", icon: "🛒",  label: casualModeActive ? "Breeder Store" : "Marketplace",  alwaysShow: true  },
            { id: "map",       icon: "🗺️", label: casualModeActive ? "Local Sellers" : "Local Map",     alwaysShow: true  },
            { id: "orders",    icon: "📦",  label: "My Orders",                                          alwaysShow: true  },
            ...(incomingCount > 0 ? [{ id: "incoming", icon: "🚚", label: casualModeActive ? "Incoming" : "In Transit", alwaysShow: true, incomingBadge: true }] : []),
            { id: "reef",      icon: "🪸",  label: casualModeActive ? "The Reef"      : "Social",        alwaysShow: true, badge: !postedFirstCurrent },
            { id: "settings",  icon: "⚙️", label: "Settings",                                           alwaysShow: true  },
            ...(isFounder ? [{ id: "founders", icon: "📊", label: "Founders", alwaysShow: true }] : []),
            ...(isStorefrontBeta ? [{ id: "storefront", icon: "🏪", label: "My Store", alwaysShow: true }] : []),
          ]
            .filter((t) => t.alwaysShow)
            .map((tab) => {
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  data-tour-id={tab.tourId || undefined}
                  onClick={() => handleTabChange(tab.id)}
                  className={`aquadex-nav-tab${isActive ? " aquadex-nav-tab--active" : ""}`}
                  aria-current={isActive ? "page" : undefined}
                  style={{ position: "relative" }}
                >
                  <span className="aquadex-nav-tab-icon">{tab.icon}</span>
                  <span className="aquadex-nav-tab-label">{tab.label}</span>
                  {tab.badge && (
                    <span
                      className="pulse-dot"
                      style={{
                        position: "absolute",
                        top: "6px",
                        right: "6px",
                        width: "7px",
                        height: "7px",
                        borderRadius: "50%",
                        background: casualModeActive ? "#38bdf8" : "#a855f7",
                        boxShadow: casualModeActive
                          ? "0 0 7px #38bdf8"
                          : "0 0 7px #a855f7",
                        animation: "pulse-glow 1.5s infinite ease-in-out",
                      }}
                    />
                  )}
                  {tab.incomingBadge && (
                    <span style={{ position: "absolute", top: "4px", right: "4px" }}>
                      <IncomingBadge count={incomingCount} hasNudge={hasNudge} />
                    </span>
                  )}
                </button>
              );
            })}
        </nav>
      )}

      {/* Main Content Area */}
      <main style={{ perspective: "1000px" }}>
        <style>
          {`
            @keyframes pulse-glow {
              0%, 100% { transform: scale(0.8); opacity: 0.5; }
              50% { transform: scale(1.2); opacity: 1; }
            }
            @keyframes crossfadeScale {
              0% { opacity: 0; transform: scale(0.99); }
              100% { opacity: 1; transform: scale(1); }
            }
          `}
        </style>
        <div 
          key={casualModeActive ? "casual" : "pro"}
          style={{
            animation: "crossfadeScale 0.5s cubic-bezier(0.16, 1, 0.3, 1) forwards",
            transformOrigin: "top center",
            willChange: "transform, opacity"
          }}
        >
          <TabErrorBoundary name={activeTab} resetKey={activeTab}>
            <Suspense fallback={
              <div style={{ display: "flex", flexDirection: "column", gap: "1rem", padding: "2rem 0" }}>
                {[1, 2, 3].map((i) => (
                  <div key={i} style={{ height: "120px", borderRadius: "12px", background: "rgba(255, 255, 255, 0.03)", border: "1px solid rgba(255, 255, 255, 0.05)", animation: "pulse 1.5s ease-in-out infinite" }} />
                ))}
              </div>
            }>
              {renderContent()}
            </Suspense>
          </TabErrorBoundary>
        </div>
      </main>

      {/* Echo Whispers — proactive companion nudges (casual mode only) */}
      {casualModeActive && (
        <EchoWhispers
          casualModeActive={casualModeActive}
          userState={echoUserState}
          tankData={echoTankData}
        />
      )}

      {/* Echo Ambient Presence — persistent floating companion (casual mode only) */}
      {casualModeActive && echoState.hasEcho && !echoFullScreenOpen && (
        <EchoAmbient
          dna={echoState.dna}
          stage={echoState.stage}
          needs={echoState.needs}
          personality={echoState.personality}
          mood={echoState.mood}
          streak={echoState.streak}
          onOpenFull={() => setEchoFullScreenOpen(true)}
          visible={true}
        />
      )}

      {/* Echo Living Companion — full-screen interactive experience */}
      {echoFullScreenOpen && echoState.hasEcho && (
        <Suspense fallback={<div style={{ position: "fixed", inset: 0, background: "#0a0f1e", zIndex: 9500 }} />}>
          <EchoLivingCompanion
            dna={echoState.dna}
            stage={echoState.stage}
            needs={echoState.needs}
            personality={echoState.personality}
            streak={echoState.streak}
            totalCareDays={echoState.totalCareDays}
            tricksUnlocked={echoState.tricksUnlocked}
            onInteraction={(type, xp) => echoState.recordInteraction(type)}
            onClose={() => setEchoFullScreenOpen(false)}
            casualModeActive={casualModeActive}
          />
        </Suspense>
      )}

      {/* Echo Rare Moment Overlay — special time-gated animations */}
      {activeMoment && casualModeActive && (
        <Suspense fallback={null}>
          <EchoRareMomentOverlay
            moment={activeMoment}
            dna={echoState.dna}
            onComplete={dismissMoment}
          />
        </Suspense>
      )}

      {/* Feedback Widget — floating bug report / feedback button */}
      <FeedbackWidget walletAddress={account} casualModeActive={casualModeActive} />

      {/* Poseidon Global Widget — AI assistant accessible from anywhere */}
      <PoseidonGlobalWidget
        walletAddress={account}
        casualModeActive={casualModeActive}
        activeTab={activeTab}
      />

      {/* Cloud Sync Status Toast */}
      {syncStatus && syncStatus !== "success" && (
        <div style={{
          position: "fixed",
          bottom: "8.5rem",
          left: "50%",
          transform: "translateX(-50%)",
          zIndex: 10001,
          display: "flex",
          alignItems: "center",
          gap: "0.75rem",
          padding: "0.75rem 1.25rem",
          background: "rgba(14, 20, 36, 0.95)",
          border: syncStatus === "failed"
            ? "1px solid rgba(248, 113, 113, 0.4)"
            : "1px solid rgba(56, 189, 248, 0.3)",
          borderRadius: "var(--radius-sm)",
          boxShadow: "0 8px 32px rgba(0, 0, 0, 0.6)",
          backdropFilter: "blur(12px)",
          fontSize: "0.82rem",
          color: "#f8fafc",
          fontFamily: "'Plus Jakarta Sans', sans-serif",
          maxWidth: "90vw",
        }}>
          {syncStatus === "syncing" && (
            <>
              <span style={{ color: "var(--accent-blue)", animation: "pulse 1.5s ease-in-out infinite" }}>⟳</span>
              <span style={{ color: "var(--text-secondary)" }}>Syncing your data...</span>
            </>
          )}
          {syncStatus === "failed" && (
            <>
              <span style={{ color: "var(--accent-red)" }}>⚠</span>
              <span style={{ color: "var(--text-secondary)" }}>
                Sync pending — your data is saved locally.
              </span>
              <button
                onClick={() => account && runCloudSync(account, { cancelled: false })}
                style={{
                  background: "rgba(255, 255, 255, 0.06)",
                  border: "1px solid rgba(255, 255, 255, 0.12)",
                  borderRadius: "6px",
                  color: "var(--accent-blue)",
                  padding: "0.3rem 0.7rem",
                  fontSize: "0.75rem",
                  fontWeight: 500,
                  cursor: "pointer",
                  fontFamily: "'Outfit', sans-serif",
                  whiteSpace: "nowrap",
                }}
              >
                Retry
              </button>
              <button
                onClick={() => setSyncStatus(null)}
                style={{
                  background: "none",
                  border: "none",
                  color: "#64748b",
                  cursor: "pointer",
                  fontSize: "1rem",
                  padding: "0 0.25rem",
                  lineHeight: 1,
                }}
                aria-label="Dismiss sync notification"
              >
                ×
              </button>
            </>
          )}
        </div>
      )}

      {/* XP Toasts Container */}
      <div className="xp-toast-container" style={{
        position: "fixed",
        bottom: "2rem",
        right: "2rem",
        display: "flex",
        flexDirection: "column",
        gap: "0.75rem",
        zIndex: 10000,
        pointerEvents: "none"
      }}>
        {toasts.map((toast) => (
          <div 
            key={toast.id}
            style={{
              pointerEvents: "auto",
              background: "rgba(14, 20, 36, 0.95)",
              border: toast.isLevelUp ? "1px solid var(--accent-amber)" : "1px solid var(--accent-blue)",
              borderRadius: "var(--radius-sm)",
              padding: "1rem 1.25rem",
              boxShadow: "0 8px 32px rgba(0, 0, 0, 0.6)",
              display: "flex",
              alignItems: "center",
              gap: "0.75rem",
              minWidth: "280px",
              animation: "shimmer 3s ease-in-out infinite",
              transition: "var(--transition-smooth)"
            }}
          >
            <div style={{
              width: "32px",
              height: "32px",
              borderRadius: "50%",
              background: toast.isLevelUp ? "var(--accent-amber-glow)" : "var(--accent-blue-glow)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: toast.isLevelUp ? "var(--accent-amber)" : "var(--accent-blue)",
              fontWeight: "bold",
              fontSize: "0.9rem"
            }}>
              {toast.isLevelUp ? "★" : `+${toast.points}`}
            </div>
            <div>
              <strong style={{ display: "block", fontSize: "0.85rem", color: "#fff" }}>
                {toast.isLevelUp ? (casualModeActive ? "LEVEL UP!" : "RANK UP!") : toast.label}
              </strong>
              <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                {toast.isLevelUp 
                  ? (casualModeActive ? `You reached Level ${toast.level}!` : `Advanced to Tier ${toast.level}`)
                  : (casualModeActive ? `Earned ${toast.points} Loyalty Rewards` : `+${toast.points} reputation`)
                }
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* Footer */}
      <footer style={{ marginTop: "5rem", textAlign: "center", paddingBottom: "2rem" }}>
        <p style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
          Aquadex Protocol © {new Date().getFullYear()} — Digital aquarium management and specimen registries.
        </p>
        {lastSyncedAt && account && (
          <p style={{ fontSize: "0.65rem", color: "var(--text-muted)", opacity: 0.6, marginTop: "0.4rem" }}>
            ☁️ Last synced: {formatSyncTime(lastSyncedAt)}
          </p>
        )}
      </footer>

      {/* Specimen Detail Modal Overlay */}
      {selectedSpecimenId && (
        <SpecimenDetailModal
          specimenId={selectedSpecimenId}
          contractAddress={CONTRACT_ADDRESS}
          walletAccount={account}
          onClose={() => setSelectedSpecimenId(null)}
          onViewLineage={handleLineageSelect}
          onListOnMarketplace={handleListOnMarketplace}
          casualModeActive={casualModeActive}
        />
      )}

      {/* What's New changelog modal — shows once per version bump */}
      <WhatsNewModal />
    </div>

      {/* TODO: Onboarding wizard + tour temporarily disabled (mobile bug — step 1 blocks progress).
           Re-enable by restoring useOnboardingGate above and uncommenting the block below.
      {!onboardingLoading && showOnboarding && (
        <OnboardingWizard onComplete={handleOnboardingComplete} />
      )}
      */}
    </>
  );
}
