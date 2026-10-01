import React, { useCallback, useEffect, useState } from "react";
import { Lock, MagnifyingGlass } from "@phosphor-icons/react";
import { SettingsSection } from "../SettingsSection";
import { SettingsSubsectionLabel as SubsectionLabel } from "../SettingsSubsectionLabel";
import { useUnlockGate } from "../../reef/UnlockPrompt";
import { getRequiredTierFor } from "../../../services/entitlements";
import { announce } from "../../../utils/a11y";
import {
  describeSavedSearch,
  loadSavedSearches,
  removeSavedSearch as removeSavedSearchFromStore,
} from "../../../services/savedSearches";

const WATCHLIST_KEY = "aquadex_watchlist";

/**
 * DiscoverySection — Settings → Fish Finder / Catalog & Alerts
 * (docs/SETTINGS_SPEC.md §6 #8).
 *
 * ⚠️ GATED BY ENTITLEMENT, NEVER BY MODE (AC-4 and §3). `species_watchlist`
 * (Pelagic) and `saved_search` (Coastal) are EARNED capabilities in
 * `services/entitlements.js`. Casual/pro is a display preference and must not
 * appear in the same condition as `hasEntitlement` — locked capabilities are shown
 * as locked with their required tier, not hidden.
 *
 * Gating goes through `useUnlockGate()` rather than a bare `hasEntitlement()` call
 * because that hook takes the HIGHER of local XP and the server `depth_tier`, so a
 * user whose XP already cleared the bar isn't locked out by a stale DB value.
 *
 * ── WHAT IS DELIBERATELY NOT HERE ──────────────────────────────────────────
 *   PRICE ALERTS — `price_alerts` is a real entitlement key, but nothing in the
 *   app implements alerts: no storage key, no scheduler, no notification path. A
 *   switch here would be a brand-new dead control, which is precisely what this
 *   rework exists to remove (§2). It lands when the alert path does.
 *
 *   DEFAULT SEARCH RADIUS — the only radius filter lived in `LocalBreederMap`,
 *   which `App.jsx` documents as retired and never imported. The Fish Finder does
 *   no distance filtering today, so a default-radius control would steer nothing.
 *
 * ── SAVED SEARCHES ARE NOW RUNNABLE ───────────────────────────────────────
 *   `aquadex_saved_searches` used to be WRITE-ONLY: `MarketplaceBoard` appended to
 *   it (the only two references to the key were both inside one function) and
 *   nothing ever read a record back. So "Save this search" stored data the user
 *   could never use — on a capability gated behind an EARNED entitlement, meaning
 *   people spent XP progress unlocking a button that did nothing.
 *
 *   Fixed: the store is `services/savedSearches.js`, and "Run" hands the filter set
 *   to the marketplace board through the same `aquadex:navigate-tab` event the rest
 *   of the app uses. `MarketplaceBoard` applies it via `pendingSavedSearch` and
 *   confirms which search it restored.
 */
