/**
 * PublicProfile.jsx
 * 
 * Full public profile page for a breeder.
 * Shows: avatar, name, bio, stats, companion tier, Tankmates list,
 * their Currents, and a Tankmate request button.
 */

import React, { useState, useEffect } from "react";
import { ProfileCard } from "./ProfileCard";
import { CurrentCard } from "./CurrentCard";
import { ProfileEdit } from "./ProfileEdit";
import { BadgeShelf } from "./BadgeShelf";
import { useProfile, useTankmates, useRelationshipStatus, useSendTankmateRequest, useUpdateProfile } from "../../hooks/useReefProfile";
import { useUserCurrents } from "../../hooks/useReefFeed";
import { getCurrentWallet } from "../../services/supabaseClient";
import { db } from "../../db";

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

  const updateProfileMutation = useUpdateProfile();

  useEffect(() => {
    if (!isOwnProfile || !profile) return;

    let active = true;

    async function syncLocalStats() {
      try {
        // Fetch local tanks matching user wallet
        const localTanks = await db.tanks.toArray();
        const userTanks = localTanks.filter(
          (t) => t.ownerAddress?.toLowerCase() === walletAddress?.toLowerCase()
        );
        const tankCount = userTanks.length;

        // Fetch local specimens matching user wallet
        const localSpecimens = await db.specimens.toArray();
        const userSpecimens = localSpecimens.filter(
          (s) => s.ownerAddress?.toLowerCase() === walletAddress?.toLowerCase() && s.status === 0
        );

        // Extract unique speciesIds
        const speciesIds = new Set();
        userSpecimens.forEach((s) => {
          if (s.speciesId) speciesIds.add(Number(s.speciesId));
        });
        userTanks.forEach((t) => {
          if (t.specimens) {
            t.specimens.forEach((s) => {
              if (s.speciesId) speciesIds.add(Number(s.speciesId));
            });
          }
        });
        const speciesCount = speciesIds.size;

        // Fetch local userProfile and companion tier
        const localProfiles = await db.userProfile.toArray();
        const uProfile = localProfiles.find(
          (p) => p.walletAddress?.toLowerCase() === walletAddress?.toLowerCase()
        );
        const xpTotal = uProfile
          ? (uProfile.prestigeXp || 0) + (uProfile.hobbyistXp || 0)
          : 0;

        const localCompanions = await db.breederCompanion.toArray();
        const uCompanion = localCompanions.find(
          (c) => c.walletAddress?.toLowerCase() === walletAddress?.toLowerCase()
        );
        const companionTier = uCompanion?.currentTier || "Bronze";

        // Check if anything differs
        if (
          profile.tank_count !== tankCount ||
          profile.species_count !== speciesCount ||
          profile.xp_total !== xpTotal ||
          profile.companion_tier !== companionTier
        ) {
          if (!active) return;
          console.log("[Reef Profile Sync] Local stats differ from Supabase, updating...", {
            local: { tankCount, speciesCount, xpTotal, companionTier },
            supabase: {
              tank_count: profile.tank_count,
              species_count: profile.species_count,
              xp_total: profile.xp_total,
              companion_tier: profile.companion_tier,
            },
          });

          await updateProfileMutation.mutateAsync({
            walletAddress,
            updates: {
              tank_count: tankCount,
              species_count: speciesCount,
              xp_total: xpTotal,
              companion_tier: companionTier,
            },
          });
          
          refetch();
        }
      } catch (err) {
        console.error("[Reef Profile Sync] Error syncing local stats:", err);
      }
    }

    syncLocalStats();

    return () => {
      active = false;
    };
  }, [walletAddress, isOwnProfile, profile, refetch]);

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
          padding: "1.75rem",
          borderRadius: "20px",
          border: "1px solid rgba(255, 255, 255, 0.06)",
          background: "linear-gradient(180deg, rgba(255, 255, 255, 0.03) 0%, rgba(255, 255, 255, 0.01) 100%)",
          marginBottom: "1.5rem",
          position: "relative",
          overflow: "hidden",
          boxShadow: "0 8px 32px 0 rgba(0, 0, 0, 0.3)",
        }}
      >
        {/* Decorative subtle tier glow in background */}
        <div style={{
          position: "absolute",
          top: "-50px",
          right: "-50px",
          width: "150px",
          height: "150px",
          borderRadius: "50%",
          background: `${tierColor}11`,
          filter: "blur(40px)",
          pointerEvents: "none",
        }} />
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
        <div 
          style={{ 
            display: "grid", 
            gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))", 
            gap: "0.75rem", 
            marginTop: "1.25rem" 
          }} 
          className="reef-profile-stats"
        >
          {/* XP/Points */}
          <div style={{
            background: "rgba(255, 255, 255, 0.02)",
            border: "1px solid rgba(255, 255, 255, 0.04)",
            borderRadius: "12px",
            padding: "0.85rem 0.5rem",
            textAlign: "center",
            boxShadow: "inset 0 1px 1px rgba(255, 255, 255, 0.02)",
            transition: "all 0.2s ease",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center"
          }}>
            <p style={{ margin: 0, fontSize: "1.25rem", fontWeight: 800, color: "#fff", display: "block", marginBottom: "0.2rem" }}>
              {profile.xp_total || 0}
            </p>
            <p style={{ margin: 0, fontSize: "0.65rem", color: "var(--text-muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em" }}>
              ⚡ {casualModeActive ? "Points" : "XP"}
            </p>
          </div>
          
          {/* Tanks */}
          <div style={{
            background: "rgba(255, 255, 255, 0.02)",
            border: "1px solid rgba(255, 255, 255, 0.04)",
            borderRadius: "12px",
            padding: "0.85rem 0.5rem",
            textAlign: "center",
            boxShadow: "inset 0 1px 1px rgba(255, 255, 255, 0.02)",
            transition: "all 0.2s ease",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center"
          }}>
            <p style={{ margin: 0, fontSize: "1.25rem", fontWeight: 800, color: "#fff", display: "block", marginBottom: "0.2rem" }}>
              {profile.tank_count || 0}
            </p>
            <p style={{ margin: 0, fontSize: "0.65rem", color: "var(--text-muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em" }}>
              🏠 Tanks
            </p>
          </div>

          {/* Species */}
          <div style={{
            background: "rgba(255, 255, 255, 0.02)",
            border: "1px solid rgba(255, 255, 255, 0.04)",
            borderRadius: "12px",
            padding: "0.85rem 0.5rem",
            textAlign: "center",
            boxShadow: "inset 0 1px 1px rgba(255, 255, 255, 0.02)",
            transition: "all 0.2s ease",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center"
          }}>
            <p style={{ margin: 0, fontSize: "1.25rem", fontWeight: 800, color: "#fff", display: "block", marginBottom: "0.2rem" }}>
              {profile.species_count || 0}
            </p>
            <p style={{ margin: 0, fontSize: "0.65rem", color: "var(--text-muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em" }}>
              🐟 Species
            </p>
          </div>

          {/* Tier */}
          <div style={{
            background: "rgba(255, 255, 255, 0.02)",
            border: `1px solid ${tierColor}33`,
            borderRadius: "12px",
            padding: "0.85rem 0.5rem",
            textAlign: "center",
            boxShadow: `inset 0 1px 1px ${tierColor}11`,
            transition: "all 0.2s ease",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center"
          }}>
            <p style={{ margin: 0, fontSize: "1.25rem", fontWeight: 800, color: tierColor, display: "block", marginBottom: "0.2rem" }}>
              {profile.companion_tier}
            </p>
            <p style={{ margin: 0, fontSize: "0.65rem", color: "var(--text-muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em" }}>
              👑 Tier
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
          showLocked={false}
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
