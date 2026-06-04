/**
 * MentorshipPanel.jsx
 * 
 * Mentor/Mentee pairing interface.
 * - Master+ tier profiles show "Accepting Mentees" toggle
 * - Mentee request flow with message
 * - Active pairings display
 */

import React, { useState } from "react";
import {
  useMentorships,
  useAvailableMentors,
  useRequestMentorship,
  useAcceptMentorship,
  useEndMentorship,
  useToggleAcceptingMentees,
} from "../../hooks/useAudits";
import { getCurrentWallet } from "../../services/supabaseClient";

export function MentorshipPanel({ walletAddress, companionTier, onViewProfile }) {
  const currentWallet = getCurrentWallet();
  const isOwnProfile = currentWallet === walletAddress;
  const isMasterPlus = companionTier === "Master" || companionTier === "God-Tier";

  const { data: mentorshipsResult } = useMentorships(walletAddress);
  const { data: mentorsResult } = useAvailableMentors(!isMasterPlus);
  
  const requestMentorshipMutation = useRequestMentorship();
  const acceptMentorshipMutation = useAcceptMentorship();
  const endMentorshipMutation = useEndMentorship();
  const toggleMenteesMutation = useToggleAcceptingMentees();

  const [requestingMentor, setRequestingMentor] = useState(null);
  const [requestMessage, setRequestMessage] = useState("");
  const [showMentorList, setShowMentorList] = useState(false);

  const mentorships = mentorshipsResult?.data || { asMentor: [], asMentee: [] };
  const availableMentors = mentorsResult?.data || [];

  const activeMentorPairings = mentorships.asMentor.filter((m) => m.status === "active");
  const pendingMentorRequests = mentorships.asMentor.filter((m) => m.status === "pending");
  const activeMenteePairings = mentorships.asMentee.filter((m) => m.status === "active");
  const pendingMenteeRequests = mentorships.asMentee.filter((m) => m.status === "pending");

  const handleRequestMentorship = async () => {
    if (!requestingMentor) return;
    await requestMentorshipMutation.mutateAsync({
      mentorWallet: requestingMentor,
      message: requestMessage,
    });
    setRequestingMentor(null);
    setRequestMessage("");
  };

  return (
    <div className="mentorship-panel" style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
      {/* Accepting Mentees Toggle (Master+ only, own profile) */}
      {isOwnProfile && isMasterPlus && (
        <div className="glass-card" style={{
          padding: "1rem 1.25rem",
          borderRadius: "var(--radius-sm)",
          border: "1px solid rgba(168, 85, 247, 0.15)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}>
          <div>
            <div style={{ fontSize: "0.85rem", color: "#fff", fontWeight: "500" }}>
              🎓 Accept Mentees
            </div>
            <div style={{ fontSize: "0.7rem", color: "var(--text-muted)", marginTop: "0.2rem" }}>
              Allow other breeders to request you as their Mentor
            </div>
          </div>
          <button
            onClick={() => toggleMenteesMutation.mutate(true)}
            style={{
              width: "44px",
              height: "24px",
              borderRadius: "12px",
              border: "none",
              background: "rgba(168, 85, 247, 0.4)",
              cursor: "pointer",
              position: "relative",
              transition: "background 0.2s ease",
            }}
            role="switch"
            aria-checked="true"
          >
            <div style={{
              width: "18px",
              height: "18px",
              borderRadius: "50%",
              background: "#fff",
              position: "absolute",
              top: "3px",
              left: "23px",
              transition: "left 0.2s ease",
            }} />
          </button>
        </div>
      )}

      {/* Pending Requests (as Mentor) */}
      {isOwnProfile && pendingMentorRequests.length > 0 && (
        <div>
          <h4 style={{ fontSize: "0.8rem", color: "var(--text-secondary)", marginBottom: "0.6rem" }}>
            Mentee Requests
          </h4>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            {pendingMentorRequests.map((m) => (
              <div key={m.id} className="glass-card" style={{
                padding: "0.75rem 1rem",
                borderRadius: "var(--radius-sm)",
                border: "1px solid rgba(168, 85, 247, 0.15)",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
              }}>
                <div
                  style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: "0.5rem" }}
                  onClick={() => onViewProfile?.(m.mentee?.wallet_address)}
                >
                  <div style={{
                    width: "28px",
                    height: "28px",
                    borderRadius: "50%",
                    background: m.mentee?.avatar_url
                      ? `url(${m.mentee.avatar_url}) center/cover`
                      : "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
                  }} />
                  <div>
                    <div style={{ fontSize: "0.75rem", color: "#fff" }}>
                      {m.mentee?.display_name || "Unknown"}
                    </div>
                    {m.message && (
                      <div style={{ fontSize: "0.6rem", color: "var(--text-muted)", maxWidth: "200px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        "{m.message}"
                      </div>
                    )}
                  </div>
                </div>
                <div style={{ display: "flex", gap: "0.4rem" }}>
                  <button
                    onClick={() => acceptMentorshipMutation.mutate(m.id)}
                    className="btn-primary"
                    style={{ padding: "0.3rem 0.6rem", fontSize: "0.65rem" }}
                  >
                    Accept
                  </button>
                  <button
                    onClick={() => endMentorshipMutation.mutate(m.id)}
                    className="btn-secondary"
                    style={{ padding: "0.3rem 0.6rem", fontSize: "0.65rem" }}
                  >
                    Decline
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Active Pairings (as Mentor) */}
      {activeMentorPairings.length > 0 && (
        <div>
          <h4 style={{ fontSize: "0.8rem", color: "var(--text-secondary)", marginBottom: "0.6rem" }}>
            🎓 My Mentees
          </h4>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            {activeMentorPairings.map((m) => (
              <PairingCard
                key={m.id}
                profile={m.mentee}
                relationship="Mentee"
                onViewProfile={onViewProfile}
                onEnd={() => endMentorshipMutation.mutate(m.id)}
                isOwnProfile={isOwnProfile}
              />
            ))}
          </div>
        </div>
      )}

      {/* Active Pairings (as Mentee) */}
      {activeMenteePairings.length > 0 && (
        <div>
          <h4 style={{ fontSize: "0.8rem", color: "var(--text-secondary)", marginBottom: "0.6rem" }}>
            🎓 My Mentor{activeMenteePairings.length > 1 ? "s" : ""}
          </h4>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            {activeMenteePairings.map((m) => (
              <PairingCard
                key={m.id}
                profile={m.mentor}
                relationship="Mentor"
                onViewProfile={onViewProfile}
                onEnd={() => endMentorshipMutation.mutate(m.id)}
                isOwnProfile={isOwnProfile}
              />
            ))}
          </div>
        </div>
      )}

      {/* Pending (as Mentee) */}
      {pendingMenteeRequests.length > 0 && (
        <div>
          <h4 style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginBottom: "0.5rem" }}>
            Pending Requests
          </h4>
          {pendingMenteeRequests.map((m) => (
            <div key={m.id} style={{ fontSize: "0.7rem", color: "var(--text-muted)", padding: "0.4rem 0" }}>
              ⏳ Awaiting response from {m.mentor?.display_name || "mentor"}...
            </div>
          ))}
        </div>
      )}

      {/* Find a Mentor Button */}
      {isOwnProfile && !isMasterPlus && activeMenteePairings.length === 0 && (
        <div>
          <button
            onClick={() => setShowMentorList(!showMentorList)}
            className="btn-secondary"
            style={{ width: "100%", padding: "0.7rem", fontSize: "0.8rem" }}
          >
            🎓 {showMentorList ? "Hide Mentors" : "Find a Mentor"}
          </button>

          {showMentorList && (
            <div style={{ marginTop: "0.75rem", display: "flex", flexDirection: "column", gap: "0.5rem" }}>
              {availableMentors.length === 0 ? (
                <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", textAlign: "center", padding: "1rem" }}>
                  No mentors accepting mentees right now. Check back later!
                </p>
              ) : (
                availableMentors.map((mentor) => (
                  <div key={mentor.wallet_address} className="glass-card" style={{
                    padding: "0.75rem 1rem",
                    borderRadius: "var(--radius-sm)",
                    border: "1px solid rgba(255,255,255,0.08)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                  }}>
                    <div
                      style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer" }}
                      onClick={() => onViewProfile?.(mentor.wallet_address)}
                    >
                      <div style={{
                        width: "32px",
                        height: "32px",
                        borderRadius: "50%",
                        background: mentor.avatar_url
                          ? `url(${mentor.avatar_url}) center/cover`
                          : "linear-gradient(135deg, #fbbf24 0%, #f59e0b 100%)",
                        border: "2px solid rgba(251, 191, 36, 0.3)",
                      }} />
                      <div>
                        <div style={{ fontSize: "0.8rem", color: "#fff", fontWeight: "500" }}>
                          {mentor.display_name || `${mentor.wallet_address.slice(0, 6)}...`}
                        </div>
                        <div style={{ fontSize: "0.6rem", color: "var(--accent-amber)" }}>
                          {mentor.companion_tier} · {mentor.xp_total} XP
                        </div>
                      </div>
                    </div>
                    <button
                      onClick={() => setRequestingMentor(mentor.wallet_address)}
                      className="btn-primary"
                      style={{ padding: "0.3rem 0.7rem", fontSize: "0.65rem" }}
                    >
                      Request
                    </button>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      )}

      {/* Request Modal */}
      {requestingMentor && (
        <div style={{
          position: "fixed",
          inset: 0,
          zIndex: 1001,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "rgba(0,0,0,0.6)",
          padding: "1rem",
        }}>
          <div className="glass-card" style={{ padding: "1.5rem", maxWidth: "400px", width: "100%", borderRadius: "var(--radius-md)" }}>
            <h3 style={{ margin: "0 0 1rem", fontSize: "1rem", color: "#fff" }}>🎓 Request Mentorship</h3>
            <textarea
              value={requestMessage}
              onChange={(e) => setRequestMessage(e.target.value.slice(0, 300))}
              placeholder="Introduce yourself and what you'd like help with..."
              rows={3}
              maxLength={300}
              style={{
                width: "100%",
                padding: "0.7rem 1rem",
                background: "rgba(255,255,255,0.04)",
                border: "1px solid rgba(255,255,255,0.1)",
                borderRadius: "var(--radius-sm)",
                color: "#fff",
                fontSize: "0.85rem",
                resize: "none",
                marginBottom: "0.5rem",
              }}
            />
            <span style={{ fontSize: "0.6rem", color: "var(--text-muted)" }}>
              {requestMessage.length}/300
            </span>
            <div style={{ display: "flex", gap: "0.75rem", marginTop: "1rem", justifyContent: "flex-end" }}>
              <button onClick={() => { setRequestingMentor(null); setRequestMessage(""); }} className="btn-secondary" style={{ padding: "0.5rem 1rem" }}>
                Cancel
              </button>
              <button
                onClick={handleRequestMentorship}
                disabled={requestMentorshipMutation.isPending}
                className="btn-primary"
                style={{ padding: "0.5rem 1rem" }}
              >
                {requestMentorshipMutation.isPending ? "Sending..." : "Send Request"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* XP Multiplier Info */}
      {(activeMentorPairings.length > 0 || activeMenteePairings.length > 0) && (
        <div style={{
          padding: "0.6rem 1rem",
          background: "rgba(168, 85, 247, 0.05)",
          borderRadius: "var(--radius-sm)",
          border: "1px solid rgba(168, 85, 247, 0.12)",
          fontSize: "0.7rem",
          color: "var(--text-secondary)",
        }}>
          ✨ <strong>1.5× XP multiplier</strong> active on interactions between you and your mentor/mentees.
        </div>
      )}
    </div>
  );
}

function PairingCard({ profile, relationship, onViewProfile, onEnd, isOwnProfile }) {
  if (!profile) return null;

  return (
    <div className="glass-card" style={{
      padding: "0.6rem 1rem",
      borderRadius: "var(--radius-sm)",
      border: "1px solid rgba(168, 85, 247, 0.12)",
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
    }}>
      <div
        style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer" }}
        onClick={() => onViewProfile?.(profile.wallet_address)}
      >
        <div style={{
          width: "28px",
          height: "28px",
          borderRadius: "50%",
          background: profile.avatar_url
            ? `url(${profile.avatar_url}) center/cover`
            : "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
        }} />
        <div>
          <div style={{ fontSize: "0.75rem", color: "#fff" }}>
            {profile.display_name || `${profile.wallet_address.slice(0, 6)}...`}
          </div>
          <div style={{ fontSize: "0.6rem", color: "rgba(168, 85, 247, 0.8)" }}>
            {relationship}
          </div>
        </div>
      </div>
      {isOwnProfile && (
        <button
          onClick={onEnd}
          style={{ background: "none", border: "none", color: "var(--text-muted)", fontSize: "0.6rem", cursor: "pointer" }}
          title="End pairing"
        >
          End
        </button>
      )}
    </div>
  );
}
