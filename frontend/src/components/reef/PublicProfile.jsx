/**
 * PublicProfile.jsx
 * 
 * Full public profile page for a breeder.
 * Shows: avatar, name, bio, stats, companion tier, Tankmates list,
 * their Currents, and a Tankmate request button.
 */

import React, { useState, useEffect } from "react";
import {
  Anchor,
  ArrowLeft,
  Check,
  Clock,
  Crown,
  Drop,
  FishSimple,
  Flag,
  GraduationCap,
  Lightning,
  Newspaper,
  PencilSimple,
  ShieldCheck,
  Star,
  UserPlus,
  UsersThree,
  Waves,
  X,
} from "@phosphor-icons/react";
import { ProfileCard } from "./ProfileCard";
import { CurrentCard } from "./CurrentCard";
import { ProfileEdit } from "./ProfileEdit";
import { BadgeShelf } from "./BadgeShelf";
import { FollowButton } from "./FollowButton";
import { SchoolInviteButton } from "./SchoolInviteButton";
import { MessageButton } from "./MessageButton";
import { DepthScoreMeter } from "./DepthScoreMeter";
import { MentorshipPanel } from "./MentorshipPanel";
import { ExpertAuditCard } from "./ExpertAuditCard";
import { ModerationPanel } from "./ModerationPanel";
import { ReviewModerationPanel } from "../reviews/ReviewModerationPanel";
import { useProfile, useTankmates, useRelationshipStatus, useSendTankmateRequest, useUpdateProfile, useEnsureProfile } from "../../hooks/useReefProfile";
import { useUserCurrents } from "../../hooks/useReefFeed";
import { useAuditsReceived } from "../../hooks/useAudits";
import { useUnlockGate } from "./UnlockPrompt";
import { useUserRoles } from "../../hooks/useUserRoles";
import { getCurrentWallet, isSupabaseConfigured } from "../../services/supabaseClient";
import { sameWallet } from "../../utils/wallet";
import { useAuth } from "../../contexts/AuthContext";
import { getFollowerCount, getFollowingCount } from "../../services/reefApi";
import { db } from "../../db";
import { EchoRenderer } from "../EchoRenderer";
import { useEchoFace } from "../../hooks/useEchoFace";
import { openEchoChat } from "../../services/echoChatBus";
import { RewardCreditsCard } from "../RewardCreditsCard";
import { getTierInfo, getPointsSuffix } from "../../utils/xp";
import "./ReefDaylight.css";
import "./ProfileDaylight.css";

// Legacy hobbyist tier names kept for backwards compat with old profile rows,
// plus the server-only cosmetic champion tiers. Real ladder tiers (Shallow,
// Coastal, Pelagic, Abyssal, Hadal) intentionally fall through to
// getTierInfo().colorHex below so they render their true colors rather than
// the bronze fallback. The tier color is only used for the avatar ring, which
// is decorative; tier names are always printed in ink.
const TIER_COLORS = {
  Bronze: "#cd7f32",
  Silver: "#c0c0c0",
  Gold: "#ffd700",
  Master: "#a855f7",
  "God-Tier": "#ffd700",
  "Hadal-Champion": "#f59e0b",
};

// Keeper-role badges: granted community authority (founder / steward).
// Higher priority first; we show the top one held.
const KEEPER_ROLE_BADGES = [
  { role: "founder", Icon: Crown, label: "Founder" },
  { role: "steward", Icon: ShieldCheck, label: "Steward" },
];

function pickRoleBadge(roles) {
  if (!roles || roles.length === 0) return null;
  return KEEPER_ROLE_BADGES.find((b) => roles.includes(b.role)) || null;
}

/**
 * Tier progression bar — shows how far into the current tier the user is and
 * what XP reaches the next tier. Derived purely from xp_total (no server call),
 * so it renders identically on your own profile and anyone else's.
 */
