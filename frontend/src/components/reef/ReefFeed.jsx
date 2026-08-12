/**
 * ReefFeed.jsx
 * 
 * Main social feed view for The Reef.
 * Reorganized with clear tab navigation: Feed | Explore | Groups | Events
 * Combined Inbox (Notifications + Messages), onboarding overlay, and
 * casual mode labels throughout for discoverability.
 */

import React, { useState, useCallback, useRef } from "react";
import { CurrentCard } from "./CurrentCard";
import { ContentComposer } from "./ContentComposer";
import { InboxPanel } from "./InboxPanel";
import { TankmateRequests } from "./TankmateRequests";
import { SchoolInvites } from "./SchoolInvites";
import { PublicProfile } from "./PublicProfile";
import { SchoolDirectory } from "./SchoolDirectory";
import { SchoolPage } from "./SchoolPage";
import { CreateSchool } from "./CreateSchool";
import { TideCalendar } from "./TideCalendar";
import { TidePage } from "./TidePage";
import { CreateTide } from "./CreateTide";
import { ReefSearchBar } from "./ReefSearchBar";
import { DiscoveryPanel } from "./DiscoveryPanel";
import { UnlockPrompt, useUnlockGate } from "./UnlockPrompt";
import { useFollowingFeed, useDiscoverFeed } from "../../hooks/useReefFeed";
import { useEnsureProfile } from "../../hooks/useReefProfile";
import { getCurrentWallet, isSupabaseConfigured } from "../../services/supabaseClient";
import { useQueryClient } from "@tanstack/react-query";

