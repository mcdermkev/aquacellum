/**
 * MessagesPanel.jsx
 * 
 * Messages icon + dropdown showing conversation list with unread badges.
 * Clicking a conversation opens the ConversationView.
 * Similar pattern to SonarBell.
 */

import React, { useState, useRef, useEffect } from "react";
import { useConversations, useUnreadDMCount } from "../../hooks/useMessages";
import { isSupabaseConfigured } from "../../services/supabaseClient";
import { ConversationView } from "./ConversationView";
import { ProfileCard } from "./ProfileCard";

function timeAgo(dateString) {
  if (!dateString) return "";
  const now = new Date();
  const date = new Date(dateString);
  const seconds = Math.floor((now - date) / 1000);
  if (seconds < 60) return "now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}

export function MessagesPanel() {
  const [isOpen, setIsOpen] = useState(false);
  const [activeConvo, setActiveConvo] = useState(null); // { id, otherWallet, otherProfile }
  const dropdownRef = useRef(null);
  const configured = isSupabaseConfigured();

  const { data: unreadCount = 0 } = useUnreadDMCount(configured);
  const { data: conversations = [] } = useConversations(configured && isOpen);

  // Close dropdown on outside click
  useEffect(() => {
    if (!isOpen) return;
    const handleClick = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setIsOpen(false);
        setActiveConvo(null);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [isOpen]);

  if (!configured) return null;

  return (
    <div style={{ position: "relative" }} ref={dropdownRef}>
      {/* Messages icon button */}
      <button
        onClick={() => { setIsOpen(!isOpen); setActiveConvo(null); }}
        style={{
          position: "relative",
          width: "34px",
          height: "34px",
          borderRadius: "50%",
          border: "1px solid rgba(255, 255, 255, 0.08)",
          background: isOpen ? "rgba(56, 189, 248, 0.1)" : "rgba(255, 255, 255, 0.03)",
          color: isOpen ? "#38bdf8" : "var(--text-muted)",
          fontSize: "1rem",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          transition: "all 0.15s ease",
        }}
        aria-label={`Messages${unreadCount > 0 ? ` (${unreadCount} unread)` : ""}`}
      >
        💬
        {unreadCount > 0 && (
          <span style={{
            position: "absolute",
            top: "-2px",
            right: "-2px",
            width: "16px",
            height: "16px",
            borderRadius: "50%",
            background: "#ef4444",
            color: "#fff",
            fontSize: "0.55rem",
            fontWeight: 700,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            border: "2px solid rgba(15, 23, 42, 0.95)",
          }}>
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown panel */}
      {isOpen && (
        <div style={{
          position: "absolute",
          top: "100%",
          right: 0,
          marginTop: "0.5rem",
          width: "320px",
          maxHeight: "420px",
          background: "rgba(15, 23, 42, 0.97)",
          border: "1px solid rgba(255, 255, 255, 0.08)",
          borderRadius: "12px",
          boxShadow: "0 16px 48px rgba(0, 0, 0, 0.5)",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          zIndex: 1000,
        }}>
          {/* Active conversation view */}
          {activeConvo ? (
            <ConversationView
              conversationId={activeConvo.id}
              otherWallet={activeConvo.otherWallet}
              otherProfile={activeConvo.otherProfile}
              onBack={() => setActiveConvo(null)}
            />
          ) : (
            <>
              {/* Header */}
              <div style={{
                padding: "0.75rem 1rem",
                borderBottom: "1px solid rgba(255, 255, 255, 0.05)",
                fontWeight: 600,
                fontSize: "0.8rem",
                color: "#fff",
              }}>
                Messages
              </div>

              {/* Conversation list */}
              <div style={{ flex: 1, overflowY: "auto" }}>
                {conversations.length === 0 ? (
                  <div style={{ padding: "2rem 1rem", textAlign: "center" }}>
                    <p style={{ fontSize: "1.5rem", margin: "0 0 0.5rem" }}>💬</p>
                    <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", margin: 0 }}>
                      No conversations yet
                    </p>
                    <p style={{ fontSize: "0.65rem", color: "var(--text-muted)", margin: "0.25rem 0 0" }}>
                      Message a Tankmate from their profile!
                    </p>
                  </div>
                ) : (
                  conversations.map((convo) => (
                    <button
                      key={convo.id}
                      onClick={() => setActiveConvo({
                        id: convo.id,
                        otherWallet: convo.otherWallet,
                        otherProfile: convo.otherProfile,
                      })}
                      style={{
                        width: "100%",
                        padding: "0.65rem 1rem",
                        background: convo.myUnread > 0
                          ? "rgba(56, 189, 248, 0.04)"
                          : "transparent",
                        border: "none",
                        borderBottom: "1px solid rgba(255, 255, 255, 0.03)",
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        gap: "0.6rem",
                        textAlign: "left",
                        transition: "background 0.1s ease",
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.03)"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = convo.myUnread > 0 ? "rgba(56, 189, 248, 0.04)" : "transparent"; }}
                    >
                      {/* Avatar */}
                      <div style={{
                        width: "36px",
                        height: "36px",
                        borderRadius: "50%",
                        background: `linear-gradient(135deg, hsl(${parseInt((convo.otherWallet || "").slice(2, 6), 16) % 360}, 50%, 40%), hsl(${(parseInt((convo.otherWallet || "").slice(2, 6), 16) % 360 + 60) % 360}, 40%, 30%))`,
                        flexShrink: 0,
                      }} />

                      {/* Content */}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                          <span style={{
                            fontSize: "0.78rem",
                            fontWeight: convo.myUnread > 0 ? 700 : 500,
                            color: "#fff",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}>
                            {convo.otherProfile?.display_name || convo.otherWallet?.slice(0, 8) + "…"}
                          </span>
                          <span style={{ fontSize: "0.6rem", color: "var(--text-muted)", flexShrink: 0 }}>
                            {timeAgo(convo.last_message_at)}
                          </span>
                        </div>
                        <p style={{
                          margin: "0.1rem 0 0",
                          fontSize: "0.7rem",
                          color: convo.myUnread > 0 ? "var(--text-secondary)" : "var(--text-muted)",
                          fontWeight: convo.myUnread > 0 ? 500 : 400,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}>
                          {convo.last_message_preview || "Start a conversation…"}
                        </p>
                      </div>

                      {/* Unread badge */}
                      {convo.myUnread > 0 && (
                        <span style={{
                          width: "18px",
                          height: "18px",
                          borderRadius: "50%",
                          background: "#0ea5e9",
                          color: "#fff",
                          fontSize: "0.55rem",
                          fontWeight: 700,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          flexShrink: 0,
                        }}>
                          {convo.myUnread > 9 ? "9+" : convo.myUnread}
                        </span>
                      )}
                    </button>
                  ))
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default MessagesPanel;
