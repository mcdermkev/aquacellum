import React, { useState, useEffect, useRef, useMemo, useCallback, lazy, Suspense } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import "./styles/index.css";
import "./styles/storefront-setup.css";
import { GlobeHemisphereWest } from "@phosphor-icons/react";
import { ConnectWallet } from "./components/ConnectWallet";
import { useScrollAffordance } from "./hooks/useScrollAffordance";
import { CartButton } from "./components/cart/CartButton";
import { CartDrawer } from "./components/cart/CartDrawer";
import { useCart } from "./contexts/CartContext";
import { canonicalProductPath, resolveCommerceRoute } from "./services/commerceRoute";
import { useFontSettings } from "./hooks/useFontSettings";
import { useHighContrast } from "./hooks/useHighContrast";
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
import { ProfileHub } from "./components/ProfileHub";
import { StarterQuestCard } from "./components/StarterQuestCard";
import { CasualBottomNav } from "./components/CasualBottomNav";
import { useAuth } from "./contexts/AuthContext";
import { pullCloudDataForWallet, pushAllLocalDataToCloud } from "./services/cloudSync";
import { retryPendingMetadataPublishes } from "./services/specimenMetadata";
import { cleanupGarbledActionLogs } from "./utils/cleanupGarbledLogs";
import { RewardCreditsCard } from "./components/RewardCreditsCard";
import { EchoWhispers } from "./components/EchoWhispers";
import { EchoAmbient } from "./components/EchoAmbient";
import { useAiPrefs } from "./hooks/useAiPrefs";
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
import { trackEvent } from "./services/analytics";
import {
  CONTRACT_ADDRESS,
  MARKETPLACE_ADDRESS,
  FOUNDER_WALLETS,
  FOUNDER_WALLET_PATTERNS,
  VALID_TABS,
  isFounderWallet,
  formatSyncTime,
} from "./config/appConfig";
import { isE2EMode } from "./utils/e2eMode";
import { installStarterQuestListeners, markStarterQuestStep } from "./utils/starterQuest";


