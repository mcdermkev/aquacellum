/**
 * TankmateRequests.jsx
 * 
 * Shows pending Tankmate requests and lets the user accept/decline.
 * Displayed in the Reef feed when there are pending requests.
 */

import React from "react";
import { ProfileCard } from "./ProfileCard";
import { usePendingRequests, useRespondToRequest } from "../../hooks/useReefProfile";

function timeAgo(dateString) {
  const seconds = Math.floor((new Date() - new Date(dateString)) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

export function TankmateRequests({ onNavigateProfile, casualModeActive = false }) {
  const { data: requests, isLoading } = usePendingRequests();
  const respond = useRespondToRequest();

  if (isLoading || !requests || requests.length === 0) return null;

  return (
    <div
      style={{
        padding: "1rem",
        borderRadius: "12px",
        background: "rgba(56, 189, 248, 0.03)",
        border: "1px solid rgba(56, 189, 248, 0.12)",
        marginBottom: "1rem",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.75rem" }}>
        <h3 style={{ margin: 0, fontSize: "0.8rem", fontWeight: 600, color: "#fff" }}>
          🤝 {casualModeActive ? "Tankmate Requests" : "Connection Requests"} ({requests.length})
        </h3>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "0.65rem" }}>
        {requests.map((req) => {
          const profile = req.from_profile;
          return (
            <div
              key={req.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.6rem",
                padding: "0.5rem 0.6rem",
                borderRadius: "8px",
                background: "rgba(255, 255, 255, 0.02)",
                border: "1px solid rgba(255, 255, 255, 0.05)",
              }}
            >
              {/* Profile info */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <ProfileCard
                  walletAddress={profile?.wallet_address || req.from_wallet}
                  displayName={profile?.display_name}
                  avatarUrl={profile?.avatar_url}
                  companionTier={profile?.companion_tier}
                  size="small"
                  onClick={() => onNavigateProfile?.(req.from_wallet)}
                />
                {req.message && (
                  <p style={{
                    margin: "0.25rem 0 0 2rem",
                    fontSize: "0.7rem",
                    color: "var(--text-muted)",
                    fontStyle: "italic",
                  }}>
                    "{req.message}"
                  </p>
                )}
              </div>

              {/* Time */}
              <span style={{ fontSize: "0.6rem", color: "var(--text-muted)", flexShrink: 0 }}>
                {timeAgo(req.created_at)}
              </span>

              {/* Action buttons */}
              <div style={{ display: "flex", gap: "0.3rem", flexShrink: 0 }}>
                <button
                  onClick={() => respond.mutate({ requestId: req.id, accept: true })}
                  disabled={respond.isPending}
                  style={{
                    padding: "0.3rem 0.6rem",
                    borderRadius: "6px",
                    border: "none",
                    background: "rgba(52, 211, 153, 0.15)",
                    color: "var(--accent-green, #34d399)",
                    fontSize: "0.65rem",
                    fontWeight: 600,
                    cursor: "pointer",
                    transition: "background 0.15s ease",
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(52, 211, 153, 0.25)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(52, 211, 153, 0.15)"; }}
                >
                  ✓ Accept
                </button>
                <button
                  onClick={() => respond.mutate({ requestId: req.id, accept: false })}
                  disabled={respond.isPending}
                  style={{
                    padding: "0.3rem 0.6rem",
                    borderRadius: "6px",
                    border: "1px solid rgba(255, 255, 255, 0.08)",
                    background: "transparent",
                    color: "var(--text-muted)",
                    fontSize: "0.65rem",
                    cursor: "pointer",
                    transition: "color 0.15s ease",
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.color = "#fff"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-muted)"; }}
                >
                  ✕
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
