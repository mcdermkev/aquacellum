/**
 * TidePage.jsx
 * 
 * Full event detail view with three states:
 * - Pre-event: details, RSVP, attendee list, swap sheet, countdown
 * - Live: switches to TideLiveFeed + TideChat
 * - Post-event: TideRecap with Poseidon-generated summary
 */

import { useState, useEffect } from "react";
import { useTide, useTideAttendees, useMyRsvp, useRsvp, useCancelRsvp, useCheckIn, useStartTide, useEndTide } from "../../hooks/useTides";
import { getCurrentWallet } from "../../services/supabaseClient";
import { sameWallet } from "../../utils/wallet";
import { awardXp } from "../../utils/xp";
import { useAuth } from "../../contexts/AuthContext";
import { ProfileCard } from "./ProfileCard";
import TideLiveFeed from "./TideLiveFeed";
import TideChat from "./TideChat";
import TideMap from "./TideMap";
import SwapSheet from "./SwapSheet";
import AuctionPanel from "./AuctionPanel";
import { TideStreamPlayer } from "./TideStreamPlayer";
import { TideLivePulse } from "./TideLivePulse";
import { TIDE_VIDEO_ENABLED } from "../../config/liveEvents";

const TIDE_TYPE_LABELS = {
  expo: { label: "Expo", icon: "📍", color: "#10b981" },
  virtual: { label: "Virtual", icon: "🎥", color: "#6366f1" },
  challenge: { label: "Challenge", icon: "🏆", color: "#f59e0b" },
  auction: { label: "Auction", icon: "🔨", color: "#ef4444" },
};

/**
 * Format a tide's end for display beside its start.
 *
 * The end used to render with toLocaleTimeString only — time of day, no date. For
 * a tide inside a single afternoon that reads fine, but production has a tide
 * running a full 7 days, and it displayed as "3:50 PM → 3:50 PM": identical
 * timestamps suggesting a zero-length event. The duration was real; only the
 * formatting hid it.
 *
 * So: show just the time when the tide ends on the day it started, and include
 * the date when it doesn't.
 */
function formatTideEnd(startTime, endTime) {
  const start = new Date(startTime);
  const end = new Date(endTime);

  const timeOnly = { hour: "numeric", minute: "2-digit" };
  if (start.toDateString() === end.toDateString()) {
    return end.toLocaleTimeString(undefined, timeOnly);
  }

  return end.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    ...timeOnly,
  });
}

function TideCountdown({ startTime }) {
  const [timeStr, setTimeStr] = useState("");

  // useEffect, not useState. This was `useState(() => {...})`, which React treats
  // as a lazy INITIALISER: it ran the body exactly once, threw away the returned
  // cleanup, and never re-ran. Two consequences — the countdown froze at whatever
  // it read on first paint (so "2h 14m 3s" just sat there, and a tide that had
  // already started never flipped to "Starting now!"), and the 1s interval was
  // never cleared, so every visit to a tide leaked another timer calling
  // setState on an unmounted component. TideCalendar's copy does this correctly.
  useEffect(() => {
    function update() {
      const diff = new Date(startTime).getTime() - Date.now();
      if (diff <= 0) {
        setTimeStr("Starting now!");
        return;
      }
      const d = Math.floor(diff / 86400000);
      const h = Math.floor((diff / 3600000) % 24);
      const m = Math.floor((diff / 60000) % 60);
      const s = Math.floor((diff / 1000) % 60);

      if (d > 0) setTimeStr(`${d}d ${h}h ${m}m`);
      else if (h > 0) setTimeStr(`${h}h ${m}m ${s}s`);
      else setTimeStr(`${m}m ${s}s`);
    }
    update();
    const iv = setInterval(update, 1000);
    return () => clearInterval(iv);
  }, [startTime]);

  return <div className="tide-page__countdown">{timeStr}</div>;
}

/**
 * Virtual gathering panel — shown for Virtual Tides while video is deferred.
 * A Virtual Tide runs as a live chat + presence gathering (no stream), so this
 * points attendees to the Live Feed and Chat instead of a video player.
 */
