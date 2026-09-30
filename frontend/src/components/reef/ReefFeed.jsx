/**
 * ReefFeed.jsx
 *
 * The Reef: tank updates, clubs and events. Daylight layout (ReefDaylight.css)
 * matching My Aquariums.
 *
 * View state (tab, open club, open event) comes from the URL when App passes
 * `route` + `onRouteChange` (services/reefRoute.js), so /app/reef?club=<slug>,
 * ?event=<id> and ?tab=<name> are shareable deep links. Without those props the
 * same state is kept locally.
 */

import React, { useState, useCallback, useRef, useMemo } from "react";
import {
  Newspaper,
  Compass,
  UsersThree,
  CalendarBlank,
  UserCircle,
  ArrowClockwise,
  Plus,
  Info,
  WarningCircle,
  Camera,
} from "@phosphor-icons/react";
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
import { splitEvents, clubInitials } from "./reefEvents";
import { useFollowingFeed, useDiscoverFeed } from "../../hooks/useReefFeed";
import { useEnsureProfile } from "../../hooks/useReefProfile";
import { useSchool, useSchoolDirectory } from "../../hooks/useSchools";
import { useTide, useUpcomingTides } from "../../hooks/useTides";
import { isSupabaseConfigured } from "../../services/supabaseClient";
import { reefRouteParams } from "../../services/reefRoute";
import { useQueryClient } from "@tanstack/react-query";
import "./ReefDaylight.css";

const TABS = [
  { key: "feed", label: "My feed", Icon: Newspaper },
  { key: "explore", label: "Explore", Icon: Compass },
  { key: "clubs", label: "Clubs", Icon: UsersThree },
  { key: "events", label: "Events", Icon: CalendarBlank },
];

