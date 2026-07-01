/**
 * SchoolPage.jsx
 * 
 * Full school view with tabs: Feed / Members / Challenges / Chat / Settings.
 */

import React, { useState } from "react";
import { useSchoolById, useMySchoolRole, useSchoolMembers, useSchoolChallenges, useLeaveSchool, useUpdateMemberRole, useRemoveMember, useCreateChallenge, useUpdateSchool } from "../../hooks/useSchools";
import { ProfileCard } from "./ProfileCard";
import { SchoolChat } from "./SchoolChat";
import { ChallengeCard } from "./ChallengeCard";

const TYPE_EMOJI = {
  species: "🐟",
  regional: "🌍",
  breeding: "🧬",
  conservation: "🌿",
  equipment: "⚙️",
  open: "🌊",
};

export function SchoolPage({ schoolId, onBack, onViewProfile }) {
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
      <div style={{
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
        <SchoolFeedTab school={school} />
      )}

      {activeTab === "members" && (
        <MembersTab
          members={members}
          isAdmin={isAdmin}
          schoolId={schoolId}
          onViewProfile={onViewProfile}
          onPromote={(wallet) => updateRoleMutation.mutate({ schoolId, targetWallet: wallet, newRole: "elder" })}
          onDemote={(wallet) => updateRoleMutation.mutate({ schoolId, targetWallet: wallet, newRole: "member" })}
          onKick={(wallet) => removeMemberMutation.mutate({ schoolId, targetWallet: wallet })}
        />
      )}

      {activeTab === "challenges" && (
        <ChallengesTab challenges={challenges} schoolId={schoolId} isAdmin={isAdmin} />
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

function SchoolFeedTab({ school }) {
  return (
    <div style={{ textAlign: "center", padding: "2rem 1rem", color: "var(--text-muted)" }}>
      <div style={{ fontSize: "1.5rem", marginBottom: "0.5rem" }}>📰</div>
      <p style={{ fontSize: "0.85rem" }}>School feed coming soon.</p>
      <p style={{ fontSize: "0.7rem" }}>Member Currents tagged to tracked species will appear here.</p>
    </div>
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
                  onClick={() => onKick(profile.wallet_address)}
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

function ChallengesTab({ challenges, schoolId, isAdmin }) {
  const [showForm, setShowForm] = useState(false);
  const active = challenges.filter((c) => c.status === "active" || c.status === "upcoming");
  const completed = challenges.filter((c) => c.status === "completed");

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

      {active.length === 0 && completed.length === 0 && !showForm ? (
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
          {active.map((challenge) => (
            <ChallengeCard key={challenge.id} challenge={challenge} />
          ))}
          {completed.length > 0 && (
            <>
              <h4 style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: "1rem" }}>Completed</h4>
              {completed.map((challenge) => (
                <ChallengeCard key={challenge.id} challenge={challenge} />
              ))}
            </>
          )}
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
