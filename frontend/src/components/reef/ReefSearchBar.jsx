/**
 * ReefSearchBar.jsx
 * 
 * Global search bar for The Reef social layer.
 * Searches across: profiles, currents, schools, tides, and insights.
 * Integrates with the existing species search (useNaturalSearch) for unified results.
 * 
 * Renders as a collapsible search input in the feed header with a
 * dropdown results panel grouped by type.
 */

import { useState, useRef, useEffect } from "react";
import { useReefSearch } from "../../hooks/useReefSearch";
import { ProfileCard } from "./ProfileCard";

const TIDE_TYPE_ICONS = {
  expo: "📍",
  virtual: "🎥",
  challenge: "🏆",
  auction: "🔨",
};

function SearchResultGroup({ title, icon, children, count }) {
  if (!count) return null;
  return (
    <div className="reef-search__group">
      <h4 className="reef-search__group-title">
        <span>{icon}</span> {title}
        <span className="reef-search__group-count">{count}</span>
      </h4>
      <div className="reef-search__group-items">{children}</div>
    </div>
  );
}

function ProfileResult({ profile, onClick }) {
  return (
    <button
      className="reef-search__result reef-search__result--profile"
      onClick={() => onClick(profile.wallet_address)}
    >
      <div className="reef-search__result-avatar">
        {profile.avatar_url ? (
          <img src={profile.avatar_url} alt="" />
        ) : (
          <span className="reef-search__avatar-placeholder">
            {(profile.display_name || "?")[0].toUpperCase()}
          </span>
        )}
      </div>
      <div className="reef-search__result-info">
        <span className="reef-search__result-name">
          {profile.display_name || `${profile.wallet_address.slice(0, 8)}…`}
        </span>
        {profile.bio && (
          <span className="reef-search__result-meta">
            {profile.bio.length > 60 ? profile.bio.slice(0, 60) + "…" : profile.bio}
          </span>
        )}
      </div>
      {profile.depth_tier && (
        <span className="reef-search__tier-badge">{profile.depth_tier}</span>
      )}
    </button>
  );
}

function CurrentResult({ current, onClick }) {
  const title = current.title || current.body?.slice(0, 50) || "Untitled";
  return (
    <button
      className="reef-search__result reef-search__result--current"
      onClick={() => onClick(current)}
    >
      {current.media_urls?.[0] && (
        <img
          src={current.media_urls[0]}
          alt=""
          className="reef-search__result-thumb"
        />
      )}
      <div className="reef-search__result-info">
        <span className="reef-search__result-name">{title}</span>
        <span className="reef-search__result-meta">
          by {current.author?.display_name || current.author?.wallet_address?.slice(0, 8)}
          {" · "}
          {new Date(current.created_at).toLocaleDateString()}
        </span>
      </div>
    </button>
  );
}

function SchoolResult({ school, onClick }) {
  return (
    <button
      className="reef-search__result reef-search__result--school"
      onClick={() => onClick(school)}
    >
      <span className="reef-search__result-icon">🏫</span>
      <div className="reef-search__result-info">
        <span className="reef-search__result-name">{school.name}</span>
        <span className="reef-search__result-meta">
          {school.school_type} · {school.member_count || 0} members
        </span>
      </div>
    </button>
  );
}

function TideResult({ tide, onClick }) {
  const icon = TIDE_TYPE_ICONS[tide.tide_type] || "🌊";
  const statusLabel = tide.status === "live" ? "🔴 LIVE" : tide.status === "ended" ? "Ended" : "";
  return (
    <button
      className="reef-search__result reef-search__result--tide"
      onClick={() => onClick(tide)}
    >
      <span className="reef-search__result-icon">{icon}</span>
      <div className="reef-search__result-info">
        <span className="reef-search__result-name">
          {tide.title}
          {statusLabel && <span className="reef-search__status-badge">{statusLabel}</span>}
        </span>
        <span className="reef-search__result-meta">
          {new Date(tide.start_time).toLocaleDateString(undefined, {
            month: "short",
            day: "numeric",
          })}
          {tide.host_profile && ` · ${tide.host_profile.display_name || "Host"}`}
        </span>
      </div>
    </button>
  );
}

function InsightResult({ insight, onClick }) {
  return (
    <button
      className="reef-search__result reef-search__result--insight"
      onClick={() => onClick(insight)}
    >
      <span className="reef-search__result-icon">💡</span>
      <div className="reef-search__result-info">
        <span className="reef-search__result-name">
          {insight.body.length > 80 ? insight.body.slice(0, 80) + "…" : insight.body}
        </span>
        <span className="reef-search__result-meta">
          {insight.species_name && `${insight.species_name} · `}
          {insight.category} · ↑{insight.net_votes}
        </span>
      </div>
    </button>
  );
}

