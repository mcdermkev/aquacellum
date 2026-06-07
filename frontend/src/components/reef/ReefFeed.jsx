/**
 * ReefFeed.jsx
 * 
 * Main social feed view for The Reef.
 * Two tabs: Following (Tankmates + watched) and Discover (all public).
 * Infinite scroll with TanStack Query.
 */

import React, { useState, useCallback, useRef } from "react";
import { CurrentCard } from "./CurrentCard";
import { ContentComposer } from "./ContentComposer";
import { SonarBell } from "./SonarBell";
import { TankmateRequests } from "./TankmateRequests";
import { PublicProfile } from "./PublicProfile";
import { SchoolDirectory } from "./SchoolDirectory";
import { SchoolPage } from "./SchoolPage";
import { CreateSchool } from "./CreateSchool";
import { TideCalendar } from "./TideCalendar";
import { TidePage } from "./TidePage";
import { CreateTide } from "./CreateTide";
import { ReefSearchBar } from "./ReefSearchBar";
import { useFollowingFeed, useDiscoverFeed } from "../../hooks/useReefFeed";
import { useEnsureProfile } from "../../hooks/useReefProfile";
import { getCurrentWallet, isSupabaseConfigured } from "../../services/supabaseClient";
import { useQueryClient } from "@tanstack/react-query";

