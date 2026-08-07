import React, { useMemo, useState, useEffect, useRef } from "react";
import { BreedGallery } from "../BreedGallery";
import { SpeciesCardPremium } from "../SpeciesCardPremium";
import { LoadingSkeleton } from "../LoadingSkeleton";
import { useContractSpecies, useSpeciesData } from "../../hooks/useSpeciesData";
import { useUserTanks } from "../../hooks/useUserTanks";
import { useSpeciesAvailability } from "../../hooks/useSpeciesAvailability";
import { useSpeciesSearch } from "../../hooks/useSpeciesSearch";
import { useDex } from "../../hooks/useDex";
import { XP_ACTIONS } from "../../utils/xp";
import { buildGlobalCatalog } from "../../services/speciesCatalog";
import { tankFitInputs } from "../../services/compatibleTanks";
import { summarizeAvailability } from "../../services/speciesAvailability";
import { rankSpeciesMatches } from "./matchRanking";
import { DISCOVERY_INTENTS, filterByIntent } from "./discoveryIntents";
import { MyDexPanel } from "./MyDexPanel";
import { useSpeciesMastery, getMasteryForSpecies } from "../../hooks/useSpeciesMastery";
import { FINDER_COPY } from "./finderCopy";
import "./FishFinder.css";

/**
 * FishFinder — the Casual `gallery` tab surface (Fish Finder Rework, Task 5;
 * cards evolved to a compatibility-first, acquisition-aware design in Task 6;
 * guided discovery added in Task 7).
 *
 * Renders, top to bottom:
 *   1. a tank context bar (pick which tank to match against)
 *   2. "Find my next fish" — deterministic intent chips + name search (T7)
 *   3. either the discovery "Results" grid (when a chip/search is active) or
 *      the "Good matches for [Tank]" home (when inactive) — never both
 *   4. the existing <BreedGallery casualModeActive /> unchanged, as the
 *      "Browse all species" continuation.
 *
 * Accepts and forwards every prop BreedGallery receives today. Does not fork
 * any fit/compatibility/availability logic — composes rankSpeciesMatches
 * (matchRanking.js, itself composing assessSpeciesFit), filterByIntent
 * (discoveryIntents.js, a pure predicate engine — T7), and
 * useSpeciesAvailability/summarizeAvailability for the acquisition hook. The
 * card itself (SpeciesCardPremium) owns the verdict-chip presentation via
 * fitPresentationKind — no chip is rendered here to avoid a duplicate. Both
 * the home and Results grids render through the same renderMatchCard path.
 */
