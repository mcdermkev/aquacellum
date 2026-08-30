/**
 * InboxPanel.jsx
 * 
 * Combined Notifications + Messages panel.
 * Single icon with total unread badge, two sub-tabs inside.
 * Replaces separate SonarBell and MessagesPanel in the header.
 */

import React, { useState, useRef, useEffect, useCallback } from "react";
import { useUnreadCount, useNotifications, useMarkRead, useMarkAllRead } from "../../hooks/useSonar";
import { useConversations, useUnreadDMCount } from "../../hooks/useMessages";
import { isSupabaseConfigured } from "../../services/supabaseClient";
import { ConversationView } from "./ConversationView";
import { ProfileCard } from "./ProfileCard";
import { SonarPreferences } from "./SonarPreferences";

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

export function InboxPanel({ casualModeActive = false, initialView = null, pendingConversation = null, onConversationConsumed = null, onRouteClose = null }) {
  const [isOpen, setIsOpen] = useState(false);
  const [activeInboxTab, setActiveInboxTab] = useState("notifications");
  const [activeConvo, setActiveConvo] = useState(null);
  const [showPreferences, setShowPreferences] = useState(false);
  const dropdownRef = useRef(null);
  const configured = isSupabaseConfigured();

  const closeInbox = useCallback(() => {
    setIsOpen(false);
    setActiveConvo(null);
    if (initialView === "messages") onRouteClose?.();
  }, [initialView, onRouteClose]);

  // Notifications
  const { data: notifUnread = 0 } = useUnreadCount(configured);
  const { data: notificationsResult } = useNotifications({ limit: 15 });
  const notifications = notificationsResult?.data || [];
  const markRead = useMarkRead();
  const markAllRead = useMarkAllRead();

  // Messages
  const { data: dmUnread = 0 } = useUnreadDMCount(configured);
  const { data: conversations = [] } = useConversations(configured && isOpen);

  const totalUnread = notifUnread + dmUnread;

  // /app/messages composes the existing inbox rather than introducing a
  // second messaging surface. Route changes can open this presentation even
  // when ReefFeed remains mounted under the same shell tab.
  useEffect(() => {
    if (initialView !== "messages") return;
    setIsOpen(true);
    setActiveInboxTab("messages");
    setShowPreferences(false);
  }, [initialView]);

  // Canonical /app/messages handoffs arrive as state from App, avoiding the
  // former timer/event race during lazy mounting.
  useEffect(() => {
    if (!pendingConversation?.conversationId) return;
    setIsOpen(true);
    setActiveInboxTab("messages");
    setShowPreferences(false);
    setActiveConvo({
      id: pendingConversation.conversationId,
      otherWallet: pendingConversation.targetWallet,
      otherProfile: pendingConversation.targetProfile || null,
      listingKey: pendingConversation.listingKey || null,
      listingName: pendingConversation.listingName || null,
    });
    onConversationConsumed?.();
  }, [onConversationConsumed, pendingConversation]);

  // Close dropdown on outside click
  useEffect(() => {
    if (!isOpen) return;
    const handleClick = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        closeInbox();
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [closeInbox, isOpen]);

  // Open a specific conversation when another component (e.g. a profile's
  // "Message" button) requests it via the reef_open_conversation event.
  useEffect(() => {
    const handleOpenConversation = (e) => {
      const { conversationId, targetWallet, targetProfile } = e.detail || {};
      if (!conversationId) return;
      setIsOpen(true);
      setActiveInboxTab("messages");
      setShowPreferences(false);
      setActiveConvo({
        id: conversationId,
        otherWallet: targetWallet,
        otherProfile: targetProfile || null,
      });
    };
    window.addEventListener("reef_open_conversation", handleOpenConversation);
    return () => window.removeEventListener("reef_open_conversation", handleOpenConversation);
  }, []);

  const handleNotificationClick = (notification) => {
    if (!notification.is_read) {
      markRead.mutate(notification.id);
    }
    closeInbox();
  };

  if (!configured) return null;

  // If viewing a conversation
  if (activeConvo) {
    return (
      <div ref={dropdownRef} style={{ position: "relative" }}>
        <InboxButton totalUnread={totalUnread} isOpen={isOpen} onClick={() => {
          if (isOpen) closeInbox();
          else setIsOpen(true);
        }} />
        {isOpen && (
          <div
            className="reef-inbox-dropdown"
            style={{
              position: "absolute",
              top: "calc(100% + 8px)",
              right: 0,
              width: "360px",
              maxHeight: "500px",
              borderRadius: "14px",
              background: "rgba(15, 23, 42, 0.98)",
              border: "1px solid rgba(255, 255, 255, 0.08)",
              boxShadow: "0 16px 64px rgba(0, 0, 0, 0.5)",
              zIndex: 9000,
              overflow: "hidden",
            }}
          >
            <div style={{ padding: "0.5rem 0.75rem", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
              <button
                onClick={() => setActiveConvo(null)}
                style={{ background: "none", border: "none", color: "var(--text-secondary)", fontSize: "0.7rem", cursor: "pointer", padding: "0.2rem 0" }}
              >
                ← Back
              </button>
            </div>
            <div style={{ height: "400px" }}>
              <ConversationView
                conversationId={activeConvo.id}
                otherWallet={activeConvo.otherWallet}
                otherProfile={activeConvo.otherProfile}
                listingName={activeConvo.listingName}
              />
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div ref={dropdownRef} style={{ position: "relative" }}>
      <InboxButton totalUnread={totalUnread} isOpen={isOpen} onClick={() => {
        if (isOpen) closeInbox();
        else setIsOpen(true);
      }} />

      {isOpen && (
        <div
          className="reef-inbox-dropdown reef-scrollable"
          style={{
            position: "absolute",
            top: "calc(100% + 8px)",
            right: 0,
            width: "360px",
            maxHeight: "500px",
            borderRadius: "14px",
            background: "rgba(15, 23, 42, 0.98)",
            border: "1px solid rgba(255, 255, 255, 0.08)",
            boxShadow: "0 16px 64px rgba(0, 0, 0, 0.5)",
            zIndex: 9000,
            display: "flex",
            flexDirection: "column",
          }}
          role="menu"
          aria-label="Inbox"
        >
          {/* Sub-tabs */}
          <div style={{
            display: "flex",
            borderBottom: "1px solid rgba(255, 255, 255, 0.06)",
            padding: "0.5rem 0.5rem 0",
            alignItems: "center",
          }}>
            <button
              onClick={() => { setActiveInboxTab("notifications"); setShowPreferences(false); }}
              style={{
                flex: 1,
                padding: "0.5rem 0.5rem 0.6rem",
                border: "none",
                background: "none",
                color: activeInboxTab === "notifications" ? "#fff" : "var(--text-muted)",
                fontSize: "0.75rem",
                fontWeight: activeInboxTab === "notifications" ? 600 : 400,
                cursor: "pointer",
                borderBottom: activeInboxTab === "notifications" ? "2px solid #38bdf8" : "2px solid transparent",
                transition: "all 0.15s ease",
              }}
            >
              {casualModeActive ? "Notifications" : "Sonar"} {notifUnread > 0 && (
                <span style={{ background: "#ef4444", color: "#fff", fontSize: "0.55rem", padding: "1px 4px", borderRadius: "6px", marginLeft: "0.3rem" }}>
                  {notifUnread > 99 ? "99+" : notifUnread}
                </span>
              )}
            </button>
            <button
              onClick={() => { setActiveInboxTab("messages"); setShowPreferences(false); }}
              style={{
                flex: 1,
                padding: "0.5rem 0.5rem 0.6rem",
                border: "none",
                background: "none",
                color: activeInboxTab === "messages" ? "#fff" : "var(--text-muted)",
                fontSize: "0.75rem",
                fontWeight: activeInboxTab === "messages" ? 600 : 400,
                cursor: "pointer",
                borderBottom: activeInboxTab === "messages" ? "2px solid #38bdf8" : "2px solid transparent",
                transition: "all 0.15s ease",
              }}
            >
              Messages {dmUnread > 0 && (
                <span style={{ background: "#ef4444", color: "#fff", fontSize: "0.55rem", padding: "1px 4px", borderRadius: "6px", marginLeft: "0.3rem" }}>
                  {dmUnread > 99 ? "99+" : dmUnread}
                </span>
              )}
            </button>
            {/* Notification settings gear */}
            <button
              onClick={() => setShowPreferences(!showPreferences)}
              style={{
                width: "28px",
                height: "28px",
                borderRadius: "6px",
                border: "none",
                background: showPreferences ? "rgba(56, 189, 248, 0.1)" : "transparent",
                color: showPreferences ? "#fff" : "var(--text-muted)",
                fontSize: "0.8rem",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
                transition: "all 0.15s ease",
              }}
              title="Notification settings"
              aria-label="Notification settings"
            >
              ⚙️
            </button>
          </div>

          {/* Notification Preferences Panel */}
          {showPreferences && (
            <div style={{ flex: 1, overflowY: "auto", padding: "0.5rem" }}>
              <SonarPreferences onClose={() => setShowPreferences(false)} />
            </div>
          )}

          {/* Notifications tab */}
          {activeInboxTab === "notifications" && !showPreferences && (
            <div style={{ flex: 1, overflowY: "auto" }}>
              {/* Mark all read */}
              {notifUnread > 0 && (
                <div style={{ display: "flex", justifyContent: "flex-end", padding: "0.4rem 0.75rem 0" }}>
                  <button
                    onClick={() => markAllRead.mutate()}
                    style={{ background: "none", border: "none", color: "#38bdf8", fontSize: "0.6rem", cursor: "pointer" }}
                  >
                    Mark all read
                  </button>
                </div>
              )}

              {notifications.length === 0 ? (
                <div style={{ padding: "2.5rem 1rem", textAlign: "center" }}>
                  <p style={{ fontSize: "1.5rem", margin: "0 0 0.5rem" }}>🔕</p>
                  <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", margin: 0 }}>
                    {casualModeActive ? "No notifications yet" : "Sonar is quiet"}
                  </p>
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column" }}>
                  {notifications.map((notif) => (
                    <button
                      key={notif.id}
                      onClick={() => handleNotificationClick(notif)}
                      style={{
                        display: "flex",
                        alignItems: "flex-start",
                        gap: "0.6rem",
                        padding: "0.65rem 0.75rem",
                        border: "none",
                        borderBottom: "1px solid rgba(255, 255, 255, 0.03)",
                        background: notif.is_read ? "transparent" : "rgba(56, 189, 248, 0.03)",
                        cursor: "pointer",
                        textAlign: "left",
                        transition: "background 0.1s ease",
                        width: "100%",
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255, 255, 255, 0.03)"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = notif.is_read ? "transparent" : "rgba(56, 189, 248, 0.03)"; }}
                      role="menuitem"
                    >
                      <span style={{ fontSize: "1rem", flexShrink: 0 }}>{notif.icon || "🔔"}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{
                          margin: 0, fontSize: "0.72rem",
                          fontWeight: notif.is_read ? 400 : 600,
                          color: notif.is_read ? "var(--text-secondary)" : "#fff",
                          lineHeight: 1.4,
                        }}>
                          {notif.title}
                        </p>
                        {notif.body && (
                          <p style={{ margin: "0.1rem 0 0", fontSize: "0.62rem", color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {notif.body}
                          </p>
                        )}
                      </div>
                      <span style={{ fontSize: "0.58rem", color: "var(--text-muted)", flexShrink: 0 }}>
                        {timeAgo(notif.created_at)}
                      </span>
                      {!notif.is_read && (
                        <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: "#38bdf8", flexShrink: 0, marginTop: "0.3rem" }} />
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Messages tab */}
          {activeInboxTab === "messages" && !showPreferences && (
            <div style={{ flex: 1, overflowY: "auto" }}>
              {conversations.length === 0 ? (
                <div style={{ padding: "2.5rem 1rem", textAlign: "center" }}>
                  <p style={{ fontSize: "1.5rem", margin: "0 0 0.5rem" }}>💬</p>
                  <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", margin: 0 }}>
                    No conversations yet
                  </p>
                  <p style={{ fontSize: "0.65rem", color: "var(--text-muted)", margin: "0.3rem 0 0" }}>
                    {casualModeActive ? "Message someone from their profile!" : "Initiate a connection from a profile node."}
                  </p>
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column" }}>
                  {conversations.map((convo) => {
                    const other = convo.otherProfile || {};
                    return (
                      <button
                        key={convo.id}
                        onClick={() => setActiveConvo({ id: convo.id, otherWallet: other.wallet_address, otherProfile: other })}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "0.6rem",
                          padding: "0.6rem 0.75rem",
                          border: "none",
                          borderBottom: "1px solid rgba(255, 255, 255, 0.03)",
                          background: convo.has_unread ? "rgba(56, 189, 248, 0.03)" : "transparent",
                          cursor: "pointer",
                          textAlign: "left",
                          width: "100%",
                          transition: "background 0.1s ease",
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255, 255, 255, 0.03)"; }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = convo.has_unread ? "rgba(56, 189, 248, 0.03)" : "transparent"; }}
                      >
                        {/* Avatar */}
                        <div style={{
                          width: "32px", height: "32px", borderRadius: "50%",
                          background: "rgba(255, 255, 255, 0.06)",
                          display: "flex", alignItems: "center", justifyContent: "center",
                          fontSize: "0.8rem", flexShrink: 0,
                          overflow: "hidden",
                        }}>
                          {other.avatar_url
                            ? <img src={other.avatar_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                            : "👤"
                          }
                        </div>
                        {/* Content */}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <p style={{
                            margin: 0, fontSize: "0.75rem",
                            fontWeight: convo.has_unread ? 600 : 400,
                            color: convo.has_unread ? "#fff" : "var(--text-secondary)",
                          }}>
                            {other.display_name || `${(other.wallet_address || "").slice(0, 6)}...`}
                          </p>
                          {convo.last_message && (
                            <p style={{
                              margin: "0.1rem 0 0", fontSize: "0.62rem",
                              color: "var(--text-muted)",
                              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                            }}>
                              {convo.last_message}
                            </p>
                          )}
                        </div>
                        {/* Time */}
                        <span style={{ fontSize: "0.58rem", color: "var(--text-muted)", flexShrink: 0 }}>
                          {timeAgo(convo.last_message_at)}
                        </span>
                        {convo.has_unread && (
                          <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: "#38bdf8", flexShrink: 0 }} />
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function InboxButton({ totalUnread, isOpen, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        position: "relative",
        width: "34px",
        height: "34px",
        borderRadius: "8px",
        border: isOpen ? "1px solid rgba(56, 189, 248, 0.25)" : "1px solid rgba(255, 255, 255, 0.08)",
        background: isOpen ? "rgba(56, 189, 248, 0.08)" : "rgba(255, 255, 255, 0.03)",
        color: "var(--text-muted)",
        cursor: "pointer",
        fontSize: "1rem",
        transition: "all 0.15s ease",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 0,
      }}
      onMouseEnter={(e) => { e.currentTarget.style.color = "#fff"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.15)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-muted)"; e.currentTarget.style.borderColor = isOpen ? "rgba(56, 189, 248, 0.25)" : "rgba(255,255,255,0.08)"; }}
      title="Inbox"
      aria-label={`Inbox${totalUnread > 0 ? `, ${totalUnread} unread` : ""}`}
      aria-expanded={isOpen}
    >
      📥
      {totalUnread > 0 && (
        <span
          style={{
            position: "absolute",
            top: "-3px",
            right: "-3px",
            minWidth: "16px",
            height: "16px",
            borderRadius: "50px",
            background: "#ef4444",
            color: "#fff",
            fontSize: "0.55rem",
            fontWeight: 700,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "0 3px",
            boxShadow: "0 0 6px rgba(239, 68, 68, 0.5)",
          }}
          aria-hidden="true"
        >
          {totalUnread > 99 ? "99+" : totalUnread}
        </span>
      )}
    </button>
  );
}