export function DiscoverySection({ casualModeActive }) {
  const watchlistGate = useUnlockGate("species_watchlist");
  const savedSearchGate = useUnlockGate("saved_search");

  const [watchlistCount, setWatchlistCount] = useState(0);
  const [savedSearches, setSavedSearches] = useState([]);

  const reload = useCallback(() => {
    try {
      const raw = JSON.parse(localStorage.getItem(WATCHLIST_KEY) || "[]");
      setWatchlistCount(Array.isArray(raw) ? raw.length : 0);
    } catch {
      setWatchlistCount(0);
    }
    setSavedSearches(loadSavedSearches());
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const clearWatchlist = () => {
    try {
      localStorage.setItem(WATCHLIST_KEY, "[]");
    } catch {
      // non-fatal
    }
    setWatchlistCount(0);
    announce("Watchlist cleared");
  };

  const removeSavedSearch = (index) => {
    setSavedSearches(removeSavedSearchFromStore(index));
    announce("Saved search removed");
  };

  /**
   * Run a saved search — the reader that makes saving mean anything.
   *
   * Hands the filter set to the marketplace board via the same
   * `aquadex:navigate-tab` event the rest of the app uses for cross-tab
   * navigation; App.jsx stashes it and passes it down as `pendingSavedSearch`.
   */
  const runSavedSearch = (entry) => {
    announce(`Running saved search: ${describeSavedSearch(entry)}`);
    window.dispatchEvent(
      new CustomEvent("aquadex:navigate-tab", {
        detail: { tab: "directory", savedSearch: entry },
      })
    );
  };

  return (
    <SettingsSection
      id="discovery"
      icon={<MagnifyingGlass size={20} />}
      title={{ casual: "Fish Finder", pro: "Catalog & Alerts" }}
      description={{
        casual:
          "What you're watching and the searches you've saved while browsing.",
        pro:
          "Your watchlist and saved searches. Both unlock with progress; locked items show the tier they need.",
      }}
      casualModeActive={casualModeActive}
    >
      <div className="st-stack">
        {/* ─── Watchlist ─── */}
        <div>
          <SubsectionLabel>{casualModeActive ? "Watchlist" : "Species watchlist"}</SubsectionLabel>

          {!watchlistGate.hasAccess ? (
            <LockedNote
              entitlementKey="species_watchlist"
              what={
                casualModeActive
                  ? "Saving fish to a watchlist"
                  : "Species watchlist tracking"
              }
            />
          ) : (
            <>
              <p className="st-hint">
                {watchlistCount === 0
                  ? casualModeActive
                    ? "You're not watching anything yet. Tap the heart on a listing to add it."
                    : "No listings currently watched."
                  : `${watchlistCount} ${watchlistCount === 1 ? "listing" : "listings"} on your watchlist.`}
              </p>
              {watchlistCount > 0 && (
                <button type="button" className="st-btn" onClick={clearWatchlist}>
                  Clear watchlist
                </button>
              )}
            </>
          )}
        </div>

        {/* ─── Saved searches ─── */}
        <div>
          <SubsectionLabel>Saved searches</SubsectionLabel>

          {!savedSearchGate.hasAccess ? (
            <LockedNote
              entitlementKey="saved_search"
              what={casualModeActive ? "Saving a search to come back to" : "Saved search sets"}
            />
          ) : (
            <>
              <p className="st-hint">
                {savedSearches.length === 0
                  ? casualModeActive
                    ? "No saved searches yet. Set filters while browsing, then use Save This Search."
                    : "No saved filter sets. Save one from the marketplace filter bar."
                  : `${savedSearches.length} saved. Run one to jump straight back to those results.`}
              </p>

              {savedSearches.length > 0 && (
                <ul className="st-list">
                  {savedSearches.map((entry, index) => (
                    <li key={`${entry.savedAt || "s"}-${index}`} className="st-list-item">
                      <span className="st-list-text">
                        <span className="st-list-title">{describeSavedSearch(entry)}</span>
                        {entry.savedAt && (
                          <span className="st-list-meta">
                            Saved {new Date(entry.savedAt).toLocaleDateString()}
                          </span>
                        )}
                      </span>
                      <span className="st-list-actions">
                        <button
                          type="button"
                          className="st-btn st-btn--primary"
                          onClick={() => runSavedSearch(entry)}
                          aria-label={`Run saved search: ${describeSavedSearch(entry)}`}
                        >
                          Run
                        </button>
                        <button
                          type="button"
                          className="st-btn"
                          onClick={() => removeSavedSearch(index)}
                          aria-label={`Remove saved search: ${describeSavedSearch(entry)}`}
                        >
                          Remove
                        </button>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      </div>
    </SettingsSection>
  );
}

/**
 * Visible-but-locked presentation. Per §3, a gated capability is shown with the
 * tier it needs rather than hidden, so the ladder is legible.
 */
function LockedNote({ entitlementKey, what }) {
  const requiredTier = getRequiredTierFor(entitlementKey);
  return (
    <div className="st-callout st-callout--amber">
      <Lock size={20} aria-hidden="true" />
      <p>
        {what} unlocks at the <strong>{requiredTier}</strong> tier. Keep logging to get
        there. There is nothing to buy.
      </p>
    </div>
  );
}

export default DiscoverySection;