// ── Code-split tab views ───────────────────────────────────────────────────
// Each main tab is lazy-loaded so it ships as its own chunk instead of bloating
// the entry bundle. They render inside the existing <Suspense> boundary around
// renderContent(), which shows a skeleton fallback while a chunk loads.
const TankList = lazy(() =>
  import("./components/TankList").then((m) => ({ default: m.TankList }))
);
// Task 3 prototype — Living Tank engine gallery, reachable at ?preview=living-tank
const LivingTankPreview = lazy(() =>
  import("./components/logbook/LivingTankPreview").then((m) => ({ default: m.LivingTankPreview }))
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
const FishFinder = lazy(() =>
  import("./components/finder/FishFinder").then((m) => ({ default: m.FishFinder }))
);
// LocalBreederMap is intentionally NOT imported: its tab is retired (Fish
// Finder T15), so the component is unmounted and no longer shipped in any
// chunk. See the note at the retired nav entry below.
const CheckoutSummary = lazy(() =>
  import("./components/CheckoutSummary").then((m) => ({ default: m.CheckoutSummary }))
);
const IncomingSpecimens = lazy(() =>
  import("./components/IncomingSpecimens").then((m) => ({ default: m.IncomingSpecimens }))
);
const SettingsPanel = lazy(() =>
  import("./components/settings/SettingsPanel").then((m) => ({ default: m.SettingsPanel }))
);
const FoundersDashboard = lazy(() =>
  import("./components/FoundersDashboard").then((m) => ({ default: m.FoundersDashboard }))
);

// Lazy-load The Reef social layer (code-split for performance)
const ReefFeed = lazy(() =>
  import("./components/reef").then((m) => ({ default: m.ReefFeed }))
);


// Lazy-load the Breeder Terminal (unified seller workspace, Task 9)
const BreederTerminal = lazy(() =>
  import("./components/breeder/BreederTerminal").then((m) => ({ default: m.BreederTerminal }))
);

const StorefrontContent = lazy(() =>
  import("./components/storefront/StorefrontPage").then((m) => ({ default: m.StorefrontContent }))
);

function CommerceAuthRequired({ title, onSignIn }) {
  return (
    <div className="glass-card" style={{ maxWidth: "560px", margin: "2rem auto", padding: "2.5rem", textAlign: "center" }}>
      <h2 style={{ color: "#fff", marginBottom: "0.75rem" }}>{title}</h2>
      <p style={{ color: "var(--text-secondary)", marginBottom: "1.5rem", lineHeight: 1.5 }}>
        Sign in to continue. This commerce route will stay in place, and current data will be rechecked before any protected action.
      </p>
      <button className="btn-primary" type="button" onClick={onSignIn} style={{ margin: "0 auto", justifyContent: "center" }}>
        Sign in
      </button>
    </div>
  );
}

function CommerceRouteNotice({ title, message, actionLabel = "Back to marketplace", onAction }) {
  return (
    <div className="glass-card" style={{ maxWidth: "620px", margin: "2rem auto", padding: "2.5rem", textAlign: "center" }}>
      <h2 style={{ color: "#fff", marginBottom: "0.75rem" }}>{title}</h2>
      <p style={{ color: "var(--text-secondary)", marginBottom: "1.5rem", lineHeight: 1.5 }}>{message}</p>
      {onAction && (
        <button className="btn-secondary" type="button" onClick={onAction} style={{ margin: "0 auto", justifyContent: "center" }}>
          {actionLabel}
        </button>
      )}
    </div>
  );
}

export default function App() {
  const { account, ready, authenticated, getAccessToken } = useAuth();
  const queryClient = useQueryClient();
  // Apply the user's saved font-size preference app-wide on every load. The
  // Settings tab's Accessibility section lets them change it; this call keeps
  // the choice applied globally, not just while that section is mounted.
  useFontSettings();
  // Task 21D: same pattern for high-contrast mode — apply the persisted
  // preference app-wide on every load, not just while the Settings tab's
  // Accessibility section happens to be mounted. `SettingsPanel` binds its
  // own independent `useHighContrast()` for the toggle itself; both share
  // the same underlying persisted value.
  useHighContrast();
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

  // Signal the HTML boot splash (app.html) to fade out once auth is ready.
  useEffect(() => {
    if (ready) window.dispatchEvent(new Event("app:booted"));
  }, [ready]);

  // Initialize Poseidon grow-out checkpoint reminders (PWA notifications)
  useEffect(() => { initGrowoutReminders(); }, []);

  // Track XP-earning actions in analytics. aquadex_xp_added already fires for
  // every care log, mint, sale, spawn, social action, etc. (see useXPSync.js),
  // so listening here gives a single low-maintenance funnel signal across all
  // of them without instrumenting each action site individually.
  useEffect(() => {
    const handleXpEarned = (e) => {
      const detail = e.detail || {};
      const amount = Number(detail.points || detail.amount || 0);
      if (amount <= 0) return;
      trackEvent("xp_earned", {
        amount,
        reason: detail.actionLabel || detail.label || detail.reason || "unknown",
        tier_changed: !!(detail.tierChanged || detail.levelChanged),
      });
    };
    window.addEventListener("aquadex_xp_added", handleXpEarned);
    return () => window.removeEventListener("aquadex_xp_added", handleXpEarned);
  }, []);

  // Starter Quest: wire the real product signals (tank registered, water test
  // logged, specimen added, first Reef post) to the activation checklist once.
  // App.jsx is always mounted while signed in, so steps are recorded even when
  // ProfileHub (which only mounts on the Profile tab) is not on screen.
  useEffect(() => installStarterQuestListeners(), []);

  // Cloud sync: on login, pull cloud data to this device then push any local-only data up.
  // This is what makes tanks appear on any device the user signs in to.
  const runCloudSync = async (walletAddr, signal) => {
    setSyncStatus("syncing");
    try {
      await pullCloudDataForWallet(walletAddr);
      if (signal?.cancelled) return;
      // Remove garbled action logs (timestamps stored in ms instead of seconds)
      // that may have just been pulled back from the cloud.
      await cleanupGarbledActionLogs(walletAddr);
      if (signal?.cancelled) return;
      await pushAllLocalDataToCloud(walletAddr);
      if (signal?.cancelled) return;
      // Re-publish any certificate metadata document whose upload didn't land.
      // The URI is already on-chain and the storage path is deterministic, so a
      // retry writes to exactly the same URL. Non-fatal.
      await retryPendingMetadataPublishes(walletAddr).catch(() => {});
      if (!signal?.cancelled) {
        queryClient.invalidateQueries({ queryKey: ["tanks", walletAddr] });
        queryClient.invalidateQueries({ queryKey: ["reef", "profile", walletAddr] });
        setSyncStatus("success");
        const now = new Date();
        setLastSyncedAt(now);
        localStorage.setItem("aquadex_last_synced", now.toISOString());

        // Re-read XP from localStorage (which cloud sync may have updated)
        // to ensure the progress bar reflects the correct value after login.
        const restoredXp = getXp();
        if (restoredXp > 0) {
          setXp(restoredXp);
        }

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
    // Task 11 E2E harness: skip cloud sync for the stub account — there's no
    // real Supabase data behind it, and pulling/pushing under a fake wallet
    // address just adds noise (and, worse, writes test rows against the real
    // Supabase project).
    if (isE2EMode()) return;
    const signal = { cancelled: false };
    runCloudSync(account, signal);
    return () => { signal.cancelled = true; };
  }, [account]); // eslint-disable-line react-hooks/exhaustive-deps

  // Set up ethers event listeners for reactive background refetching
  useEffect(() => {
    if (!account) return;
    // Task 11 E2E harness: the stub account has no real chain activity to
    // listen for, and standing up contract listeners just adds RPC calls that
    // can slow down or flake a test run for no benefit.
    if (isE2EMode()) return;

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
    // Task 11 E2E harness: the stub account has no real smart wallet to resolve.
    if (isE2EMode()) return;
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

  // Storefront beta: all authenticated users get the seller workspace (Breeder
  // Terminal, which owns storefront setup/editing) during closed beta.
  const isStorefrontBeta = !!account;

  // ─── Router-driven tab state ──────────────────────────────────────────────
  // The active tab is derived from the URL path (/app/<tab>) instead of local
  // state + URL hash. This gives real URLs, deep-linking, and proper
  // back/forward without full page reloads.
  const navigate = useNavigate();
  // Edge-fade cue for the main tab bar, which overflows on narrow viewports.
  const navScrollRef = useScrollAffordance();

  const location = useLocation();
  const commerceRoute = useMemo(
    () => resolveCommerceRoute(location.pathname, VALID_TABS),
    [location.pathname],
  );
  const isBareAppPath = location.pathname === "/app" || location.pathname === "/app/";
  const legacyHashTab = isBareAppPath ? location.hash.replace(/^#/, "") : "";
  const tabFromPath = location.pathname.replace(/^\/app\/?/, "").split("/")[0];
  const activeTab = commerceRoute?.tab
    || (VALID_TABS.includes(legacyHashTab) ? legacyHashTab : null)
    || (VALID_TABS.includes(tabFromPath) ? tabFromPath : "tanks");

  // Navigate to a tab while preserving any query string (e.g. ?view=breeder).
  // Reads window.location.search at call time so it stays correct even when
  // invoked from event handlers registered once on mount.
  // `anchor` is an optional in-page target appended as a hash, used to deep-link
  // a specific Settings section (`SettingsPanel` reads `#settings/<id>` on mount).
  const goToTab = (tab, anchor) => {
    navigate(`/app/${tab}${window.location.search}${anchor ? `#${anchor}` : ""}`);
  };

  // Canonicalize compatibility aliases without dropping their query or hash.
  // Explicit commerce routes are resolved above and never pass through Tanks.
  useEffect(() => {
    const suffix = `${location.search}${location.hash}`;
    if (commerceRoute?.redirectTo) {
      navigate(`${commerceRoute.redirectTo}${suffix}`, { replace: true });
      return;
    }
    if (isBareAppPath && VALID_TABS.includes(legacyHashTab)) {
      navigate(`/app/${legacyHashTab}${suffix}`, { replace: true });
      return;
    }
    if (tabFromPath === "storefront") {
      navigate(`/app/breeder-terminal${suffix}`, { replace: true });
      return;
    }
    if (tabFromPath === "map") {
      navigate(`/app/orders${window.location.search}`, { replace: true });
      return;
    }
    if (!commerceRoute && !VALID_TABS.includes(tabFromPath)) {
      navigate(`/app/tanks${suffix}`, { replace: true });
    }
  }, [commerceRoute, isBareAppPath, legacyHashTab, location.hash, location.search, navigate, tabFromPath]);

  // Starter Quest: visiting the marketplace tab completes the "browse" step.
  useEffect(() => {
    if (activeTab === "directory") markStarterQuestStep("browse_market");
  }, [activeTab]);

  // Scroll to top when switching tabs (prevents reef/other tabs from rendering mid-page)
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [activeTab]);

  // Deep-link support: ?section=morphs (or any BreederTools section) navigates
  // directly into that sub-tab when the breeder page loads.
  const sectionParam = new URLSearchParams(location.search).get("section");

  // Deep-link support (Fish Finder T4b): ?species=<scientificName> lands the
  // visitor on the Fish Finder (gallery) tab with that species' detail open.
  // Keyed on scientific name (not id) to avoid the specCode-vs-on-chain-id
  // ambiguity; BreedGallery resolves it against its catalog. A fresh
  // /app?species=… (or any non-gallery tab) is routed to the gallery first.
  const deepLinkSpecies = new URLSearchParams(location.search).get("species");
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search).get("species");
    if (sp && !commerceRoute && activeTab !== "gallery") {
      navigate(`/app/gallery${window.location.search}`, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [preselectedLineageId, setPreselectedLineageId] = useState(null);
  const [breederToolsSection, setBreederToolsSection] = useState(sectionParam || "register");
  const [selectedBreedId, setSelectedBreedId] = useState(null);

  // Sync breederToolsSection when ?section= param changes (e.g. direct navigation)
  useEffect(() => {
    if (sectionParam && activeTab === "breeder") {
      setBreederToolsSection(sectionParam);
    }
  }, [sectionParam, activeTab]);
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
  // Casual, not Pro, when nobody has expressed a preference.
  //
  // This default used to be `false` (Pro), and that was an ACCIDENT rather than a
  // decision. The retired onboarding wizard's persona step was the only code in
  // the app that ever wrote `aquadex_casual_mode` for a new account; when the
  // wizard was removed, nothing replaced the question and Pro silently became the
  // first-run experience.
  //
  // What a brand-new hobbyist therefore read on their empty dashboard was
  // "Register your first containment unit to begin … define your system topology",
  // with a Breeder Tools tab sitting as a peer of Aquariums. That is the reported
  // "lost and overwhelmed", almost verbatim.
  //
  // Casual is the right default because the two failure modes are not
  // symmetrical. A breeder who lands in Casual is mildly under-served and has an
  // obvious way out — the mode control sits in the header, and the empty state
  // now points at it. A hobbyist who lands in Pro is reading vocabulary for a
  // job they don't have, with no clue that a friendlier view exists.
  //
  // Anyone who has ever toggled keeps their choice: `saved !== null` still wins.
  // This only changes the answer for accounts that never expressed one, and it is
  // explicitly a display preference, not an entitlement (services/entitlements.js
  // L154-158), so it is reversible in one click.
  const [casualModeActive, setCasualModeActive] = useState(() => {
    const saved = localStorage.getItem("aquadex_casual_mode");
    if (saved !== null) return saved === "true";
    return true;
  });
  const [enteredDashboard, setEnteredDashboard] = useState(() => {
    return localStorage.getItem("aquadex_entered_dashboard") === "true";
  });
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
  // Which Breeder Terminal section an incoming deep link asked for (Settings →
  // Seller). Mirrors the existing `breederToolsSection` pattern for the Breeder
  // Tools tab rather than inventing a second mechanism.
  const [breederTerminalSection, setBreederTerminalSection] = useState(null);
  const [selectedSpecimenId, setSelectedSpecimenId] = useState(null);
  const [preselectedOrderForCheckout, setPreselectedOrderForCheckout] = useState(null);
  const [activeSellerFilter, setActiveSellerFilter] = useState(null);
  // Top-level marketplace species filter (Fish Finder T4a) — set when a
  // "View listings" action deep-links into the directory for a species.
  // Shape: { id:number, name:string|null } | null.
  const [activeSpeciesFilter, setActiveSpeciesFilter] = useState(null);
  // A saved filter set handed over from Settings → Fish Finder, consumed once by
  // MarketplaceBoard. Same stash-then-navigate shape as `activeSpeciesFilter`.
  const [pendingSavedSearch, setPendingSavedSearch] = useState(null);
  // A free-text species query from Poseidon's "look this fish up" action, consumed
  // once by whichever gallery is mounted (FishFinder in casual, BreedGallery in pro).
  const [pendingSpeciesSearch, setPendingSpeciesSearch] = useState(null);
  const [isCartOpen, setIsCartOpen] = useState(false);
  const {
    cart: persistedCart,
    loaded: cartLoaded,
    revalidate: revalidateCartForCheckout,
    hydrateListingForCheckout,
    catalogAuthoritative,
    catalogRevision,
  } = useCart();
  const checkoutHydratedRef = useRef(null);
  const [checkoutRouteState, setCheckoutRouteState] = useState({ key: null, status: "idle", message: null });
  const [pendingConversation, setPendingConversation] = useState(null);
  const promptedProtectedRouteRef = useRef(null);

  // Echo Whispers — real user state from Dexie (replaces hardcoded values)
  const [echoUserState, setEchoUserState] = useState({ totalXp: 0, streakDays: 0, lastActiveDate: null, currentTier: "Shallow" });
  const [echoTankData, setEchoTankData] = useState({});

  // AI companion preferences (Settings → AI Companions). `echoEnabled` gates every
  // Echo surface below; see docs/SETTINGS_SPEC.md D-S-4. There is no per-account
  // Echo state to preserve any more — she is one character, identical for everyone
  // — so switching her off simply stops rendering her.
  const { echoEnabled } = useAiPrefs();

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

  // Protected commerce routes retain their URL while composing the existing
  // ConnectWallet/Privy prompt. Checkout additionally requires a verified
  // Privy session with a linked wallet; a self-custody address alone is not
  // represented as accountless order ownership.
  useEffect(() => {
    const hasAccess = !!account && (!commerceRoute?.requiresVerifiedSession || authenticated);
    if (hasAccess) {
      promptedProtectedRouteRef.current = null;
      return;
    }
    if (!ready || !commerceRoute?.requiresAuth) return;
    const routeKey = `${location.pathname}${location.search}${location.hash}`;
    if (promptedProtectedRouteRef.current === routeKey) return;
    promptedProtectedRouteRef.current = routeKey;
    setTriggerLoginOnEntry(true);
  }, [account, authenticated, commerceRoute, location.hash, location.pathname, location.search, ready]);

  // A canonical checkout route reconstructs selection from non-authoritative
  // identity only: either a canonical listing key in the URL or the persisted
  // cart. Live catalog revalidation must succeed before CheckoutSummary mounts;
  // server checkout remains the final authority for money and ownership.
  useEffect(() => {
    if (commerceRoute?.kind !== "checkout") {
      checkoutHydratedRef.current = null;
      return;
    }
    if (!account || !authenticated || !cartLoaded || !isOnline || !catalogAuthoritative || !catalogRevision) return;

    const hydrationKey = `${account}:${location.pathname}${location.search}:${catalogRevision}:${persistedCart.updatedAt || 0}`;
    if (checkoutHydratedRef.current === hydrationKey) return;

    const params = new URLSearchParams(location.search);
    const listingKey = params.get("listing");
    const requestedQuantity = Number(params.get("quantity") || 1);

    if (listingKey) {
      const resolved = hydrateListingForCheckout(listingKey, requestedQuantity);
      checkoutHydratedRef.current = hydrationKey;
      if (!resolved.eligible) {
        setPreselectedOrderForCheckout(null);
        setCheckoutRouteState({ key: hydrationKey, status: "error", message: resolved.reason });
        return;
      }
      const listing = resolved.listing;
      const listingId = listing.isBatch ? (listing.listingId ?? listing.id) : (listing.tokenId ?? listing.id);
      setPreselectedOrderForCheckout({
        account,
        type: listing.isBatch ? "pending_batch" : "pending_purchase",
        id: listingId,
        meta: {
          quantity: resolved.quantity,
          authoritativeListing: listing,
          catalogRevision,
        },
      });
      setCheckoutRouteState({ key: hydrationKey, status: "ready", message: null });
      return;
    }

    const validation = revalidateCartForCheckout();
    checkoutHydratedRef.current = hydrationKey;
    if (!validation.ready) {
      setPreselectedOrderForCheckout(null);
      setCheckoutRouteState({ key: hydrationKey, status: "error", message: validation.reason });
      return;
    }
    if (validation.changes.length > 0) {
      setPreselectedOrderForCheckout(null);
      setCheckoutRouteState({
        key: hydrationKey,
        status: "error",
        message: "Your cart changed after live availability was checked. Review it before continuing.",
      });
      return;
    }
    if (!validation.eligible) {
      setPreselectedOrderForCheckout(null);
      setCheckoutRouteState({
        key: hydrationKey,
        status: "error",
        message: validation.blockers?.[0] || "One or more cart items need attention before checkout.",
      });
      return;
    }
    setPreselectedOrderForCheckout({
      account,
      type: "pending_cart",
      id: null,
      meta: { items: validation.checkoutItems, catalogRevision },
    });
    setCheckoutRouteState({ key: hydrationKey, status: "ready", message: null });
  }, [account, authenticated, cartLoaded, catalogAuthoritative, catalogRevision, commerceRoute?.kind, hydrateListingForCheckout, isOnline, location.pathname, location.search, persistedCart.updatedAt, revalidateCartForCheckout]);

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
        // Tanks store `active` as a boolean; IndexedDB can't index booleans,
        // so `.where("active").equals(1)` always matched nothing. Filter in JS.
        const tankCount = await db.tanks.filter((t) => t.active !== false).count();

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

  // NOTE: a `reef_share_tank` listener lived here, which navigated to the Reef
  // and re-emitted `reef_open_composer`. Its only dispatcher was the retired
  // "Welcome aboard" modal's share button, so the listener could never fire.
  // Removed rather than left one-sided — see the seam inventory guard. Sharing a
  // tank to the Reef still works from the Reef composer itself.

  const navigateCommerce = useCallback((pathname, {
    replace = false,
    dropLegacyListing = true,
    params: nextParams = {},
  } = {}) => {
    const params = new URLSearchParams(location.search);
    if (dropLegacyListing) params.delete("listing");
    Object.entries(nextParams).forEach(([key, value]) => {
      if (value == null || value === "") params.delete(key);
      else params.set(key, String(value));
    });
    const search = params.toString();
    navigate(
      { pathname, search: search ? `?${search}` : "", hash: location.hash },
      { replace },
    );
  }, [location.hash, location.search, navigate]);

  // Listen for "Ask the breeder" (and other cross-tab) requests to open a DM.
  // Route conversation handoffs through state so the canonical /app/messages
  // surface receives them deterministically after mounting. No message is sent.
  useEffect(() => {
    const handleOpenConversation = (event) => {
      if (!event.detail?.conversationId) return;
      setPendingConversation(event.detail);
      navigateCommerce("/app/messages");
    };
    window.addEventListener("aquadex_open_conversation", handleOpenConversation);
    return () => window.removeEventListener("aquadex_open_conversation", handleOpenConversation);
  }, [navigateCommerce]);

  // Listen for Poseidon deep-link navigation events (species search, tab switches).
  //
  // Poseidon's "look up this fish" action sends `{ tab: "gallery", search: <query> }`,
  // and the query used to be re-dispatched 200ms later as `poseidon:species-search`
  // "for the gallery to pick up". NOTHING has ever listened for that event, so asking
  // Poseidon to find a species navigated to the gallery and silently dropped the
  // search — the user landed on an unfiltered list with no indication anything was
  // lost.
  //
  // It is now stashed and passed down as a prop, the same stash-then-consume shape
  // already used for `pendingSavedSearch` and `activeSpeciesFilter`, so there is one
  // way to hand a pending query to a tab rather than a parallel event channel.
  //
  // NOT routed through `?species=`: that param feeds `deepLinkSpecies`, which matches
  // an EXACT scientificName to open one species' detail and is guarded to fire once.
  // Poseidon sends free text ("neon tetra"), so it belongs in the search box, not in
  // an exact-match deep link that would quietly resolve to nothing.
  useEffect(() => {
    const handlePoseidonNav = (e) => {
      const { tab, search } = e.detail || {};
      if (search) setPendingSpeciesSearch(String(search));
      if (tab) goToTab(tab);
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

  const handleTabChange = (tabName, anchor) => {
    if (tabName !== "breeder") {
      setPreselectedLineageId(null);
    }
    if (tabName !== "gallery") {
      setSelectedBreedId(null);
    }
    if (tabName !== "directory") {
      setActiveSellerFilter(null);
      setActiveSpeciesFilter(null);
    }
    goToTab(tabName, anchor);
  };

  // Lets deep-nested components (e.g. FishFinder's "no tanks" empty state)
  // request a tab switch without threading handleTabChange through every
  // prop chain. Casual Fish Finder T5.
  useEffect(() => {
    const onNavigateTab = (e) => {
      const tab = e?.detail?.tab;
      if (!tab) return;
      // Species-filtered "View listings" (T4a): stash the filter, then switch.
      // handleTabChange only clears the filter when *leaving* directory, so
      // setting it here and navigating to directory preserves it.
      if (tab === "directory") {
        const { speciesId, speciesName, savedSearch } = e.detail || {};
        setActiveSpeciesFilter(
          speciesId != null ? { id: Number(speciesId), name: speciesName || null } : null
        );
        // "Run this search" from Settings. Stashed before the tab switch so the
        // board sees it on its first render rather than a frame later.
        if (savedSearch) setPendingSavedSearch(savedSearch);
      }
      // `section` means different things per destination, so it is resolved here
      // rather than by the caller:
      //   settings         → a URL anchor; SettingsPanel reads `#settings/<id>`.
      //   breeder-terminal → a prop; BreederTerminal owns its own section state.
      // Reef → ProfileEdit uses the first to reach Privacy & Data (D-S-1), and
      // Settings → Seller uses the second to reach Store / Shipping / Payouts.
      const section = e?.detail?.section;
      if (tab === "breeder-terminal") {
        setBreederTerminalSection(section || null);
      }
      const anchor = tab === "settings" && section ? `settings/${section}` : undefined;
      handleTabChange(tab, anchor);
    };
    window.addEventListener("aquadex:navigate-tab", onNavigateTab);
    return () => window.removeEventListener("aquadex:navigate-tab", onNavigateTab);
  }, [handleTabChange]);

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

  const handleOpenProductRoute = (listingKey) => {
    navigateCommerce(canonicalProductPath(listingKey));
  };

  const handleCloseProductRoute = () => {
    navigateCommerce("/app/directory", { params: { action: null, quantity: null } });
  };

  const handleMarketplaceSectionRoute = (section) => {
    navigateCommerce(section === "wanted" ? "/app/wanted" : "/app/directory");
  };

  const requireCommerceAuth = (intent = null) => {
    if (intent?.action) {
      const listingKey = intent.listingKey ? String(intent.listingKey) : null;
      const safeIntent = {
        action: String(intent.action),
        listingKey,
        quantity: Math.max(1, Number(intent.quantity) || 1),
        returnTo: intent.returnTo
          ? String(intent.returnTo)
          : listingKey
            ? canonicalProductPath(listingKey)
            : location.pathname,
      };
      sessionStorage.setItem("aquadex_commerce_return_intent", JSON.stringify(safeIntent));
      navigateCommerce(safeIntent.returnTo, {
        params: { action: safeIntent.action, quantity: listingKey ? safeIntent.quantity : null },
      });
    }
    setTriggerLoginOnEntry(true);
  };

  // Resume only presentation intent after authentication. Payment, offers,
  // messages, reviews, claims, and ownership mutations still require a fresh
  // explicit user confirmation on their existing authorized surface.
  useEffect(() => {
    if (!account || !authenticated) return;
    let intent;
    try {
      intent = JSON.parse(sessionStorage.getItem("aquadex_commerce_return_intent") || "null");
    } catch {
      intent = null;
    }
    if (!intent?.action || !intent?.returnTo) return;
    sessionStorage.removeItem("aquadex_commerce_return_intent");
    if (intent.action === "buy" && intent.listingKey) {
      navigateCommerce("/app/checkout", {
        params: { listing: intent.listingKey, quantity: intent.quantity, action: "buy" },
      });
      return;
    }
    navigateCommerce(intent.returnTo, {
      params: {
        action: intent.action,
        quantity: intent.listingKey ? intent.quantity : null,
      },
    });
  }, [account, authenticated]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSelectCheckoutOrder = (type, id, meta = null) => {
    setPreselectedOrderForCheckout({ account, type, id, meta });
    const isCheckoutSelection = type === "pending_purchase" || type === "pending_batch" || type === "pending_cart";
    if (!isCheckoutSelection) {
      navigateCommerce("/app/orders");
      return;
    }
    const listingKey = type === "pending_purchase"
      ? `single-${id}`
      : type === "pending_batch"
        ? `batch-${id}`
        : null;
    navigateCommerce("/app/checkout", {
      params: {
        listing: listingKey,
        quantity: type === "pending_batch" ? (Number(meta?.quantity) || 1) : null,
        action: listingKey ? "buy" : null,
      },
    });
  };

  // CartDrawer's handoff selects the existing CheckoutSummary presentation.
  // Anonymous users keep the persisted cart and /app/checkout intent while the
  // existing Privy prompt runs; payment remains unavailable until authenticated.
  const handleProceedToCheckoutFromCart = (cart) => {
    setIsCartOpen(false);
    if (!account || !authenticated || !cartLoaded) {
      // Route intent only until CartProvider finishes verified-session
      // guest→account reconciliation. Never snapshot a pre-login cart into
      // the protected checkout presentation.
      setPreselectedOrderForCheckout(null);
      navigateCommerce("/app/checkout");
      if (!account || !authenticated) requireCommerceAuth();
      return;
    }
    handleSelectCheckoutOrder("pending_cart", null, { items: cart.items });
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

  // Starter Quest: a keeper who already owns species has clearly set up a tank
  // and added fish in a prior session — seed those steps so the checklist isn't
  // misleadingly empty for returning users.
  useEffect(() => {
    if (speciesCount > 0) {
      markStarterQuestStep("add_tank");
      markStarterQuestStep("add_fish");
    }
  }, [speciesCount]);

  const renderContent = () => {
    if (commerceRoute?.kind === "not-found") {
      return (
        <CommerceRouteNotice
          title="Commerce page not found"
          message="This marketplace link is incomplete or no longer supported. Nothing was redirected to an unrelated dashboard page."
          onAction={() => navigateCommerce("/app/directory", { replace: true })}
        />
      );
    }

    const lacksCommerceAccess = commerceRoute?.requiresAuth
      && (!account || (commerceRoute.requiresVerifiedSession && !authenticated));
    if (lacksCommerceAccess) {
      const titles = {
        checkout: "Sign in with your Aquadex account to continue to checkout",
        orders: "Sign in to view your orders",
        messages: "Sign in to view your messages",
        "breeder-terminal": "Sign in to manage your storefront",
      };
      return (
        <CommerceAuthRequired
          title={titles[commerceRoute.kind] || "Sign in to continue"}
          onSignIn={requireCommerceAuth}
        />
      );
    }

    if (commerceRoute?.kind === "checkout") {
      const checkoutKey = `${account}:${location.pathname}${location.search}:${catalogRevision}:${persistedCart.updatedAt || 0}`;
      if (!isOnline || !catalogAuthoritative) {
        return (
          <CommerceRouteNotice
            title="Live availability check required"
            message={isOnline
              ? "Aquadex is loading the authoritative marketplace catalog. Checkout stays blocked until that check succeeds."
              : "Reconnect to the internet before checkout. Offline cart snapshots can be edited, but they cannot start payment."}
            actionLabel="Review cart"
            onAction={() => navigateCommerce("/app/cart")}
          />
        );
      }
      if (checkoutRouteState.key !== checkoutKey || checkoutRouteState.status === "idle") {
        return <CommerceRouteNotice title="Checking your cart" message="Confirming live availability before checkout…" />;
      }
      if (checkoutRouteState.status === "error") {
        return (
          <CommerceRouteNotice
            title="Checkout needs your attention"
            message={checkoutRouteState.message}
            actionLabel="Review cart"
            onAction={() => navigateCommerce("/app/cart")}
          />
        );
      }
    }

    if (commerceRoute?.kind === "store") {
      return (
        <StorefrontContent
          identifier={commerceRoute.slug}
          embedded
          onOpenListing={handleOpenProductRoute}
        />
      );
    }

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
            onSwitchToPro={() => {
              setCasualModeActive(false);
              localStorage.setItem("aquadex_casual_mode", "false");
            }}
          />
        );
      case "directory":
        return (
          <>
            {/* Species filter banner (Fish Finder T4a). MarketplaceBoard hides
                its own header when filterSpeciesId is set, so App owns the
                "showing / clear" affordance for the top-level filtered view. */}
            {activeSpeciesFilter && (
              <div className="glass-card" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "1rem", padding: "0.75rem 1.25rem", marginBottom: "1rem", flexWrap: "wrap" }}>
                <span style={{ fontSize: "0.85rem", color: "var(--text-secondary)" }}>
                  Showing listings for <strong style={{ color: "#fff" }}>{activeSpeciesFilter.name || "this species"}</strong>
                </span>
                <button className="btn-secondary" style={{ fontSize: "0.75rem", padding: "0.35rem 0.9rem" }} onClick={() => setActiveSpeciesFilter(null)}>
                  Clear filter
                </button>
              </div>
            )}
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
              filterSpeciesId={activeSpeciesFilter?.id ?? null}
              routeListingKey={commerceRoute?.kind === "product" ? commerceRoute.listingKey : null}
              routeView={commerceRoute?.kind === "saved" ? "saved" : commerceRoute?.kind === "wanted" ? "wanted" : "listings"}
              routeCollection={commerceRoute?.kind === "collection" ? commerceRoute.collection : "all"}
              onOpenProduct={handleOpenProductRoute}
              onCloseProduct={handleCloseProductRoute}
              onNavigateMarketplace={handleMarketplaceSectionRoute}
              onRequireAuth={requireCommerceAuth}
              pendingSavedSearch={pendingSavedSearch}
              onClearPendingSavedSearch={() => setPendingSavedSearch(null)}
            />
          </>
        );
      case "gallery": {
        const galleryProps = {
          contractAddress: CONTRACT_ADDRESS,
          marketplaceAddress: MARKETPLACE_ADDRESS,
          walletAccount: account,
          onViewLineage: handleLineageSelect,
          preselectedBreedId: selectedBreedId,
          onClearPreselectedBreed: () => setSelectedBreedId(null),
          onSelectSpecimen: setSelectedSpecimenId,
          displayTank: displayTank,
          setDisplayTank: setDisplayTank,
          onSelectCheckoutOrder: handleSelectCheckoutOrder,
          onCheckoutSuccessRedirect: handleCheckoutSuccessRedirect,
          casualModeActive: casualModeActive,
          initialSelectedBreed: gallerySelectedBreed,
          onSelectedBreedChange: setGallerySelectedBreed,
          deepLinkSpecies: deepLinkSpecies,
          pendingSpeciesSearch: pendingSpeciesSearch,
          onClearPendingSpeciesSearch: () => setPendingSpeciesSearch(null),
        };
        return casualModeActive
          ? <FishFinder {...galleryProps} />
          : <BreedGallery {...galleryProps} />;
      }
      // No `case "map"` — the Local Sellers/Local Map tab is retired
      // (Fish Finder T15). "map" is no longer in VALID_TABS, and the redirect
      // effect below sends /app/map to /app/orders, where pickup coordination
      // actually lives.
      case "orders": {
        const accountCheckoutSelection = preselectedOrderForCheckout?.account === account
          ? preselectedOrderForCheckout
          : null;
        return (
          <CheckoutSummary
            key={`${account || "anonymous"}:${location.pathname}${location.search}:${catalogRevision}:${persistedCart.updatedAt || 0}`}
            contractAddress={CONTRACT_ADDRESS} 
            marketplaceAddress={MARKETPLACE_ADDRESS} 
            walletAccount={account} 
            preselectedOrderForCheckout={accountCheckoutSelection}
            clearPreselectedOrder={() => setPreselectedOrderForCheckout(null)}
            displayTank={displayTank}
            casualModeActive={casualModeActive}
          />
        );
      }
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
              openMessages={commerceRoute?.kind === "messages"}
              pendingConversation={pendingConversation}
              onConversationConsumed={() => setPendingConversation(null)}
              onCloseMessages={() => navigateCommerce("/app/reef", { params: { action: null, quantity: null } })}
            />
          </Suspense>
        );
      case "settings":
        return (
          <SettingsPanel
            casualModeActive={casualModeActive}
            onToggleMode={(newCasualVal) => {
              setCasualModeActive(newCasualVal);
              localStorage.setItem("aquadex_casual_mode", newCasualVal.toString());
            }}
            // Threaded rather than read from localStorage inside the section, so
            // picking an active tank in Settings updates the same state the cart
            // drawer and specimen compatibility already read (App.jsx persists it).
            // contractAddress/walletAccount let the section load the tank list from
            // the same owner-scoped `useUserTanks` query Fish Finder uses, instead
            // of a second unscoped Dexie read that would list other accounts' tanks.
            contractAddress={CONTRACT_ADDRESS}
            walletAccount={account}
            displayTank={displayTank}
            setDisplayTank={setDisplayTank}
            // "Sync now" reuses the SAME routine the login sync runs, so there is
            // one definition of what syncing means and one owner of the status and
            // the `aquadex_last_synced` timestamp. A second implementation in the
            // Settings section would be a button that syncs slightly differently.
            onSyncNow={account && !isE2EMode() ? () => runCloudSync(account) : null}
            syncStatus={syncStatus}
            lastSyncedAt={lastSyncedAt}
          />
        );
      case "founders":
        return (
          <FoundersDashboard casualModeActive={casualModeActive} />
        );
      case "profile":
        return (
          <ProfileHub
            account={account}
            levelInfo={levelInfo}
            xp={xp}
            speciesCount={speciesCount}
            isFounder={isFounder}
            isStorefrontBeta={isStorefrontBeta}
            onNavigate={handleTabChange}
            onSwitchToPro={() => {
              setCasualModeActive(false);
              localStorage.setItem("aquadex_casual_mode", "false");
            }}
          />
        );
      case "breeder-terminal":
        return (
          <Suspense fallback={
            <div style={{ maxWidth: "1100px", margin: "0 auto", padding: "2rem 0" }}>
              <div className="shimmer-placeholder" style={{ width: "100%", height: "300px", borderRadius: "16px" }} />
            </div>
          }>
            <BreederTerminal
              walletAccount={smartWalletForFounderCheck || account}
              casualModeActive={casualModeActive}
              initialSection={breederTerminalSection}
            />
          </Suspense>
        );
      case "tanks":
      default:
        return (
          <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
            {/* The activation checklist, on the page a new keeper actually lands
                on. It used to render only inside ProfileHub, on the `profile`
                tab — which has no entry in the nav array above, so on desktop it
                was reachable only by typing /app/profile. The thing built to
                orient a new user was one unlinked route away from them.

                It self-hides once dismissed, and dismissal is available
                immediately rather than only on completion. */}
            <StarterQuestCard onNavigate={handleTabChange} compact />
            <TankList 
              contractAddress={CONTRACT_ADDRESS} 
              walletAccount={account} 
              onViewLineage={handleLineageSelect} 
              onListOnMarketplace={handleListOnMarketplace}
              casualModeActive={casualModeActive}
              onSelectSpecimen={setSelectedSpecimenId}
            />
            <div className="zone-leaderboard-sidebar" style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
              {/* The Echo dashboard card used to sit here. It was a static JPG
                  headshot with its own Dexie loader and its own mood system — a
                  third rendering of a character who now has exactly one. Echo is
                  ambient presence; she does not need a card. */}
              <div style={{ flex: "1 1 260px", minWidth: 0 }}>
                <RewardCreditsCard casualModeActive={casualModeActive} compact />
              </div>
            </div>
          </div>
        );
    }
  };

  // Task 3 prototype preview — standalone, bypasses the normal app shell.
  // Visit any URL with ?preview=living-tank to view it.
  if (new URLSearchParams(location.search).get("preview") === "living-tank") {
    return (
      <Suspense fallback={<div style={{ padding: "2rem", color: "#9fb4c7" }}>Loading Living Tank preview…</div>}>
        <LivingTankPreview />
      </Suspense>
    );
  }

  // Explicit public commerce routes enter the shared shell directly. Protected
  // routes render the shell's sign-in recovery without losing their URL.
  const bypassFirstRunLanding = !!commerceRoute || (isBareAppPath && legacyHashTab === "directory");
  if (!enteredDashboard && !bypassFirstRunLanding) {
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


  return (
    <>
    <NetworkStatusBanner />
    <div className={casualModeActive ? "app-content app-content--casual" : "app-content"} style={{ padding: "2rem max(2rem, (100vw - 1200px) / 2)", minHeight: "100vh" }}>
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
            <CartButton onOpen={() => setIsCartOpen(true)} />
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
          // Was an inline ref toggling --scrolled-start/--scrolled-end. That had
          // the right-edge condition inverted (it fired on REACHING the end, so
          // the "more this way" cue was missing at rest — the beta report), never
          // removed its scroll listener, and did not react to resize or to the tab
          // count changing with mode/role. useScrollAffordance handles all three.
          ref={navScrollRef}
          className={`aquadex-nav glass-card ${casualModeActive ? "aquadex-nav--casual" : "aquadex-nav--pro"}`}
          style={{ marginBottom: "2rem" }}
        >
          {/* Tab helper: render a single pill button */}
          {[
            { id: "tanks",     icon: "🐠",  label: casualModeActive ? "My Aquariums"  : "Aquariums",    tourId: "aquariums-tab", alwaysShow: true  },
            { id: "gallery",   icon: "🔍",  label: casualModeActive ? "Fish Finder"   : "Breed Gallery", alwaysShow: true  },
            { id: "breeder",   icon: "🧬",  label: "Breeder Tools",                                      alwaysShow: !casualModeActive },
            { id: "directory", icon: "🛒",  label: casualModeActive ? "Breeder Store" : "Marketplace",  alwaysShow: true  },
            /* The "Local Sellers"/"Local Map" tab was retired (Fish Finder T15).
               Its two jobs already live where they belong: finding sellers is the
               Marketplace's job, and a pickup meetup belongs to the order that
               created it — My Orders' PickupPanel already shows the real pin,
               address, directions, and handoff confirmation. The tab's own map
               only ever plotted the user's own pickups, less well. Proximity
               DISCOVERY was fabricated and removed (Decision D3); the real
               opt-in version is T15b. /app/map redirects to /app/orders. */
            { id: "orders",    icon: "📦",  label: "My Orders",                                          alwaysShow: true  },
            ...(incomingCount > 0 ? [{ id: "incoming", icon: "🚚", label: casualModeActive ? "Incoming" : "In Transit", alwaysShow: true, incomingBadge: true }] : []),
            { id: "reef",      icon: "🪸",  label: casualModeActive ? "The Reef"      : "Social",        alwaysShow: true },
            { id: "settings",  icon: "⚙️", label: "Settings",                                           alwaysShow: true  },
            ...(isFounder ? [{ id: "founders", icon: "📊", label: "Founders", alwaysShow: true }] : []),
            ...(!casualModeActive && isStorefrontBeta ? [{ id: "breeder-terminal", icon: "🧑‍🌾", label: "Breeder Terminal", alwaysShow: true }] : []),
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

      {/* Casual mobile bottom tab bar (hidden on wider screens + in Pro via CSS) */}
      {account && casualModeActive && (
        <CasualBottomNav
          activeTab={activeTab}
          onNavigate={handleTabChange}
          incomingCount={incomingCount}
        />
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

      {/* Echo mentions one thing she noticed in the keeper's own logs, and hands
          the question to Poseidon on tap. Both modes now: casual-only was the same
          mistake as the old XP gate below — it withheld the guide from a whole mode.
          Pro gets the terse wording from services/echoNotices.js. */}
      {echoEnabled && (
        <EchoWhispers
          casualModeActive={casualModeActive}
          userState={echoUserState}
          tankData={echoTankData}
        />
      )}

      {/* Echo — persistent presence, both modes.
          Pro gets `calm`: she is there but still and silent, per spec §3. She used
          to be casual-only, which meant a Pro keeper had no guide at all.
          No `hasEcho` gate any more: she was hidden below 500 XP, which withheld
          the guide from exactly the people who need one. */}
      {echoEnabled && <EchoAmbient visible calm={!casualModeActive} />}

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

      {/* Persistent cart drawer (Task 10) — displayTank feeds the Task 11
          add-on tank-fit signal; the drawer degrades gracefully to a
          "select a tank" affordance when it's null. */}
      <CartDrawer
        isOpen={isCartOpen || commerceRoute?.kind === "cart"}
        onClose={() => {
          setIsCartOpen(false);
          if (commerceRoute?.kind === "cart") navigateCommerce("/app/directory");
        }}
        onProceedToCheckout={handleProceedToCheckoutFromCart}
        casualModeActive={casualModeActive}
        buyerTank={displayTank}
      />
    </div>


    </>
  );
}
