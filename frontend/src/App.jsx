import React, { useState, useEffect, useRef, lazy, Suspense } from "react";
import "./styles/index.css";
import { ConnectWallet } from "./components/ConnectWallet";
import { TankList } from "./components/TankList";
import { MintSpecimen } from "./components/MintSpecimen";
import { SpecimenLineage } from "./components/SpecimenLineage";
import { MarketplaceBoard } from "./components/MarketplaceBoard";
import { BreedGallery } from "./components/BreedGallery";
import { LocalBreederMap } from "./components/LocalBreederMap";
import { SpawningWizard } from "./components/SpawningWizard";
import { CheckoutSummary } from "./components/CheckoutSummary";
import { SpecimenDetailModal } from "./components/SpecimenDetailModal";
import { getLevelInfo, getXp } from "./utils/xp";
import { getSmartAccountAddress, getProvider } from "./utils/smartAccount";
import { ethers } from "ethers";
import { useQueryClient } from "@tanstack/react-query";
import managerAbi from "./abi/AquadexManager.json";
import marketplaceAbi from "./abi/AquadexMarketplace.json";
import { useXPSync } from "./hooks/useXPSync";
import { LandingHobbyist } from "./components/LandingHobbyist";
import { LandingBreeder } from "./components/LandingBreeder";
import { DataPortabilityWidget } from "./components/DataPortabilityWidget";
import { ModeSegmentedControl } from "./components/ModeSegmentedControl";
import { OnboardingWizard } from "./components/OnboardingWizard";
import { useOnboardingGate } from "./hooks/useOnboardingGate";
import { useAuth } from "./contexts/AuthContext";

// Lazy-load The Reef social layer (code-split for performance)
const ReefFeed = lazy(() =>
  import("./components/reef").then((m) => ({ default: m.ReefFeed }))
);


// Deployed contract addresses — Base Sepolia Testnet
// Deployed: May 29, 2026 | Chain ID: 84532
const CONTRACT_ADDRESS = "0x351ca8f34D94F29F6f865Afa419A636324473DeF";
const MARKETPLACE_ADDRESS = "0x16168B514144e0380610b78d904a4de51ba03Ca3";

