/**
 * StorefrontPage.jsx — The main hosted Breeder Storefront page.
 *
 * Renders at /store/{slug-or-wallet}. Fully public, no auth required to view.
 * Uses the useStorefront hook to fetch data via TanStack Query.
 * Implements all 5 polish rounds: glassmorphism, spring animations,
 * haptic feedback, accessible empty/error states, and responsive layout.
 */
import React, { useState, useMemo, useEffect, useCallback } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BreederHeader } from "./BreederHeader";
import { StorefrontStats } from "./StorefrontStats";
import { StorefrontFilters } from "./StorefrontFilters";
import { ListingCard } from "./ListingCard";
import { BreedingTimeline } from "./BreedingTimeline";
import { StorePolicies } from "./StorePolicies";
import { StorefrontSkeleton } from "./StorefrontSkeleton";
import { useStorefront, useStorefrontCache } from "../../hooks/useStorefront";
import { WifiSlash, ArrowClockwise, Storefront as StorefrontIcon } from "@phosphor-icons/react";

// Self-contained QueryClient for the standalone storefront page
const storefrontQueryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

/**
 * Entry point: wraps StorefrontContent with its own QueryClientProvider
 * so it works as a standalone page (store.html) without the main app shell.
 */
export function StorefrontPage() {
  return (
    <QueryClientProvider client={storefrontQueryClient}>
      <StorefrontContent />
    </QueryClientProvider>
  );
}

