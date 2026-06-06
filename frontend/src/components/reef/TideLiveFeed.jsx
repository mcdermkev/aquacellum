/**
 * TideLiveFeed.jsx
 * 
 * Real-time feed during active Tides via Supabase Realtime channel.
 * Renders: chat messages, check-in notifications, Poseidon narration, trade ticker.
 * Auto-scrolls with "New activity" floating button when paused.
 */

import { useRef, useEffect, useState } from "react";
import { useTideLiveFeed } from "../../hooks/useTides";
import { ProfileCard } from "./ProfileCard";

function LiveFeedItem({ item }) {
  switch (item.type) {
    case "chat":
      return (
        <div className="live-feed-item live-feed-item--chat">
          <div className="live-feed-item__author">
            {item.data.profile ? (
              <ProfileCard profile={item.data.profile} compact />
            ) : (
              <span className="live-feed-item__wallet">
                {item.data.author_wallet?.slice(0, 8)}…
              </span>
            )}
          </div>
          <p className="live-feed-item__body">{item.data.body}</p>
          <time className="live-feed-item__time">
            {new Date(item.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </time>
        </div>
      );

    case "narration":
      return (
        <div className="live-feed-item live-feed-item--narration" role="status">
          <span className="live-feed-item__narration-icon">🐙</span>
          <p className="live-feed-item__body">{item.data.body}</p>
          <time className="live-feed-item__time">
            {new Date(item.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </time>
        </div>
      );

    case "check_in":
      return (
        <div className="live-feed-item live-feed-item--checkin" role="status">
          <span>📍</span>
          <p>
            <strong>{item.data.wallet_address?.slice(0, 8)}…</strong> checked in!
          </p>
        </div>
      );

    case "trade":
      return (
        <div className="live-feed-item live-feed-item--trade" role="status">
          <span>🤝</span>
          <p>{item.data.description || "A trade just went through!"}</p>
        </div>
      );

    default:
      return null;
  }
}

export function TideLiveFeed({ tideId, enabled = true }) {
  const { feedItems, newItemCount, isPaused, pause, resume } = useTideLiveFeed(tideId, enabled);
  const scrollRef = useRef(null);
  const bottomRef = useRef(null);
  const [userScrolled, setUserScrolled] = useState(false);

  // Auto-scroll to bottom on new items (if not paused)
  useEffect(() => {
    if (!userScrolled && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [feedItems.length, userScrolled]);

  // Detect user scroll (pause auto-scroll)
  const handleScroll = () => {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 50;

    if (!isAtBottom && !userScrolled) {
      setUserScrolled(true);
      pause();
    } else if (isAtBottom && userScrolled) {
      setUserScrolled(false);
      resume();
    }
  };

  const scrollToBottom = () => {
    setUserScrolled(false);
    resume();
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  if (!enabled) {
    return (
      <div className="tide-live-feed tide-live-feed--disabled">
        <p className="text-muted">Live feed activates when the tide goes live.</p>
      </div>
    );
  }

  return (
    <section className="tide-live-feed" aria-label="Live Event Feed">
      {/* Activity burst indicator */}
      {feedItems.length > 0 && (
        <div className="tide-live-feed__status">
          <span className="pulse-dot" aria-hidden="true" />
          <span>Live — {feedItems.length} updates</span>
        </div>
      )}

      {/* Feed scroll area */}
      <div
        className="tide-live-feed__scroll"
        ref={scrollRef}
        onScroll={handleScroll}
        role="log"
        aria-live="polite"
        aria-label="Live activity stream"
      >
        {feedItems.length === 0 ? (
          <div className="tide-live-feed__empty">
            <p>🌊 Waiting for activity…</p>
            <p className="text-muted">Messages, check-ins, and trades will appear here in real time.</p>
          </div>
        ) : (
          feedItems.map((item) => <LiveFeedItem key={item.id} item={item} />)
        )}
        <div ref={bottomRef} />
      </div>

      {/* New activity button */}
      {userScrolled && newItemCount > 0 && (
        <button
          className="tide-live-feed__new-activity"
          onClick={scrollToBottom}
          aria-label={`${newItemCount} new updates — click to scroll down`}
        >
          ↓ {newItemCount} new update{newItemCount > 1 ? "s" : ""}
        </button>
      )}
    </section>
  );
}

export default TideLiveFeed;