export function ReefFeed({
  casualModeActive = false,
  walletAddress,
  openMessages = false,
  pendingConversation = null,
  onConversationConsumed,
  onCloseMessages,
  route: routeProp = null,
  onRouteChange = null,
  onRequireSignIn = null,
}) {
  const [localRoute, setLocalRoute] = useState(() => routeProp || {});
  const route = (onRouteChange ? routeProp : localRoute) || {};
  const go = useCallback(
    (next, options) => {
      const params = reefRouteParams(next);
      if (onRouteChange) onRouteChange(params, options);
      else setLocalRoute(params);
    },
    [onRouteChange]
  );

  const [composerOpen, setComposerOpen] = useState(false);
  const [viewingProfile, setViewingProfile] = useState(null);
  // Clubs opened without a slug (an invite only carries the id) stay local.
  const [localSchoolId, setLocalSchoolId] = useState(null);
  const [creatingSchool, setCreatingSchool] = useState(false);
  const [creatingTide, setCreatingTide] = useState(false);
  const queryClient = useQueryClient();
  const signedIn = !!walletAddress;
  const configured = isSupabaseConfigured();

  // XP unlock gates
  const createSchoolGate = useUnlockGate("canCreateSchools");
  const hostTideGate = useUnlockGate("canHostVirtualTides");

  // Ensure profile exists on load
  useEnsureProfile(walletAddress);

  // Listen for "View Profile" event from header profile chip
  React.useEffect(() => {
    const handleViewProfile = (e) => {
      if (e.detail?.wallet) setViewingProfile(e.detail.wallet);
    };
    window.addEventListener("reef_view_profile", handleViewProfile);
    return () => window.removeEventListener("reef_view_profile", handleViewProfile);
  }, []);

  // ── Deep-linked club and event ────────────────────────────────────────────
  const clubQuery = useSchool(route.club || null);
  const linkedClub = clubQuery.data?.data || null;
  const clubMissing = !!route.badClub || (!!route.club && !clubQuery.isLoading && !linkedClub);
  const tideQuery = useTide(route.event || null);
  const eventMissing = !!route.badEvent || (!!route.event && !tideQuery.isLoading && (tideQuery.isError || !tideQuery.data));

  // ── Which tab ─────────────────────────────────────────────────────────────
  // Someone who follows nobody would open onto an empty feed, and there are only
  // a handful of public posts in total, so with no tab in the URL The Reef opens
  // on Explore unless the signed-in feed actually has something in it.
  const requestedTab = clubMissing ? "clubs" : eventMissing ? "events" : route.tab || null;
  const following = useFollowingFeed(signedIn && (!requestedTab || requestedTab === "feed"), walletAddress);
  const followingItems = following.data?.pages?.flatMap((page) => page.data) || [];
  const followingEmpty = signedIn && following.isSuccess && followingItems.length === 0;
  const activeTab = requestedTab || (!signedIn || followingEmpty || !configured ? "explore" : "feed");
  const exploreByDefault = !requestedTab && activeTab === "explore";

  const discover = useDiscoverFeed(activeTab === "explore");
  const activeFeed = activeTab === "feed" ? following : discover;
  const items = activeTab === "feed" ? followingItems : discover.data?.pages?.flatMap((page) => page.data) || [];
  const isLoading = activeTab === "feed" ? signedIn && following.isLoading : activeFeed.isLoading;
  const { hasNextPage, isFetchingNextPage } = activeFeed;

  // Infinite scroll observer
  const observerRef = useRef(null);
  const lastItemRef = useCallback(
    (node) => {
      if (isFetchingNextPage) return;
      if (observerRef.current) observerRef.current.disconnect();
      observerRef.current = new IntersectionObserver((entries) => {
        if (entries[0].isIntersecting && hasNextPage) activeFeed.fetchNextPage();
      });
      if (node) observerRef.current.observe(node);
    },
    [isFetchingNextPage, hasNextPage, activeFeed]
  );

  const handleRefresh = () => queryClient.invalidateQueries({ queryKey: ["reef"] });
  const handlePostSuccess = () => queryClient.invalidateQueries({ queryKey: ["reef"] });
  const handleProfileClick = (wallet) => setViewingProfile(wallet);

  const requireSignIn = () => onRequireSignIn?.();
  const openComposer = () => {
    if (!signedIn) return requireSignIn();
    setComposerOpen(true);
  };
  const setTab = (tab) => {
    setLocalSchoolId(null);
    go({ tab }, { replace: true });
  };
  const openClub = (school) => {
    if (!school) return;
    if (school.slug) {
      setLocalSchoolId(null);
      go({ club: school.slug });
    } else if (school.id) {
      setLocalSchoolId(school.id);
    }
  };
  const openEvent = (tideId) => tideId && go({ event: tideId });

  const handleCreateSchool = () => {
    if (!signedIn) return requireSignIn();
    if (createSchoolGate.checkAccess()) setCreatingSchool(true);
  };
  const handleCreateTide = () => {
    if (!signedIn) return requireSignIn();
    if (hostTideGate.checkAccess()) setCreatingTide(true);
  };

  // Arrow keys move between tabs (WAI-ARIA tabs pattern).
  const tabRefs = useRef({});
  const onTabKeyDown = (e) => {
    const index = TABS.findIndex((t) => t.key === activeTab);
    let next = null;
    if (e.key === "ArrowRight") next = (index + 1) % TABS.length;
    else if (e.key === "ArrowLeft") next = (index - 1 + TABS.length) % TABS.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = TABS.length - 1;
    if (next === null) return;
    e.preventDefault();
    const key = TABS[next].key;
    setTab(key);
    tabRefs.current[key]?.focus();
  };

  const unlockPrompts = (
    <>
      {createSchoolGate.showPrompt && (
        <UnlockPrompt privilege="canCreateSchools" casualModeActive={casualModeActive} onClose={() => createSchoolGate.setShowPrompt(false)} />
      )}
      {hostTideGate.showPrompt && (
        <UnlockPrompt privilege="canHostVirtualTides" casualModeActive={casualModeActive} onClose={() => hostTideGate.setShowPrompt(false)} />
      )}
    </>
  );

  // ─────────────────────────────────────────────────────────────────────────
  // SUB-VIEWS (profile, club, event)
  // ─────────────────────────────────────────────────────────────────────────

  if (viewingProfile) {
    return (
      <div className="reef">
        <PublicProfile
          walletAddress={viewingProfile}
          onBack={() => setViewingProfile(null)}
          onNavigateProfile={handleProfileClick}
          casualModeActive={casualModeActive}
        />
      </div>
    );
  }

  const clubId = localSchoolId || (route.club && linkedClub ? linkedClub.id : null);
  if (route.club && !localSchoolId && clubQuery.isLoading) {
    return (
      <div className="reef" aria-busy="true">
        <div className="reef-skeleton" style={{ height: 220, marginBottom: "1rem" }} />
        <div className="reef-skeleton" style={{ height: 120 }} />
      </div>
    );
  }
  if (clubId) {
    return (
      <div className="reef">
        <SchoolPage
          schoolId={clubId}
          onBack={() => {
            setLocalSchoolId(null);
            go({ tab: "clubs" });
          }}
          onViewProfile={handleProfileClick}
          onOpenEvent={openEvent}
          signedIn={signedIn}
          onRequireSignIn={requireSignIn}
        />
        {unlockPrompts}
      </div>
    );
  }

  if (route.event && !eventMissing) {
    return (
      <div className="reef">
        <TidePage tideId={route.event} onBack={() => go({ tab: "events" })} />
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // MAIN LAYOUT
  // ─────────────────────────────────────────────────────────────────────────

  const showRail = activeTab === "feed" || activeTab === "explore";

  return (
    <div className="reef reef-feed-container">
      {unlockPrompts}

      {/* ─── HEADER ─── */}
      <header className="reef-head">
        <div className="reef-head-text">
          <h2 className="reef-title">The Reef</h2>
          <p className="reef-subtitle">Tank updates, clubs and events from people who keep fish.</p>
        </div>
        <div className="reef-head-actions">
          <div className="reef-head-tools">
            {signedIn && (
              <div className="reef-tool">
                <ReefSearchBar
                  onNavigateProfile={handleProfileClick}
                  onNavigateCurrent={(current) => {
                    if (current?.author?.wallet_address) handleProfileClick(current.author.wallet_address);
                  }}
                  onNavigateSchool={openClub}
                  onNavigateTide={(tide) => openEvent(tide?.id)}
                  onNavigateInsight={(insight) => {
                    if (insight?.author?.wallet_address) handleProfileClick(insight.author.wallet_address);
                  }}
                  casualModeActive={casualModeActive}
                />
              </div>
            )}
            {(signedIn || openMessages) && (
              <div className="reef-tool">
                <InboxPanel
                  casualModeActive={casualModeActive}
                  initialView={openMessages ? "messages" : null}
                  pendingConversation={pendingConversation}
                  onConversationConsumed={onConversationConsumed}
                  onRouteClose={openMessages ? onCloseMessages : null}
                />
              </div>
            )}
            {signedIn && (
              <button
                type="button"
                className="reef-btn"
                onClick={() => handleProfileClick(walletAddress)}
                title="Open your Reef profile"
              >
                <UserCircle size={18} aria-hidden="true" />
                <span>My profile</span>
              </button>
            )}
            <button type="button" className="reef-btn" onClick={handleRefresh} title="Load the newest posts, clubs and events">
              <ArrowClockwise size={18} aria-hidden="true" />
              <span>Refresh</span>
            </button>
          </div>
          <button
            type="button"
            className="reef-btn reef-btn--primary"
            onClick={openComposer}
            title={signedIn ? "Share a photo or note about one of your tanks" : "Sign in to share a tank update"}
          >
            <Camera size={18} weight="bold" aria-hidden="true" />
            Share a tank update
          </button>
        </div>
      </header>

      {/* ─── TABS ─── */}
      <div className="reef-tabs" role="tablist" aria-label="The Reef sections" onKeyDown={onTabKeyDown}>
        {TABS.map(({ key, label, Icon }) => {
          const selected = activeTab === key;
          return (
            <button
              key={key}
              ref={(el) => { tabRefs.current[key] = el; }}
              type="button"
              role="tab"
              id={`reef-tab-${key}`}
              aria-selected={selected}
              aria-controls={`reef-panel-${key}`}
              tabIndex={selected ? 0 : -1}
              className="reef-tab"
              onClick={() => setTab(key)}
            >
              <Icon size={18} weight={selected ? "fill" : "regular"} aria-hidden="true" />
              {label}
            </button>
          );
        })}
      </div>

      {/* ─── PANEL ─── */}
      <div
        role="tabpanel"
        id={`reef-panel-${activeTab}`}
        aria-labelledby={`reef-tab-${activeTab}`}
        className={`reef-layout ${showRail ? "reef-layout--rail" : ""}`}
      >
        <div className="reef-main">
          {clubMissing && activeTab === "clubs" && (
            <Notice warn>We couldn&apos;t find a club at that link. Here are all the clubs.</Notice>
          )}
          {eventMissing && activeTab === "events" && (
            <Notice warn>We couldn&apos;t find that event. It may have been removed. Here are all the events.</Notice>
          )}

          {!configured && (
            <div className="reef-empty reef-empty--flat reef-config">
              <h3 className="reef-empty-title">The Reef isn&apos;t connected here</h3>
              <p className="reef-empty-lead">Posts, clubs and events load once the community backend is configured for this build.</p>
            </div>
          )}

          {/* FEED */}
          {configured && activeTab === "feed" && (
            <>
              {signedIn && (
                <>
                  <TankmateRequests onNavigateProfile={handleProfileClick} casualModeActive={casualModeActive} />
                  <SchoolInvites onNavigateSchool={(schoolId) => openClub({ id: schoolId })} />
                </>
              )}
              <FeedList
                isLoading={isLoading}
                items={items}
                isFetchingNextPage={isFetchingNextPage}
                lastItemRef={lastItemRef}
                onProfileClick={handleProfileClick}
                casualModeActive={casualModeActive}
                empty={
                  signedIn ? (
                    <EmptyState
                      icon={<Newspaper size={24} aria-hidden="true" />}
                      title="Your feed is empty for now"
                      lead="Follow keepers from Explore or join a club, and their tank updates show up here. Your own posts appear here too."
                    >
                      <button type="button" className="reef-btn reef-btn--primary" onClick={() => setTab("explore")}>Explore public posts</button>
                      <button type="button" className="reef-btn" onClick={() => setTab("clubs")}>Browse clubs</button>
                      <button type="button" className="reef-btn" onClick={openComposer}>Share a tank update</button>
                    </EmptyState>
                  ) : (
                    <EmptyState
                      icon={<Newspaper size={24} aria-hidden="true" />}
                      title="Sign in to see your feed"
                      lead="Your feed shows posts from keepers you follow and tanks you watch. Anyone can read the public posts on Explore."
                    >
                      <button type="button" className="reef-btn reef-btn--primary" onClick={requireSignIn}>Sign in</button>
                      <button type="button" className="reef-btn" onClick={() => setTab("explore")}>Explore public posts</button>
                    </EmptyState>
                  )
                }
              />
            </>
          )}

          {/* EXPLORE */}
          {configured && activeTab === "explore" && (
            <>
              {exploreByDefault && signedIn && (
                <Notice>
                  You aren&apos;t following anyone yet, so The Reef opens on public posts. Follow keepers or join a club to build your own feed.
                </Notice>
              )}
              {exploreByDefault && !signedIn && (
                <Notice>
                  You&apos;re reading public posts from the community.
                  <button type="button" className="reef-link" onClick={requireSignIn}>Sign in</button> to follow keepers and share your own tanks.
                </Notice>
              )}
              {signedIn && <DiscoveryPanel onProfileClick={handleProfileClick} casualModeActive={casualModeActive} />}
              <FeedList
                isLoading={isLoading}
                items={items}
                isFetchingNextPage={isFetchingNextPage}
                lastItemRef={lastItemRef}
                onProfileClick={handleProfileClick}
                casualModeActive={casualModeActive}
                empty={
                  <EmptyState
                    icon={<Compass size={24} aria-hidden="true" />}
                    title="No public posts yet"
                    lead="When a keeper shares a tank update publicly, it shows up here."
                  >
                    <button type="button" className="reef-btn reef-btn--primary" onClick={openComposer}>Share a tank update</button>
                    <button type="button" className="reef-btn" onClick={() => setTab("clubs")}>Browse clubs</button>
                  </EmptyState>
                }
              />
            </>
          )}

          {/* CLUBS */}
          {configured && activeTab === "clubs" && (
            <>
              <SchoolDirectory
                onSelectSchool={openClub}
                onCreateSchool={handleCreateSchool}
                casualModeActive={casualModeActive}
                signedIn={signedIn}
                onRequireSignIn={requireSignIn}
              />
              {creatingSchool && (
                <CreateSchool
                  onClose={() => setCreatingSchool(false)}
                  onCreated={(school) => {
                    setCreatingSchool(false);
                    openClub(school);
                  }}
                />
              )}
            </>
          )}

          {/* EVENTS */}
          {configured && activeTab === "events" && (
            <>
              <div className="reef-section-head">
                <div>
                  <h3 className="reef-section-title">Events</h3>
                  <p className="reef-section-sub">Meetups, virtual hangouts, challenges and auctions from clubs and members.</p>
                </div>
                {signedIn && !creatingTide && (
                  <button type="button" className="reef-btn reef-btn--soft" onClick={handleCreateTide}>
                    <Plus size={16} weight="bold" aria-hidden="true" />
                    Host an event
                  </button>
                )}
              </div>
              {creatingTide ? (
                <CreateTide
                  onSuccess={(tide) => {
                    setCreatingTide(false);
                    openEvent(tide.id);
                  }}
                  onCancel={() => setCreatingTide(false)}
                />
              ) : (
                <TideCalendar
                  onSelectTide={openEvent}
                  casualModeActive={casualModeActive}
                  signedIn={signedIn}
                  onRequireSignIn={requireSignIn}
                  onHost={signedIn ? handleCreateTide : null}
                />
              )}
            </>
          )}
        </div>

        {showRail && configured && (
          <aside className="reef-rail" aria-label="Clubs and events">
            <RailClubs onOpenClub={openClub} onBrowse={() => setTab("clubs")} />
            <RailEvents onOpenEvent={openEvent} onBrowse={() => setTab("events")} />
          </aside>
        )}
      </div>

      {/* Content Composer Modal */}
      <ContentComposer
        isOpen={composerOpen}
        onClose={() => setComposerOpen(false)}
        onSuccess={handlePostSuccess}
        casualModeActive={casualModeActive}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PIECES
// ─────────────────────────────────────────────────────────────────────────────

function Notice({ warn = false, children }) {
  const Icon = warn ? WarningCircle : Info;
  return (
    <div className={`reef-notice ${warn ? "reef-notice--warn" : ""}`} role={warn ? "status" : undefined}>
      <Icon size={18} weight="fill" aria-hidden="true" />
      <p>{children}</p>
    </div>
  );
}

function EmptyState({ icon, title, lead, children }) {
  return (
    <div className="reef-empty">
      {icon && <span className="reef-empty-icon">{icon}</span>}
      <h3 className="reef-empty-title">{title}</h3>
      <p className="reef-empty-lead">{lead}</p>
      {children && <div className="reef-empty-actions">{children}</div>}
    </div>
  );
}

function FeedList({ isLoading, items, isFetchingNextPage, lastItemRef, onProfileClick, casualModeActive, empty }) {
  if (isLoading) {
    return (
      <div className="reef-feed" aria-busy="true" aria-label="Loading posts">
        {[1, 2, 3].map((i) => (
          <div key={i} className="reef-skeleton" style={{ height: 200 }} />
        ))}
      </div>
    );
  }
  if (items.length === 0) return empty;
  return (
    <div className="reef-feed">
      {items.map((current, index) => (
        <div key={current.id} ref={index === items.length - 1 ? lastItemRef : undefined}>
          <CurrentCard current={current} casualModeActive={casualModeActive} onProfileClick={onProfileClick} />
        </div>
      ))}
      {isFetchingNextPage && <p className="reef-section-sub" style={{ textAlign: "center" }}>Loading more posts…</p>}
    </div>
  );
}

function RailClubs({ onOpenClub, onBrowse }) {
  const { data, isLoading } = useSchoolDirectory({ type: "all" });
  // Official clubs first (they are the maintained species clubs), then by size.
  const clubs = useMemo(
    () =>
      (data?.pages?.flatMap((p) => p.data) || [])
        .filter((c) => !c.is_invite_only)
        .sort((a, b) => Number(!!b.is_official) - Number(!!a.is_official) || (b.member_count || 0) - (a.member_count || 0))
        .slice(0, 4),
    [data]
  );
  return (
    <section className="reef-rail-card">
      <h3 className="reef-rail-title">Clubs</h3>
      <p className="reef-rail-sub">Groups built around a species, a region or a shared interest.</p>
      {isLoading ? (
        <div className="reef-skeleton" style={{ height: 120, marginBottom: "0.6rem" }} />
      ) : clubs.length === 0 ? (
        <p className="reef-rail-empty">No clubs yet.</p>
      ) : (
        <ul className="reef-rail-list">
          {clubs.map((club) => (
            <li key={club.id}>
              <button type="button" className="reef-rail-item" onClick={() => onOpenClub(club)}>
                <span className="reef-mini-badge" aria-hidden="true">
                  {club.banner_url ? <img src={club.banner_url} alt="" /> : clubInitials(club.name)}
                </span>
                <span className="reef-rail-item-text">
                  <span className="reef-rail-item-name">{club.name}</span>
                  <span className="reef-rail-item-meta">
                    {club.member_count} {club.member_count === 1 ? "member" : "members"}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <button type="button" className="reef-btn reef-btn--sm reef-btn--block" onClick={onBrowse}>
        Browse all clubs
      </button>
    </section>
  );
}

function RailEvents({ onOpenEvent, onBrowse }) {
  const { data: upcomingRows = [], isLoading } = useUpcomingTides({});
  const { upcoming } = useMemo(() => splitEvents(upcomingRows, []), [upcomingRows]);
  const next = upcoming.slice(0, 3);
  return (
    <section className="reef-rail-card">
      <h3 className="reef-rail-title">Upcoming events</h3>
      {isLoading ? (
        <div className="reef-skeleton" style={{ height: 80, margin: "0.6rem 0" }} />
      ) : next.length === 0 ? (
        <p className="reef-rail-empty">No upcoming events right now. Past events are still on the Events tab.</p>
      ) : (
        <ul className="reef-rail-list" style={{ marginTop: "0.6rem" }}>
          {next.map((tide) => {
            const d = new Date(tide.start_time);
            return (
              <li key={tide.id}>
                <button type="button" className="reef-rail-item" onClick={() => onOpenEvent(tide.id)}>
                  <span className="reef-mini-badge" aria-hidden="true">{d.getDate()}</span>
                  <span className="reef-rail-item-text">
                    <span className="reef-rail-item-name">{tide.title}</span>
                    <span className="reef-rail-item-meta">
                      {d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <button type="button" className="reef-btn reef-btn--sm reef-btn--block" onClick={onBrowse}>
        See all events
      </button>
    </section>
  );
}
