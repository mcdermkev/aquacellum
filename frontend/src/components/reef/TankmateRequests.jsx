/**
 * TankmateRequests.jsx
 * 
 * Shows pending Tankmate requests and lets the user accept/decline.
 * Displayed in the Reef feed when there are pending requests.
 */

import React from "react";
import { ProfileCard } from "./ProfileCard";
import { usePendingRequests, useRespondToRequest } from "../../hooks/useReefProfile";
import "./ReefDaylight.css";

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
    <section className="reef-inbox-card" aria-label="Tankmate requests">
      <h3>{casualModeActive ? "Tankmate requests" : "Connection requests"} ({requests.length})</h3>
      <ul className="reef-inbox-list">
        {requests.map((req) => {
          const profile = req.from_profile;
          return (
            <li key={req.id} className="reef-inbox-row">
              <div className="reef-inbox-row-text">
                <ProfileCard
                  walletAddress={profile?.wallet_address || req.from_wallet}
                  displayName={profile?.display_name}
                  avatarUrl={profile?.avatar_url}
                  companionTier={profile?.companion_tier}
                  size="small"
                  onClick={() => onNavigateProfile?.(req.from_wallet)}
                />
                {req.message && <span className="reef-inbox-row-meta">&ldquo;{req.message}&rdquo;</span>}
                <span className="reef-inbox-row-meta">{timeAgo(req.created_at)}</span>
              </div>
              <div className="reef-inbox-row-actions">
                <button
                  type="button"
                  className="reef-btn reef-btn--sm reef-btn--primary"
                  onClick={() => respond.mutate({ requestId: req.id, accept: true })}
                  disabled={respond.isPending}
                >
                  Accept
                </button>
                <button
                  type="button"
                  className="reef-btn reef-btn--sm"
                  onClick={() => respond.mutate({ requestId: req.id, accept: false })}
                  disabled={respond.isPending}
                >
                  Decline
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