export function ReefFeed({ casualModeActive = false, walletAddress, onNavigateProfile }) {
  const [activeTab, setActiveTab] = useState("feed");
  const [composerOpen, setComposerOpen] = useState(false);
  const [composerPreselectedTank, setComposerPreselectedTank] = useState(null);
  const [viewingProfile, setViewingProfile] = useState(null);
  const [viewingSchool, setViewingSchool] = useState(null);
  const [creatingSchool, setCreatingSchool] = useState(false);
  const [viewingTide, setViewingTide] = useState(null);
  const [creatingTide, setCreatingTide] = useState(false);
  const queryClient = useQueryClient();

  // XP unlock gates
  const createSchoolGate = useUnlockGate("canCreateSchools");
  const hostTideGate = useUnlockGate("canHostVirtualTides");

  // Ensure profile exists on load
  useEnsureProfile(walletAddress);

  // Listen for "Share Tank" event from tank detail panels
  React.useEffect(() => {
    const handleOpenComposer = (e) => {
      setComposerOpen(true);
      if (e.detail) {
        setComposerPreselectedTank(e.detail);
      }
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
  const following = useFollowingFeed(activeTab === "feed", walletAddress);
  const discover = useDiscoverFeed(activeTab === "explore");

  const activeFeed = activeTab === "feed" ? following : discover;
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

  const handleCreateSchool = () => {
    if (createSchoolGate.checkAccess()) {
      setCreatingSchool(true);
    }
  };

  const handleCreateTide = () => {
    if (hostTideGate.checkAccess()) {
      setCreatingTide(true);
    }
  };

  const configured = isSupabaseConfigured();

  // ─────────────────────────────────────────────────────────────────────────
  // SUB-VIEWS (profile, school detail, tide detail)
  // ─────────────────────────────────────────────────────────────────────────

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

  if (viewingSchool) {
    return (
      <SchoolPage
        schoolId={viewingSchool.id}
        onBack={() => setViewingSchool(null)}
        onViewProfile={handleProfileClick}
      />
    );
  }

  if (viewingTide) {
    return (
      <TidePage
        tideId={viewingTide}
        onBack={() => setViewingTide(null)}
      />
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // MAIN LAYOUT
  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div style={{ maxWidth: "640px", margin: "0 auto" }} className="reef-feed-container">

      {/* XP Unlock prompts */}
      {createSchoolGate.showPrompt && (
        <UnlockPrompt
          privilege="canCreateSchools"
          casualModeActive={casualModeActive}
          onClose={() => createSchoolGate.setShowPrompt(false)}
        />
      )}
      {hostTideGate.showPrompt && (
        <UnlockPrompt
          privilege="canHostVirtualTides"
          casualModeActive={casualModeActive}
          onClose={() => hostTideGate.setShowPrompt(false)}
        />
      )}

      {/* ─── HEADER ─── */}
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        marginBottom: "1rem",
      }}>
        <div>
          <h2 style={{ margin: 0, fontSize: "1.2rem", fontWeight: 700, color: "#fff" }}>
            {casualModeActive ? "🪸 Community" : "The Reef"}
          </h2>
          <p style={{ margin: "0.2rem 0 0", fontSize: "0.68rem", color: "var(--text-muted)" }}>
            {casualModeActive
              ? "Connect with fellow fishkeepers"
              : "Your social command center"
            }
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          {walletAddress && (
            <ReefSearchBar
              onNavigateProfile={handleProfileClick}
              onNavigateCurrent={(current) => {
                if (current?.author?.wallet_address) {
                  handleProfileClick(current.author.wallet_address);
                }
              }}
              onNavigateSchool={(school) => setViewingSchool(school)}
              onNavigateTide={(tide) => setViewingTide(tide.id)}
              onNavigateInsight={(insight) => {
                if (insight?.author?.wallet_address) {
                  handleProfileClick(insight.author.wallet_address);
                }
              }}
              casualModeActive={casualModeActive}
            />
          )}
          {walletAddress && (
            <button
              onClick={() => handleProfileClick(walletAddress)}
              style={{
                width: "34px",
                height: "34px",
                borderRadius: "8px",
                border: "1px solid rgba(255, 255, 255, 0.08)",
                background: "rgba(255, 255, 255, 0.03)",
                color: "var(--text-muted)",
                cursor: "pointer",
                fontSize: "1rem",
                transition: "all 0.15s ease",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                padding: 0
              }}
              onMouseEnter={(e) => { e.currentTarget.style.color = "#fff"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.15)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-muted)"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.08)"; }}
              title={casualModeActive ? "My Profile" : "Profile"}
              aria-label="View my profile"
            >
              👤
            </button>
          )}
          <InboxPanel casualModeActive={casualModeActive} />
          <button
            onClick={handleRefresh}
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
              padding: 0
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = "#fff"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.15)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-muted)"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.08)"; }}
            title="Refresh"
            aria-label="Refresh feed"
          >
            🔄
          </button>
        </div>
      </div>

      {/* ─── TAB NAVIGATION ─── */}
      <div style={{
        display: "flex",
        gap: "0.2rem",
        marginBottom: "1.25rem",
        padding: "0.25rem",
        borderRadius: "10px",
        background: "rgba(255, 255, 255, 0.03)",
        border: "1px solid rgba(255, 255, 255, 0.06)",
        overflowX: "auto",
      }} className="reef-feed-tabs">
        {getTabConfig(casualModeActive).map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            style={{
              flex: 1,
              padding: "0.5rem 0.4rem",
              borderRadius: "8px",
              border: "none",
              background: activeTab === tab.key ? "rgba(56, 189, 248, 0.12)" : "transparent",
              color: activeTab === tab.key ? "#fff" : "var(--text-muted)",
              fontSize: "0.72rem",
              fontWeight: activeTab === tab.key ? 600 : 400,
              cursor: "pointer",
              transition: "all 0.15s ease",
              whiteSpace: "nowrap",
              minWidth: 0,
            }}
            aria-selected={activeTab === tab.key}
            role="tab"
          >
            {tab.icon} {tab.label}
          </button>
        ))}
      </div>

      {/* ─── TAB CONTENT ─── */}

      {/* FEED TAB */}
      {activeTab === "feed" && (
        <>
          {/* Welcome banner for first-time users */}
          {localStorage.getItem("aquadex_posted_first_current") !== "true" && (
            <WelcomeBanner casualModeActive={casualModeActive} />
          )}

          {/* Pending requests */}
          <TankmateRequests onNavigateProfile={handleProfileClick} casualModeActive={casualModeActive} />
          <SchoolInvites onNavigateSchool={(schoolId) => { setViewingSchool(schoolId); }} />

          {/* Feed content */}
          {renderFeedContent({
            isLoading, items, configured, casualModeActive,
            isFetchingNextPage, lastItemRef, handleProfileClick,
            setActiveTab, setComposerOpen,
          })}
        </>
      )}

      {/* EXPLORE TAB */}
      {activeTab === "explore" && (
        <>
          {walletAddress && (
            <DiscoveryPanel
              onProfileClick={handleProfileClick}
              casualModeActive={casualModeActive}
            />
          )}
          {renderFeedContent({
            isLoading, items, configured, casualModeActive,
            isFetchingNextPage, lastItemRef, handleProfileClick,
            setActiveTab, setComposerOpen,
            emptyIcon: "🔍",
            emptyTitle: casualModeActive ? "Nothing to explore yet" : "Discover feed is empty",
            emptySubtitle: casualModeActive ? "Be the first to share a tank update!" : "No public posts yet. Be the pioneer.",
          })}
        </>
      )}

      {/* GROUPS TAB */}
      {activeTab === "groups" && (
        <div>
          <SchoolDirectory
            onSelectSchool={(school) => setViewingSchool(school)}
            onCreateSchool={handleCreateSchool}
            casualModeActive={casualModeActive}
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
      )}

      {/* EVENTS TAB */}
      {activeTab === "events" && (
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
            <div>
              <h3 style={{ margin: 0, fontSize: "1rem", fontWeight: 600, color: "#fff" }}>
                {casualModeActive ? "📅 Upcoming Events" : "🌊 Upcoming Tides"}
              </h3>
              <p style={{ margin: "0.2rem 0 0", fontSize: "0.68rem", color: "var(--text-muted)" }}>
                {casualModeActive
                  ? "Meetups, auctions, challenges, and more"
                  : "Expos, virtual syncs, and auction events"
                }
              </p>
            </div>
            {walletAddress && (
              <button
                onClick={handleCreateTide}
                style={{
                  padding: "0.45rem 1rem",
                  borderRadius: "8px",
                  border: "none",
                  background: "linear-gradient(135deg, #0ea5e9, #0369a1)",
                  color: "#fff",
                  fontSize: "0.72rem",
                  fontWeight: 600,
                  cursor: "pointer",
                  boxShadow: "0 3px 10px rgba(14, 165, 233, 0.2)",
                  transition: "all 0.15s ease",
                }}
              >
                + {casualModeActive ? "Host Event" : "Create Tide"}
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
            {casualModeActive
              ? "🪸 The community features are ready once the backend is configured."
              : "🪸 The Reef is ready to connect once Supabase is configured."
            }
          </p>
        </div>
      )}

      {/* ─── FLOATING ACTION BUTTON ─── */}
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
          aria-label={casualModeActive ? "Share a tank update" : "New post"}
          title={casualModeActive ? "Share a tank update" : "New Current"}
        >
          +
        </button>
      )}

      {/* Content Composer Modal */}
      <ContentComposer
        isOpen={composerOpen}
        onClose={() => {
          setComposerOpen(false);
          setComposerPreselectedTank(null);
        }}
        onSuccess={handlePostSuccess}
        casualModeActive={casualModeActive}
        preselectedTank={composerPreselectedTank}
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

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function getTabConfig(casualMode) {
  return [
    { key: "feed", icon: "📰", label: casualMode ? "My Feed" : "Feed" },
    { key: "explore", icon: "🔍", label: "Explore" },
    { key: "groups", icon: "👥", label: casualMode ? "Groups" : "Schools" },
    { key: "events", icon: "📅", label: casualMode ? "Events" : "Tides" },
  ];
}