function TierProgress({ xp, casualModeActive }) {
  const info = getTierInfo(Number(xp) || 0);
  const suffix = getPointsSuffix(casualModeActive);
  const atMax = info.nextLevelXp == null;
  const nextInfo = atMax ? null : getTierInfo(info.nextLevelXp);
  const toNext = atMax ? 0 : Math.max(0, info.nextLevelXp - (Number(xp) || 0));

  return (
    <div className="pf-progress">
      <div className="pf-progress-head">
        <span className="pf-progress-tier">{info.key}</span>
        <span className="pf-progress-next">
          {atMax
            ? "Top tier reached"
            : `${toNext.toLocaleString()} ${suffix} to ${nextInfo.key}`}
        </span>
      </div>
      <div
        className="pf-progress-track"
        role="progressbar"
        aria-valuenow={Math.round(info.progressPct)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={atMax ? `${info.key}, top tier` : `${info.key} progress to ${nextInfo.key}`}
      >
        <div className="pf-progress-fill" style={{ width: `${info.progressPct}%` }} />
      </div>
    </div>
  );
}

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

function FollowerCounts({ walletAddress }) {
  const [followers, setFollowers] = useState(null);
  const [following, setFollowing] = useState(null);

  useEffect(() => {
    if (!walletAddress) return;
    getFollowerCount(walletAddress).then(setFollowers);
    getFollowingCount(walletAddress).then(setFollowing);
  }, [walletAddress]);

  if (followers === null && following === null) return null;

  return (
    <p className="pf-follows">
      <span>
        <strong>{followers ?? "–"}</strong> {followers === 1 ? "follower" : "followers"}
      </span>
      <span>
        <strong>{following ?? "–"}</strong> following
      </span>
    </p>
  );
}

function ConnectionButton({ targetWallet, casualModeActive }) {
  const { account } = useAuth();
  const currentWallet = account || getCurrentWallet();
  const { data: status, isLoading } = useRelationshipStatus(targetWallet);
  const sendRequest = useSendTankmateRequest();
  const [message, setMessage] = useState("");
  const [showMessageInput, setShowMessageInput] = useState(false);

  if (!currentWallet || sameWallet(currentWallet, targetWallet)) return null;
  if (isLoading) return null;

  if (status === "tankmate") {
    return (
      <span className="pf-pill pf-pill--ok">
        <Check size={16} weight="bold" aria-hidden="true" />
        {casualModeActive ? "Tankmates" : "Connected"}
      </span>
    );
  }

  if (status === "request_sent") {
    return (
      <span className="pf-pill pf-pill--wait">
        <Clock size={16} weight="bold" aria-hidden="true" />
        Request sent
      </span>
    );
  }

  const handleSend = () => {
    sendRequest.mutate({ targetWallet, message: message.trim() });
    setShowMessageInput(false);
    setMessage("");
  };

  if (!showMessageInput) {
    return (
      <button
        type="button"
        className="reef-btn reef-btn--primary"
        onClick={() => setShowMessageInput(true)}
        disabled={sendRequest.isPending}
      >
        <UserPlus size={18} weight="bold" aria-hidden="true" />
        {casualModeActive ? "Add tankmate" : "Connect"}
      </button>
    );
  }

  return (
    <div className="pf-note">
      <input
        type="text"
        className="reef-form-input"
        value={message}
        onChange={(e) => setMessage(e.target.value.slice(0, 200))}
        placeholder="Add a note (optional)"
        aria-label="Note to send with your request"
        onKeyDown={(e) => { if (e.key === "Enter") handleSend(); }}
        autoFocus
      />
      <button type="button" className="reef-btn reef-btn--primary" onClick={handleSend}>
        Send
      </button>
      <button
        type="button"
        className="reef-btn reef-btn--ghost pf-icon-btn"
        onClick={() => setShowMessageInput(false)}
        aria-label="Cancel"
      >
        <X size={18} weight="bold" aria-hidden="true" />
      </button>
    </div>
  );
}

export function PublicProfile({ walletAddress, onBack, onNavigateProfile, casualModeActive = false }) {
  const { data: profile, isLoading, refetch } = useProfile(walletAddress);
  const { data: tankmates } = useTankmates(walletAddress);
  // She thinks, talks and reacts with the corner Echo (same events, same core).
  const echoFace = useEchoFace(true);
  const userCurrents = useUserCurrents(walletAddress);
  const currents = userCurrents.data?.pages?.flatMap((p) => p.data) || [];
  const [editing, setEditing] = useState(false);
  const [creatingProfile, setCreatingProfile] = useState(false);
  const { account } = useAuth();
  const currentWallet = account || getCurrentWallet();
  const isOwnProfile = currentWallet && currentWallet.toLowerCase() === walletAddress?.toLowerCase();


  // Audits received by this user
  const { data: auditsResult } = useAuditsReceived(walletAddress);
  const audits = auditsResult?.data || [];

  // Moderation panel state
  const [showModeration, setShowModeration] = useState(false);
  // Review-reports moderation (Task 20) — same granted-authority gate, separate toggle
  const [showReviewModeration, setShowReviewModeration] = useState(false);
  // Moderation is now a GRANTED role (founder/steward), not a tier. useUnlockGate
  // resolves the VIEWER's authority; the panel is additionally gated on
  // isOwnProfile, so a moderator sees the tools on their own profile.
  const { hasAccess: canModerate } = useUnlockGate("canModerate");
  // Roles held by the profile BEING VIEWED, for the Founder/Steward badge.
  const { data: profileRoles = [] } = useUserRoles(walletAddress);

  // Auto-ensure profile exists for the user's own profile when it's not found
  const { data: ensuredProfile } = useEnsureProfile(
    isOwnProfile && !profile && !isLoading ? walletAddress : null
  );

  // Refetch profile after ensureProfile creates it
  useEffect(() => {
    if (ensuredProfile && !profile) {
      refetch();
    }
  }, [ensuredProfile, profile, refetch]);

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
          ? (uProfile.totalXp || 0)
          : 0;

        const localCompanions = await db.breederCompanion.toArray();
        const uCompanion = localCompanions.find(
          (c) => c.walletAddress?.toLowerCase() === walletAddress?.toLowerCase()
        );
        const companionTier = uCompanion?.currentTier || "Shallow";

        // Check if anything differs
        if (
          profile.tank_count !== tankCount ||
          profile.species_count !== speciesCount ||
          profile.xp_total !== xpTotal ||
          profile.companion_tier !== companionTier
        ) {
          if (!active) return;

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
      <div className="pf" aria-busy="true">
        <span className="pf-sr-only" role="status">Loading profile…</span>
        <div className="reef-skeleton" style={{ height: 260 }} />
        <div className="reef-skeleton" style={{ height: 140 }} />
      </div>
    );
  }

  const backToReef = onBack ? (
    <div className="reef-empty-actions">
      <button type="button" className="reef-btn" onClick={onBack}>
        <ArrowLeft size={18} weight="bold" aria-hidden="true" />
        Back to The Reef
      </button>
    </div>
  ) : null;

  if (!profile) {
    // If it's the user's own profile, show a brief loading state then fall back gracefully
    if (isOwnProfile && isSupabaseConfigured()) {
      // If ensureProfile already ran and returned null (failed), don't stay stuck
      if (ensuredProfile === null && !isLoading) {
        return (
          <div className="pf">
            <div className="reef-empty">
              <span className="reef-empty-icon"><FishSimple size={26} weight="duotone" aria-hidden="true" /></span>
              <h2 className="reef-empty-title">We couldn&apos;t load your profile</h2>
              <p className="reef-empty-lead">Reload the page or sign in again.</p>
              {backToReef}
            </div>
          </div>
        );
      }
      return (
        <div className="pf">
          <div className="reef-empty reef-empty--flat" role="status">
            <p className="reef-empty-title">Setting up your profile…</p>
          </div>
        </div>
      );
    }

    return (
      <div className="pf">
        <div className="reef-empty">
          <span className="reef-empty-icon"><FishSimple size={26} weight="duotone" aria-hidden="true" /></span>
          <h2 className="reef-empty-title">Profile not found</h2>
          <p className="reef-empty-lead">We couldn&apos;t find this keeper&apos;s profile.</p>
          {backToReef}
        </div>
      </div>
    );
  }

  const displayName = profile.display_name || truncateWallet(walletAddress);
  const headerTierInfo = getTierInfo(profile.xp_total || 0);
  const tierColor = TIER_COLORS[profile.companion_tier] || headerTierInfo.colorHex || "#cd7f32";
  const roleBadge = pickRoleBadge(profileRoles);

  return (
    <div className="pf">
      {onBack && (
        <button type="button" className="reef-btn reef-btn--ghost reef-back" onClick={onBack}>
          <ArrowLeft size={18} weight="bold" aria-hidden="true" />
          {casualModeActive ? "Back to The Reef" : "Back"}
        </button>
      )}

      {/* Profile header card: identity, actions, stats, XP progress, follows */}
      <section className="pf-hero" aria-labelledby="pf-name">
        {/* Echo in the profile header. The same character for every keeper, so
            she advertises no stage or DNA the viewer could read as this person's
            achievement. She mirrors the corner Echo's face (useEchoFace) and
            tapping her opens the chat. */}
        <button
          type="button"
          className="reef-profile-echo"
          onClick={() => openEchoChat()}
          aria-label="Ask Echo"
          title="Ask Echo"
        >
          <EchoRenderer size={92} expression={echoFace} animated />
        </button>
        {/* Avatar + name. Padded on the right so nothing runs under Echo. */}
        <div className="pf-id">
          <div
            className="pf-avatar"
            aria-hidden="true"
            style={{
              backgroundImage: profile.avatar_url ? `url(${profile.avatar_url})` : walletGradient(walletAddress),
              borderColor: tierColor,
            }}
          />
          <div className="pf-id-text">
            <div className="pf-name-row">
              <h2 id="pf-name" className="pf-name">{displayName}</h2>
              {roleBadge && (
                <span
                  className={`pf-role pf-role--${roleBadge.role}`}
                  title={`${roleBadge.label}. A community role granted by the Aquacellum team.`}
                >
                  <roleBadge.Icon size={14} weight="fill" aria-hidden="true" />
                  {roleBadge.label}
                </span>
              )}
            </div>
            <p className="pf-address">{truncateWallet(walletAddress)}</p>
          </div>
        </div>

        <div className="pf-actions">
          <ConnectionButton targetWallet={walletAddress} casualModeActive={casualModeActive} />
          {!isOwnProfile && (
            <FollowButton targetWallet={walletAddress} />
          )}
          {!isOwnProfile && (
            <MessageButton targetWallet={walletAddress} onOpenConversation={(convoId, wallet) => {
              // Dispatch event for ReefFeed to handle navigation
              window.dispatchEvent(new CustomEvent("reef_open_conversation", { detail: { conversationId: convoId, targetWallet: wallet } }));
            }} />
          )}
          {!isOwnProfile && (
            <SchoolInviteButton targetWallet={walletAddress} />
          )}
          {isOwnProfile && !editing && (
            <button type="button" className="reef-btn" onClick={() => setEditing(true)}>
              <PencilSimple size={18} weight="bold" aria-hidden="true" />
              Edit profile
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
        {profile.bio && <p className="pf-bio">{profile.bio}</p>}

        {/* Stats: label first in the DOM (read as "XP, 1,584"), value shown on top. */}
        <dl className="pf-stats">
          <div className="pf-stat">
            <dt><Lightning size={15} weight="fill" aria-hidden="true" />{casualModeActive ? "Points" : "XP"}</dt>
            <dd>{(profile.xp_total || 0).toLocaleString()}</dd>
          </div>
          <div className="pf-stat">
            <dt><Drop size={15} weight="fill" aria-hidden="true" />Tanks</dt>
            <dd>{(profile.tank_count || 0).toLocaleString()}</dd>
          </div>
          <div className="pf-stat">
            <dt><FishSimple size={15} weight="fill" aria-hidden="true" />Species</dt>
            <dd>{(profile.species_count || 0).toLocaleString()}</dd>
          </div>
          <div className="pf-stat">
            <dt><Waves size={15} weight="bold" aria-hidden="true" />XP Tier</dt>
            <dd>{profile.companion_tier}</dd>
          </div>
        </dl>

        {/* Tier progression: where you stand within your tier */}
        <TierProgress xp={profile.xp_total || 0} casualModeActive={casualModeActive} />

        {/* Follower / Following counts */}
        <FollowerCounts walletAddress={walletAddress} />
      </section>

      {/* Reward credits — own profile only (private earnings). The one place to
          see everything earned: balance, tier discount, next payout, history. */}
      {isOwnProfile && (
        <div>
          <RewardCreditsCard casualModeActive={casualModeActive} />
        </div>
      )}

      {/* Badge Shelf (renders its own card, or nothing when no badge is earned) */}
      <BadgeShelf
        stats={{
          tankCount: profile.tank_count || 0,
          speciesCount: profile.species_count || 0,
          companionTier: profile.companion_tier || "Shallow",
          xpTotal: profile.xp_total || 0,
          postCount: currents.length,
          insightCount: 0, // TODO: query from species_insights
          tankmateCount: tankmates?.length || 0,
          // Dex completion percentage — drives the Explorer/Collector/Naturalist/
          // Encyclopedist/Complete Dex badges. Requires server-side dex_entries
          // query for the viewed profile; wired in Phase A of the cosmetic spec.
          dexPercent: 0, // TODO: useSpeciesMastery → computeDexCompletion
        }}
        showLocked={false}
        casualModeActive={casualModeActive}
      />

      {/* Depth reputation is a separate verified-contribution ledger, not XP. */}
      <section className="pf-card" aria-labelledby="pf-depth-title">
        <h3 id="pf-depth-title" className="pf-section-title">
          <Anchor size={20} weight="bold" aria-hidden="true" />
          {casualModeActive ? "Community Reputation" : "Depth Reputation"}
        </h3>
        <DepthScoreMeter
          walletAddress={walletAddress}
          casualModeActive={casualModeActive}
          fallbackScore={profile.depth_score ?? 0}
          fallbackTier={profile.depth_tier ?? undefined}
        />
      </section>

      {/* Expert Audits Received */}
      {audits.length > 0 && (
        <section className="pf-card" aria-labelledby="pf-audits-title">
          <h3 id="pf-audits-title" className="pf-section-title">
            <Star size={20} weight="bold" aria-hidden="true" />
            {casualModeActive ? "Tank reviews" : "Expert audits"} ({audits.length})
          </h3>
          <div className="pf-stack">
            {audits.slice(0, 3).map((audit) => (
              <ExpertAuditCard
                key={audit.id}
                audit={audit}
                onViewProfile={onNavigateProfile}
              />
            ))}
            {audits.length > 3 && (
              <p className="pf-more">
                +{audits.length - 3} more {casualModeActive ? "reviews" : "audits"}
              </p>
            )}
          </div>
        </section>
      )}

      {/* Mentorship. Own profile only: on anyone else's profile the panel has
          nothing it can show (its reads are own-profile only), so the heading
          would sit over an empty card. */}
      {isOwnProfile && (
        <section className="pf-card" aria-labelledby="pf-mentor-title">
          <h3 id="pf-mentor-title" className="pf-section-title">
            <GraduationCap size={20} weight="bold" aria-hidden="true" />
            Mentorship
          </h3>
          <MentorshipPanel
            walletAddress={walletAddress}
            acceptingMentees={profile.accepting_mentees === true}
            onViewProfile={onNavigateProfile}
            casualModeActive={casualModeActive}
          />
        </section>
      )}

      {/* Moderation Panel (granted founders/stewards, on own profile). The
          panel mounts only after the toggle is pressed: it signs a request. */}
      {isOwnProfile && canModerate && (
        <div className="pf-tool">
          <button
            type="button"
            className="reef-btn reef-btn--block"
            onClick={() => setShowModeration(!showModeration)}
            aria-expanded={showModeration}
          >
            <ShieldCheck size={18} weight="bold" aria-hidden="true" />
            {showModeration ? "Hide moderation tools" : "Moderation tools"}
          </button>
          {showModeration && (
            <div>
              <ModerationPanel onBack={() => setShowModeration(false)} />
            </div>
          )}
        </div>
      )}

      {/* Review Reports moderation (Task 20): same granted-authority gate,
          composing the exact ModerationPanel pattern for the review_reports
          queue instead of a bespoke moderation surface. */}
      {isOwnProfile && canModerate && (
        <div className="pf-tool">
          <button
            type="button"
            className="reef-btn reef-btn--block"
            onClick={() => setShowReviewModeration(!showReviewModeration)}
            aria-expanded={showReviewModeration}
          >
            <Flag size={18} weight="bold" aria-hidden="true" />
            {showReviewModeration ? "Hide review reports" : "Review reports"}
          </button>
          {showReviewModeration && (
            <div>
              <ReviewModerationPanel onBack={() => setShowReviewModeration(false)} />
            </div>
          )}
        </div>
      )}

      {/* Tankmates section */}
      {tankmates && tankmates.length > 0 && (
        <section className="pf-card" aria-labelledby="pf-tankmates-title">
          <h3 id="pf-tankmates-title" className="pf-section-title">
            <UsersThree size={20} weight="bold" aria-hidden="true" />
            {casualModeActive ? "Tankmates" : "Connections"} ({tankmates.length})
          </h3>
          <div className="pf-tankmates">
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
              <span className="pf-more">+{tankmates.length - 8} more</span>
            )}
          </div>
        </section>
      )}

      {/* User's Currents. Each post is already a card, so no outer card here. */}
      <section className="pf-posts" aria-labelledby="pf-posts-title">
        <h3 id="pf-posts-title" className="pf-section-title">
          <Newspaper size={20} weight="bold" aria-hidden="true" />
          {casualModeActive ? "Tank updates" : "Posts"}{currents.length > 0 ? ` (${currents.length})` : ""}
        </h3>

        {currents.length === 0 && (
          <div className="reef-empty reef-empty--flat">
            <p className="pf-muted">No posts yet.</p>
          </div>
        )}

        {currents.length > 0 && (
          <div className="pf-list">
            {currents.map((current) => (
              <CurrentCard
                key={current.id}
                current={current}
                casualModeActive={casualModeActive}
                onProfileClick={onNavigateProfile}
              />
            ))}
          </div>
        )}

        {userCurrents.hasNextPage && (
          <button
            type="button"
            className="reef-btn reef-btn--block"
            style={{ marginTop: "1rem" }}
            onClick={() => userCurrents.fetchNextPage()}
            disabled={userCurrents.isFetchingNextPage}
          >
            {userCurrents.isFetchingNextPage ? "Loading…" : "Load more"}
          </button>
        )}
      </section>
    </div>
  );
}