function VirtualGatheringPanel({ isLive, isEnded, onOpenFeed, onOpenChat }) {
  return (
    <div
      style={{
        padding: "1.5rem",
        borderRadius: "12px",
        background: "rgba(99, 102, 241, 0.05)",
        border: "1px solid rgba(99, 102, 241, 0.15)",
        textAlign: "center",
      }}
      aria-label="Virtual gathering"
    >
      <p style={{ fontSize: "1.75rem", margin: "0 0 0.5rem" }}>🌊</p>
      <h3 style={{ margin: "0 0 0.4rem", color: "#fff", fontSize: "0.95rem" }}>
        {isEnded ? "This gathering has ended" : isLive ? "Live Virtual Gathering" : "Virtual Gathering"}
      </h3>
      <p style={{ margin: "0 0 1rem", fontSize: "0.78rem", color: "var(--text-muted)", lineHeight: 1.5 }}>
        {isEnded
          ? "Catch the recap and see what you missed."
          : isLive
            ? "It's happening now — jump into the Live Feed and Chat to join the conversation and drop reactions."
            : "When this goes live, join the Live Feed and Chat to talk with everyone in real time. No camera needed."}
      </p>
      {isLive && (
        <div style={{ display: "flex", gap: "0.5rem", justifyContent: "center", flexWrap: "wrap" }}>
          <button className="btn btn--primary btn--sm" onClick={onOpenFeed}>🌊 Live Feed</button>
          <button className="btn btn--secondary btn--sm" onClick={onOpenChat}>💬 Chat</button>
        </div>
      )}
    </div>
  );
}

