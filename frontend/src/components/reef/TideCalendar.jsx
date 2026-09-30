/**
 * TideCalendar.jsx
 *
 * The Events tab (events are "tides" in the data model). Upcoming events come
 * first, soonest at the top, then a separate "Past events" section. Each card
 * has a date block, title, type, host, and an RSVP where the event allows one.
 * Events whose end time has passed are listed as past even if their status was
 * never moved on (see reefEvents.js). No counts are shown that the data doesn't
 * carry.
 */

import { useState, useEffect, useMemo } from "react";
import { MapPin, VideoCamera, Trophy, Gavel, Clock, UsersThree, CalendarBlank } from "@phosphor-icons/react";
import { useUpcomingTides, usePastTides, useMyTides, useRsvp } from "../../hooks/useTides";
import { useSchoolById } from "../../hooks/useSchools";
import { splitEvents } from "./reefEvents";
import "./ReefDaylight.css";

const TIDE_TYPE_LABELS = {
  expo: { label: "Expo", Icon: MapPin },
  virtual: { label: "Virtual", Icon: VideoCamera },
  challenge: { label: "Challenge", Icon: Trophy },
  auction: { label: "Auction", Icon: Gavel },
};

function CountdownTimer({ targetTime }) {
  const [timeLeft, setTimeLeft] = useState("");

  useEffect(() => {
    function update() {
      const diff = new Date(targetTime).getTime() - Date.now();
      if (diff <= 0) {
        setTimeLeft("Starting now");
        return;
      }
      const days = Math.floor(diff / (1000 * 60 * 60 * 24));
      const hours = Math.floor((diff / (1000 * 60 * 60)) % 24);
      const minutes = Math.floor((diff / (1000 * 60)) % 60);
      if (days > 0) setTimeLeft(`Starts in ${days}d ${hours}h`);
      else if (hours > 0) setTimeLeft(`Starts in ${hours}h ${minutes}m`);
      else setTimeLeft(`Starts in ${minutes}m`);
    }
    update();
    const interval = setInterval(update, 60000);
    return () => clearInterval(interval);
  }, [targetTime]);

  return <span className="tide-countdown">{timeLeft}</span>;
}

function DateBlock({ iso }) {
  const d = new Date(iso);
  const showYear = d.getFullYear() !== new Date().getFullYear();
  return (
    <div className="reef-date" aria-hidden="true">
      <span className="reef-date-month">{d.toLocaleDateString(undefined, { month: "short" })}</span>
      <span className="reef-date-day">{d.getDate()}</span>
      {showYear && <span className="reef-date-year">{d.getFullYear()}</span>}
    </div>
  );
}

function HostLine({ tide }) {
  const { data: clubResult } = useSchoolById(tide.host_school_id || null);
  const clubName = clubResult?.data?.name;
  const person = tide.host_profile?.display_name;
  if (clubName) return <span><UsersThree size={15} aria-hidden="true" /> Hosted by {clubName}</span>;
  if (person) return <span>Hosted by {person}</span>;
  return null;
}

