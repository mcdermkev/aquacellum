/**
 * ConversationView.jsx
 * 
 * Full message thread view between two users.
 * Shows message bubbles with timestamps, input bar at bottom.
 * Marks conversation as read on open.
 */

import React, { useState, useRef, useEffect } from "react";
import { useConversationMessages, useSendMessage, useMarkConversationRead } from "../../hooks/useMessages";
import { getCurrentWallet } from "../../services/supabaseClient";
import { ProfileCard } from "./ProfileCard";

function timeAgo(dateString) {
  const now = new Date();
  const date = new Date(dateString);
  const diff = Math.floor((now - date) / 1000);
  if (diff < 60) return "now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function ConversationView({ conversationId, otherWallet, otherProfile, onBack }) {
  const { messages, isLoading } = useConversationMessages(conversationId);
  const sendMutation = useSendMessage();
  const markRead = useMarkConversationRead();
  const [input, setInput] = useState("");
  const messagesEndRef = useRef(null);
  const walletAddress = getCurrentWallet();

  // Mark as read on open
  useEffect(() => {
    if (conversationId) {
      markRead.mutate(conversationId);
    }
  }, [conversationId]);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  const handleSend = async (e) => {
    e.preventDefault();
    if (!input.trim() || sendMutation.isPending) return;

    const body = input.trim();
    setInput("");

    await sendMutation.mutateAsync({ conversationId, body });
  };

  return (
    <div style={{
      display: "flex",
      flexDirection: "column",
      height: "100%",
      minHeight: "400px",
      maxHeight: "70vh",
    }}>
      {/* Header */}
      <div style={{
        display: "flex",
        alignItems: "center",
        gap: "0.5rem",
        padding: "0.75rem 1rem",
        borderBottom: "1px solid rgba(255, 255, 255, 0.06)",
        flexShrink: 0,
      }}>
        <button
          onClick={onBack}
          style={{
            background: "none",
            border: "none",
            color: "var(--text-muted)",
            fontSize: "0.85rem",
            cursor: "pointer",
            padding: "0.25rem",
          }}
        >
          ←
        </button>
        {otherProfile ? (
          <ProfileCard
            walletAddress={otherProfile.wallet_address}
            displayName={otherProfile.display_name}
            avatarUrl={otherProfile.avatar_url}
            companionTier={otherProfile.companion_tier}
            compact
          />
        ) : (
          <span style={{ fontSize: "0.8rem", color: "#fff" }}>
            {otherWallet?.slice(0, 8)}…
          </span>
        )}
      </div>

      {/* Messages */}
      <div style={{
        flex: 1,
        overflowY: "auto",
        padding: "1rem",
        display: "flex",
        flexDirection: "column",
        gap: "0.5rem",
      }}>
        {isLoading && (
          <p style={{ textAlign: "center", color: "var(--text-muted)", fontSize: "0.75rem" }}>
            Loading messages…
          </p>
        )}

        {!isLoading && messages.length === 0 && (
          <div style={{ textAlign: "center", padding: "2rem 0", color: "var(--text-muted)" }}>
            <p style={{ fontSize: "1.5rem", margin: "0 0 0.5rem" }}>💬</p>
            <p style={{ fontSize: "0.8rem", margin: 0 }}>No messages yet. Say hi!</p>
          </div>
        )}

        {messages.map((msg) => {
          const isOwn = msg.sender_wallet === walletAddress;
          return (
            <div
              key={msg.id}
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: isOwn ? "flex-end" : "flex-start",
                maxWidth: "80%",
                alignSelf: isOwn ? "flex-end" : "flex-start",
              }}
            >
              <div style={{
                padding: "0.5rem 0.75rem",
                borderRadius: isOwn ? "12px 12px 4px 12px" : "12px 12px 12px 4px",
                background: isOwn
                  ? "linear-gradient(135deg, rgba(14, 165, 233, 0.2), rgba(3, 105, 161, 0.15))"
                  : "rgba(255, 255, 255, 0.04)",
                border: isOwn
                  ? "1px solid rgba(14, 165, 233, 0.2)"
                  : "1px solid rgba(255, 255, 255, 0.06)",
                maxWidth: "100%",
              }}>
                <p style={{
                  margin: 0,
                  fontSize: "0.82rem",
                  color: "#e5e7eb",
                  lineHeight: "1.5",
                  wordBreak: "break-word",
                  whiteSpace: "pre-wrap",
                }}>
                  {msg.body}
                </p>
              </div>
              <span style={{
                fontSize: "0.55rem",
                color: "var(--text-muted)",
                marginTop: "0.15rem",
                padding: "0 0.25rem",
              }}>
                {timeAgo(msg.created_at)}
              </span>
            </div>
          );
        })}
        <div ref={messagesEndRef} />
      </div>

      {/* Input bar */}
      <form
        onSubmit={handleSend}
        style={{
          display: "flex",
          gap: "0.5rem",
          padding: "0.75rem 1rem",
          borderTop: "1px solid rgba(255, 255, 255, 0.06)",
          flexShrink: 0,
        }}
      >
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value.slice(0, 2000))}
          placeholder="Type a message…"
          style={{
            flex: 1,
            padding: "0.55rem 0.75rem",
            borderRadius: "50px",
            border: "1px solid rgba(255, 255, 255, 0.08)",
            background: "rgba(255, 255, 255, 0.03)",
            color: "#fff",
            fontSize: "0.82rem",
            outline: "none",
            transition: "border-color 0.15s ease",
          }}
          onFocus={(e) => { e.target.style.borderColor = "rgba(56, 189, 248, 0.3)"; }}
          onBlur={(e) => { e.target.style.borderColor = "rgba(255, 255, 255, 0.08)"; }}
          aria-label="Message input"
        />
        <button
          type="submit"
          disabled={!input.trim() || sendMutation.isPending}
          style={{
            padding: "0.55rem 1rem",
            borderRadius: "50px",
            border: "none",
            background: input.trim()
              ? "linear-gradient(135deg, #0ea5e9, #0369a1)"
              : "rgba(255, 255, 255, 0.05)",
            color: input.trim() ? "#fff" : "var(--text-muted)",
            fontSize: "0.8rem",
            fontWeight: 600,
            cursor: input.trim() ? "pointer" : "default",
            transition: "all 0.15s ease",
          }}
        >
          Send
        </button>
      </form>
    </div>
  );
}

export default ConversationView;
