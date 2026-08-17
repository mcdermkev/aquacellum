/**
 * SchoolPage.jsx
 * 
 * Full school view with tabs: Feed / Members / Challenges / Chat / Settings.
 */

import React, { useState } from "react";
import { useSchoolById, useMySchoolRole, useSchoolMembers, useSchoolChallenges, useLeaveSchool, useUpdateMemberRole, useRemoveMember, useCreateChallenge, useUpdateSchool, useSchoolPosts, useCreateSchoolPost, useDeleteSchoolPost, useSetSchoolPostPinned, useToggleSchoolPostReaction } from "../../hooks/useSchools";
import { useChallengeParticipants, useChallengeSubmissions, useJoinChallenge, useLeaveChallenge, useSubmitChallengeEntry, useVoteForEntry, useFinalizeChallenge, useClaimChallengeReward } from "../../hooks/useSchools";
import { getCurrentWallet } from "../../services/supabaseClient";
import { sameWallet } from "../../utils/wallet";
import { awardXp } from "../../utils/xp";
import {
  resolveChallengePhase,
  CHALLENGE_PHASE,
  challengeScoring,
  canJoinChallenge,
  canSubmitToChallenge,
  canVoteInChallenge,
  canFinalizeChallenge,
} from "../../utils/challenges";
import { ProfileCard } from "./ProfileCard";
import { SchoolChat } from "./SchoolChat";
import { ChallengeCard } from "./ChallengeCard";
import { useScrollAffordance } from "../../hooks/useScrollAffordance";

const TYPE_EMOJI = {
  species: "🐟",
  regional: "🌍",
  breeding: "🧬",
  conservation: "🌿",
  equipment: "⚙️",
  open: "🌊",
};

