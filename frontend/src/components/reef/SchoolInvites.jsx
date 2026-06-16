/**
 * SchoolInvites.jsx
 * 
 * Panel showing pending school invites for the current user.
 * Displayed in the Following tab of the Reef feed.
 */

import React, { useState, useEffect } from "react";
import { getMySchoolInvites, acceptSchoolInvite, declineSchoolInvite } from "../../services/schoolsApi";
import { getCurrentWallet } from "../../services/supabaseClient";
import { ProfileCard } from "./ProfileCard";

export function SchoolInvites({ onNavigateSchool }) {
  const [invites, setInvites] = useState([]);
  const [loading, setLoading] = useState(true);
  const [responding, setResponding] = useState(null);
  const walletAddress = getCurrentWallet();

  useEffect(() => {
    if (!walletAddress) return;
    loadInvites();
  }, [walletAddress]);

  const loadInvites = async () => {
    const { data } = await getMySchoolInvites();
    setInvites(data || []);
    setLoading(false);
  };

  const handleAccept = async (invite) => {
    setResponding(invite.id);
    await acceptSchoolInvite(invite.id, invite.school_id);
    setInvites((prev) => prev.filter((i) => i.id !== invite.id));
    setResponding(null);
  };

  const handleDecline = async (invite) => {
    setResponding(invite.id);
    await declineSchoolInvite(invite.id);
    setInvites((prev) => prev.filter((i) => i.id !== invite.id));
    setResponding(null);
  };

  if (loading || invites.length === 0) return null;

  return (
    <div style={{
      marginBottom: "1rem",
      padding: "0.75rem",
      borderRadius: "12px",
      background: "rgba(168, 85, 247, 0.04)",
      border: "1px solid rgba(168, 85, 247, 0.15)",
    }}>
      <h4 style={{ margin: "0 0 0.5rem", fontSize: "0.8rem", color: "#a78bfa", fontWeight: 700 }}>
        🏫 School Invites ({invites.length})
      </h4>

      <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
        {invites.map((invite) => (
          <div
            key={invite.id}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "0.5rem",
              padding: "0.5rem 0.6rem",
              borderRadius: "8px",
              background: "rgba(255, 255, 255, 0.02)",
              border: "1px solid rgba(255, 255, 255, 0.04)",
              flexWrap: "wrap",
            }}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: "0.2rem", minWidth: 0, flex: 1 }}>
              <button
                onClick={() => onNavigateSchool?.(invite.school?.id)}
                style={{
                  background: "none",
                  border: "none",
                  color: "#fff",
                  fontSize: "0.8rem",
                  fontWeight: 600,
                  cursor: "pointer",
                  padding: 0,
                  textAlign: "left",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {invite.school?.name || "Unknown School"}
              </button>
              {invite.inviter && (
                <span style={{ fontSize: "0.65rem", color: "var(--text-muted)" }}>
                  Invited by {invite.inviter.display_name || invite.invited_by?.slice(0, 8)}
                </span>
              )}
            </div>

            <div style={{ display: "flex", gap: "0.3rem" }}>
              <button
                onClick={() => handleAccept(invite)}
                disabled={responding === invite.id}
                style={{
                  padding: "0.3rem 0.6rem",
                  borderRadius: "6px",
                  border: "none",
                  background: "linear-gradient(135deg, #6366f1, #4f46e5)",
                  color: "#fff",
                  fontSize: "0.65rem",
                  fontWeight: 600,
                  cursor: "pointer",
                  opacity: responding === invite.id ? 0.6 : 1,
                }}
              >
                Join
              </button>
              <button
                onClick={() => handleDecline(invite)}
                disabled={responding === invite.id}
                style={{
                  padding: "0.3rem 0.6rem",
                  borderRadius: "6px",
                  border: "1px solid rgba(255, 255, 255, 0.1)",
                  background: "transparent",
                  color: "var(--text-muted)",
                  fontSize: "0.65rem",
                  cursor: "pointer",
                }}
              >
                Decline
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default SchoolInvites;
