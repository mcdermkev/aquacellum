/**
 * TidePage.jsx
 * 
 * Full event detail view with three states:
 * - Pre-event: details, RSVP, attendee list, swap sheet, countdown
 * - Live: switches to TideLiveFeed + TideChat
 * - Post-event: TideRecap with Poseidon-generated summary
 */

import { useState } from "react";
import { useTide, useTideAttendees, useMyRsvp, useRsvp, useCancelRsvp, useCheckIn } from "../../hooks/useTides";
import { getCurrentWallet } from "../../services/supabaseClient";
import { ProfileCard } from "./ProfileCard";
import TideLiveFeed from "./TideLiveFeed";
import TideChat from "./TideChat";
import TideMap from "./TideMap";
import SwapSheet from "./SwapSheet";
import AuctionPanel from "./AuctionPanel";

const TIDE_TYPE_LABELS = {
  expo: { label: "Expo", icon: "📍", color: "#10b981" },
  virtual: { label: "Virtual", icon: "🎥", color: "#6366f1" },
  challenge: { label: "Challenge", icon: "🏆", color: "#f59e0b" },
  auction: { label: "Auction", icon: "🔨", color: "#ef4444" },
};

function TideCountdown({ startTime }) {
  const [timeStr, setTimeStr] = useState("");

  useState(() => {
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
  });

  return <div className="tide-page__countdown">{timeStr}</div>;
}

export function TidePage({ tideId, onBack }) {
  const { data: tide, isLoading } = useTide(tideId);
  const { data: attendees = [] } = useTideAttendees(tideId);
  const { data: myRsvp } = useMyRsvp(tideId);
  const rsvpMutation = useRsvp(tideId);
  const cancelRsvpMutation = useCancelRsvp(tideId);
  const checkInMutation = useCheckIn(tideId);

  const [activeTab, setActiveTab] = useState("details");
  const walletAddress = getCurrentWallet();
  const isHost = tide?.host_wallet === walletAddress;

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
  const handleCheckIn = () => checkInMutation.mutate();

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
            {new Date(tide.end_time).toLocaleTimeString(undefined, {
              hour: "numeric",
              minute: "2-digit",
            })}
          </time>
          <span className="tide-page__attendee-count">👥 {tide.attendee_count || attendees.length}</span>
        </div>

        {isUpcoming && <TideCountdown startTime={tide.start_time} />}

        {/* Host */}
        {tide.host_profile && (
          <div className="tide-page__host">
            <span>Hosted by</span>
            <ProfileCard profile={tide.host_profile} compact />
          </div>
        )}
      </header>

      {/* RSVP Bar */}
      {!isEnded && (
        <div className="tide-page__rsvp-bar">
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
                      <ProfileCard profile={a.profile} compact />
                      {a.rsvp_status === "checked_in" && <span className="checkin-dot">📍</span>}
                    </div>
                  ))}
                  {attendees.length > 20 && (
                    <span className="text-muted">+{attendees.length - 20} more</span>
                  )}
                </div>
              )}
            </section>

            {/* Stream URL for Virtual Tides */}
            {tide.tide_type === "virtual" && tide.stream_url && isLive && (
              <section aria-label="Stream">
                <h3>🎥 Live Stream</h3>
                <a href={tide.stream_url} target="_blank" rel="noopener noreferrer" className="btn btn--primary">
                  Watch Stream ↗
                </a>
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

        {activeTab === "map" && tide.gps_bounds && (
          <TideMap
            tideId={tideId}
            gpsBounds={tide.gps_bounds}
            attendees={attendees}
            isLive={isLive}
            onCheckIn={handleCheckIn}
          />
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