export function SchoolPage({ schoolId, onBack, onViewProfile }) {
  const tabsScrollRef = useScrollAffordance();
  const [activeTab, setActiveTab] = useState("feed");
  
  const { data: schoolResult, isLoading } = useSchoolById(schoolId);
  const { data: myRole } = useMySchoolRole(schoolId);
  const { data: membersResult } = useSchoolMembers(schoolId);
  const { data: challengesResult } = useSchoolChallenges(schoolId);
  
  const leaveSchoolMutation = useLeaveSchool();
  const updateRoleMutation = useUpdateMemberRole();
  const removeMemberMutation = useRemoveMember();

  const school = schoolResult?.data;
  const members = membersResult?.data || [];
  const challenges = challengesResult?.data || [];
  const isAdmin = myRole === "founder" || myRole === "elder";
  // Posting is gated on membership. A visitor sees the feed but gets told to join
  // rather than being handed a composer whose insert RLS would reject.
  const isMember = myRole === "founder" || myRole === "elder" || myRole === "member";
  const myWallet = getCurrentWallet();

  if (isLoading) {
    return (
      <div className="glass-card" style={{ padding: "2rem", textAlign: "center", color: "var(--text-muted)" }}>
        Loading school...
      </div>
    );
  }

  if (!school) {
    return (
      <div className="glass-card" style={{ padding: "2rem", textAlign: "center", color: "var(--text-muted)" }}>
        School not found.
        <button onClick={onBack} className="btn-secondary" style={{ marginTop: "1rem", display: "block", marginLeft: "auto", marginRight: "auto" }}>
          ← Back to Directory
        </button>
      </div>
    );
  }

  const tabs = [
    { id: "feed", label: "Feed" },
    { id: "members", label: `Members (${school.member_count})` },
    { id: "challenges", label: "Challenges" },
    { id: "chat", label: "Chat" },
    ...(isAdmin ? [{ id: "settings", label: "⚙️" }] : []),
  ];

  return (
    <div className="school-page" style={{ maxWidth: "800px", margin: "0 auto" }}>
      {/* Back Button */}
      <button
        onClick={onBack}
        style={{
          background: "none",
          border: "none",
          color: "var(--text-secondary)",
          fontSize: "0.8rem",
          cursor: "pointer",
          marginBottom: "1rem",
          padding: "0.3rem 0",
        }}
      >
        ← Back to Schools
      </button>

      {/* School Header */}
      <div className="glass-card" style={{
        padding: "0",
        borderRadius: "var(--radius-md)",
        overflow: "hidden",
        marginBottom: "1.5rem",
        border: "1px solid rgba(56, 189, 248, 0.12)",
      }}>
        {/* Banner */}
        <div style={{
          height: "140px",
          background: school.banner_url
            ? `url(${school.banner_url}) center/cover`
            : "linear-gradient(135deg, rgba(56, 189, 248, 0.2) 0%, rgba(168, 85, 247, 0.2) 100%)",
        }} />

        {/* Info */}
        <div style={{ padding: "1.25rem 1.5rem" }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "1rem" }}>
            <div>
              <h2 style={{ margin: "0 0 0.3rem", fontSize: "1.2rem", color: "#fff" }}>
                {TYPE_EMOJI[school.school_type]} {school.name}
              </h2>
              {school.description && (
                <p style={{ margin: "0 0 0.75rem", fontSize: "0.8rem", color: "var(--text-secondary)", lineHeight: "1.5" }}>
                  {school.description}
                </p>
              )}
              <div style={{ display: "flex", gap: "1rem", fontSize: "0.7rem", color: "var(--text-muted)" }}>
                <span>👥 {school.member_count} member{school.member_count !== 1 ? "s" : ""}</span>
                <span style={{ textTransform: "capitalize" }}>{school.school_type}</span>
                {school.is_invite_only && <span>🔒 Invite only</span>}
              </div>
            </div>

            {myRole && myRole !== "founder" && (
              <button
                onClick={() => leaveSchoolMutation.mutate(schoolId)}
                className="btn-secondary"
                style={{ padding: "0.4rem 0.8rem", fontSize: "0.7rem", whiteSpace: "nowrap" }}
              >
                Leave
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="scroll-fade" ref={tabsScrollRef} style={{
        display: "flex",
        gap: "0.25rem",
        marginBottom: "1.5rem",
        overflowX: "auto",
        paddingBottom: "0.25rem",
      }}>
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              padding: "0.5rem 1rem",
              borderRadius: "var(--radius-sm)",
              border: `1px solid ${activeTab === tab.id ? "rgba(56, 189, 248, 0.3)" : "transparent"}`,
              background: activeTab === tab.id ? "rgba(56, 189, 248, 0.1)" : "transparent",
              color: activeTab === tab.id ? "#fff" : "var(--text-secondary)",
              fontSize: "0.8rem",
              cursor: "pointer",
              whiteSpace: "nowrap",
              transition: "all 0.2s ease",
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {activeTab === "feed" && (
        <SchoolFeedTab
          school={school}
          schoolId={schoolId}
          isMember={isMember}
          isAdmin={isAdmin}
          myWallet={myWallet}
          onViewProfile={onViewProfile}
        />
      )}

      {activeTab === "members" && (
        <MembersTab
          members={members}
          isAdmin={isAdmin}
          schoolId={schoolId}
          onViewProfile={onViewProfile}
          onPromote={(wallet) => updateRoleMutation.mutate({ schoolId, targetWallet: wallet, newRole: "elder" })}
          onDemote={(wallet) => updateRoleMutation.mutate({ schoolId, targetWallet: wallet, newRole: "member" })}
          // Removing a member was a single unguarded click sitting next to
          // Promote/Demote, with no way back — the kicked member has to be
          // re-invited. Destructive and irreversible actions get a confirm.
          onKick={(wallet, label) => {
            if (!confirm(`Remove ${label || "this member"} from the school? They'll need to be invited back.`)) return;
            removeMemberMutation.mutate({ schoolId, targetWallet: wallet });
          }}
        />
      )}

      {activeTab === "challenges" && (
        <ChallengesTab
          challenges={challenges}
          schoolId={schoolId}
          isAdmin={isAdmin}
          isMember={isMember}
          myWallet={myWallet}
        />
      )}

      {activeTab === "chat" && (
        <SchoolChat schoolId={schoolId} isAdmin={isAdmin} />
      )}

      {activeTab === "settings" && isAdmin && (
        <SettingsTab school={school} schoolId={schoolId} />
      )}
    </div>
  );
}

const REACTION_EMOJI = ["🌊", "🐟", "🔥", "👏", "🧬", "❤️"];

/**
 * The school feed.
 *
 * Replaces a "School feed coming soon" placeholder that was also the DEFAULT tab,
 * so every school opened onto an empty state.
 *
 * Schools have their own posts rather than a filtered view of members' Currents:
 * a Current belongs to a keeper's tank, so a Currents-derived feed would be
 * something nobody could deliberately post to. Conversation still belongs in the
 * Chat tab — this is the durable layer, which is why posts can be pinned.
 */
function SchoolFeedTab({ school, schoolId, isMember, isAdmin, myWallet, onViewProfile }) {
  const { data: postsResult, isLoading, isError, error } = useSchoolPosts(schoolId);
  const createPost = useCreateSchoolPost(schoolId);
  const deletePost = useDeleteSchoolPost(schoolId);
  const setPinned = useSetSchoolPostPinned(schoolId);
  const toggleReaction = useToggleSchoolPostReaction(schoolId);

  const [draft, setDraft] = useState("");
  const [composerError, setComposerError] = useState(null);

  const posts = postsResult?.data || [];
  const loadError = postsResult?.error || (isError ? error?.message : null);

  const handlePost = () => {
    setComposerError(null);
    createPost.mutate(
      { body: draft },
      {
        onSuccess: (res) => {
          if (res?.error) {
            setComposerError(typeof res.error === "string" ? res.error : res.error.message);
          } else {
            setDraft("");
          }
        },
        onError: (err) => setComposerError(err?.message || "Couldn't post."),
      }
    );
  };

  const handleDelete = (postId) => {
    if (!confirm("Delete this post? It will be removed from the feed.")) return;
    deletePost.mutate({ postId });
  };

  return (
    <div className="school-feed">
      {/* Composer — members only. Visitors get told why, rather than seeing a
          box that fails on submit. */}
      {isMember ? (
        <div className="school-feed__composer">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={`Share something with ${school?.name || "the school"}…`}
            rows={3}
            maxLength={2000}
            aria-label="Write a post"
            className="school-feed__composer-input"
          />
          <div className="school-feed__composer-actions">
            <span className="school-feed__counter">{draft.length}/2000</span>
            <button
              className="btn btn--primary btn--sm"
              onClick={handlePost}
              disabled={!draft.trim() || createPost.isPending}
            >
              {createPost.isPending ? "Posting…" : "Post"}
            </button>
          </div>
          {composerError && (
            <p className="school-feed__error" role="alert">{composerError}</p>
          )}
        </div>
      ) : (
        <p className="school-feed__gate text-muted">
          Join this school to post to its feed.
        </p>
      )}

      {/* Tracked species — this was stored on every school and never read
          anywhere in the UI, so members had no idea what the school followed. */}
      {Array.isArray(school?.tracked_species) && school.tracked_species.length > 0 && (
        <div className="school-feed__tracked">
          <span className="text-muted">Tracking</span>
          {school.tracked_species.slice(0, 8).map((s) => (
            <span key={typeof s === "string" ? s : s?.name} className="school-feed__species-chip">
              {typeof s === "string" ? s : s?.name || s?.common_name}
            </span>
          ))}
        </div>
      )}

      {isLoading ? (
        <p className="text-muted">Loading the feed…</p>
      ) : loadError ? (
        <p className="school-feed__error" role="alert">Couldn't load the feed. {String(loadError)}</p>
      ) : posts.length === 0 ? (
        <div className="school-feed__empty">
          <div style={{ fontSize: "1.5rem", marginBottom: "0.5rem" }}>📰</div>
          <p>No posts yet.</p>
          <p className="text-muted">
            {isMember
              ? "Be the first — share a spawn, ask a question, or introduce yourself."
              : "This school hasn't posted anything yet."}
          </p>
        </div>
      ) : (
        <ul className="school-feed__list">
          {posts.map((post) => (
            <SchoolPostCard
              key={post.id}
              post={post}
              isAdmin={isAdmin}
              isMember={isMember}
              myWallet={myWallet}
              onViewProfile={onViewProfile}
              onDelete={handleDelete}
              onTogglePin={(pinned) => setPinned.mutate({ postId: post.id, pinned })}
              onReact={(emoji) => toggleReaction.mutate({ postId: post.id, emoji })}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function SchoolPostCard({
  post,
  isAdmin,
  isMember,
  myWallet,
  onViewProfile,
  onDelete,
  onTogglePin,
  onReact,
}) {
  const [showReactions, setShowReactions] = useState(false);

  const isAuthor = sameWallet(post.author_wallet, myWallet);
  const isPinned = !!post.pinned_at;
  const reactions = post.reactions || [];

  // Group reactions by emoji so the card shows "🌊 3  🔥 1" rather than a flat
  // count, and so the current user's own reaction can be highlighted.
  const grouped = reactions.reduce((acc, r) => {
    acc[r.emoji] = acc[r.emoji] || { count: 0, mine: false };
    acc[r.emoji].count += 1;
    if (sameWallet(r.wallet_address, myWallet)) acc[r.emoji].mine = true;
    return acc;
  }, {});

  return (
    <li className={`school-post ${isPinned ? "school-post--pinned" : ""}`}>
      {isPinned && <span className="school-post__pin-badge">📌 Pinned</span>}

      <div className="school-post__header">
        <ProfileCard
          walletAddress={post.profile?.wallet_address || post.author_wallet}
          displayName={post.profile?.display_name}
          avatarUrl={post.profile?.avatar_url}
          companionTier={post.profile?.companion_tier}
          size="small"
          onClick={onViewProfile ? () => onViewProfile(post.author_wallet) : undefined}
        />
        <time dateTime={post.created_at} className="school-post__time">
          {new Date(post.created_at).toLocaleDateString(undefined, {
            month: "short",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit",
          })}
          {post.edited_at && <span className="text-muted"> · edited</span>}
        </time>
      </div>

      <p className="school-post__body">{post.body}</p>

      {post.image_url && (
        <img src={post.image_url} alt="" className="school-post__image" loading="lazy" />
      )}

      <div className="school-post__actions">
        {/* Existing reaction tallies */}
        {Object.entries(grouped).map(([emoji, { count, mine }]) => (
          <button
            key={emoji}
            className={`school-post__reaction ${mine ? "school-post__reaction--mine" : ""}`}
            onClick={() => onReact(emoji)}
            disabled={!isMember}
            aria-label={`${count} reacted with ${emoji}${mine ? ", including you" : ""}`}
          >
            {emoji} {count}
          </button>
        ))}

        {isMember && (
          <div className="school-post__react-wrap">
            <button
              className="btn btn--ghost btn--xs"
              onClick={() => setShowReactions((v) => !v)}
              aria-expanded={showReactions}
              aria-label="Add a reaction"
            >
              ＋
            </button>
            {showReactions && (
              <div className="school-post__react-picker" role="menu">
                {REACTION_EMOJI.map((emoji) => (
                  <button
                    key={emoji}
                    onClick={() => { onReact(emoji); setShowReactions(false); }}
                    className="school-post__react-option"
                    aria-label={`React with ${emoji}`}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <span className="school-post__spacer" />

        {isAdmin && (
          <button className="btn btn--ghost btn--xs" onClick={() => onTogglePin(!isPinned)}>
            {isPinned ? "Unpin" : "Pin"}
          </button>
        )}
        {(isAuthor || isAdmin) && (
          <button className="btn btn--ghost btn--xs" onClick={() => onDelete(post.id)}>
            Delete
          </button>
        )}
      </div>
    </li>
  );
}

function MembersTab({ members, isAdmin, schoolId, onViewProfile, onPromote, onDemote, onKick }) {
  const rolePriority = { founder: 0, elder: 1, member: 2, visitor: 3 };
  const sorted = [...members].sort((a, b) => (rolePriority[a.role] || 3) - (rolePriority[b.role] || 3));

  const roleLabels = {
    founder: { label: "Founder", color: "var(--accent-amber)" },
    elder: { label: "Elder", color: "var(--accent-blue)" },
    member: { label: "Member", color: "var(--text-secondary)" },
    visitor: { label: "Visitor", color: "var(--text-muted)" },
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
      {sorted.map((member) => {
        const profile = member.profile;
        if (!profile) return null;
        const roleInfo = roleLabels[member.role] || roleLabels.member;

        return (
          <div
            key={profile.wallet_address}
            className="glass-card"
            style={{
              padding: "0.75rem 1rem",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              borderRadius: "var(--radius-sm)",
              border: "1px solid rgba(255,255,255,0.06)",
            }}
          >
            <div
              style={{ display: "flex", alignItems: "center", gap: "0.75rem", cursor: "pointer" }}
              onClick={() => onViewProfile?.(profile.wallet_address)}
            >
              <div style={{
                width: "32px",
                height: "32px",
                borderRadius: "50%",
                background: profile.avatar_url
                  ? `url(${profile.avatar_url}) center/cover`
                  : "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
                flexShrink: 0,
              }} />
              <div>
                <div style={{ fontSize: "0.8rem", color: "#fff", fontWeight: "500" }}>
                  {profile.display_name || `${profile.wallet_address.slice(0, 6)}...${profile.wallet_address.slice(-4)}`}
                </div>
                <span style={{ fontSize: "0.65rem", color: roleInfo.color, fontWeight: "600" }}>
                  {roleInfo.label}
                </span>
              </div>
            </div>

            {isAdmin && member.role !== "founder" && (
              <div style={{ display: "flex", gap: "0.3rem" }}>
                {member.role === "member" && (
                  <button
                    onClick={() => onPromote(profile.wallet_address)}
                    style={{ background: "none", border: "none", color: "var(--accent-blue)", fontSize: "0.65rem", cursor: "pointer" }}
                    title="Promote to Elder"
                  >
                    ⬆️
                  </button>
                )}
                {member.role === "elder" && (
                  <button
                    onClick={() => onDemote(profile.wallet_address)}
                    style={{ background: "none", border: "none", color: "var(--text-muted)", fontSize: "0.65rem", cursor: "pointer" }}
                    title="Demote to Member"
                  >
                    ⬇️
                  </button>
                )}
                <button
                  onClick={() => onKick(profile.wallet_address, profile.display_name)}
                  style={{ background: "none", border: "none", color: "var(--accent-red)", fontSize: "0.65rem", cursor: "pointer" }}
                  title="Remove from school"
                >
                  ✕
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function ChallengesTab({ challenges, schoolId, isAdmin, isMember, myWallet }) {
  const [showForm, setShowForm] = useState(false);
  const [openId, setOpenId] = useState(null);

  // Group by DERIVED phase, not the stored `status`. The old code filtered on
  // c.status, which createChallenge set once at insert and nothing ever updated —
  // so every challenge stayed 'upcoming' and the "Completed" section was empty by
  // construction, no matter how long ago the challenge finished.
  const live = challenges.filter((c) => {
    const p = resolveChallengePhase(c);
    return p === CHALLENGE_PHASE.UPCOMING || p === CHALLENGE_PHASE.ACTIVE || p === CHALLENGE_PHASE.SCORING;
  });
  const completed = challenges.filter((c) => {
    const p = resolveChallengePhase(c);
    return p === CHALLENGE_PHASE.COMPLETED || p === CHALLENGE_PHASE.CANCELLED;
  });

  return (
    <div>
      {/* Create Challenge button for admins */}
      {isAdmin && (
        <div style={{ marginBottom: "1rem" }}>
          {!showForm ? (
            <button
              onClick={() => setShowForm(true)}
              style={{
                padding: "0.5rem 1rem",
                borderRadius: "8px",
                border: "none",
                background: "linear-gradient(135deg, #f59e0b, #d97706)",
                color: "#fff",
                fontSize: "0.75rem",
                fontWeight: 600,
                cursor: "pointer",
                boxShadow: "0 3px 10px rgba(245, 158, 11, 0.2)",
              }}
            >
              🏆 + Create Challenge
            </button>
          ) : (
            <CreateChallengeForm
              schoolId={schoolId}
              onCancel={() => setShowForm(false)}
              onCreated={() => setShowForm(false)}
            />
          )}
        </div>
      )}

      {live.length === 0 && completed.length === 0 && !showForm ? (
        <div style={{ textAlign: "center", padding: "2rem 1rem", color: "var(--text-muted)" }}>
          <div style={{ fontSize: "1.5rem", marginBottom: "0.5rem" }}>🏆</div>
          <p style={{ fontSize: "0.85rem" }}>No challenges yet.</p>
          {isAdmin && (
            <p style={{ fontSize: "0.7rem" }}>Click "Create Challenge" above to get your school started!</p>
          )}
          {!isAdmin && (
            <p style={{ fontSize: "0.7rem" }}>Your school's admins can create challenges for members to compete in.</p>
          )}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          {live.map((challenge) => (
            <ChallengePanel
              key={challenge.id}
              challenge={challenge}
              schoolId={schoolId}
              isAdmin={isAdmin}
              isMember={isMember}
              myWallet={myWallet}
              isOpen={openId === challenge.id}
              onToggle={() => setOpenId(openId === challenge.id ? null : challenge.id)}
            />
          ))}
          {completed.length > 0 && (
            <>
              <h4 style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: "1rem" }}>Completed</h4>
              {completed.map((challenge) => (
                <ChallengePanel
                  key={challenge.id}
                  challenge={challenge}
                  schoolId={schoolId}
                  isAdmin={isAdmin}
                  isMember={isMember}
                  myWallet={myWallet}
                  isOpen={openId === challenge.id}
                  onToggle={() => setOpenId(openId === challenge.id ? null : challenge.id)}
                />
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * A challenge, and everything you can do with it.
 *
 * Previously a challenge was a card and nothing else: no way to enter, submit,
 * vote, or see a result. This adds the lifecycle — join, submit, vote, and a
 * host-run finalize that scores and closes it.
 *
 * What each phase offers depends on the type, because the four types genuinely
 * differ (see utils/challenges.js). breeding_sprint and care_streak are scored
 * from data the app already stores, so entrants just join. photo_contest and
 * growout_race need an entry, because nothing stored can judge them.
 */
function ChallengePanel({ challenge, schoolId, isAdmin, isMember, myWallet, isOpen, onToggle }) {
  const phase = resolveChallengePhase(challenge);
  const scoring = challengeScoring(challenge.challenge_type);

  const { data: participantsResult } = useChallengeParticipants(isOpen ? challenge.id : null);
  const { data: submissionsResult } = useChallengeSubmissions(
    isOpen && scoring.needsSubmission ? challenge.id : null
  );

  const join = useJoinChallenge(challenge.id, schoolId);
  const leave = useLeaveChallenge(challenge.id, schoolId);
  const submit = useSubmitChallengeEntry(challenge.id, schoolId);
  const vote = useVoteForEntry(challenge.id, schoolId);
  const finalize = useFinalizeChallenge(challenge.id, schoolId);
  const claim = useClaimChallengeReward(challenge.id, schoolId);

  const [entryDraft, setEntryDraft] = useState({ body: "", imageUrl: "", declaredValue: "" });
  const [actionError, setActionError] = useState(null);
  const [claimToast, setClaimToast] = useState(null);

  const participants = participantsResult?.data || [];
  const submissions = submissionsResult?.data || [];

  const me = participants.find((p) => sameWallet(p.wallet_address, myWallet));
  const myEntry = submissions.find((s) => sameWallet(s.wallet_address, myWallet));
  const myVote = submissions.find((s) => (s.votes || []).some((v) => sameWallet(v.voter_wallet, myWallet)));

  // Surface the DB's message rather than a generic failure — the triggers write
  // their errors for the person reading them ("You cannot vote for your own
  // entry", "Submissions are only open while the challenge is running").
  const run = (mutation, args) => {
    setActionError(null);
    mutation.mutate(args, {
      onSuccess: (res) => {
        if (res?.error) {
          setActionError(typeof res.error === "string" ? res.error : res.error.message);
        }
      },
      onError: (err) => setActionError(err?.message || "That didn't work."),
    });
  };

  const handleClaim = () => {
    setActionError(null);
    claim.mutate(undefined, {
      onSuccess: (res) => {
        if (res?.error) {
          setActionError(typeof res.error === "string" ? res.error : res.error.message);
          return;
        }
        if (!res?.data?.claimed) return; // already claimed, or not scored yet
        // Fixed platform amounts keyed off the placing the DB computed — never off
        // challenge.reward_xp, which the host controls and could set to anything.
        const won = res.data.rank === 1;
        const { awarded } = awardXp(won ? "CHALLENGE_WON" : "CHALLENGE_COMPLETED");
        if (awarded > 0) setClaimToast(`+${awarded} XP${won ? " — you won!" : ""}`);
      },
      onError: (err) => setActionError(err?.message || "Couldn't claim that."),
    });
  };

  return (
    <div className="challenge-panel">
      <ChallengeCard challenge={{ ...challenge, status: phase }} />

      <button
        className="btn btn--ghost btn--sm challenge-panel__toggle"
        onClick={onToggle}
        aria-expanded={isOpen}
      >
        {isOpen ? "Hide details" : phase === CHALLENGE_PHASE.COMPLETED ? "View results" : "Open challenge"}
      </button>

      {isOpen && (
        <div className="challenge-panel__body">
          <p className="challenge-panel__how">
            {scoring.emoji} {scoring.howScored}
          </p>

          {/* ── Entering ────────────────────────────────────────────────── */}
          {isMember && !me && canJoinChallenge(challenge) && (
            <button
              className="btn btn--primary btn--sm"
              onClick={() => run(join)}
              disabled={join.isPending}
            >
              {join.isPending ? "Joining…" : "Join this challenge"}
            </button>
          )}

          {isMember && me && phase !== CHALLENGE_PHASE.COMPLETED && (
            <div className="challenge-panel__joined">
              <span className="challenge-panel__badge">✓ You're in</span>
              {canJoinChallenge(challenge) && (
                <button
                  className="btn btn--ghost btn--xs"
                  onClick={() => run(leave)}
                  disabled={leave.isPending}
                >
                  Withdraw
                </button>
              )}
            </div>
          )}

          {!isMember && (
            <p className="text-muted">Join the school to take part in its challenges.</p>
          )}

          {/* ── Your entry (submission-scored types only) ───────────────── */}
          {isMember && me && scoring.needsSubmission && canSubmitToChallenge(challenge) && (
            <div className="challenge-panel__entry">
              <h5>{myEntry ? "Update your entry" : "Your entry"}</h5>
              {scoring.mode === "declared" && (
                <label className="form-field">
                  <span>Measurement</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={entryDraft.declaredValue}
                    onChange={(e) => setEntryDraft((d) => ({ ...d, declaredValue: e.target.value }))}
                    placeholder="e.g. 18 (mm)"
                  />
                </label>
              )}
              <label className="form-field">
                <span>Photo URL</span>
                <input
                  type="url"
                  value={entryDraft.imageUrl}
                  onChange={(e) => setEntryDraft((d) => ({ ...d, imageUrl: e.target.value }))}
                  placeholder="https://…"
                />
              </label>
              <label className="form-field">
                <span>Notes</span>
                <input
                  type="text"
                  value={entryDraft.body}
                  onChange={(e) => setEntryDraft((d) => ({ ...d, body: e.target.value }))}
                  placeholder="Anything the judges should know"
                  maxLength={280}
                />
              </label>
              <button
                className="btn btn--secondary btn--sm"
                onClick={() => run(submit, entryDraft)}
                disabled={submit.isPending}
              >
                {submit.isPending ? "Saving…" : myEntry ? "Update entry" : "Submit entry"}
              </button>
              {myEntry && (
                <p className="text-muted">
                  You have one entry in this challenge. Submitting again replaces it.
                </p>
              )}
            </div>
          )}

          {/* ── Entries + voting ───────────────────────────────────────── */}
          {scoring.needsSubmission && submissions.length > 0 && (
            <div className="challenge-panel__entries">
              <h5>Entries ({submissions.length})</h5>
              <ul>
                {submissions.map((s) => {
                  const voteCount = (s.votes || []).length;
                  const isMine = sameWallet(s.wallet_address, myWallet);
                  const votedThis = myVote?.id === s.id;

                  return (
                    <li key={s.id} className="challenge-entry">
                      <div className="challenge-entry__head">
                        <ProfileCard
                          walletAddress={s.profile?.wallet_address || s.wallet_address}
                          displayName={s.profile?.display_name}
                          avatarUrl={s.profile?.avatar_url}
                          companionTier={s.profile?.companion_tier}
                          size="small"
                        />
                        {s.declared_value !== null && s.declared_value !== undefined && (
                          <span className="challenge-entry__value">{s.declared_value}</span>
                        )}
                      </div>

                      {s.image_url && (
                        <img src={s.image_url} alt="" className="challenge-entry__image" loading="lazy" />
                      )}
                      {s.body && <p className="challenge-entry__body">{s.body}</p>}

                      {scoring.needsVote && (
                        <div className="challenge-entry__vote-row">
                          <span className="text-muted">{voteCount} {voteCount === 1 ? "vote" : "votes"}</span>
                          {isMember && canVoteInChallenge(challenge) && !isMine && (
                            <button
                              className={`btn btn--xs ${votedThis ? "btn--secondary" : "btn--ghost"}`}
                              onClick={() => run(vote, { submissionId: s.id })}
                              disabled={vote.isPending}
                            >
                              {votedThis ? "✓ Your vote" : "Vote"}
                            </button>
                          )}
                          {/* Being explicit beats a mysteriously missing button. */}
                          {isMine && <span className="text-muted">Your entry</span>}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
              {scoring.needsVote && isMember && myVote && (
                <p className="text-muted">
                  One vote each — voting another entry moves your vote, and tapping
                  yours again takes it back.
                </p>
              )}
            </div>
          )}

          {/* ── Standings / results ────────────────────────────────────── */}
          {participants.length > 0 && (
            <div className="challenge-panel__board">
              <h5>
                {phase === CHALLENGE_PHASE.COMPLETED
                  ? "Final results"
                  : `Entered (${participants.length})`}
              </h5>
              <ol className="challenge-board">
                {participants.map((p) => (
                  <li key={p.id} className="challenge-board__row">
                    {p.rank != null && <span className="challenge-board__rank">#{p.rank}</span>}
                    <ProfileCard
                      walletAddress={p.profile?.wallet_address || p.wallet_address}
                      displayName={p.profile?.display_name}
                      avatarUrl={p.profile?.avatar_url}
                      companionTier={p.profile?.companion_tier}
                      size="small"
                    />
                    {p.scored_at && (
                      <span className="challenge-board__score">
                        {Number(p.score ?? 0)} {scoring.scoreLabel}
                      </span>
                    )}
                  </li>
                ))}
              </ol>
            </div>
          )}

          {/* ── Reward ─────────────────────────────────────────────────── */}
          {phase === CHALLENGE_PHASE.COMPLETED && me?.scored_at && !me?.xp_claimed_at && (
            <button
              className="btn btn--primary btn--sm"
              onClick={handleClaim}
              disabled={claim.isPending}
            >
              {/* The real platform amount, not the host's reward_xp field. The
                  button says what you will actually receive. */}
              {claim.isPending ? "Claiming…" : `Claim ${me.rank === 1 ? 150 : 50} XP`}
            </button>
          )}
          {claimToast && <span className="challenge-panel__badge" role="status">{claimToast}</span>}
          {me?.xp_claimed_at && (
            <p className="text-muted">Reward claimed.</p>
          )}

          {/* ── Host controls ──────────────────────────────────────────── */}
          {isAdmin && canFinalizeChallenge(challenge) && (
            <div className="challenge-panel__host">
              <p className="text-muted">
                This challenge has ended. Finalizing scores everyone, locks the
                results and can't be undone.
              </p>
              <button
                className="btn btn--primary btn--sm"
                onClick={() => {
                  if (!confirm("Finalize this challenge? Scores and rankings will be locked in permanently.")) return;
                  run(finalize);
                }}
                disabled={finalize.isPending}
              >
                {finalize.isPending ? "Scoring…" : "🏁 Finalize results"}
              </button>
            </div>
          )}

          {isAdmin && phase === CHALLENGE_PHASE.SCORING && participants.length === 0 && (
            <p className="text-muted">Nobody entered this one.</p>
          )}

          {actionError && <p className="challenge-panel__error" role="alert">{actionError}</p>}
        </div>
      )}
    </div>
  );
}

const CHALLENGE_TYPES = [
  { value: "breeding_sprint", label: "🧬 Breeding Sprint", desc: "Race to breed a target species" },
  { value: "growout_race", label: "📈 Grow-Out Race", desc: "Grow fry to a target size fastest" },
  { value: "photo_contest", label: "📷 Photo Contest", desc: "Best tank photo wins" },
  { value: "care_streak", label: "🔥 Care Streak", desc: "Longest streak of daily parameter logs" },
];

function CreateChallengeForm({ schoolId, onCancel, onCreated }) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [challengeType, setChallengeType] = useState("photo_contest");
  const [targetSpecies, setTargetSpecies] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [rewardXp, setRewardXp] = useState(100);
  const [error, setError] = useState("");

  const createChallengeMutation = useCreateChallenge();

  const handleSubmit = async () => {
    setError("");
    if (!title.trim()) { setError("Title is required."); return; }
    if (!startTime || !endTime) { setError("Start and end times are required."); return; }
    if (new Date(endTime) <= new Date(startTime)) { setError("End time must be after start time."); return; }

    const result = await createChallengeMutation.mutateAsync({
      schoolId,
      title: title.trim(),
      description: description.trim() || null,
      challengeType,
      targetSpecies: targetSpecies.trim() || null,
      startTime: new Date(startTime).toISOString(),
      endTime: new Date(endTime).toISOString(),
      rewardXp: Number(rewardXp) || 100,
    });

    if (result?.error) {
      setError(result.error.message || "Failed to create challenge.");
    } else {
      onCreated?.();
    }
  };

  return (
    <div className="glass-card" style={{
      padding: "1.25rem",
      borderRadius: "var(--radius-sm)",
      border: "1px solid rgba(245, 158, 11, 0.2)",
      background: "rgba(245, 158, 11, 0.03)",
    }}>
      <h4 style={{ margin: "0 0 1rem", fontSize: "0.9rem", color: "#fff" }}>🏆 New Challenge</h4>

      {/* Title */}
      <div style={{ marginBottom: "0.75rem" }}>
        <label style={{ display: "block", fontSize: "0.7rem", color: "var(--text-secondary)", marginBottom: "0.3rem" }}>Title *</label>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value.slice(0, 80))}
          placeholder="e.g. Spring Breeding Sprint"
          style={{
            width: "100%", padding: "0.5rem 0.75rem", borderRadius: "8px",
            border: "1px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.04)",
            color: "#fff", fontSize: "0.8rem",
          }}
        />
      </div>

      {/* Description */}
      <div style={{ marginBottom: "0.75rem" }}>
        <label style={{ display: "block", fontSize: "0.7rem", color: "var(--text-secondary)", marginBottom: "0.3rem" }}>Description</label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value.slice(0, 500))}
          placeholder="Explain the rules and objectives..."
          rows={3}
          style={{
            width: "100%", padding: "0.5rem 0.75rem", borderRadius: "8px",
            border: "1px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.04)",
            color: "#fff", fontSize: "0.8rem", resize: "vertical",
          }}
        />
      </div>

      {/* Challenge Type */}
      <div style={{ marginBottom: "0.75rem" }}>
        <label style={{ display: "block", fontSize: "0.7rem", color: "var(--text-secondary)", marginBottom: "0.3rem" }}>Type *</label>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem" }}>
          {CHALLENGE_TYPES.map((ct) => (
            <button
              key={ct.value}
              type="button"
              onClick={() => setChallengeType(ct.value)}
              style={{
                padding: "0.35rem 0.7rem",
                borderRadius: "50px",
                border: `1px solid ${challengeType === ct.value ? "rgba(245, 158, 11, 0.4)" : "rgba(255,255,255,0.1)"}`,
                background: challengeType === ct.value ? "rgba(245, 158, 11, 0.12)" : "rgba(255,255,255,0.03)",
                color: challengeType === ct.value ? "#fff" : "var(--text-secondary)",
                fontSize: "0.68rem",
                cursor: "pointer",
                transition: "all 0.15s ease",
              }}
              title={ct.desc}
            >
              {ct.label}
            </button>
          ))}
        </div>
      </div>

      {/* Target Species (optional) */}
      <div style={{ marginBottom: "0.75rem" }}>
        <label style={{ display: "block", fontSize: "0.7rem", color: "var(--text-secondary)", marginBottom: "0.3rem" }}>Target Species (optional)</label>
        <input
          type="text"
          value={targetSpecies}
          onChange={(e) => setTargetSpecies(e.target.value)}
          placeholder="e.g. Apistogramma cacatuoides"
          style={{
            width: "100%", padding: "0.5rem 0.75rem", borderRadius: "8px",
            border: "1px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.04)",
            color: "#fff", fontSize: "0.8rem",
          }}
        />
      </div>

      {/* Start / End */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem", marginBottom: "0.75rem" }}>
        <div>
          <label style={{ display: "block", fontSize: "0.7rem", color: "var(--text-secondary)", marginBottom: "0.3rem" }}>Start *</label>
          <input
            type="datetime-local"
            value={startTime}
            onChange={(e) => setStartTime(e.target.value)}
            style={{
              width: "100%", padding: "0.5rem 0.6rem", borderRadius: "8px",
              border: "1px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.04)",
              color: "#fff", fontSize: "0.75rem",
            }}
          />
        </div>
        <div>
          <label style={{ display: "block", fontSize: "0.7rem", color: "var(--text-secondary)", marginBottom: "0.3rem" }}>End *</label>
          <input
            type="datetime-local"
            value={endTime}
            onChange={(e) => setEndTime(e.target.value)}
            style={{
              width: "100%", padding: "0.5rem 0.6rem", borderRadius: "8px",
              border: "1px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.04)",
              color: "#fff", fontSize: "0.75rem",
            }}
          />
        </div>
      </div>

      {/* Reward XP */}
      <div style={{ marginBottom: "1rem" }}>
        <label style={{ display: "block", fontSize: "0.7rem", color: "var(--text-secondary)", marginBottom: "0.3rem" }}>Reward XP</label>
        <input
          type="number"
          value={rewardXp}
          onChange={(e) => setRewardXp(Math.max(10, Math.min(1000, Number(e.target.value))))}
          min={10}
          max={1000}
          style={{
            width: "100px", padding: "0.5rem 0.75rem", borderRadius: "8px",
            border: "1px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.04)",
            color: "#fff", fontSize: "0.8rem",
          }}
        />
        <span style={{ fontSize: "0.65rem", color: "var(--text-muted)", marginLeft: "0.5rem" }}>XP for winner (10–1000)</span>
      </div>

      {/* Error */}
      {error && (
        <div style={{
          marginBottom: "0.75rem", padding: "0.5rem 0.75rem",
          background: "rgba(248, 113, 113, 0.1)", border: "1px solid rgba(248, 113, 113, 0.2)",
          borderRadius: "8px", color: "var(--accent-red)", fontSize: "0.75rem",
        }}>
          {error}
        </div>
      )}

      {/* Actions */}
      <div style={{ display: "flex", gap: "0.75rem", justifyContent: "flex-end" }}>
        <button
          onClick={onCancel}
          style={{
            padding: "0.5rem 1rem", borderRadius: "8px",
            border: "1px solid rgba(255,255,255,0.1)", background: "transparent",
            color: "var(--text-muted)", fontSize: "0.75rem", cursor: "pointer",
          }}
        >
          Cancel
        </button>
        <button
          onClick={handleSubmit}
          disabled={createChallengeMutation.isPending}
          style={{
            padding: "0.5rem 1.25rem", borderRadius: "8px", border: "none",
            background: "linear-gradient(135deg, #f59e0b, #d97706)",
            color: "#fff", fontSize: "0.75rem", fontWeight: 600, cursor: "pointer",
            opacity: createChallengeMutation.isPending ? 0.6 : 1,
          }}
        >
          {createChallengeMutation.isPending ? "Creating..." : "🏆 Create Challenge"}
        </button>
      </div>
    </div>
  );
}

function SettingsTab({ school, schoolId }) {
  const [name, setName] = useState(school.name || "");
  const [description, setDescription] = useState(school.description || "");
  const [bannerUrl, setBannerUrl] = useState(school.banner_url || "");
  const [isInviteOnly, setIsInviteOnly] = useState(school.is_invite_only || false);
  const [memberCap, setMemberCap] = useState(school.member_cap || "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  const updateSchoolMutation = useUpdateSchool();

  const handleSave = async () => {
    setError("");
    setSaved(false);
    if (!name.trim()) { setError("School name is required."); return; }

    setSaving(true);
    const result = await updateSchoolMutation.mutateAsync({
      schoolId: schoolId || school.id,
      updates: {
        name: name.trim(),
        description: description.trim() || null,
        banner_url: bannerUrl.trim() || null,
        is_invite_only: isInviteOnly,
        member_cap: memberCap ? Number(memberCap) : null,
      },
    });

    setSaving(false);
    if (result?.error) {
      setError(result.error.message || "Failed to update school.");
    } else {
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    }
  };

  return (
    <div className="glass-card" style={{
      padding: "1.5rem",
      borderRadius: "var(--radius-sm)",
      border: "1px solid rgba(255,255,255,0.06)",
    }}>
      <h3 style={{ margin: "0 0 1.25rem", fontSize: "1rem", color: "#fff" }}>⚙️ School Settings</h3>

      {/* Name */}
      <div style={{ marginBottom: "1rem" }}>
        <label style={{ display: "block", fontSize: "0.72rem", color: "var(--text-secondary)", marginBottom: "0.3rem", fontWeight: 600 }}>School Name *</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value.slice(0, 60))}
          style={{
            width: "100%", padding: "0.55rem 0.85rem", borderRadius: "8px",
            border: "1px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.04)",
            color: "#fff", fontSize: "0.85rem",
          }}
        />
      </div>

      {/* Description */}
      <div style={{ marginBottom: "1rem" }}>
        <label style={{ display: "block", fontSize: "0.72rem", color: "var(--text-secondary)", marginBottom: "0.3rem", fontWeight: 600 }}>Description</label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value.slice(0, 500))}
          placeholder="What is this school about?"
          rows={3}
          style={{
            width: "100%", padding: "0.55rem 0.85rem", borderRadius: "8px",
            border: "1px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.04)",
            color: "#fff", fontSize: "0.85rem", resize: "vertical",
          }}
        />
      </div>

      {/* Banner URL */}
      <div style={{ marginBottom: "1rem" }}>
        <label style={{ display: "block", fontSize: "0.72rem", color: "var(--text-secondary)", marginBottom: "0.3rem", fontWeight: 600 }}>Banner Image URL</label>
        <input
          type="url"
          value={bannerUrl}
          onChange={(e) => setBannerUrl(e.target.value)}
          placeholder="https://example.com/banner.jpg"
          style={{
            width: "100%", padding: "0.55rem 0.85rem", borderRadius: "8px",
            border: "1px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.04)",
            color: "#fff", fontSize: "0.85rem",
          }}
        />
        {bannerUrl && (
          <div style={{ marginTop: "0.5rem", borderRadius: "8px", overflow: "hidden", height: "80px" }}>
            <img src={bannerUrl} alt="Banner preview" style={{ width: "100%", height: "100%", objectFit: "cover" }} onError={(e) => { e.target.style.display = "none"; }} />
          </div>
        )}
      </div>

      {/* Invite Only Toggle */}
      <div style={{ marginBottom: "1rem", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <label style={{ fontSize: "0.72rem", color: "var(--text-secondary)", fontWeight: 600 }}>🔒 Invite Only</label>
          <p style={{ margin: "0.1rem 0 0", fontSize: "0.62rem", color: "var(--text-muted)" }}>Only invited members can join</p>
        </div>
        <button
          onClick={() => setIsInviteOnly(!isInviteOnly)}
          style={{
            width: "44px", height: "24px", borderRadius: "12px", border: "none",
            background: isInviteOnly ? "rgba(56, 189, 248, 0.5)" : "rgba(255,255,255,0.12)",
            cursor: "pointer", position: "relative", transition: "background 0.2s ease",
          }}
          role="switch"
          aria-checked={isInviteOnly}
        >
          <div style={{
            width: "18px", height: "18px", borderRadius: "50%", background: "#fff",
            position: "absolute", top: "3px",
            left: isInviteOnly ? "23px" : "3px",
            transition: "left 0.2s ease",
          }} />
        </button>
      </div>

      {/* Member Cap */}
      <div style={{ marginBottom: "1.25rem" }}>
        <label style={{ display: "block", fontSize: "0.72rem", color: "var(--text-secondary)", marginBottom: "0.3rem", fontWeight: 600 }}>Member Limit</label>
        <input
          type="number"
          value={memberCap}
          onChange={(e) => setMemberCap(e.target.value)}
          placeholder="No limit"
          min={1}
          style={{
            width: "120px", padding: "0.55rem 0.85rem", borderRadius: "8px",
            border: "1px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.04)",
            color: "#fff", fontSize: "0.85rem",
          }}
        />
        <span style={{ fontSize: "0.62rem", color: "var(--text-muted)", marginLeft: "0.5rem" }}>Leave empty for unlimited</span>
      </div>

      {/* Error */}
      {error && (
        <div style={{
          marginBottom: "0.75rem", padding: "0.5rem 0.75rem",
          background: "rgba(248, 113, 113, 0.1)", border: "1px solid rgba(248, 113, 113, 0.2)",
          borderRadius: "8px", color: "var(--accent-red)", fontSize: "0.75rem",
        }}>
          {error}
        </div>
      )}

      {/* Success */}
      {saved && (
        <div style={{
          marginBottom: "0.75rem", padding: "0.5rem 0.75rem",
          background: "rgba(52, 211, 153, 0.08)", border: "1px solid rgba(52, 211, 153, 0.2)",
          borderRadius: "8px", color: "var(--accent-green)", fontSize: "0.75rem",
        }}>
          ✓ Settings saved!
        </div>
      )}

      {/* Save button */}
      <button
        onClick={handleSave}
        disabled={saving}
        style={{
          padding: "0.6rem 1.5rem", borderRadius: "8px", border: "none",
          background: "linear-gradient(135deg, #0ea5e9, #0369a1)",
          color: "#fff", fontSize: "0.8rem", fontWeight: 600, cursor: "pointer",
          opacity: saving ? 0.6 : 1, transition: "opacity 0.15s ease",
        }}
      >
        {saving ? "Saving..." : "💾 Save Changes"}
      </button>
    </div>
  );
}