export function FishFinder({
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
  onClearPendingSpeciesSearch,
}) {
  const browseSectionRef = useRef(null);

  const { data: tanks = [], isLoading: tanksLoading } = useUserTanks(contractAddress, walletAccount);
  const { data: fishbaseData = [], isLoading: speciesLoading } = useSpeciesData();
  const { data: contractSpecies = [], isLoading: contractLoading } = useContractSpecies(contractAddress);
  const { getAvailability } = useSpeciesAvailability(contractAddress, marketplaceAddress);

  // ── "My Dex" + wishlist (T9) ──────────────────────────────────────────────
  // Reconciles once tanks have loaded; composes dexService.js for every
  // read/write (including the one-time ADD_SPECIES XP award on genuine
  // first-discovery). Toast surfaces newly-discovered species so the reward
  // loop is visible, mirroring the existing showToast pattern (BreedGallery,
  // TankList, MintSpecimen, etc.).
  const { dexEntries, wishlist, lastAdded, isWishlisted, toggleWishlist, isKept } = useDex(walletAccount, tanks, !tanksLoading);
  const { data: masteryMap } = useSpeciesMastery(walletAccount);
  const [toastMessage, setToastMessage] = useState(null);
  const showToast = (msg) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 4000);
  };
  useEffect(() => {
    // Toast ONLY what reconcile actually added (and therefore actually awarded
    // XP for). Deliberately not derived by diffing `dexEntries` against a
    // previous-render ref: on a normal load that populates a returning keeper's
    // existing Dex, every known species would look "new" and the toast would
    // announce points that were never awarded. Points come from XP_ACTIONS so
    // the number shown can never drift from the amount granted.
    if (lastAdded.length === 0) return;
    const points = (XP_ACTIONS.ADD_SPECIES?.points || 0) * lastAdded.length;
    showToast(
      lastAdded.length === 1
        ? FINDER_COPY.toast.dexAddedOne(lastAdded[0].commonName, points)
        : FINDER_COPY.toast.dexAddedMany(lastAdded.length, points)
    );
  }, [lastAdded]);

  // One source of candidates: prefer the on-chain registered catalog when
  // non-empty, else fall back to the curated global catalog. Keeps this
  // simple per the T5 spec — no merge of both.
  const candidates = useMemo(() => {
    if (Array.isArray(contractSpecies) && contractSpecies.length > 0) return contractSpecies;
    return buildGlobalCatalog(fishbaseData);
  }, [contractSpecies, fishbaseData]);

  const isLoadingCandidates = speciesLoading || contractLoading;

  // Track the selected tank id locally; default to the current displayTank
  // (matched by id) if set, else the user's first tank.
  const [selectedTankId, setSelectedTankId] = useState(null);

  useEffect(() => {
    if (selectedTankId != null) return;
    if (displayTank?.id != null) {
      setSelectedTankId(displayTank.id);
      return;
    }
    if (tanks.length > 0) {
      const first = tanks[0];
      setSelectedTankId(first.id);
      // Also seed displayTank so the "Good matches" section has a tank context
      // on first load — otherwise a tank shows selected in the bar while the
      // matches read "Choose a tank above" until the user re-picks. Only runs
      // when nothing was previously selected (displayTank?.id == null).
      if (typeof setDisplayTank === "function") {
        setDisplayTank({ id: first.id, name: first.name, ...tankFitInputs(first) });
      }
    }
  }, [displayTank, tanks, selectedTankId, setDisplayTank]);

  const selectedTank = useMemo(
    () => tanks.find((t) => Number(t.id) === Number(selectedTankId)) || null,
    [tanks, selectedTankId]
  );

  const handleSelectTank = (tankId) => {
    setSelectedTankId(tankId);
    const tank = tanks.find((t) => Number(t.id) === Number(tankId));
    if (tank && typeof setDisplayTank === "function") {
      setDisplayTank({ id: tank.id, name: tank.name, ...tankFitInputs(tank) });
    }
  };

  const tankContext = displayTank
    ? { volume: displayTank.volume, temp: displayTank.temp, ph: displayTank.ph }
    : null;

  // Species already residing in the selected tank — excluded from "fish to
  // add" so the home reads as a shopping list, not a mirror of the tank.
  const residingSpeciesIds = useMemo(() => {
    if (!selectedTank || !Array.isArray(selectedTank.specimens)) return [];
    const ids = selectedTank.specimens
      .filter((s) => !s.isBatchPlaceholder && s.speciesId)
      .map((s) => Number(s.speciesId));
    return Array.from(new Set(ids));
  }, [selectedTank]);

  const matches = useMemo(
    () => rankSpeciesMatches(candidates, tankContext, { fishbaseData, limit: 12, excludeSpeciesIds: residingSpeciesIds }),
    [candidates, tankContext, fishbaseData, residingSpeciesIds]
  );

  // ── "Find my next fish" guided discovery (T7) ────────────────────────────
  //
  // Deterministic intent chips (discoveryIntents.js) + a plain name/family
  // search (useSpeciesSearch — synchronous, offline-safe, no AI). See T7 spec
  // §2 for why this is deliberately NOT AI-driven: useSpeciesSearch's facets
  // can't express "peaceful"/"cleanup crew", and useNaturalSearch's parsed
  // filter vocabulary doesn't match those facets. The chips + name search
  // alone satisfy the goal, so no AI wiring is added here (escalation
  // tripwire in the spec explicitly allows/expects this).
  const [activeIntent, setActiveIntent] = useState(null);
  const [searchText, setSearchText] = useState("");

  const { results: nameSearchResults, setSearchTerm: setNameSearchTerm } = useSpeciesSearch(candidates);

  useEffect(() => {
    setNameSearchTerm(searchText);
  }, [searchText, setNameSearchTerm]);

  // A free-text query handed over from Poseidon ("look up neon tetra"). Setting
  // `searchText` is enough — the effect above syncs it into the name search, and
  // `discoveryActive` turns on from the same value, so the results appear without a
  // second code path. Cleared immediately so returning to the tab doesn't re-apply it.
  useEffect(() => {
    if (!pendingSpeciesSearch) return;
    setSearchText(pendingSpeciesSearch);
    onClearPendingSpeciesSearch?.();
  }, [pendingSpeciesSearch, onClearPendingSpeciesSearch]);

  const discoveryActive = !!activeIntent || !!searchText.trim();

  const discoveryResults = useMemo(() => {
    if (!discoveryActive) return [];

    let filtered = filterByIntent(candidates, activeIntent, { fishbaseData });

    if (searchText.trim()) {
      const nameMatchIds = new Set(nameSearchResults.map((r) => r.speciesId));
      filtered = filtered.filter((entry) => nameMatchIds.has(entry.speciesId));
    }

    if (tankContext) {
      return rankSpeciesMatches(filtered, tankContext, { fishbaseData, limit: 24, excludeSpeciesIds: residingSpeciesIds });
    }

    // No tank selected: rankSpeciesMatches' null-tank rule returns [], but
    // discovery should still work before a tank is picked. Fall back to a
    // stable, deterministic order (difficulty, then name) instead of the
    // fit ranking, and wrap each as { entry, fit: null } so the render path
    // below is uniform (SpeciesCardPremium already handles a missing `fit`).
    const excluded = new Set(residingSpeciesIds.map((id) => Number(id)));
    return filtered
      .filter((entry) => !excluded.has(Number(entry.speciesId)))
      .slice()
      .sort((a, b) => {
        const careA = Number.isFinite(Number(a.careLevel)) ? Number(a.careLevel) : 99;
        const careB = Number.isFinite(Number(b.careLevel)) ? Number(b.careLevel) : 99;
        if (careA !== careB) return careA - careB;
        return (a.commonName || "").localeCompare(b.commonName || "");
      })
      .slice(0, 24)
      .map((entry) => ({ entry, fit: null }));
  }, [discoveryActive, candidates, activeIntent, searchText, nameSearchResults, tankContext, fishbaseData, residingSpeciesIds]);

  const handleToggleIntent = (intentId) => {
    setActiveIntent((prev) => (prev === intentId ? null : intentId));
  };

  const handleClearDiscovery = () => {
    setActiveIntent(null);
    setSearchText("");
  };

  // Selection wiring into the inner BreedGallery's existing detail view.
  //
  // BreedGallery's `initialSelectedBreed` only seeds state on mount (its
  // effect has an empty dep array), so re-passing a changed value once
  // BreedGallery is already mounted underneath us does nothing. Its
  // `preselectedBreedId` prop IS reactive, but it only matches against the
  // on-chain `contractSpeciesList` (viewMode === "contract").
  //
  // So: when candidates come from the contract catalog (the common case),
  // selecting a match card sets a local preselect id that flows into
  // BreedGallery's reactive `preselectedBreedId` channel and opens its
  // existing detail view. When candidates are the curated global catalog
  // (no registered on-chain species yet), that channel can't match — per the
  // T5 escalation tripwire, we don't restructure BreedGallery's detail path;
  // we fall back to scrolling the browse section into view instead.
  const [matchPreselectId, setMatchPreselectId] = useState(null);
  const usingContractCatalog = Array.isArray(contractSpecies) && contractSpecies.length > 0;

  const handleSelectMatch = (entry) => {
    if (usingContractCatalog) {
      setMatchPreselectId(entry.speciesId);
    } else if (browseSectionRef.current) {
      browseSectionRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  const effectivePreselectedBreedId = matchPreselectId ?? preselectedBreedId;
  const handleClearPreselectedBreed = () => {
    setMatchPreselectId(null);
    if (typeof onClearPreselectedBreed === "function") onClearPreselectedBreed();
  };

  // "View listings" CTA (T6). Bounded scope: opens the marketplace tab.
  // Species-filtered deep-linking is out of scope here — see T4.
  const handleViewListings = (entry) => {
    // T4a: open the marketplace filtered to this species.
    window.dispatchEvent(new CustomEvent("aquadex:navigate-tab", {
      detail: { tab: "directory", speciesId: entry?.speciesId, speciesName: entry?.commonName },
    }));
  };

  // Shared card-rendering path for both the "Good matches" home and the
  // discovery Results grid — same fit/availability/onViewListings/onSelect
  // wiring, no second card variant (T7 §4.2 step 4).
  const renderMatchCard = ({ entry, fit }) => (
    <div key={entry.speciesId} className="fish-finder__match-card">
      <SpeciesCardPremium
        breed={entry}
        fishbaseData={fishbaseData}
        casualModeActive={true}
        isOwned={false}
        ownedCount={0}
        viewMode={usingContractCatalog ? "contract" : "global"}
        searchTerm=""
        onSelect={() => handleSelectMatch(entry)}
        fit={fit}
        availabilitySummary={summarizeAvailability(getAvailability(entry))}
        onViewListings={() => handleViewListings(entry)}
        isWishlisted={isWishlisted(entry.scientificName)}
        onToggleWishlist={() => toggleWishlist(entry)}
        isKept={isKept(entry.scientificName)}
        masteryTier={getMasteryForSpecies(masteryMap, entry.scientificName).tier}
      />
    </div>
  );

  // When the inner BreedGallery opens a species detail, it reports that up via
  // onSelectedBreedChange → App.gallerySelectedBreed, which flows back to us as
  // `initialSelectedBreed`. A truthy value means a detail is open — let it take
  // over full-page by hiding the tank bar, discovery, and home so the detail
  // isn't buried beneath them. Covers match cards, the browse grid, and
  // ?species deep links alike (all set the inner gallery's selection). The
  // inner BreedGallery stays mounted throughout, so no state loss or refetch.
  const detailOpen = !!initialSelectedBreed;
  useEffect(() => {
    if (detailOpen) window.scrollTo(0, 0);
  }, [detailOpen]);

  return (
    <div className="fish-finder">
      {toastMessage && <div className="inline-toast">{toastMessage}</div>}

      {!detailOpen && (
        <>
      {/* ── Tank context bar ────────────────────────────────────────────── */}
      <div className="fish-finder__tank-bar glass-card">
        <div className="fish-finder__tank-bar-label">
          <span className="fish-finder__tank-bar-icon" aria-hidden="true">🐠</span>
          <span>{FINDER_COPY.contextBar.label}</span>
        </div>

        {tanksLoading ? (
          <div
            className="fish-finder__tank-bar-loading shimmer-placeholder"
            role="status"
            aria-label={FINDER_COPY.contextBar.loadingAria}
          />
        ) : tanks.length === 0 ? (
          <div className="fish-finder__tank-bar-empty">
            <span>{FINDER_COPY.contextBar.emptyText}</span>
            <button
              type="button"
              className="fish-finder__tank-bar-cta"
              onClick={() => window.dispatchEvent(new CustomEvent("aquadex:navigate-tab", { detail: { tab: "tanks" } }))}
            >
              {FINDER_COPY.contextBar.emptyCta}
            </button>
          </div>
        ) : (
          <div className="fish-finder__tank-bar-select">
            <select
              value={selectedTankId ?? ""}
              onChange={(e) => handleSelectTank(e.target.value)}
              aria-label={FINDER_COPY.contextBar.pickerAria}
            >
              {tanks.map((tank) => (
                <option key={tank.id} value={tank.id}>
                  {tank.name || FINDER_COPY.contextBar.unnamed}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* ── "My Dex" (T9) ───────────────────────────────────────────────── */}
      <MyDexPanel dexEntries={dexEntries} candidates={candidates} wishlistCount={wishlist.length} />

      {/* ── "Find my next fish" — guided discovery (T7) ─────────────────── */}
      <div className="fish-finder__discovery">
        <h2 className="fish-finder__home-title">{FINDER_COPY.discovery.title}</h2>
        <div className="fish-finder__intent-chips" role="group" aria-label={FINDER_COPY.discovery.chipsAria}>
          {DISCOVERY_INTENTS.map((intent) => (
            <button
              key={intent.id}
              type="button"
              className={`fish-finder__intent-chip${activeIntent === intent.id ? " fish-finder__intent-chip--active" : ""}`}
              aria-pressed={activeIntent === intent.id}
              onClick={() => handleToggleIntent(intent.id)}
            >
              <span aria-hidden="true">{intent.icon}</span> {intent.label}
            </button>
          ))}
        </div>
        <div className="fish-finder__search-row">
          <input
            type="text"
            className="fish-finder__search-input"
            placeholder={FINDER_COPY.discovery.searchPlaceholder}
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            aria-label={FINDER_COPY.discovery.searchAria}
          />
          {discoveryActive && (
            <button type="button" className="fish-finder__clear-discovery" onClick={handleClearDiscovery}>
              {FINDER_COPY.discovery.clear}
            </button>
          )}
        </div>
      </div>

      {/* ── Results (discovery active) or "Good matches" home ───────────── */}
      {discoveryActive ? (
        <div className="fish-finder__home">
          <h2 className="fish-finder__home-title">{FINDER_COPY.results.title}</h2>
          {isLoadingCandidates ? (
            <div role="status" aria-label={FINDER_COPY.results.loadingAria}>
              <LoadingSkeleton variant="gallery" count={4} />
            </div>
          ) : discoveryResults.length === 0 ? (
            <p className="fish-finder__home-hint">
              {FINDER_COPY.results.empty}{" "}
              <button type="button" className="fish-finder__inline-clear" onClick={handleClearDiscovery}>
                {FINDER_COPY.discovery.clearFilters}
              </button>
            </p>
          ) : (
            <div className="fish-finder__matches-grid">
              {discoveryResults.map(renderMatchCard)}
            </div>
          )}
        </div>
      ) : (
        <div className="fish-finder__home">
          <h2 className="fish-finder__home-title">
            {selectedTank
              ? FINDER_COPY.home.title(selectedTank.name || FINDER_COPY.home.fallbackName)
              : FINDER_COPY.home.titleFallback}
          </h2>

          {!tankContext ? (
            <p className="fish-finder__home-hint">
              {tanks.length === 0 ? FINDER_COPY.home.needTank : FINDER_COPY.home.chooseTank}
            </p>
          ) : isLoadingCandidates ? (
            <div role="status" aria-label={FINDER_COPY.home.loadingAria}>
              <LoadingSkeleton variant="gallery" count={4} />
            </div>
          ) : matches.length === 0 ? (
            <p className="fish-finder__home-hint">{FINDER_COPY.home.empty}</p>
          ) : (
            <div className="fish-finder__matches-grid">
              {matches.map(renderMatchCard)}
            </div>
          )}
        </div>
      )}
        </>
      )}

      {/* ── Browse all species — the existing gallery. Also hosts the species
          detail; when a detail is open, the sections above are hidden so it
          takes over full-page (detailOpen). ────────────────────────────── */}
      <div className="fish-finder__browse" ref={browseSectionRef}>
        {!detailOpen && <h2 className="fish-finder__browse-title">{FINDER_COPY.browse.title}</h2>}
        <BreedGallery
          contractAddress={contractAddress}
          marketplaceAddress={marketplaceAddress}
          walletAccount={walletAccount}
          onViewLineage={onViewLineage}
          preselectedBreedId={effectivePreselectedBreedId}
          onClearPreselectedBreed={handleClearPreselectedBreed}
          onSelectSpecimen={onSelectSpecimen}
          displayTank={displayTank}
          setDisplayTank={setDisplayTank}
          onSelectCheckoutOrder={onSelectCheckoutOrder}
          onCheckoutSuccessRedirect={onCheckoutSuccessRedirect}
          casualModeActive={casualModeActive}
          initialSelectedBreed={initialSelectedBreed}
          onSelectedBreedChange={onSelectedBreedChange}
          deepLinkSpecies={deepLinkSpecies}
        />
      </div>
    </div>
  );
}
