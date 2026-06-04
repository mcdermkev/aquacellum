/**
 * SchoolPage.jsx
 * 
 * Full school view with tabs: Feed / Members / Challenges / Chat / Settings.
 */

import React, { useState } from "react";
import { useSchoolById, useMySchoolRole, useSchoolMembers, useSchoolChallenges, useLeaveSchool, useUpdateMemberRole, useRemoveMember } from "../../hooks/useSchools";
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
        <SettingsTab school={school} />
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
  const active = challenges.filter((c) => c.status === "active" || c.status === "upcoming");
  const completed = challenges.filter((c) => c.status === "completed");

  return (
    <div>
      {active.length === 0 && completed.length === 0 ? (
        <div style={{ textAlign: "center", padding: "2rem 1rem", color: "var(--text-muted)" }}>
          <div style={{ fontSize: "1.5rem", marginBottom: "0.5rem" }}>🏆</div>
          <p style={{ fontSize: "0.85rem" }}>No challenges yet.</p>
          {isAdmin && (
            <p style={{ fontSize: "0.7rem" }}>As a Founder/Elder, you can create challenges for your school.</p>
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

function SettingsTab({ school }) {
  return (
    <div style={{ textAlign: "center", padding: "2rem 1rem", color: "var(--text-muted)" }}>
      <div style={{ fontSize: "1.5rem", marginBottom: "0.5rem" }}>⚙️</div>
      <p style={{ fontSize: "0.85rem" }}>School settings panel coming soon.</p>
      <p style={{ fontSize: "0.7rem" }}>Edit name, description, banner, and manage invites.</p>
    </div>
  );
}