// ─── Demo/Preview Data ─────────────────────────────────────────────────────
// Used when visiting /store/demo or /store/coral-kings without live Supabase data
const DEMO_STOREFRONT_DATA = {
  profile: {
    walletAddress: "0x9174d162ed1ab6594064fa0ffbfaf063dc20f3c6",
    slug: "coral-kings",
    displayName: "Coral Kings Aquatics",
    bio: "Specializing in high-grade German Blue Rams, Apistogramma varieties, and rare wild-type livebearers. All fish bred in-house with RO/DI water and live foods. Shipping Tue–Thu year-round.",
    avatarCid: null,
    bannerCid: null,
    specialties: ["Dwarf Cichlids", "Livebearers", "Rare Imports"],
    location: "Portland, OR",
    isMasterBreeder: true,
    storefrontActive: true,
    currentTier: "Abyssal",
    socialLinks: {},
    createdAt: "2024-08-15T00:00:00Z",
    policies: {
      shipping: "Overnight UPS/USPS Priority, shipped Tue–Thu to avoid weekend transit. Heat or cold packs included based on your local forecast. Live Arrival Guarantee on all overnight shipments. Buyer pays actual shipping.",
      doa: "DOA covered when you send a clear photo of the unopened bag within 2 hours of delivery. I'll replace on the next ship day or refund the specimen cost. Shipping on replacements is split 50/50.",
      handshake: "Local pickup in the Portland metro. Cash or in-app checkout. We meet at my fish room by appointment so you can see the parent stock. Bring an insulated container — I bag with pure O2 for the ride home.",
    },
  },
  stats: {
    totalSales: 47,
    totalListings: 12,
    activeListings: 8,
    avgRating: 4.8,
    reviewCount: 31,
    speciesCount: 14,
    repeatBuyerRate: 0.38,
    lastActive: "2026-06-22T14:30:00Z",
  },
  listings: [
    {
      id: "demo-1",
      type: "specimen",
      commonName: "German Blue Ram",
      scientificName: "Mikrogeophagus ramirezi",
      priceEth: "0.0085",
      priceUsd: 28.50,
      imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/3/37/Microgeophagus_ramirezi_male.jpg/1280px-Microgeophagus_ramirezi_male.jpg",
      pedigree: "purebred",
      shippingAvailable: true,
      localPickup: true,
      isBatch: false,
      quantity: 1,
    },
    {
      id: "demo-2",
      type: "specimen",
      commonName: "Apistogramma Cacatuoides",
      scientificName: "Apistogramma cacatuoides",
      priceEth: "0.012",
      priceUsd: 39.00,
      imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/a/a0/Apistogramma_cacatuoides.jpg/1280px-Apistogramma_cacatuoides.jpg",
      pedigree: "purebred",
      shippingAvailable: true,
      localPickup: false,
      isBatch: false,
      quantity: 1,
    },
    {
      id: "demo-3",
      type: "batch",
      commonName: "Endler's Livebearer Fry",
      scientificName: "Poecilia wingei",
      priceEth: "0.003",
      priceUsd: 9.50,
      imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/e/ef/Endler_Guppy_Livebearer.jpg/1280px-Endler_Guppy_Livebearer.jpg",
      pedigree: "purebred",
      shippingAvailable: true,
      localPickup: true,
      isBatch: true,
      quantity: 24,
      quantityRemaining: 18,
    },
    {
      id: "demo-4",
      type: "specimen",
      commonName: "Electric Blue Acara",
      scientificName: "Andinoacara pulcher",
      priceEth: "0.015",
      priceUsd: 48.00,
      imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/2/2c/Andinoacara_pulcher_-_Blue_Acara.jpg/1280px-Andinoacara_pulcher_-_Blue_Acara.jpg",
      pedigree: "F1-hybrid",
      shippingAvailable: false,
      localPickup: true,
      isBatch: false,
      quantity: 1,
    },
    {
      id: "demo-5",
      type: "batch",
      commonName: "Corydoras Pygmaeus Juveniles",
      scientificName: "Corydoras pygmaeus",
      priceEth: "0.004",
      priceUsd: 12.00,
      imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/8/80/Corydoras_pygmaeus.jpg/800px-Corydoras_pygmaeus.jpg",
      pedigree: "purebred",
      shippingAvailable: true,
      localPickup: true,
      isBatch: true,
      quantity: 30,
      quantityRemaining: 22,
    },
    {
      id: "demo-6",
      type: "specimen",
      commonName: "Wild-Type Betta Imbellis",
      scientificName: "Betta imbellis",
      priceEth: "0.022",
      priceUsd: 72.00,
      imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/1/19/Betta_imbellis_male.jpg/1280px-Betta_imbellis_male.jpg",
      pedigree: "wild-caught",
      shippingAvailable: true,
      localPickup: false,
      isBatch: false,
      quantity: 1,
    },
  ],
  breedingHistory: [
    { spawnId: "sp-1", species: "German Blue Ram", offspringCount: 45, spawnDate: "2026-05-28T00:00:00Z", status: "completed" },
    { spawnId: "sp-2", species: "Apistogramma Cacatuoides", offspringCount: 32, spawnDate: "2026-05-15T00:00:00Z", status: "completed" },
    { spawnId: "sp-3", species: "Endler's Livebearer", offspringCount: 28, spawnDate: "2026-04-20T00:00:00Z", status: "completed" },
    { spawnId: "sp-4", species: "Corydoras Pygmaeus", offspringCount: 55, spawnDate: "2026-04-02T00:00:00Z", status: "completed" },
    { spawnId: "sp-5", species: "Betta Imbellis", offspringCount: 18, spawnDate: "2026-03-10T00:00:00Z", status: "completed" },
    { spawnId: "sp-6", species: "German Blue Ram", offspringCount: 38, spawnDate: "2026-02-14T00:00:00Z", status: "completed" },
    { spawnId: "sp-7", species: "Apistogramma Borellii", offspringCount: 22, spawnDate: "2026-01-20T00:00:00Z", status: "completed" },
  ],
  fetchedAt: Date.now(),
};