function formatWhen(tide) {
  const start = new Date(tide.start_time);
  const opts = { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" };
  const startText = start.toLocaleString(undefined, opts);
  if (!tide.end_time) return startText;
  const end = new Date(tide.end_time);
  const endText = start.toDateString() === end.toDateString()
    ? end.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
    : end.toLocaleString(undefined, opts);
  return `${startText} to ${endText}`;
}

function TideCard({ tide, onSelect, past = false, going = false, signedIn, onRequireSignIn }) {
  const typeInfo = TIDE_TYPE_LABELS[tide.tide_type] || TIDE_TYPE_LABELS.expo;
  const TypeIcon = typeInfo.Icon;
  const isLive = !past && tide.status === "live";

  // The RSVP mutation lives on the card, not the calendar, because useRsvp is
  // scoped to a single tide id. (An earlier version labelled a navigation link
  // "RSVP"; this one really RSVPs.)
  const rsvpMutation = useRsvp(tide.id);
  const [rsvpError, setRsvpError] = useState(null);
  const [rsvpDone, setRsvpDone] = useState(false);

  const handleRsvpClick = () => {
    if (!signedIn) return onRequireSignIn?.();
    setRsvpError(null);
    rsvpMutation.mutate("going", {
      onSuccess: (res) => {
        if (res?.error) setRsvpError(typeof res.error === "string" ? res.error : res.error.message);
        else setRsvpDone(true);
      },
      onError: (err) => setRsvpError(err?.message || "Couldn't RSVP"),
    });
  };

  const alreadyGoing = going || rsvpDone || !!tide.my_rsvp;

  return (
    <li className={`reef-event ${past ? "reef-event--past" : ""} ${isLive ? "reef-event--live" : ""}`}>
      <DateBlock iso={tide.start_time} />
      <div className="reef-event-main">
        <button type="button" className="reef-event-open" onClick={() => onSelect(tide.id)}>
          <h4 className="reef-event-title">{tide.title}</h4>
        </button>
        <div className="reef-event-meta">
          <span><TypeIcon size={15} aria-hidden="true" /> {typeInfo.label}</span>
          {isLive && <span style={{ color: "var(--accent-red)", fontWeight: 700 }}><span className="reef-live-dot" aria-hidden="true" /> Live now</span>}
          <span><Clock size={15} aria-hidden="true" /> <time dateTime={tide.start_time}>{formatWhen(tide)}</time></span>
          <HostLine tide={tide} />
          {tide.attendee_count !== undefined && (
            <span>{tide.attendee_count} going</span>
          )}
        </div>
        {tide.description && (
          <p className="reef-event-desc">
            {tide.description.length > 140 ? tide.description.slice(0, 140) + "…" : tide.description}
          </p>
        )}
        <div className="reef-event-actions">
          {!past && !isLive && <span className="reef-section-sub" style={{ margin: 0 }}><CountdownTimer targetTime={tide.start_time} /></span>}
          {!past && (alreadyGoing ? (
            <span className="reef-event-status">
              {tide.my_rsvp === "checked_in" ? "Checked in" : "You're going"}
            </span>
          ) : (
            <button type="button" className="reef-btn reef-btn--sm reef-btn--primary" onClick={handleRsvpClick} disabled={rsvpMutation.isPending}>
              {rsvpMutation.isPending ? "Saving…" : signedIn ? "RSVP" : "Sign in to RSVP"}
            </button>
          ))}
          <button type="button" className="reef-btn reef-btn--sm" onClick={() => onSelect(tide.id)}>
            {past ? "View event" : "Details"}
          </button>
          {rsvpError && <span className="reef-event-error" role="alert">{rsvpError}</span>}
        </div>
      </div>
    </li>
  );
}

export function TideCalendar({ onSelectTide, signedIn = false, onRequireSignIn, onHost = null }) {
  const [filterType, setFilterType] = useState(null);

  const { data: upcomingRows = [], isLoading } = useUpcomingTides({ tideType: filterType });
  const { data: pastRows = [], isLoading: pastLoading } = usePastTides();
  const { data: myTides = [] } = useMyTides();

  const myIds = useMemo(() => new Set(myTides.map((t) => t.id)), [myTides]);
  const { upcoming, past } = useMemo(() => {
    const typed = (rows) => (filterType ? rows.filter((t) => t.tide_type === filterType) : rows);
    return splitEvents(typed(upcomingRows), typed(pastRows));
  }, [upcomingRows, pastRows, filterType]);

  const cardProps = { onSelect: onSelectTide, signedIn, onRequireSignIn };

  return (
    <section className="reef-events" aria-label="Events">
      <div className="reef-filters" role="group" aria-label="Event type" style={{ marginBottom: 0 }}>
        <button type="button" className="reef-filter" aria-pressed={filterType === null} onClick={() => setFilterType(null)}>
          All
        </button>
        {Object.entries(TIDE_TYPE_LABELS).map(([key, { label }]) => (
          <button key={key} type="button" className="reef-filter" aria-pressed={filterType === key} onClick={() => setFilterType(key)}>
            {label}
          </button>
        ))}
      </div>

      <section aria-labelledby="reef-upcoming-events">
        <h3 id="reef-upcoming-events" className="reef-section-title" style={{ marginBottom: "0.8rem" }}>Upcoming events</h3>
        {isLoading ? (
          <div className="reef-event-list" aria-busy="true">
            {[1, 2].map((i) => <div key={i} className="reef-skeleton" style={{ height: 110 }} />)}
          </div>
        ) : upcoming.length === 0 ? (
          <div className="reef-empty reef-empty--flat">
            <span className="reef-empty-icon"><CalendarBlank size={24} aria-hidden="true" /></span>
            <h3 className="reef-empty-title">No upcoming events right now</h3>
            <p className="reef-empty-lead">
              {filterType
                ? "Nothing of this type is planned. Try All to see every event."
                : "When a club or member plans a meetup, a virtual hangout or a challenge, it shows up here."}
            </p>
            {onHost && !filterType && (
              <div className="reef-empty-actions">
                <button type="button" className="reef-btn reef-btn--primary" onClick={onHost}>Host an event</button>
              </div>
            )}
          </div>
        ) : (
          <ul className="reef-event-list">
            {upcoming.map((tide) => (
              <TideCard key={tide.id} tide={tide} going={myIds.has(tide.id)} {...cardProps} />
            ))}
          </ul>
        )}
      </section>

      <section className="reef-past-head" aria-labelledby="reef-past-events">
        <h3 id="reef-past-events" className="reef-section-title" style={{ marginBottom: "0.2rem" }}>Past events</h3>
        <p className="reef-section-sub" style={{ marginBottom: "0.8rem" }}>Events that have already finished, newest first.</p>
        {pastLoading ? (
          <div className="reef-skeleton" style={{ height: 90, maxWidth: 760 }} />
        ) : past.length === 0 ? (
          <p className="reef-panel-note">No past events yet.</p>
        ) : (
          <ul className="reef-event-list">
            {past.map((tide) => (
              <TideCard key={tide.id} tide={tide} past {...cardProps} />
            ))}
          </ul>
        )}
      </section>
    </section>
  );
}

export default TideCalendar;
