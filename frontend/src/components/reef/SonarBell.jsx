/**
 * SonarBell.jsx
 * 
 * Notification bell icon with unread count badge.
 * Click opens a dropdown with recent notifications.
 */

import React, { useState, useRef, useEffect } from "react";
import { useUnreadCount, useNotifications, useMarkRead, useMarkAllRead } from "../../hooks/useSonar";
import { isSupabaseConfigured } from "../../services/supabaseClient";

function timeAgo(dateString) {
  const now = new Date();
  const date = new Date(dateString);
  const seconds = Math.floor((now - date) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}

export function SonarBell() {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef(null);
  const configured = isSupabaseConfigured();

  const { data: unreadCount = 0 } = useUnreadCount(configured);
  const { data: notificationsResult } = useNotifications({ limit: 10 });
  const notifications = notificationsResult?.data || [];
  const markRead = useMarkRead();
  const markAllRead = useMarkAllRead();

  // Close dropdown on outside click
  useEffect(() => {
    if (!isOpen) return;
    const handleClick = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [isOpen]);

  const handleNotificationClick = (notification) => {
    if (!notification.is_read) {
      markRead.mutate(notification.id);
    }
    // TODO: Navigate to linked content based on link_type + link_id
    setIsOpen(false);
  };

  return (
    <div ref={dropdownRef} style={{ position: "relative" }}>
      {/* Bell button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
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
          padding: 0
        }}
        onMouseEnter={(e) => { e.currentTarget.style.color = "#fff"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.15)"; }}
        onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-muted)"; e.currentTarget.style.borderColor = isOpen ? "rgba(56, 189, 248, 0.25)" : "rgba(255,255,255,0.08)"; }}
        title="Notifications"
        aria-label={`Notifications${unreadCount > 0 ? `, ${unreadCount} unread` : ""}`}
        aria-expanded={isOpen}
      >
        🔔
        {/* Unread badge */}
        {unreadCount > 0 && (
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
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown panel */}
      {isOpen && (
        <div
          className="reef-sonar-dropdown reef-scrollable"
          style={{
            position: "absolute",
            top: "calc(100% + 8px)",
            right: 0,
            width: "320px",
            maxHeight: "400px",
            overflowY: "auto",
            borderRadius: "12px",
            background: "rgba(15, 23, 42, 0.98)",
            border: "1px solid rgba(255, 255, 255, 0.08)",
            boxShadow: "0 16px 64px rgba(0, 0, 0, 0.5)",
            zIndex: 9000,
            display: "flex",
            flexDirection: "column",
          }}
          role="menu"
          aria-label="Notifications"
        >
          {/* Header */}
          <div style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: "0.75rem 1rem",
            borderBottom: "1px solid rgba(255, 255, 255, 0.05)",
          }}>
            <span style={{ fontSize: "0.8rem", fontWeight: 600, color: "#fff" }}>
              Sonar
            </span>
            {unreadCount > 0 && (
              <button
                onClick={() => markAllRead.mutate()}
                style={{
                  background: "none",
                  border: "none",
                  color: "var(--accent-blue, #38bdf8)",
                  fontSize: "0.65rem",
                  cursor: "pointer",
                  padding: "0.15rem 0.3rem",
                }}
              >
                Mark all read
              </button>
            )}
          </div>

          {/* Notification list */}
          {notifications.length === 0 ? (
            <div style={{ padding: "2rem 1rem", textAlign: "center" }}>
              <p style={{ fontSize: "1.5rem", margin: "0 0 0.5rem" }}>🔕</p>
              <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", margin: 0 }}>
                No notifications yet
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
                    padding: "0.65rem 1rem",
                    border: "none",
                    borderBottom: "1px solid rgba(255, 255, 255, 0.03)",
                    background: notif.is_read
                      ? "transparent"
                      : "rgba(56, 189, 248, 0.03)",
                    cursor: "pointer",
                    textAlign: "left",
                    transition: "background 0.1s ease",
                    width: "100%",
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255, 255, 255, 0.03)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = notif.is_read ? "transparent" : "rgba(56, 189, 248, 0.03)"; }}
                  role="menuitem"
                >
                  {/* Icon */}
                  <span style={{ fontSize: "1rem", flexShrink: 0, marginTop: "0.1rem" }}>
                    {notif.icon || "🔔"}
                  </span>

                  {/* Content */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{
                      margin: 0,
                      fontSize: "0.75rem",
                      fontWeight: notif.is_read ? 400 : 600,
                      color: notif.is_read ? "var(--text-secondary)" : "#fff",
                      lineHeight: "1.4",
                    }}>
                      {notif.title}
                    </p>
                    {notif.body && (
                      <p style={{
                        margin: "0.15rem 0 0",
                        fontSize: "0.65rem",
                        color: "var(--text-muted)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}>
                        {notif.body}
                      </p>
                    )}
                  </div>

                  {/* Time */}
                  <span style={{ fontSize: "0.6rem", color: "var(--text-muted)", flexShrink: 0 }}>
                    {timeAgo(notif.created_at)}
                  </span>

                  {/* Unread dot */}
                  {!notif.is_read && (
                    <span style={{
                      width: "6px",
                      height: "6px",
                      borderRadius: "50%",
                      background: "var(--accent-blue, #38bdf8)",
                      flexShrink: 0,
                      marginTop: "0.3rem",
                    }} />
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
