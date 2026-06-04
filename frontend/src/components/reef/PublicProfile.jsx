/**
 * PublicProfile.jsx
 * 
 * Full public profile page for a breeder.
 * Shows: avatar, name, bio, stats, companion tier, Tankmates list,
 * their Currents, and a Tankmate request button.
 */

import React, { useState } from "react";
import { ProfileCard } from "./ProfileCard";
import { CurrentCard } from "./CurrentCard";
import { ProfileEdit } from "./ProfileEdit";
import { BadgeShelf } from "./BadgeShelf";
import { useProfile, useTankmates, useRelationshipStatus, useSendTankmateRequest } from "../../hooks/useReefProfile";
import { useUserCurrents } from "../../hooks/useReefFeed";
import { getCurrentWallet } from "../../services/supabaseClient";

const TIER_COLORS = {
  Bronze: "#cd7f32",
  Silver: "#c0c0c0",
  Gold: "#ffd700",
  Master: "#a855f7",
  "God-Tier": "#ffd700",
};

const TIER_ICONS = {
  Bronze: "🥉",
  Silver: "🥈",
  Gold: "🥇",
  Master: "💎",
  "God-Tier": "👑",
};

function walletGradient(wallet) {
  if (!wallet) return "linear-gradient(135deg, #374151, #1f2937)";
  const hash = wallet.slice(2, 10);
  const h1 = parseInt(hash.slice(0, 4), 16) % 360;
  const h2 = (h1 + 60) % 360;
  return `linear-gradient(135deg, hsl(${h1}, 60%, 45%), hsl(${h2}, 50%, 35%))`;
}

function truncateWallet(wallet) {
  if (!wallet) return "Unknown";
  return `${wallet.slice(0, 6)}...${wallet.slice(-4)}`;
}

