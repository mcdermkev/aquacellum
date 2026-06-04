/**
 * SchoolChat.jsx
 * 
 * Persistent real-time chat for school members.
 * Uses Supabase Realtime subscription for live updates.
 */

import React, { useState, useRef, useEffect, useCallback } from "react";
import { useSchoolChat } from "../../hooks/useSchoolChat";
import { getCurrentWallet } from "../../services/supabaseClient";

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

  return (
    <div style={{
      display: "flex",
      flexDirection: "column",
      height: "500px",
      maxHeight: "60vh",
      borderRadius: "var(--radius-sm)",
      overflow: "hidden",
      border: "1px solid rgba(255,255,255,0.08)",
    }}>
      {/* Connection Status */}
      <div style={{
        padding: "0.4rem 1rem",
        display: "flex",
        alignItems: "center",
        gap: "0.4rem",
        borderBottom: "1px solid rgba(255,255,255,0.06)",
        background: "rgba(0,0,0,0.2)",
      }}>
        <span style={{
          width: "6px",
          height: "6px",
          borderRadius: "50%",
          background: isConnected ? "var(--accent-green)" : "var(--accent-amber)",
          boxShadow: isConnected ? "0 0 4px var(--accent-green)" : "none",
        }} />
        <span style={{ fontSize: "0.65rem", color: "var(--text-muted)" }}>
          {isConnected ? "Connected" : "Connecting..."}
        </span>
        <span style={{ marginLeft: "auto", fontSize: "0.65rem", color: "var(--text-muted)" }}>
          {messages.length} messages
        </span>
      </div>

      {/* Messages */}
      <div
        ref={messagesContainerRef}
        onScroll={handleScroll}
        style={{
          flex: 1,
          overflow: "auto",
          padding: "1rem",
          display: "flex",
          flexDirection: "column",
          gap: "0.3rem",
        }}
      >
        {isLoading ? (
          <div style={{ textAlign: "center", color: "var(--text-muted)", fontSize: "0.8rem", padding: "2rem" }}>
            Loading chat...
          </div>
        ) : messages.length === 0 ? (
          <div style={{ textAlign: "center", color: "var(--text-muted)", fontSize: "0.8rem", padding: "2rem" }}>
            <div style={{ fontSize: "1.5rem", marginBottom: "0.5rem" }}>💬</div>
            <p>No messages yet. Start the conversation!</p>
          </div>
        ) : (
          messages.map((msg) => {
            const msgDate = formatDate(msg.created_at);
            const showDateSeparator = msgDate !== lastDate;
            lastDate = msgDate;
            const isOwn = msg.author_wallet === currentWallet;
            const profile = msg.profile;

            return (
              <React.Fragment key={msg.id}>
                {showDateSeparator && (
                  <div style={{
                    textAlign: "center",
                    fontSize: "0.6rem",
                    color: "var(--text-muted)",
                    padding: "0.5rem 0",
                    margin: "0.5rem 0",
                  }}>
                    — {msgDate} —
                  </div>
                )}
                <div style={{
                  display: "flex",
                  flexDirection: isOwn ? "row-reverse" : "row",
                  alignItems: "flex-end",
                  gap: "0.5rem",
                }}>
                  {/* Avatar */}
                  {!isOwn && (
                    <div style={{
                      width: "24px",
                      height: "24px",
                      borderRadius: "50%",
                      background: profile?.avatar_url
                        ? `url(${profile.avatar_url}) center/cover`
                        : "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
                      flexShrink: 0,
                    }} />
                  )}

                  {/* Bubble */}
                  <div style={{
                    maxWidth: "75%",
                    padding: "0.5rem 0.8rem",
                    borderRadius: isOwn ? "12px 12px 4px 12px" : "12px 12px 12px 4px",
                    background: isOwn
                      ? "rgba(56, 189, 248, 0.15)"
                      : "rgba(255,255,255,0.06)",
                    border: `1px solid ${isOwn ? "rgba(56, 189, 248, 0.2)" : "rgba(255,255,255,0.06)"}`,
                    position: "relative",
                  }}>
                    {!isOwn && (
                      <div style={{ fontSize: "0.6rem", color: "var(--accent-blue)", fontWeight: "600", marginBottom: "0.2rem" }}>
                        {profile?.display_name || `${msg.author_wallet.slice(0, 6)}...`}
                      </div>
                    )}
                    <div style={{ fontSize: "0.8rem", color: "#fff", lineHeight: "1.4", wordBreak: "break-word" }}>
                      {msg.body}
                    </div>
                    <div style={{ fontSize: "0.55rem", color: "var(--text-muted)", marginTop: "0.2rem", textAlign: isOwn ? "left" : "right" }}>
                      {formatTime(msg.created_at)}
                    </div>

                    {/* Admin delete */}
                    {isAdmin && !isOwn && (
                      <button
                        onClick={() => deleteMessage(msg.id)}
                        style={{
                          position: "absolute",
                          top: "0.25rem",
                          right: "0.25rem",
                          background: "none",
                          border: "none",
                          color: "var(--accent-red)",
                          fontSize: "0.6rem",
                          cursor: "pointer",
                          opacity: 0.5,
                        }}
                        title="Delete message"
                      >
                        🗑
                      </button>
                    )}
                  </div>
                </div>
              </React.Fragment>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Scroll-to-bottom button */}
      {!isAtBottom && messages.length > 0 && (
        <button
          onClick={() => {
            messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
            setIsAtBottom(true);
          }}
          style={{
            position: "absolute",
            bottom: "70px",
            left: "50%",
            transform: "translateX(-50%)",
            padding: "0.3rem 0.8rem",
            borderRadius: "50px",
            background: "rgba(56, 189, 248, 0.2)",
            border: "1px solid rgba(56, 189, 248, 0.3)",
            color: "#fff",
            fontSize: "0.65rem",
            cursor: "pointer",
          }}
        >
          ↓ New messages
        </button>
      )}

      {/* Input */}
      <div style={{
        display: "flex",
        gap: "0.5rem",
        padding: "0.75rem 1rem",
        borderTop: "1px solid rgba(255,255,255,0.06)",
        background: "rgba(0,0,0,0.15)",
      }}>
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value.slice(0, 500))}
          onKeyDown={handleKeyDown}
          placeholder="Type a message..."
          maxLength={500}
          style={{
            flex: 1,
            padding: "0.6rem 1rem",
            background: "rgba(255,255,255,0.04)",
            border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: "50px",
            color: "#fff",
            fontSize: "0.8rem",
            outline: "none",
          }}
        />
        <button
          onClick={handleSend}
          disabled={!input.trim() || isSending}
          style={{
            padding: "0.6rem 1rem",
            borderRadius: "50px",
            border: "none",
            background: input.trim() ? "var(--accent-blue)" : "rgba(255,255,255,0.08)",
            color: input.trim() ? "#fff" : "var(--text-muted)",
            fontSize: "0.8rem",
            cursor: input.trim() ? "pointer" : "default",
            transition: "all 0.2s ease",
          }}
          aria-label="Send message"
        >
          {isSending ? "..." : "→"}
        </button>
      </div>
    </div>
  );
}
