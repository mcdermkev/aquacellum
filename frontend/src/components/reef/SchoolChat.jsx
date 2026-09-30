/**
 * SchoolChat.jsx
 * 
 * Persistent real-time chat for school members.
 * Uses Supabase Realtime subscription for live updates.
 */

import React, { useState, useRef, useEffect, useCallback } from "react";
import { useSchoolChat } from "../../hooks/useSchoolChat";
import { getCurrentWallet } from "../../services/supabaseClient";
import { sameWallet } from "../../utils/wallet";

export function SchoolChat({ schoolId, isAdmin }) {
  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const messagesEndRef = useRef(null);
  const messagesContainerRef = useRef(null);
  const [isAtBottom, setIsAtBottom] = useState(true);

  const { messages, isLoading, isConnected, send, deleteMessage } = useSchoolChat(schoolId);
  const currentWallet = getCurrentWallet();

  // Scroll to bottom on new messages (if user is at bottom)
  useEffect(() => {
    if (isAtBottom && messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages.length, isAtBottom]);

  // Track scroll position
  const handleScroll = useCallback(() => {
    const container = messagesContainerRef.current;
    if (!container) return;
    const { scrollTop, scrollHeight, clientHeight } = container;
    setIsAtBottom(scrollHeight - scrollTop - clientHeight < 50);
  }, []);

  const handleSend = async () => {
    if (!input.trim() || isSending) return;
    
    const body = input.trim();
    if (body.length > 500) return;

    setIsSending(true);
    setInput("");
    await send(body);
    setIsSending(false);
    setIsAtBottom(true);
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const formatTime = (dateStr) => {
    const d = new Date(dateStr);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };

  const formatDate = (dateStr) => {
    const d = new Date(dateStr);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    if (d.toDateString() === today.toDateString()) return "Today";
    if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
    return d.toLocaleDateString([], { month: "short", day: "numeric" });
  };

  // Group messages by date
  let lastDate = "";
  const countLabel = `${messages.length} ${messages.length === 1 ? "message" : "messages"}`;

  return (
    <section className="reef-chat" aria-label="Club chat">
      <div className="reef-chat-status">
        <span className={`reef-chat-dot ${isConnected ? "is-live" : ""}`} aria-hidden="true" />
        <span>{isConnected ? "Live" : "Connecting…"}</span>
        <span className="reef-chat-count">{countLabel}</span>
      </div>

      <div
        ref={messagesContainerRef}
        onScroll={handleScroll}
        className="reef-chat-log"
        role="log"
        aria-live="polite"
        aria-relevant="additions"
      >
        {isLoading ? (
          <p className="reef-chat-empty">Loading chat…</p>
        ) : messages.length === 0 ? (
          <div className="reef-chat-empty">
            <strong>No messages yet.</strong>
            <span>Members can chat here. Say hello or ask the club a question.</span>
          </div>
        ) : (
          messages.map((msg) => {
            const msgDate = formatDate(msg.created_at);
            const showDateSeparator = msgDate !== lastDate;
            lastDate = msgDate;
            const isOwn = sameWallet(msg.author_wallet, currentWallet);
            const profile = msg.profile;
            const name = profile?.display_name || `${String(msg.author_wallet || "").slice(0, 6)}…`;

            return (
              <React.Fragment key={msg.id}>
                {showDateSeparator && <div className="reef-chat-date"><span>{msgDate}</span></div>}
                <div className={`reef-chat-row ${isOwn ? "is-own" : ""}`}>
                  {!isOwn && (
                    <span className="reef-chat-avatar" aria-hidden="true">
                      {profile?.avatar_url ? <img src={profile.avatar_url} alt="" /> : name.charAt(0).toUpperCase()}
                    </span>
                  )}
                  <div className="reef-chat-bubble">
                    {!isOwn && <span className="reef-chat-name">{name}</span>}
                    <p className="reef-chat-text">{msg.body}</p>
                    <span className="reef-chat-time">{formatTime(msg.created_at)}</span>
                  </div>
                  {isAdmin && !isOwn && (
                    <button
                      type="button"
                      className="reef-chat-delete"
                      onClick={() => deleteMessage(msg.id)}
                      aria-label={`Delete message from ${name}`}
                      title="Delete message"
                    >
                      Delete
                    </button>
                  )}
                </div>
              </React.Fragment>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {!isAtBottom && messages.length > 0 && (
        <button
          type="button"
          className="reef-btn reef-btn--sm reef-chat-jump"
          onClick={() => {
            messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
            setIsAtBottom(true);
          }}
        >
          Jump to newest
        </button>
      )}

      <form
        className="reef-chat-input"
        onSubmit={(e) => { e.preventDefault(); handleSend(); }}
      >
        <label htmlFor={`club-chat-${schoolId}`} className="reef-sr-only">Message the club</label>
        <input
          id={`club-chat-${schoolId}`}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value.slice(0, 500))}
          onKeyDown={handleKeyDown}
          placeholder="Write a message"
          maxLength={500}
          autoComplete="off"
        />
        <button type="submit" className="reef-btn reef-btn--primary" disabled={!input.trim() || isSending} aria-busy={isSending}>
          {isSending ? "Sending…" : "Send"}
        </button>
      </form>
    </section>
  );
}