function WelcomeBanner({ casualModeActive }) {
  return (
    <div
      className="glass-card"
      style={{
        padding: "1rem 1.25rem",
        marginBottom: "1.25rem",
        borderRadius: "12px",
        border: "1px solid rgba(56, 189, 248, 0.15)",
        background: "rgba(56, 189, 248, 0.03)",
        display: "flex",
        alignItems: "center",
        gap: "1rem"
      }}
    >
      <span style={{ fontSize: "1.75rem", flexShrink: 0 }}>🪸</span>
      <div>
        <p style={{ margin: 0, fontSize: "0.85rem", fontWeight: 600, color: "#fff" }}>
          {casualModeActive ? "Welcome to the community!" : "Welcome to The Reef"}
        </p>
        <p style={{ margin: "0.2rem 0 0", fontSize: "0.72rem", color: "var(--text-secondary)", lineHeight: "1.4" }}>
          {casualModeActive
            ? "Share photos of your tanks, follow other keepers, and join groups. Hit the + button to make your first post!"
            : "Publish your first Current to establish your presence. Share tank status, parameters, and media."
          }
        </p>
      </div>
    </div>
  );
}

function renderFeedContent({
  isLoading, items, configured, casualModeActive,
  isFetchingNextPage, lastItemRef, handleProfileClick,
  setActiveTab, setComposerOpen,
  emptyIcon = "🪸",
  emptyTitle,
  emptySubtitle,
}) {
  if (isLoading) {
    return (
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
    );
  }

  if (items.length > 0) {
    return (
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
        {isFetchingNextPage && (
          <p style={{ textAlign: "center", fontSize: "0.75rem", color: "var(--text-muted)", padding: "1rem" }}>
            Loading more...
          </p>
        )}
      </div>
    );
  }

  // Empty state
  if (configured) {
    return (
      <div style={{
        textAlign: "center",
        padding: "3rem 1.5rem",
        borderRadius: "12px",
        background: "rgba(255, 255, 255, 0.02)",
        border: "1px solid rgba(255, 255, 255, 0.05)",
      }}>
        <p style={{ fontSize: "2.5rem", margin: "0 0 0.75rem" }}>{emptyIcon}</p>
        <p style={{ fontSize: "0.95rem", color: "#fff", fontWeight: 600, margin: "0 0 0.5rem" }}>
          {emptyTitle || (casualModeActive ? "Your feed is quiet" : "No activity yet")}
        </p>
        <p style={{ fontSize: "0.8rem", color: "var(--text-muted)", margin: "0 0 1.25rem", lineHeight: 1.5 }}>
          {emptySubtitle || (casualModeActive
            ? "Follow some fishkeepers or join a group to see their updates here. Or share your first tank post!"
            : "Connect with breeders or join a School to populate your feed."
          )}
        </p>
        <div style={{ display: "flex", gap: "0.5rem", justifyContent: "center", flexWrap: "wrap" }}>
          <button
            onClick={() => setActiveTab("explore")}
            style={{
              padding: "0.5rem 1rem",
              borderRadius: "8px",
              border: "1px solid rgba(56, 189, 248, 0.2)",
              background: "rgba(56, 189, 248, 0.08)",
              color: "#fff",
              fontSize: "0.75rem",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            {casualModeActive ? "🔍 Find People" : "Browse Discover"}
          </button>
          <button
            onClick={() => setActiveTab("groups")}
            style={{
              padding: "0.5rem 1rem",
              borderRadius: "8px",
              border: "1px solid rgba(52, 211, 153, 0.2)",
              background: "rgba(52, 211, 153, 0.08)",
              color: "#fff",
              fontSize: "0.75rem",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            {casualModeActive ? "👥 Join a Group" : "Browse Schools"}
          </button>
          <button
            onClick={() => setComposerOpen(true)}
            style={{
              padding: "0.5rem 1rem",
              borderRadius: "8px",
              border: "none",
              background: "linear-gradient(135deg, #0ea5e9, #0369a1)",
              color: "#fff",
              fontSize: "0.75rem",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            {casualModeActive ? "📸 Share Your Tank" : "Post First Current"}
          </button>
        </div>
      </div>
    );
  }

  return null;
}
