/**
 * TideCalendar.jsx
 * 
 * Grid/list view of upcoming Tides sorted by start_time.
 * Features: filter by type/school, RSVP, countdown timers, "My Tides" section.
 */

import { useState, useEffect } from "react";
import { useUpcomingTides, useMyTides, useRsvp } from "../../hooks/useTides";
import { ProfileCard } from "./ProfileCard";

const TIDE_TYPE_LABELS = {
  expo: { label: "Expo", icon: "📍", color: "#10b981" },
  virtual: { label: "Virtual", icon: "🎥", color: "#6366f1" },
  challenge: { label: "Challenge", icon: "🏆", color: "#f59e0b" },
  auction: { label: "Auction", icon: "🔨", color: "#ef4444" },
};

function CountdownTimer({ targetTime }) {
  const [timeLeft, setTimeLeft] = useState("");

  useEffect(() => {
    function update() {
      const now = Date.now();
      const target = new Date(targetTime).getTime();
      const diff = target - now;

      if (diff <= 0) {
        setTimeLeft("Starting now!");
        return;
      }

      const days = Math.floor(diff / (1000 * 60 * 60 * 24));
      const hours = Math.floor((diff / (1000 * 60 * 60)) % 24);
      const minutes = Math.floor((diff / (1000 * 60)) % 60);

      if (days > 0) {
        setTimeLeft(`${days}d ${hours}h`);
      } else if (hours > 0) {
        setTimeLeft(`${hours}h ${minutes}m`);
      } else {
        setTimeLeft(`${minutes}m`);
      }
    }

    update();
    const interval = setInterval(update, 60000);
    return () => clearInterval(interval);
  }, [targetTime]);

  return <span className="tide-countdown">{timeLeft}</span>;
}

function TideCard({ tide, onSelect, onRsvp }) {
  const typeInfo = TIDE_TYPE_LABELS[tide.tide_type] || TIDE_TYPE_LABELS.expo;
  const isLive = tide.status === "live";
  const startDate = new Date(tide.start_time);

  return (
    <article
      className={`tide-card ${isLive ? "tide-card--live" : ""}`}
      onClick={() => onSelect(tide.id)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === "Enter" && onSelect(tide.id)}
      aria-label={`${tide.title} — ${typeInfo.label} tide`}
    >
      {tide.banner_url && (
        <div className="tide-card__banner">
          <img src={tide.banner_url} alt="" loading="lazy" />
          {isLive && <span className="tide-card__live-badge">🔴 LIVE</span>}
        </div>
      )}

      <div className="tide-card__content">
        <div className="tide-card__header">
          <span
            className="tide-card__type-badge"
            style={{ backgroundColor: typeInfo.color }}
          >
            {typeInfo.icon} {typeInfo.label}
          </span>
          {!isLive && <CountdownTimer targetTime={tide.start_time} />}
        </div>

        <h3 className="tide-card__title">{tide.title}</h3>

        {tide.description && (
          <p className="tide-card__desc">
            {tide.description.length > 100
              ? tide.description.slice(0, 100) + "…"
              : tide.description}
          </p>
        )}

        <div className="tide-card__meta">
          <time dateTime={tide.start_time}>
            {startDate.toLocaleDateString(undefined, {
              weekday: "short",
              month: "short",
              day: "numeric",
              hour: "numeric",
              minute: "2-digit",
            })}
          </time>
          {tide.attendee_count !== undefined && (
            <span className="tide-card__attendees">
              👥 {tide.attendee_count}
            </span>
          )}
        </div>

        {tide.host_profile && (
          <div className="tide-card__host">
            <ProfileCard profile={tide.host_profile} compact />
          </div>
        )}

        <div className="tide-card__actions">
          {tide.my_rsvp ? (
            <span className="tide-card__rsvp-status">
              ✓ {tide.my_rsvp === "checked_in" ? "Checked In" : "Going"}
            </span>
          ) : (
            <button
              className="btn btn--sm btn--primary"
              onClick={(e) => {
                e.stopPropagation();
                onRsvp(tide.id, "going");
              }}
            >
              RSVP
            </button>
          )}
        </div>
      </div>
    </article>
  );
}