export default function App() {
  const { account, ready, authenticated } = useAuth();
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
        console.log("Aquadex: Specimen event detected. Invalidating tanks and breed catalog caches...");
        queryClient.invalidateQueries({ queryKey: ["tanks", account] });
        queryClient.invalidateQueries({ queryKey: ["contractSpecies", CONTRACT_ADDRESS] });
      };

      const invalidateSpeciesCatalog = () => {
        console.log("Aquadex: SpeciesAdded event detected. Invalidating breed catalog and species manifest caches...");
        queryClient.invalidateQueries({ queryKey: ["contractSpecies", CONTRACT_ADDRESS] });
      };

      const invalidateListings = () => {
        console.log("Aquadex: Listing event detected. Invalidating marketplace listings cache...");
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
  const [activeTab, setActiveTab] = useState(() => {
    // Quick Win 10: Restore tab from URL hash on load
    const hash = window.location.hash.replace("#", "");
    const validTabs = ["tanks", "mint", "lineage", "directory", "gallery", "map", "spawning", "orders", "reef", "settings"];
    return validTabs.includes(hash) ? hash : "tanks";
  });
  const [preselectedLineageId, setPreselectedLineageId] = useState(null);
  const [selectedBreedId, setSelectedBreedId] = useState(null);
  const [gallerySelectedBreed, setGallerySelectedBreed] = useState(null);
  const [preselectedListSpecimen, setPreselectedListSpecimen] = useState(null);
  const [preselectedListTank, setPreselectedListTank] = useState(null);
  const [xp, setXp] = useState(0);
  const [toasts, setToasts] = useState([]);
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
  const { showOnboarding, loading: onboardingLoading } = useOnboardingGate(account);
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
  const [viewParam, setViewParam] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("view") || "hobbyist";
  });

  useEffect(() => {
    const handlePopState = () => {
      const params = new URLSearchParams(window.location.search);
      setViewParam(params.get("view") || "hobbyist");
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);
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
  useXPSync(account, marketplaceContract);

  useEffect(() => {
    if (displayTank) {
      localStorage.setItem("aquadex_display_tank", JSON.stringify(displayTank));
    } else {
      localStorage.removeItem("aquadex_display_tank");
    }
  }, [displayTank]);

  useEffect(() => {
    // Read initial XP from local-first storage safely
    setXp(getXp());

    // Auto-resolve active smart account session on load
    // Session restoration is now handled by ConnectWallet.jsx via MetaMask eth_accounts

    const handleXpAdded = (e) => {
      const { points, label, newXp, levelChanged, newLevel } = e.detail;
      setXp(newXp);

      // Create unique ID for the toast notification
      const toastId = Date.now() + Math.random();

      // Push a regular XP earned toast
      setToasts((prev) => [...prev, { id: toastId, points, label, isLevelUp: false }]);

      // Auto-expire after 4 seconds
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== toastId));
      }, 4000);

      // If we leveled up, queue a special achievement notification
      if (levelChanged) {
        const levelUpId = toastId + 1;
        setTimeout(() => {
          setToasts((prev) => [...prev, { id: levelUpId, level: newLevel, isLevelUp: true }]);
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
      setActiveTab("reef");
      window.history.pushState({ tab: "reef" }, "", "#reef");
      // Dispatch event with the tank detail for ReefFeed to capture in React state
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent("reef_open_composer", { detail: e.detail }));
      }, 300);
    };
    window.addEventListener("reef_share_tank", handleShareOnReef);
    return () => window.removeEventListener("reef_share_tank", handleShareOnReef);
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
    if (tabName !== "lineage") {
      setPreselectedLineageId(null);
    }
    if (tabName !== "gallery") {
      setSelectedBreedId(null);
    }
    if (tabName !== "directory") {
      setActiveSellerFilter(null);
    }
    setActiveTab(tabName);
    // Quick Win 10: Sync tab to browser history
    window.history.pushState({ tab: tabName }, "", `#${tabName}`);
  };

  // Quick Win 10: Listen for browser back/forward to restore tab
  useEffect(() => {
    const handlePopState = (e) => {
      const hash = window.location.hash.replace("#", "");
      const validTabs = ["tanks", "mint", "lineage", "directory", "gallery", "map", "spawning", "orders", "reef", "settings"];
      if (validTabs.includes(hash)) {
        setActiveTab(hash);
      }
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  const handleLineageSelect = (tokenId) => {
    setPreselectedLineageId(tokenId);
    setActiveTab("lineage");
  };

  const handleListOnMarketplace = (tank, specimen) => {
    setPreselectedListSpecimen(specimen);
    setPreselectedListTank(tank);
    setActiveTab("directory");
  };

  const handleSelectCheckoutOrder = (type, id) => {
    setPreselectedOrderForCheckout({ type, id });
    setActiveTab("orders");
  };

  const handleCheckoutSuccessRedirect = (sellerAddress) => {
    setActiveSellerFilter(sellerAddress);
    setActiveTab("directory");
  };

  const levelInfo = getLevelInfo(xp);

  const renderContent = () => {
    switch (activeTab) {
      case "mint":
        return <MintSpecimen contractAddress={CONTRACT_ADDRESS} walletAccount={account} />;
      case "lineage":
        return (
          <SpecimenLineage 
            contractAddress={CONTRACT_ADDRESS} 
            walletAccount={account} 
            preselectedTokenId={preselectedLineageId} 
            onSelectBreed={(breedId) => {
              setSelectedBreedId(breedId);
              handleTabChange("gallery");
            }}
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
      case "spawning":
        return (
          <SpawningWizard 
            contractAddress={CONTRACT_ADDRESS} 
            walletAccount={account} 
            onComplete={() => handleTabChange("tanks")}
            casualModeActive={casualModeActive}
          />
        );
      case "map":
        return (
          <LocalBreederMap 
            contractAddress={CONTRACT_ADDRESS} 
            marketplaceAddress={MARKETPLACE_ADDRESS} 
            walletAccount={account} 
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
      case "tanks":
      default:
        return (
          <TankList 
            contractAddress={CONTRACT_ADDRESS} 
            walletAccount={account} 
            onViewLineage={handleLineageSelect} 
            onListOnMarketplace={handleListOnMarketplace}
            casualModeActive={casualModeActive}
            onSelectSpecimen={setSelectedSpecimenId}
          />
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
    <div style={{ padding: "2rem max(2rem, (100vw - 1200px) / 2)", minHeight: "100vh" }}>
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
              <svg 
                width="18" 
                height="18" 
                viewBox="0 0 24 24" 
                fill="none" 
                stroke="#fff" 
                strokeWidth="2.5" 
                strokeLinecap="round" 
                strokeLinejoin="round"
              >
                <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                <path d="M2 12h20" />
              </svg>
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
              width: `${((xp - levelInfo.levelPoints) / (levelInfo.nextLevelPoints - levelInfo.levelPoints)) * 100}%`, 
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
            {xp} / {levelInfo.nextLevelPoints} {casualModeActive ? "pts" : "XP"}
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
            { id: "mint",      icon: "✦",   label: "Register",                                           alwaysShow: !casualModeActive },
            { id: "lineage",   icon: "🌿",  label: "Lineage",                                            alwaysShow: !casualModeActive },
            { id: "spawning",  icon: "🥚",  label: "Spawning",                                           alwaysShow: !casualModeActive },
            { id: "directory", icon: "🛒",  label: casualModeActive ? "Breeder Store" : "Marketplace",  alwaysShow: true  },
            { id: "map",       icon: "🗺️", label: casualModeActive ? "Local Sellers" : "Local Map",     alwaysShow: true  },
            { id: "orders",    icon: "📦",  label: "My Orders",                                          alwaysShow: true  },
            { id: "reef",      icon: "🪸",  label: casualModeActive ? "The Reef"      : "Social",        alwaysShow: true, badge: !postedFirstCurrent },
            { id: "settings",  icon: "⚙️", label: "Settings",                                           alwaysShow: true  },
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
          {renderContent()}
        </div>
      </main>

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
    </div>

      {/* Per-account onboarding overlay — rendered ABOVE the live dashboard so the
          spotlight tour phases (tourTank/tourFish/profileNudge) can target the real
          data-tour-id controls mounted beneath. The wizard's in-card phases
          (persona/identity/nameConfirm/hatch) render their own full-screen overlay
          that covers the dashboard. Gating on !onboardingLoading avoids flashing
          the wizard before the per-account flag resolves. (Req 6.1, 6.2, 6.6, 8.5) */}
      {!onboardingLoading && showOnboarding && (
        <OnboardingWizard onComplete={handleOnboardingComplete} />
      )}
    </>
  );
}