function ConnectionButton({ targetWallet, casualModeActive }) {
  const currentWallet = getCurrentWallet();
  const { data: status, isLoading } = useRelationshipStatus(targetWallet);
  const sendRequest = useSendTankmateRequest();
  const [message, setMessage] = useState("");
  const [showMessageInput, setShowMessageInput] = useState(false);

  if (!currentWallet || currentWallet === targetWallet) return null;
  if (isLoading) return null;

  if (status === "tankmate") {
    return (
      <span style={{
        padding: "0.4rem 0.8rem",
        borderRadius: "50px",
        background: "rgba(52, 211, 153, 0.1)",
        border: "1px solid rgba(52, 211, 153, 0.3)",
        color: "var(--accent-green, #34d399)",
        fontSize: "0.75rem",
        fontWeight: 600,
      }}>
        ✓ {casualModeActive ? "Tankmates" : "Connected"}
      </span>
    );
  }

  if (status === "request_sent") {
    return (
      <span style={{
        padding: "0.4rem 0.8rem",
        borderRadius: "50px",
        background: "rgba(251, 191, 36, 0.08)",
        border: "1px solid rgba(251, 191, 36, 0.2)",
        color: "var(--accent-amber, #fbbf24)",
        fontSize: "0.75rem",
      }}>
        ⏳ Request Pending
      </span>
    );
  }

  const handleSend = () => {
    sendRequest.mutate({ targetWallet, message: message.trim() });
    setShowMessageInput(false);
    setMessage("");
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
      {!showMessageInput ? (
        <button
          onClick={() => setShowMessageInput(true)}
          disabled={sendRequest.isPending}
          style={{
            padding: "0.45rem 1rem",
            borderRadius: "50px",
            border: "none",
            background: "linear-gradient(135deg, #0ea5e9, #0369a1)",
            color: "#fff",
            fontSize: "0.75rem",
            fontWeight: 600,
            cursor: "pointer",
            transition: "all 0.15s ease",
          }}
        >
          🤝 {casualModeActive ? "Add Tankmate" : "Connect"}
        </button>
      ) : (
        <div style={{ display: "flex", gap: "0.35rem", alignItems: "center" }}>
          <input
            type="text"
            value={message}
            onChange={(e) => setMessage(e.target.value.slice(0, 200))}
            placeholder="Say hi! (optional)"
            style={{
              flex: 1,
              padding: "0.4rem 0.6rem",
              borderRadius: "8px",
              border: "1px solid rgba(255, 255, 255, 0.1)",
              background: "rgba(255, 255, 255, 0.04)",
              color: "#fff",
              fontSize: "0.7rem",
              outline: "none",
            }}
            onKeyDown={(e) => { if (e.key === "Enter") handleSend(); }}
            autoFocus
          />
          <button
            onClick={handleSend}
            style={{
              padding: "0.4rem 0.7rem",
              borderRadius: "8px",
              border: "none",
              background: "linear-gradient(135deg, #0ea5e9, #0369a1)",
              color: "#fff",
              fontSize: "0.7rem",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Send
          </button>
          <button
            onClick={() => setShowMessageInput(false)}
            style={{
              padding: "0.4rem",
              borderRadius: "8px",
              border: "1px solid rgba(255,255,255,0.1)",
              background: "transparent",
              color: "var(--text-muted)",
              fontSize: "0.7rem",
              cursor: "pointer",
            }}
          >
            ✕
          </button>
        </div>
      )}
    </div>
  );
}

export function PublicProfile({ walletAddress, onBack, onNavigateProfile, casualModeActive = false }) {
  const { data: profile, isLoading, refetch } = useProfile(walletAddress);
  const { data: tankmates } = useTankmates(walletAddress);
  const userCurrents = useUserCurrents(walletAddress);
  const currents = userCurrents.data?.pages?.flatMap((p) => p.data) || [];
  const [editing, setEditing] = useState(false);
  const currentWallet = getCurrentWallet();
  const isOwnProfile = currentWallet && currentWallet.toLowerCase() === walletAddress?.toLowerCase();

  if (isLoading) {
    return (
      <div style={{ maxWidth: "640px", margin: "0 auto", padding: "2rem" }}>
        <div style={{ height: "200px", borderRadius: "12px", background: "rgba(255,255,255,0.03)", animation: "pulse 1.5s infinite" }} />
      </div>
    );
  }

  if (!profile) {
    return (
      <div style={{ maxWidth: "640px", margin: "0 auto", textAlign: "center", padding: "3rem" }}>
        <p style={{ fontSize: "2rem" }}>🐠</p>
        <p style={{ color: "var(--text-muted)" }}>Profile not found</p>
        {onBack && (
          <button onClick={onBack} style={{ marginTop: "1rem", padding: "0.4rem 0.8rem", borderRadius: "8px", border: "1px solid rgba(255,255,255,0.1)", background: "transparent", color: "#fff", cursor: "pointer", fontSize: "0.8rem" }}>
            ← Back to feed
          </button>
        )}
      </div>
    );
  }

  const displayName = profile.display_name || truncateWallet(walletAddress);
  const tierColor = TIER_COLORS[profile.companion_tier] || "#cd7f32";
  const tierIcon = TIER_ICONS[profile.companion_tier] || "🥉";

  return (
    <div style={{ maxWidth: "640px", margin: "0 auto" }}>
      {/* Back button */}
      {onBack && (
        <button
          onClick={onBack}
          style={{
            marginBottom: "1rem",
            padding: "0.35rem 0.7rem",
            borderRadius: "8px",
            border: "1px solid rgba(255, 255, 255, 0.08)",
            background: "rgba(255, 255, 255, 0.03)",
            color: "var(--text-muted)",
            cursor: "pointer",
            fontSize: "0.75rem",
          }}
        >
          ← {casualModeActive ? "Back to Reef" : "Back"}
        </button>
      )}

      {/* Profile header card */}
      <div
        className="glass-card"
        style={{
          padding: "1.5rem",
          borderRadius: "16px",
          border: "1px solid rgba(255, 255, 255, 0.06)",
          background: "rgba(255, 255, 255, 0.02)",
          marginBottom: "1.5rem",
        }}
      >
        {/* Avatar + Name row */}
        <div style={{ display: "flex", alignItems: "center", gap: "1rem", marginBottom: "1rem" }} className="reef-profile-header-row">
          <div
            style={{
              width: "64px",
              height: "64px",
              borderRadius: "50%",
              background: profile.avatar_url
                ? `url(${profile.avatar_url}) center/cover`
                : walletGradient(walletAddress),
              border: `2px solid ${tierColor}`,
              boxShadow: profile.companion_tier === "God-Tier" ? `0 0 16px ${tierColor}` : `0 0 8px ${tierColor}33`,
              flexShrink: 0,
            }}
          />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <h2 style={{ margin: 0, fontSize: "1.1rem", fontWeight: 700, color: "#fff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {displayName}
              </h2>
              <span title={`${profile.companion_tier} Tier`} style={{ fontSize: "1rem" }}>
                {tierIcon}
              </span>
            </div>
            <p style={{ margin: "0.2rem 0 0", fontSize: "0.7rem", color: "var(--text-muted)", fontFamily: "monospace" }}>
              {truncateWallet(walletAddress)}
            </p>
          </div>
          <ConnectionButton targetWallet={walletAddress} casualModeActive={casualModeActive} />
          {isOwnProfile && !editing && (
            <button
              onClick={() => setEditing(true)}
              style={{
                padding: "0.35rem 0.7rem",
                borderRadius: "8px",
                border: "1px solid rgba(255, 255, 255, 0.1)",
                background: "rgba(255, 255, 255, 0.03)",
                color: "var(--text-muted)",
                fontSize: "0.7rem",
                cursor: "pointer",
                transition: "all 0.15s ease",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.color = "#fff"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.2)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-muted)"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.1)"; }}
            >
              ✏️ Edit
            </button>
          )}
        </div>

        {/* Profile edit form (inline, replaces header content when editing) */}
        {editing && (
          <ProfileEdit
            profile={profile}
            casualModeActive={casualModeActive}
            onSave={() => { setEditing(false); refetch(); }}
            onCancel={() => setEditing(false)}
          />
        )}

        {/* Bio */}
        {profile.bio && (
          <p style={{ margin: "0 0 1rem", fontSize: "0.8rem", color: "var(--text-secondary)", lineHeight: "1.5" }}>
            {profile.bio}
          </p>
        )}

        {/* Stats row */}
        <div style={{ display: "flex", gap: "1.5rem", flexWrap: "wrap" }} className="reef-profile-stats">
          <div style={{ textAlign: "center" }}>
            <p style={{ margin: 0, fontSize: "1.1rem", fontWeight: 700, color: "#fff" }}>
              {profile.xp_total || 0}
            </p>
            <p style={{ margin: 0, fontSize: "0.6rem", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
              {casualModeActive ? "Points" : "XP"}
            </p>
          </div>
          <div style={{ textAlign: "center" }}>
            <p style={{ margin: 0, fontSize: "1.1rem", fontWeight: 700, color: "#fff" }}>
              {profile.tank_count || 0}
            </p>
            <p style={{ margin: 0, fontSize: "0.6rem", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Tanks
            </p>
          </div>
          <div style={{ textAlign: "center" }}>
            <p style={{ margin: 0, fontSize: "1.1rem", fontWeight: 700, color: "#fff" }}>
              {profile.species_count || 0}
            </p>
            <p style={{ margin: 0, fontSize: "0.6rem", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Species
            </p>
          </div>
          <div style={{ textAlign: "center" }}>
            <p style={{ margin: 0, fontSize: "1.1rem", fontWeight: 700, color: tierColor }}>
              {profile.companion_tier}
            </p>
            <p style={{ margin: 0, fontSize: "0.6rem", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Tier
            </p>
          </div>
        </div>
      </div>

      {/* Badge Shelf */}
      <div style={{ marginBottom: "1.5rem" }}>
        <BadgeShelf
          stats={{
            tankCount: profile.tank_count || 0,
            speciesCount: profile.species_count || 0,
            companionTier: profile.companion_tier || "Bronze",
            xpTotal: profile.xp_total || 0,
            postCount: currents.length,
            insightCount: 0, // TODO: query from species_insights
            tankmateCount: tankmates?.length || 0,
          }}
          showLocked={isOwnProfile}
          casualModeActive={casualModeActive}
        />
      </div>

      {/* Tankmates section */}
      {tankmates && tankmates.length > 0 && (
        <div style={{ marginBottom: "1.5rem" }}>
          <h3 style={{ fontSize: "0.8rem", fontWeight: 600, color: "var(--text-secondary)", marginBottom: "0.5rem" }}>
            {casualModeActive ? "Tankmates" : "Connections"} ({tankmates.length})
          </h3>
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }} className="reef-tankmates-row">
            {tankmates.slice(0, 8).map((tm) => {
              const p = tm.profiles;
              return (
                <ProfileCard
                  key={p?.wallet_address || tm.target_wallet}
                  walletAddress={p?.wallet_address || tm.target_wallet}
                  displayName={p?.display_name}
                  avatarUrl={p?.avatar_url}
                  companionTier={p?.companion_tier}
                  size="small"
                  onClick={() => onNavigateProfile?.(p?.wallet_address || tm.target_wallet)}
                />
              );
            })}
            {tankmates.length > 8 && (
              <span style={{ fontSize: "0.7rem", color: "var(--text-muted)", alignSelf: "center" }}>
                +{tankmates.length - 8} more
              </span>
            )}
          </div>
        </div>
      )}

      {/* User's Currents */}
      <div>
        <h3 style={{ fontSize: "0.8rem", fontWeight: 600, color: "var(--text-secondary)", marginBottom: "0.75rem" }}>
          {casualModeActive ? "Tank Updates" : "Currents"}{currents.length > 0 ? ` (${currents.length})` : ""}
        </h3>

        {currents.length === 0 && (
          <div style={{
            textAlign: "center",
            padding: "2rem",
            borderRadius: "12px",
            background: "rgba(255, 255, 255, 0.02)",
            border: "1px solid rgba(255, 255, 255, 0.05)",
          }}>
            <p style={{ margin: 0, fontSize: "0.8rem", color: "var(--text-muted)" }}>
              No posts yet
            </p>
          </div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          {currents.map((current) => (
            <CurrentCard
              key={current.id}
              current={current}
              casualModeActive={casualModeActive}
              onProfileClick={onNavigateProfile}
            />
          ))}
        </div>

        {userCurrents.hasNextPage && (
          <button
            onClick={() => userCurrents.fetchNextPage()}
            disabled={userCurrents.isFetchingNextPage}
            style={{
              width: "100%",
              marginTop: "1rem",
              padding: "0.6rem",
              borderRadius: "8px",
              border: "1px solid rgba(255, 255, 255, 0.08)",
              background: "rgba(255, 255, 255, 0.03)",
              color: "var(--text-muted)",
              fontSize: "0.75rem",
              cursor: "pointer",
            }}
          >
            {userCurrents.isFetchingNextPage ? "Loading..." : "Load more"}
          </button>
        )}
      </div>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
      `}</style>
    </div>
  );
}