export function TideCalendar({ onSelectTide }) {
  const [filterType, setFilterType] = useState(null);
  const [viewMode, setViewMode] = useState("grid"); // grid | list

  const { data: upcomingTides = [], isLoading } = useUpcomingTides({
    tideType: filterType,
  });
  const { data: myTides = [] } = useMyTides();

  // Inline RSVP mutation — we call at card level
  const handleRsvp = async (tideId, status) => {
    // Delegate to TidePage for full RSVP flow
    if (onSelectTide) onSelectTide(tideId);
  };

  const myUpcoming = myTides.filter(
    (t) => t.status === "upcoming" || t.status === "live"
  );

  return (
    <section className="tide-calendar" aria-label="Tides Events Calendar">
      {/* Header */}
      <header className="tide-calendar__header">
        <h2>🌊 Tides</h2>
        <div className="tide-calendar__controls">
          {/* Type filter */}
          <div className="tide-calendar__filters" role="tablist" aria-label="Filter by type">
            <button
              role="tab"
              aria-selected={filterType === null}
              className={`filter-chip ${filterType === null ? "filter-chip--active" : ""}`}
              onClick={() => setFilterType(null)}
            >
              All
            </button>
            {Object.entries(TIDE_TYPE_LABELS).map(([key, { label, icon }]) => (
              <button
                key={key}
                role="tab"
                aria-selected={filterType === key}
                className={`filter-chip ${filterType === key ? "filter-chip--active" : ""}`}
                onClick={() => setFilterType(key)}
              >
                {icon} {label}
              </button>
            ))}
          </div>

          {/* View toggle */}
          <div className="tide-calendar__view-toggle">
            <button
              className={viewMode === "grid" ? "active" : ""}
              onClick={() => setViewMode("grid")}
              aria-label="Grid view"
              title="Grid view"
            >
              ▦
            </button>
            <button
              className={viewMode === "list" ? "active" : ""}
              onClick={() => setViewMode("list")}
              aria-label="List view"
              title="List view"
            >
              ☰
            </button>
          </div>
        </div>
      </header>

      {/* My Upcoming Tides */}
      {myUpcoming.length > 0 && (
        <section className="tide-calendar__my-tides" aria-label="My Upcoming Tides">
          <h3>My Upcoming Tides</h3>
          <div className="tide-calendar__my-tides-list">
            {myUpcoming.map((tide) => (
              <TideCard
                key={tide.id}
                tide={tide}
                onSelect={onSelectTide}
                onRsvp={handleRsvp}
              />
            ))}
          </div>
        </section>
      )}

      {/* All Upcoming */}
      <section aria-label="All Upcoming Tides">
        {isLoading ? (
          <div className="tide-calendar__loading">
            {[1, 2, 3].map((i) => (
              <div key={i} className="tide-card tide-card--skeleton" aria-hidden="true">
                <div className="skeleton-banner" />
                <div className="skeleton-text" />
                <div className="skeleton-text skeleton-text--short" />
              </div>
            ))}
          </div>
        ) : upcomingTides.length === 0 ? (
          <div className="tide-calendar__empty">
            <p>🌊 No upcoming tides.</p>
            <p className="tide-calendar__empty-sub">
              Check back soon or create one from your School.
            </p>
          </div>
        ) : (
          <div className={`tide-calendar__grid tide-calendar__grid--${viewMode}`}>
            {upcomingTides.map((tide) => (
              <TideCard
                key={tide.id}
                tide={tide}
                onSelect={onSelectTide}
                onRsvp={handleRsvp}
              />
            ))}
          </div>
        )}
      </section>
    </section>
  );
}

export default TideCalendar;
