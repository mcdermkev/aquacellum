import React, { useCallback, useEffect, useState } from "react";
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
      icon="🔍"
      title={{ casual: "Fish Finder", pro: "Catalog & Alerts" }}
      description={{
        casual:
          "What you're watching and the searches you've saved while browsing.",
        pro:
          "Watchlist and saved-search state. Both are earned capabilities — see the required depth tier where locked.",
      }}
      casualModeActive={casualModeActive}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
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
              <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 12, lineHeight: 1.4 }}>
                {watchlistCount === 0
                  ? casualModeActive
                    ? "You're not watching anything yet. Tap the heart on a listing to add it."
                    : "No listings currently watched."
                  : `${watchlistCount} ${watchlistCount === 1 ? "listing" : "listings"} on your watchlist.`}
              </p>
              {watchlistCount > 0 && (
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={clearWatchlist}
                  style={{ padding: "0.5rem 1rem", fontSize: "0.75rem", minHeight: 36 }}
                >
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
              <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 12, lineHeight: 1.4 }}>
                {savedSearches.length === 0
                  ? casualModeActive
                    ? "No saved searches yet. Set up filters while browsing, then tap Save This Search."
                    : "No saved filter sets. Save one from the marketplace filter bar."
                  : `${savedSearches.length} saved. Run one to jump straight back to those results.`}
              </p>

              {savedSearches.length > 0 && (
                <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
                  {savedSearches.map((entry, index) => (
                    <li
                      key={`${entry.savedAt || "s"}-${index}`}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 12,
                        padding: "10px 12px",
                        borderRadius: 8,
                        border: "1px solid rgba(255,255,255,0.08)",
                        background: "rgba(255,255,255,0.02)",
                      }}
                    >
                      <span style={{ minWidth: 0 }}>
                        <span style={{ display: "block", fontSize: 13, fontWeight: 600, color: "var(--text-primary)" }}>
                          {describeSavedSearch(entry)}
                        </span>
                        {entry.savedAt && (
                          <span style={{ display: "block", fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
                            Saved {new Date(entry.savedAt).toLocaleDateString()}
                          </span>
                        )}
                      </span>
                      <span style={{ display: "flex", gap: "0.4rem", flexShrink: 0 }}>
                        <button
                          type="button"
                          className="btn-primary"
                          onClick={() => runSavedSearch(entry)}
                          aria-label={`Run saved search: ${describeSavedSearch(entry)}`}
                          style={{ padding: "0.4rem 0.85rem", fontSize: "0.72rem", minHeight: 36 }}
                        >
                          Run
                        </button>
                        <button
                          type="button"
                          className="btn-secondary"
                          onClick={() => removeSavedSearch(index)}
                          aria-label={`Remove saved search: ${describeSavedSearch(entry)}`}
                          style={{ padding: "0.4rem 0.75rem", fontSize: "0.72rem", minHeight: 36 }}
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
    <div
      style={{
        display: "flex",
        gap: "0.6rem",
        alignItems: "flex-start",
        padding: "0.75rem 1rem",
        borderRadius: 8,
        border: "1px solid rgba(251, 191, 36, 0.2)",
        background: "rgba(251, 191, 36, 0.05)",
      }}
    >
      <span aria-hidden="true" style={{ fontSize: "0.9rem" }}>
        🔒
      </span>
      <span style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 }}>
        {what} unlocks at the{" "}
        <strong style={{ color: "var(--accent-amber)" }}>{requiredTier}</strong> tier. Keep
        logging and it'll open up — nothing to buy.
      </span>
    </div>
  );
}

export default DiscoverySection;
