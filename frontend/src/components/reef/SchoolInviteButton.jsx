/**
 * SchoolInviteButton.jsx
 * 
 * Dropdown button on user profiles that lets Founders/Elders
 * invite a user to one of their schools.
 */

import React, { useState, useEffect, useRef } from "react";
import { Check, UsersThree } from "@phosphor-icons/react";
import { getMySchools, inviteToSchool, getMySchoolRole } from "../../services/schoolsApi";
import "./ProfileDaylight.css";
import { getCurrentWallet } from "../../services/supabaseClient";
import { sameWallet } from "../../utils/wallet";
import { useAuth } from "../../contexts/AuthContext";

export function SchoolInviteButton({ targetWallet }) {
  const [mySchools, setMySchools] = useState([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [sending, setSending] = useState(null);
  const [sent, setSent] = useState({});
  const [error, setError] = useState(null);
  const triggerRef = useRef(null);
  const { account } = useAuth();
  const currentWallet = account || getCurrentWallet();

  // Load schools where the user is founder/elder
  useEffect(() => {
    if (!currentWallet || sameWallet(currentWallet, targetWallet)) return;
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
  }, [currentWallet, targetWallet]);

  // Don't show for own profile or if not connected
  if (!currentWallet || sameWallet(currentWallet, targetWallet)) return null;

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
    <div
      className="pf-invite"
      onKeyDown={(e) => {
        // Escape closes the list and puts focus back on the trigger, so it is
        // not lost when focus was on one of the club buttons.
        if (e.key === "Escape" && showDropdown) {
          setShowDropdown(false);
          triggerRef.current?.focus();
        }
      }}
    >
      {/* A disclosure, not a menu: the list is plain buttons, so no aria-haspopup. */}
      <button
        ref={triggerRef}
        type="button"
        className="reef-btn"
        onClick={() => setShowDropdown(!showDropdown)}
        aria-expanded={showDropdown}
      >
        <UsersThree size={18} weight="bold" aria-hidden="true" />
        Invite to a club
      </button>

      {showDropdown && (
        <div className="pf-invite-menu">
          <p className="pf-invite-title">Choose a club</p>

          {mySchools.map((school) => (
            <button
              type="button"
              key={school.id}
              className={`pf-invite-item${sent[school.id] ? " pf-invite-item--sent" : ""}`}
              onClick={() => handleInvite(school.id)}
              disabled={sending === school.id || sent[school.id]}
            >
              {sent[school.id] ? (
                <><Check size={16} weight="bold" aria-hidden="true" />Invited to {school.name}</>
              ) : sending === school.id ? (
                <>Sending…</>
              ) : (
                <>{school.name}</>
              )}
            </button>
          ))}

          {error && (
            <p className="pf-invite-error" role="alert">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export default SchoolInviteButton;