export function TidePage({ tideId, onBack }) {
  const { data: tide, isLoading } = useTide(tideId);
  const { data: attendees = [] } = useTideAttendees(tideId);
  const { data: myRsvp } = useMyRsvp(tideId);
  const rsvpMutation = useRsvp(tideId);
  const cancelRsvpMutation = useCancelRsvp(tideId);
  const checkInMutation = useCheckIn(tideId);
  const startTideMutation = useStartTide(tideId);
  const endTideMutation = useEndTide(tideId);

  const [activeTab, setActiveTab] = useState("details");
  const { account } = useAuth();
  const walletAddress = account || getCurrentWallet();
  const isHost = sameWallet(tide?.host_wallet, walletAddress);

  if (isLoading) {
    return (
      <div className="tide-page tide-page--loading">
        <div className="skeleton-banner" style={{ height: 200 }} />
        <div className="skeleton-text" style={{ width: "60%", margin: "1rem auto" }} />
      </div>
    );
  }

  if (!tide) {
    return (
      <div className="tide-page tide-page--error">
        <button onClick={onBack} className="btn btn--ghost">← Back</button>
        <p>Tide not found.</p>
      </div>
    );
  }

  const typeInfo = TIDE_TYPE_LABELS[tide.tide_type] || TIDE_TYPE_LABELS.expo;
  const isLive = tide.status === "live";
  const isEnded = tide.status === "ended";
  const isUpcoming = tide.status === "upcoming";

  // ── RSVP actions ──
  const handleRsvp = (status) => rsvpMutation.mutate(status);
  const handleCancelRsvp = () => cancelRsvpMutation.mutate();
  // Award the check-in XP the button has always advertised. `xpClaimed` comes back
  // true only for the request that actually flipped tide_attendees.xp_awarded from
  // false, so a double-tap or a second device can't pay out twice.
  const [xpToast, setXpToast] = useState(null);
  const handleCheckIn = () => {
    checkInMutation.mutate(undefined, {
      onSuccess: (res) => {
        if (!res?.xpClaimed) return;
        const { awarded } = awardXp("TIDE_CHECK_IN", { eventId: tideId });
        if (awarded > 0) setXpToast(`+${awarded} XP — checked in!`);
      },
    });
  };

  // Clear the toast after a few seconds.
  useEffect(() => {
    if (!xpToast) return;
    const t = setTimeout(() => setXpToast(null), 4000);
    return () => clearTimeout(t);
  }, [xpToast]);

  // ── Host lifecycle actions ──
  const handleGoLive = () => startTideMutation.mutate();
  const handleEndTide = () => {
    if (!confirm("End this tide? Attendees will move to the recap and the live chat will close.")) return;
    endTideMutation.mutate();
  };

  // ── Determine available tabs ──
  const tabs = [{ key: "details", label: "Details" }];
  if (isLive || isEnded) tabs.push({ key: "feed", label: "Live Feed" });
  if (isLive) tabs.push({ key: "chat", label: "Chat" });
  if (tide.tide_type === "expo" && (isLive || isUpcoming)) tabs.push({ key: "map", label: "Map" });
  if (isUpcoming || isLive) tabs.push({ key: "swap", label: "Swap Sheet" });
  if (tide.tide_type === "auction" && (isLive || isUpcoming)) tabs.push({ key: "auction", label: "Auction" });
  if (isEnded && tide.recap_content) tabs.push({ key: "recap", label: "Recap" });

  return (
    <section className="tide-page" aria-label={`Tide: ${tide.title}`}>
      {/* Navigation */}
      <nav className="tide-page__nav">
        <button onClick={onBack} className="btn btn--ghost">← Back to Tides</button>
      </nav>

      {/* Banner */}
      {tide.banner_url && (
        <div className="tide-page__banner">
          <img src={tide.banner_url} alt={`Banner for ${tide.title}`} />
          {isLive && <span className="tide-page__live-indicator">🔴 LIVE NOW</span>}
        </div>
      )}

      {/* Header */}
      <header className="tide-page__header">
        <span className="tide-page__type-badge" style={{ backgroundColor: typeInfo.color }}>
          {typeInfo.icon} {typeInfo.label}
        </span>
        <h1>{tide.title}</h1>
        {tide.description && <p className="tide-page__desc">{tide.description}</p>}

        <div className="tide-page__meta">
          <time dateTime={tide.start_time}>
            {new Date(tide.start_time).toLocaleDateString(undefined, {
              weekday: "long",
              month: "long",
              day: "numeric",
              year: "numeric",
              hour: "numeric",
              minute: "2-digit",
            })}
          </time>
          <span> → </span>
          <time dateTime={tide.end_time}>
            {formatTideEnd(tide.start_time, tide.end_time)}
          </time>
          <span className="tide-page__attendee-count">👥 {tide.attendee_count || attendees.length}</span>
        </div>

        {isUpcoming && <TideCountdown startTime={tide.start_time} />}

        {/* Host */}
        {tide.host_profile && (
          <div className="tide-page__host">
            <span>Hosted by</span>
            <ProfileCard
                walletAddress={tide.host_profile?.wallet_address}
                displayName={tide.host_profile?.display_name}
                avatarUrl={tide.host_profile?.avatar_url}
                companionTier={tide.host_profile?.companion_tier}
                size="small"
              />
          </div>
        )}
      </header>

      {/* Host lifecycle controls — the "go live" transition that starts the event */}
      {isHost && !isEnded && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.6rem",
            flexWrap: "wrap",
            padding: "0.6rem 0.9rem",
            margin: "0.5rem 0",
            borderRadius: "12px",
            background: "rgba(255,255,255,0.03)",
            border: "1px solid rgba(255,255,255,0.08)",
          }}
        >
          <span style={{ fontSize: "0.72rem", color: "var(--text-muted)", fontWeight: 600 }}>
            🎬 Host controls
          </span>
          {isUpcoming && (
            <button
              className="btn btn--primary btn--sm"
              onClick={handleGoLive}
              disabled={startTideMutation.isPending}
            >
              {startTideMutation.isPending ? "Starting…" : "🔴 Go Live"}
            </button>
          )}
          {isLive && (
            <button
              className="btn btn--ghost btn--sm"
              onClick={handleEndTide}
              disabled={endTideMutation.isPending}
              style={{ color: "#f87171", borderColor: "rgba(239,68,68,0.3)" }}
            >
              {endTideMutation.isPending ? "Ending…" : "⏹ End Tide"}
            </button>
          )}
          {startTideMutation.isError && (
            <span style={{ fontSize: "0.68rem", color: "#f87171" }}>
              Couldn&apos;t start — {startTideMutation.error?.message || "try again"}
            </span>
          )}
        </div>
      )}

      {/* Live pulse — real-time presence + reactions while the tide is live */}
      {isLive && <div style={{ margin: "0.5rem 0" }}><TideLivePulse tideId={tideId} /></div>}

      {/* RSVP Bar */}
      {!isEnded && (
        <div className="tide-page__rsvp-bar">
          {xpToast && (
            <span className="rsvp-badge rsvp-badge--xp" role="status">{xpToast}</span>
          )}
          {myRsvp?.rsvp_status === "checked_in" ? (
            <span className="rsvp-badge rsvp-badge--checked-in">✓ Checked In</span>
          ) : myRsvp?.rsvp_status ? (
            <div className="rsvp-actions">
              <span className="rsvp-badge">✓ {myRsvp.rsvp_status === "going" ? "Going" : "Interested"}</span>
              {isLive && tide.tide_type === "expo" && (
                <button
                  className="btn btn--primary"
                  onClick={handleCheckIn}
                  disabled={checkInMutation.isPending}
                >
                  📍 Check In (+100 XP)
                </button>
              )}
              <button className="btn btn--ghost btn--sm" onClick={handleCancelRsvp}>
                Cancel RSVP
              </button>
            </div>
          ) : (
            <div className="rsvp-actions">
              <button
                className="btn btn--primary"
                onClick={() => handleRsvp("going")}
                disabled={rsvpMutation.isPending}
              >
                🌊 I'm Going
              </button>
              <button
                className="btn btn--secondary"
                onClick={() => handleRsvp("interested")}
                disabled={rsvpMutation.isPending}
              >
                👀 Interested
              </button>
            </div>
          )}
        </div>
      )}

      {/* Tabs */}
      <nav className="tide-page__tabs" role="tablist" aria-label="Tide sections">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            role="tab"
            aria-selected={activeTab === tab.key}
            className={`tide-page__tab ${activeTab === tab.key ? "tide-page__tab--active" : ""}`}
            onClick={() => setActiveTab(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      {/* Tab Content */}
      <div className="tide-page__content" role="tabpanel">
        {activeTab === "details" && (
          <div className="tide-page__details">
            {/* Attendees */}
            <section aria-label="Attendees">
              <h3>Attendees ({attendees.length})</h3>
              {attendees.length === 0 ? (
                <p className="text-muted">No RSVPs yet. Be the first!</p>
              ) : (
                <div className="tide-page__attendee-grid">
                  {attendees.slice(0, 20).map((a) => (
                    <div key={a.wallet_address} className="tide-page__attendee">
                      <ProfileCard
                walletAddress={a.profile?.wallet_address}
                displayName={a.profile?.display_name}
                avatarUrl={a.profile?.avatar_url}
                companionTier={a.profile?.companion_tier}
                size="small"
              />
                      {a.rsvp_status === "checked_in" && <span className="checkin-dot">📍</span>}
                    </div>
                  ))}
                  {attendees.length > 20 && (
                    <span className="text-muted">+{attendees.length - 20} more</span>
                  )}
                </div>
              )}
            </section>

            {/* Virtual Tides — video is deferred for launch (TIDE_VIDEO_ENABLED).
                While off, a Virtual Tide runs as a live chat + presence gathering. */}
            {tide.tide_type === "virtual" && (
              <section aria-label="Virtual gathering">
                {TIDE_VIDEO_ENABLED ? (
                  <TideStreamPlayer
                    tideId={tideId}
                    hostWallet={tide.host_wallet}
                    tideStartTime={tide.start_time}
                  />
                ) : (
                  <VirtualGatheringPanel
                    isLive={isLive}
                    isEnded={isEnded}
                    onOpenFeed={() => setActiveTab("feed")}
                    onOpenChat={() => setActiveTab("chat")}
                  />
                )}
              </section>
            )}
          </div>
        )}

        {activeTab === "feed" && (
          <TideLiveFeed tideId={tideId} enabled={isLive || isEnded} />
        )}

        {activeTab === "chat" && (
          <TideChat tideId={tideId} enabled={isLive} />
        )}

        {/* The tab button (above) appears for every expo, but this body used to
            require gps_bounds — and both expos in production have it null, because
            the create wizard's lat/lng fields were optional. Result: tapping "Map"
            showed an entirely blank panel with no explanation. New expos now
            require a location; this covers the ones created before that. */}
        {activeTab === "map" && (
          tide.gps_bounds ? (
            <TideMap
              tideId={tideId}
              gpsBounds={tide.gps_bounds}
              attendees={attendees}
              isLive={isLive}
              onCheckIn={handleCheckIn}
            />
          ) : (
            <div className="tide-page__empty">
              <p>🗺️ No location set for this expo.</p>
              <p className="text-muted">
                {isHost
                  ? "Add a meetup location so attendees can find the spot and check in when they arrive."
                  : "The host hasn't pinned the meetup spot yet. Check the description for directions."}
              </p>
            </div>
          )
        )}

        {activeTab === "swap" && (
          <SwapSheet tideId={tideId} isLive={isLive} />
        )}

        {activeTab === "auction" && (
          <AuctionPanel tideId={tideId} isLive={isLive} />
        )}

        {activeTab === "recap" && tide.recap_content && (
          <div className="tide-page__recap">
            <h3>🌊 Tide Recap</h3>
            {tide.recap_content.summary && <p>{tide.recap_content.summary}</p>}
            {tide.recap_content.stats && (
              <div className="recap-stats">
                {tide.recap_content.stats.total_attendees != null && (
                  <div className="recap-stat">
                    <span className="recap-stat__value">{tide.recap_content.stats.total_attendees}</span>
                    <span className="recap-stat__label">Attendees</span>
                  </div>
                )}
                {tide.recap_content.stats.total_trades != null && (
                  <div className="recap-stat">
                    <span className="recap-stat__value">{tide.recap_content.stats.total_trades}</span>
                    <span className="recap-stat__label">Trades</span>
                  </div>
                )}
                {tide.recap_content.stats.xp_awarded != null && (
                  <div className="recap-stat">
                    <span className="recap-stat__value">{tide.recap_content.stats.xp_awarded}</span>
                    <span className="recap-stat__label">XP Awarded</span>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

export default TidePage;