export function ReefSearchBar({
  onNavigateProfile,
  onNavigateCurrent,
  onNavigateSchool,
  onNavigateTide,
  onNavigateInsight,
  casualModeActive = false,
}) {
  const [expanded, setExpanded] = useState(false);
  const {
    query,
    setQuery,
    results,
    isLoading,
    totalResults,
    hasResults,
    isSearching,
    clearSearch,
  } = useReefSearch();

  const inputRef = useRef(null);
  const containerRef = useRef(null);

  // Close on outside click
  useEffect(() => {
    function handleClickOutside(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setExpanded(false);
      }
    }
    if (expanded) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [expanded]);

  // Keyboard shortcut: / to focus search
  useEffect(() => {
    function handleKey(e) {
      if (e.key === "/" && !e.ctrlKey && !e.metaKey) {
        const tag = document.activeElement?.tagName?.toLowerCase();
        if (tag === "input" || tag === "textarea" || tag === "select") return;
        e.preventDefault();
        setExpanded(true);
        setTimeout(() => inputRef.current?.focus(), 50);
      }
      if (e.key === "Escape" && expanded) {
        setExpanded(false);
        clearSearch();
      }
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [expanded, clearSearch]);

  const handleExpand = () => {
    setExpanded(true);
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  const handleSelect = (type, item) => {
    setExpanded(false);
    clearSearch();
    switch (type) {
      case "profile":
        onNavigateProfile?.(item);
        break;
      case "current":
        onNavigateCurrent?.(item);
        break;
      case "school":
        onNavigateSchool?.(item);
        break;
      case "tide":
        onNavigateTide?.(item);
        break;
      case "insight":
        onNavigateInsight?.(item);
        break;
    }
  };

  return (
    <div className="reef-search" ref={containerRef}>
      {!expanded ? (
        <button
          className="reef-search__trigger"
          onClick={handleExpand}
          style={{
            width: "34px",
            height: "34px",
            borderRadius: "8px",
            border: "1px solid rgba(255, 255, 255, 0.08)",
            background: "rgba(255, 255, 255, 0.03)",
            color: "var(--text-muted)",
            cursor: "pointer",
            fontSize: "0.95rem",
            transition: "all 0.15s ease",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 0,
            minHeight: "unset"
          }}
          onMouseEnter={(e) => { e.currentTarget.style.color = "#fff"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.15)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-muted)"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.08)"; }}
          title="Search"
          aria-label="Search The Reef"
        >
          🔍
        </button>
      ) : (
        <div className="reef-search__expanded">
          <div className="reef-search__input-row">
            <span className="reef-search__input-icon">🔍</span>
            <input
              ref={inputRef}
              type="text"
              className="reef-search__input"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={casualModeActive ? "Search the reef…" : "Search profiles, posts, schools, events…"}
              aria-label="Search"
              autoComplete="off"
            />
            {query && (
              <button
                className="reef-search__clear"
                onClick={clearSearch}
                aria-label="Clear search"
              >
                ✕
              </button>
            )}
            <kbd className="reef-search__kbd">esc</kbd>
          </div>

          {/* Results dropdown */}
          {isSearching && (
            <div className="reef-search__results" role="listbox" aria-label="Search results">
              {isLoading && (
                <div className="reef-search__loading">
                  <span>Searching…</span>
                </div>
              )}

              {!isLoading && !hasResults && (
                <div className="reef-search__empty">
                  <p>No results for "{query}"</p>
                  <p className="reef-search__hint">
                    Try searching for a breeder name, species, school, or event.
                  </p>
                </div>
              )}

              {!isLoading && hasResults && (
                <>
                  <SearchResultGroup
                    title="Profiles"
                    icon="👤"
                    count={results.profiles?.length}
                  >
                    {results.profiles?.map((p) => (
                      <ProfileResult
                        key={p.wallet_address}
                        profile={p}
                        onClick={(wallet) => handleSelect("profile", wallet)}
                      />
                    ))}
                  </SearchResultGroup>

                  <SearchResultGroup
                    title="Posts"
                    icon="📝"
                    count={results.currents?.length}
                  >
                    {results.currents?.map((c) => (
                      <CurrentResult
                        key={c.id}
                        current={c}
                        onClick={(current) => handleSelect("current", current)}
                      />
                    ))}
                  </SearchResultGroup>

                  <SearchResultGroup
                    title="Schools"
                    icon="🏫"
                    count={results.schools?.length}
                  >
                    {results.schools?.map((s) => (
                      <SchoolResult
                        key={s.id}
                        school={s}
                        onClick={(school) => handleSelect("school", school)}
                      />
                    ))}
                  </SearchResultGroup>

                  <SearchResultGroup
                    title={casualModeActive ? "Events" : "Tides"}
                    icon="🌊"
                    count={results.tides?.length}
                  >
                    {results.tides?.map((t) => (
                      <TideResult
                        key={t.id}
                        tide={t}
                        onClick={(tide) => handleSelect("tide", tide)}
                      />
                    ))}
                  </SearchResultGroup>

                  <SearchResultGroup
                    title="Insights"
                    icon="💡"
                    count={results.insights?.length}
                  >
                    {results.insights?.map((i) => (
                      <InsightResult
                        key={i.id}
                        insight={i}
                        onClick={(insight) => handleSelect("insight", insight)}
                      />
                    ))}
                  </SearchResultGroup>

                  <div className="reef-search__footer">
                    <span className="reef-search__total">{totalResults} result{totalResults !== 1 ? "s" : ""}</span>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default ReefSearchBar;