function StorefrontContent() {
  // Extract identifier from URL path: /store/{slug-or-wallet}
  const identifier = useMemo(() => {
    const path = window.location.pathname;
    const match = path.match(/\/store\/([^/?#]+)/);
    return match ? decodeURIComponent(match[1]) : null;
  }, []);

  // Demo mode: use sample data when visiting /store/demo
  const isDemo = identifier === "demo" || identifier === "coral-kings";

  // Subtle parallax on banner (reduces on scroll)
  useEffect(() => {
    const banner = document.querySelector(".sf-header__banner-img");
    if (!banner) return;

    const prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (prefersReduced) return;

    const handleScroll = () => {
      const scrollY = window.scrollY;
      const scale = 1 + Math.min(scrollY * 0.0003, 0.08);
      const translateY = Math.min(scrollY * 0.15, 40);
      banner.style.transform = `scale(${scale}) translateY(${translateY}px)`;
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const { data: storefront, isLoading, error, refetch } = useStorefront(identifier, { enabled: !isDemo });
  const { data: cachedStorefront } = useStorefrontCache(identifier);

  // Filters
  const [filterType, setFilterType] = useState("all");
  const [sortBy, setSortBy] = useState("newest");

  // Offline detection
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  useEffect(() => {
    const onOnline = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  // Determine what data to display (live, cached fallback, or demo)
  const displayData = isDemo ? DEMO_STOREFRONT_DATA : (storefront || cachedStorefront);

  // Filter + sort listings
  const filteredListings = useMemo(() => {
    if (!displayData?.listings) return [];
    let items = [...displayData.listings];

    // Type filter
    if (filterType === "specimen") {
      items = items.filter((l) => !l.isBatch && l.type !== "batch");
    } else if (filterType === "batch") {
      items = items.filter((l) => l.isBatch || l.type === "batch");
    }

    // Sort
    switch (sortBy) {
      case "price-asc":
        items.sort((a, b) => parseFloat(a.priceEth || a.price || 0) - parseFloat(b.priceEth || b.price || 0));
        break;
      case "price-desc":
        items.sort((a, b) => parseFloat(b.priceEth || b.price || 0) - parseFloat(a.priceEth || a.price || 0));
        break;
      case "newest":
      default:
        // Already sorted by created_at desc from API
        break;
    }

    return items;
  }, [displayData, filterType, sortBy]);

  // Purchase handler — routes through existing checkout
  const handleBuyNow = useCallback((listing) => {
    const isBatch = listing.isBatch || listing.type === "batch";
    // Navigate to the main app checkout flow
    const baseUrl = window.location.origin;
    const targetUrl = `${baseUrl}/app#directory`;
    window.location.href = targetUrl;
  }, []);

  // ─── Loading state ───────────────────────────────────────────────────────
  if (!isDemo && isLoading && !displayData) {
    return (
      <div className="sf-page">
        <StorefrontNavbar />
        <main className="sf-page__content">
          <StorefrontSkeleton />
        </main>
      </div>
    );
  }

  // ─── Error state (no cached data available) ──────────────────────────────
  if (!isDemo && error && !displayData) {
    return (
      <div className="sf-page">
        <StorefrontNavbar />
        <main className="sf-page__content">
          <div className="sf-error glass-card">
            <StorefrontIcon weight="duotone" size={48} style={{ color: "var(--accent-blue)", opacity: 0.6 }} />
            <h2 className="sf-error__title">Storefront Not Found</h2>
            <p className="sf-error__message">
              {identifier
                ? `We couldn't find a breeder with the identifier "${identifier}".`
                : "No storefront identifier provided in the URL."}
            </p>
            <p className="sf-error__hint">
              Check the URL or browse available storefronts.
            </p>
            <div className="sf-error__actions">
              <button className="sf-error__btn sf-error__btn--primary" onClick={() => refetch()}>
                <ArrowClockwise weight="bold" size={16} />
                Try Again
              </button>
              <a href="/marketplace" className="sf-error__btn sf-error__btn--secondary">
                Browse Marketplace
              </a>
            </div>
          </div>
        </main>
      </div>
    );
  }

  // ─── No identifier in URL ────────────────────────────────────────────────
  if (!identifier) {
    return (
      <div className="sf-page">
        <StorefrontNavbar />
        <main className="sf-page__content">
          <div className="sf-error glass-card">
            <StorefrontIcon weight="duotone" size={48} style={{ color: "var(--accent-blue)", opacity: 0.6 }} />
            <h2 className="sf-error__title">No Breeder Specified</h2>
            <p className="sf-error__message">
              Visit a storefront URL like <code>/store/coral-kings</code> or <code>/store/0x...</code>
            </p>
            <a href="/marketplace" className="sf-error__btn sf-error__btn--primary">
              Browse Marketplace
            </a>
          </div>
        </main>
      </div>
    );
  }

  const { profile, stats, breedingHistory } = displayData;

  // Update page title with breeder name
  useEffect(() => {
    if (profile?.displayName) {
      document.title = `${profile.displayName} — Aquacellum Storefront`;
    }
  }, [profile]);

  return (
    <div className="sf-page" data-tier={profile.currentTier?.toLowerCase()}>
      <a href="#sf-main" className="sf-skip-link">Skip to content</a>
      <StorefrontNavbar breederName={profile.displayName} />

      {/* Offline banner */}
      {!isOnline && (
        <div className="sf-offline-banner" role="alert">
          <WifiSlash weight="bold" size={16} />
          <span>Limited offline mode — showing cached data</span>
        </div>
      )}

      <main className="sf-page__content" id="sf-main" role="main">
        {/* Header with banner + avatar + info */}
        <BreederHeader profile={profile} stats={stats} />

        {/* Stats bar */}
        <StorefrontStats stats={stats} memberSince={profile.createdAt} />

        {/* Listings section */}
        <section className="sf-listings" aria-label="Active listings">
          <h2 className="sf-section-title">Active Listings</h2>

          {displayData.listings.length > 0 ? (
            <>
              <StorefrontFilters
                filterType={filterType}
                setFilterType={setFilterType}
                sortBy={sortBy}
                setSortBy={setSortBy}
                totalCount={filteredListings.length}
              />
              <div className="sf-listings__grid">
                {filteredListings.map((listing, idx) => (
                  <ListingCard
                    key={listing.id || idx}
                    listing={listing}
                    onBuyNow={handleBuyNow}
                    style={{ animationDelay: `${idx * 50}ms` }}
                  />
                ))}
              </div>
            </>
          ) : (
            <div className="sf-listings__empty glass-card">
              <StorefrontIcon weight="duotone" size={40} style={{ color: "var(--accent-blue)", opacity: 0.5 }} />
              <p className="sf-listings__empty-text">
                This breeder has no active listings yet — check back soon.
              </p>
            </div>
          )}
        </section>

        {/* Store policies (shipping, DOA, in-person handshake) */}
        <StorePolicies policies={profile.policies} />

        {/* Breeding history */}
        <BreedingTimeline history={breedingHistory || []} />
      </main>

      {/* Footer */}
      <footer className="sf-footer">
        <p>
          Powered by <a href="/" className="sf-footer__link">Aquacellum</a> — All purchases buyer-protected
        </p>
      </footer>
    </div>
  );
}

/**
 * Minimal glassmorphic navbar for the storefront page.
 */
function StorefrontNavbar({ breederName }) {
  return (
    <nav className="sf-nav" aria-label="Storefront navigation">
      <a href="/" className="sf-nav__logo" aria-label="Aquacellum home">
        <svg width="28" height="28" viewBox="0 0 38 38" fill="none">
          <defs>
            <linearGradient id="sf-nav-g" x1="0%" y1="100%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#38bdf8" />
              <stop offset="50%" stopColor="#34d399" />
              <stop offset="100%" stopColor="#a78bfa" />
            </linearGradient>
          </defs>
          <circle cx="19" cy="19" r="15" stroke="url(#sf-nav-g)" strokeWidth="2.4" fill="none" />
          <path d="M19 4 C22.5 9.5, 24 14, 22.8 19 C21.6 24, 22.5 28.5, 19 34" stroke="url(#sf-nav-g)" strokeWidth="1.8" fill="none" strokeLinecap="round" />
          <path d="M19 4 C15.5 9.5, 14 14, 15.2 19 C16.4 24, 15.5 28.5, 19 34" stroke="url(#sf-nav-g)" strokeWidth="1.8" fill="none" strokeLinecap="round" />
          <circle cx="19" cy="19" r="4" fill="url(#sf-nav-g)" />
          <circle cx="17.5" cy="17.5" r="1.3" fill="#fff" opacity="0.7" />
        </svg>
        <div className="sf-nav__brand">
          <span className="sf-nav__brand-name">AQUACELLUM</span>
          <span className="sf-nav__brand-sub">Storefront</span>
        </div>
      </a>

      <div className="sf-nav__links">
        <a href="/marketplace">Marketplace</a>
        <a href="/app#directory">Open App</a>
      </div>
    </nav>
  );
}
