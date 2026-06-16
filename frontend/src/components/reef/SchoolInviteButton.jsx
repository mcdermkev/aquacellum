/**
 * SchoolInviteButton.jsx
 * 
 * Dropdown button on user profiles that lets Founders/Elders
 * invite a user to one of their schools.
 */

import React, { useState, useEffect } from "react";
import { getMySchools, inviteToSchool, getMySchoolRole } from "../../services/schoolsApi";
import { getCurrentWallet } from "../../services/supabaseClient";

export function SchoolInviteButton({ targetWallet }) {
  const [mySchools, setMySchools] = useState([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [sending, setSending] = useState(null);
  const [sent, setSent] = useState({});
  const [error, setError] = useState(null);
  const currentWallet = getCurrentWallet();

  // Don't show for own profile
  if (!currentWallet || currentWallet === targetWallet) return null;

  // Load schools where the user is founder/elder
  useEffect(() => {
    async function load() {
      const { data } = await getMySchools();
      if (!data) return;

      // Filter to schools where user has invite permission (founder or elder)
      const eligible = [];
      for (const membership of data) {
        if (membership.role === "founder" || membership.role === "elder") {
          eligible.push(membership.school);
        }
      }
      setMySchools(eligible);
    }
    load();
  }, []);

  // Don't render if user has no schools to invite to
  if (mySchools.length === 0) return null;

  const handleInvite = async (schoolId) => {
    setSending(schoolId);
    setError(null);

    const { error: inviteError } = await inviteToSchool(schoolId, targetWallet);

    if (inviteError) {
      const msg = typeof inviteError === "string" ? inviteError : inviteError.message || "Invite failed";
      setError(msg);
    } else {
      setSent((prev) => ({ ...prev, [schoolId]: true }));
    }

    setSending(null);
  };

  return (
    <div style={{ position: "relative" }}>
      <button
        onClick={() => setShowDropdown(!showDropdown)}
        style={{
          padding: "0.4rem 0.8rem",
          borderRadius: "50px",
          border: "1px solid rgba(168, 85, 247, 0.25)",
          background: "rgba(168, 85, 247, 0.06)",
          color: "#a78bfa",
          fontSize: "0.7rem",
          fontWeight: 600,
          cursor: "pointer",
          transition: "all 0.15s ease",
        }}
      >
        🏫 Invite to School
      </button>

      {showDropdown && (
        <div
          style={{
            position: "absolute",
            top: "100%",
            right: 0,
            marginTop: "0.35rem",
            minWidth: "220px",
            background: "rgba(15, 23, 42, 0.97)",
            border: "1px solid rgba(255, 255, 255, 0.08)",
            borderRadius: "10px",
            boxShadow: "0 12px 40px rgba(0, 0, 0, 0.5)",
            padding: "0.5rem",
            zIndex: 100,
            display: "flex",
            flexDirection: "column",
            gap: "0.25rem",
          }}
        >
          <p style={{ margin: "0 0 0.25rem", padding: "0.25rem 0.5rem", fontSize: "0.65rem", color: "var(--text-muted)", fontWeight: 600 }}>
            Select a school:
          </p>

          {mySchools.map((school) => (
            <button
              key={school.id}
              onClick={() => handleInvite(school.id)}
              disabled={sending === school.id || sent[school.id]}
              style={{
                padding: "0.5rem 0.75rem",
                borderRadius: "8px",
                border: "none",
                background: sent[school.id]
                  ? "rgba(52, 211, 153, 0.08)"
                  : "rgba(255, 255, 255, 0.03)",
                color: sent[school.id] ? "#34d399" : "#fff",
                fontSize: "0.75rem",
                textAlign: "left",
                cursor: sent[school.id] ? "default" : "pointer",
                transition: "background 0.1s ease",
                display: "flex",
                alignItems: "center",
                gap: "0.4rem",
              }}
            >
              {sent[school.id] ? (
                <>✓ Invited to {school.name}</>
              ) : sending === school.id ? (
                <>Sending…</>
              ) : (
                <>{school.name}</>
              )}
            </button>
          ))}

          {error && (
            <p style={{ margin: "0.25rem 0 0", padding: "0 0.5rem", fontSize: "0.65rem", color: "#f87171" }}>
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export default SchoolInviteButton;
