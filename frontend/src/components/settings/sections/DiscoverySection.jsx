import React, { useCallback, useEffect, useState } from "react";
import { SettingsSection } from "../SettingsSection";
import { SettingsSubsectionLabel as SubsectionLabel } from "../SettingsSubsectionLabel";
import { useUnlockGate } from "../../reef/UnlockPrompt";
import { getRequiredTierFor } from "../../../services/entitlements";
import { announce } from "../../../utils/a11y";

const WATCHLIST_KEY = "aquadex_watchlist";
const SAVED_SEARCHES_KEY = "aquadex_saved_searches";

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
 * ── AN HONESTY PROBLEM THIS SECTION SURFACES RATHER THAN HIDES ─────────────
 *   `aquadex_saved_searches` is WRITE-ONLY in the current app.
 *   `MarketplaceBoard.saveCurrentSearch()` appends to it (the only two references
 *   to the key are both inside that one function), and nothing ever reads a saved
 *   search back to re-apply it. So "Save this search" currently stores data the
 *   user can never use — a §3.2-class defect the handoff's audit did not catch.
 *
 *   This section does not pretend otherwise. It lists what is stored and lets you
 *   remove entries, and the copy states plainly that re-running a saved search
 *   from here isn't available yet. Making them recallable means applying the saved
 *   filter set to the marketplace board, which is a Fish Finder change, not a
 *   Settings one — logged in SETTINGS_SPEC.md §10.
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
    try {
      const raw = JSON.parse(localStorage.getItem(SAVED_SEARCHES_KEY) || "[]");
      setSavedSearches(Array.isArray(raw) ? raw : []);
    } catch {
      setSavedSearches([]);
    }
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
    const next = savedSearches.filter((_, i) => i !== index);
    try {
      localStorage.setItem(SAVED_SEARCHES_KEY, JSON.stringify(next));
    } catch {
      // non-fatal
    }
    setSavedSearches(next);
    announce("Saved search removed");
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
                  ? "No saved searches yet."
                  : `${savedSearches.length} saved.`}{" "}
                {/* Say the true thing: these are stored but not yet re-runnable. */}
                <span style={{ color: "var(--accent-amber)" }}>
                  Re-running a saved search isn't available yet — for now you can review and
                  remove them here.
                </span>
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
                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={() => removeSavedSearch(index)}
                        aria-label={`Remove saved search: ${describeSavedSearch(entry)}`}
                        style={{ padding: "0.4rem 0.75rem", fontSize: "0.72rem", minHeight: 36, flexShrink: 0 }}
                      >
                        Remove
                      </button>
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
 * Build a readable one-line summary from the filter set
 * `MarketplaceBoard.saveCurrentSearch()` stores.
 */
export function describeSavedSearch(entry = {}) {
  const parts = [];
  if (entry.search) parts.push(`"${entry.search}"`);
  if (entry.family) parts.push(entry.family);
  if (entry.careLevel) parts.push(entry.careLevel);
  if (entry.fulfillment) parts.push(entry.fulfillment);

  const min = entry.priceMinInput;
  const max = entry.priceMaxInput;
  if (min && max) parts.push(`$${min}–$${max}`);
  else if (min) parts.push(`from $${min}`);
  else if (max) parts.push(`up to $${max}`);

  return parts.length > 0 ? parts.join(" · ") : "All listings";
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