export function ReefFeed({ casualModeActive = false, walletAddress, onNavigateProfile }) {
  const [activeTab, setActiveTab] = useState("following");
  const [composerOpen, setComposerOpen] = useState(false);
  const [viewingProfile, setViewingProfile] = useState(null);
  const [viewingSchools, setViewingSchools] = useState(false);
  const [viewingSchool, setViewingSchool] = useState(null);
  const [creatingSchool, setCreatingSchool] = useState(false);
  const [viewingTides, setViewingTides] = useState(false);
  const [viewingTide, setViewingTide] = useState(null);
  const [creatingTide, setCreatingTide] = useState(false);
  const queryClient = useQueryClient();

  // Ensure profile exists on load
  useEnsureProfile(walletAddress);

  // Listen for "Share Tank" event from tank detail panels
  React.useEffect(() => {
    const handleOpenComposer = (e) => {
      setComposerOpen(true);
    };
    window.addEventListener("reef_open_composer", handleOpenComposer);
    return () => window.removeEventListener("reef_open_composer", handleOpenComposer);
  }, []);

  // Listen for "View Profile" event from header profile chip
  React.useEffect(() => {
    const handleViewProfile = (e) => {
      if (e.detail?.wallet) {
        setViewingProfile(e.detail.wallet);
      }
    };
    window.addEventListener("reef_view_profile", handleViewProfile);
    return () => window.removeEventListener("reef_view_profile", handleViewProfile);
  }, []);

  // Feed queries
  const following = useFollowingFeed(activeTab === "following");
  const discover = useDiscoverFeed(activeTab === "discover");

  const activeFeed = activeTab === "following" ? following : discover;
  const items = activeFeed.data?.pages?.flatMap((page) => page.data) || [];
  const isLoading = activeFeed.isLoading;
  const hasNextPage = activeFeed.hasNextPage;
  const isFetchingNextPage = activeFeed.isFetchingNextPage;

  // Infinite scroll observer
  const observerRef = useRef(null);
  const lastItemRef = useCallback(
    (node) => {
      if (isFetchingNextPage) return;
      if (observerRef.current) observerRef.current.disconnect();

      observerRef.current = new IntersectionObserver((entries) => {
        if (entries[0].isIntersecting && hasNextPage) {
          activeFeed.fetchNextPage();
        }
      });

      if (node) observerRef.current.observe(node);
    },
    [isFetchingNextPage, hasNextPage, activeFeed]
  );

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: ["reef"] });
  };

  const handlePostSuccess = () => {
    queryClient.invalidateQueries({ queryKey: ["reef"] });
  };

  const handleProfileClick = (wallet) => {
    setViewingProfile(wallet);
  };

  const configured = isSupabaseConfigured();

  // If viewing a profile, show the profile page
  if (viewingProfile) {
    return (
      <PublicProfile
        walletAddress={viewingProfile}
        onBack={() => setViewingProfile(null)}
        onNavigateProfile={handleProfileClick}
        casualModeActive={casualModeActive}
      />
    );
  }

  // If viewing a specific school
  if (viewingSchool) {
    return (
      <SchoolPage
        schoolId={viewingSchool.id}
        onBack={() => setViewingSchool(null)}
        onViewProfile={handleProfileClick}
      />
    );
  }

  // If viewing a specific tide
  if (viewingTide) {
    return (
      <TidePage
        tideId={viewingTide}
        onBack={() => setViewingTide(null)}
      />
    );
  }

  // If browsing tides
  if (viewingTides) {
    return (
      <div style={{ maxWidth: "800px", margin: "0 auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
          <button
            onClick={() => setViewingTides(false)}
            style={{
              background: "none",
              border: "none",
              color: "var(--text-secondary)",
              fontSize: "0.8rem",
              cursor: "pointer",
              padding: "0.3rem 0",
            }}
          >
            ← Back to Feed
          </button>
          {walletAddress && (
            <button
              onClick={() => setCreatingTide(true)}
              className="btn btn--primary btn--sm"
            >
              + Create Tide
            </button>
          )}
        </div>
        {creatingTide ? (
          <CreateTide
            onSuccess={(tide) => {
              setCreatingTide(false);
              setViewingTide(tide.id);
            }}
            onCancel={() => setCreatingTide(false)}
          />
        ) : (
          <TideCalendar
            onSelectTide={(tideId) => setViewingTide(tideId)}
          />
        )}
      </div>
    );
  }

  // If browsing schools
  if (viewingSchools) {
    return (
      <div style={{ maxWidth: "800px", margin: "0 auto" }}>
        <button
          onClick={() => setViewingSchools(false)}
          style={{
            background: "none",
            border: "none",
            color: "var(--text-secondary)",
            fontSize: "0.8rem",
            cursor: "pointer",
            marginBottom: "1rem",
            padding: "0.3rem 0",
          }}
        >
          ← Back to Feed
        </button>
        <SchoolDirectory
          onSelectSchool={(school) => setViewingSchool(school)}
          onCreateSchool={() => setCreatingSchool(true)}
        />
        {creatingSchool && (
          <CreateSchool
            onClose={() => setCreatingSchool(false)}
            onCreated={(school) => {
              setCreatingSchool(false);
              setViewingSchool(school);
            }}
          />
        )}
      </div>
    );
  }

  return (
    <div style={{ maxWidth: "640px", margin: "0 auto" }} className="reef-feed-container">
      {/* Header */}
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        marginBottom: "1.5rem",
      }}>
        <div>
          <h2 style={{ margin: 0, fontSize: "1.2rem", fontWeight: 700, color: "#fff" }}>
            {casualModeActive ? "🪸 The Reef" : "Social Feed"}
          </h2>
          <p style={{ margin: "0.25rem 0 0", fontSize: "0.7rem", color: "var(--text-muted)" }}>
            {casualModeActive
              ? "See what your fellow fishkeepers are up to"
              : "Activity from your network"
            }
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          {walletAddress && (
            <ReefSearchBar
              onNavigateProfile={handleProfileClick}
              onNavigateCurrent={(current) => {
                // Navigate to the author's profile to see their posts
                if (current?.author?.wallet_address) {
                  handleProfileClick(current.author.wallet_address);
                }
              }}
              onNavigateSchool={(school) => setViewingSchool(school)}
              onNavigateTide={(tide) => setViewingTide(tide.id)}
              onNavigateInsight={(insight) => {
                // Navigate to the insight author's profile
                if (insight?.author?.wallet_address) {
                  handleProfileClick(insight.author.wallet_address);
                }
              }}
              casualModeActive={casualModeActive}
            />
          )}
          {walletAddress && (
            <button
              onClick={() => setViewingTides(true)}
              style={{
                padding: "0.4rem 0.7rem",
                borderRadius: "8px",
                border: "1px solid rgba(255, 255, 255, 0.08)",
                background: "rgba(255, 255, 255, 0.03)",
                color: "var(--text-muted)",
                cursor: "pointer",
                fontSize: "0.7rem",
                transition: "all 0.15s ease",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.color = "#fff"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.15)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-muted)"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.08)"; }}
              title="Browse Tides (Events)"
            >
              🌊 {casualModeActive ? "Events" : "Tides"}
            </button>
          )}
          {walletAddress && (
            <button
              onClick={() => setViewingSchools(true)}
              style={{
                padding: "0.4rem 0.7rem",
                borderRadius: "8px",
                border: "1px solid rgba(255, 255, 255, 0.08)",
                background: "rgba(255, 255, 255, 0.03)",
                color: "var(--text-muted)",
                cursor: "pointer",
                fontSize: "0.7rem",
                transition: "all 0.15s ease",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.color = "#fff"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.15)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-muted)"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.08)"; }}
              title="Browse Schools"
            >
              🏫 {casualModeActive ? "Schools" : "Schools"}
            </button>
          )}
          {walletAddress && (
            <button
              onClick={() => handleProfileClick(walletAddress)}
              style={{
                padding: "0.4rem 0.7rem",
                borderRadius: "8px",
                border: "1px solid rgba(255, 255, 255, 0.08)",
                background: "rgba(255, 255, 255, 0.03)",
                color: "var(--text-muted)",
                cursor: "pointer",
                fontSize: "0.7rem",
                transition: "all 0.15s ease",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.color = "#fff"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.15)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-muted)"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.08)"; }}
              title="View my profile"
            >
              👤 {casualModeActive ? "Me" : "Profile"}
            </button>
          )}
          <SonarBell />
          <button
            onClick={handleRefresh}
            style={{
              padding: "0.4rem",
              borderRadius: "8px",
              border: "1px solid rgba(255, 255, 255, 0.08)",
              background: "rgba(255, 255, 255, 0.03)",
              color: "var(--text-muted)",
              cursor: "pointer",
              fontSize: "0.9rem",
            }}
            title="Refresh feed"
            aria-label="Refresh feed"
          >
            🔄
          </button>
        </div>
      </div>

      {/* Tab navigation */}
      <div style={{
        display: "flex",
        gap: "0.25rem",
        marginBottom: "1.25rem",
        padding: "0.25rem",
        borderRadius: "10px",
        background: "rgba(255, 255, 255, 0.03)",
        border: "1px solid rgba(255, 255, 255, 0.06)",
      }} className="reef-feed-tabs">>
        <button
          onClick={() => setActiveTab("following")}
          style={{
            flex: 1,
            padding: "0.5rem",
            borderRadius: "8px",
            border: "none",
            background: activeTab === "following"
              ? "rgba(56, 189, 248, 0.12)"
              : "transparent",
            color: activeTab === "following" ? "#fff" : "var(--text-muted)",
            fontSize: "0.8rem",
            fontWeight: activeTab === "following" ? 600 : 400,
            cursor: "pointer",
            transition: "all 0.15s ease",
          }}
        >
          {casualModeActive ? "My Feed" : "Following"}
        </button>
        <button
          onClick={() => setActiveTab("discover")}
          style={{
            flex: 1,
            padding: "0.5rem",
            borderRadius: "8px",
            border: "none",
            background: activeTab === "discover"
              ? "rgba(56, 189, 248, 0.12)"
              : "transparent",
            color: activeTab === "discover" ? "#fff" : "var(--text-muted)",
            fontSize: "0.8rem",
            fontWeight: activeTab === "discover" ? 600 : 400,
            cursor: "pointer",
            transition: "all 0.15s ease",
          }}
        >
          {casualModeActive ? "Explore" : "Discover"}
        </button>
      </div>

      {/* Pending Tankmate Requests */}
      {activeTab === "following" && (
        <TankmateRequests onNavigateProfile={handleProfileClick} casualModeActive={casualModeActive} />
      )}

      {/* Not configured notice */}
      {!configured && (
        <div style={{
          padding: "1rem",
          borderRadius: "10px",
          background: "rgba(251, 191, 36, 0.05)",
          border: "1px solid rgba(251, 191, 36, 0.15)",
          marginBottom: "1rem",
          textAlign: "center",
        }}>
          <p style={{ margin: 0, fontSize: "0.8rem", color: "var(--text-secondary)" }}>
            🪸 The Reef is ready to connect once Supabase is configured.
          </p>
          <p style={{ margin: "0.25rem 0 0", fontSize: "0.65rem", color: "var(--text-muted)" }}>
            Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in frontend/.env
          </p>
        </div>
      )}

      {/* Loading state */}
      {isLoading && (
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              style={{
                height: "180px",
                borderRadius: "12px",
                background: "rgba(255, 255, 255, 0.03)",
                border: "1px solid rgba(255, 255, 255, 0.05)",
                animation: "pulse 1.5s ease-in-out infinite",
              }}
            />
          ))}
        </div>
      )}

      {/* Feed items */}
      {!isLoading && items.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          {items.map((current, index) => (
            <div
              key={current.id}
              ref={index === items.length - 1 ? lastItemRef : undefined}
            >
              <CurrentCard
                current={current}
                casualModeActive={casualModeActive}
                onProfileClick={handleProfileClick}
              />
            </div>
          ))}

          {/* Loading more indicator */}
          {isFetchingNextPage && (
            <p style={{ textAlign: "center", fontSize: "0.75rem", color: "var(--text-muted)", padding: "1rem" }}>
              Loading more...
            </p>
          )}
        </div>
      )}

      {/* Empty states */}
      {!isLoading && items.length === 0 && configured && (
        <div style={{
          textAlign: "center",
          padding: "3rem 1rem",
          borderRadius: "12px",
          background: "rgba(255, 255, 255, 0.02)",
          border: "1px solid rgba(255, 255, 255, 0.05)",
        }}>
          {activeTab === "following" ? (
            <>
              <p style={{ fontSize: "2rem", margin: "0 0 0.5rem" }}>🪸</p>
              <p style={{ fontSize: "0.9rem", color: "#fff", fontWeight: 600, margin: "0 0 0.5rem" }}>
                {casualModeActive ? "Your reef is quiet" : "No activity yet"}
              </p>
              <p style={{ fontSize: "0.8rem", color: "var(--text-muted)", margin: "0 0 1rem" }}>
                {casualModeActive
                  ? "Follow some breeders or watch tanks to fill your feed!"
                  : "Connect with other breeders to see their activity here."
                }
              </p>
              <button
                onClick={() => setActiveTab("discover")}
                style={{
                  padding: "0.5rem 1rem",
                  borderRadius: "8px",
                  border: "none",
                  background: "linear-gradient(135deg, #0ea5e9, #0369a1)",
                  color: "#fff",
                  fontSize: "0.8rem",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                {casualModeActive ? "Explore The Reef" : "Browse Discover Feed"}
              </button>
            </>
          ) : (
            <>
              <p style={{ fontSize: "2rem", margin: "0 0 0.5rem" }}>🐠</p>
              <p style={{ fontSize: "0.9rem", color: "#fff", fontWeight: 600, margin: "0 0 0.5rem" }}>
                {casualModeActive ? "No posts yet" : "Nothing here yet"}
              </p>
              <p style={{ fontSize: "0.8rem", color: "var(--text-muted)", margin: "0 0 1rem" }}>
                Be the first to share a tank update!
              </p>
              <button
                onClick={() => setComposerOpen(true)}
                style={{
                  padding: "0.5rem 1rem",
                  borderRadius: "8px",
                  border: "none",
                  background: "linear-gradient(135deg, #0ea5e9, #0369a1)",
                  color: "#fff",
                  fontSize: "0.8rem",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                {casualModeActive ? "🪸 Share Your Tank" : "Create First Current"}
              </button>
            </>
          )}
        </div>
      )}

      {/* Floating Action Button — New Post */}
      {walletAddress && (
        <button
          onClick={() => setComposerOpen(true)}
          className="reef-fab"
          style={{
            position: "fixed",
            bottom: "2rem",
            right: "2rem",
            width: "56px",
            height: "56px",
            borderRadius: "50%",
            border: "none",
            background: "linear-gradient(135deg, #0ea5e9, #0369a1)",
            color: "#fff",
            fontSize: "1.5rem",
            cursor: "pointer",
            boxShadow: "0 4px 20px rgba(14, 165, 233, 0.4)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            transition: "transform 0.2s ease, box-shadow 0.2s ease",
            zIndex: 1000,
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.transform = "scale(1.1)";
            e.currentTarget.style.boxShadow = "0 6px 28px rgba(14, 165, 233, 0.5)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = "scale(1)";
            e.currentTarget.style.boxShadow = "0 4px 20px rgba(14, 165, 233, 0.4)";
          }}
          aria-label="Create new post"
          title={casualModeActive ? "Share a tank update" : "New Current"}
        >
          +
        </button>
      )}

      {/* Content Composer Modal */}
      <ContentComposer
        isOpen={composerOpen}
        onClose={() => setComposerOpen(false)}
        onSuccess={handlePostSuccess}
        casualModeActive={casualModeActive}
      />

      {/* Pulse animation keyframes */}
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
      `}</style>
    </div>
  );
}
